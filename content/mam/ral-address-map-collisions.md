---
title: "Keeping Allocations Out of the RAL Address Map"
weight: 4
date: 2026-08-24
publishDate: 2026-08-24
draft: false
description: "Registers and memory sharing an address space, and using reserve_region so the allocator never hands out a colliding chunk."
prev: /mam/singleton-wrapper
next: /mam/dma-case-study
---

On plenty of SoCs, control and status registers and general-purpose memory sit in the same address space, decoded by the same interconnect, distinguished only by which range of addresses a given transaction falls into. A `uvm_mem_mam` instance scoped to that address space has no inherent awareness of where the register windows are. Left unconfigured, it will happily hand out a "free" region that overlaps a CSR block, because as far as the allocator is concerned, nothing has told it that range is unavailable.

## What actually goes wrong

A DMA sequence requests a 4KB destination buffer. The allocator, tracking only what it has itself handed out or been told to reserve, returns a region that happens to overlap the address range decoded to a peripheral's register block twenty lines below it in the memory map. The DMA transfer runs, writes across that range, and corrupts live register state in a completely unrelated block. Whatever test owns that block sees its registers change value with no write it issued, and starts debugging a nonexistent RTL bug. The actual root cause, an allocator that didn't know the register window existed, is nowhere near the failure that surfaced.

This is the same class of problem [article 01](../case-for-shared-manager) describes for two sequences colliding with each other, one level more dangerous, because the "other side" of the collision isn't a test-local buffer someone can shrug off. It's live register state that other parts of the environment depend on.

![A shared address space with CSR windows reserved and everything else left allocatable](/images/mam/04-reserved-windows.svg)

## The fix: reserve every register window before allocating anything

`uvm_mem_mam` is the class actually doing the allocating, the memory allocation manager RAL hands out address ranges from. `uvm_mem_mam::reserve_region()`, covered in [article 02](../inside-uvm-mem-mam), exists for exactly this. Before any `request_region()` call happens against a shared address space, every register block's address range needs to be reserved so the allocator treats it as permanently unavailable. `reserve_region()` does check for this: it walks every region already handed out, and raises an error and returns `null` rather than silently double-booking. Doing every reservation first, before the pool is opened up to general requests, avoids that error entirely rather than depending on catching it after the fact — a directed test that runs late in a regression and happens to be the one that requests the colliding region is a worse place to first learn a register window was never reserved than a setup-time error every run would hit identically.

```systemverilog
mam.reserve_region(.start_offset(periph_a_csr_base), .n_bytes(periph_a_csr_size));
mam.reserve_region(.start_offset(periph_b_csr_base), .n_bytes(periph_b_csr_size));
```

Hand-listing every register block's base address and size the same way, hardcoded at the point the allocator gets set up, works exactly as well as the hardcoded-address approach [article 01](../case-for-shared-manager) already argued against for memory buffers, and for the same reason: it drifts from reality the moment someone adds a register block, or moves one, and doesn't also update this list.

## Deriving the reserved ranges from the RAL model instead

The register address map already exists, generated from the same source of truth described in the CSR series's article on RAL generation. Every `uvm_reg_block` mapped into the shared address space via a `uvm_reg_map` knows its own base offset and the address range its registers occupy. Walking that model at setup time, instead of hand-maintaining a parallel list, keeps the reservation automatically correct whenever the register map changes:

```systemverilog
function void reserve_all_csr_windows(uvm_mem_mam mam, uvm_reg_map map);
  uvm_reg regs[$];
  map.get_registers(regs);
  foreach (regs[j]) begin
    uvm_reg_addr_t addr = regs[j].get_address(map);
    mam.reserve_region(.start_offset(addr), .n_bytes(regs[j].get_n_bytes()));
  end
endfunction
```

This runs once, during environment build, before any test issues a `request_region()` call against the shared pool. Because it's reading directly from the register model rather than a separately maintained list, a register block moving, resizing, or getting added between now and the next regeneration doesn't require finding and updating a second copy of the address information anywhere. The reservation is a query against the model, not a fact somebody has to remember to keep synchronized. That's the same principle the CSR series applied to the waiver file's `@include` mechanism, letting each level of ownership be the single source of truth for its own piece of the picture, rather than hand-copied between them.

## ECC-protected ranges need the same treatment, for a different reason

Register windows aren't the only ranges a general-purpose allocator can hand out without understanding what it's actually giving away. Memory backed by ECC or similar poison-bit protection usually organizes storage in fixed granules, the unit the ECC/parity bits actually cover, often 32 or 64 bytes, and two problems show up when the allocator doesn't know that granularity exists. First, a region that isn't granule-aligned can straddle a boundary, so a single logical buffer ends up split across two ECC granules, and a partial-granule write turns into a read-modify-write the DUT's memory controller has to perform correctly, an edge case worth testing deliberately rather than hitting by allocator accident on whichever run happens to misalign a buffer. Second, and the more common real need: a directed test that injects a poison bit or a correctable/uncorrectable ECC error wants that error planted at a specific, known address, not wherever the default `GREEDY` mode's first-fit search (see [article 02](../inside-uvm-mem-mam#allocation-mode-greedy-vs-thrifty)) happens to land, because the test's whole point is checking what happens when *that exact address* is subsequently read.

Both are the same fix already established for register windows: reserve what needs to be controlled, don't leave it to chance.

```systemverilog
// pin a granule-aligned block the poison-injection test targets directly,
// rather than trusting whatever address a generic request_region() returns
uvm_mem_region poison_target =
  mam.reserve_region(.start_offset('h0002_0000), .n_bytes(ECC_GRANULE_BYTES));
```

A general-purpose `request_region()` call can still be made granule-safe without a directed address, using the same alignment-policy mechanism from [article 02](../inside-uvm-mem-mam#alignment-a-policy-object-not-a-request-parameter): constrain `start_offset` to the ECC granule size instead of a burst size, and every region the allocator hands out from that pool starts on a granule boundary by construction. Whether a project needs the directed reservation, the aligned policy, or both depends on what the ECC verification plan actually tests: a directed poison-injection sequence needs the fixed address; a sequence just checking that ordinary DMA traffic behaves correctly around ECC granules only needs the alignment guarantee.

## When this doesn't apply

Not every project shares one address space between registers and memory. Plenty of SoCs decode CSR windows and DRAM-backed memory through entirely separate paths, a register bus with its own dedicated address range that never physically aliases with anything a DMA engine can target. In that case there's no collision to prevent, and building the reservation machinery in this article is unnecessary complexity for a risk that doesn't exist on that particular design. Worth confirming which situation actually applies before adding this: check whether the address map genuinely places CSR and general-purpose memory ranges within the same decode space, rather than assuming it does because some other project the team has worked on did.

---

*Next: [Case Study: DMA Source/Destination Buffer Allocation](../dma-case-study)*
