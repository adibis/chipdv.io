---
title: "What LLMs Are Actually Good At in Verification"
weight: 11
date: 2026-09-29
publishDate: 2026-09-29
draft: false
description: "On-demand reasoning for coverage analysis, assertion explanation, and regression triage, where single-call LLM reasoning outperforms structured traversal."
prev: /ai-dv/llm-fleet-traversal
next: /ai-dv/regression-triage
---

The previous two articles cover the hard cases: structural bugs that require multi-hop traversal and iterative reasoning across a fleet of specialized agents. Not everything is a hard case. There's a class of DV tasks where a single well-constructed LLM call, given the right context slice, produces expert-quality output that would take an engineer real time to produce by hand. Knowing which tasks fall into this category, and which don't, is what separates productive use of LLMs in a verification flow from expensive disappointment.

![Two columns of DV tasks: single-call work like coverage analysis, assertion triage, spec interpretation, and regression triage on the left, versus tasks needing traversal like deadlock search, reentrancy checks, and spec-vs-RTL comparison on the right](/images/ai-dv/11-single-call-vs-traversal.svg)

## Coverage analysis

Given a coverage report with uncovered bins, functional coverage holes, or thin cross-products, an LLM can identify what scenarios are missing and suggest sequence modifications or new tests. This works because the model carries broad knowledge of verification methodology and can reason about which corner cases tend to get missed for a given protocol or interface type. The input is bounded, a coverage report is compact and structured, the output is directly actionable, and there's no multi-file traversal required: the coverage data is self-contained context. Feed it the uncovered bin definitions plus the covergroup's sampling context, and the response is a concrete list of scenarios, not a restatement of what "uncovered" means.

## Assertion explanation and triage

Given a failing SVA assertion and the waveform context around the failure window, an LLM can explain what the assertion checks, what the failure indicates, and what's likely at fault in the design or testbench. SVA properties are dense and formal; translating them into plain-language reasoning about a violation is exactly the kind of semantic translation this class of model does well, and the failure window gives it the temporal grounding it needs.

What to hand it: the assertion text, the interface signals during the failure window, the sequence that drove the test, and the relevant DUT hierarchy pulled from the graph. What not to hand it: the entire testbench or the entire DUT. Narrowing that context is exactly the job the graph retrieval from [From 6,000 Files to 20](../typed-retrieval) already does, this is where that work pays off.

## Spec interpretation and property extraction

Given a section of an architectural specification, natural language, often ambiguous, an LLM can extract testable properties as SVA-ready pseudocode or structured assertions. Translating specification intent into formal properties is a slow, high-skill task by hand, and current models handle it with surprising accuracy on well-written specs. The failure mode is ambiguity: a poorly specified section produces multiple plausible readings, and the model should flag the ambiguity rather than silently commit to one interpretation. Structure the prompt with the spec section, the relevant interface definition from the graph, and ask for properties in a reviewable format. A human should sign off before any of this becomes a formal constraint.

## Regression failure triage

Given a set of failing tests from a regression run, log snippets, error messages, failure categories, an LLM can cluster the failures, propose likely root causes, and flag which failures are probably tied to a specific recent commit. Pattern recognition across a pile of failure logs is exactly the kind of tedious-for-humans, well-within-capability task this fits. The context that matters: the failing test names, relevant log excerpts rather than full logs, the diff of the suspected commit, and the graph's view of which entities that commit touched. Structured this way, the output is actionable triage rather than a generic summary of "several tests failed."

## What doesn't work: why some tasks still need traversal

The boundary is worth stating plainly. "Find all deadlock conditions in this DUT" fails in single-shot mode, it requires the traversal pattern from [LLM Fleets for Code Traversal](../llm-fleet-traversal). "Is the firmware ISR handler reentrant under all interrupt priority combinations" fails the same way, it requires reasoning across multiple files that a single call can't hold at once. "Does this RTL implementation match the spec for every corner case" fails because it requires comparing extracted spec properties against multiple implementation paths, not one.

What these have in common: they require the model to hold an implicit picture of a system larger than one context window, and they require it to actively search for edge cases rather than explain structure that's already in front of it. Those are the cases that need the fleet-and-graph machinery from the last two articles. Everything in this article is the opposite: bounded input, self-contained context, no search required.

## The on-demand pattern in practice

Each of these tasks slots into the daemon architecture from [The Orchestration Gap](../orchestration-gap) as an event-triggered call. A coverage report is generated, and that triggers the coverage-analysis agent. An assertion failure is logged, and that triggers the triage agent. A commit lands, and that triggers a regression pre-triage pass on the entities the commit touched. No human initiates any of these. No session persists between them, each one fires, runs, writes a structured result to the state store, and exits. The LLM is a function that runs when there's work and is otherwise idle, which is the whole point of the architecture: unlike the structural bug hunts in the previous two articles, none of these need a fleet or a multi-step traversal to be useful. A single well-aimed call is the correct amount of machinery.

---

*Next: [Regression Triage Without Gut Feeling](../regression-triage), using RTL change impact to predict which tests to run before the regression completes.*
