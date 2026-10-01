---
title: "From Entities to Edges"
weight: 7
date: 2026-09-25
publishDate: 2026-09-25
draft: false
description: "Building a typed knowledge graph from extracted design entities. What relationships matter in UVM and RTL, how to represent them, and what provenance requires."
prev: /ai-dv/specialized-models
next: /ai-dv/orchestration-gap
---

The NER model gives you a flat list: this file contains a `UVM_DRIVER`, that one a `MODULE`, another a `COVERGROUP`. Useful, but flat. What makes a codebase understandable is not the inventory of what exists, it's the map of how things connect. A driver without the agent that owns it, the interface it drives, and the sequences it receives from its sequencer is just a name. This article is about turning the inventory into the map.

## What relationships matter in UVM

The UVM component hierarchy is a tree. That tree is statically determined by the class definitions, not by factory configuration, not by simulation, not by the test. You can extract it directly from source.

The structural edges that define a testbench:

- **`HAS_AGENT`**: a `uvm_env` declares handles of type `uvm_agent` or a subclass. Each handle represents a contained agent.
- **`HAS_DRIVER` / `HAS_MONITOR` / `HAS_SEQUENCER`**: a `uvm_agent` builds and holds a driver, monitor, and sequencer in its `build_phase`. These three always travel together in an active agent; a passive agent has monitor only.
- **`HAS_SCOREBOARD`**: a `uvm_env` builds and holds `uvm_scoreboard` subclasses in its `build_phase`.
- **`SEQUENCES_VIA`**: a `uvm_sequence` is started on a `uvm_sequencer`. For most sequences this is derivable from `uvm_declare_p_sequencer`, the macro that declares the sequencer type the sequence expects to run on.
- **`EXTENDS`**: the class hierarchy itself. `axi_driver extends uvm_driver #(axi_seq_item)` gives you two things at once: the UVM role and the transaction type the driver handles.

These are all derivable from static analysis. Not simulation. Not runtime. Walking the CST with Verible, as described in [Teaching a Model to Read SystemVerilog](../reading-systemverilog), gives you the class declarations, parent types, and member handle types. Building these edges is a mechanical pass over the parsed output.

What you don't get statically: which specific `axi_driver` instance a given `uvm_sequencer` talks to at runtime, because that depends on `connect_phase` wiring and potentially factory overrides. More on that in the confidence section below.

## What relationships matter at the RTL boundary

The DUT is a module hierarchy. The testbench connects to it through interfaces. Two sets of edges span that boundary:

**Module-to-interface connections** (`IMPLEMENTS`): a module's port list declares which signals it exposes. When those signals are grouped into an interface instance in the testbench harness, the module-to-interface relationship becomes explicit. Extracting this is mostly static; the module instantiation in `tb_top.sv` shows you which interface instances are connected to which module ports.

**Agent-to-interface connections** (`DRIVES`, `MONITORS`): the driver for a given agent drives a specific interface. This is derivable from the `virtual interface` handle type declared inside the driver class. `virtual axi4_if vif` inside `axi_driver` says: this driver operates on instances of `axi4_if`. That's an 80 to 90% confidence edge; it breaks when inheritance layers hide the virtual interface declaration, or when a driver accesses the interface through a configuration object rather than a direct handle.

**Design hierarchy** (`INSTANTIATES`): `module dma_top` instantiates `dma_ctrl`, `dma_arbiter`, and `axi_bridge`. These are extracted from module instantiation statements, syntactically distinct from class instantiation, so Verible gives them cleanly.

**Clock domain membership** (`BELONGS_TO_DOMAIN`): ports matching clock naming patterns (`clk`, `*_clk`, `clk_*`) define clock domains. Other ports in the same interface or module are attributed to the domain of their clock input via heuristic analysis of sensitivity lists and clocking block declarations. Confidence here is lower, 0.7 to 0.85, because clock domain attribution for signals that are sampled on multiple edges or that cross domains requires either manual annotation or simulation-derived data.

## The edge taxonomy

The core structural edges, the ones this article's static extraction produces, with source and target types and how each is derived. Behavioral edges like FSM state transitions come from a separate RTL-analysis pass and aren't part of this set; [From 6,000 Files to 20](../typed-retrieval) covers where those fit in:

| Edge | Source type | Target type | Extraction | Typical confidence |
|------|-------------|-------------|------------|-------------------|
| `EXTENDS` | Any class | Any class | Static (CST) | 1.0 |
| `HAS_AGENT` | `UVM_ENV` | `UVM_AGENT` | Static (member handles) | 0.95 |
| `HAS_DRIVER` | `UVM_AGENT` | `UVM_DRIVER` | Static (build_phase) | 0.95 |
| `HAS_MONITOR` | `UVM_AGENT` | `UVM_MONITOR` | Static (build_phase) | 0.95 |
| `HAS_SEQUENCER` | `UVM_AGENT` | `UVM_SEQUENCER` | Static (build_phase) | 0.95 |
| `HAS_SCOREBOARD` | `UVM_ENV` | `UVM_SCOREBOARD` | Static (build_phase) | 0.95 |
| `SEQUENCES_VIA` | `UVM_SEQUENCE` | `UVM_SEQUENCER` | Heuristic (`uvm_declare_p_sequencer`) | 0.85 |
| `DRIVES` | `UVM_DRIVER` | `INTERFACE` | Heuristic (virtual interface type) | 0.85 |
| `MONITORS` | `UVM_MONITOR` | `INTERFACE` | Heuristic (virtual interface type) | 0.85 |
| `IMPLEMENTS` | `MODULE` | `INTERFACE` | Static (port connections in tb_top) | 0.9 |
| `INSTANTIATES` | `MODULE` | `MODULE` | Static (module instantiation) | 1.0 |
| `COVERS` | `COVERGROUP` | Any entity | Heuristic (coverpoint variable types) | 0.75 |
| `BELONGS_TO_DOMAIN` | `PORT` | `CLOCK_DOMAIN` | Heuristic (naming + clocking blocks) | 0.8 |

Traversal semantics matter. `DRIVES` forward from a driver tells you what interface it stimulates. `DRIVES` backward from an interface tells you which agent is generating stimulus on it; if there are multiple backward `DRIVES` edges, that interface is being driven by more than one agent, which might be intentional (passive plus active) or a bug. Both directions are useful. The graph stores directed edges and queries can traverse either direction.

## Why static extraction is not enough, and where it stops

Three features of UVM make static-only extraction unreliable for a specific set of edges.

**The UVM factory.** `set_type_override_by_type` replaces one component type with another at runtime, transparently. A test that registers `debug_axi_driver` as an override for `axi_driver` means every `HAS_DRIVER` edge pointing at `axi_driver` is wrong for that test; the actual component instantiated is `debug_axi_driver`. Factory overrides are test-specific and runtime-determined. Static extraction can find the override registrations, but resolving which edges they affect requires matching override type pairs against the component hierarchy. We do this and flag affected edges with reduced confidence (typically 0.6 to 0.7) and an `override_uncertain` marker, rather than discarding them.

**`uvm_config_db`.** The canonical way to wire a virtual interface from the structural world to the component world is:

```systemverilog
// tb_top.sv
uvm_config_db #(virtual axi4_if)::set(null, "uvm_test_top.env.axi_agent.*",
                                       "vif", dut_if.axi_port);

// axi_driver.sv
uvm_config_db #(virtual axi4_if)::get(this, "", "vif", vif);
```

The path `"uvm_test_top.env.axi_agent.*"` is a runtime glob. Statically, we can parse the type parameter (`virtual axi4_if`), the key (`"vif"`), and the path string, and match them against the component hierarchy to derive which components receive which interface handles. When the path is a string literal, this works well, confidence 0.85. When the path is a computed string or contains a wildcard on a deep subtree, confidence drops and we flag the edge as `path_dynamic`.

**Virtual sequences.** A virtual sequence that starts sub-sequences on multiple sequencers through `p_sequencer` handles creates `SEQUENCES_VIA` edges that are architecturally correct but test-flow-dependent; which sequences actually run depends on which tests instantiate the virtual sequence. We derive `SEQUENCES_VIA` from `uvm_declare_p_sequencer` and the explicit `seq.start(p_sequencer.sqr_handle)` calls in the body task. This gives a structural picture: this virtual sequence *can* drive these sequencers. Whether it does in a given simulation is a runtime question.

The confidence model is explicit and stored with every edge, not implicit in the schema. A query that asks "which tests exercise the AXI write path?" can choose to include or exclude low-confidence edges depending on how much uncertainty is acceptable. A coverage closure analysis wants conservative results and would filter `confidence < 0.8`. A first-pass exploration of an unfamiliar codebase benefits from seeing all edges including uncertain ones.

## Provenance on every edge

In software, a stale cached result is mildly annoying. In DV, a stale graph edge is actively dangerous: it tells you the testbench is monitoring a signal that was refactored out of the interface three weeks ago. The query that traverses that edge produces a confident wrong answer.

Every edge carries:

| Field | Type | Semantics |
|-------|------|-----------|
| `source_file` | string | SV file the edge was derived from |
| `source_commit` | string | git commit SHA at indexing time |
| `content_hash` | string | SHA-256 of the source file |
| `indexed_at` | timestamp | when the edge was last derived |
| `confidence` | float | extraction confidence, 0.0 to 1.0 |
| `inferred_by` | enum | `verible_cst`, `heuristic`, `llm` |
| `stale` | bool | set when content_hash changes and edge hasn't been re-derived |

The invalidation model is per-file. When `axi_driver.sv` changes, every edge derived from `axi_driver.sv` is marked `stale = true` and queued for re-derivation. The re-derivation is incremental, only the affected files and their dependent edges, not a full re-index of the corpus. The daemon watches the git post-commit hook and triggers incremental re-indexing automatically.

There's an asymmetry worth understanding. `EXTENDS` and `INSTANTIATES` edges are derived from single files and re-derivation is local. `DRIVES` and `MONITORS` edges are derived by correlating a virtual interface handle type in one file with an interface declaration that may be in a completely different file. When the interface file changes, every `DRIVES` and `MONITORS` edge pointing at that interface needs re-evaluation, even if the driver and monitor files themselves haven't changed. The graph records source file per edge, not per node, so this fan-out invalidation is efficient: query `WHERE edge.source_file = 'axi4_if.sv' OR edge.target_id IN (nodes derived from 'axi4_if.sv')`.

## What the graph looks like in practice

A DMA controller connected to an AXI4 data bus and an APB configuration bus, with a single active AXI agent and a passive APB monitor. The RTL side (`dma_top` instantiating `dma_ctrl` and `dma_arbiter`, each interface tagged with its clock domain) uses the same `INSTANTIATES`/`IMPLEMENTS`/`BELONGS_TO_DOMAIN` edges described above; the testbench side is the denser part, so that's what's drawn out below:

![Worked example graph: dma_env with an active axi_agent (driver, monitor, sequencer) driving axi4_if, a passive apb_agent, a scoreboard, and three tests instantiating dma_env, connected by typed edges like HAS_AGENT, DRIVES, MONITORS, and INSTANTIATES](/images/ai-dv/07-entity-graph-example.svg)

With this graph, questions that would take a new engineer two weeks to answer become single queries:

**"Which tests exercise the AXI write path?"**

```cypher
MATCH (test:UvmTest)-[:INSTANTIATES]->(env:UvmEnv)
      -[:HAS_AGENT]->(ag:UvmAgent)
      -[:HAS_DRIVER]->(drv:UvmDriver)
      -[:DRIVES]->(iface:Interface {name: 'axi4_if'})
RETURN test.name, drv.name
```

Returns all three tests, because all three instantiate `dma_env`, which has the AXI agent. This is the traversal. The answer isn't "which test files contain the string axi4." It's "which tests have a driver that physically reaches the AXI interface."

**"Are there any DUT interfaces not monitored by any agent?"**

```cypher
MATCH (m:Module)-[:IMPLEMENTS]->(iface:Interface)
WHERE NOT (iface)<-[:MONITORS]-()
RETURN m.name, iface.name
```

If this returns anything, that interface has no observability, stimulated but not checked. This is a coverage gap query, answerable in milliseconds over the graph. Finding this by reading the code would require tracing every interface declaration, matching it against every monitor's virtual interface handle, and doing the set difference manually.

**"What agents share the 200MHz clock domain with the DMA controller?"**

```cypher
MATCH (domain:ClockDomain {name: 'clk_200mhz'})
      <-[:BELONGS_TO_DOMAIN]-(iface:Interface)
      <-[:MONITORS|DRIVES]-(component)
RETURN DISTINCT component.name, labels(component)
```

Returns `axi_driver` and `axi_monitor`, both of which operate on `axi4_if`, which belongs to `clk_200mhz`. This matters for timing analysis and for understanding which agents need to be coordinated on clock crossing scenarios.

These aren't contrived examples. They're the questions that come up in the first week on a new project. The graph makes them trivial. Without it, they require either asking a colleague who knows the codebase, or reading for days.

## Storage decisions

The obvious path is a dedicated graph database, Neo4j or Memgraph, alongside a vector store for embeddings. Two services to deploy, two connection pools to manage, and no transactions that span both. When a codebase re-index updates graph edges and embedding vectors atomically, split storage means either accepting a window of inconsistency or building cross-service transaction logic.

We use **Apache AGE** and **pgvector** on PostgreSQL. Apache AGE adds openCypher graph query support to PostgreSQL as an extension. pgvector adds vector similarity search. Both run inside the same PostgreSQL instance: same WAL, same ACID guarantees, same connection.

The node embedding from [Teaching a Model to Read SystemVerilog](../reading-systemverilog) (768-dimensional, derived from the fine-tuned GraphCodeBERT encoder) is stored as a `vector(768)` column on the node row. A query that finds structurally similar modules and then traverses to their interface connections is a single statement, not a vector query whose results are then fed into a separate graph query:

```sql
-- Find UVM agents structurally similar to axi_agent
-- and return the interfaces they drive
SELECT n2.name, n2.kind, e.label
FROM ag_catalog.cypher('dv_graph', $$
    MATCH (agent:UvmAgent)-[e:DRIVES]->(iface:Interface)
    RETURN agent.id, iface.name, type(e) as label
$$) AS (agent_id agtype, iface_name agtype, label agtype)
JOIN graph_nodes n1 ON n1.id = agent_id::text
JOIN graph_nodes n2 ON n2.name = iface_name::text
WHERE n1.embedding <=> (
    SELECT embedding FROM graph_nodes WHERE name = 'axi_agent'
) < 0.3
ORDER BY n1.embedding <=> (
    SELECT embedding FROM graph_nodes WHERE name = 'axi_agent'
);
```

The `<=>` operator is pgvector's cosine distance. The Cypher clause runs inside AGE. Both execute in one PostgreSQL query plan, with one round-trip.

The schema is contract-first. Every node type and edge type has a JSON Schema document validated on insert. An `icr_validate_record` call on every entity and relation record before it touches the database means the graph is structurally sound by construction: a `UVM_AGENT` node always has `name`, `file`, `line_start`, `confidence`. An edge always has `source_id`, `target_id`, `label`, `confidence`, `content_hash`. No partial records, no null-checking in queries.

---

*Next: [The Orchestration Gap](../orchestration-gap), why session-based agents fail on 20-hour simulation runs, and the daemon architecture that works instead.*

*Key numbers: 13 structural edge types · confidence 0.6-1.0 range · 7 provenance fields per edge · AGE + pgvector on single PostgreSQL instance*
