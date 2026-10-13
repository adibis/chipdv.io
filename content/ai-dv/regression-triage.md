---
title: "Regression Triage Without Gut Feeling"
weight: 12
date: 2026-09-30
publishDate: 2026-09-30
draft: false
description: "Using RTL change impact analysis and graph traversal to predict which tests will catch a given commit, cutting simulation time without raising risk."
prev: /ai-dv/llm-strengths
next: /ai-dv/querying-the-testbench
---

Running every test on every commit is safe and expensive. Running a hand-picked subset is fast and risky, the subset is only as good as the engineer's mental model of what the commit touches. In practice, most teams land somewhere in between: a smoke suite on every commit, a nightly full regression, and individual judgment calls when something looks suspicious. That works until the codebase grows large enough that individual judgment stops being reliable. At that point the question is whether a graph can make better predictions than intuition.

![A commit's changed files traversed outward through INSTANTIATES, DRIVES, and SEQUENCES_VIA edges into a ranked test list by structural distance, contrasted with naive coverage of changed lines which misses structurally connected tests](/images/ai-dv/12-change-impact-graph.svg)

## The change impact problem

Given a git diff, which tests are most likely to catch a bug introduced by it? The naive answer is "the tests that cover the changed lines," but coverage maps to functional behavior, not to structural dependency. A change to a clock-gating cell might not touch any functional coverage bin at all while introducing a metastability window that only shows up under specific timing conditions. A change to an AXI arbitration module might affect tests covering write transactions, read transactions, error injection, and power management, all of which touch the arbiter through different paths. Coverage doesn't tell you any of that. The graph, which already knows which entities a commit touches and what depends on them, does.

## What the graph provides

A commit touches files F1, F2, F3. The graph knows which entities are defined in those files, which other entities depend on them through `INSTANTIATES`, `DRIVES`, and `SEQUENCES_VIA` edges, and which tests exercise those entities through `COVERS` edges and the test-to-sequence chain. Traversing outward from the changed entities produces a ranked set of tests ordered by structural proximity: tests that directly exercise a changed module rank highest, tests exercising modules that instantiate the changed module rank next, tests exercising interfaces driven by the changed module rank after that. This is a dependency map, not a coverage map, it answers "what could this change plausibly break" rather than "what lines did this change touch."

## Selection versus prioritization

The traversal above is doing something with a name in the testing literature, and it's worth using the name precisely rather than lumping it in with the ranking step that comes after it. Rothermel and Harrold's 1998 formulation of safe regression test selection turns on one result: a test can only be modification-*revealing* (able to expose a fault introduced by a change) if it's modification-*traversing* (it actually executes code the change touched). A test that never reaches the changed code is, by that result, not a candidate for catching a bug from that change, full stop. That's the formal version of the intuition the traversal is built on, and it's also why the backstop described below isn't a hedge against a weak model, it's the thing that keeps this design inside a known safety result instead of outside one.

The graph traversal, concretely, is safe test selection at a finer grain than most published implementations use. Dynamic tools like Ekstazi collect dependencies at the file level at runtime; static tools like STARTS build a class-level dependency graph and select whichever test classes reach a changed class. Neither goes below whole-file or whole-class granularity, because neither has a structural model of what's inside a file beyond import and class boundaries. The entity graph does: a change to one task inside a UVM sequence, or one register inside a block, traverses outward through `INSTANTIATES`, `DRIVES`, and `SEQUENCES_VIA` edges at the entity level, not the file level. That's a real granularity tradeoff, not a free upgrade, finer granularity means more edges to maintain and more places a missed edge produces a false negative, but it's a deliberate one, made possible by already having the entity graph for other reasons.

## Building the predictor

The traversal produces a candidate set and a structural distance score for each test. A lightweight model combines that with historical signal: has a test caught bugs in similar commits before? Is it flaky, a high failure rate unrelated to any RTL change? Is it expensive relative to how often it actually reveals something? The predictor's output is a ranked list with an estimated probability of catching a bug for this specific commit. The feature space is small and legible: structural distance from the changed entities, historical catch rate for similar change patterns, test runtime, flakiness rate, and coverage overlap with the changed lines. None of this needs to be a black box, every feature traces back to something an engineer could check by hand, just faster.

## The false-negative cost

No predictor is perfect, and a test excluded from a prioritized run might have been the one that would have caught the bug, that's a prioritization risk, not a selection risk, and the distinction from the previous section matters here: the traversal's safety argument covers what the graph includes as a candidate at all, not how the predictor then ranks and trims that candidate set for a fast pre-submit run. The way to manage the ranking risk is to never let the predictor remove tests from the full nightly regression. It only prioritizes a pre-submit subset, and the full suite still runs as a backstop, the thing that actually keeps a modification-traversing test from being silently dropped rather than just reordered. Build a calibration loop: when a test outside the prioritized subset catches a bug in the full nightly run, that's a calibration failure, and the predictor's weights get updated in response. Set confidence thresholds conservatively, erring toward inclusion, especially for tests with a strong historical track record of catching bugs other tests miss.

## Closing the loop

Every regression result is training data. A prioritized test passing is weak evidence the structural distance score was reasonable. A test outside the prioritized subset catching a bug in the nightly run is strong evidence of a gap in the model. The daemon's role: on regression completion, ingest the results, update historical catch rates, recompute scores for the entities the commit touched, and flag any out-of-subset catch for review. None of this requires a human to manually annotate anything, the feedback loop closes on its own, driven by results the regression was already producing.

## This isn't coverage-directed test generation

A different line of work, aimed at a related but distinct problem, is worth naming so the two don't get conflated. Reinforcement-learning approaches to hardware verification, CovR (Abdelatty, Nouh, and Reda, 2026) is a recent example, train a policy to decide what new test *stimulus* to generate next, guided by which parts of the design aren't yet covered. That's coverage-directed generation: the system is inventing new inputs to close coverage gaps, and the output is a learned, non-deterministic policy. What this article describes solves a different problem: given a change that already happened, which *existing* tests in an already-written suite are most likely to exercise it. The traversal here is deterministic, the same diff against the same graph produces the same ranked list every time, and it generates nothing; it narrows a suite that already exists. Coverage-directed generation and change-driven test selection are adjacent problems that could reasonably sit in the same pipeline, but neither substitutes for the other, and "coverage" means something different in each.

## Integration into CI without slowing the pipeline

The traversal and predictor scoring happen at commit time, before simulation starts, and take seconds. The output is a prioritized test list written to a file the CI system reads directly. The full regression still runs nightly, unchanged. The prioritized subset runs on every commit and can be tuned to a target runtime, "give me the tests most likely to catch a bug within a 30-minute window" is a real constraint the predictor can respect. None of this requires teams to change their existing simulation farm setup; it's a read from the daemon's query API, dropped into a job script that already exists.

---

*Next: [Querying Your Testbench](../querying-the-testbench), what structured state makes possible when the graph is live and the team can query it directly.*
