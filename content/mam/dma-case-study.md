---
title: "Case Study: DMA Source/Destination Buffer Allocation"
weight: 5
date: 2026-09-08
publishDate: 2026-09-08
draft: false
description: "A worked example: aligned region requests, release timing, and the overlap and fragmentation bugs that show up in practice."
prev: /mam/ral-address-map-collisions
next: /mam/block-chiplet-soc-worked-example
---

The previous four articles built up the pieces: `uvm_mem_mam` as the allocator, a named registry so block, subsystem, and SoC-level code all draw from the same pool, and reservation against the RAL address map so allocated memory never collides with live registers. This article puts them together in the scenario that motivated the whole series: a DMA sequence that needs a source buffer and a destination buffer, requested, used, and released correctly.

![The DMA sequence lifecycle: request, build descriptor, transfer, verify, release, with release still required on every early-exit path](/images/mam/05-dma-lifecycle.svg)

## Requesting the regions

The sequence looks up the shared pool by name, exactly as described in [article 03](../singleton-wrapper), rather than constructing its own allocator:

```systemverilog
// 64-byte alignment matches this engine's burst size; uvm_mem_mam has no
// alignment argument on request_region(), so the constraint lives on a
// policy object instead, per article 02
class burst_aligned_policy extends uvm_mem_mam_policy;
  constraint c_64b_aligned {
    start_offset[5:0] == 6'b0;
  }
endclass

class dma_transfer_seq extends uvm_sequence;
  `uvm_object_utils(dma_transfer_seq)

  uvm_mem_region src_region, dst_region;

  task body();
    uvm_mem_mam pool = mam_registry::get().get_pool("dma_scratch");
    burst_aligned_policy pol = new();

    src_region = pool.request_region(1024, pol);
    dst_region = pool.request_region(1024, pol);

    if (src_region == null || dst_region == null)
      `uvm_fatal("DMA_SEQ", "pool exhausted or fragmented, see below")

    build_and_send_descriptor(src_region, dst_region);
    verify_transfer(src_region, dst_region);

    pool.release_region(src_region);
    pool.release_region(dst_region);
  endtask
endclass
```

Both regions come from the same call to `get_pool()`, so the same non-overlap guarantee covers all three cases the allocator actually promises: `src_region` and `dst_region` can't overlap each other, neither can overlap a region some concurrently running sequence has outstanding, and, if [article 04](../ral-address-map-collisions) reserved the register windows up front, neither can overlap a CSR block either.

## The overlap check worth adding to the scoreboard anyway

The allocator's non-overlap guarantee holds for the address ranges it hands out. It says nothing about what the DUT actually does with those addresses once a transfer starts. A DMA engine with an addressing bug, a miscalculated stride, a signed/unsigned mismatch on an offset register, can compute an actual write address outside the range the descriptor specified, landing in the destination region, or somewhere else in the pool entirely, regardless of what the allocator promised at request time. The verification scoreboard should independently confirm that the write addresses actually observed on the bus stayed within `[dst_region.get_start_offset(), dst_region.get_end_offset()]`, rather than trusting that because the regions were requested correctly, the transfer necessarily wrote where it was supposed to. The allocator prevents a testbench-side collision. It can't prevent a DUT-side one, and conflating the two is an easy way to miss a real addressing bug because "the regions didn't overlap" sounds like it should have caught it.

## Release discipline

`release_region()` at the end of `body()` looks obviously correct and is the most common place this pattern actually breaks in practice, not from a fatal (a `uvm_fatal` ends the simulation outright, so nothing "leaks" in any sense that matters afterward) but from a timeout: a completion interrupt that never arrives, waited on with a watchdog that gives up and moves on while the main flow is still parked mid-transfer. SystemVerilog has no `try`/`finally`, so the release calls have to live somewhere that's reachable regardless of which branch actually finished:

```systemverilog
task dma_transfer_seq::body();
  uvm_mem_mam pool = mam_registry::get().get_pool("dma_scratch");
  burst_aligned_policy pol = new();
  bit completed;

  src_region = pool.request_region(1024, pol);
  dst_region = pool.request_region(1024, pol);

  if (src_region == null || dst_region == null)
    `uvm_fatal("DMA_SEQ", "pool exhausted or fragmented, see below")

  fork
    begin
      build_and_send_descriptor(src_region, dst_region);
      verify_transfer(src_region, dst_region);
      completed = 1;
    end
    begin
      wait_for_completion_timeout_event.wait_trigger();  // project-side
                                                          // uvm_event, armed
                                                          // by a watchdog
                                                          // elsewhere in the
                                                          // environment
      `uvm_error("DMA_SEQ", "transfer timed out, aborting")
    end
  join_any
  disable fork;

  // reached whether the transfer completed normally or the watchdog fired:
  // release lives after the join, on the one path both branches funnel into,
  // never duplicated inside either branch or skipped by an early return
  pool.release_region(src_region);
  pool.release_region(dst_region);

  if (!completed)
    `uvm_fatal("DMA_SEQ", "transfer did not complete")
endtask
```

`join_any` releases `body()` the moment either branch finishes, but the other branch isn't finished at that point, just no longer being waited on. `disable fork` is what actually kills it, rather than leaving it running as an orphaned process alongside whatever `body()` does next. Skip it, and a transfer that timed out keeps executing `build_and_send_descriptor()`/`verify_transfer()` concurrently with the code that just released the regions those calls are still using.

The structural rule that makes this reliable: no early `return` in `body()` itself, between `disable fork` and the release calls. A `return` inside `build_and_send_descriptor()` or `verify_transfer()` doesn't threaten this, it only unwinds that one subroutine's own call frame, and the branch that called it just continues to whatever runs next inside the same `begin`/`end` block. The actual risk is a guard clause added later, directly in `body()`, that returns before reaching the release calls. Keeping them as the very next statement after `disable fork`, with nothing conditional in between, is what avoids that. A region leaked this way isn't freed for the rest of the simulation, which either starves later sequences in a long regression or, in the worse case, silently reduces how much of the pool is actually available without anything reporting an error until a much later allocation fails for no apparent reason.

## Fragmentation under a long randomized regression

A single sequence run in isolation never sees fragmentation. A regression running thousands of randomized DMA sequences back to back, with varying transfer sizes, will. Repeated allocate/release cycles of different sizes can leave the pool's free space broken into extents individually too small to satisfy a later, larger request, even though the total free byte count is more than enough. `uvm_mem_mam` doesn't help here: there's no coalescing of adjacent freed extents anywhere in the allocator, which lines up with `THRIFTY` (the mode that would reuse released memory) being unimplemented in the base class. Every release just marks a range free; nothing merges it back with its neighbors. A workload that interleaves allocations and releases of varying sizes will fragment over a long regression with nothing in the allocator itself working against it.

The practical mitigations are the same ones any allocator-heavy system reaches for: size pools generously relative to the largest realistic concurrent demand rather than the tightest, and favor a smaller number of standard transfer sizes over fully randomized sizing when the test doesn't specifically need size randomization to be meaningful. The other mitigation is diagnostic rather than preventive: a failed `request_region()` three hours into a regression is far easier to root-cause if the failure captures pool state at the moment it happened, rather than a bare fatal that says only that the request failed.

```systemverilog
uvm_mem_region r = pool.request_region(xfer_size, pol);
if (r == null) begin
  int total_free, largest_free;
  pool_free_summary(pool, total_free, largest_free);  // project-side helper:
                                                        // walks the pool's free
                                                        // list, no such summary
                                                        // ships with uvm_mem_mam
  `uvm_fatal("DMA_SEQ", $sformatf(
    "request_region(%0d) failed, %0d bytes free total, largest contiguous %0d",
    xfer_size, total_free, largest_free))
end
```

The distinction in that log line is the whole diagnosis: `total_free` large and `largest_free` small is fragmentation, a real symptom worth changing the allocation pattern over. Both small together is a pool that's simply undersized for the demand being placed on it, a capacity problem, not a fragmentation one, and the fix is a bigger pool rather than fewer size variants.

## Budgeting capacity when several sequences run concurrently

Everything above treats a failed `request_region()` as a single event to diagnose after the fact. That's the right instinct for one sequence, but it stops being enough the moment a virtual sequence starts several DMA transfers concurrently against the same pool, three channels running `dma_transfer_seq` in parallel, say. Each one calls `request_region()` independently, with no visibility into what the other two are about to ask for. The pool doesn't reject a request because the environment is over budget; it rejects a request because the bytes genuinely aren't there at the moment that specific call happened, which means the failure can land on whichever of the three sequences happened to ask last, not on whichever one is actually responsible for the pool being oversubscribed.

The fix is capacity accounting the virtual sequence does itself, before issuing anything, rather than discovering the shortfall through a null handle three calls in:

```systemverilog
task dma_multi_channel_vseq::body();
  // three instances of the same dma_transfer_seq from earlier in this
  // article, one per channel; p_sequencer is this virtual sequence's
  // handle to the environment's per-channel sequencers
  dma_transfer_seq ch0_seq = dma_transfer_seq::type_id::create("ch0_seq");
  dma_transfer_seq ch1_seq = dma_transfer_seq::type_id::create("ch1_seq");
  dma_transfer_seq ch2_seq = dma_transfer_seq::type_id::create("ch2_seq");
  uvm_mem_mam pool = mam_registry::get().get_pool("dma_scratch");  // same
                                                    // lookup as every
                                                    // other example in
                                                    // this article
  int channel_xfer_size[3] = '{1024, 1024, 1024};  // per-channel transfer
                                                    // sizes this run needs
  int total_needed = 0;
  int pool_capacity = pool_capacity_bytes(pool);  // project-side helper:
                                                    // end_offset - start_offset + 1
                                                    // from the pool's own cfg,
                                                    // no such query ships with uvm_mem_mam
  foreach (channel_xfer_size[i])
    total_needed += channel_xfer_size[i];

  if (total_needed > pool_capacity)
    `uvm_fatal("DMA_VSEQ", $sformatf(
      "%0d bytes needed across %0d channels, pool has %0d total",
      total_needed, channel_xfer_size.size(), pool_capacity))

  fork
    ch0_seq.start(p_sequencer.ch0_sqr);
    ch1_seq.start(p_sequencer.ch1_sqr);
    ch2_seq.start(p_sequencer.ch2_sqr);
  join
endtask
```

This doesn't replace the null check inside each individual sequence, fragmentation can still fail an individual `request_region()` call even when the aggregate math works out, it adds a cheaper check in front of it that catches the common case, three channels asking for more than the pool was ever sized to give all of them, before any of the three sequences starts and has to unwind. A `uvm_fatal` at this point names the actual problem, total demand versus total capacity, instead of surfacing as a confusing null-handle failure on whichever channel happened to lose the race for the last free bytes. Retrying with backoff is the wrong instinct here: a pool that's genuinely undersized for concurrent demand doesn't get bigger by waiting, and a retry loop around `request_region()` just delays the same fatal while burning simulation time.

## What this adds up to

The shift across these five articles has been from "hardcode an address and hope" to treating memory allocation as infrastructure with the same rigor register verification gets: a real allocator instead of a convention, a shared instance instead of duplicated state per testbench level, an exclusion mechanism tied to the same address map the registers already use, and release discipline that survives the test not finishing the way it was supposed to. None of it is exotic. `uvm_mem_mam` has been part of UVM the entire time. The gap on most projects isn't the tooling. It's that nobody wired it up past the first block that needed it, which is exactly the scale a later article works through concretely.

---

*Next: Block to Chiplet to SoC: A DMA and Ethernet Worked Example*
