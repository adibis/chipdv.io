---
title: "Reset Driver Override: vif at Block Level, CSR at SoC Level"
weight: 6
date: 2026-10-28
publishDate: 2026-10-28
draft: false
description: "A block-level chiplet environment drives reset and clamp over the vif. Reused in an SoC, those calls need to go through the real power controller's registers."
prev: /reuse/reset-dispatch-end-to-end
next: /reuse/boundary-assertions-reset
---

[Hierarchical Reset Dispatch: Cold, Warm, Analog, Digital](../hierarchical-reset-dispatch) covers *when* and *what kind* of reset fires. This article is about *how* it actually gets applied to the DUT, and why that answer has to change depending on where the chiplet environment is running. A block-level test verifying a chiplet in isolation has no power controller RTL to go through, so it drives reset and clamp directly on the virtual interface. An SoC-level test integrating that same chiplet has a real power controller sitting above it, and driving reset over the vif directly would bypass the exact logic the SoC-level test exists to verify: that a CSR write to the power controller actually produces a correct reset and clamp sequence at the chiplet boundary.

## Two mechanisms, one call site

The environment code that decides *when* to reset, the `chiplet_env::reset()` dispatch from [Hierarchical Reset Dispatch: Cold, Warm, Analog, Digital](../hierarchical-reset-dispatch), shouldn't need two versions of itself depending on integration level. What needs two versions is the piece underneath it that actually asserts the signals. Splitting that out into its own object is what makes the rest of the environment, the dispatch logic, the scoreboard pause, the regmodel reset, identical at every level:

```systemverilog
virtual class reset_driver extends uvm_object;
  pure virtual task drive_reset(chiplet_reset_kind_e kind);
  pure virtual task drive_clamp(chiplet_reset_kind_e kind);
endclass
```

`chiplet_env` holds a handle to a `reset_driver` and calls through it, never touching a vif or a register directly itself:

```systemverilog
task chiplet_env::reset(chiplet_reset_kind_e reset_kind);
  driver.drive_reset(reset_kind);
  driver.drive_clamp(reset_kind);

  case (reset_kind)
    CHIPLET_COLD: begin
      sub_env0.reset(SUB_ENV0_BLOCK_RESET);
      sub_env1.reset(SUB_ENV1_FULL_RESET);
    end
    CHIPLET_WARM: begin
      sub_env0.reset(SUB_ENV0_BLOCK_RESET);
      sub_env1.reset(SUB_ENV1_DIGITAL_RESET);
    end
  endcase

  regmodel.chiplet_ctrl_block.reset();
  chiplet_scoreboard.pause = 1;
endtask
```

## The block-level driver

At block level, there's nothing upstream of the chiplet to issue a register write through, so the driver forces the interface directly, with whatever timing the chiplet's own reset specification requires:

```systemverilog
class vif_reset_driver extends reset_driver;
  `uvm_object_utils(vif_reset_driver)
  virtual chiplet_if vif;

  task drive_reset(chiplet_reset_kind_e kind);
    vif.reset_n <= 1'b0;
    repeat (16) @(posedge vif.clk);   // per chiplet reset spec
    vif.reset_n <= 1'b1;
  endtask

  task drive_clamp(chiplet_reset_kind_e kind);
    if (kind == CHIPLET_COLD) vif.clamp_en <= 1'b1;
  endtask
endclass
```

## The SoC-level driver

At SoC level, the same call needs to go through the actual power controller instead, using the register-triggered pattern [Wiring a Register-Triggered Domain Reset End to End](../register-triggered-reset-worked-example) already built:

```systemverilog
class csr_reset_driver extends reset_driver;
  `uvm_object_utils(csr_reset_driver)
  chiplet_pwr_ctrl_regmodel pwr_regmodel;

  task drive_reset(chiplet_reset_kind_e kind);
    uvm_status_e status;
    reset_intent_ext ext = reset_intent_ext::type_id::create("ext");
    ext.domain_name   = (kind == CHIPLET_COLD) ? "chiplet_full" : "chiplet_digital";
    ext.settle_cycles = (kind == CHIPLET_COLD) ? 200 : 40;
    pwr_regmodel.chiplet_reset_ctrl.write(status, kind, .extension(ext));
  endtask

  task drive_clamp(chiplet_reset_kind_e kind);
    uvm_status_e status;
    if (kind == CHIPLET_COLD)
      pwr_regmodel.chiplet_clamp_ctrl.write(status, 32'h1);
  endtask
endclass
```

![The same chiplet_env.reset() call routed through a vif-driving strategy at block level and a CSR-writing strategy at SoC level, converging on the same physical reset and clamp pins](/images/reuse/05-driver-override.svg)

`drive_reset()` doesn't toggle a pin itself here. It issues a register write and lets the real power controller RTL, and everything downstream of it, produce the pin toggle. That's the entire point of testing at this level: the block-level driver proves the chiplet behaves correctly given a reset. The SoC-level driver proves the path that's supposed to produce that reset in the first place actually does.

## Supplying the right driver without the environment choosing for itself

`chiplet_env` should never contain a conditional that asks "am I running at block level or SoC level" and picks a driver based on the answer. That question is answered entirely by whoever is instantiating and configuring the environment, using the factory override mechanism UVM already provides for exactly this:

```systemverilog
// block-level test: nothing to override, vif_reset_driver is the default
// chiplet_env::build_phase constructs it via reset_driver::type_id::create()

// SoC-level test, in build_phase, before chiplet_env is constructed:
set_type_override_by_type(vif_reset_driver::get_type(), csr_reset_driver::get_type());
```

`chiplet_env` itself always writes `driver = reset_driver::type_id::create("driver", this)`, never naming a concrete driver class directly. Which concrete class that call actually produces is decided entirely outside the environment, by whichever test configured the override, which is the same principle [Config Object Plumbing at SoC Scale](../config-object-plumbing) argues for configuration data, applied here to behavior instead: the reusable component declares what it needs through a type, and the integrator decides what that type resolves to.

---

*Next: [Boundary Assertions for Register-Triggered Reset](../boundary-assertions-reset)*
