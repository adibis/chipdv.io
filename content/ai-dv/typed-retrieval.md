---
title: "From 6,000 Files to 20"
weight: 9
date: 2026-09-27
publishDate: 2026-09-27
draft: false
description: "How ontology-aware graph retrieval produces causally complete subgraphs for LLM reasoning, and why typed traversal beats generic RAG for tractable bug classes."
prev: /ai-dv/orchestration-gap
next: /ai-dv/llm-fleet-traversal
---

The bottleneck in LLM-assisted bug finding is not reasoning capability. A frontier model given twenty causally relevant, well-typed files can reason about deadlock conditions, error masking paths, and spec compliance with genuine depth. The same model given six thousand files cannot, not because it's less intelligent, but because the signal-to-noise ratio makes the task intractable. The question is how to get from six thousand to twenty, reliably and completely.

![A deadlock query routed two ways: embedding similarity search misses the uncommented arbitration module because its text never mentions FSM, while typed graph traversal follows a DRIVES edge and finds it structurally](/images/ai-dv/09-rag-vs-graph.svg)

## What generic RAG gives you

Embedding-based retrieval finds chunks that are semantically close to the query. Ask "can this FSM deadlock?" and you retrieve chunks whose text contains FSM-related tokens, state-machine terminology, deadlock-adjacent language. The problem is that semantic similarity is not the same thing as causal relevance. A well-documented FSM module, full of comments describing its states and transitions, ranks highly. It reads like an answer. An uncommented glue module that happens to drive the enable signal that can starve the FSM's transition logic ranks nowhere near it, because nothing about its text resembles "FSM" or "deadlock." But it's the file that contains the bug.

Generic RAG finds the right neighborhood by probability. It has no mechanism to guarantee that the file structurally responsible for a bug is anywhere in the retrieved set, because it was never looking at structure, only at text similarity.

## How typed graph traversal is different

Graph traversal starts from a known point: a typed node, the FSM module, already identified and stored by the NER model from [Teaching a Model to Read SystemVerilog](../reading-systemverilog), and follows typed edges outward: `TRANSITIONS_TO` (an FSM-specific edge from RTL state-machine analysis, not part of the structural set), `DRIVES` traversed backward, `BELONGS_TO_DOMAIN`, `INSTANTIATES`. The traversal is deterministic and grounded in domain semantics, not in a similarity score. It collects the set of entities that structurally participate in the question, whether or not their surrounding prose happens to mention the right keywords.

If the enable signal for the FSM's transition comes from a separate arbitration module, that module has a `DRIVES` edge into the FSM's port in the graph. It is in the traversal by construction. Generic RAG, with no concept of that edge, would very plausibly miss it. There's nothing in the arbitration module's text that would rank it near an "FSM deadlock" query.

## The token economics

A 6,000-file SoC codebase at an average 500 lines per file is roughly 3 million lines of code, at about 4 tokens per line, 12 million tokens. No context window holds that. Generic RAG at top-k=20 pulls in maybe 4,000 tokens of chunks, cheap to process, but with no guarantee the critical file is among them. Typed graph traversal for a specific FSM-deadlock query pulls in the actual files that structurally participate, perhaps 50,000 tokens across the twenty files that matter, chunked into a handful of focused reasoning passes.

The comparison isn't 4,000 tokens versus 50,000. It's 4,000 tokens that might be missing the one file that contains the bug, versus 50,000 tokens that are bounded by graph structure and causally complete. Cheap-and-incomplete loses to expensive-and-complete every time the missing file is the one with the answer.

## Bug classes that become tractable

A few concrete examples of what graph-bounded traversal makes tractable:

**Deadlock and livelock.** Traverse the FSM's state-transition graph, collect every module that participates in a transition guard, and check for cycles in the guard dependency graph. Without the graph, this requires manually tracing which signals feed which transitions across an unknown number of files.

**Unreachable FSM states.** Enumerate all states, enumerate all transitions, and check for states with no incoming edge reachable from reset. This is a graph query. Without the graph it's a manual read of every state machine file in the design.

**Error masking.** Find every error-flag signal, follow `DRIVES` edges forward to everything that consumes it, and check whether any consumer gates or silently discards the error before it reaches an observable output. This is a multi-hop traversal, exactly the shape typed graph edges are built for.

**Spec compliance.** The spec says arbitration shall grant within N cycles; the RTL has a path where a low-priority request can be blocked with no timeout. Cross-reference the spec node, indexed from the specification document, against the RTL nodes implementing arbitration. Without typed edges connecting spec text to implementation, this is a manual mapping exercise that has to be redone every time either side changes.

## Why ontology matters: typed vs. generic embeddings

This only works because the SV/UVM-aware NER model from [Teaching a Model to Read SystemVerilog](../reading-systemverilog) produces typed entities in the first place. A generic code embedding treats `class axi_driver extends uvm_driver` and `class packet extends uvm_object` as similar, both are class declarations using `extends`. The fine-tuned model knows these are fundamentally different roles in the architecture: one is a driver that pushes transactions onto an interface, the other is a data object with no behavior of its own. That distinction is what makes a `UVM_DRIVER --DRIVES--> INTERFACE` edge mean something specific, rather than being indistinguishable from any other `extends` relationship in the codebase. The ontology isn't a layer on top of the graph, it's what makes traversal semantically meaningful instead of a generic dependency walk.

## The retrieval as a zero-cost subgraph

The graph is built once from the corpus and updated incrementally as files change, indexing cost is paid up front, not at query time. Traversing it to retrieve the twenty relevant files for a given question costs microseconds. The alternative, asking an LLM to first figure out which of six thousand files might be relevant, then reason about them, spends significant tokens and time on a question the graph already answers deterministically, and does it less reliably. The graph absorbs the "what to look at" problem entirely, so the LLM's reasoning budget goes entirely to "what does it mean," which is the question it's actually good at answering.

---

*Next: [LLM Fleets for Code Traversal](../llm-fleet-traversal), how to deploy agents against a typed subgraph for iterative structural reasoning.*
