---
title: "The Case for a Shared Memory Manager"
weight: 1
date: 2026-06-30
publishDate: 2026-06-30
draft: false
description: "Why ad hoc address allocation breaks down past a single sequence, and what uvm_mem_mam already gives you for free."
next: /mam/inside-uvm-mem-mam
---

A DMA test needs a source buffer and a destination buffer somewhere in memory. The easiest way to get them is to pick two addresses that look free and hardcode them into the sequence. That works for exactly one sequence, run in isolation. The moment a second sequence needs its own src/dst pair, or a virtual sequence runs two DMA transfers concurrently, or a subsystem-level test reuses a block-level sequence that made the same assumption, the hardcoded addresses collide, and the failure that results has nothing to do with the DMA engine being tested. It's an address planning bug in the testbench.

## What goes wrong without a real allocator

Hardcoded addresses are the most common starting point, and the failure mode is predictable: two unrelated sequences pick overlapping ranges, one overwrites the other's buffer mid-transfer, and the resulting corruption looks like a DMA data-integrity bug until someone traces it back to the address plan. The fix people reach for next is usually a convention, a spreadsheet or a comment block listing which sequence owns which range, enforced by nothing except everyone remembering to check it. That holds up for a while and then breaks the same way conventions always break: someone adds a new sequence, doesn't check the spreadsheet, and picks a range that was already spoken for.

The actual requirement is an allocator: something that hands out a range of addresses on request, guarantees it won't hand out that same range again until it's released, and can be asked to avoid specific reserved regions. That's a solved problem, and UVM already ships a solution for it.

![Hardcoded addresses collide silently; an allocator guarantees non-overlap by construction](/images/mam/01-collision-problem.svg)

## uvm_mem_mam: built in, underused

`uvm_mem_mam` (Memory Allocation Manager) is part of the standard UVM register layer, sitting alongside `uvm_reg` and `uvm_reg_block` but modeling a `uvm_mem`: a contiguous memory region rather than a set of discrete registers. Where `uvm_reg_block` gives you named fields at fixed offsets, `uvm_mem` gives you a byte-addressable range, and `uvm_mem_mam` is the allocator that manages who owns which slice of it.

The basic operation is a `request_region()` call that takes a size and returns a `uvm_mem_region` handle representing a chunk the allocator has marked as in use. Nobody else gets that chunk until the handle is explicitly released with `release_region()`. This is precisely "request chunks for src/dst memories": a DMA sequence asks the manager for two regions, uses the returned addresses to build its transfer descriptor, and releases both once the transfer is verified.

```systemverilog
uvm_mem_region src_region, dst_region;

src_region = mam.request_region(.n_bytes(256));
dst_region = mam.request_region(.n_bytes(256));

// src_region.get_start_offset(), dst_region.get_start_offset()
// are guaranteed not to overlap each other or any other
// currently outstanding region from the same mam instance.
// That guarantee doesn't extend across two separate mam
// instances over the same physical memory -- see below.

mam.release_region(src_region);
mam.release_region(dst_region);
```

## Why this is a better foundation than rolling your own

Writing a custom allocator from scratch is a reasonable-sounding project that tends to accumulate the same bugs a general-purpose allocator already solved years ago: fragmentation from repeated alloc/free cycles, off-by-one errors at region boundaries, no clean way to express "don't ever hand out this specific range." `uvm_mem_mam` already handles free-list management, already has an allocation policy for how it picks addresses within the available space, and already has the reservation mechanism needed to carve out ranges the allocator should never touch, the exact mechanism a later article in this series uses to keep memory allocation clear of the register address map.

What it doesn't give you for free is reuse across a testbench hierarchy. A `uvm_mem_mam` instance is tied to a specific `uvm_mem` and a specific address range at construction. A block-level environment that builds one has no built-in way to hand that same instance to a subsystem-level environment sitting above it, and without deliberate wiring, a subsystem test ends up constructing a second, independent allocator over the same physical memory, which reintroduces exactly the collision problem this article started with, just one level up. That's the gap the rest of this series is about.

---

*Next: [Inside uvm_mem_mam](../inside-uvm-mem-mam)*
