---
title: "Register Access Types Aren't Symmetric"
weight: 2
date: 2026-07-09
publishDate: 2026-07-09
draft: false
description: "RO, RW, W1C, W1S, RC, RS, and the rest: why hardware access and software access are two different questions that can disagree."
prev: /csr/ral-fundamentals
next: /csr/ral-generation
---

The single most common source of wrong register tests isn't a testbench bug. It's treating "access type" as one property of a register when it actually describes a contract between two independent parties, hardware and software, who are frequently doing different things to the same bits. Get this wrong and you end up with a bit-bash test that passes against a register it never actually exercised correctly.

## Access type is really two access types

Every field in a register has a software-facing access policy and a hardware-facing behavior, and the two don't have to match. `add_field()` in RAL takes an access string, `"RW"`, `"RO"`, `"W1C"`, and so on, and that string encodes both sides of the contract at once, plus a third fact that matters just as much: whether a generic bit-bash sequence can exercise that field safely at all. The full breakdown is below; here's what two of the less obvious ones look like declared in RAL:

```systemverilog
class int_status_reg extends uvm_reg;
  `uvm_object_utils(int_status_reg)
  rand uvm_reg_field pending;   // W1C: sw clears; hw sets asynchronously, so volatile=1
  rand uvm_reg_field fifo_lvl;  // RO:  hw-driven status, also volatile=1

  // configure(parent, size, lsb_pos, access, volatile, reset,
  //           has_reset, is_rand, individually_accessible)
  function void build();
    pending  = uvm_reg_field::type_id::create("pending");
    pending.configure(this, 8, 0, "W1C", 1, 8'h00, 1, 1, 0);

    fifo_lvl = uvm_reg_field::type_id::create("fifo_lvl");
    // volatile=1 here is the mechanism a later article covers in depth
    fifo_lvl.configure(this, 8, 8, "RO", 1, 8'h00, 1, 0, 0);
  endfunction
endclass
```

![Register access types: what software sees vs. what hardware does, and whether a generic bit-bash sequence exercises them safely](/images/csr/02-access-types.svg)

The access string describes what software does, full stop. It makes no claim about hardware, and it isn't supposed to. Whatever hardware does to a field is a separate declaration, `volatile`, covered later in this series. `pending` above needs `volatile=1` for the same reason `fifo_lvl` does: hardware can assert it asynchronously, independent of any bus transaction, so RAL can't trust its own mirrored value between accesses. Miss that, and the access string being correct doesn't save the model, since `write=1 clears` is only worth testing if something can set the bit back to 1 in between.

## Why this matters for the mirrored value

RAL's predictor (from [article 01](../ral-fundamentals)) needs the access type to update the mirrored value correctly after a bus transaction. For a plain RW field, predicting the mirrored value after a write is trivial: mirrored becomes whatever was written. For W1C, the correct prediction is not "mirrored becomes the written value." Writing 1 to a W1C bit should predict the bit clearing to 0, not becoming 1. Writing 0 predicts no change at all. If the register model's access string is wrong, say a W1C field got accidentally declared RW during generation, the predictor computes the wrong mirrored value after every single write, and every subsequent read-compare in the test reports a mismatch that has nothing to do with a real hardware bug.

Part of why this is a generation-correctness problem as much as a testbench-logic problem: [article 03](../ral-generation) treats the register model as something to validate against its source of truth, not something to eyeball once at project kickoff and forget about.

## Which access types generic sequences handle safely

A plain RW field is what `reg_bit_bash_seq` and `reg_access_seq` were designed for. Write a pattern, read it back, expect an exact match. That works because nothing except software is expected to change the value between the write and the read.

W1C, W1S, RC, and RS fields break that assumption at a structural level, not incidentally. A generic bit-bash sequence that writes 1 to a W1C bit and then reads back expecting to see 1 again isn't testing the register at all. It's testing a behavior the register was explicitly designed not to have. Depending on how the sweep is written, this fails in one of two directions, and it's worth seeing both concretely rather than taking it on faith.

A naive sweep that doesn't check the access policy at all produces a spurious failure:

```systemverilog
// naive: treats every field as RW, no access-policy awareness
// blk: the uvm_reg_block instance under test
uvm_status_e     status;
uvm_reg_data_t   before, after;
uvm_reg_field    fields[$];

blk.get_fields(fields);
foreach (fields[i]) begin
  before = fields[i].get();
  fields[i].write(status, ~before);
  fields[i].read(status, after);
  if (after !== ~before)
    `uvm_error("BITBASH", $sformatf(
      "%s: wrote 'h%0h, read back 'h%0h", fields[i].get_name(), ~before, after))
end
```

Against `pending` (W1C, currently 0 because nothing has set it), this writes 1, and unless hardware happens to assert the bit in that exact window, the write does nothing at all. The readback correctly returns 0. The naive check compares 0 against the written value of 1 and fails:

```
UVM_ERROR @ 1200: BITBASH: pending: wrote 'h1, read back 'h0
```

That's a spurious failure. Nothing is wrong with the register; the sweep asked it to do something W1C fields are explicitly designed not to do.

The other direction is quieter and more dangerous: a sweep that's aware enough to check the access policy string, but only uses that awareness to skip fields it doesn't know how to handle, rather than routing them to a policy-appropriate check:

```systemverilog
// blk: the uvm_reg_block instance under test
uvm_reg_field fields[$];

blk.get_fields(fields);
foreach (fields[i]) begin
  if (fields[i].get_access() != "RW") continue;  // "handles" W1C by ignoring it
  // ... same write/read/compare as above
end
```

This sweep never errors on `pending` at all. It also never touches it. The test report shows every field in the block passing, because the one field that needed a real, hardware-condition-aware check was quietly excluded from the loop that was supposed to be checking it. A register test suite built this way can run clean for months while the actual clear behavior of every W1C bit in the design has never been exercised once.

A later article goes into which built-in sequences skip which access types and why, and what a directed sequence needs to actually exercise write-1-to-clear timing.

## What this means for the test strategy, not just the sequence

Knowing which access types are in play should change what kind of test gets written, not just which built-in sequence gets called. A block with forty RW configuration registers and three W1C interrupt-status registers doesn't need forty-three instances of the same test. It needs one generic pass over the RW set and three specifically constructed scenarios for the W1C registers, each one actually generating the hardware condition that sets the bit before checking that software can clear it. Treating access type as a field to declare and move past, rather than a decision about what kind of verification a register needs, is the mistake this series keeps coming back to, in the built-in sequence gaps covered later and again in the sequences-versus-assertions question further ahead.

---

*Next: [RAL Generation in Practice](../ral-generation)*
