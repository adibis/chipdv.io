---
title: "Ten Ways Code Lies: brokenbench for Interviews"
weight: 1
date: 2026-10-26
publishDate: 2026-10-26
draft: false
description: "brokenbench already tests whether you can write correct constrained-random code from a spec. Here's a taxonomy for the second skill the AI era also demands: catching code, yours or a model's, that compiles clean while being wrong."
---

[brokenbench](/projects/brokenbench/) is a [ziglings](https://codeberg.org/ziglings/exercises)/[rustlings](https://github.com/rust-lang/rustlings)-style set of SystemVerilog and UVM exercises -- leetcode for constrained-random verification. Most exercises hand you a spec in a comment and an empty class, and you write the constraint logic yourself against a checker built to catch partial credit, not just crashes. A smaller set hands you working code with a real bug already sitting in it instead, and the job is to find it before the checker does. Either way: no tutorials, no multiple choice, a checker that says `PASS` or it doesn't.

Writing correct code from a spec is still the right first filter, and it isn't going away. It's just not the whole filter anymore. A model can produce that same constraint block, assertion, or scoreboard in seconds, and the result will compile, run, and usually print `PASS` -- which means a candidate's own write-from-scratch answer can look just as clean without actually being right. What a model is bad at, and what a careless engineer is just as bad at, is the second half of the job: looking at code, its own or someone else's, and telling whether a clean run actually proves anything. That's a different skill than writing the constraint in the first place, and it's the one that increasingly separates a good engineer from a bad one once a model is generating a chunk of the first draft either way.

This post is the exercise taxonomy for that second skill -- categories, a scoring rubric, and four cases worked all the way through in code, because a table of categories alone doesn't show what any of this looks like in practice.

## What a green run doesn't prove

An interview that asks a candidate to write a `randomize()` call and watch it compile is testing syntax. It was never testing much more than that, but it mattered less when writing the syntax was the bottleneck. It isn't anymore. The bottleneck has moved to reading: given code that already compiles, runs, and terminates cleanly, can someone tell whether it does what the spec says?

Three principles follow from that shift:

- **Ground truth traces to the LRM, never to a simulator's output.** A tool can be wrong. The spec is the only fixed point.
- **The failure is silent.** No compile error, no `UVM_ERROR`, no failing assertion. If the bug announces itself, it isn't testing the right skill.
- **Grading is by rubric, not interviewer taste.** A checker or a written rubric decides -- the same discipline every brokenbench exercise already runs on, no partial credit for code that merely compiles.

## Anatomy of an exercise

Every exercise is a small, self-contained unit with the same six fields:

| Field | Content |
| --- | --- |
| Context | A spec fragment, a few lines: what the block has to do |
| Artifact | Plausible, self-consistent code, 40 to 150 lines |
| Seeded defects | Zero to three, each tagged with a category |
| Ground truth | The correct behavior, and how it's derived from the spec |
| Oracle | How to confirm it: a second simulator, a directed test, a formal property |
| Rubric | Points for detection, diagnosis, and a falsifying test; a deduction for false positives |

Scoring runs on four axes, not one pass/fail:

1. **Detection** -- was the defect found at all?
2. **Diagnosis** -- is the stated cause correct, and tied back to the spec?
3. **Falsification** -- did the candidate propose a test that would actually have caught it?
4. **Calibration** -- how often did they flag something that wasn't there, and did their stated confidence match their accuracy?

Detection without diagnosis is a guess that happened to land. Diagnosis without falsification is an opinion. All four together is what separates someone who read the code from someone who merely skimmed it and got lucky.

## Ten ways code lies

| Category | Typical defect | Tests whether the candidate | Tier |
| --- | --- | --- | --- |
| Randomization hygiene | Unchecked `randomize()` return; `assert()` wrapper skipped with assertions off; stale fields after a failed solve | Reads past the happy path | 1-2 |
| Constraint semantics | `dist` `:=` vs `:/`; `solve ... before` misread as precedence; implication quietly narrowing coverage | Knows what a constraint means, not just how it reads | 2 |
| Cross-tool divergence | Identical constraints, different outcome per simulator | Adjudicates by the LRM, not by majority vote | 3 |
| Assertions | Vacuous antecedent; same-cycle vs next-cycle implication swapped; missing `disable iff`; `$past` evaluated at reset | Asks whether the property could ever actually fail | 1-3 |
| Coverage | Default 64 auto-bins swallowing a wide field; wrong sampling event; a bin that masks a hole | Distrusts the percentage | 2 |
| Reference models | A scoreboard that shares the RTL's own function; ordering assumed on an out-of-order interface | Spots circular checking | 2-3 |
| Timing and scheduling | Blocking drive and sample on the same edge; no clocking block; reset released off the clock | Reasons about the event scheduler | 2-3 |
| Test adequacy | A watchdog that ends the run and reports PASS; no fault injection; a missing self-check | Asks what would actually make the test fail | 2 |
| Spec ambiguity | The artifact silently picked one reading of an underdetermined spec | Asks the question instead of accepting the answer | 3 |
| Fabricated or mismatched APIs | A UVM method that doesn't exist in the version in use | Low discriminating power, but a useful calibration anchor | 1 |

Difficulty tiers aren't about how obscure a defect is. They're about what it takes to find it:

| Tier | Found by | Separates |
| --- | --- | --- |
| 1 | Careful reading with working LRM knowledge | Attentive readers from skimmers |
| 2 | Running a counterfactual -- histogram the distribution, break the DUT, hit the antecedent on purpose | Candidates who test a claim from those who accept it |
| 3 | Adjudicating between tools or an ambiguous spec, with no single correct action, only sound reasoning | Seniors who calibrate from those who merely know |

Include clean artifacts with no seeded defect in roughly one exercise out of five. Someone who finds a bug in every file is pattern-matching, not reading.

## Four of these, worked

A table of categories tells you the shape of the problem. It doesn't show what the lie actually looks like. Four worked cases, one per tier range, do.

### 1. The return value nobody checks

```systemverilog
class addr_seq_item extends uvm_sequence_item;
  `uvm_object_utils(addr_seq_item)
  rand bit [31:0] addr;

  constraint c_aligned { addr[1:0] == 2'b00; }
  constraint c_region  { addr inside {[32'h1000:32'h1FFF]}; }

  function new(string name = "addr_seq_item");
    super.new(name);
  endfunction
endclass
```

Elsewhere in the same sequence, a later constraint narrows `addr` to a range below `c_region`'s floor -- a reasonable-looking override added for a different test case, now sitting in the same class. Combined with `c_region`, the solver has no legal value left to pick.

```systemverilog
task body();
  addr_seq_item item = addr_seq_item::type_id::create("item");
  item.randomize();   // return value never checked
  `uvm_send(item)
endtask
```

Per the LRM, a `randomize()` call that fails to satisfy all active constraints returns `0` and leaves every `rand` variable at its last successfully randomized value -- `addr`'s construction-time default of zero, since this item has never randomized successfully. `0` is itself a plausible address. The item drives, the monitor samples it, nothing downstream complains. Coverage for `c_region`'s intended range just silently never closes, for an item type that looks, on paper, like it's being generated correctly every time.

Finding it requires reading `randomize()`'s return value the way you'd read any other function's, and asking: what does `addr` actually hold when this fails?

### 2. Same comment, different arithmetic

```systemverilog
class pkt_item extends uvm_sequence_item;
  rand int unsigned pkt_len;

  // roughly equal weight to a short or default-length packet;
  // large packets should be rare
  constraint c_len {
    pkt_len dist {
      [1:3]      := 10,
      64         := 10,
      [128:1023] := 1
    };
  }
endclass
```

The comment states the intent plainly, and the constraint looks like it implements it: three buckets, comparable weights, the big one barely represented. `:=` doesn't do that. It assigns its weight to *each individual value* in a range, not to the range as a whole. `[1:3] := 10` gives three values a weight of 10 apiece, for a bucket total of 30. `[128:1023] := 1` gives 896 values a weight of 1 apiece, for a bucket total of 896. The 896-value range the comment calls rare ends up the overwhelming majority of what actually gets generated:

![Bar chart comparing pkt_len dist{} outcomes: the := operator sends about 96% of generated values into the "rare, large packet" bucket meant to be uncommon, while the :/ operator produces the roughly even split across buckets the comment actually describes](/images/blog/01-dist-weight-skew.svg)

`:/` is the operator that does what the comment says: it divides its weight *across* the range, so `[128:1023] :/ 1` gives the whole 896-value bucket a combined weight of 1, matching `64`'s single-value weight of 1 one-for-one. Nothing here crashes or looks out of place in a code review; `:=` and `:/` differ by one character and both compile. The only way to catch it is to not trust the comment and actually histogram what the constraint produces, the way you'd verify any other claim about distribution.

### 3. The cycle that moves

```systemverilog
// Spec: while req is held, ack must assert the same cycle it's sampled high.
property p_same_cycle_ack;
  @(posedge clk) req |=> ack;
endproperty
assert property (p_same_cycle_ack);
```

`|=>` is non-overlapping implication: the consequent is checked one clock *after* the antecedent, not in the same cycle. The spec calls for same-cycle behavior, which is what `|->` checks. On a real handshake, `req` is a level signal held across multiple cycles until `ack` arrives, so by the next cycle `ack` is usually already high from the assertion the cycle before, or close enough that the property keeps finding a `1` to check against. The one cycle that actually mattered, where `req` first went high and `ack` was still low, is never the cycle this property samples. It passes, every run, on a DUT that violates the spec on the very first handshake of every test.

The fix is one character, `|->` instead of `|=>`, and the property catches the exact same violation immediately. Finding the bug beforehand means noticing that the consequent's timing doesn't match the spec's timing, not that the property syntax is valid SVA.

### 4. The scoreboard that agrees with itself

```systemverilog
// predicts the CRC the monitor should see on the response channel
function bit [31:0] predict_crc(bit [7:0] data[]);
  return dut_pkg::crc32_calc(data);
endfunction
```

Nothing here is syntactically wrong, and in isolation it reads like a perfectly normal predictor: compute the expected value, compare it to what the monitor captured. The problem is `dut_pkg::crc32_calc` -- it's the RTL's own CRC function, pulled in because it was already written, tested, and convenient to reuse instead of writing a second implementation from the spec. If that function has a bug -- wrong polynomial, wrong bit order, doesn't matter which -- the scoreboard calls the same wrong function the RTL calls and gets the same wrong answer on both sides. Every comparison passes. The check never had two independent sources of truth; it had one function called twice.

This one doesn't live in the code at all. It lives in where the code came from, and no amount of reading the scoreboard's logic in isolation surfaces it. The only way to catch it is to ask, separately from the code: is this prediction actually independent of the thing it's checking, or does it share an implementation?

## Keeping it honest

A published benchmark is a training target, and candidates can rehearse a public catalog the way they'd rehearse any other interview question bank. Both are the same underlying problem: the exercise set has to keep producing an honest signal after it's been seen.

- Keep a private holdout, derived from the public categories but not copied from public cases.
- Generate variants by swapping widths, names, and operators while preserving the actual defect.
- Keep clean controls in the mix, so bug-hunting by reflex gets penalized as often as missing a real one.
- Run an AI-allowed mode: let the candidate use a model live, and score how well they evaluate what it hands back, not whether they used one.

## What's next

Categories and worked examples are the argument. The actual test is exercises someone can run, so this taxonomy is landing in [brokenbench](/projects/brokenbench/) itself, not staying a blog post. New exercises are going in under a tag built for exactly this shape of bug: `plausible-pass` -- the broken version compiles, runs, and survives a casual read or a single smoke-test run, and only a rigorous, independent check catches what's actually wrong. It cuts across tracks on purpose, because the skill it's testing isn't specific to constraints: a SystemVerilog exercise where an unsatisfiable constraint fails silently behind a `randomize()` return nobody checks, a UVM scoreboard whose predictor turns out to call the same function the DUT does, a CSR exercise where a "confirmed" write never actually reached hardware because the check trusted the register model's own mirror instead of reading the bus back.

The reasoning doesn't change per track: a model will write all three of these with total confidence, and so will a careless engineer. The difference between a good one and a bad one, once a model is drafting a chunk of the first pass either way, is whether they catch it. That's the gap brokenbench's `write-from-scratch` exercises were never built to measure, and it's the one worth building for now.
