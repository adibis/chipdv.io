---
title: "Why LLMs Fail at Chip Design Verification"
weight: 1
date: 2026-09-19
publishDate: 2026-09-19
draft: false
description: "Current LLMs struggle with SV and UVM in predictable, fixable ways. Here's what's broken and why it matters."
next: /ai-dv/virtual-disambiguation
---

Large language models can write Python, Rust, and TypeScript well enough to be genuinely useful.
SystemVerilog is a different story. Here's an honest assessment of where they fail and why.

![Scale mismatch: a testbench of thousands of files next to an LLM context window that fits about fifty](/images/ai-dv/01-scale-mismatch.svg)

## What goes wrong

### The corpus problem

The training data for current LLMs is dominated by languages that have decades of public code: Python, JavaScript, Java, C. GitHub has hundreds of millions of files in these languages. The SV/UVM corpus in any public training set is a rounding error by comparison.

What exists publicly is mostly textbook examples, open-source IP cores (a few hundred well-known repos), and UVM documentation. Internal codebases, where the real complexity lives, are never in any training set. A real verification environment has project-specific base classes, macro libraries, testbench infrastructure developed over years, and naming conventions that don't appear in any tutorial. LLMs have not seen any of this.

The result is that generated SV looks like textbook SV. It uses the clean patterns from the UVM User Guide examples. Those patterns work in isolation. They break in contact with a real codebase that has fifteen years of evolution, internal base classes named `proj_base_driver`, and macros that expand to things the LLM has never seen.

### Macros expand to things LLMs don't understand

UVM relies heavily on macros. `uvm_object_utils`, `uvm_component_utils`, `uvm_field_int`, `uvm_declare_p_sequencer`, these are not syntactic sugar. They expand to substantial amounts of generated code that register the class with the UVM factory, implement the `copy`, `compare`, `print`, and `clone` methods, declare sequencer handle types, and wire up the field automation framework.

LLMs see the macro call, not the expansion. They learn patterns for when to use which macro, but they don't have a reliable model of what missing or incorrectly ordered macros actually do at runtime. Generated code routinely:

- Uses `uvm_object_utils` on a component (factory registration breaks silently)
- Omits `uvm_field_*` entries for fields that need to be randomized or printed
- Uses `uvm_declare_p_sequencer` without understanding what `p_sequencer` is and where it's valid to call it
- Gets the argument count to `uvm_do_with` or `uvm_do_on_pri_with` wrong

These errors compile fine. They fail at simulation, often in a way that's hard to trace back to the macro.

### Scheduling semantics

SV has a layered scheduling model: Preponed, Active, Inactive, NBA, Observed, Reactive, Postponed, all within a single simulation time step. Most LLM-generated testbench code is wrong about this in ways that create races.

The most common failure: assigning a signal in an `always` block using `=` (blocking) when `<=` (non-blocking, NBA region) is correct, or vice versa. The difference determines whether the assignment is visible within the same time step or deferred. In a testbench driving a clocked interface, getting this wrong creates races with the DUT's sampling edges, the test sometimes works, sometimes doesn't, depending on simulation tool and delta cycle order.

LLMs also regularly generate `@(posedge clk)` inside a task without an `automatic` declaration on the task, leading to re-entrant scheduling bugs that only appear when multiple threads call the task simultaneously. These are the bugs that take experienced engineers half a day to find. An LLM generated the bug in three seconds.

### UVM phase ordering

The UVM phase sequence, `build_phase`, `connect_phase`, `start_of_simulation_phase`, `run_phase`, and the dozen phases around `run_phase`, has strict ordering semantics. Components built in a child's `build_phase` are not available to a parent's `connect_phase` until all children have completed `build_phase`. The UVM scheduler enforces this with a depth-first traversal, but the details of when objections need to be raised and dropped, how `phase.jump()` interacts with sibling components, and which phases are time-consuming versus time-zero are all subtle.

LLMs consistently make mistakes here. Generated `run_phase` code sometimes drops the phase objection before the fork of sub-tasks completes, causing the simulation to end early. Sequences are started before the virtual interface handles are set via `uvm_config_db`, because the generated code doesn't account for the ordering between `start_of_simulation_phase` and `run_phase`. These bugs show up as "null pointer" errors in the driver, or simulations that terminate with zero transactions generated.

### Context window and scale

A non-trivial UVM testbench is thousands of files. A single env hierarchy might span fifty `.sv` files. The agents, drivers, monitors, scoreboards, sequences, and the DUT they're verifying easily exceed any context window.

This creates a hard practical limit: you can ask an LLM about a file you paste into the prompt, and it will give you a competent answer about that file. You cannot ask it about the testbench architecture, because the testbench doesn't fit. The model has no persistent memory of what it's seen, no index of the codebase, no awareness of how the file you just pasted connects to the fifteen other files that depend on it.

This isn't a solvable problem by making context windows larger. A 200K-token context window fits maybe fifty large SV files. Real projects have thousands. The problem is structural.

## What they are actually good at

Not everything is broken. There are specific tasks where LLMs work well in an SV/UVM context today:

**Reading code.** Paste a driver and ask "what does this do?" and you'll get a good answer. LLMs are excellent at explaining what existing code does, identifying what UVM class it extends, and summarizing what protocol it implements. This is a real productivity gain when onboarding to an unfamiliar testbench.

**Spec inconsistency detection.** Give an LLM an interface specification and the monitor implementation side by side, and ask "does the monitor correctly check all the assertions in the spec?" It will often find genuine discrepancies. The model doesn't need to understand the full codebase for this, it just needs both documents.

**Assertion explanation.** SVA properties with complex temporal operators are hard to read. Paste an assertion and ask what behavior it's checking, usually a good answer.

**Python and scripting.** Regression infrastructure, coverage collection scripts, waveform parsing, report generation, these are Python, not SV. LLMs write this well. The interface between an LLM and a SV flow is often best kept at the scripting layer, not inside the HDL.

## Why "today" matters

The failures listed above are not permanent features of LLMs. They're consequences of training data scarcity, missing codebase context, and the mismatch between natural-language output and the structured data that tooling needs.

Each of these is addressable with the right infrastructure. A system with a structured, queryable index of the full codebase can give the LLM the context it needs without shoving thousands of files into a prompt. A fine-tuned encoder trained on SV/UVM can extract entities and relationships that a general-purpose LLM misses. A daemon that persists across the 20-hour simulation run can accumulate results that a session-based agent can't hold.

That infrastructure is what this series is about. The next article takes one failure mode, keyword conflation, and measures it precisely, which sets up everything that follows.

The LLMs aren't going to get better at SV by themselves. The tooling around them has to catch up first.
