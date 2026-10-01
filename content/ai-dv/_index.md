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

## Published

{{< section-cards >}}
