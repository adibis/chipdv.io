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

## Published

{{< section-cards >}}
