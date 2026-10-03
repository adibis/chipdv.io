---
title: "Memory Allocation Manager"
weight: 3
description: "Using UVM's built-in region allocator for shared memory across block, subsystem, and SoC testbenches, and where the built-in class needs a wrapper to actually scale."
icon: database
image: /images/mam/03-registry-pattern.svg
imageAlt: "One mam_registry shared across block, subsystem, and SoC environments"
cascade:
  type: docs
---

DMA engines, packet buffers, scratchpad memories: any testbench that needs to hand out addresses for source and destination buffers runs into the same problem eventually. Two sequences pick overlapping ranges by coincidence. A block-level test and a subsystem-level test both assume they own the same region. A register-mapped range gets treated as free memory because nothing told the allocator it wasn't.

UVM ships an answer to most of this: `uvm_mem_mam`, the memory allocation manager built into the register layer. It's underused, and even when it's used correctly at the block level, it doesn't automatically solve the reuse problem once a subsystem or SoC environment needs to share allocation state with the blocks underneath it. This series covers the built-in class in depth, and the wrapper most projects end up needing around it.

## The allocator, and making it reusable

{{< cards cols="3" >}}
  {{< card link="/mam/case-for-shared-manager/" title="The Case for a Shared Memory Manager" subtitle="Why ad hoc address allocation breaks down past a single sequence, and what uvm_mem_mam already gives you for free." >}}
  {{< card link="/mam/inside-uvm-mem-mam/" title="Inside uvm_mem_mam" subtitle="Configuration, allocation modes, locality, and the region handle that tracks what's actually been given out." >}}
  {{< card link="/mam/singleton-wrapper/" title="A Singleton Wrapper for Block, Subsystem, and SoC Reuse" subtitle="A raw uvm_mem_mam instance doesn't share state across testbench levels on its own. A registry that lets it." >}}
  {{< card link="/mam/ral-address-map-collisions/" title="Keeping Allocations Out of the RAL Address Map" subtitle="Registers and memory sharing an address space, and using reserve_region so the allocator never hands out a colliding chunk." >}}
{{< /cards >}}

## Worked examples

{{< cards cols="3" >}}
  {{< card link="/mam/dma-case-study/" title="Case Study: DMA Source/Destination Buffer Allocation" subtitle="A worked example: aligned region requests, release timing, and the overlap and fragmentation bugs that show up in practice." >}}
  {{< card link="/mam/block-chiplet-soc-worked-example/" title="Block to Chiplet to SoC: A DMA and Ethernet Worked Example" subtitle="Three DMA engines and an Ethernet block, verified standalone, reused inside a chiplet, then an SoC. One manager, one place every address decision gets made." >}}
{{< /cards >}}
