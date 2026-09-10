---
title: "Hierarchical Reset Dispatch: Cold, Warm, Analog, Digital"
weight: 4
date: 2026-08-27
publishDate: 2026-08-27
draft: false
description: "chiplet_env.reset(reset_kind) fans out to sub-environments that don't share the chiplet's vocabulary, and must get analog/digital right on the way down."
prev: /reuse/config-object-plumbing
next: /reuse/reset-dispatch-end-to-end
---

[Article 01](../mid-sim-reset-plumbing) covered a single domain resetting: one coordinator, one set of hooks, one thing quiescing and re-arming. A chiplet-level environment rarely has just one reset. It has a cold reset that power-cycles everything, analog included, and a warm reset that only touches digital logic and leaves PLLs and other analog state locked and running, because relocking a PLL from a cold start is expensive and most reset scenarios in a real regression don't need to pay for it. Getting this dispatch right, and getting it right at every sub-environment underneath the chiplet, is a different problem from the single-domain coordinator, because each sub-environment doesn't necessarily share the chiplet's own vocabulary for what "reset" means.

## Reset kinds are level-specific, not global

The instinct is to define one `reset_kind_e` enum, `COLD`, `WARM`, `BLOCK`, whatever the full set turns out to be, and pass it straight down through every level of the hierarchy. That works until a sub-environment's own idea of a reset doesn't map one-to-one onto the chiplet's. A digital sub-environment might only ever need to know `BLOCK_RESET` or `FULL_RESET`, having no concept of analog at all, while an analog-adjacent sub-environment needs `DIGITAL_RESET` and `FULL_RESET` as genuinely different things because only one of them touches its PLL. Forcing both sub-environments to consume the chiplet's single global enum means either bloating that enum with values most sub-environments will never see, or silently relying on convention to decide which values are safe to ignore. Neither survives reuse cleanly.

The pattern that does: each level defines its own reset-kind enum, scoped to what resetting actually means at that level, and the level above is responsible for the translation.

```systemverilog
// chiplet's own vocabulary
typedef enum { CHIPLET_COLD, CHIPLET_WARM } chiplet_reset_kind_e;

// sub_env0's vocabulary: this block has no analog content at all
typedef enum { SUB_ENV0_BLOCK_RESET } sub_env0_reset_kind_e;

// sub_env1's vocabulary: this block owns the PLL, so digital and
// full are genuinely different operations, not two names for the same thing
typedef enum { SUB_ENV1_DIGITAL_RESET, SUB_ENV1_FULL_RESET } sub_env1_reset_kind_e;
```

## The dispatch, and where the translation actually lives

```systemverilog
task chiplet_env::reset(chiplet_reset_kind_e reset_kind);
  case (reset_kind)
    CHIPLET_COLD: begin
      sub_env0.reset(SUB_ENV0_BLOCK_RESET);
      sub_env1.reset(SUB_ENV1_FULL_RESET);   // cold: analog and digital both reset
    end
    CHIPLET_WARM: begin
      sub_env0.reset(SUB_ENV0_BLOCK_RESET);
      sub_env1.reset(SUB_ENV1_DIGITAL_RESET); // warm: analog stays locked, untouched
    end
  endcase

  chiplet_reset_coordinator.announce_reset(reset_kind.name());
endtask
```

![chiplet_env.reset() translating its own two-value reset vocabulary into each sub-environment's own reset-kind enum, with sub_env1's analog content untouched on a warm reset](/images/reuse/04-reset-dispatch.svg)

The translation, deciding that `CHIPLET_WARM` means `SUB_ENV1_DIGITAL_RESET` rather than `SUB_ENV1_FULL_RESET`, is chiplet-level knowledge. `sub_env1` itself has no idea it's being warm-reset versus cold-reset from a chiplet perspective; it only knows it was asked to do a digital reset, which is the only vocabulary it actually owns. This is the same discipline [article 03](../config-object-plumbing) argues for config objects, applied to reset: the level doing the integrating is the level that understands the relationship between its own concepts and the concepts of whatever it's composing, and that knowledge shouldn't leak downward into components that don't need it.

## What the chiplet environment owes itself, not just its sub-environments

The sub-environment dispatch handles state that belongs to `sub_env0` and `sub_env1`. It says nothing about the chiplet environment's own state: its own regmodels, its own protocol checkers watching the chiplet-level interfaces, its own sequencers that might have a virtual sequence in flight when the reset fires, and its own scoreboard. All four are the chiplet environment's direct responsibility, independent of which reset kind fired or what either sub-environment does in response, and all four need to happen in a specific order for the same reason [article 01](../mid-sim-reset-plumbing) requires ordered passes: a checker that hasn't quiesced yet can flag a transaction the reset itself is about to abort as a protocol violation, and a scoreboard that clears before a monitor stops sampling can receive one more observation into a table that's already been reset out from under it.

This is the same `reset_coordinator` from [article 01](../mid-sim-reset-plumbing), registered with the chiplet's own components instead of a single domain's:

```systemverilog
function void chiplet_env::connect_phase(uvm_phase phase);
  chiplet_reset_coordinator = reset_coordinator::type_id::create("chiplet_reset_coordinator", this);
  chiplet_reset_coordinator.register(chiplet_axi_checker);
  chiplet_reset_coordinator.register(chiplet_apb_checker);
  chiplet_reset_coordinator.register(chiplet_vseqr_watcher);
  chiplet_reset_coordinator.register(chiplet_scoreboard);
  chiplet_reset_coordinator.register(chiplet_regmodel_resetter);
endfunction
```

Each registrant implements `pre_reset()`/`post_reset()` for exactly the piece of state it owns:

Every registrant extends the same `reset_aware_comp` base from [article 01](../mid-sim-reset-plumbing), whose `pre_reset()`/`post_reset()`/`watches_domain()` are all typed to the `string domain` the coordinator hands out, so the chiplet-level reset kind gets converted to a string once at the dispatch call site (`reset_kind.name()`, above) and every registrant checks it as a string like any other domain name:

```systemverilog
// protocol checkers: stop checking once the dispatch below has fired,
// so whatever settling activity a sub-environment's own reset leaves
// behind on the chiplet-level bus doesn't get flagged as a violation
// before post_reset() says it's safe to resume
class axi_boundary_checker extends reset_aware_comp;
  function bit watches_domain(string domain); return 1; endfunction  // every chiplet reset
  task pre_reset(string domain);
    checking_enabled = 0;
  endtask
  task post_reset(string domain);
    checking_enabled = 1;
  endtask
endclass

// virtual sequencer watcher: cooperative abort for anything mid-flight,
// the same pattern article 01 recommends over a hard kill()
class chiplet_vseqr_reset_watcher extends reset_aware_comp;
  function bit watches_domain(string domain); return 1; endfunction
  task pre_reset(string domain);
    -> reset_event;   // in-flight virtual sequences check this between steps
    wait (active_seq_count == 0);
  endtask
  task post_reset(string domain);
  endtask
endclass

// every regmodel the chiplet owns, not just one: invalidate mirrors,
// don't re-issue a hardware reset the DUT is already doing on its own
class chiplet_regmodel_resetter extends reset_aware_comp;
  function bit watches_domain(string domain); return 1; endfunction
  task pre_reset(string domain);
    regmodel.ctrl_block.reset();
    regmodel.perf_block.reset();
    regmodel.debug_block.reset();
  endtask
  task post_reset(string domain);
  endtask
endclass

// scoreboard: quiesce only after checkers are already quiet and
// sequences have drained, exactly the ordering article 01 argues for
class chiplet_scoreboard extends reset_aware_comp;
  function bit watches_domain(string domain); return 1; endfunction
  task pre_reset(string domain);
    pause = 1;
  endtask
  task post_reset(string domain);
    pause = 0;
  endtask
endclass
```

Registration order in `connect_phase` reads top to bottom as the actual quiescing order: checkers go quiet first, in-flight sequences drain next, regmodels invalidate their mirrors, and the scoreboard pauses last, once everything upstream of it has already stopped producing new observations. `post_reset()` runs in the same order in reverse effect, though not necessarily reverse call order, since [article 01](../mid-sim-reset-plumbing)'s coordinator already handles firing every `post_reset()` only after every `pre_reset()` has completed. None of this depends on which reset kind fired; a cold reset and a warm reset both need the chiplet's own checkers, sequencers, regmodels, and scoreboard handled identically, which is exactly why this lives outside the `case` statement and inside the coordinator instead.

## What this buys at the next level up

A package or SoC-level environment instantiating several chiplets doesn't need to know that `sub_env1` inside one of them distinguishes digital from full reset. It only needs to know the chiplet's own two-value vocabulary, `CHIPLET_COLD` and `CHIPLET_WARM`, and call `chiplet_env.reset()` with the kind that's appropriate for whatever scenario it's driving, package-level power-on sequencing, a warm reset triggered by a specific CSR write, whatever the scenario calls for. Every layer below that translates its own inputs into whatever vocabulary its own children actually need. Nobody at the SoC level ever needs to reach two levels down and know that one particular sub-block owns a PLL, which is exactly the kind of leaked internal detail that makes an environment expensive to reuse the moment its internals change.

---

*Next: [Reset Dispatch End to End: Virtual Sequence to Per-Core Reset](../reset-dispatch-end-to-end)*
