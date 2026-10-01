---
title: "Fine-Tuning Specialized Models for SV/UVM"
weight: 6
date: 2026-09-24
publishDate: 2026-09-24
draft: false
description: "Closing the UVM gap GraphCodeBERT can't bridge: what specialized architectures cost, and the pre-training strategy behind cross-file inheritance resolution."
prev: /ai-dv/finetuning-tradeoffs
next: /ai-dv/entity-graph
---

[Fine-Tuning a Model: Pros, Cons, and Where It Breaks](../finetuning-tradeoffs) ended with a wall: GraphCodeBERT achieves F1 ≈ 0.972 overall but F1 ≈ 0.000 on UVM types specifically, because UVM class identity requires cross-file inheritance resolution that the architecture cannot perform. More data and longer training don't help; the bottleneck is structural.

This article looks at what it takes to go past that wall.

## The core problem: inheritance resolution

When you see this in a file:

```systemverilog
class chip_uart_agent extends uart_agent;
```

You need to know whether `uart_agent` is a `uvm_agent` descendant to classify `chip_uart_agent`. That answer is in a different file:

```systemverilog
// uart_agent.sv
class uart_agent extends uvm_agent;
```

And potentially a third file if `uart_agent` itself extends an intermediate class. Real UVM testbenches have inheritance chains 3 to 5 levels deep, occasionally more when project-specific base classes are layered between the UVM library and leaf components.

A token classifier with a fixed context window can't see this chain. The solution is to resolve the chain before the model sees the input.

## Approach 1: two-stage pipeline

The simplest approach doesn't require a new model at all. It adds a resolution pass after the token classifier:

```
Stage 1: GraphCodeBERT token classifier
    → labels standard entities with high accuracy
    → labels UVM types with ~0% accuracy (outputs O)

Stage 2: Inheritance graph resolver
    → parse all `class A extends B` declarations across the repo
    → walk the graph from leaf to root
    → if root is a uvm_* class, label intermediate nodes accordingly

Stage 3: Merge
    → standard entities from Stage 1 (high confidence)
    → UVM types from Stage 2 (correct for unparameterized chains)
```

This works for most real codebases. Its failure cases are:
- **Parameterized types:** `class my_seq #(type REQ=my_req) extends uvm_sequence #(REQ)`, where the `extends` target depends on a parameter
- **Conditional inheritance:** `\`ifdef USE_NEW_BASE` blocks that switch parent classes
- **Factory override resolution:** UVM allows runtime type substitution via `uvm_factory::set_type_override`; static analysis cannot predict what type gets created at runtime

Unlike the F1 numbers in [Teaching a Model to Read SystemVerilog](../reading-systemverilog), this isn't a measured result, there's no equivalent labeled UVM-inheritance benchmark to run the two-stage pipeline against yet. It's an estimate based on how rarely parameterized types, conditional inheritance, and factory overrides show up relative to ordinary `extends` chains in the corpora this series has worked with. Treat it as a plausibility argument for why the approach is worth building, not a number to cite.

## Approach 2: graph-augmented input

Instead of resolving inheritance before classification, you can include the inheritance graph as additional input to the model. This requires an encoder that handles graph-structured input alongside token sequences.

The architecture: a code encoder (like GraphCodeBERT) processes the token sequence for each file; a graph encoder (GCN or GAT) processes the cross-file inheritance graph; the two representations are fused and passed to the classification head.

Pre-training this from scratch on SV is expensive (weeks on a multi-GPU node). Fine-tuning a graph-augmented architecture from an existing pre-trained model is more tractable.

**What this buys:** the model sees the inheritance graph edge from `chip_uart_agent → uart_agent → uvm_agent` during classification, so it can learn to resolve it.

**What it costs:** more complex training infrastructure, a graph construction step at index time, and a larger model that takes longer to run. On a workstation M4 Pro, inference time goes from milliseconds to seconds per file when the graph encoder is involved.

## Approach 3: SV-specific pre-training

The most capable approach, and the most expensive, is pre-training a model specifically on SV/UVM source, with pre-training tasks designed to teach inheritance resolution.

**Pre-training tasks:**

1. **Masked token prediction:** standard BERT-style; teaches syntax.
2. **Cross-file masked prediction:** mask a token in file A that requires file B to predict (for example, mask the `extends B` in a class declaration where B is defined elsewhere). Forces the model to learn cross-file structure.
3. **Inheritance chain completion:** given a partial chain `A → B → ?`, predict the next ancestor. Directly teaches inheritance resolution.
4. **Type consistency:** given a class body, predict whether it's consistent with each possible parent type. Teaches type semantics.

**Corpus requirements:** SV-specific pre-training needs more data than fine-tuning. The open-source SV corpus we used (6,257 files, 1.27M lines) is sufficient for fine-tuning but marginal for pre-training. A meaningful pre-training run would want 5 to 10 times this, which means going beyond the indexed open-source repos to include permissively-licensed commercial code or synthesizing training examples.

**Hardware:** pre-training a 125M parameter model from scratch on a single M4 Pro would take weeks. A 7B parameter model is not feasible without a multi-GPU setup. The realistic option for a team without GPU cluster access is to fine-tune from an existing code model (Qwen2.5-Coder-7B or CodeLlama-7B) with the SV corpus plus task-specific data.

## Approach 4: retrieval-augmented NER

A lighter-weight alternative: instead of baking cross-file reasoning into the model, provide it at inference time.

At index time, build the inheritance graph and store parent class information for each class. At inference time, when classifying `chip_uart_agent`, retrieve its ancestors from the graph store and include them in the model's context:

```
Context for chip_uart_agent:
  - Declaration: class chip_uart_agent extends uart_agent
  - Ancestors: uart_agent → uvm_agent
  - Therefore: UVM_AGENT
```

This turns inheritance resolution into a retrieval problem rather than a model capability problem. The model doesn't need to reason across files; it receives the cross-file information as structured context.

The catch: this requires the graph store to be populated before NER can run on new classes. For a repo being indexed for the first time, you need a bootstrap pass: run the two-stage pipeline (Approach 1) to get an initial graph, then re-run NER with retrieval augmentation to get higher accuracy.

## What the v2 model targets

Based on the v1 gap analysis, the v2 NER model uses a hybrid approach:

1. **Inheritance graph resolver** (Approach 1) for the common case: fast, and accurate on ordinary `extends` chains, with the parameterized/conditional/factory-override cases below as its known gaps
2. **Retrieval-augmented context** (Approach 4) for the resolver's failure cases: parameterized types get explicit ancestor context
3. **Fine-tuned Qwen2.5-Coder-7B** (Approach 3, constrained) as the base model: larger context window handles more of the local structure; pre-trained on code including SV examples
4. **Weighted sampling** to address class imbalance: synthetic UVM class declarations generated to increase training density for rare types

The expected outcome: UVM type F1 ≥ 0.85, at the cost of longer inference time and a larger model (7B versus 125M). For offline indexing (not real-time), this tradeoff is acceptable.

## The hierarchy of models

The picture that emerges from articles 03 through 06:

![Staircase of four model tiers by accuracy and cost: GraphCodeBERT alone, plus an inheritance resolver, Qwen 7B with retrieval augmentation, and a runtime oracle requiring simulation](/images/ai-dv/06-model-hierarchy.svg)

The right model for a given use case depends on what accuracy you need and what latency you can accept. For bulk indexing, the 125M model plus resolver is usually the right answer. For precision-critical queries, "which agents does this testbench instantiate, exactly, under this factory configuration," you need simulation.

## Where this leaves the pipeline

Articles 03 through 06 have covered the extraction layer: reading raw SV, producing structured entity records, and the accuracy limits of that process.

What we haven't addressed is what you do with those records once you have them. The knowledge graph isn't a flat list, it's a typed, navigable structure. [From Entities to Edges](../entity-graph) looks at what relationships matter in UVM, how to represent them as graph edges, and what provenance means when your graph is derived from source that changes.
