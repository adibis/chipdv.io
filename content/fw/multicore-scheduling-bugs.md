---
title: "The Races That Only Show Up at Full Occupancy"
weight: 1
date: 2026-07-07
publishDate: 2026-07-07
draft: false
description: "A firmware regression that fails once every few hundred runs, only with all eight cores loaded, and never in the single-core directed test written to chase it."
next: /fw/interrupt-isr-races
---

A firmware regression fails once every few hundred runs. The failure signature is the same each time: a packet descriptor comes back with a length field that doesn't match what any core wrote. Someone writes a single-core directed test that hammers the same descriptor ring as fast as possible, and it passes every time, for thousands of iterations. The bug is real, reproducible in the full regression, and completely absent from the isolated test built specifically to catch it. That gap is the entire problem this article is about: some firmware bugs only exist at full core occupancy, and a debug methodology built around single-core snapshots will never localize them, no matter how many times it's rerun.

## Why isolation makes the bug disappear

A single core writing to a shared descriptor ring, alone, executes the read-modify-write sequence on that descriptor's length field without anything else touching it between the read and the write. There's no window for another core's write to land in the middle. The bug isn't in the sequence itself, it's in what can happen to memory state *between* two instructions that the source treats as adjacent. That window only opens when a second core is actually contending for the same cache line at the same time, and contention is exactly what a single-core test, by construction, cannot produce. Adding more iterations to the single-core test doesn't help, because iteration count was never the missing variable. Core count was.

This generalizes past descriptor rings. Any shared mailbox register, any lock-free structure between cores, any "core A sets a flag, core B polls it" handshake has the same property: correctness depends on an interleaving of instructions from two or more cores, and that interleaving doesn't exist as a concept until at least two cores are actually running concurrently against the same memory.

## What actually varies run to run

Once a bug needs multi-core contention to manifest, the thing that makes it intermittent is that the exact interleaving isn't controlled by anything in the source code. Three separate effects are responsible, and they're easy to mistake for each other during triage:

**Compiler reordering.** A length field written in two half-word stores in the source can be reordered, combined, or interleaved with unrelated stores by the optimizer, as long as the reordering preserves the single-threaded semantics the compiler is required to honor. It says nothing about what a second core sees mid-sequence, because the compiler has no model of a second core.

**Cache and coherency timing.** Two cores each holding a line in a different coherency state resolve who "wins" a write based on the interconnect's actual arbitration and snoop timing that run, not on anything visible in either core's instruction stream. The same firmware image, same input, same seed, can resolve differently between two sim runs if anything upstream of the interconnect (bus load, other traffic, arbitration state left over from a prior transaction) differs even slightly.

**Scheduling jitter.** Whatever's determining when each core's firmware actually reaches the contended access, an RTOS scheduler tick, an interrupt landing at a slightly different cycle, a DMA completion firing earlier or later, shifts the two cores' relative arrival times at the shared resource. Most of the time that shift is harmless. Once every few hundred runs, it lines up two accesses inside the vulnerable window.

None of these three shows up by reading the C source. All three are properties of a specific execution, not of the code.

```c
/* Illustrative: core A's producer side of a shared descriptor ring.
 * The vulnerable window is between the length write and the valid-bit
 * write becoming visible to core B - two stores, no barrier between them. */
void ring_push(ring_desc_t *d, uint32_t len) {
    d->length = len;      /* window opens here */
    d->valid  = 1;         /* ...and closes here, IF this store is ordered
                            * after the one above from core B's perspective */
}
```

A single core running `ring_push()` in a tight loop never observes anything wrong, because nothing ever reads `d->length` between the two stores. The bug requires a second core's consumer to land its read of `d->length` in that exact window, which requires that core to be running at all, and requires the timing to line up, which is precisely what full-occupancy regression runs produce by accident and single-core directed tests cannot produce on purpose.

## Why PC-tracing and disassembly correlation are the wrong tool here

The standard toolbox for a firmware bug is built around a single core: halt at a PC, correlate against the disassembly, reason backward to the source line and the register state that got it there. That workflow answers "what was this core doing at this moment," which is exactly the right question for a deterministic crash, a bad pointer dereference, an assertion that fires the same way every time. It is the wrong question for a race, because a race isn't a property of one core's execution, it's a property of the *relative timing between two or more cores' executions*. Halting core A to inspect its PC tells you nothing about what core B was doing at that same moment unless the two views are captured together, correlated to the same time axis, across every core, for the entire window where the race could have landed.

Instruction tracers can technically capture that, per core, but the data volume scales with core count and run length in a way that makes it impractical to actually triage. A trace fine-grained enough to catch a single cache-line race across eight cores for an entire regression run is not something anyone reads end to end looking for the one interleaving that mattered. What's needed instead is a way to get a small number of precisely time-correlated, multi-core signals out of the firmware itself, cheaply enough to leave on for every regression run, not just the one where someone suspects a race and turns on full tracing after the fact. That's the actual requirement the rest of this series is answering.

![A single-core directed test never producing the interleaving that an eight-core regression run hits by chance, showing the vulnerable read-modify-write window in the shared descriptor ring only closing incorrectly under real contention](/images/fw/01-full-occupancy-race.svg)

---

*Next: [The Same-Core Race: ISR Versus Mainline](../interrupt-isr-races) — a second, mechanically different flavor of timing bug that needs the same kind of cross-context visibility.*
