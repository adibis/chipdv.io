---
title: "brokenbench"
weight: 1
date: 2026-08-17
publishDate: 2026-11-13
draft: false
description: "SystemVerilog, UVM and register-model exercises built around bugs that compile, run, and still get it wrong. Runs in your browser on a real Verilator build."
github: "https://github.com/adibis/brokenBench"
icon: cube
type: brokenbench
---

**brokenbench** is a set of SystemVerilog, UVM and register-model exercises built around the bugs that compile, run, and still get the answer wrong. Each one gives you a spec and some code, either a stub to finish or working code with a real bug in it, and a checker that decides whether you got it right. Not whether it compiled: whether it does what the spec says.

Every exercise runs in your browser on a real Verilator build. The register-model exercises come with step-by-step walks of the mechanism each bug lives in. All of it is open source, so you can also clone the repository and run the same exercises on your own machine.
