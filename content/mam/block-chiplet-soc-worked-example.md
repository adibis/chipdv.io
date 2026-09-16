---
title: "Block to Chiplet to SoC: A DMA and Ethernet Worked Example"
weight: 6
date: 2026-09-15
publishDate: 2026-09-15
draft: false
description: "Three DMA engines and an Ethernet block, verified standalone, reused inside a chiplet, then an SoC. One manager, one place every address decision gets made."
prev: /mam/dma-case-study
---

The first five articles in this series built the pieces in isolation: the allocator, the registry, the address-map reservation. This article covers what happens when four real IP blocks, three DMA engines and an Ethernet controller, get reused across three integration levels. The environments and sequences never decide an address or a region name themselves, anywhere, at any level. That decision belongs in exactly one place: the test.

## Why this isn't `mam_registry` again

[A Singleton Wrapper for Block, Subsystem, and SoC Reuse](../singleton-wrapper)'s registry is a singleton, and that's not what changes here: `mem_region_manager` below is a singleton too, for the same reason. Exactly one instance may ever exist for the life of the simulation, and constructing a second one is a bug the class itself refuses to allow, the same guarantee that's been the point of this series since [The Case for a Shared Memory Manager](../case-for-shared-manager). What's different is what the singleton actually holds. `mam_registry` is a name-keyed table of separately-owned `uvm_mem_mam` instances: each environment level constructs its own allocator over whatever memory it owns and registers it under a name, so `get_pool()` can hand the right one back later. That works cleanly for one reusable pool shared down a hierarchy, but it doesn't fully hold up once a single simulation has several sibling instances, three DMA engines and an Ethernet block, each needing its own region names. The registry can guarantee a name isn't registered twice, but it has no visibility into address math across pools: `dma0`'s allocator and `dma1`'s allocator are two entirely separate `uvm_mem_mam` instances, each with its own free list, and nothing about the registry cross-checks whether their address ranges happen to overlap. That discipline is left entirely to whoever picked each pool's `start_offset`/`end_offset` by hand, exactly the case its own closing section flagged as the registry's limit. `mem_region_manager` fixes it by never letting more than one `uvm_mem_mam` exist in the first place: every name, block-level `"src"`, chiplet-level `"dma0_src"`, SoC-level `"chiplet0_dma0_src"`, is a named sub-region carved from the same single allocator, so the overlap check that used to be scattered across N independently-constructed pools is now one allocator's own free-list bookkeeping, and the one table of names living in the test is something a person can actually read end to end and verify by inspection.

## One manager, and the test owns every address

The pattern this series has been building toward is simpler than it looks once stated plainly: there is one `uvm_mem_mam` for the entire simulation, its bounds are set in the base test, and every named region any sequence will ever ask for is declared in that same test, up front, before the environment is built. Not in a block environment's `build_phase`. Not conditionally suppressed by a config flag threaded down from a parent. In the test.

```systemverilog
class mem_region_manager;
  static local mem_region_manager m_inst;
  local uvm_mem_mam mam;
  local uvm_mem_region m_named[string];
  local bit m_configured;

  local function new();
  endfunction

  // new() is private, so this is the only way to get an instance, and
  // it's the same instance every time -- exactly one uvm_mem_mam exists
  // for the life of the simulation, the property this whole series
  // exists to protect
  static function mem_region_manager get();
    if (m_inst == null) m_inst = new();
    return m_inst;
  endfunction

  function void configure(uvm_mem_mam_cfg cfg);
    if (m_configured)
      `uvm_fatal("MEM_MGR", "configure() called more than once -- one test owns this manager's bounds")
    mam = new("mam", cfg, null);
    m_configured = 1;
  endfunction

  // the only place a name and a fixed address ever meet:
  // reserve_region() takes an explicit start_offset and returns a handle
  // pinned there, unlike request_region(), which only takes a size and
  // lets the allocator pick the address itself
  function void declare_region(string name, uvm_reg_addr_t start, uvm_reg_addr_t end);
    if (m_named.exists(name))
      `uvm_fatal("MEM_MGR", $sformatf("region '%s' already declared", name))
    m_named[name] = mam.reserve_region(.start_offset(start), .n_bytes(end - start + 1));
  endfunction

  function uvm_mem_region get_region(string name);
    if (!m_named.exists(name))
      `uvm_fatal("MEM_MGR", $sformatf("no region named '%s' was declared", name))
    return m_named[name];
  endfunction
endclass
```

## Block level: DMA declares its own names, Ethernet declares its own, independently

`dma_base_test` is the only place `"src"` and `"dst"` mean anything. It configures the one manager for this simulation, sized for whatever this standalone regression needs, and declares exactly the two regions the DMA sequences will ask for:

```systemverilog
class dma_base_test extends uvm_test;
  function void build_phase(uvm_phase phase);
    mem_region_manager mgr = mem_region_manager::get();
    uvm_mem_mam_cfg cfg = new();
    cfg.start_offset = 'h0000_0000;
    cfg.end_offset   = 'h0001_FFFF;
    mgr.configure(cfg);
    mgr.declare_region("src", 'h0000_0000, 'h0000_FFFF);
    mgr.declare_region("dst", 'h0001_0000, 'h0001_FFFF);
  endfunction
endclass
```

`eth_base_test` does whatever Ethernet actually needs, in a separate test class, with no relationship to `dma_base_test` at all:

```systemverilog
class eth_base_test extends uvm_test;
  function void build_phase(uvm_phase phase);
    mem_region_manager mgr = mem_region_manager::get();
    uvm_mem_mam_cfg cfg = new();
    cfg.start_offset = 'h0000_0000;
    cfg.end_offset   = 'h0002_FFFF;
    mgr.configure(cfg);
    mgr.declare_region("tx_ring", 'h0000_0000, 'h0001_FFFF);
    mgr.declare_region("rx_ring", 'h0002_0000, 'h0002_FFFF);
  endfunction
endclass
```

The sequences themselves never hardcode `"src"` or `"tx_ring"` inline. That literal exists in exactly one place, a config object's class default, not repeated at every call site that needs it. A small config object carries each sequence's own region names, defaulting to the block-level names and overridable by any test that needs to say otherwise:

```systemverilog
class dma_seq_cfg extends uvm_object;
  `uvm_object_utils(dma_seq_cfg)
  string src_region_name = "src";
  string dst_region_name = "dst";
endclass

task dma_transfer_seq::body();
  dma_seq_cfg cfg = dma_seq_cfg::type_id::create("cfg");   // class defaults, overridden below if a test declared one
  void'(uvm_config_db#(dma_seq_cfg)::get(null, get_full_name(), "cfg", cfg));

  src_region = mem_region_manager::get().get_region(cfg.src_region_name);
  dst_region = mem_region_manager::get().get_region(cfg.dst_region_name);
  build_and_send_descriptor(src_region, dst_region);
endtask
```

`get_full_name()` on a sequence resolves through the sequencer it's running on, so the lookup is scoped to that specific sequencer's path, not a wildcard match against every sequence in the simulation. At block level nothing ever calls `set()` for `dma_seq_cfg`, so the `get()` finds nothing, `cfg` keeps its class defaults (`"src"`/`"dst"`), and that's exactly what `dma_base_test` declared. Nothing about the sequence changes when a level above it starts calling `set()` instead. `mem_region_manager::get()` needs no lookup at all, since there's only ever one instance to find.

## Chiplet level: one test, one manager, every block's regions declared together

The chiplet instantiates three DMA engines and one Ethernet block. `chiplet_base_test` is the single place responsible for every region any of the four needs, because it's the only test that can see all four at once:

```systemverilog
class chiplet_base_test extends uvm_test;
  function void build_phase(uvm_phase phase);
    mem_region_manager mgr = mem_region_manager::get();
    uvm_mem_mam_cfg cfg = new();
    cfg.start_offset = 'h8000_0000;
    cfg.end_offset   = 'h8FFF_FFFF;   // the chiplet's real, bounded range
    mgr.configure(cfg);

    mgr.declare_region("dma0_src", 'h8000_0000, 'h8000_FFFF);
    mgr.declare_region("dma0_dst", 'h8001_0000, 'h8001_FFFF);
    mgr.declare_region("dma1_src", 'h8002_0000, 'h8002_FFFF);
    mgr.declare_region("dma1_dst", 'h8003_0000, 'h8003_FFFF);
    mgr.declare_region("dma2_src", 'h8004_0000, 'h8004_FFFF);
    mgr.declare_region("dma2_dst", 'h8005_0000, 'h8005_FFFF);
    mgr.declare_region("eth0_tx_ring", 'h8006_0000, 'h8007_FFFF);
    mgr.declare_region("eth0_rx_ring", 'h8008_0000, 'h8009_FFFF);

    // each instance gets told which of the eight names are its own
    set_dma_cfg("dma0", "dma0_src", "dma0_dst");
    set_dma_cfg("dma1", "dma1_src", "dma1_dst");
    set_dma_cfg("dma2", "dma2_src", "dma2_dst");
  endfunction

  // scoped to that one instance's own sequencer path, so dma0/dma1/dma2
  // each resolve get_full_name() to a distinct cfg instead of sharing one
  local function void set_dma_cfg(string inst, string src_name, string dst_name);
    dma_seq_cfg cfg = dma_seq_cfg::type_id::create(inst);
    cfg.src_region_name = src_name;
    cfg.dst_region_name = dst_name;
    uvm_config_db#(dma_seq_cfg)::set(null, {"*.", inst, "*"}, "cfg", cfg);
  endfunction
endclass
```

![One manager, one declaration table, owned entirely by whichever test is running: block level declares two names, chiplet level declares eight in the same place, SoC level declares the full real map, the DMA and Ethernet sequences underneath never change](/images/mam/06-name-collision-recurrence.svg)

Nothing here is subtle or clever. Eight names, eight fixed ranges, all visible in one function, all owned by one person writing the chiplet test, whose job includes making sure none of the eight ranges overlap. That's a much easier property to verify by inspection than four block environments each independently deciding whether they're allowed to own a pool this time.

## SoC level: the same discipline, the real memory map

An SoC test instantiating two chiplets is not a special case. It's `chiplet_base_test`'s pattern applied once more, by a test that can see both chiplets and knows the package's actual physical memory map, the numbers that exist nowhere below this level:

```systemverilog
class soc_base_test extends uvm_test;
  function void build_phase(uvm_phase phase);
    mem_region_manager mgr = mem_region_manager::get();
    uvm_mem_mam_cfg cfg = new();
    cfg.start_offset = 'h1_0000_0000;
    cfg.end_offset   = 'h1_1FFF_FFFF;  // real package address space
    mgr.configure(cfg);

    mgr.declare_region("chiplet0_dma0_src", 'h1_0000_0000, 'h1_0000_FFFF);
    mgr.declare_region("chiplet0_dma0_dst", 'h1_0001_0000, 'h1_0001_FFFF);
    // ... the remaining six chiplet0 regions, same shape
    mgr.declare_region("chiplet1_dma0_src", 'h1_1000_0000, 'h1_1000_FFFF);
    mgr.declare_region("chiplet1_dma0_dst", 'h1_1001_0000, 'h1_1001_FFFF);
    // ... the remaining six chiplet1 regions
  endfunction
endclass
```

Every name in this table is longer and more specific than the chiplet-level version, `"chiplet0_dma0_src"` instead of `"dma0_src"`, because the SoC test is the one place that has to keep two chiplets' worth of names from colliding, the same way the chiplet test kept four blocks' worth of names from colliding. Nothing forces that uniqueness automatically. It's a spreadsheet-shaped table that one engineer owns and reviews, which is exactly the property that makes an address map trustworthy: a human can read the whole thing in one place and see whether it's right.

## What never changes underneath all of this

The DMA sequence's `body()` task, the Ethernet sequence's, every line of every block environment, are identical at all three levels. What changes, every time, is a table in a test, mapping names to addresses, owned by whoever can see the whole topology that specific test is exercising. Block level sees one DMA. Chiplet level sees four blocks. SoC level sees two chiplets. Each of those tests is the complete, sole authority for its own scope, and none of them ever have to ask a lower level's permission to reassign an address, because the lower level was never the one holding that decision in the first place.

---

*This example ties together the allocator from [Inside uvm_mem_mam](../inside-uvm-mem-mam), the reservation mechanism from [Keeping Allocations Out of the RAL Address Map](../ral-address-map-collisions), and the region-name discipline this article adds on top: one owner, one table, one level at a time.*
