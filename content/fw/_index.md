---
title: "Firmware Verification"
weight: 5
description: "The firmware-on-RTL problems that only show up at multi-core and regression scale: races existing debug tools can't localize, a message-ID logging scheme built to replace UART streaming, and what survives the jump to emulation, post-silicon, and SoC integration."
icon: terminal
image: /images/fw/06-uvm-decode-and-payoff.svg
imageAlt: "Firmware writes a 32-bit message ID to a fixed memory location per core; a UVM monitor decodes it back into uvm_info/uvm_error"
cascade:
  type: docs
---

Most firmware-on-RTL debug advice stops at "add some prints and rerun." That holds up for a single core running a single directed test. It stops holding up the moment the failure is a race that needs contention to manifest, the regression runs on eight cores in parallel, and the printf you just added changes the timing enough to make the bug disappear on the next run.

This series is about the parts of firmware verification that only get hard at scale: three mechanically different flavors of timing bug that standard PC-trace debugging can't localize, a message-ID logging scheme that replaces character-streaming UART output (built out of a technique first presented at SNUG Silicon Valley 2025), the practical tricks that make firmware-in-the-loop simulation survivable, and what happens to all of it once the same firmware has to run on emulation, actual silicon, or a different integration level than it was written for.

## Published

{{< section-cards >}}
