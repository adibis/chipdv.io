---
title: "The Orchestration Gap"
weight: 8
date: 2026-09-26
publishDate: 2026-09-26
draft: false
description: "Why session-based LLM agents fail on 20-hour simulation runs, and the daemon-first architecture that works instead."
prev: /ai-dv/entity-graph
next: /ai-dv/typed-retrieval
---

The standard agentic pattern, spawn an orchestrator, have it delegate to peer agents, aggregate their outputs, produce a result, works well for tasks that complete in seconds or minutes. DV does not work in seconds or minutes. A smoke regression is twenty minutes. A nightly regression is eight hours. A coverage closure run on a complex SoC can run for days across a farm. Session-based agents were not designed for this timescale, and the failure modes are predictable once you understand why.

![Two architectures contrasted: a session-based orchestrator whose context swells as peer agents report back, versus a persistent daemon with a database that dispatches short-lived stateless LLM calls that exit when done](/images/ai-dv/08-daemon-inversion.svg)

## The session model and why it breaks

An LLM session is bounded on two sides: the context window, and the lifetime of the process holding that context. Both assumptions come from a world where "long-running task" means a few minutes of tool calls. Spawn an orchestrator, have it fan out to ten parallel agents that each analyze a slice of a simulation log, and the orchestrator's context grows by whatever each agent returns, say 2,000 tokens of structured findings per agent. That's 20,000 tokens consumed before the orchestrator has done anything but collect results. On a task that runs once, this is a rounding error. On a task that runs continuously against a farm producing new logs every few minutes for eight hours, it compounds without bound.

The mismatch isn't about context window size. It's that the session model assumes the task and the agent have the same lifetime. In DV, they don't. The simulation outlives the agent by orders of magnitude.

## Context bloat: the orchestrator problem

The orchestrator's context grows monotonically as peer agents complete, because holding prior results is the only way it maintains coherence about what's happened so far. A human engineer reviewing ten analysis reports reads each one, extracts the conclusion, and discards the rest from working memory. An LLM orchestrator can't do that selectively. The standard pattern keeps every prior tool call and every peer agent's full output in context, because pruning it risks losing information the next step needs.

The result: by the time the first genuinely interesting question can be asked, "given everything we've seen, is this a real bug?", a large fraction of the context window is gone to infrastructure chatter. Tool call scaffolding, agent handshake protocol, intermediate status updates, retries. This isn't a prompting problem. Better instructions don't change how the token accounting works. It's structural: the architecture that makes sub-agent delegation legible to the orchestrator is the same architecture that fills the context window with the delegation's own bookkeeping.

## Agent death on long tasks

The sharper failure mode is what happens when the agent watching a long-running task simply stops existing. A twenty-hour regression is running on the farm. An agent was tracking it, checking in periodically, ready to flag a failure. The agent's process dies, session timeout, infrastructure restart, whatever the cause. The regression keeps running. Nobody is watching it anymore, and nothing about the regression's state indicates that.

When a user or a monitoring system tries to resume the tracking, the context of what was being watched, what had already been flagged, and what thresholds mattered is gone with the dead session. In practice, teams running agentic frameworks against long DV tasks end up with a human checking in periodically to re-orient an agent that has drifted or silently died, which defeats the point of automating the watch in the first place. The hidden assumption baked into the session model is that someone is always available to notice the agent is gone and restart it. That assumption doesn't hold for an eight-hour unattended regression run overnight.

## The right inversion: daemons as orchestrators, LLMs as functions

The fix is to invert which component is long-lived. A daemon, an ordinary persistent process, not an LLM, owns state and runs continuously. It doesn't reason; it watches for triggers (a git commit, a simulation completing, a coverage delta crossing a threshold, a file changing on disk) and reacts to them by updating a database. The daemon's lifetime matches the task's lifetime because it's just a process with a `while (true)` loop and a queue, not a context window.

This isn't a diagram invented for this series. [krul](https://github.com/adibis/krul) is a real, MIT-licensed daemon orchestrator built on exactly this inversion, domain-agnostic at its core, with the DV-specific pieces described in this series (the ontology, the CodeBERT extractor) as one of its worked examples.

LLMs are invoked as stateless functions inside that loop: given this specific slice of context, answer this specific question, return a structured result, exit. No state persists between calls in the LLM's head, the state lives in the daemon's database. A single LLM invocation now needs to survive for the duration of one reasoning request, measured in seconds, not for the duration of the underlying task, measured in hours. If the LLM call fails or times out, the daemon retries it or logs the gap. The regression itself was never depending on the LLM being alive.

## Triggers that make sense for DV

The daemon's job is defined entirely by what it reacts to. For a verification flow, the useful triggers are: a git commit lands, which re-indexes the changed files and invalidates the graph edges those files touch. A simulation completes, which ingests the pass/fail result, updates the corresponding test node's metadata, and recomputes any coverage deltas. A coverage threshold is crossed, which flags which bins are still uncovered and identifies sequences that could plausibly close them. A new assertion failure is logged, which extracts the assertion's context, queries the graph for related entities, and invokes an LLM to produce a triage hypothesis.

None of these are user-initiated. They're continuous background maintenance, running whether or not anyone is looking at a terminal. The daemon never sleeps; the LLMs it calls are only awake for the seconds it takes to answer one question.

## How this compares to general-purpose agent frameworks

General-purpose agent frameworks with persistent memory, cron scheduling, and sub-agent spawning get real things right: memory that survives across sessions, scheduled automations that don't need a human to kick them off, a daemon-like deployment model that's a step in the right direction from pure chat sessions. What they don't have is domain awareness. A general framework has no concept of a simulation-aware trigger, it doesn't know that "simulation completed" is an event worth reacting to, because it doesn't know what a simulation is. It has no typed provenance model, so it can't tell you that a given edge in some internal representation was computed from RTL that was rewritten last week and is therefore stale. Solving personal AI continuity, remembering what we talked about yesterday, is a different problem from knowing that a CSR field's reset value changed in the last commit and every downstream test that assumes the old value needs re-review. General frameworks solve the former. DV needs a domain layer built on top of the latter.

## What inter-agent communication looks like

Agents don't talk to each other through shared context, because there is no shared context. Each invocation is a fresh, stateless call. They communicate through the daemon's state store. An agent analyzing a failing assertion writes a structured finding to a findings table: entity name, hypothesis, confidence, supporting evidence. An agent later analyzing coverage holes reads from that same table when it's looking for related patterns, without ever seeing the first agent's reasoning process or consuming any of its tokens.

The daemon routes work based on what's in that state, not by accumulating a transcript of everything every agent has said. This is what lets the system scale to many parallel workstreams, dozens of triggers firing across a busy farm, without an orchestrator's context window becoming the bottleneck. The coordination layer is a database, not a conversation.

---

*Next: [From 6,000 Files to 20](../typed-retrieval), how ontology-aware graph retrieval gives LLM agents a tractable context for structural reasoning.*
