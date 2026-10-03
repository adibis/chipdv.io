---
title: "CSR Verification"
weight: 2
description: "A practical series on verifying control and status registers with UVM RAL, beyond what the built-in sequences catch, and the patterns real SoC projects need."
icon: key
image: /images/csr/01-ral-dataflow.svg
imageAlt: "RAL data flow between desired value, mirrored value, and the DUT"
cascade:
  type: docs
---

The UVM register abstraction layer ships with a handful of built-in sequences and a reasonable default model for how registers behave. That gets a project most of the way to a working register test plan, and it quietly leaves out the parts that actually find bugs: access types that don't behave the way `reg_bit_bash` assumes, registers whose value changes without any software write, parallel access through a shared bridge, and the scale problem of keeping a growing list of legitimate exceptions maintainable across a hundred blocks.

This series is about the parts of CSR verification that don't show up in the UVM Cookbook. Each article is self-contained but builds toward a complete, opinionated register verification methodology.

## The register model

{{< cards cols="3" >}}
  {{< card link="/csr/ral-fundamentals/" title="UVM RAL Fundamentals" subtitle="The register model, frontdoor vs backdoor access, mirrored vs desired value, and what adapters and predictors are actually for." >}}
  {{< card link="/csr/register-access-types/" title="Register Access Types Aren't Symmetric" subtitle="RO, RW, W1C, W1S, RC, RS, and the rest: why hardware access and software access are two different questions that can disagree." >}}
  {{< card link="/csr/ral-generation/" title="RAL Generation in Practice" subtitle="Nobody hand-writes register models anymore. Generating from a spec source of truth, and keeping custom hooks alive across regeneration." >}}
{{< /cards >}}

## Where the built-in sequences fall short

{{< cards cols="3" >}}
  {{< card link="/csr/builtin-sequence-limits/" title="What the Built-in Sequences Actually Test" subtitle="reg_hw_reset, reg_bit_bash, reg_access: what they catch, and the access types where they quietly pass over the bug." >}}
  {{< card link="/csr/volatile-registers/" title="Volatile Registers and the Predictor Problem" subtitle="Registers that change value without a software write, and the race that shows up between a hardware update and a predictor's mirrored value." >}}
{{< /cards >}}
