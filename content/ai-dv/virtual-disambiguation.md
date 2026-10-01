---
title: "'virtual' Is Four Keywords in One"
weight: 2
date: 2026-09-20
publishDate: 2026-09-20
draft: false
description: "The keyword 'virtual' means four unrelated things in SV and UVM. A precise map of each, and what happens when an LLM gets it wrong."
prev: /ai-dv/why-llms-fail
next: /ai-dv/reading-systemverilog
---

Search a medium-sized UVM testbench for the word `virtual`. You'll find it on class declarations, on method signatures, on interface handles, and inside UVM base class hierarchies, and it means something different in every case. Not "related but distinct." Completely unrelated.

This matters when you're reading unfamiliar code, debugging a confusing tool report, or trying to explain something clearly. LLMs routinely conflate two or three of these and produce subtly wrong answers. Let's fix that.

![The keyword virtual split into two unrelated meanings: OOP dynamic dispatch through class inheritance versus a structural handle bridging a class to an interface instance](/images/ai-dv/02-virtual-keyword-split.svg)

---

## Why write a whole article on something this basic?

Because "basic" and "correctly handled by LLMs" are not the same thing.

The four uses of `virtual` in a UVM testbench are all covered in introductory SV courses. They're in the LRM. They're in the UVM spec. They're in every textbook. If you've been writing verification code for more than a year, you already know them. So why does this article exist?

Because **LLMs fail here in a specific, reproducible way**, not randomly, but structurally, and understanding why points directly at how to fix it.

### The failure mode

The training corpus for any LLM that has seen SV contains the IEEE 1800 LRM, UVM reference manuals, textbooks, thousands of forum threads, and millions of lines of testbench code. In that corpus, the word `virtual` appears in all four contexts, frequently in close proximity. A thread explaining UVM virtual sequences might include a code block with `virtual function` in the same class. A forum post about `virtual interface` might describe the mechanism using analogies from OOP virtual dispatch.

In the model's latent representation, these four concepts are not cleanly partitioned. They share a token, they share discussion threads, they share code examples. The model has learned correlations, not a typed ontology. So when you ask it to explain a `virtual interface`, it may drift toward OOP virtual dispatch. When you ask it to write a virtual sequence, it may mark the class `virtual`, which compiles but is semantically wrong: you've declared an abstract base class, not a coordination sequence.

This is not a hallucination in the sense of inventing facts. It's a **conflation**, mixing two real, correct concepts that happen to share a keyword. Conflations are harder to detect than fabrications because the output is plausible and often partially correct.

### Why prompting alone doesn't fix it

You can tell the model "don't confuse virtual interface with virtual sequence" in a system prompt. That reduces the error rate. It does not eliminate it, because the underlying representation hasn't changed. You've just applied a weak override to a strong prior. In a long context where the model is generating complex testbench code across multiple files, the override decays.

The durable fix is **grounding**: give the model a knowledge source where these concepts are typed, separated, and structurally distinct. If the model's retrieval context includes an entity graph where `INTERFACE` and `UVM_SEQUENCE` are different entity kinds in different partitions, `structural` versus `verification`, with typed relations like `HAS_VIRTUAL_IF` that explicitly bridge them, then generating a conflation means generating something that contradicts the retrieved context. The model's own consistency pressure works against the hallucination instead of toward it.

### What the integrity constraints look like

The partition-to-kind rule, call it IC-1, is one concrete example:

- `INTERFACE`, `PORT`, `MODULE`, `CLOCK_DOMAIN` → partition `structural`
- `UVM_SEQUENCE`, `UVM_SEQUENCER`, `UVM_AGENT`, `UVM_DRIVER` → partition `verification`
- `COVERGROUP`, `ASSERTION`, `SVA_PROPERTY` → partition `coverage`

These aren't suggestions. A knowledge-graph extractor that emits an entity with `kind: UVM_SEQUENCE` and `partition: structural` fails validation at ingest time. The constraint is machine-enforced, not documented in a README that the model may or may not have seen.

Likewise, the relation `HAS_VIRTUAL_IF` is typed: it goes from a `verification` entity (the agent or driver holding the handle) to a `structural` entity (the interface instance). This typed edge is exactly the bridge between the two domains that a correct answer about virtual interfaces requires, and it's a different edge from `RUNS_ON`, which goes from `UVM_SEQUENCE` to `UVM_SEQUENCER` and has nothing to do with interfaces.

When an LLM queries a knowledge graph built with these constraints, it retrieves a context where the distinction is already enforced. The answer it generates has to be consistent with that context, or it's visibly wrong.

### Why this article is part of that project

chipdv.io documents the concepts that live underneath an intelligent DV toolchain. The disambiguation here is not background material. It's the specification that tells you what `structural`, `verification`, `HAS_VIRTUAL_IF`, and `RUNS_ON` mean, and why they need to be different things. If you're building or using a system that indexes SV/UVM code and answers questions about it, you need this map. Without it, you're asking an LLM to reason about a domain where its training data has already introduced the conflation you're trying to avoid.

The rest of this article is that map.

---

## 1. `virtual` methods and classes: the OOP keyword

This is the one SystemVerilog inherited directly from C++/Java. It has nothing to do with interfaces or UVM sequences.

In SV, a method marked `virtual` can be overridden in a derived class. Without `virtual`, method dispatch is static: the declared type of the handle determines which method runs, not the actual object type:

```systemverilog
class base;
    function void greet();
        $display("base");
    endfunction
endclass

class derived extends base;
    function void greet();
        $display("derived");
    endfunction
endclass

// Static dispatch, no virtual
derived d = new();
base h = d;   // legal upcast, handle declared type is base
h.greet();    // prints "base", not "derived"
```

Add `virtual` to the base method and you get the behavior most people expect:

```systemverilog
class base;
    virtual function void greet();
        $display("base");
    endfunction
endclass

// Dynamic dispatch, virtual
derived d = new();
base h = d;   // legal upcast, handle declared type is base
h.greet();    // now prints "derived"
```

A class declared `virtual class` cannot be instantiated directly. It's an abstract base, exactly `abstract class` in Java. You derive from it and override its methods, typically its `virtual` methods, in the derived class. `uvm_component`, `uvm_object`, every UVM base class is a virtual class in this sense.

The LRM reference is IEEE 1800-2023 §8.20 (virtual methods) and §8.21 (pure virtual methods). Nothing to do with hardware interfaces. Nothing to do with UVM sequencers.

---

## 2. `virtual interface`: not virtual, not an interface

This one confuses people even after they've been writing SV for years, because the name is exactly wrong.

In SV, an `interface` is a module-level construct. It groups signals and can contain tasks, functions, clocking blocks, and modports. Interfaces are instantiated in the module hierarchy. You can't hold a reference to an `interface` inside a class using a regular handle, because classes live in the transactional domain and interfaces live in the structural domain.

`virtual interface` is the bridge. Declaring a `virtual interface` handle inside a class gives you a reference to a specific interface instance that was instantiated at the structural level. The word "virtual" here means "a handle that indirectly refers to a structural resource." It's not a software-virtual thing, it's more like a pointer with late binding.

```systemverilog
interface axi4_if (input logic clk);
    logic awvalid, awready;
    // ...
endinterface

module tb_top;
    axi4_if dut_if (.clk(clk));

    initial begin
        uvm_config_db #(virtual axi4_if)::set(null, "uvm_test_top.*",
                                               "axi4_vif", dut_if);
    end
endmodule

class axi_driver extends uvm_driver #(axi_seq_item);
    virtual axi4_if vif;  // handle pointing at the interface instance above

    task run_phase(uvm_phase phase);
        vif.awvalid <= 1;  // drives the actual signal through the handle
    endtask
endclass
```

The interface itself, `axi4_if`, is not virtual. The handle, `virtual axi4_if vif`, is. The word "virtual" on the handle declaration is how SV's type system knows that `vif` is an indirect reference to a structural interface rather than a copy of one. IEEE 1800-2023 §25.9.

No connection to virtual methods. No connection to UVM virtual sequences.

---

## 3. UVM virtual sequence: a coordination pattern

This is where the naming becomes actively misleading.

A UVM virtual sequence has nothing to do with SV's `virtual` keyword or `virtual interface`. It's not syntactically virtual at all. The name is a UVM 1800.2 term of art for a specific architectural pattern: a sequence that coordinates other sequences running on different sequencers, without itself generating stimulus directly.

The canonical structure:

```systemverilog
class chip_virtual_seq extends uvm_sequence;
    `uvm_declare_p_sequencer(chip_virtual_sequencer)

    axi_write_seq  axi_seq;
    apb_config_seq apb_seq;

    task body();
        fork
            axi_seq.start(p_sequencer.axi_sqr);
            apb_seq.start(p_sequencer.apb_sqr);
        join
    endtask
endclass
```

`chip_virtual_seq` extends plain `uvm_sequence`. The `virtual` in the name is convention, not a keyword. The `uvm_declare_p_sequencer` macro is what connects this sequence to a typed sequencer handle; without it, `p_sequencer` doesn't exist and the sequence can't access sub-sequencers.

The purpose is test-layer orchestration: you want one sequence to start AXI traffic, configure an APB register, inject an interrupt, and assert coverage, all coordinated across four independent sequencer trees. A virtual sequence is how you do that without hard-wiring the coordination into the test class itself.

UVM 1800.2 covers this in §18.8. The `uvm_declare_p_sequencer` macro is in Annex A.

---

## 4. UVM virtual sequencer: the other pattern half

A virtual sequencer is the counterpart to the virtual sequence. It's a `uvm_sequencer` with no associated driver; its only job is to hold handles to the actual sub-sequencers so a virtual sequence can start sub-sequences on them:

```systemverilog
class chip_virtual_sequencer extends uvm_sequencer;
    axi_sequencer  axi_sqr;
    apb_sequencer  apb_sqr;
    uart_sequencer uart_sqr;
endclass
```

There's no `uvm_driver` paired with `chip_virtual_sequencer`. The handles `axi_sqr`, `apb_sqr`, `uart_sqr` are assigned during `connect_phase` by the containing UVM environment, pointing at the actual per-protocol sequencers in the agent hierarchy.

A virtual sequence starts on the virtual sequencer. Internally it starts sub-sequences on the real per-protocol sequencers through those handles. The real sequencers drive their real drivers. The virtual sequencer never directly drives anything.

Again, the word "virtual" here is UVM jargon for "coordinator without a driver." Not SV's `virtual` keyword. Not a `virtual interface`.

---

## The disambiguation at a glance

| Construct | SV or UVM | Keyword? | What it does |
|---|---|---|---|
| `virtual function f()` | SV | Yes, `virtual` is a modifier | Enables dynamic dispatch in derived classes |
| `virtual class C` | SV | Yes, `virtual` is a modifier | Makes the class abstract (no direct instantiation) |
| `virtual axi4_if vif` | SV | Yes, `virtual` is a type prefix | Indirect reference to a structural interface instance |
| UVM virtual sequence | UVM | No, convention only | Sequence that coordinates other sequences across sequencers |
| UVM virtual sequencer | UVM | No, convention only | Sequencer with no driver; holds handles to real sequencers |

---

## Why this matters in practice

Three situations where the conflation causes real problems:

**Reading LRM citations.** If someone says "see §8.20 for virtual sequence behavior," they're either wrong or they mean §18.8 of the UVM specification. The LRM owns the SV `virtual` keyword. The UVM spec owns virtual sequences. These are different documents.

**Debugging tool output.** Static analysis tools and some coverage tools flag "virtual sequences" in reports. When a tool says a sequence has a virtual flag, it might mean the class has `virtual` tasks (the OOP sense) or it might be using UVM terminology to denote a coordination sequence. These require different fixes.

**LLM answers.** Ask a current LLM to explain UVM virtual sequences and there's a real chance it'll splice in something about virtual methods or virtual interfaces, the training data conflation propagating into the answer. Ask for code and you might get `virtual class my_virtual_seq extends uvm_sequence`, which compiles but means something different from what was intended. Knowing the map lets you spot the error.

The word is overloaded. The concepts aren't.

---

## Does prompting fix it?

The disambiguation above is obvious to anyone who has written a UVM testbench for a year. The question worth asking is whether an AI system can be made to handle it reliably, and if so, what kind of prompting is required.

We ran a controlled experiment against a real OpenTitan file, `dv_base_env_cfg.sv`. The file is a good stress case: it has two `virtual clk_rst_if` interface handle declarations (lines 75 and 85) and six `extern virtual function` OOP-dispatch declarations (lines 117-147), all in the same class body, with inline comments that explicitly say things like *"This is virtual, allowing subclasses to set up list_of_alerts"*, correct OOP framing for the functions, but sitting right above the interface handle fields where it could easily bleed.

The task: extract every `virtual` usage as a typed knowledge-graph triple in the form `(subject, RELATION_TYPE, object)`. No relation vocabulary was supplied in the task itself. The model had to provide the relation names, which is exactly what an extraction pipeline for a typed knowledge graph would require.

We tested two models: **claude-sonnet-4-6** (frontier, via API) and **qwen2.5-coder:7b** (local, via Ollama running on an M4 Pro). Three system prompts were compared across five runs each.

### The prompts

**Vanilla**, no guidance beyond expertise:

```
You are a SystemVerilog and UVM expert.
```

**Soft-hint**, expertise plus a negation reminder:

```
You are a SystemVerilog and UVM expert. Keep two uses of `virtual`
completely separate: `virtual InterfaceType handle` is a SV type
qualifier that gives a class an indirect reference to a structural
hardware interface. It has NOTHING to do with OOP polymorphism.
`virtual function/task` is an OOP keyword enabling dynamic dispatch
in derived classes. It has NOTHING to do with hardware interfaces
or signals.
```

**Ontology**, expertise plus a typed vocabulary:

```
You are a SystemVerilog and UVM expert with a typed knowledge graph.
HAS_VIRTUAL_IF (verification→structural): models `virtual IfType handle`,
an indirect handle to a structural interface instance; no OOP dispatch.
OVERRIDES (verification→verification): models `virtual function/task`,
OOP dynamic dispatch; no structural/interface meaning.
Use these exact relation names when extracting triples.
```

The difference between Soft-hint and Ontology is not just more detail. Soft-hint tells the model what not to do ("NOTHING to do with OOP"). Ontology tells the model what vocabulary to use: two named relation types, each with a typed source and target partition.

### What each strategy produced

Every strategy correctly separated the two concepts. No run mixed OOP language into an interface-handle explanation or vice versa. On that measure, all three worked.

The difference showed up in the relation names the model invented.

**Vanilla** invented reasonable-sounding but non-standard names:

```
(clk_rst_vifs,            VIRTUAL_IF_HANDLE_OF, clk_rst_if)
(clk_rst_vif,             VIRTUAL_IF_HANDLE_OF, clk_rst_if)
(initialize,              DECLARED_VIRTUAL_IN,  dv_base_env_cfg)
(pre_build_ral_settings,  DECLARED_VIRTUAL_IN,  dv_base_env_cfg)
(post_build_ral_settings, DECLARED_VIRTUAL_IN,  dv_base_env_cfg)
(reset_asserted,          DECLARED_VIRTUAL_IN,  dv_base_env_cfg)
(reset_deasserted,        DECLARED_VIRTUAL_IN,  dv_base_env_cfg)
(create_ral_by_name,      DECLARED_VIRTUAL_IN,  dv_base_env_cfg)
```

**Soft-hint** produced different names across runs, still non-standard:

```
(clk_rst_vifs, TYPED_AS_VIRTUAL_INTERFACE, clk_rst_if)
(clk_rst_vif,  TYPED_AS_VIRTUAL_INTERFACE, clk_rst_if)
(initialize,              OVERRIDABLE_IN,  dv_base_env_cfg)
(pre_build_ral_settings,  OVERRIDABLE_IN,  dv_base_env_cfg)
...
```

Across five soft-hint runs: `TYPED_AS_VIRTUAL_INTERFACE`, `HAS_VIRTUAL_INTERFACE_TYPE`, `INDIRECT_IFACE_HANDLE_OF_TYPE`, `OVERRIDABLE_IN`, a different vocabulary every time.

**Ontology** produced exact schema names, every run:

```
(clk_rst_vifs,            HAS_VIRTUAL_IF, clk_rst_if)
(clk_rst_vif,             HAS_VIRTUAL_IF, clk_rst_if)
(initialize,              OVERRIDES,      dv_base_env_cfg)
(pre_build_ral_settings,  OVERRIDES,      dv_base_env_cfg)
(post_build_ral_settings, OVERRIDES,      dv_base_env_cfg)
(reset_asserted,          OVERRIDES,      dv_base_env_cfg)
(reset_deasserted,        OVERRIDES,      dv_base_env_cfg)
(create_ral_by_name,      OVERRIDES,      dv_base_env_cfg)
```

### The numbers: claude-sonnet-4-6

Over five runs each, scored against a schema that accepts only `HAS_VIRTUAL_IF` and `OVERRIDES` as valid relation names:

| Strategy | Conceptual conflation | Schema-invalid names |
|---|---|---|
| Vanilla | 0 / 5 | 5 / 5 |
| Soft-hint | 0 / 5 | 5 / 5 |
| Ontology | 0 / 5 | 0 / 5 |

No conflation errors in any strategy. Full vocabulary failure in Vanilla and Soft-hint. Zero failures in Ontology.

### The numbers: qwen2.5-coder:7b (local, Ollama)

| Strategy | Format failure (unparseable) | Semantic misassignment |
|---|---|---|
| Vanilla | 5 / 5 | n/a |
| Soft-hint | 5 / 5 | n/a |
| Ontology | 0 / 5 | 4 / 5 |

Qwen's failure mode isn't the same shape as Claude's, so it doesn't fit the same two columns: nothing Qwen produced under Vanilla or Soft-hint was parseable at all, so there's no vocabulary to score as conflated or schema-invalid, just prose or malformed output the scorer threw out. The Ontology prompt changed that entirely: every run now produced parseable triples, and the failure moved from the format layer to the semantic layer, one run succeeded outright, four used the right relation vocabulary but pointed it at the wrong entities. That's a bigger shift than a raw error-rate comparison (100% failing one way vs. 80% failing a different way) captures on its own.

**Vanilla and Soft-hint**: Qwen produced zero parseable triples across all ten runs. The model wrote prose, or produced inconsistent bracket structures, or used relation names that weren't in `SCREAMING_SNAKE_CASE`. The scorer extracted nothing. The failure was at the format level before any vocabulary question could be asked.

**Ontology**: the explicit relation names in the prompt changed the output. Four of five runs still failed, but now the failures were different. In one representative run, Qwen produced:

```
(initialize,             HAS_VIRTUAL_IF, dv_base_env_cfg)
(pre_build_ral_settings, HAS_VIRTUAL_IF, dv_base_env_cfg)
(reset_asserted,         HAS_VIRTUAL_IF, dv_base_env_cfg)
```

The format is correct. The relation name is schema-valid. But `HAS_VIRTUAL_IF` was applied to OOP dispatch methods, exactly the conflation the Ontology prompt was supposed to prevent. The model learned the right vocabulary from the prompt and then applied it backwards.

The one clean run (run 4) got both names right and assigned them correctly: `HAS_VIRTUAL_IF` for interface handles, `OVERRIDES` for virtual functions.

This is a **capability floor**, not a prompting problem. The Ontology prompt provides vocabulary anchor and structural constraint. A frontier model can follow both. A 7B general-purpose model running locally can follow the vocabulary sometimes, but doesn't reliably maintain the semantic constraint, which entity gets which relation, across all outputs.

### What this means in practice

Three failure modes appeared across the two models, each requiring a different fix:

**Vocabulary drift** (Claude, Vanilla/Soft-hint): correct concepts, invented relation names that differ run-to-run. `TYPED_AS_VIRTUAL_INTERFACE` in run 1, `VIRTUAL_INTERFACE_HANDLE_OF` in run 2, `SV_VIRTUAL_IFACE_HANDLE_OF` in run 3. Fix: Ontology prompt. The model has sufficient instruction-following to accept a named vocabulary and use it consistently.

**Format failure** (Qwen, Vanilla/Soft-hint): the model can't reliably produce `(subject, RELATION_TYPE, object)` triples in a parseable format. No vocabulary question ever reaches the scorer because no triples are extracted. Fix: not prompting. The general-purpose 7B needs fine-tuning or a structured-output wrapper before vocabulary questions become relevant.

**Semantic misassignment** (Qwen, Ontology): the model learned the relation names from the prompt and produced parseable triples, but assigned them to the wrong entities. `HAS_VIRTUAL_IF` on OOP dispatch methods. Correct vocabulary, wrong semantics. This is the trickiest failure because the output looks valid until you check what the names point to. Fix: same as format failure, fine-tuning, not prompting.

For a production extraction pipeline, prompting strategy only matters once the model clears the capability floor. Below that floor, you're fine-tuning, not prompting, and the thing you're fine-tuning is not vocabulary, it's the structural mapping from syntactic context to typed relation.

This is exactly the gap that the NER model in this series addresses. [Teaching a Model to Read SystemVerilog](../reading-systemverilog) describes a fine-tuned GraphCodeBERT that doesn't rely on instruction-following at all; it classifies tokens directly. The structured output is a property of the model architecture, not the prompt.

The full edge taxonomy, `HAS_VIRTUAL_IF`, `OVERRIDES`, and the rest of the typed relations in the knowledge graph, is covered in [From Entities to Edges](../entity-graph).
