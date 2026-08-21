---
title: "What the Built-in Sequences Actually Test"
weight: 4
date: 2026-08-20
publishDate: 2026-08-20
draft: false
description: "reg_hw_reset, reg_bit_bash, reg_access: what they catch, and the access types where they quietly pass over the bug."
prev: /csr/ral-generation
next: /csr/volatile-registers
---

The UVM register package ships three sequences most projects run against every register in the design without much further thought: `uvm_reg_hw_reset_seq`, `uvm_reg_bit_bash_seq`, and `uvm_reg_access_seq`. They're useful. They catch a real class of bug for a real fraction of the register map, for free. The mistake is treating "we ran the built-ins" as equivalent to "the registers are tested." They cover one behavioral model well, and that model is plain RW.

```systemverilog
// what most projects run, and stop at
uvm_reg_hw_reset_seq reset_seq = uvm_reg_hw_reset_seq::type_id::create("reset_seq");
reset_seq.model = csr_block;
reset_seq.start(null);

uvm_reg_bit_bash_seq bash_seq = uvm_reg_bit_bash_seq::type_id::create("bash_seq");
bash_seq.model = csr_block;
bash_seq.start(null);

uvm_reg_access_seq access_seq = uvm_reg_access_seq::type_id::create("access_seq");
access_seq.model = csr_block;
access_seq.start(null);
```

![Coverage of the three built-in sequences against RW, RO/WO, and W1C-class access types](/images/csr/04-sequence-coverage.svg)

## reg_hw_reset_seq: does the register come up right

This one checks that every register's value after reset matches its declared reset value. It's the simplest of the three and has the fewest caveats: it reads every register after a reset event and compares against the reset value from the model. The main way it misses bugs is if the reset value declared in the model doesn't match the spec in the first place, which is a generation problem ([article 03](../ral-generation)) rather than a sequence problem. Assuming the model is correct, this sequence does what it says on the label.

## reg_bit_bash_seq: exercising every bit independently

This walks every field, writes the opposite of its current value one bit at a time, and checks that only the targeted bit changed, catching bit-level aliasing where writing one field accidentally affects an adjacent one. For a plain RW field this is a strong test. It catches bit-width mismatches between the RTL and the model and sloppy field packing within a register. It says nothing about address decode: two registers landing on overlapping addresses is a bus/map-level collision, not something a per-field bit walk inside a single register can ever observe.

For anything that isn't RW, the sequence's behavior depends on how carefully the access policy gets respected, and the failure mode isn't always a crash. It's frequently a silent skip. WO fields can't be read back meaningfully, so a bit-bash pass against a write-only field either compares against an undefined read value (spurious failure) or the sequence recognizes the policy and skips verification entirely (silent gap, the bit got written but never confirmed). W1C fields are actively dangerous to bit-bash naively. Writing a 1 to clear a bit that hardware hasn't yet set doesn't do anything observable, so a bit-bash pass can complete without ever exercising the clear behavior at all. It looks like coverage. It isn't.

## reg_access_seq: checking the reported access policy against actual behavior

This sequence writes and reads each register and checks that the behavior matches its declared access type: an RO field shouldn't change value when written, a RW field should. It's the sequence most likely to catch a transcription error from generation, because it's directly checking whether a field behaves the way its access string claims. But it validates consistency between the declared policy and observed behavior, not correctness against the specification. If the spec says a field should be W1C and the model (and the RTL) both agree it's RW, this sequence sees consistent behavior and passes. The bug is invisible to it because both sides of the comparison inherited the same mistake.

## The pattern across all three

Every one of these sequences is fundamentally a consistency check against the model, not against the specification or the intended hardware behavior. They answer "does the hardware behave the way the RAL model says it should," which is valuable and worth running on every register, every time, because it's nearly free and catches real integration bugs. They can't answer "does the RAL model correctly describe what the spec requires," and they can't exercise timing-dependent behavior like a W1C bit that needs to actually be set by hardware first before the clear means anything.

The registers where this matters most are the ones the rest of this series is about. W1C/W1S/RC/RS fields need a directed sequence that first drives the hardware condition that sets the bit, then performs the software-side clear or set, then confirms the result, not a generic sweep:

```systemverilog
// directed sequence for a W1C interrupt-pending bit:
// generic bit-bash never actually exercises this
task directed_w1c_seq::body();
  // force the hardware condition that sets the bit
  force_interrupt_source(1'b1);
  csr.int_status.mirror(status, UVM_NO_CHECK);  // resync: model never predicted this hw-driven set
  if (csr.int_status.pending.get() !== 1'b1)
    `uvm_error("W1C_MISS", "hw-set never landed before the clear was attempted")

  // now exercise the actual clear
  csr.int_status.write(status, 32'h1);          // write 1 to clear
  csr.int_status.mirror(status, UVM_NO_CHECK);
  if (csr.int_status.pending.get() !== 1'b0)
    `uvm_error("W1C_STUCK", "clear did not take effect")
endtask
```

Registers with a value that changes on its own, independent of any software write, need the volatility handling in a later article on volatile registers. And registers that shouldn't be swept at all, because sweeping them causes a side effect elsewhere in the design, need explicit exclusion, which is what a later article on the waiver mechanism covers. Running the built-ins against those registers without exclusion doesn't just fail to test them correctly. It can corrupt DUT state for every test that runs afterward.

---

*Next: Volatile Registers and the Predictor Problem*
