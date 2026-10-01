---
title: "What an AI-Native Verification Flow Looks Like"
weight: 15
date: 2026-10-02
publishDate: 2026-10-02
draft: false
description: "All layers together. What changes for an engineer who uses this stack daily, and what it still doesn't solve."
prev: /ai-dv/local-deployment
---

The previous articles describe components: an extractor, a graph, a daemon, a retrieval mechanism, a traversal pattern, an on-demand reasoning layer, a regression predictor, a query interface, a deployment model. This one puts them together and asks the honest question: what actually changes for a verification engineer who uses this stack every day? Not the architecture diagram, the workday.

![Full stack from top to bottom: SV/UVM source through NER extraction into a typed graph on Postgres with AGE and pgvector, watched by a daemon that triggers on commits, simulation completion, and coverage deltas, dispatching on-demand LLM calls, up to the engineer querying, triaging, and closing coverage](/images/ai-dv/15-full-stack.svg)

## Joining a new project

Without the stack, onboarding to a new testbench is roughly two weeks of reading source, grepping for usages, asking colleagues questions, and building a mental model that's probably already a little out of date by the time it's finished. With it: initialize the daemon, wait for the index to build, and start querying the graph. Within an hour you know which agents exist, which interfaces they drive, which tests are present, which covergroups are defined, and which modules look under-covered. The map exists on day one instead of being assembled by hand over two weeks.

What the graph doesn't hand you is design intent, the project's bug history, or the team's unwritten conventions. Those still come from people and from time spent in the code. The graph gives structure. It doesn't give judgment.

## A day in coverage closure

A coverage report shows 23 uncovered bins across five covergroups. Without the stack, closing each one means reading the covergroup, tracing back to which interface conditions would trigger it, searching the testbench for a relevant sequence, and manually confirming which tests actually exercise that sequence, easily an hour per bin. With the stack, each uncovered bin is a graph query: the associated interface, the sequences that exercise it, the tests that use those sequences. The gap becomes visible directly: no sequence exercises the condition where a request is asserted while the bus is still in IDLE right after reset. Extend the closest existing sequence, rerun coverage, move to the next bin. The work that's left is deciding how to extend the sequence, not finding out what to extend.

## A day in bug investigation

A failing assertion shows up in the nightly regression. Without the stack, triaging it means reading the assertion, reading the waveform, tracing back through the hierarchy by hand, and checking whether it's a known flaky test or something new, often a couple of hours before there's even a working hypothesis. With the stack, the daemon already triaged it when the regression completed: a structured finding is waiting, with the assertion's meaning, the failure context, a probable root cause, a confidence level, and the commit most likely responsible. The engineer's first move is validating that finding against the actual waveform, not starting from a blank hierarchy. The total time to a confirmed root cause isn't necessarily shorter, real bugs still take real investigation, but the first couple of hours of pure navigation are replaced by reading a specific, falsifiable hypothesis and checking it.

## What it doesn't solve

The stack doesn't replace simulation, and it doesn't replace formal verification. It doesn't understand design intent, the graph captures structural relationships, not the reasoning behind why an architecture looks the way it does. It has nothing to say about IP that ships without source, like encrypted netlists or black-box models, because there's nothing to extract from. It doesn't touch analog design, physical design, or timing closure. And it doesn't remove the need for an experienced verification engineer, it changes where that engineer's time goes, from navigation and documentation toward judgment and reasoning. That's a real improvement. It isn't magic, and claiming otherwise would undercut the actual case for building it.

## Open problems

A few things are genuinely unsolved. The graph as described captures static structure; incorporating behavioral data from simulation, waveforms, coverage evolving over time, would make it considerably richer, and that work is still ahead. Connecting the graph to a formal property checker, so that a suspicious path identified through traversal becomes a formal cover property automatically, is an open integration problem rather than a solved one. Reasoning that happens *during* a simulation run, with an agent adjusting the test environment in real time rather than only before or after, is a harder version of the daemon-triggered pattern from earlier articles. And when two IP blocks from different teams share an interface, the graph can flag a structural mismatch, but confirming a *behavioral* incompatibility between them needs deeper analysis than a typed edge can express.

## Where this goes next

This series has been the design and reasoning behind the stack, the failure modes it responds to, and the architectural choices made to address them. The natural next step is putting the pieces in front of real projects and seeing where the graph's model of a testbench diverges from what engineers actually need to ask it. That's the phase this site will track next.

---

Thanks for reading through the series. If you're working on verification tooling and any of this overlaps with problems you're hitting, the [about page](/about) has a way to get in touch.
