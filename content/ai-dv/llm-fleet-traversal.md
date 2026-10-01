---
title: "LLM Fleets for Code Traversal"
weight: 10
date: 2026-09-28
publishDate: 2026-09-28
draft: false
description: "Deploying LLM agents against a typed subgraph for iterative structural reasoning: the traversal pattern for deadlocks, error masking, and spec compliance bugs."
prev: /ai-dv/typed-retrieval
next: /ai-dv/llm-strengths
---

Graph retrieval gives you the right twenty files. The question that remains is how to deploy LLM reasoning against them effectively, and why doing it naively, dumping all twenty files into a single context window and asking for bugs, produces worse results than a structured traversal. This article is about the traversal pattern: how agents form hypotheses, follow references, accumulate findings without accumulating context, and know when to stop.

## Why single-shot reasoning underperforms on structural bugs

Even with twenty causally relevant files in context, a single "find bugs" prompt tends to surface what's easy to see: style issues, obvious anti-patterns, a missing assertion here or there. What it reliably misses is multi-hop causality: the FSM can only reach state X when module B has previously set signal Y, which only happens when condition Z has held true for N consecutive cycles. Reasoning like that requires building up a model of the system incrementally: form a partial hypothesis, notice what it depends on, go look at that dependency, revise. Reading twenty files in parallel and reporting observations skips the part where the model actually chases an implication to its source.

## The traversal pattern

Start from a root entity, the FSM module, the arbitration block, the error handler, and ask for an initial hypothesis about a specific bug class: "what conditions could prevent this FSM from leaving state IDLE?" The response references signals or modules that aren't yet in context. Retrieve those from the graph. Feed them into the next call along with the hypothesis accumulated so far. Repeat until the hypothesis is confirmed, refuted, or the referenced set closes, no new external dependencies show up.

This is a different shape from the orchestrator pattern in [The Orchestration Gap](../orchestration-gap). There, context grows to cover the entire result set of every spawned agent. Here, context grows only to cover the reasoning path actually taken, the files that turned out to matter for this specific hypothesis, not every file that could conceivably matter.

## Per-layer specialization

It helps to split reasoning by abstraction layer rather than run one generalist agent over everything. A spec agent reads the architectural specification and extracts testable properties: "the arbiter shall grant within 8 cycles under full load." An RTL agent reads the implementation and looks for code paths that could violate that property. A firmware agent checks whether any firmware sequence can create the conditions that trigger the violation. A testbench agent checks whether any existing test or coverage point would catch it if it occurred.

None of these agents need to share context with each other. The spec agent never sees the RTL. It only needs to produce a structured property that the RTL agent can check against. Specialization by layer keeps each individual call's context small and focused, which is exactly what makes multi-hop reasoning tractable in the first place.

## Intermediate state without intermediate context

Agents write findings to structured storage, not into each other's context window. When the RTL agent finds a suspicious path, it writes something like:

```json
{
  "entity": "arb_fsm",
  "state": "GRANT_PENDING",
  "condition": "req_timeout unset and grant_mask cleared",
  "hypothesis": "possible livelock if both conditions hold simultaneously",
  "confidence": 0.7
}
```

The coordinator reads that finding and decides whether it's worth spinning up a simulation-analysis agent to check whether those two conditions can actually co-occur anywhere in the existing regression suite. No context passes between the RTL agent and the simulation agent, only this typed record. The daemon's state store from [The Orchestration Gap](../orchestration-gap) is the coordination layer; it was never a shared conversation.

## What the coordinator actually does

The coordinator is not an LLM. It's a routing function inside the daemon: a deterministic process that reads findings, decides what analysis step should happen next, retrieves the relevant subgraph for that step, and invokes the appropriate specialized agent with a focused context. Because it's ordinary code, its logic is inspectable and debuggable in a way an LLM's implicit routing decisions aren't. It doesn't accumulate context because it isn't reasoning, it's reading state and dispatching. This is the inversion that makes long-running structural analysis affordable: intelligence is distributed across many short-lived, narrow LLM calls, and coordination is handled by a persistent process that never touches a context window.

## Bounding cost and detecting dead ends

Unbounded traversal is a real risk, so the practical version has limits: a maximum traversal depth per bug class, a maximum number of LLM calls per analysis session, and confidence thresholds. If nothing above 0.3 confidence has turned up after N steps, the analysis is inconclusive, not a confirmed bug, and it stops there. Two other signals end a traversal early: if two consecutive steps return the same referenced set, the graph has closed and there's nothing further to follow. If a hypothesis is directly contradicted by an existing passing test, it's discarded without further exploration. These bounds are what keep a fleet of agents from turning into an unbounded token bill.

## A worked example: deadlock analysis on an AXI interconnect

![Five bounded traversal steps for AXI interconnect deadlock analysis: from the interconnect through the write buffer and read arbiter, to the override dependency, the sampling gap, and the check against existing tests](/images/ai-dv/10-traversal-steps.svg)

Start from the AXI interconnect module. Hypothesis: can outstanding write transactions block read transactions indefinitely? Step 1 collects the write buffer module, the read priority arbiter, and the sources of the backpressure signal. Step 2: the model notices that read priority can be overridden if write buffer occupancy exceeds a threshold, that's a new dependency. Step 3 retrieves the write buffer's control logic. Step 4: the model finds the threshold check has a one-cycle sampling gap. Step 5 checks whether any existing test exercises that corner, it doesn't.

Finding written to the state store:

```json
{
  "type": "POTENTIAL_DEADLOCK",
  "confidence": 0.65,
  "files": ["axi_write_buffer.sv", "axi_read_arbiter.sv"],
  "condition": "write buffer occupancy transitions exactly at threshold during read grant window"
}
```

Five bounded steps, each with a small, specific context. Doing this manually would mean an engineer holding the entire write/read interaction in their head across several files, at a scale where the interesting case is a single-cycle timing window nobody would think to look for without a reason to suspect it.

---

*Next: [What LLMs Are Actually Good At in Verification](../llm-strengths), the tasks where on-demand single-call reasoning outperforms structured traversal.*
