---
title: "The Same-Core Race: ISR Versus Mainline"
weight: 2
date: 2026-07-21
publishDate: 2026-07-21
draft: false
description: "A single core, no other core in sight, and firmware still corrupts its own state, because an interrupt landed at exactly the wrong instruction."
prev: /fw/multicore-scheduling-bugs
next: /fw/power-gating-vs-fw-latency
---

[Article 01](../multicore-scheduling-bugs) needed two cores contending for the same cache line to produce a bug that a single-core test could never see. This one is the opposite failure mode: a single core, running completely alone, still loses data, because the thing racing against mainline code isn't another core, it's that same core's own interrupt handler. A driver's receive-ring index gets updated twice for one packet, or a status flag mainline just checked as clear reads set two instructions later, and the postmortem finds exactly one core involved the entire time. Multi-core tests didn't catch it because it isn't a multi-core bug, and single-core tests didn't catch it because the failure needs an interrupt to land at one specific instruction boundary out of thousands, which most runs simply don't hit.

## Temporal contention instead of spatial contention

[Article 01](../multicore-scheduling-bugs)'s race needed two cores to be physically doing something at the same moment, spatial contention on a shared cache line. This race needs one core's instruction stream to be interrupted at exactly the wrong point, temporal contention within a single sequential execution. An ISR can preempt mainline code at essentially any instruction boundary firmware hasn't explicitly masked, which means any non-atomic read-modify-write sequence touching data the ISR also touches is vulnerable, with zero other cores anywhere in the picture:

```c
/* Illustrative: mainline advances the ring's write index; the receive ISR
 * does the same thing on packet arrival. Both run on core 0. */
volatile uint32_t rx_write_idx;  /* volatile stops the compiler from caching
                                   * this in a register; it does nothing to
                                   * stop an ISR from preempting mid-RMW */

void mainline_process_next_slot(void) {
  uint32_t idx = rx_write_idx;   /* read */
  consume_slot(idx);
  rx_write_idx = idx + 1;        /* write - ISR landing between read and
                                   * write here silently loses its own
                                   * increment when mainline's write commits */
}

void rx_isr(void) {              /* can preempt the above at any point */
  rx_write_idx = rx_write_idx + 1;
}
```

If `rx_isr` fires after mainline's read but before mainline's write, mainline's write silently overwrites whatever the ISR just did, and one received packet's index update vanishes. Neither function is wrong in isolation. The bug only exists in the interleaving, and that interleaving depends entirely on when a packet happens to arrive relative to which instruction mainline is currently executing, something no amount of single-threaded code review will surface, because both functions read correctly on their own.

## A second flavor: the interrupt controller's own race

A subtler version of the same problem lives one layer down, in the handshake between the core and the interrupt controller itself, not in firmware's own data structures. When firmware updates its own interrupt priority mask, there is a real window where the core's view of "what priority am I now running at" and the interrupt controller's view can be transiently inconsistent: the core issues the priority update, and if the controller dispatches a pending interrupt using the old priority before the update is actually received and applied, the wrong interrupt runs at the wrong priority for one dispatch. This isn't a hypothetical: distributed interrupt priority races of exactly this shape are documented in real controller designs, and academic work on [automatic detection of races in interrupt-driven embedded software](https://arxiv.org/pdf/2305.17869) treats them as a distinct category from plain reentrancy bugs for the same reason worth repeating here, both sides of the race, core and controller, believe they're doing the right thing with the information they had at the time they acted on it.

## Why single-core coverage doesn't rule this out

The uncomfortable property of both flavors is that a single-core test *does* exercise the vulnerable code paths, mainline runs, the ISR runs, nothing about the test needs a second core. What it needs is the ISR to fire during the few-instruction window where mainline's read-modify-write is incomplete, and whether that happens is a function of exactly when the triggering event (a packet arrival, a timer tick, a DMA completion) lands relative to the current instruction, which is itself a function of bus timing, other traffic, and scheduling jitter nobody directly controls. A regression can run the same test a thousand times and never once get an interrupt to land inside a four-instruction window, then hit it on the thousand-and-first run for reasons that have nothing to do with anything the test itself varied.

That's a fundamentally different tooling requirement than [article 01](../multicore-scheduling-bugs)'s race. [Article 01](../multicore-scheduling-bugs)'s fix was cheap, always-on logging, because the bug needed to be *observed*, and once observable across enough regression runs, the interleaving eventually shows up in the logs on its own. This race needs to be *provoked*: a way to force an interrupt to land at a specific instruction, or at least bias the odds heavily enough that it stops being a thousand-run-average event. That means a testbench-side interrupt injector that can trigger on a specific PC value or instruction count rather than waiting for real traffic timing to line up, deliberately firing the ISR mid-sequence in a directed test instead of hoping a regression eventually reproduces it by chance. Static and dynamic race-detection techniques built for interrupt-driven embedded software take a related but offline approach: modeling which mainline/ISR instruction pairs could ever be adjacent given the interrupt's priority and the code's own masking, and flagging the unsafe pairs without ever needing to actually hit the window at runtime.

![A single core's instruction stream showing two runs of the same mainline function: one where the receive ISR fires outside the read-modify-write window and the update is safe, one where it fires between the read and the write and the ISR's own update is silently lost](/images/fw/02-interrupt-isr-races.svg)

Neither flavor of this bug shows up in the message-ID logging this series builds starting a few articles from now, at least not by observation alone, the same way [article 01](../multicore-scheduling-bugs)'s race eventually does. Cheap logging tells you a corruption happened and roughly when. Proving *why*, for a same-core temporal race, needs the interleaving itself to be forced or modeled, not just watched for.

---

*Next: [When Hardware Sleeps but Firmware Is Awake](../power-gating-vs-fw-latency) — a third flavor of timing bug, this time between a hardware state machine and firmware's own execution latency.*
