---
title: "When Hardware Sleeps but Firmware Is Awake"
weight: 3
date: 2026-08-12
publishDate: 2026-08-12
draft: false
description: "Power-gating hardware transitions in nanoseconds; firmware's save/restore takes microseconds. A wake event in that gap is a real post-silicon hang class."
prev: /fw/interrupt-isr-races
next: /fw/debug-infrastructure-is-part-of-the-bug
---

A production board hangs coming out of a low-power state, roughly once per few thousand sleep cycles, with no consistent trigger anyone can name. It never reproduces on the bench with a scope attached, because attaching a debugger changes exactly the timing that produces it. This is a third flavor of timing bug distinct from both of this series' first two: not two cores contending for a cache line, not an ISR landing mid-sequence on the same core, but a race between hardware and firmware operating at two entirely different timescales, and it's one of the most common failure classes that survives block-level verification and only shows up on real silicon.

## Two timescales that were never supposed to meet

Modern power-gating hardware is built to transition a domain to off in a handful of clock cycles, nanoseconds, once triggered, because the entire point of aggressive power gating is not wasting energy waiting around. Firmware's side of the same transition, saving processor context, flushing dirty cache lines out to memory before the domain that backs them loses power, clearing and re-arming wake sources, writing a "ready to sleep" acknowledgment, takes microseconds: thousands of clock cycles of actual instruction execution. The exact ratio depends on process and routine, but a gap on the order of three decimal orders of magnitude between the two is typical, and that gap itself, not any specific number, is the problem. If a wake event, an incoming packet, a button press, a peer core's inter-processor interrupt, arrives while firmware is midway through that multi-step sequence, and hardware has already begun (or worse, completed) part of the power-down transition, the system can end up with partially saved context, a domain that's already lost power underneath firmware that assumed it still had a few more instructions to run, or a wake interrupt delivered to a core that's mid-transition and structurally can't service it. None of that is a logic bug in either the power-gating state machine or the firmware save routine, taken separately. Both do exactly what they were built to do. The bug is only in what happens when their two timescales overlap.

```c
/* Illustrative: firmware's side of a sleep transition. Every line here is
 * a window where a wake event can arrive while the domain is partway
 * through physically transitioning underneath it. */
void enter_low_power(void) {
  save_processor_context();     /* window 1: wake event mid-save */
  flush_relevant_cache_lines(); /* window 2: HW may already be gating
                                  * the domain these lines belong to */
  arm_wake_sources();           /* window 3: a source can fire before
                                  * it's actually armed -- arming this
                                  * late, not earlier in the sequence,
                                  * is itself a choice that widens the
                                  * window; arming first would shrink
                                  * it, at the cost of handling a wake
                                  * source firing before save even starts */
  WRITE32(PWR_HANDSHAKE_REG, READY_TO_SLEEP);
  /* only after this point should hardware be allowed to cut power -
   * if the state machine doesn't actually wait for it, none of the
   * above windows are closed by this line existing */
}
```

## Why block-level verification almost never sees it

A block-level power-domain testbench typically verifies each side in isolation: does the power-gating state machine sequence correctly given a trigger, does firmware's save routine execute correctly given uninterrupted time to run. Both pass, routinely, because neither test ever puts a wake event inside the other side's window. The bug is emergent from the composition of two components that are each individually correct, which is exactly the category of bug that isolated block-level tests are structurally unable to produce, no matter how thorough the block-level plan is. It takes an SoC-level environment where a real wake source can fire asynchronously relative to firmware's actual save-routine progress, and even then, hitting the specific narrow-window collision by chance is roughly as unlikely as [article 02](../interrupt-isr-races)'s ISR race landing on the exact right instruction: technically reachable, practically almost never sampled by undirected random traffic.

## Building a collision testbench on purpose

The fix looks like [article 02](../interrupt-isr-races)'s interrupt injector, generalized to power state: instead of waiting for a wake event to collide with the save routine by chance, build a testbench agent that can trigger the wake event at a controlled, swept phase of firmware's save-routine execution, and run the sweep across every window that matters rather than hoping regression traffic eventually samples one. The cleanest way to define "phase" precisely is to reuse a message-ID logging mechanism a later article in this series builds: a lightweight `C_MSG` macro that emits a compact identifier onto an always-on trace path cheap enough to leave running for the life of the regression, built for exactly this kind of instrumentation. Tag the save routine's key transition points, right after `save_processor_context()`, right after the cache flush, right before the handshake write, with a `C_MSG` call each. A testbench-side monitor, covered in the same later article, already watches for those identifiers; extending it to trigger a wake event N cycles after observing a specific tagged checkpoint turns "hope a collision happens" into "assert the collision at exactly the boundary we want to stress," one boundary at a time, directed rather than random.

![Hardware's power-gating state machine transitioning a domain to off in a handful of cycles while firmware's multi-step save routine is still mid-sequence, with a wake event landing in one of three vulnerable windows between save, flush, and the ready-to-sleep handshake](/images/fw/03-power-gating-vs-fw-latency.svg)

## What a robust handshake actually requires

The durable fix isn't faster firmware, a gap of that size is not one firmware can close by being more efficient. It's making the handshake itself authoritative: hardware must not be allowed to physically cut power until it has observed firmware's explicit ready acknowledgment, not a fixed timeout that assumes firmware is usually done by then. And firmware's save sequence needs to be written to tolerate being interrupted by its own wake sources mid-sequence, the same sense of "reentrant" as a signal handler that has to cope with firing again before it returns, able to detect and safely handle a wake event arriving mid-save rather than assuming it owns an uninterrupted window, since the interrupt injector above exists specifically to prove that assumption false before silicon does. Both properties are cheap to state and easy to violate by accident, which is why this failure class keeps reaching production: nobody sets out to build a save routine that isn't reentrant, and nobody sets out to build a state machine that doesn't wait for the handshake, and yet the combination is what a directed collision test exists to catch before a customer's board does.

---

*Next: Your Debug Infrastructure Is Part of the Bug — why naive logging perturbs all three of these races the same way.*
