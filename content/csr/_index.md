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

## Published

{{< section-cards >}}
