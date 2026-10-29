---
title: "brokenbench"
weight: 1
date: 2026-08-17
publishDate: 2026-10-29
draft: false
description: "A growing set of real interview and practice problems across SystemVerilog, UVM, and register-map verification -- a checker tells you unambiguously whether you got it right."
github: "https://github.com/adibis/brokenBench"
icon: cube
cascade:
  type: docs
---

**brokenbench** is a growing set of real interview and practice problems across SystemVerilog, UVM, and register-map (CSR) verification. SV and UVM are here today; CSR is next.

It's a [ziglings](https://codeberg.org/ziglings/exercises)/[rustlings](https://github.com/rust-lang/rustlings)-style exercise repo: every exercise is a single self-contained `.sv` file with a checker at the bottom that tells you, unambiguously, whether you got it right. No tutorials, no multiple choice. Most exercises hand you a spec in a comment and an empty stub -- get the constraint logic right against a checker built to catch partial credit, not just crashes. A handful hand you working code with a real bug already sitting in it, the kind that compiles clean and looks fine until you read the actual compiler output or runtime failure and find what's wrong.

This isn't generic SystemVerilog trivia. Every exercise is built around a mistake or a gap that actually shows up in real constrained-random verification code -- including several genuine, currently-open Verilator bugs found and confirmed while building this repo, documented directly in its README rather than papered over. A row-slice `unique{}` crash, `dist` weights that silently skew once combined with other constraints, array-reduction methods that quietly do nothing on a struct-typed array -- the kind of thing that costs an afternoon the first time it happens to you in a real testbench.

[github.com/adibis/brokenBench](https://github.com/adibis/brokenBench)

## Every exercise, by track

{{< cards cols="2" >}}
  {{< card link="/projects/brokenbench/sv/" title="SystemVerilog Practice Problems" subtitle="Twelve interview-prep exercises: constrained-random gotchas, multi-dimensional uniqueness, lifecycle hooks, and the kind of mistake that compiles clean and passes a casual read." >}}
  {{< card link="/projects/brokenbench/uvm/" title="UVM Testbench Interview Problems" subtitle="Eight UVM component-level bugs: config_db scoping and precedence, factory-override ordering, objection lifecycle errors, analysis-port aliasing, scoreboard correlation design." >}}
  {{< card link="/projects/brokenbench/csr/" title="Fixing UVM RAL and uvm_reg Bugs" subtitle="Six uvm_reg and register-map exercises: uvm_mem's missing mirror state, predictor and mirror synchronization gaps, access-policy mistakes." >}}
  {{< card link="/projects/brokenbench/learn/" title="Learn SystemVerilog Constraints from Scratch" subtitle="Fourteen exercises for engineers who haven't written SystemVerilog constraints before: dist weights, inside, foreach, implies, inheritance, and common UVM lifecycle mistakes." >}}
{{< /cards >}}
