---
title: "A UVM Monitor That Decodes C, and What It's Worth"
weight: 6
date: 2026-10-12
publishDate: 2026-10-12
draft: false
description: "Reading the message identifier back out of memory and reconstructing the original uvm_info/uvm_error call. Adapted from a paper at SNUG Silicon Valley 2025."
prev: /fw/encoding-messages-as-data
---

[Turning a Debug Message Into 32 Bits](../encoding-messages-as-data) got a 32-bit identifier and its arguments into fixed memory locations with one unsynchronized store per core, and a pair of tables generated at compile time that map identifiers back to the original message string and file/line. This article is the other half of that mechanism, adapted from the same technique presented at SNUG Silicon Valley 2025 (Shevade & Shripad, *UVM_INFO From Firmware Code*): a UVM memory monitor that watches the write locations, reconstructs the message, and prints it through `uvm_info`/`uvm_error` like any other testbench message, plus the actual performance case this whole series has been building toward.

## Loading both tables into the testbench

Before the monitor can decode anything, both tables from [Turning a Debug Message Into 32 Bits](../encoding-messages-as-data) need to be parsed into associative arrays indexed the same way the C side computed the identifier, so a lookup at runtime is a single hash access, not a scan:

```systemverilog
typedef struct {
  int severity;
  string message;
  int nargs;
  int args_seen;
  bit [31:0] args[$];
} c_msg_t;

typedef bit [31:0] unique_id_t;

c_msg_t message_table[unique_id_t];
unique_id_t current_uuid[NUM_CORES];
string c_msg_id_table[int];

function void read_message_table_file(string filename = "c_msg_table.txt");
  c_msg_t entry;
  string line, splits[$], msg_splits[$];
  int fd;
  if ((fd = $fopen(filename, "r")) != 0) begin
    while ($fgets(line, fd) != 0) begin
      // format: unique_id_hex, severity, arg_count, "message"
      uvm_split_string(line, "\"", msg_splits);
      uvm_split_string(msg_splits[0], ",", splits);
      entry.severity  = splits[1].atoi();
      entry.message   = msg_splits[1];
      entry.nargs     = splits[2].atoi();
      entry.args_seen = 0;
      message_table[splits[0].atohex()] = entry;
    end
  end
  $fclose(fd);
endfunction
```

The file-ID table parses the same way, mapping each compiled source file to the small integer the Makefile assigned it, so a decoded message can report the actual file name, not just a number.

## The monitor: one write, then the message is ready

The memory monitor watches each core's designated `PRINT_REG` window. The first write to a core's base address is always the identifier; if the decoded entry expects zero arguments, the message is printed immediately, otherwise the monitor tracks which core is mid-message and waits for the argument writes that follow at fixed offsets. `T` below is the memory transaction the monitor's analysis port receives on every bus access, `T.StartAddress` and `T.Data` are whatever the passive bus/memory monitor already populates on that transaction object, this snippet is the write-side callback that runs against each one:

```systemverilog
for (int i = 0; i < NUM_CORES; i++) begin
  if (T.StartAddress == `PRINT_REG + i*100) begin
    unique_id_t uuid = {T.Data[3], T.Data[2], T.Data[1], T.Data[0]};
    if (message_table[uuid].nargs == 0) begin
      print_uvm_message(uuid);
    end else begin
      current_uuid[i] = uuid;
    end
  end else if (T.StartAddress == (`PRINT_REG + i*100 + 'h4)) begin
    bit [31:0] arg = {T.Data[3], T.Data[2], T.Data[1], T.Data[0]};
    message_table[current_uuid[i]].args_seen += 1;
    message_table[current_uuid[i]].args.push_back(arg);
    if (message_table[current_uuid[i]].args_seen ==
        message_table[current_uuid[i]].nargs)
      print_uvm_message(current_uuid[i]);
  end
  // additional argument offsets (+0x8, ...) follow the same pattern
end
```

`print_uvm_message` does the actual reconstruction: look up the table entry, `$sformatf` the stored format string against the collected argument words, and map the decoded severity onto the right UVM macro so it lands in the simulation log the same way any other testbench message would, with the firmware's own file and line attached:

```systemverilog
function void print_uvm_message(unique_id_t unique_id);
  c_msg_t entry;
  string preformatted_msg, message_header;

  if (!message_table.exists(unique_id)) begin
    `uvm_warning("C_MSG", $sformatf("0x%08h not found in message_table", unique_id))
    return;
  end
  entry = message_table[unique_id];

  message_header = decode_unique_id(unique_id); // file:line from c_msg_id_table

  case (entry.nargs)
    0: preformatted_msg = entry.message;
    1: preformatted_msg = $sformatf(entry.message, entry.args[0]);
    2: preformatted_msg = $sformatf(entry.message, entry.args[0], entry.args[1]);
    default: preformatted_msg = $sformatf(
      "<unsupported arg count %0d> %s", entry.nargs, entry.message);
  endcase

  case (entry.severity)
    1: `uvm_error(message_header, $sformatf("unique_id=0x%08h: %s", unique_id, preformatted_msg))
    2: `uvm_info(message_header, $sformatf("unique_id=0x%08h: %s", unique_id, preformatted_msg), UVM_LOW)
  endcase
endfunction
```

What shows up in the simulation log reads like ordinary firmware trace, not a hex dump that needs a separate decoder pass:

```
3300000: [[C_MSG][core_2]:: bare_bones.c,57] 0x42400039: Executing main for core_2
5736000: [[C_MSG][core_2]:: bare_bones.c,79] 0x4240004f: Core_2... DONE
```

![Firmware on each core writing a fixed-size message identifier to a per-core memory location; a UVM monitor decodes it against the compile-time table and prints it through uvm_info/uvm_error with the original file and line attached](/images/fw/06-uvm-decode-and-payoff.svg)

## What this is actually worth

This is the measurement [Your Debug Infrastructure Is Part of the Bug](../debug-infrastructure-is-part-of-the-bug) promised rather than gave: 100 messages, up to 64 characters each, logged through a shared memory-mapped location. Character streaming took 764.946us of simulation time and 23 minutes 39 seconds of wall clock. The message-ID scheme above took 72.074us and 6 minutes 36 seconds for the same 100 messages, a roughly 90% reduction in simulation time and a comparable drop in wall clock, though wall clock is noisier since it depends on whatever else is running on the same machine.

The mechanism behind that gap is exactly what this article and the last one built: streaming spends cycles proportional to message length, one write (and one FIFO-ready poll) per character; the identifier scheme spends a fixed, small number of writes regardless of message length, one word for the identifier and one per argument, at most three total for a two-argument message. That difference doesn't depend on multi-core contention at all, it holds even measured on a single core with no cross-core lock in the picture. Add the cross-core serialization problem from [Your Debug Infrastructure Is Part of the Bug](../debug-infrastructure-is-part-of-the-bug) back in, and the gap widens further, because the identifier scheme has no shared lock to contend on in the first place: each core writes to its own `PRINT_REG` offset, so nothing about emitting a message forces one core to wait on another's.

At the scale of a single test this is a nice speedup. At regression scale, with the kind of heavy, always-on logging that chasing a rare multi-core race actually requires, it's the difference between debug instrumentation that's cheap enough to leave on for every run and one that has to be switched on selectively after a failure is already suspected, which puts the entire methodology back to reproducing the bug first and instrumenting it second.

---

*Next: Two Cheap Tricks: A PC Spy and a Boot Fast-Forward — turning a raw program counter into a readable function name, and skipping a slow boot without touching what it's skipping.*
