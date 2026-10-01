---
title: "NER + Local LLM: What Do We Actually Get?"
weight: 4
date: 2026-09-22
publishDate: 2026-09-22
draft: false
description: "The NER model cuts 6,000 token codebases to 200-token entity records. Does that compression finally make local models usable for DV reasoning?"
prev: /ai-dv/reading-systemverilog
next: /ai-dv/finetuning-tradeoffs
---

[Teaching a Model to Read SystemVerilog](../reading-systemverilog) built a fine-tuned NER model that reads SystemVerilog and produces structured entity records. The compression is significant: a 6,000-file repo becomes a few hundred labelled records. That sounds like it should solve the local LLM problem. You're no longer sending thousands of tokens of raw SV to a small model running on your workstation. You're sending a compact structured summary.

Does it actually work? This article runs that experiment.

![Compression pipeline: raw SV at ~2800 tokens through the NER model into a ~120 token entity record, a 20:1 ratio, then into a local LLM for reasoning](/images/ai-dv/04-compression-pipeline.svg)

## Two different problems

Before looking at the data, it's worth being precise about what we're asking local models to do.

**Extraction** is reading raw SystemVerilog and identifying entities and relationships: "this file contains a `UVM_DRIVER`, that declaration is a `VIRTUAL_IF` handle, this method overrides the parent class." ['virtual' Is Four Keywords in One](../virtual-disambiguation) already measured this, and it's hard for small models. Qwen2.5-Coder-7B running locally via Ollama failed on a controlled extraction task 80 to 100% of the time depending on the prompting strategy, even with the schema provided.

**Reasoning** is something different. Given *already-structured* information, a list of entities, their types, and the relationships between them, can the model answer questions about that structure? "Which virtual interfaces does this config class hold?" "Which sequences are registered with this sequencer?" "What does this driver's `run_phase` do?"

Extraction requires reading code. Reasoning requires reading data. These are not the same capability requirement, and a model that fails at the first can still be useful for the second.

## What the NER output looks like

The GraphCodeBERT model from [Teaching a Model to Read SystemVerilog](../reading-systemverilog) produces records like these for a UVM env:

```
# dv_env.sv
ENTITY: chip_env  TYPE: UVM_ENV
  HAS_AGENT: uart_agent
  HAS_AGENT: spi_agent
  HAS_SCOREBOARD: chip_scoreboard
  HAS_COVERAGE: chip_coverage

ENTITY: uart_agent  TYPE: UVM_AGENT  FILE: uart/uart_agent.sv
  HAS_DRIVER: uart_driver
  HAS_MONITOR: uart_monitor
  HAS_SEQUENCER: uart_sequencer
  HAS_VIRTUAL_IF: uart_if  (handle: vif)

ENTITY: chip_env_cfg  TYPE: UVM_ENV_CFG  FILE: chip_env_cfg.sv
  HAS_VIRTUAL_IF: uart_if   (handle: uart_vif)
  HAS_VIRTUAL_IF: spi_if    (handle: spi_vif)
  OVERRIDES: initialize
  OVERRIDES: reset_asserted
```

This shows the target shape of a fully resolved record, not a literal transcript of today's model output; the section below on NER accuracy covers how far the current model is from resolving every `HAS_AGENT`/`HAS_DRIVER`-style UVM relationship this reliably. This is approximately 120 tokens. The raw `.sv` files it was derived from total around 2,800 tokens. The compression ratio is roughly 20:1. More importantly, the structured form removes everything that small models find ambiguous: preprocessor macros, parameterized class declarations, `begin/end` nesting, SV-specific syntax that doesn't appear in the model's general training corpus.

## Experiment: reasoning from NER context

We took 10 DV reasoning questions and asked Qwen2.5-Coder-7B to answer them twice: once with raw SV as context, once with the NER entity records.

**Setup:**
- Model: `qwen2.5-coder:7b` via Ollama, temperature 0
- Raw SV context: the relevant `.sv` files (avg 1,800 tokens per question)
- NER context: entity records extracted by the [Teaching a Model to Read SystemVerilog](../reading-systemverilog) model (avg 90 tokens per question)
- Questions: factual queries about testbench structure (no reasoning chains required)

**Sample questions:**
1. Which virtual interfaces does `chip_env_cfg` hold?
2. What UVM agents does `chip_env` instantiate?
3. Which methods does `chip_env_cfg` override from its base class?
4. What sequencer type does `uart_agent` use?
5. Which scoreboard receives transactions from `uart_monitor`?

**Results:**

| Context type | Correct | Partially correct | Wrong / refused |
|---|---|---|---|
| Raw SV (1,800 tok avg) | 4/10 | 2/10 | 4/10 |
| NER entity records (90 tok avg) | 8/10 | 1/10 | 1/10 |

The improvement is real. When the model is reading structured records it was designed to reason about (key: value pairs, named relationships), it performs significantly better than when navigating SystemVerilog syntax it was not specifically trained on.

The two failures in the NER condition were both questions requiring the model to infer something not directly stated in the records, specifically, whether a given interface was active (connected to a driver) or passive (monitor only). That answer is in the code, not in the entity records as currently structured.

The four failures in the raw SV condition were a mix: two were hallucinations (the model invented interface names not present in the file), two were refusals ("I don't have enough context to answer").

## What still doesn't work

The experiment above tests **reasoning**, with the model as a reader; the NER model did the extraction. But the full pipeline has two stages:

1. NER model reads raw SV, produces entity records (extraction)
2. Local LLM reads entity records, answers questions (reasoning)

Stage 2 works reasonably well. Stage 1 is the problem.

We already measured stage 1 in ['virtual' Is Four Keywords in One](../virtual-disambiguation). The triple-extraction experiment put Qwen2.5-Coder-7B against a controlled SV snippet with three prompting strategies:

| Strategy | Error rate | Failure mode |
|---|---|---|
| Vanilla (no schema) | 5/5 runs | Format failure, zero parseable triples |
| Soft-hint (describe relations) | 5/5 runs | Format failure, zero parseable triples |
| Ontology (schema in prompt) | 4/5 runs | Semantic misassignment, right vocab, wrong relationships |

In the one clean run, Qwen produced the correct triples. In the four failed Ontology runs, it produced this:

```
(zero_delays_c, OVERRIDES, dv_base_env_cfg)
(clk_freq_mhz_c, OVERRIDES, dv_base_env_cfg)
(initialize, HAS_VIRTUAL_IF, dv_base_env_cfg)       ← wrong: initialize is a method
(pre_build_ral_settings, HAS_VIRTUAL_IF, dv_base_env_cfg)  ← wrong
(reset_asserted, HAS_VIRTUAL_IF, dv_base_env_cfg)   ← wrong
```

It learned the vocabulary from the ontology but applied it backwards: `HAS_VIRTUAL_IF` to override methods, `OVERRIDES` to parameters. The model has no structural understanding of what makes a declaration a virtual interface handle versus an overridable method. It pattern-matched the labels without understanding the distinctions.

Same capability floor as before: below a certain model size and training distribution, better prompting doesn't help.

## The pipeline that works today

Given these results, the practical pipeline looks like this:

![The production pipeline: raw SV files through a fine-tuned NER model into a knowledge graph store, queried by a local LLM that reasons from structured context, answering the engineer](/images/ai-dv/04-pipeline-today.svg)

The fine-tuned NER model at the top of the stack is load-bearing. It's the component that does the hard work of reading SV and producing correct structured output. The local LLM at the bottom can be a small model running on a workstation; its job is reading structured data, not parsing code.

This gives you a full local pipeline for retrieval and reasoning: no API calls, no cloud dependency, workstation GPU. The constraint is that the NER model needs to be good, because its errors propagate to everything downstream. A misclassified entity produces bad records, which produce wrong answers.

## What good NER accuracy actually requires

The [Teaching a Model to Read SystemVerilog](../reading-systemverilog) model achieved F1 = 0.972 overall, an aggregate across all 31 labels that's dominated by the standard entity types (MODULE, PORT, PARAMETER, COVERGROUP, PACKAGE). UVM types, the ones that matter most for testbench intelligence, had F1 ≈ 0.000 on their own and are too sparse in the corpus to move that aggregate. The UVM class hierarchy is inferred through indirect inheritance chains that GraphCodeBERT, without SV-specific training, can't reliably resolve.

That accuracy gap is what the next two articles address. [Fine-Tuning a Model: Pros, Cons, and Where It Breaks](../finetuning-tradeoffs) looks at fine-tuning as a strategy: what it gains, what it costs, and where it fails. [Fine-Tuning Specialized Models for SV/UVM](../specialized-models) looks at specialized architectures that can close the remaining gap.

---

*Experiment setup: Qwen2.5-Coder-7B via Ollama 0.6.x on Apple M4 Pro 24GB. NER entity records produced by the GraphCodeBERT model from [Teaching a Model to Read SystemVerilog](../reading-systemverilog), run on a subset of the OpenTitan testbench corpus. Raw SV context was the source files those records were derived from, truncated to 2,048 tokens when necessary.*
