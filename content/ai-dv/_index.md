---
title: "The DV Intelligence Stack"
weight: 1
description: "A series on building AI-native tooling for chip design verification, from understanding why LLMs fail, through entity extraction, local model evaluation, fine-tuning, and knowledge graphs."
icon: sparkles
image: /images/ai-dv/09-rag-vs-graph.svg
imageAlt: "Typed graph traversal versus generic embedding retrieval for a deadlock query"
cascade:
  type: docs
---

Chip design verification is one of the few engineering disciplines where the gap between what AI can theoretically do and what it actually does in practice is still very wide. Not because the models aren't capable, frontier LLMs can reason about SystemVerilog with genuine depth. The gap is architectural. Session-based agents, generic retrieval, and context-window-sized thinking don't match the temporal scale and structural complexity of real DV work.

This series documents the engineering required to close that gap. Each article is self-contained but builds on the previous one. The through-line: a persistent, structured knowledge layer built from the codebase itself, with LLMs invoked on-demand as reasoners, not as orchestrators.

## Why LLMs fail at DV

{{< cards cols="3" >}}
  {{< card link="/ai-dv/why-llms-fail/" title="Why LLMs Fail at Chip Design Verification" subtitle="Current LLMs struggle with SV and UVM in predictable, fixable ways. Here's what's broken and why it matters." image="/images/ai-dv/01-scale-mismatch.svg" alt="A testbench of thousands of files next to an LLM context window that fits about fifty" >}}
  {{< card link="/ai-dv/virtual-disambiguation/" title="'virtual' Is Four Keywords in One" subtitle="The keyword 'virtual' means four unrelated things in SV and UVM. A precise map of each, and what happens when an LLM gets it wrong." image="/images/ai-dv/02-virtual-keyword-split.svg" alt="The keyword virtual split into two unrelated meanings" >}}
{{< /cards >}}

## Teaching a model to read SystemVerilog

{{< cards cols="3" >}}
  {{< card link="/ai-dv/reading-systemverilog/" title="Teaching a Model to Read SystemVerilog" subtitle="Fine-tuning GraphCodeBERT for SV/UVM named entity recognition, the extraction layer that makes everything else possible." image="/images/ai-dv/03-cst-pipeline.svg" alt="Pipeline from raw SV text through Verible into a Concrete Syntax Tree" >}}
  {{< card link="/ai-dv/ner-plus-local-llm/" title="NER + Local LLM: What Do We Actually Get?" subtitle="The NER model cuts 6,000 token codebases to 200-token entity records. Does that compression finally make local models usable for DV reasoning?" image="/images/ai-dv/04-compression-pipeline.svg" alt="Compression pipeline from raw SV through the NER model into a local LLM" >}}
  {{< card link="/ai-dv/finetuning-tradeoffs/" title="Fine-Tuning a Model: Pros, Cons, and Where It Breaks" subtitle="What fine-tuning GraphCodeBERT for SV/UVM NER involved, what worked, and the limits of general-purpose models adapted to a specialist domain." image="/images/ai-dv/05-f1-gap.svg" alt="F1 gap between standard SV entity types and UVM types" >}}
  {{< card link="/ai-dv/specialized-models/" title="Fine-Tuning Specialized Models for SV/UVM" subtitle="Closing the UVM gap GraphCodeBERT can't bridge: what specialized architectures cost, and the pre-training strategy behind cross-file inheritance resolution." image="/images/ai-dv/06-model-hierarchy.svg" alt="Staircase of four model tiers by accuracy and cost" >}}
{{< /cards >}}

## The knowledge graph and daemon architecture

{{< cards cols="3" >}}
  {{< card link="/ai-dv/entity-graph/" title="From Entities to Edges" subtitle="Building a typed knowledge graph from extracted design entities. What relationships matter in UVM and RTL, how to represent them, and what provenance requires." image="/images/ai-dv/07-entity-graph-example.svg" alt="Worked example graph connecting agents, interfaces, and tests by typed edges" >}}
  {{< card link="/ai-dv/orchestration-gap/" title="The Orchestration Gap" subtitle="Why session-based LLM agents fail on 20-hour simulation runs, and the daemon-first architecture that works instead." image="/images/ai-dv/08-daemon-inversion.svg" alt="A session-based orchestrator contrasted with a persistent daemon dispatching stateless LLM calls" >}}
  {{< card link="/ai-dv/typed-retrieval/" title="From 6,000 Files to 20" subtitle="How ontology-aware graph retrieval produces causally complete subgraphs for LLM reasoning, and why typed traversal beats generic RAG for tractable bug classes." image="/images/ai-dv/09-rag-vs-graph.svg" alt="A deadlock query routed through embedding similarity search versus typed graph traversal" >}}
  {{< card link="/ai-dv/llm-fleet-traversal/" title="LLM Fleets for Code Traversal" subtitle="Deploying LLM agents against a typed subgraph for iterative structural reasoning: the traversal pattern for deadlocks, error masking, and spec compliance bugs." image="/images/ai-dv/10-traversal-steps.svg" alt="Five bounded traversal steps for AXI interconnect deadlock analysis" >}}
{{< /cards >}}

## Putting the reasoning layer to work

{{< cards cols="3" >}}
  {{< card link="/ai-dv/llm-strengths/" title="What LLMs Are Actually Good At in Verification" subtitle="On-demand reasoning for coverage analysis, assertion explanation, and regression triage, where single-call LLM reasoning outperforms structured traversal." image="/images/ai-dv/11-single-call-vs-traversal.svg" alt="DV tasks suited to single-call reasoning versus tasks needing traversal" >}}
  {{< card link="/ai-dv/regression-triage/" title="Regression Triage Without Gut Feeling" subtitle="Using RTL change impact analysis and graph traversal to predict which tests will catch a given commit, cutting simulation time without raising risk." image="/images/ai-dv/12-change-impact-graph.svg" alt="A commit's changed files traversed into a ranked test list by structural distance" >}}
  {{< card link="/ai-dv/querying-the-testbench/" title="Querying Your Testbench" subtitle="What becomes possible when the design graph is live and queryable: natural language and structured queries against the verification environment." image="/images/ai-dv/13-nl-query-pipeline.svg" alt="A natural language question translated into a graph query and executed as a deterministic traversal" >}}
  {{< card link="/ai-dv/local-deployment/" title="Local Deployment for DV Teams" subtitle="Packaging the full stack, extractor, daemon, graph store, query interface, so the team can use it without touching training infra or Python environments." image="/images/ai-dv/14-deployment-architecture.svg" alt="Deployment architecture built around a single statically linked daemon binary" >}}
{{< /cards >}}

## The full picture

{{< cards cols="1" >}}
  {{< card link="/ai-dv/ai-native-flow/" title="What an AI-Native Verification Flow Looks Like" subtitle="All layers together. What changes for an engineer who uses this stack daily, and what it still doesn't solve." image="/images/ai-dv/15-full-stack.svg" alt="The full stack from SV/UVM source through NER extraction, the graph, the daemon, and on-demand LLM calls" >}}
{{< /cards >}}
