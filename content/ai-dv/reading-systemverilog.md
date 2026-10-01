---
title: "Teaching a Model to Read SystemVerilog"
weight: 3
date: 2026-09-21
publishDate: 2026-09-21
draft: false
description: "Fine-tuning GraphCodeBERT for SV/UVM named entity recognition, the extraction layer that makes everything else possible."
prev: /ai-dv/virtual-disambiguation
next: /ai-dv/ner-plus-local-llm
---

When you join a large chip design project, there's an uncomfortable stretch where you're operating blind. The repo exists, the code is there, but the mental model isn't. You need to know which UVM agents are in the testbench, what interfaces the DUT exposes, where the scoreboards live, which sequences drive which agents. The answers are all in the source, distributed across a few hundred `.sv` and `.svh` files, and the only way to get them is to grep, ask, and read until the picture assembles itself.

That process takes weeks. We wanted to cut it to seconds.

![Pipeline from raw SV text through Verible into a Concrete Syntax Tree, walking kClassDeclaration and kExtendsList nodes with exact byte offsets](/images/ai-dv/03-cst-pipeline.svg)

## The tools that exist and where they fall short

The obvious starting point is `ctags`. It indexes identifiers across a codebase fast. Point it at a SV tree and you get every class, module, and interface name with a file and line number. For basic navigation that's useful.

But it treats every class declaration identically. `class axi_driver extends uvm_driver` and `class packet extends uvm_sequence_item` are both just "class." The UVM hierarchy, the thing that actually tells you what role each component plays in the testbench, is invisible to it.

Regex gets you one step further. You can write patterns like `class\s+(\w+)\s+extends\s+uvm_driver` and extract class names by parent type. We actually built this as a fallback. The problems: it fires inside comments (`// class foo extends uvm_driver` is not a real driver), it chokes on parameterized parents (`extends uvm_driver #(req_t, rsp_t)`), and it misses transitive hierarchies entirely. A class extending your team's internal `base_driver`, which itself extends `uvm_driver`, is invisible to a regex looking for `extends uvm_driver`.

Why not just ask an LLM? Paste the file, ask what UVM components are defined here, and you'll get a perfectly good answer for that one file. We've done this. It works.

The problem is scale and structure. A real codebase isn't one file, it's thousands. You can't fit 6,000 source files into a context window. Processing files one at a time means thousands of API calls and minutes of waiting for something that should take seconds. More fundamentally, LLM output is natural language. "There's a UVM driver called `axi_driver` in this file" is useful for reading; it's useless for building a queryable index or feeding downstream analysis programmatically. Parsing that prose back into structure adds a fragile, non-deterministic step to a pipeline that didn't need it.

A fine-tuned encoder gives you something different: a deterministic, structured extraction pipeline. Same file in, same labeled tokens out, every time. Runs on CPU in milliseconds per file. No API, no cost per call, no natural language to parse. LLMs and fine-tuned encoders solve different problems. LLMs are excellent at understanding code you hand them; encoders are the right tool when you need systematic structured extraction at scale across an entire codebase.

## Why GraphCodeBERT

[GraphCodeBERT](https://arxiv.org/abs/2009.10360) is a pre-trained code encoder from Microsoft, 125M parameters, RoBERTa architecture, trained on code in multiple languages using both token sequences and data flow graphs extracted from source. The data flow component is the key differentiator: rather than learning purely from which tokens appear near each other, it learns how variables are defined, passed, and used. That gives it structural awareness that matters for understanding code semantics.

It's an encoder, not a generative model. It doesn't write or complete code. Fine-tuned for token classification, each token gets a label from a predefined set, Named Entity Recognition, the same technique that identifies people and places in news articles, applied to design entities in SystemVerilog.

SystemVerilog isn't in its pre-training corpus. But enough transfers: bracket structure, keyword roles, type hierarchies, identifier conventions. Fine-tuning on a domain-specific corpus adapts those representations to SV/UVM without having to learn language structure from scratch.

The 15 entity types we care about:

| Entity | What it captures |
|---|---|
| `MODULE` | `module` declarations |
| `INTERFACE` | `interface` declarations |
| `PACKAGE` | `package` declarations |
| `PORT` | `input` / `output` / `inout` port names |
| `PARAMETER` | `parameter` declarations |
| `COVERGROUP` | `covergroup` declarations |
| `CLOCK_DOMAIN` | Port names matching `*clk*` patterns |
| `UVM_ENV` | Classes extending `uvm_env` |
| `UVM_AGENT` | Classes extending `uvm_agent` |
| `UVM_DRIVER` | Classes extending `uvm_driver` |
| `UVM_MONITOR` | Classes extending `uvm_monitor` |
| `UVM_SCOREBOARD` | Classes extending `uvm_scoreboard` |
| `UVM_SEQUENCE` | Classes extending `uvm_sequence` |
| `UVM_SEQ_ITEM` | Classes extending `uvm_sequence_item` |
| `UVM_TEST` | Classes extending `uvm_test` |

Each uses the BIO scheme: `B-MODULE` on the first token of a module name, `I-MODULE` on continuation tokens for multi-token identifiers, `O` everywhere else. 31 labels total.

## The labeling problem, and how we solved it without hand-labeling a single file

No labeled SV/UVM NER dataset exists. Hand-labeling 6,000 files wasn't an option.

The insight was to use the parser itself as the labeler. [Verible](https://github.com/chipsalliance/verible), the open-source SV parser from ChipsAlliance, outputs a full Concrete Syntax Tree as JSON, with exact byte offsets for every node. Instead of writing patterns to find entities, we walk the CST: find a `kModuleDeclaration` node, locate the `SymbolIdentifier` child inside `kModuleHeader`, read its start and end byte positions, done. No ambiguity, no false positives in comments, no missed edge cases from parameterized syntax.

For UVM classes, the script walks the `kExtendsList` node of each `kClassDeclaration` to find the parent class name:

```python
UVM_PARENT_MAP = {
    "uvm_sequence_item": "UVM_SEQ_ITEM",   # must come before uvm_sequence
    "uvm_sequence":      "UVM_SEQUENCE",
    "uvm_reg_sequence":  "UVM_SEQUENCE",
    "uvm_driver":        "UVM_DRIVER",
    "uvm_monitor":       "UVM_MONITOR",
    "uvm_env":           "UVM_ENV",
    "uvm_agent":         "UVM_AGENT",
    "uvm_scoreboard":    "UVM_SCOREBOARD",
    "uvm_test":          "UVM_TEST",
}
```

The ordering of `uvm_sequence_item` before `uvm_sequence` matters. One is a prefix of the other, and a startswith check hits `uvm_sequence` first if it comes first in the map.

About 20% of files in the corpus couldn't be parsed by Verible: non-standard vendor extensions, SystemVerilog subsets from older tools. Those fall back to comment-blanked regex. The 80% that Verible handles cleanly are labeled with precise byte offsets. The result is a training set with no hand-labeling and very low noise.

## Building the corpus

Before labeling comes collection. The filtering is aggressive. Files with "auto-generated," "do not edit," or "generated by" markers in their first 1KB are skipped: register blocks and bus fabric output are syntactically valid SV but they're repetitive, formulaic, and don't represent how humans write. Build and tool directories (`build/`, `obj_dir/`, `sim_build/`, `vendor/`, `third_party/`, `formal/`, `fpga/`, `syn/`, `sta/`) are excluded entirely. Anything over 200KB, usually a generated netlist or a concatenated library file, is dropped.

After filtering: **6,257 source files**. Long files get chunked with a sliding window, 128 tokens wide, 32 tokens of stride, and windows that contain no labeled entities are dropped (no value training on all-`O` examples, and it would create severe class imbalance). That produces **15,641 labeled training windows**.

An 85/7/8 split gives:
- Train: **13,294** examples
- Validation: **1,095** examples
- Test: **1,252** examples

## Training

The model is `microsoft/graphcodebert-base` with a token classification head added on top: a linear layer mapping each token's 768-dimensional hidden state to one of the 31 labels. Everything else is standard HuggingFace Trainer:

```python
TrainingArguments(
    num_train_epochs=5,
    per_device_train_batch_size=32,
    learning_rate=2e-5,
    weight_decay=0.01,
    warmup_ratio=0.1,
    eval_strategy="epoch",
    load_best_model_at_end=True,
    metric_for_best_model="f1",
)
```

Hardware: Apple M4 Pro with 24GB unified memory, MPS backend. The only practical constraint is that MPS doesn't support fp16 or bf16 training yet, so everything runs in float32. With batch size 32 at 128 tokens, memory is not a problem.

One detail worth spelling out: GraphCodeBERT uses a byte-pair encoding tokenizer, which splits words into sub-tokens. `dma_ctrl` might tokenize to `['Ġdma', '_ctrl']`. When assigning labels, the first sub-token of each word gets the word's label; continuation sub-tokens get the `I-` variant. Special tokens (`[CLS]`, `[SEP]`, padding) get `-100`, which the loss function ignores. Getting this alignment right is important. A mistake here silently corrupts the training signal.

The training loss dropped from **1.89** at step 100 to **0.015** by step 2000. What we didn't expect was how fast F1 climbed:

| Epoch | Val F1 | Precision | Recall |
|---|---|---|---|
| 1 | 0.9565 | 0.9538 | 0.9591 |
| 2 | 0.9709 | 0.9677 | 0.9741 |
| 3 | 0.9714 | 0.9691 | 0.9737 |
| 4 | 0.9719 | 0.9648 | 0.9790 |
| **5** | **0.9721** | **0.9688** | **0.9754** |

By the end of epoch 1, the model was already at F1 0.9565. Epochs 2 through 5 were refinement, not learning. That's consistent with what you'd expect from fine-tuning a strong pre-trained model on a focused task with clean labels: the base representations do most of the work, and the training data just steers them toward the domain.

F1 is measured with seqeval, which scores at the span level. A partially correct span, `B-MODULE` predicted correctly but `I-MODULE` mislabeled on the continuation, counts as wrong. The 0.97 figure is conservative, but it's also an aggregate across all 31 labels, and it hides a split worth knowing about before reading anything below as "the model reliably tags UVM types." Structurally distinctive types, `MODULE`, `INTERFACE`, `COVERGROUP`, entities whose syntax alone gives them away, sit near F1 0.98 on their own. UVM-specific role types, `UVM_DRIVER`, `UVM_AGENT`, and the rest, sit far below that, because telling `chip_uart_agent` apart from an ordinary class requires seeing that it extends `uvm_agent`, possibly several files away, well outside a 128-token window. [Fine-Tuning a Model: Pros, Cons, and Where It Breaks](../finetuning-tradeoffs) breaks out the actual per-type numbers and the reason for the gap. The worked example below shows the shape of what the pipeline outputs, not a claim that every entity type in it is extracted this reliably.

## What the model makes possible

### Structured extraction

The most direct comparison is with what you'd reach for first: `grep`.

```bash
$ grep -rn "extends uvm_driver" tb/
tb/agents/axi_driver.sv:7:  class axi_driver extends uvm_driver #(axi_seq_item);
```

That works for `extends uvm_driver` literally. It silently misses parameterized parents, indirect inheritance through project-internal base classes, and anything inside a comment that matches the pattern. More importantly, grep gives you lines of text that you then need to parse to get structured data, at which point you've rebuilt a fragile version of the thing we already built as a fallback.

The NER model gives you structured JSON directly:

```json
[
  { "type": "UVM_DRIVER",     "name": "axi_driver",       "file": "tb/agents/axi_driver.sv",      "line": 7  },
  { "type": "UVM_MONITOR",    "name": "axi_monitor",      "file": "tb/agents/axi_monitor.sv",     "line": 11 },
  { "type": "UVM_SCOREBOARD", "name": "chip_scoreboard",  "file": "tb/env/chip_scoreboard.sv",    "line": 22 },
  { "type": "UVM_SEQUENCE",   "name": "rand_traffic_seq", "file": "tb/sequences/rand_seq.sv",     "line": 6  },
  { "type": "MODULE",         "name": "dma_ctrl",         "file": "dma/rtl/dma_ctrl.sv",          "line": 12 },
  { "type": "INTERFACE",      "name": "axi4_if",          "file": "interfaces/axi4_if.sv",        "line": 5  },
  { "type": "COVERGROUP",     "name": "axi_coverage",     "file": "tb/env/chip_scoreboard.sv",    "line": 45 }
]
```

Run this over a codebase once and you have the map that would otherwise take weeks to assemble manually. It's queryable, it updates every time you run it, and because it's structured output rather than grepped text, it feeds directly into downstream tooling, a database, a graph, a search index, without an intermediate parsing step.

### Semantic embeddings

The NER model is one use of the fine-tuned weights. The other is embeddings.

Strip the classification head off the trained model and what remains is a function that maps a chunk of SV/UVM code to a 768-dimensional vector. The training process, learning to distinguish `UVM_DRIVER` from `UVM_MONITOR` from `MODULE`, doesn't just teach the model to label tokens. It shapes the embedding space so that semantically similar things land near each other.

We tested this after training with three inputs:

```
A: "module dma_ctrl #( parameter int DEPTH = 8 ) ( input logic clk, input logic rst_n ) ;"
B: "module dma_engine #( parameter int FIFO_DEPTH = 16 ) ( input clk, input reset ) ;"
C: "class axi_driver extends uvm_driver #( axi_seq_item ) ;"
```

Cosine similarity after fine-tuning:

```
dma_ctrl  ↔  dma_engine  :  0.94   (two similar modules)
dma_ctrl  ↔  axi_driver  :  0.71   (module vs UVM class)
```

`dma_ctrl` and `dma_engine` share no identifier tokens, different names, different parameter names, but they share structure. The embedding space is organized by entity type and structural role, not surface token overlap. This is what makes semantic search over a codebase tractable, and it's what makes the typed retrieval in [From 6,000 Files to 20](../typed-retrieval) possible.

### ONNX export

The final model exports to ONNX in two forms: the full NER model with the classification head for entity extraction, and the encoder only for generating embeddings. Both run on CPU with ONNX Runtime, no GPU, no Python, no PyTorch dependency at inference time.

An ONNX model is a single file, callable from any language with ONNX Runtime bindings: Python, C++, Rust, Zig. The p50 CPU latency per 128-token chunk is in the single-digit milliseconds. Processing a 6,000-file codebase takes seconds, not hours, and integrates into any toolchain without dragging in a machine learning stack.

---

*Key numbers: 6,257 source files · 15,641 training windows · 31 labels · F1 0.9721 · Apple M4 Pro MPS · ONNX export*
