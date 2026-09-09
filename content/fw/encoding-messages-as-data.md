---
title: "Turning a Debug Message Into 32 Bits"
weight: 5
date: 2026-08-31
publishDate: 2026-08-31
draft: false
description: "Encoding severity, core, file, and line into a single fixed-width identifier, using variadic C macros that never put the message string in the firmware image."
prev: /fw/debug-infrastructure-is-part-of-the-bug
next: /fw/uvm-decode-and-payoff
---

[Article 04](../debug-infrastructure-is-part-of-the-bug) ended on a requirement: a debug message needs to become a fixed-size piece of data a core can write in one unsynchronized store, not a string that has to physically move somewhere character by character. This article and the next one build that scheme end to end, adapted from a technique first presented at SNUG Silicon Valley 2025. This one covers the encoding and the C-side macros that generate it; a later article covers decoding it back into `uvm_info`/`uvm_error` on the UVM side.

## What has to survive the round trip

The full information in a debug message, the format string, its severity, which core logged it, which source file and line it came from, and its arguments, has to be recoverable later even though only a fixed-width identifier gets written during simulation. The identifier itself doesn't need to carry the string; it needs to carry enough to look the string up afterward, deterministically, from something generated once at compile time. That's the entire design constraint: pack severity, core ID, argument count, and enough of the source location to be unique, into a single word, and generate a table mapping that word back to the original message at build time, not at runtime.

The scheme packs five fields into a 32-bit identifier: severity (3 bits, 8 levels, enough to distinguish info from error from fatal and reserve room for verbosity tiers), core ID (5 bits, up to 32 cores, `HART_ID` in the macros below — "hart" being RISC-V's term for a single hardware thread of execution, one per core on a single-threaded core), argument count (2 bits, up to 3 arguments per message), a hash of the source file (enough bits for roughly 1000 files in a project without collisions in practice), and the line number. Argument values themselves aren't packed into the identifier at all, they're written to adjacent, separate memory locations, one word per argument, immediately after the identifier word. If a project's file count or line count outgrows what fits, the same scheme extends to a 64-bit identifier without changing anything about how it's used, just how many bits each field gets.

The "file hash" field is worth being precise about, since the name overstates what it actually is. The reference implementation doesn't hash a path at all: the table-generation step below assigns each compiled file a small sequential integer, incrementing a counter every time the build compiles a new one. That sidesteps hash-collision risk entirely, at the cost of a different, simpler constraint: the ID space is bounded by how many distinct files can compile before the counter runs out, not by how well a hash function happens to distribute paths.

## A `printf`-shaped macro that never touches the string at runtime

The C-side entry point needs to accept a variable number of arguments the same way `printf` does, so it can't be `C_MSG(id, severity, message)` with a fixed signature, it has to be `C_MSG(severity, "format %d", value)`. Getting the argument count out of a variadic macro at preprocessor time (no runtime cost allowed, since counting arguments at runtime would mean the format string has to exist at runtime) uses a well-known, if slightly opaque, preprocessor trick worth naming before reading it: shift a reversed list of index constants across the actual arguments until one particular constant lands in the position the count is read from, which only works because the preprocessor expands macros left to right without knowing or caring how many real arguments were passed.

```c
// Counts variadic arguments by shifting a reversed index list until the
// argument in question lands under the marker position N. Five slots
// ahead of N: severity and message consume two, leaving room to count
// the 0-3 optional arguments the 2-bit field can actually hold.
#define _ARG_N(_1, _2, _3, _4, _5, N, ...) N
#define COUNT_ARGS(...) _ARG_N(__VA_ARGS__, 5, 4, 3, 2, 1, 0)

// Severity and message consume the first two variadic slots, so the
// actual optional-argument count is two less than the raw count.
#define COUNT_OPTIONAL_ARGS(...) (COUNT_ARGS(__VA_ARGS__) - 2)

// C_MSG_IMPL exists only to force N to expand to its numeric value before
// C_MSG_IMPL2 runs -- calling C_MSG_IMPL2 directly from C_MSG would pass
// it the unexpanded COUNT_ARGS(...) call instead of the number it computes.
#define C_MSG(...) \
  C_MSG_IMPL(COUNT_ARGS(__VA_ARGS__), __VA_ARGS__)

#define C_MSG_IMPL(N, ...) \
  C_MSG_IMPL2(N, __VA_ARGS__)

#define C_MSG_IMPL2(N, severity, message, ...) \
  C_MSG_DISPATCHER( \
    GET_UUID(severity, HART_ID, COUNT_OPTIONAL_ARGS(severity, message __VA_OPT__(,) __VA_ARGS__), \
              C_MSG_ID, __LINE__), \
    severity, message, COUNT_OPTIONAL_ARGS(severity, message __VA_OPT__(,) __VA_ARGS__) \
    __VA_OPT__(,) __VA_ARGS__)
```

`GET_UUID` is the macro that actually does the bit-packing described above, severity into 3 bits, core ID into 5, argument count into 2, the file's small integer ID and the line number filling the rest, all folded into one constant bitwise expression at preprocess time. Its body is a straightforward sequence of shifts and ORs against those five fields and is omitted here since it's mechanical once the field layout is fixed; what matters for the rest of this article is only that it produces the `unique_id` constant `C_MSG_DISPATCHER` receives below. `C_MSG_ID` is the file's small integer ID mentioned above, made visible to every call site in a given file the same way `HART_ID` is: a `-D` define the build passes on that file's own compile command, incremented by the same Makefile rule (below) that walks the file list.

`C_MSG_DISPATCHER` is deliberately given a name that survives into the compiler's preprocessor output unmodified, which matters in the next section: a build step is going to grep for that exact symbol to reconstruct the message table, so the macro expansion has to leave it intact rather than expanding it away into something anonymous.

```c
// This name is preserved through preprocessing on purpose - it's what the
// compile-time table generator (below) greps for.
void C_MSG_DISPATCHER(uint32_t unique_id, int severity,
                      const char *message, int count, ...) {
  va_list args;
  va_start(args, count);
  if (count == 0) {
    c_msg_2(unique_id, severity, message);
  } else if (count == 1) {
    uint32_t a1 = va_arg(args, uint32_t);
    c_msg_3(unique_id, severity, message, a1);
  } else if (count == 2) {
    uint32_t a1 = va_arg(args, uint32_t);
    uint32_t a2 = va_arg(args, uint32_t);
    c_msg_4(unique_id, severity, message, a1, a2);
  } else if (count == 3) {
    uint32_t a1 = va_arg(args, uint32_t);
    uint32_t a2 = va_arg(args, uint32_t);
    uint32_t a3 = va_arg(args, uint32_t);
    c_msg_5(unique_id, severity, message, a1, a2, a3);
  }
  va_end(args);
}

// Writes the identifier, then any argument words, to fixed, per-core
// locations - a single unsynchronized store per word, no cross-core lock.
void c_msg_4(uint32_t unique_id, uint8_t severity, const char *msg,
             uint32_t a1, uint32_t a2) {
  WRITE32(PRINT_REG + 100 * HART_ID, unique_id);
  WRITE32(PRINT_REG + 100 * HART_ID + 0x4, a1);
  WRITE32(PRINT_REG + 100 * HART_ID + 0x8, a2);
}

void c_msg_5(uint32_t unique_id, uint8_t severity, const char *msg,
             uint32_t a1, uint32_t a2, uint32_t a3) {
  WRITE32(PRINT_REG + 100 * HART_ID, unique_id);
  WRITE32(PRINT_REG + 100 * HART_ID + 0x4, a1);
  WRITE32(PRINT_REG + 100 * HART_ID + 0x8, a2);
  WRITE32(PRINT_REG + 100 * HART_ID + 0xC, a3);
}
```

A call site now reads exactly like a `printf` call:

```c
C_MSG(INFO, "Executing main for core_%0d", CORE_ID);
```

and after preprocessing, expands into a `C_MSG_DISPATCHER` call carrying the fully-computed identifier as a constant bitwise expression, the format string, and the argument, with the string only ever appearing in the preprocessor output, not in a runtime data section of the compiled image.

## A watchdog firing between the identifier and its arguments

`c_msg_4()` issues three separate stores, the identifier word first and then each argument word, one at a time, with nothing tying them together into a single atomic operation. A later article's decode-side monitor depends on that specific order: the monitor treats the first write to a core's `PRINT_REG` base as always being the identifier, and only after decoding it does it know how many argument writes to wait for. A watchdog reset that lands after the identifier lands but before every argument word does is a real gap in that design, not a hypothetical one, and reordering the writes doesn't fix it without breaking the thing article 06 relies on: the monitor can't know it's looking at an identifier rather than an argument until it's already seen one, so the identifier has to come first for the decode logic to work at all.

What actually goes wrong without a fix isn't corrupted data, it's a monitor stuck waiting. The monitor decoded a real identifier, knows it's expecting, say, two arguments, and is watching those fixed offsets for writes that are never coming because the core that was about to send them just reset. Left alone, that monitor instance sits in "mid-message" state indefinitely, and worse, if that same core resumes after reset and its *next* message happens to reuse the same `PRINT_REG` offsets, whatever it writes first gets misread as the missing argument from the message before the reset, not as the identifier of a new one.

The fix isn't in the C-side write order at all, it's that same later decode-side monitor treating a reset event as a reason to discard whatever it was in the middle of reconstructing. That monitor, covered in full next article, keeps two small pieces of state per core: `current_uuid[i]`, the identifier core `i` last reported, and `message_table[uuid]`, one entry per known identifier holding the expected argument count (`nargs`) alongside however many have actually arrived so far (`args_seen`, and the words themselves in an `args` queue). The state worth clearing on reset is exactly that: `current_uuid[i]` still points at the last identifier core `i` reported, and `message_table[current_uuid[i]]` holds however many argument words arrived before the reset cut it off, in both the `args_seen` count and the `args` queue itself. Zeroing the count alone isn't enough: `args` still has the stale pre-reset words sitting at its front, and the next message that happens to reuse this same identifier would see `args_seen` correctly reach `nargs` while `args[0]`/`args[1]` still point at values from the abandoned message. Both need to clear:

```systemverilog
// On any reset affecting this core's domain, drop whatever partial
// message state the monitor was tracking rather than waiting for
// argument writes that a watchdog just made sure will never arrive
function void handle_reset(int core_id);
  message_table[current_uuid[core_id]].args_seen = 0;
  message_table[current_uuid[core_id]].args.delete();
  `uvm_info("C_MSG_MON", $sformatf(
    "core %0d reset mid-message, discarding partial decode", core_id), UVM_LOW)
endfunction
```

This is the same discipline [reuse article 01](/reuse/mid-sim-reset-plumbing) argues for generally, state that describes DUT history has to clear on reset rather than survive it, applied here to a monitor's own bookkeeping instead of a scoreboard's. A message truly lost to a watchdog mid-write, the one describing state right before the reset fired, can't be recovered after the fact; discarding the partial decode cleanly just keeps that loss from also corrupting whatever message comes after it.

## Recovering the string at compile time, not at runtime

The firmware image is small precisely because the string never has to be linked into it. What has to exist somewhere is a table built once, from saved preprocessor output, mapping every identifier a build could ever produce back to its original format string and argument count. A build rule saves that output (`gcc -E`) per compiled file, then a script scans it for every `C_MSG_DISPATCHER(...)` call, evaluates the (by then fully constant) bitwise expression that computes the identifier, and extracts the message string and severity sitting next to it in the same call:

```python
# Grep C_MSG_DISPATCHER calls out of saved preprocessor output, evaluate the
# constant unique_id expression, and emit one table row per message.
for match in find_dispatcher_calls(preprocessed_source):
    unique_id = eval_expr(match.unique_id_expr)      # constant by this point
    message   = extract_quoted_string(match.args[2])
    severity  = match.args[1]
    nargs     = eval_expr(match.arg_count_expr)
    table.append(f'{unique_id:08X},{severity},{nargs},"{message}"')
```

The output is one line per unique message the build could ever emit:

```
6200_2012,2,0,"CPU_CORE2 FAIL"
4240_2037,2,1,"Executing main for core_%0d"
4240_204D,2,1,"Core_%0d... DONE"
```

A second, simpler table maps each compiled source file to the small integer ID that went into that file's identifiers, generated by a Makefile rule that increments a counter every time it invokes the compile step:

```
/dv/core_name/firmware/arch/ARCH/src/startup.S,20
/dv/core_name/firmware/arch/ARCH/src/common_lib.c,21
/dv/core_name/firmware/lib/src/c_msg.c,23
```

Both tables are build artifacts, regenerated whenever the firmware source changes, never shipped as part of the firmware image itself. Everything the identifier needs to become a readable message again lives outside the thing that runs on the DUT.

![A 32-bit message identifier packed from severity, core ID, argument count, and file/line, with the format string routed only through preprocessor output into a compile-time table, never into the compiled firmware image](/images/fw/05-message-id-encoding.svg)

---

*Next: A UVM Monitor That Decodes C, and What It's Worth — reading these identifiers back out of memory and turning them into `uvm_info`/`uvm_error`.*
