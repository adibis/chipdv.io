---
title: "brokenbench"
weight: 1
date: 2026-08-17
publishDate: 2026-08-17
draft: false
description: "A growing set of real interview and practice problems across SystemVerilog, UVM, and register-map verification -- a checker tells you unambiguously whether you got it right."
github: "https://github.com/adibis/brokenBench"
---

**brokenbench** is a growing set of real interview and practice problems across SystemVerilog, UVM, and register-map (CSR) verification. SV and UVM are here today; CSR is next.

It's a [ziglings](https://codeberg.org/ziglings/exercises)/[rustlings](https://github.com/rust-lang/rustlings)-style exercise repo: every exercise is a single self-contained `.sv` file with a checker at the bottom that tells you, unambiguously, whether you got it right. No tutorials, no multiple choice. Most exercises hand you a spec in a comment and an empty stub -- get the constraint logic right against a checker built to catch partial credit, not just crashes. A handful hand you working code with a real bug already sitting in it, the kind that compiles clean and looks fine until you read the actual compiler output or runtime failure and find what's wrong.

This isn't generic SystemVerilog trivia. Every exercise is built around a mistake or a gap that actually shows up in real constrained-random verification code -- including several genuine, currently-open Verilator bugs found and confirmed while building this repo, documented directly in its README rather than papered over. A row-slice `unique{}` crash, `dist` weights that silently skew once combined with other constraints, array-reduction methods that quietly do nothing on a struct-typed array -- the kind of thing that costs an afternoon the first time it happens to you in a real testbench.

[github.com/adibis/brokenBench](https://github.com/adibis/brokenBench)
