---
title: "Reset Dispatch End to End: Virtual Sequence to Per-Core Reset"
weight: 5
date: 2026-09-10
publishDate: 2026-09-10
draft: false
description: "Article 04 stopped at two sub-environments and a translated enum. Here's the same dispatch three levels deep, from the virtual sequence that triggers it down to a per-core loop that has to make real decisions."
prev: /reuse/hierarchical-reset-dispatch
next: /reuse/reset-driver-override
---

[Article 04](../hierarchical-reset-dispatch) established the shape: `chiplet_env.reset(kind)` translates its own vocabulary into each sub-environment's, and that translation is chiplet-level knowledge the sub-environments never see. What it didn't show is where the call comes from in the first place, or what happens when one of those sub-environments isn't a single block but a set of identical, repeated instances, cores, lanes, channels, whatever the DUT happens to replicate. Both gaps matter in practice: something has to actually trigger `chiplet_env.reset()`, and "fan out to N identical children" is a genuinely different problem from "fan out to two differently-typed children," with its own failure modes that a two-sub-environment example never has to confront.

## Where the call comes from

`chiplet_env.reset()` doesn't call itself. In a real regression it's driven from a virtual sequence, the same way any other mid-sim scenario is:

```systemverilog
class top_mid_sim_reset_vseq extends uvm_sequence;
  `uvm_object_utils(top_mid_sim_reset_vseq)
  `uvm_declare_p_sequencer(top_virtual_sequencer)

  task body();
    starting_phase.raise_objection(this, "mid-sim chiplet reset");
    p_sequencer.chiplet_env_h.reset(CHIPLET_WARM);
    starting_phase.drop_objection(this, "mid-sim chiplet reset");
  endtask
endclass
```

`p_sequencer.chiplet_env_h` is a plain component handle, set once on the virtual sequencer during `connect_phase`, the same way a virtual sequencer typically gets handles to the sequencers underneath it. The objection is raised once, here, for the entire duration of the cascade that follows, not re-raised at every level the call passes through. That's a deliberate choice: `chiplet_env.reset()` and everything it calls are plain tasks, not phase methods, so they have no phase handle of their own to raise an objection against. Threading one down through every level just to raise and drop it repeatedly would be more machinery than the problem needs. One objection, held by the thing that actually knows the scenario is in progress, covers the whole call chain underneath it correctly.

## The cascade, one level deeper

[Article 04](../hierarchical-reset-dispatch) stopped at `sub_env0` and `sub_env1`. A real chiplet usually has more than two children, and at least one of them is rarely a single instance:

```systemverilog
task chiplet_env::reset(chiplet_reset_kind_e reset_kind);
  case (reset_kind)
    CHIPLET_COLD: begin
      sub_env0.reset(SUB_ENV0_BLOCK_RESET);
      sub_env1.reset(SUB_ENV1_FULL_RESET);
      sub_env2.reset(SUB_ENV2_CORE_RESET);
    end
    CHIPLET_WARM: begin
      sub_env0.reset(SUB_ENV0_BLOCK_RESET);
      sub_env1.reset(SUB_ENV1_DIGITAL_RESET);
      sub_env2.reset(SUB_ENV2_CORE_RESET);
    end
  endcase

  chiplet_reset_coordinator.announce_reset(reset_kind.name());
endtask
```

`sub_env2` owns the chiplet's core cluster. Its own reset-kind enum has exactly one value today, `typedef enum { SUB_ENV2_CORE_RESET } sub_env2_reset_kind_e;`, because this chiplet has no scenario yet where a core-level reset needs to distinguish anything finer, the same reasoning [article 04](../hierarchical-reset-dispatch) uses for `sub_env0`. What's different is what `sub_env2.reset()` actually has to do once it's called.

## Where it bottoms out: fan-out to identical children, not a translation

`sub_env0` and `sub_env1` each own one thing. `sub_env2` owns `MAX_CORE_ID` identical cores, and "identical" is doing real work in that sentence: there's no per-core vocabulary to translate, because every core means the same thing by "reset." The decisions that matter here are different from anything [article 04](../hierarchical-reset-dispatch) had to make.

`join_none` is what makes the per-core resets actually run in parallel: the `foreach` loop only starts each one and moves on to the next, rather than blocking on it. A `fork ... join` inside the same loop would still be launching N processes, but it would wait for each one to finish before starting the next, serializing exactly what this branch exists to parallelize.

```systemverilog
task sub_env2::reset(sub_env2_reset_kind_e reset_kind);
  case (reset_kind)
    SUB_ENV2_CORE_RESET: begin
      if (cfg.parallel_core_reset) begin
        // opt-in only, and only if the DUT's reset controller genuinely
        // supports N simultaneous per-core reset requests. Most don't:
        // a shared PLL or reset-arbitration FSM, or an IR-drop/thermal
        // budget that assumes cores don't all switch at once, are common
        // reasons a real design can't absorb this and needs sequential
        foreach (resettable_core_list[i])
          fork
            begin
              // automatic, not static: without it every branch shares the
              // same loop variable and could see whatever index the loop
              // has reached by the time it actually runs, not the one it
              // was forked for
              automatic int core_id = resettable_core_list[i];
              reset_one_core(core_id);
            end
          join_none
        wait fork;   // waits for every outstanding descendant process of
                      // sub_env2::reset(), not just this loop's forks --
                      // safe here only because nothing else forks anything
                      // from inside this task; a version of this task that
                      // ever gained another unrelated fork would need
                      // explicit process handles instead of a bare wait fork
      end else begin
        foreach (resettable_core_list[i])
          reset_one_core(resettable_core_list[i]);
      end
    end
  endcase
endtask

task sub_env2::reset_one_core(int core_id);
  ctl_vif.apply_reset(core_id);
  regmodel.core[core_id].reset();
  scoreboard.reset(SUB_ENV2_CORE_RESET);
endtask
```

`resettable_core_list` is built once, during configuration, as every core ID except `BOOT_CORE_ID`. The boot core is excluded deliberately, not forgotten: in this design, cores 1..N wait on the boot core's own boot handshake before they're doing anything a reset could safely interrupt, and debug/JTAG access routes through it. Resetting it independently, in the middle of a scenario where other cores depend on state it owns, isn't a case this loop is built to handle, and pretending otherwise by looping over every core uniformly would be modeling something the DUT's own boot sequence doesn't actually allow. Whether a given chiplet's boot core actually has this dependency is a fact to check against its reset specification, not something to assume either way; this example assumes it does, because that's the common case.

Sequential is the default because parallel release is a claim about what the DUT's reset controller can actually absorb -- a shared PLL, a reset-arbitration FSM, or an IR-drop/thermal budget that assumes cores don't all switch at once are common reasons a design can't take it -- not a style preference the testbench gets to make unilaterally. `cfg.parallel_core_reset` makes that claim explicit and opt-in, rather than baking an assumption about DUT capability into the shape of a `foreach` loop.

![sub_env2 fanning out chiplet_env's SUB_ENV2_CORE_RESET to every core except the boot core, sequential by default, each core's reset going through the vif via apply_reset(), then regmodel and scoreboard](/images/reuse/05-reset-dispatch-end-to-end.svg)

## `apply_reset()` is pin-timing hygiene, not a driver seam

`ctl_vif.apply_reset(core_id)` looks similar to what a later article's `reset_driver` builds, and it's worth being precise about why it isn't the same thing. That article's `reset_driver` exists because the *mechanism* changes across integration boundaries: a block-level test drives the vif directly, an SoC-level test has to go through a real power controller's registers instead, and `chiplet_env` needs to call through a swappable object so it doesn't need two versions of itself to handle both. `apply_reset()` here solves a narrower problem: it's a task on the interface itself that encapsulates the pin-level assert/hold/deassert timing, so that timing isn't copy-pasted at every call site that needs it. It never branches on integration level, and it never will, because the mechanism at this specific leaf, physically toggling a per-core reset line, doesn't change depending on where `sub_env2` is instantiated. If `sub_env2` itself ever gets reused somewhere its per-core reset needs to go through a register interface instead of a vif, that's the point where it needs its own `reset_driver`-shaped seam, the same pattern the driver-override article builds, applied one level lower. Nothing here should be read as an argument against that pattern; it's an argument that it belongs exactly where the mechanism actually varies, not at every call site that happens to touch hardware.

## What this doesn't model

Per-core reset in a real SoC is frequently CSR-driven, not vif-driven, through a power-domain controller managing independent per-core power gating, the same shape a later article covers at the chiplet level, just one level further down. This worked example doesn't build that: `sub_env2` here assumes it's instantiated somewhere `ctl_vif` is real, block or chiplet level, with no power controller RTL between it and the cores it resets. That's a real, common integration point this article is choosing not to model, not a claim that the CSR-driven version doesn't exist. A chiplet with genuinely independent per-core power gating would need `sub_env2` to hold a `reset_driver`-shaped handle of its own, swappable the same way `chiplet_env`'s is, the moment it's reused somewhere that assumption stops holding.

---

*Next: Reset Driver Override: vif at Block Level, CSR at SoC Level*
