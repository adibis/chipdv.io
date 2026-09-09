---
title: "Volatile Registers and the Predictor Problem"
weight: 5
date: 2026-09-04
publishDate: 2026-09-04
draft: false
description: "Registers that change value without a software write, and the races that shows up between a hardware update and a predictor's mirrored value."
prev: /csr/builtin-sequence-limits
next: /csr/soc-stress-patterns
---

Every register discussed so far changes value in response to a bus transaction. Software writes it, or software's read triggers a clear. There's a whole other category that changes independently of software entirely: a status register tracking FIFO fill level, a free-running counter, a state-machine-encoded status field, an error code latched the instant a fault occurs. RAL calls these volatile, and if a register that behaves this way isn't marked volatile in the model, the mirrored value quietly turns into fiction the moment hardware updates the field on its own.

## What `is_volatile` actually changes

```systemverilog
fifo_lvl = uvm_reg_field::type_id::create("fifo_lvl");
fifo_lvl.configure(this, 8, 0, "RO", 1 /* volatile */, 8'h00, 1, 0, 0);
// the "1" in the volatile slot is what tells the predictor and the
// built-in sequences not to trust the mirror for this field
```

Marking a field volatile (`set_volatility` on the field, or the corresponding attribute in whatever generates the model, see [article 03](../ral-generation)) tells RAL not to trust its own mirrored value between accesses. A non-volatile RW field can be reasoned about purely from the model's state. If nobody has written it, its value hasn't changed. A volatile field has no such guarantee, and RAL's default handling reflects that: certain sequences re-read a volatile register rather than rely on the mirror, and the model won't flag a stale mirrored value against a fresh hardware read as an error the way it would for a non-volatile field.

Getting this wrong runs in both directions. Fail to mark a genuinely volatile field, and every read of a live counter or FIFO-level register looks like a mirror mismatch. The test infrastructure reports failures that have nothing to do with the DUT, because the model insists a value that changed in hardware five cycles ago should still match a mirror from before the change. Mark a field volatile when it isn't, and you lose an actual consistency check for a register that would have caught a real bug. The model stops flagging changes it should have flagged, for a field that was, in fact, stable and predictable.

## The race that built-in handling doesn't fully solve

Volatility marking tells the testbench not to assume a value hasn't changed. It doesn't say *when* it changed relative to a given read, and that's where the actual race lives. Take a FIFO fill-level register updated by hardware on every push and pop, read via a frontdoor bus transaction by a monitor thread also predicting coverage from the observed value. Between the cycle the read is issued and the cycle the read data returns, hardware can push or pop again. The value the transaction observes is a snapshot at the sampling edge, not a value that holds true for any window afterward. Any downstream code treating that read as "the current fill level" for longer than the instant of the read is building on an assumption the hardware never promised.

Backdoor reads of a volatile field make this worse. A backdoor peek reads the underlying storage element directly with no synchronization to the clock domain a frontdoor path would sample on, which means a backdoor read of a rapidly changing volatile register can return a value no frontdoor transaction could ever have observed. It caught the register mid-transition in a way the actual protocol never exposes. This is exactly where the blind reliance on backdoor access for speed, mentioned in [article 01](../ral-fundamentals), turns into a correctness bug rather than a performance shortcut.

![Volatile register race: a hardware push between a frontdoor read's sampling edge and a backdoor peek mid-transition](/images/csr/05-volatile-race.svg)

## What a robust volatile-register test actually checks

Rather than comparing a single read against a single expected value, a volatile register needs a test built around the invariant hardware actually provides: not "the value is X" but "the value falls within the range hardware guarantees given what's happened since the last known-good point," or "the value changes monotonically in the expected direction between two reads separated by a known number of operations." For a FIFO level register, that means driving a known number of pushes with no concurrent pops, then reading and checking against an expected range if any asynchronous consumer could plausibly be draining it. For a free-running counter, it means reading twice with a known number of clock cycles between the reads and checking the delta, not the absolute value.

```systemverilog
// delta check, not absolute value: the only thing hardware promises.
// mirror(..., UVM_NO_CHECK) does the actual bus read and refreshes the
// mirror, but skips comparing it against the stale value already there --
// exactly the comparison this whole article has argued not to trust.
uvm_status_e status;
uvm_reg_data_t before, after;
counter.mirror(status, UVM_NO_CHECK);
before = counter.get_mirrored_value();
repeat (16) @(posedge clk);              // known number of cycles
counter.mirror(status, UVM_NO_CHECK);
after = counter.get_mirrored_value();
`uvm_info("VOLREG", $sformatf("delta = %0d", after - before), UVM_LOW)
if ((after - before) < 15 || (after - before) > 17)
  `uvm_error("VOLREG", "counter delta outside expected window")
```

That's more work per register than a generic sequence, which is exactly why volatile registers deserve deliberate handling rather than getting swept up in whatever generic pass covers the rest of the map. Same argument as the write-1-to-clear fields in [article 04](../builtin-sequence-limits), and one more reason the waiver and classification scheme covered in a later article needs to track more than a binary test-it-or-don't.

## Predictor implications

The predictor from [article 01](../ral-fundamentals) has the same problem as the test writer: it can't know what a volatile field's value should become after an observed transaction, because volatility means the value is influenced by something the predictor doesn't model at all. Most projects land on having the predictor invalidate the mirrored value for volatile fields on any access, rather than attempt to predict a specific new value, forcing the next comparison to be a live read instead of a stale-mirror comparison. That's the correct default. It also means any test logic depending on the mirrored value being accurate for a volatile field, rather than re-reading it explicitly, is trusting something RAL was never designed to promise for that field.

---

*Next: SoC-Level Register Stress Patterns*
