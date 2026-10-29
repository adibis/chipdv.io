---
title: "Fixing UVM RAL and uvm_reg Bugs"
weight: 4
date: 2026-10-29
publishDate: 2026-10-29
draft: false
description: "Six uvm_reg and register-map exercises: uvm_mem's missing mirror state, predictor and mirror synchronization gaps, access-policy mistakes, and coverage sampling that silently never fires."
prev: /projects/brokenbench/uvm
next: /projects/brokenbench/learn
---

`uvm_reg` and register-map exercises: `uvm_mem`'s missing mirror state, predictor and mirror synchronization gaps, access-policy mistakes (W1C fields silently cleared by a generic `update()`), and coverage sampling that silently never fires.

### UVM Mem Needs a Shadow Model {#uvm-mem-needs-a-shadow-model}

{{< badge "write-from-scratch" >}} {{< badge "mem-model" >}}

**Extend uvm_mem so it catches a real address-decode corruption bug -- the base class keeps no record of what any address should currently hold.**

{{% details title="Full breakdown" closed="true" %}}

uvm_reg has a mirror: ask a field what it should currently read, and the register layer answers from its own tracked state. uvm_mem has no such thing -- it's a placeholder for an address range and nothing else. Every write/read just moves data across the bus layer, and the instant it's done, nothing in the base class remembers what any given address was last set to. If something needs to know whether a later read came back correct, that expected state has to be built by hand, keyed by address, from scratch.

uvm_mem does give you a real hook for this: `post_write(uvm_reg_item rw)` and `post_read(uvm_reg_item rw)` are both called automatically, from inside the base class's own do_write()/do_read() tasks, after every real access through this memory -- frontdoor or back, whatever map it came through. `rw.get_offset()` is the address; `rw.get_value(0)` is the data that was just written, or just read back. Override both (and add whatever member state you need) on `tracked_mem` so that:

1. A write at some address records what that address should read back as -- and that recorded value survives any number of *other* addresses being written in between, right up until a write actually lands on that same address again.
2. A read increments `match_count` if it returns the value last written to that same address, or `mismatch_count` otherwise -- and it's still `mismatch_count`, not something you silently drop, when the data legitimately doesn't match (that's the whole point: it means the bus actually returned something other than what was last written there).

Run this as shipped: it reports `match_count=0, want 4` -- the stub doesn't track anything at all. Target: after the exact access sequence below the checker marker runs, `match_count` must be 4 and `mismatch_count` must be 1 -- not merely nonzero. One of those five reads really does land on corrupted data (a real address-decode bug in the driver, not a bug in your checker), and your override has to be the thing that catches it.

Try it yourself: `make run EX=uvm_mem_needs_a_shadow_model` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/csr/uvm_mem_needs_a_shadow_model.sv).

{{% /details %}}

### Sample Fires Before the Mirror Updates {#sample-fires-before-the-mirror-updates}

{{< badge "write-from-scratch" >}} {{< badge "coverage" >}} {{< badge "mirror" >}}

**Override uvm_reg's own sample() hook correctly -- it runs before the mirror it would be tempting to read from has actually been updated.**

{{% details title="Full breakdown" closed="true" %}}

uvm_reg::sample() is a real hook, called automatically from inside the base class's own do_write()/do_read() -- but only once a map has auto-prediction turned on (`set_auto_predict(1)`, already done for you below the marker), and its default body is empty. A register-model generator builds the covergroup and wires sample() to it for you in the real world; by hand, nothing populates any coverage database at all until sample() is actually overridden.

The obvious-looking way to fill it in is to ask the field what it's currently worth -- `val.get_mirrored_value()`. That's wrong, and not for a subtle reason: sample() is called with the access's own `data` argument *before* do_predict() runs, every single time, for every access, frontdoor or back. The field's mirror you'd be reading from still holds whatever the *previous* access left it at. Override `sample(uvm_reg_data_t data, uvm_reg_data_t byte_en, bit is_read, uvm_reg_map map)` on `cov_reg` (and whatever member state it needs) so that:

1. Every real access to this register is recorded at all -- the stub below does nothing, so nothing ever gets counted.
2. What gets recorded is the value *this* access actually carried -- not whatever the field's own mirror happens to say at that moment, which is always one access behind.

`expected_q` is a queue of what each access, in order, actually carries -- already populated by the sequence below the marker before each write/read fires. Compare what `sample()` is told against the front of that queue: `match_count++` if they agree, `mismatch_count++` otherwise.

Run this as shipped: it reports `match_count=0, want 5` -- the stub never touches either counter. Target: after the exact sequence below the checker marker runs (four writes, then one read), match_count must be 5 and mismatch_count must be 0. A mirror-based implementation gets this wrong on every single write (mismatch_count=4) and only gets the trailing read right by coincidence (match_count=1) -- the mirror happens to have caught up to the last write's value by the time anything reads it back.

Try it yourself: `make run EX=sample_fires_before_the_mirror_updates` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/csr/sample_fires_before_the_mirror_updates.sv).

{{% /details %}}

### Write Updates the Mirror Even When Dropped {#write-updates-the-mirror-even-when-dropped}

{{< badge "write-from-scratch" >}} {{< badge "mirror" >}} {{< badge "best-practice" >}}

**Catch a write that silently never reaches hardware -- neither write()'s own status nor the register model's mirror can tell you that on their own.**

{{% details title="Full breakdown" closed="true" %}}

With auto-prediction on (already configured for you below the marker), uvm_reg::write() calls do_predict() once the bus transaction completes -- but do_predict() only looks at whether the transaction's own reported status came back UVM_IS_OK. It has no independent way to confirm the hardware actually did anything: a write that's silently dropped but still completes cleanly (no bus error, no timeout -- a stuck write-enable signal, a realistic hardware bug, not a contrived one) still gets predicted as a success, and the register model's mirror updates to match the value you *intended* to write, not whatever's actually sitting in hardware.

Write `write_verifier::verify_write(uvm_reg r, uvm_reg_map map, bit [7:0] data)` so that:

1. It performs the write through the register layer, same as any other frontdoor access.
2. It independently confirms the write actually landed -- not by trusting write()'s own status, and not by trusting `r.get_mirrored_value()` right afterward (do_predict() already updated it to the intended value regardless of what hardware did) -- the only way to really know is to read the register back through the bus and compare what actually comes back.
3. `confirmed_count` counts a write whose read-back matches; `dropped_count` counts one whose read-back doesn't -- and it's still `dropped_count`, not something silently ignored, when a write legitimately never reached hardware (that's the whole point of this check existing).

Run this as shipped: it reports `confirmed_count=0, want 3` -- the stub never actually checks anything. Target: of the four registers written below the marker, exactly one (register 2) has a stuck write-enable and never actually updates -- confirmed_count must be 3, dropped_count must be 1. Checking get_mirrored_value() instead of reading back gets this wrong for all four registers (confirmed_count=4, dropped_count=0) -- do_predict() predicts success from the transaction's reported status alone, which this specific hardware bug can't help but report as clean.

Try it yourself: `make run EX=write_updates_the_mirror_even_when_dropped` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/csr/write_updates_the_mirror_even_when_dropped.sv).

{{% /details %}}

### Predictor Needs the Monitor Wired In {#predictor-needs-the-monitor-wired-in}

{{< badge "predictor" >}} {{< badge "mirror" >}} {{< badge "analysis-port" >}}

**Wire up a uvm_reg_predictor -- in explicit-prediction mode, it's the only thing that ever updates the mirror, and "the fields look set up right" doesn't mean it's actually connected.**

{{% details title="Full breakdown" closed="true" %}}

`blk`'s map runs with auto-prediction off (`set_auto_predict(0)`, below the marker) -- a deliberate choice real testbenches make when something other than this register model's own write()/read() calls can also touch the DUT, and the mirror has to track reality from observed bus traffic instead of just trusting its own API calls. With auto-prediction off, calling `blk.r.write(...)` still genuinely writes through the bus -- but it does *not* touch the mirror at all. The only thing that can ever update it is a `uvm_reg_predictor` that's actually wired up: `.map` and `.adapter` set, *and* something feeding it real bus transactions through its `bus_in` analysis port.

`predictor` is already constructed for you (see `env::build_phase`, below the marker) -- an unconfigured, unconnected `uvm_reg_predictor#(reg_bus_item)` sitting there doing nothing. Finish wiring it up in `env::connect_phase`, below, so that:

1. `predictor.map` and `predictor.adapter` are set to the same map/adapter the bus itself uses.
2. `drv.ap` (the driver's own analysis port -- every access it completes gets broadcast there) is connected to `predictor.bus_in`.

Run this as shipped: it reports `mirror=0 after first write, want aa` -- setting .map/.adapter alone isn't enough either; the predictor's write() callback never even gets called until its bus_in import actually has something connected to it. Target: after each of two writes below the marker, blk.r.get_mirrored_value() must equal exactly what was just written. Leaving out either .map/.adapter or the bus_in connection leaves the mirror stuck at its reset value (0) forever, regardless of how many writes actually succeed on the bus.

Try it yourself: `make run EX=predictor_needs_the_monitor_wired_in` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/csr/predictor_needs_the_monitor_wired_in.sv).

{{% /details %}}

### Update Can Silently Clear a W1C Field {#update-can-silently-clear-a-w1c-field}

{{< badge "write-from-scratch" >}} {{< badge "w1c" >}} {{< badge "access-policy" >}}

**Enable a device through update() without silently clearing a real pending interrupt sitting in the same register.**

{{% details title="Full breakdown" closed="true" %}}

`ctrl_reg` packs two fields into one register: `enable` (plain RW) and `irq_pending` (W1C -- write 1 to clear, matching real hardware: a bus write with that bit set clears the real pending flag). `uvm_reg::update()` is supposed to be the convenient way to push only what you changed -- but it computes what to write for *every* field in the register, not just the one you touched. For a W1C field, that computation inverts whatever `desired` currently holds: `desired=0` becomes a write of 1 (assert clear). If `irq_pending` was never read first, its `desired` still sits at its reset default (0) -- not because anyone decided "clear this," but simply because nothing ever told the model otherwise. `update()` can't tell the difference, and silently clears a real, currently-pending interrupt nobody asked it to touch.

Write `enabler::enable_device(uvm_reg r, uvm_reg_field enable, uvm_reg_map map)` so that it enables the device (`enable` ends up set) *without* corrupting whatever `irq_pending` actually holds in hardware at the time. The fix is one extra call, in the right place, before anything else -- think about what has to happen before `desired` can be trusted to mean "leave this alone" for a field you never meant to touch.

Run this as shipped: it reports `enable=0, want 1` -- the stub does nothing at all yet. Target: after `enable_device` runs, a real frontdoor read-back of the register (below the marker) must show enable=1 *and* irq_pending=1 -- the device is on, and the interrupt that was genuinely pending before the call is still genuinely pending after it. Calling `enable.set(1)` then `r.update(...)` with no read in between gets enable=1 but irq_pending=0 -- it enables the device by silently acking an interrupt nobody touched.

Try it yourself: `make run EX=update_can_silently_clear_a_w1c_field` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/csr/update_can_silently_clear_a_w1c_field.sv).

{{% /details %}}

### Confirm Write Trusts the Mirror not the Bus {#confirm-write-trusts-the-mirror-not-the-bus}

{{< badge "predictor" >}} {{< badge "access-policy" >}} {{< badge "plausible-pass" >}}

**Confirm_write() checks the mirror right after the write that set it -- of course it always agrees.**

{{% details title="Full breakdown" closed="true" %}}

```
SPEC, per the register map doc, status_reg packs one byte into two fields:
  - cfg: bits [6:0], general configuration, RW.
  - lock: bit [7] -- "write 1 to lock permanently prevents further configuration changes until
    the next reset."
  - NOT settled by that sentence: does "further configuration changes" mean changes requested by
    a *later* write, or does locking take effect immediately enough to veto a cfg change riding
    in the very same transaction that sets the lock bit? reg_bus_driver (a separate file,
    compiled alongside this one) is the actual hardware behavior -- read it if you need to.
```

confirmer::confirm_write() below is exactly the kind of helper a model writes with total confidence when asked to prove a write landed as intended: with auto-prediction on (the default), r.write() sets the mirror directly from the data you handed it, before the bus transaction even happens, so checking the mirror right after your own write will always agree with what you just told it. Run this as shipped: it reports confirmed_count=3, flagged_count=0 -- every write "confirmed," including the ones that tried to change cfg and lock in the same transaction, and silently didn't change cfg.

Fix confirm_write() so it checks what the bus actually reports -- an actual frontdoor read, not the mirror -- against `expected`. Don't edit anything at or below the "checker" marker; it's correct as given and is what's judging you.

Try it yourself: `make run EX=confirm_write_trusts_the_mirror_not_the_bus` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/csr/confirm_write_trusts_the_mirror_not_the_bus.sv).

{{% /details %}}
