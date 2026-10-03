---
title: "SoC Reuse Patterns"
weight: 4
description: "The testbench architecture problems that show up specifically when a block-level environment has to survive being integrated into a subsystem and then a full SoC."
icon: puzzle
image: /images/reuse/04-reset-dispatch.svg
imageAlt: "Hierarchical reset dispatch from a chiplet env down to sub-envs with different reset vocabularies"
cascade:
  type: docs
---

Block-level verification environments get most of their design decisions validated fast, because a block-level test either works or it doesn't and the feedback loop is short. The decisions that were actually wrong don't show up until that same environment gets reused at subsystem or SoC integration, run for hours instead of minutes, and put through scenarios the block-level author never had to think about: a reset landing mid-transaction, a config field that silently reverts because it was read before it was set, a virtual sequence that assumed it owned the only master in the system.

This series is about that category of problem specifically: not register verification, not memory allocation, but the testbench architecture that either survives reuse or doesn't.

## Reset across a mid-regression event

{{< cards cols="3" >}}
  {{< card link="/reuse/mid-sim-reset-plumbing/" title="Mid-Sim Reset: Why UVM's Phase Model Doesn't Help" subtitle="Phases run once. A reset landing mid-regression isn't a phase boundary, and the framework has no built-in answer for what should happen next." image="/images/reuse/01-reset-coordinator.svg" alt="A reset coordinator firing ordered hooks where UVM's phase timeline has no representation for a mid-run reset" >}}
  {{< card link="/reuse/register-triggered-reset-worked-example/" title="Wiring a Register-Triggered Domain Reset End to End" subtitle="A full worked example: a soft-reset register write, a callback, a coordinator, and every component that needs to react before the domain comes back up." image="/images/reuse/02-reset-timeline.svg" alt="Timeline from a register write through callback, coordinator hooks, and re-arm" >}}
{{< /cards >}}

## SoC-scale config and reset dispatch

{{< cards cols="3" >}}
  {{< card link="/reuse/config-object-plumbing/" title="Config Object Plumbing at SoC Scale" subtitle="uvm_config_db works fine at block level and gets quietly fragile the moment a block is reused more than once in the same SoC." image="/images/reuse/03-config-path-mismatch.svg" alt="A block-level config path failing to match once the block is reused under a different instance name" >}}
  {{< card link="/reuse/hierarchical-reset-dispatch/" title="Hierarchical Reset Dispatch: Cold, Warm, Analog, Digital" subtitle="chiplet_env.reset(reset_kind) fans out to sub-environments that don't share the chiplet's vocabulary, and must get analog/digital right on the way down." image="/images/reuse/04-reset-dispatch.svg" alt="chiplet_env translating its own reset vocabulary into each sub-environment's own reset-kind enum" >}}
  {{< card link="/reuse/reset-dispatch-end-to-end/" title="Reset Dispatch End to End: Virtual Sequence to Per-Core Reset" subtitle="The same reset dispatch three levels deep: from the virtual sequence that triggers it down to a per-core loop that has to make real decisions." image="/images/reuse/05-reset-dispatch-end-to-end.svg" alt="A virtual sequence fanning reset out to every core except the boot core" >}}
{{< /cards >}}
