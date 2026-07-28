---
title: "A Singleton Wrapper for Block, Subsystem, and SoC Reuse"
weight: 3
date: 2026-07-28
publishDate: 2026-07-28
draft: false
description: "A raw uvm_mem_mam instance doesn't share state across testbench levels on its own. A registry that lets it."
prev: /mam/inside-uvm-mem-mam
next: /mam/ral-address-map-collisions
---

A `uvm_mem_mam` instance is an ordinary object, constructed once, against one address range, by whatever code happens to call `new()` on it. Nothing about the class itself has an opinion on testbench hierarchy. A block-level environment builds one for its local scratch memory, uses it correctly for every block-level test, and that's the end of the story until a subsystem-level environment needs to allocate from the same physical memory the block owns. At that point, building a second `uvm_mem_mam` instance over the same address range doesn't share state with the first one. It just gives the subsystem test a second allocator with no idea the first one exists, and the two can, and eventually will, hand out overlapping addresses.

## Why this doesn't fix itself

The instinct is to pass the block's `uvm_mem_mam` instance up through the environment hierarchy explicitly, a handle threaded through constructor arguments or set on a virtual sequencer. That works for one level of nesting and gets progressively worse as the hierarchy grows, because every intermediate environment now needs to know about a memory manager instance that has nothing to do with what that environment is actually verifying, purely to relay it to whatever's above it. A subsystem environment integrating five blocks ends up wiring through five separate handles it never uses directly, just to make them reachable from the SoC level above it.

## A named registry instead of threaded handles

The fix is the same shape as the waiver manager from the CSR series: a singleton that acts as a lookup table, keyed by name, so any environment at any level of hierarchy can ask for a specific allocator by name without needing a handle passed down to it explicitly.

```systemverilog
class mam_registry;
  static local mam_registry m_inst;
  local uvm_mem_mam m_pools[string];

  local function new();
  endfunction

  static function mam_registry get();
    if (m_inst == null) m_inst = new();
    return m_inst;
  endfunction

  function void register_pool(string name, uvm_mem_mam mam);
    if (m_pools.exists(name))
      `uvm_fatal("MAM_REGISTRY",
        $sformatf("pool '%s' already registered", name))
    m_pools[name] = mam;
  endfunction

  function uvm_mem_mam get_pool(string name);
    if (!m_pools.exists(name))
      `uvm_fatal("MAM_REGISTRY",
        $sformatf("pool '%s' was never registered", name))
    return m_pools[name];
  endfunction
endclass
```

The block environment that owns a piece of physical memory constructs the `uvm_mem_mam` once, during `build_phase`, and registers it under a name that describes what it is, `"dma_scratch"`, `"block_a_local_mem"`, whatever makes sense for the project:

```systemverilog
// mam: a uvm_mem_mam handle declared as a member of block_a_env
function void block_a_env::build_phase(uvm_phase phase);
  uvm_mem_mam_cfg cfg = new();
  cfg.start_offset = 'h0000_0000;
  cfg.end_offset   = 'h000F_FFFF;
  mam = new("block_a_pool", cfg, null);
  mam_registry::get().register_pool("block_a_scratch", mam);
endfunction
```

A subsystem-level virtual sequence, or a completely unrelated SoC-level test, retrieves the same instance by name rather than constructing a new one:

```systemverilog
uvm_mem_mam pool = mam_registry::get().get_pool("block_a_scratch");
uvm_mem_region buf = pool.request_region(.n_bytes(512));
```

![Block environment registers a pool by name; subsystem and SoC environments look up the same instance instead of constructing their own](/images/mam/03-registry-pattern.svg)

Every caller at every level is now allocating from the same free list, which is what actually prevents the collision this series started with. The registration failing loudly (`uvm_fatal`) if a pool name is requested before anything has registered it, or registered twice under the same name, is deliberate: a silent fallback to "just create a new one" would quietly reintroduce the exact bug the registry exists to prevent.

## Why not just use uvm_resource_db directly

UVM already ships a general-purpose name-to-object store in `uvm_resource_db`, and it's fair to ask why this needs a dedicated class instead of `uvm_resource_db#(uvm_mem_mam)::set()` and `::get_by_name()` calls scattered through the environments that need them. The registry wrapper is worth the extra class for the same reason the waiver manager was worth one in the CSR series: it turns a stringly-typed, general-purpose API into a narrow, purpose-specific one with its own failure behavior. `get_pool()` fails immediately and clearly if a name was never registered. A raw `uvm_resource_db::get_by_name()` call that finds nothing typically returns null and lets the caller discover the problem several statements later, at whatever point it first dereferences the handle. The wrapper is a thin layer, but it's exactly the layer that turns a missing-registration bug into a fatal at the point of the mistake instead of a null-pointer crash somewhere downstream.

## Ownership stays with whoever built the memory

The registry doesn't change who's responsible for deciding how much address space to hand out or where the boundaries of a pool sit. Registration is still an explicit act performed by the environment that actually owns the underlying memory, a block environment, typically, since it's the one that knows the physical memory's real size and layout. Subsystem and SoC-level code are consumers of a named pool, not owners of one; they request regions and release them, but they don't construct new `uvm_mem_mam` instances against memory some other environment already manages. Getting that ownership boundary backwards, letting a subsystem-level test build its own allocator over memory a block already owns, is the same mistake this whole article exists to prevent, just moved one layer up.

One assumption baked into `register_pool()` as shown here: the name being registered is unique for the life of the simulation, and that each environment level is the one deciding whether to construct a pool at all. Both hold up fine for a single reusable pool being shared down a hierarchy. They get harder to defend once several sibling instances, three DMA engines and an Ethernet block inside one chiplet, or two chiplets inside one SoC, all exist in the same simulation and all need names that don't collide. A later article in this series takes a different approach for that case: rather than multiple environments each registering their own named pool, a single test-owned manager and an explicit table of names and fixed addresses, declared entirely in the test, in one place, by whoever can actually see the full topology being exercised.

---

*Next: Keeping Allocations Out of the RAL Address Map*
