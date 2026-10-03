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

## Three races that only show up at scale

{{< cards cols="3" >}}
  {{< card link="/fw/multicore-scheduling-bugs/" title="The Races That Only Show Up at Full Occupancy" subtitle="A firmware regression that fails once every few hundred runs, only with all eight cores loaded, and never in the single-core directed test written to chase it." image="/images/fw/01-full-occupancy-race.svg" alt="A race window in a shared descriptor ring that only closes incorrectly under real multi-core contention" >}}
  {{< card link="/fw/interrupt-isr-races/" title="The Same-Core Race: ISR Versus Mainline" subtitle="A single core, no other core in sight, and firmware still corrupts its own state, because an interrupt landed at exactly the wrong instruction." image="/images/fw/02-interrupt-isr-races.svg" alt="An ISR firing inside a mainline function's read-modify-write window and silently losing an update" >}}
  {{< card link="/fw/power-gating-vs-fw-latency/" title="When Hardware Sleeps but Firmware Is Awake" subtitle="Power-gating hardware transitions in nanoseconds; firmware's save/restore takes microseconds. A wake event in that gap is a real post-silicon hang class." image="/images/fw/03-power-gating-vs-fw-latency.svg" alt="A wake event landing inside firmware's multi-step save routine before power-gating completes" >}}
{{< /cards >}}

## Debugging without disturbing the timing

{{< cards cols="3" >}}
  {{< card link="/fw/debug-infrastructure-is-part-of-the-bug/" title="Your Debug Infrastructure Is Part of the Bug" subtitle="Instrumenting a suspected multi-core race with print statements changes the exact timing it depends on, worth knowing before reaching for a faster UART." image="/images/fw/04-probe-effect.svg" alt="Character-by-character UART logging forcing a cross-core lock that changes the race it's meant to observe" >}}
  {{< card link="/fw/encoding-messages-as-data/" title="Turning a Debug Message Into 32 Bits" subtitle="Encoding severity, core, file, and line into a single fixed-width identifier, using variadic C macros that never put the message string in the firmware image." image="/images/fw/05-message-id-encoding.svg" alt="A 32-bit message identifier packed from severity, core ID, argument count, and file and line" >}}
{{< /cards >}}
