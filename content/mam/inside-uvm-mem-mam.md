---
title: "Inside uvm_mem_mam"
weight: 2
date: 2026-07-14
publishDate: 2026-07-14
draft: false
description: "Configuration, allocation modes, locality, and the region handle that tracks what's actually been given out."
prev: /mam/case-for-shared-manager
next: /mam/singleton-wrapper
---

`request_region()` and `release_region()` cover the common case well enough that it's possible to use `uvm_mem_mam` for a while without ever looking past those two calls. The configuration underneath them controls how addresses actually get picked, how alignment gets enforced, and how the allocator behaves once it's fragmented from repeated use, and all of that matters the moment a test needs more than "give me any free chunk."

## Setting up the manager

A `uvm_mem_mam` instance is constructed against a configuration object, `uvm_mem_mam_cfg`, that defines the address range it's allowed to hand out addresses from:

```systemverilog
uvm_mem_mam_cfg cfg = new();
cfg.start_offset = 'h0000_0000;
cfg.end_offset   = 'h000F_FFFF;  // 1 MB region
cfg.mode         = uvm_mem_mam::GREEDY;
cfg.locality     = uvm_mem_mam::BROAD;

uvm_mem_mam mam = new("dma_pool", cfg, backing_mem /* uvm_mem, or null for address-only */);
```

That range doesn't have to cover an entire physical memory. Scoping a `uvm_mem_mam` instance to a sub-range, a DMA scratch pool carved out of a larger address space, for instance, is a normal way to keep one allocator's responsibility bounded to what a particular test or subsystem is actually supposed to own, which is worth keeping in mind before reaching for the shared-instance pattern in [article 03](../singleton-wrapper).

The `backing_mem` argument ties the allocator to an actual `uvm_mem` model when one exists, letting region handles participate in the same frontdoor/backdoor access machinery a register model uses. Passing `null` gives you an allocator that hands out addresses without checking any backing storage model at all, useful when the "memory" being modeled doesn't correspond to a single contiguous `uvm_mem` object, a DMA target that's actually scattered across several physical memories addressed through one logical range, for example, where no single `uvm_mem` could represent it anyway.

## Allocation mode: GREEDY vs THRIFTY

`mode` controls how the allocator picks a specific address for a new request out of the available free space. `GREEDY` takes the first free extent large enough to satisfy the request, which is fast and produces predictable, low-fragmentation layouts, generally the right default for functional testing where the specific address doesn't matter. `THRIFTY` is documented as reusing previously released memory instead of always carving out fresh space, but it's explicitly marked not yet implemented in the base class as of this writing: setting `mode = THRIFTY` compiles and runs, but the allocator falls back to `GREEDY`-equivalent behavior underneath it. In practice, `GREEDY` is the only mode that actually does anything today. There's no `RANDOM` mode; if you want a request to land at an arbitrary address rather than the first available one, that's a `locality` decision, not a `mode` decision, covered next.

![GREEDY takes the first free extent large enough; THRIFTY is documented but not yet implemented, and falls back to GREEDY](/images/mam/02-allocation-modes.svg)

## Locality: BROAD vs NEARBY

`locality` affects how new allocations relate to existing ones spatially, and the names are easy to misread on first pass. `BROAD` locates a new region at a random address anywhere in the configured range, no attempt at even coverage, just an unconstrained pick from wherever there's room. `NEARBY` biases new allocations toward addresses adjacent to already-allocated regions. `NEARBY` is the one to reach for when locality actually matters at the protocol level, cache-line or page-boundary behavior, burst efficiency across nearby addresses, where clustering related allocations near each other reflects realistic usage better than a buffer landing anywhere in a potentially large range. `BROAD` is closer to what a test reaching for "exercise address-dependent corner cases regardless of where a buffer lands" actually wants.

## Alignment: a policy object, not a request parameter

There's no `alignment` argument on `request_region()`, and no alignment field on the base `uvm_mem_mam_policy` either. Alignment is expressed by extending `uvm_mem_mam_policy` and constraining its `start_offset` directly, since that field is already the `rand` value the allocator solves for when it picks an address:

```systemverilog
// 256 bytes, 64-byte aligned: matches a 64-byte burst engine
class burst_aligned_policy extends uvm_mem_mam_policy;
  constraint c_64b_aligned {
    start_offset[5:0] == 6'b0;  // low 6 bits zero -> 64-byte aligned
  }
endclass

burst_aligned_policy pol = new();
uvm_mem_region region = mam.request_region(256, pol);
```

A request the allocator can't satisfy within the configured range, no free extent large enough, or none satisfying the policy's constraints, returns a null handle rather than silently allocating something that violates the request. That return value is worth checking explicitly; treating a failed allocation as a valid region handle produces a null-pointer failure several steps downstream that has nothing obviously to do with the allocation that actually failed.

## The region handle: what it tracks, and its lifetime

`request_region()` returns a `uvm_mem_region` object, and that object, not a bare address, is what the rest of the environment should be passing around. It carries the allocated range (`get_start_offset()`, `get_end_offset()`), the length, and enough state for the allocator to know the region is currently live. Region handles are not reference-counted: `release_region()` marks the underlying address range free again immediately, regardless of how many other places in the environment still hold a reference to that handle. A sequence that releases a region and then has another component read through a stale handle to the same object isn't protected by anything in `uvm_mem_mam` itself. The region's lifetime has to be managed by whatever part of the testbench owns the decision that the buffer is no longer needed, typically the sequence that requested it in the first place, which is the pattern a later case study in this series walks through end to end.

## Backdoor access doesn't go through the allocator at all

When `backing_mem` is a real `uvm_mem`, per a later article's use of it, a region handle can be touched two ways: frontdoor, through `uvm_mem::write()`/`read()`, which issues an actual bus transaction through whatever sequencer and adapter the memory's map is bound to, or backdoor, through `uvm_mem::backdoor_write()`/`backdoor_read()` (or a direct HDL path), which pokes simulator state without any bus activity at all. The allocator's non-overlap guarantee is about which addresses get handed out by `request_region()`, full stop. It says nothing about which access path a caller uses once it holds a region handle, and a backdoor write inside an allocated region's bounds is completely invisible to `uvm_mem_mam` itself: no call into the allocator happens, no bookkeeping updates, nothing to check against. The allocator isn't wrong here; it was never in the loop for a backdoor access, the same way it's not in the loop for the frontdoor case either. It only ever tracked which ranges are checked out, not what happens to the bytes inside them.

That gap matters most in exactly the place a later firmware-series article covers for registers: a backdoor write used to seed or corrupt DUT state for a test setup step, or firmware writing directly to a memory-mapped location the allocator handed out as a region, can leave any frontdoor-side model of that memory's contents, a scoreboard's shadow copy, a checksum computed at allocation time, stale in exactly the same way a RAL predictor goes stale when firmware writes a register without going through the bus. The allocator has no mirrored-value concept for memory contents the way `uvm_reg` has one for register fields, so there's no "invalidate and re-read" recovery available even in principle. Anything that needs to trust a memory region's contents after a backdoor access touched it has to re-read it explicitly, frontdoor, rather than assume the allocator or anything else caught the change.

## Reserving space the allocator should never touch

`reserve_region()` marks a specific, caller-chosen address range as permanently unavailable to `request_region()`, and it still returns a `uvm_mem_region` handle for that exact range, the same handle type `request_region()` returns, just pinned at an address the caller picked instead of one the allocator chose. That handle matters whenever the reserved range itself needs a name and a reference later, not just an exclusion, which a later worked example in this series relies on directly. The more common use here is exclusion without needing the handle at all: carving out space the allocator manages but should never allocate from, a range that overlaps a register-mapped address window being the case that matters most for this series, covered in full in a later article.

```systemverilog
mam.reserve_region(.start_offset('h0001_0000), .n_bytes('h1000));
```

Any subsequent `request_region()` call treats that range as occupied, the same as if a live region had already been allocated there, without a caller needing to remember to avoid it manually.

---

*Next: [A Singleton Wrapper for Block, Subsystem, and SoC Reuse](../singleton-wrapper)*
