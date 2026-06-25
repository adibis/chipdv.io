---
title: "UVM RAL Fundamentals"
weight: 1
date: 2026-06-25
publishDate: 2026-06-25
draft: false
description: "The register model, frontdoor vs backdoor access, mirrored vs desired value, and what adapters and predictors are actually for."
next: /csr/register-access-types
---

Every UVM testbench past a certain size ends up with a register abstraction layer. The interesting question isn't whether to use RAL. It's whether the team understands what it's actually modeling, or whether it's being used as a black box that happens to generate `write()` and `read()` calls. This article covers the pieces that matter: what the model represents, how a value gets from a sequence to the DUT and back, and where the abstraction leaks.

![RAL data flow: desired/mirrored value, frontdoor and backdoor paths, adapter, and predictor](/images/csr/01-ral-dataflow.svg)

## What the register model actually is

A `uvm_reg` is not a register. It's a software-side model of one, holding a *mirrored value* (what the testbench believes the hardware currently holds) and a *desired value* (what the testbench wants the hardware to hold, before the write has actually happened). These two values are allowed to disagree, and the disagreement is the entire point of having both. `set()` changes the desired value with no bus activity at all. `update()` compares desired against mirrored and issues a bus write only if they differ. `write()` does both in one call: set, then issue the transaction.

```systemverilog
// set() + update(): stage several field changes, one bus write
csr.mode.set(2'b10);
csr.enable.set(1'b1);
csr.update(status);           // one write, combined value

// write() collapses set+update into a single call
csr.write(status, 32'h0000_0006);
```

The model organizes into `uvm_reg_block` for a functional grouping of registers, `uvm_reg_map` for an address space a given register is visible through, and `uvm_reg_file` for grouping without necessarily implying an address map of its own. A block can have more than one map. That's how the same register set gets modeled once but verified as reachable through two different physical paths, which matters the moment there's more than one bus master in the picture. A later article in this series comes back to exactly that case.

![uvm_reg_block containing a uvm_reg_file and loose uvm_reg instances, exposed through two separate uvm_reg_map address spaces](/images/csr/01b-ral-model-hierarchy.svg)

## Frontdoor vs. backdoor

A frontdoor access goes through the actual protocol path: an AXI write, an APB transfer, whatever the bus happens to be. It exercises the real hardware path, including the interconnect, the register's decode logic, and any protocol-level timing. A backdoor access bypasses all of that and pokes the register's storage directly via an HDL path (`add_hdl_path`), using `hdl_read`/`hdl_write` under the hood. It's instantaneous, and it never touches the decode logic at all.

```systemverilog
// frontdoor: goes through the adapter and the real bus
csr.write(status, 32'h1, UVM_FRONTDOOR);

// backdoor: direct HDL poke, no bus activity at all
csr.write(status, 32'h1, UVM_BACKDOOR);

// wiring a register (or a whole block) to its HDL path
csr.mode.add_hdl_path_slice("u_dut.u_ctrl.mode_reg", 0, 8);
```

The temptation is to use backdoor everywhere, because simulation time is expensive and backdoor is free. That's a mistake for anything where the access path itself matters. A bit-bash sequence run entirely backdoor never touches the address decoder, the bus protocol adapter, or anything else between the sequencer and the storage element. Backdoor is for setup, preloading a register to a known state before a test that isn't about that register, or for checking storage frontdoor genuinely can't reach cheaply. It shouldn't be a default substitute for frontdoor testing just because it's faster.

## Mirrored value, desired value, and why the distinction survives

The mirrored value tracks the testbench's belief about hardware state, updated automatically after a successful frontdoor access (via the predictor, more on that below) or explicitly via `predict()`. The desired value works as a staging area. Call `set()` on five fields of a register and the desired value accumulates all five changes before a single `update()` issues one bus write with the combined result. That's what makes RAL usable for wide registers: build up the value field by field in software, then commit it in one transaction, which matches how a real driver would behave anyway.

The distinction breaks down if a test writes via `write()` and then reads the desired value expecting it to reflect what hardware now holds after some side effect, a write-1-to-clear bit, say. Desired reflects intent at the moment of the call. It doesn't track what happens to the value afterward inside the hardware. Mirrored is supposed to do that, and even mirrored only gets it right if the model knows about the side effect in the first place, which is what access types ([article 02](../register-access-types)) and volatility, covered later in this series, are for.

## Adapters: translating between RAL and the bus

RAL has no idea what bus protocol sits underneath it. The `uvm_reg_adapter` handles the translation: `reg2bus()` converts a generic `uvm_reg_bus_op` into whatever sequence item the driver consumes, an `axi_write_item`, an `apb_transfer`, whatever the agent expects. `bus2reg()` does the reverse for reads. Write the adapter once per protocol and every register behind that protocol reuses it. Swap the interconnect, write a new adapter, and the register-level tests above it don't need to change.

```systemverilog
class axi_reg_adapter extends uvm_reg_adapter;
  `uvm_object_utils(axi_reg_adapter)

  function uvm_sequence_item reg2bus(const ref uvm_reg_bus_op rw);
    axi_write_item item = axi_write_item::type_id::create("item");
    item.addr  = rw.addr;
    item.data  = rw.data;
    item.write = (rw.kind == UVM_WRITE);
    return item;
  endfunction

  function void bus2reg(uvm_sequence_item bus_item, ref uvm_reg_bus_op rw);
    axi_write_item item;
    $cast(item, bus_item);
    rw.data = item.data;
    rw.kind = item.write ? UVM_WRITE : UVM_READ;
    rw.status = UVM_IS_OK;
  endfunction
endclass
```

## Predictors: keeping the mirror honest

A `uvm_reg_predictor` watches bus traffic, typically by subscribing to the monitor's analysis port, and calls `predict()` on the relevant register whenever it observes a transaction that should update the mirrored value. This is what lets the mirrored value track writes that didn't originate from a RAL `write()` call: a firmware sequence hammering the bus directly, or a virtual sequence issuing raw bus transactions for a corner-case timing test. Without a predictor wired up, the mirrored value only reflects RAL-initiated traffic, and any test mixing RAL access with raw bus traffic sees mirror/hardware mismatches that have nothing to do with an actual bug. The model simply never heard about the write.

```systemverilog
// connecting the predictor to the real bus monitor is what
// makes non-RAL traffic visible to the mirrored value
predictor.map     = reg_block.get_default_map();
predictor.adapter = axi_adapter;
monitor.ap.connect(predictor.bus_in);
```

Worth checking explicitly in any new register environment: is the predictor connected to the actual bus monitor, or only exercised by tests that happen to go exclusively through RAL? The gap stays invisible until a test mixes access styles, and by then it looks like a hardware bug rather than a wiring gap.

## Where this is going

Everything above assumes a register behaves predictably. Write a value, read it back, get the same value. Most registers don't. The next article covers the access-type field RAL uses to decide what "predictably" even means for a given register, and why treating it as one axis instead of two is where a lot of register test plans go wrong.

---

*Next: [Register Access Types Aren't Symmetric](../register-access-types)*
