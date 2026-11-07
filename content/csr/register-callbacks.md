---
title: "Register Callbacks in Depth"
weight: 8
date: 2026-11-06
publishDate: 2026-11-06
draft: false
description: "pre_write, post_write, pre_read, post_read, and the post_predict hook most articles skip: modeling side-effecting registers without duplicating waiver or volatility logic."
prev: /csr/waiver-manager
---

Access types ([Register Access Types Aren't Symmetric](../register-access-types)) describe how a single register behaves in isolation. They say nothing about a register whose write changes a different register's value, or a register whose read needs something to happen in hardware first. That's what `uvm_reg_cbs` is for, and it tends to be the piece of RAL infrastructure most projects reach for only after they've already been burned trying to hack the behavior in somewhere else first.

## The four hooks

A callback class extending `uvm_reg_cbs` can override four task hooks, each firing at a specific point relative to the actual bus transaction:

- **`pre_write`**: called before the write is issued, with the ability to modify the value about to be written. Useful for a register whose write needs transforming before it reaches the bus, such as forcing hardware-owned bits back to what they already hold.
- **`post_write`**: called after the write completes. With auto-prediction on, the register model has already updated its own mirror for that write by the time it runs.
- **`pre_read`**: called before a read is issued. Rare in practice, but useful if a read needs to trigger a hardware-side action before the value is sampled.
- **`post_read`**: called after a read completes, with the ability to modify the value returned to the caller. Again, with auto-prediction on, the mirror has already been updated.

![The four callback hooks relative to the underlying bus transaction: pre/post write, pre/post read](/images/csr/08-callback-timeline.svg)

That ordering matters for `post_read`. Changing `rw.value` there changes what the calling sequence sees, but not what the mirror recorded a moment earlier, so the two now disagree. Explicit prediction doesn't avoid it: the predictor records what was actually on the bus, not the edited value. That's occasionally what you want, and usually a bug.

## Which accesses actually fire them

This is the detail that trips up most callback code: those four hooks fire only for accesses the register model itself issues. `write()`, `read()`, `update()`, and `mirror()` all run them, frontdoor or backdoor. `poke()`, `peek()`, and `predict()` don't.

Neither does `uvm_reg_predictor`. With explicit prediction, the predictor watches bus traffic, turns each transaction back into a register access, and calls the register's `do_predict()` to update the mirror. It never calls `pre_write` or `post_write`. So any side effect modeled in `post_write` happens only when the testbench's own register sequences do the writing. It silently doesn't happen when the same register is written by firmware running on a CPU in the design, by a second bus master, or by a raw bus sequence that doesn't go through the register model. At SoC level that's most of the traffic.

`uvm_reg_cbs` has a fifth hook for exactly this case, and it's the one most callback articles skip: **`post_predict`**. It's a function, not a task, registered on a field rather than a register, and it fires every time that field's mirror is updated by a predicted read or write, whatever issued the access. The one condition is that something has to be doing the predicting: a `uvm_reg_predictor` connected to a bus monitor, which any environment that has firmware or other masters writing registers needs anyway, or the mirror is wrong for reasons no callback can fix.

```systemverilog
virtual function void post_predict(input uvm_reg_field  fld,
                                   input uvm_reg_data_t previous,
                                   inout uvm_reg_data_t value,
                                   input uvm_predict_e  kind,
                                   input uvm_door_e     path,
                                   input uvm_reg_map    map);
```

The rule that falls out of this: **side effects on the register model's own mirror belong in `post_predict`**, because the mirror needs to be right no matter who wrote the register. The four task hooks are for things that only make sense when the testbench is the one issuing the access: shaping the value it writes, or doing something on the bus before it reads.

## Three narrow callbacks

One callback class per behavior, each registered only on the register or field it describes. A single class overriding all four hooks and registered on four registers is a common shortcut, and it's wrong in a way that's easy to miss: every hook then fires for every one of those registers, so the masking meant for one register also mangles writes to the other three.

```systemverilog
// ctrl[31:28] are hardware-owned: whatever software tries to write there,
// put back what the mirror says they already hold.
class ctrl_hw_bits_cb extends uvm_reg_cbs;
  `uvm_object_utils(ctrl_hw_bits_cb)
  my_reg_block blk;

  function new(string name = "ctrl_hw_bits_cb");
    super.new(name);
  endfunction

  // rw.value is a dynamic array; a single-register access uses element 0.
  virtual task pre_write(uvm_reg_item rw);
    uvm_reg_data_t mirror = blk.ctrl.get_mirrored_value();
    rw.value[0][31:28] = mirror[31:28];
  endtask
endclass

// perf_count free-runs; a read is only stable if the latch strobe fires first.
class perf_latch_cb extends uvm_reg_cbs;
  `uvm_object_utils(perf_latch_cb)
  my_reg_block blk;

  function new(string name = "perf_latch_cb");
    super.new(name);
  endfunction

  virtual task pre_read(uvm_reg_item rw);
    uvm_status_e status;
    blk.perf_latch.write(status, 1, .map(rw.map), .parent(rw.parent));
  endtask
endclass

// int_clear.bits is write-only: writing 1s clears those bits in int_status.
// post_predict, so it also fires for firmware's writes, seen via the predictor.
class int_clear_cb extends uvm_reg_cbs;
  `uvm_object_utils(int_clear_cb)
  my_reg_block blk;

  function new(string name = "int_clear_cb");
    super.new(name);
  endfunction

  virtual function void post_predict(input uvm_reg_field  fld,
                                     input uvm_reg_data_t previous,
                                     inout uvm_reg_data_t value,
                                     input uvm_predict_e  kind,
                                     input uvm_door_e     path,
                                     input uvm_reg_map    map);
    if (kind != UVM_PREDICT_WRITE) return;
    void'(blk.int_status.pending.predict(
      blk.int_status.pending.get_mirrored_value() & ~value,
      .kind(UVM_PREDICT_DIRECT)));
  endfunction
endclass
```

Registration happens once, typically in the environment's `connect_phase` after the register block exists. Register-level hooks go through `uvm_reg_cb`, field-level ones through `uvm_reg_field_cb`. Both are typedefs of `uvm_callbacks` specialized for the object type the callback attaches to, and both take the object and a callback instance:

```systemverilog
ctrl_hw_bits_cb hw_bits = ctrl_hw_bits_cb::type_id::create("hw_bits");
perf_latch_cb   latch   = perf_latch_cb::type_id::create("latch");
int_clear_cb    clr     = int_clear_cb::type_id::create("clr");
hw_bits.blk = blk;
latch.blk   = blk;
clr.blk     = blk;

uvm_reg_cb::add(blk.ctrl, hw_bits);
uvm_reg_cb::add(blk.perf_count, latch);
uvm_reg_field_cb::add(blk.int_clear.bits, clr);
```

A few details in that code are load-bearing:

- **The explicit constructor.** `` `uvm_object_utils`` generates a factory `create()` that calls `new(name)`, so a callback class without a constructor taking a name doesn't compile.
- **`get_mirrored_value()`, not `get()`.** `get()` returns the desired value, what the model has been asked to write next. Masking against the mirror needs what the model believes the hardware holds now.
- **`void'()` around `predict()`.** `predict()` returns a success bit. Discarding it explicitly keeps the compiler from warning on every call.
- **`UVM_PREDICT_DIRECT` inside `post_predict`.** UVM only runs `post_predict` for read and write predictions, not direct ones, so setting `int_status` this way can't re-trigger another callback.
- **The latch write in `pre_read` reuses `rw.map` and `rw.parent`**, so it travels over the same map and appears under the same parent sequence as the read it's preparing for.

## Where callbacks earn their keep: side-effecting registers

The clearest case for a callback is a register whose write affects a register elsewhere in the model, behavior no access-type declaration on the written register can express, because the effect isn't on that register at all. A write-only `int_clear` register that clears the matching bits in a separate `int_status` register is a common example. The write to `int_clear` changes nothing readable in `int_clear` itself. What it changes is what `int_status` should read as next time software checks it. Without `int_clear_cb`, the mirror of `int_status` keeps the bits that were cleared in hardware, and the next mirror check fails against a correct design.

It's also why that callback is a `post_predict` and not a `post_write`. In a block-level environment where only the register sequences touch `int_clear`, `post_write` would appear to work. Move the same environment to SoC level, where the interrupt handler in firmware is what writes `int_clear`, and a `post_write` version never fires at all, because the predictor that sees firmware's write doesn't call it.

## Where callback logic should stop, and defer instead

It's tempting to turn a callback into a dumping ground for every piece of register-specific special-case behavior, including waiver checks and volatility handling. Resist that. A `pre_write` callback checking "is this register in the exclusion list" and skipping the transaction if so duplicates logic that already has a home in the waiver manager from [The Waiver Problem and a Scalable Waiver Manager](../waiver-manager). Now there are two places that need to agree on which registers are excluded, with no guarantee they stay in sync as the waiver files change. The waiver check belongs in the sweep sequence, gating whether a transaction is issued at all.

Same argument for volatility from [Volatile Registers and the Predictor Problem](../volatile-registers). A `post_read` callback widening an exact-match comparison into a range check for a volatile counter is solving a problem that belongs in the test's own scoreboard logic, not buried in a callback that every other test using that register inherits whether or not it fits what they're checking. Callbacks are for behavior that's a genuine, unconditional property of the register, a real side effect that happens every time, regardless of which test is running. The moment a callback's logic depends on which test is executing, or duplicates a decision another part of the infrastructure already owns, it's the wrong place for it.

## Updating another register's mirror

A callback that changes another register's mirrored value has to do it through that register's `predict()`, as `int_clear_cb` does. That's the supported way to set a mirror to a specific value without a bus access, and it's what keeps the change visible through the standard RAL interfaces and consistent with how the predictor from [UVM RAL Fundamentals](../ral-fundamentals) tracks mirror updates from every other source. Calling `set()` instead is a common mistake: it changes the desired value, not the mirror, so the mirror check that was supposed to pass still fails, and the next `update()` writes a value nobody asked for.

## Where and when: four scenarios that actually warrant one

The abstract rule, "a callback models behavior that belongs to the register, permanently," is easy to agree with and hard to apply without concrete cases in hand. Four that come up repeatedly in real environments:

**A CSR write that has to trigger something outside the register model entirely.** [The reuse series' worked reset example](/reuse/register-triggered-reset-worked-example) is the clearest case: writing a soft-reset register needs to quiesce a scoreboard, invalidate a predictor's mirrored values, and re-arm checking on a timer, none of which `uvm_reg` itself has any way to express. A callback is the mechanism that turns "this bit got written" into "the reset coordinator needs to hear about this." Which hook depends on who can write the register. If only the testbench's own sequences ever do, `post_write` works. If firmware can too, it has to be a `post_predict` on the reset field, and since `post_predict` is a function, it notifies the coordinator through an event or an analysis port rather than doing any time-consuming work itself.

**A control register that also gates isolation or clamp behavior.** A power-domain control register write that should force isolation cells to hold their last value while the domain is down is the same shape as the reset case: the register write is the trigger, but the actual effect, telling a monitor to expect frozen outputs instead of live ones, lives outside the register model. The callback connects "this bit pattern was written" to "the isolation checker needs to change what it expects," without every test that touches power management having to remember to make that connection by hand.

**A field whose write has a documented timing relationship to something on the DUT boundary, not just to another register.** If writing a clamp-enable bit is specified to assert a physical clamp pin within N cycles, kicking off that check is a callback's job, not something to bolt onto the sequence that happened to issue the write. Boundary Assertions for Register-Triggered Reset covers the assertion side of this in depth; the callback is what arms it at the right moment rather than leaving it running unconditionally against a pin that's supposed to be idle most of the time.

**Anything where the alternative is "remember to call this manually after that write."** This is the general form of all three cases above, and it's the actual test for whether a callback is the right tool: if the honest description of the correct testbench behavior is "after writing register X, someone needs to also do Y," Y belongs in a callback on X, not in a comment reminding every sequence author to do it themselves. Once that reminder lives in a callback instead of a code review checklist, it can't be forgotten.

What ties all four together, and what separates them from the callback misuse [covered earlier](#where-callback-logic-should-stop-and-defer-instead): in every case, the triggering write and the required reaction are genuinely, permanently coupled, true for every caller, not a property of which test happens to be running. That's the line. If the reaction only makes sense for some callers and not others, the information about which case applies belongs in an extension, not a callback, which is exactly the distinction Register Transaction Extensions draws from the other direction.

## What good callback design looks like in practice

Keep callbacks narrow: one clearly named class per distinct piece of cross-register or protocol-level behavior, registered explicitly on the register or field it describes. A callback modeling "writing `int_clear` clears bits in `int_status`" should be named and scoped to say exactly that, not folded into a general-purpose `misc_register_behavior_cb` that accumulates unrelated special cases over the life of the project until nobody can tell which registers it affects or why. And before writing any callback, ask who else can write that register. If the answer includes anything other than the testbench's own register sequences, the four task hooks won't see those writes, and the behavior belongs in `post_predict`.

---

*Next: Sequences vs. Assertions for Register Behavior*
