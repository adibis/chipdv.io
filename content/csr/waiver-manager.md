---
title: "The Waiver Problem and a Scalable Waiver Manager"
weight: 7
date: 2026-10-29
publishDate: 2026-10-29
draft: false
description: "Why blanket register testing fails for interrupt generators and FSM-driven registers, and a singleton waiver manager built on include files."
prev: /csr/soc-stress-patterns
---

Running a generic sweep, bit-bash, access-type check, reset check, against every register in the map is the right default. It's also wrong for a specific, predictable subset of registers, and running it against those anyway doesn't just fail to test them correctly. It can break every test that runs after it in the same simulation. This article is about identifying that subset, and about a waiver mechanism that stays usable as the register count goes from one block to an entire SoC.

## Why some registers actively should not get the generic sweep

An interrupt-generator register, a field that, when written, asserts an interrupt line somewhere else in the design for test or debug purposes, is not safe to bit-bash. A generic sweep writes every bit pattern to every field it touches, which means it will, as a side effect, fire that interrupt. If anything else in the environment is watching for it, a scoreboard tracking expected interrupt counts, an unrelated test asserting no spurious interrupts occur, a register sweep that was only supposed to check read/write behavior now produces a failure in a completely unrelated checker, for a reason that has nothing to do with a register bug.

An FSM control or status register is a sharper version of the same problem. Writing an arbitrary bit pattern to a field that directly encodes a state machine's current or next state can force that FSM into a combination the hardware was never designed to reach through legitimate operation, sometimes one with no valid exit transition at all. The sweep completes, reports a pass (the write and readback matched), and leaves the DUT in a state every subsequent test in the same simulation inherits, silently, until something downstream fails for a reason that traces back to a register test that ran an hour of simulation time earlier.

Neither of these is hypothetical. They're the two most common reasons real projects end up hand-maintaining an ad hoc exclude list, usually starting as a few lines of inline code in the sweep sequence itself, which is exactly the approach that stops scaling the moment there's more than one block.

## Tagging: NO_CSR_TEST as an explicit, queryable property

The fix starts with making the exclusion an explicit property of the register rather than an exception buried in test code. Tag the register, or a specific field, `NO_CSR_TEST`, either as an attribute set during model generation from [RAL Generation in Practice](../ral-generation) if the source format supports custom metadata, or as an explicit post-build annotation otherwise. The generic sweep checks this tag before touching a register and skips it if set, instead of the exclusion living as a hardcoded name check inside the sequence.

This matters beyond code cleanliness. A tag on the register itself is visible to anyone looking at the model, travels with the register if referenced from a different test, and shows up in a design review. A name check buried in a sweep sequence's source file is invisible to everyone except whoever wrote it.

## The file format: text lists, not code

Tagging in the model handles registers whose exclusion is known at generation time. In practice, waivers accumulate throughout a project's life as new corner cases get discovered, and the people finding them are frequently not the ones who own the sweep sequence's source code. The scalable version of this is a plain text file, one register path per line, that a block owner maintains independently of the testbench code:

```
# block_a_csr_waivers.txt
# One fully-qualified register path per line. '#' starts a comment.
block_a.int_gen.trigger_reg
block_a.fsm_ctrl.state_override
block_a.fsm_ctrl.debug_force
```

A block-level environment points its waiver manager at this file directly. Nobody touches sequence code to add a waiver. A block owner who discovers a new register that shouldn't be swept adds one line and reruns.

## Scaling to subsystem and SoC: the include directive

This creates a duplication problem at the next level up. A subsystem instantiates five blocks, each with its own waiver file, plus a handful of subsystem-level registers needing their own waivers. Copy-pasting each block's file contents into a subsystem-level file guarantees the two drift apart the first time a block owner updates their file and nobody remembers to propagate the change upward. The fix is an `@include` directive in the file format itself:

```
# subsystem_csr_waivers.txt
@include block_a_csr_waivers.txt
@include block_b_csr_waivers.txt
@include block_c_csr_waivers.txt

# subsystem-level waivers, not owned by any single block
subsystem.top_ctrl.global_reset_force
```

Each level of integration owns exactly its own waivers plus a pointer to the levels below it. A block owner's fix to their own file gets picked up automatically by every subsystem and SoC-level environment that includes it. Nothing needs re-syncing by hand, and the ownership boundary matches the team boundary: block engineers own block waivers, subsystem integrators own the small set that only makes sense at their level.

![Waiver file include hierarchy: block files owned by block engineers, included transitively up through subsystem and SoC](/images/csr/07-include-hierarchy.svg)

## The singleton waiver manager

The parsing and query logic belongs in exactly one place per simulation, which is what makes it a singleton rather than a per-environment object. Every register environment in the testbench, at whatever level of hierarchy, should be asking the same waiver manager the same question and getting a consistent answer, without each environment re-parsing the waiver files independently.

```systemverilog
class csr_waiver_manager;
  static local csr_waiver_manager m_inst;
  local bit m_waived[string];  // set of fully-qualified register paths

  local function new();
  endfunction

  static function csr_waiver_manager get();
    if (m_inst == null) m_inst = new();
    return m_inst;
  endfunction

  function void load_file(string path);
    int fd = $fopen(path, "r");
    string line;
    if (fd == 0) `uvm_fatal("CSR_WAIVER", $sformatf("cannot open %s", path))
    while ($fgets(line, fd)) begin
      line = trim(line);
      if (line.len() == 0 || line[0] == "#") continue;
      if (line.substr(0, 8) == "@include ") begin
        load_file(resolve_path(line.substr(9, line.len()-1)));
      end else begin
        m_waived[line] = 1;
      end
    end
    $fclose(fd);
  endfunction

  function bit is_waived(string reg_full_name);
    return m_waived.exists(reg_full_name);
  endfunction
endclass
```

`load_file()` recurses on `@include` lines, so a subsystem-level `load_file("subsystem_csr_waivers.txt")` call pulls in every block file transitively without the caller needing to know how deep the include chain goes. The generic sweep sequence's only integration point is a single check before touching each register:

```systemverilog
if (csr_waiver_manager::get().is_waived(rg.get_full_name())) continue;
```

## What this buys, and what it doesn't

This gets exclusion out of test code and into a data file the people who understand why a register needs excluding can maintain directly, with the include mechanism keeping a hundred-block SoC's waiver list from turning into a hand-synchronized copy-paste exercise. It doesn't replace the judgment call of deciding what should be waived in the first place. That's still a register-by-register decision, usually made by whoever owns the block and understands what firing that interrupt or forcing that FSM state actually does downstream. The waiver manager makes the decision cheap to record and reliable to propagate. It doesn't make the decision for you.

---

*Next: Register Callbacks in Depth — pre_write, post_write, pre_read, post_read: modeling side-effecting registers without duplicating waiver or volatility logic.*
