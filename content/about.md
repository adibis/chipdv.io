---
title: About
---

Hardware verification doesn't have the same open-source, write-it-down culture that software does. Most of what's genuinely useful lives in company wikis, conference papers behind a paywall, or in the head of whoever's been doing this the longest on your team. Most of what's public stops at "ChatGPT can write UVM" and doesn't go any deeper.

This site is where I write that part down: the CSR patterns that actually catch bugs, the memory-allocation failures that only show up at SoC scale, the firmware races that need a full multi-core load to reproduce, and where LLMs genuinely help, or quietly fail, at each of those jobs.

## Who's writing this

**chipDV** is written by Aditya Shevade, a design verification engineer with 15 years in the field, currently at Meta. His background spans Google's TPUs and Qualcomm's AI and Snapdragon chips, from unit-level verification through SoC, post-silicon, and emulation.

Get in touch: [aditya.shevade@gmail.com](mailto:aditya.shevade@gmail.com) · [github.com/adibis](https://github.com/adibis) · [LinkedIn](https://www.linkedin.com/in/adityashevade)

---

## Topics covered here

- Using LLMs for SVA, testbench generation, and debug, and just as importantly, where they still fail
- UVM register (CSR) verification: access types, callbacks, extensions, reg map reuse
- Memory allocation patterns (`uvm_mem_mam`) across block, chiplet, and SoC integration
- Testbench architecture that survives reuse: reset plumbing, config propagation, driver overrides
- Firmware verification: multi-core races, message-based logging, emulation and post-silicon reuse
- Knowledge graphs and structured retrieval for chip design

## Colophon

Built with [Hugo](https://gohugo.io) and the [Hextra](https://github.com/imfing/hextra) theme. Diagrams are hand-built SVGs lettered in Tecnico Fino. Code blocks are highlighted with Chroma using a Catppuccin palette (Latte in light mode, Mocha in dark).
