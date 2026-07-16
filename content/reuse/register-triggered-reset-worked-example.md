---
title: "Wiring a Register-Triggered Domain Reset End to End"
weight: 2
date: 2026-07-16
publishDate: 2026-07-16
draft: false
description: "A full worked example: a soft-reset register write, a callback, a coordinator, and every component that needs to react before the domain comes back up."
prev: /reuse/mid-sim-reset-plumbing
next: /reuse/config-object-plumbing
---

[Article 01](../mid-sim-reset-plumbing) built the general mechanism: a coordinator, ordered `pre_reset()`/`post_reset()` hooks, and a set of components that register with it. That mechanism doesn't do anything on its own until something tells the coordinator a reset actually happened. This article is the missing piece: a real soft-reset register write, and everything that has to fire between that write landing and the domain being safe to check again.

## The scenario

A power-management block exposes a `domain_ctrl` register. Writing a specific bit soft-resets domain A: every register in that domain reverts to its hardware reset value, any in-flight transaction targeting the domain gets aborted at the protocol level, and the domain needs a fixed number of cycles before it's safe to touch again. Nothing about the register write itself is unusual, it's an ordinary RAL `write()` call, exactly as [article 01 of the CSR series](/csr/ral-fundamentals) describes. What's unusual is everything downstream of it.

## Step 1: the intent rides with the write

The sequence issuing the reset doesn't call into the scoreboard or the coordinator directly. It attaches an extension, the mechanism a later CSR-series article covers, and moves on:

```systemverilog
class reset_intent_ext extends uvm_object;
  `uvm_object_utils(reset_intent_ext)
  string domain_name;
  int    settle_cycles;
endclass

task domain_a_soft_reset_seq::body();
  reset_intent_ext ext = reset_intent_ext::type_id::create("ext");
  ext.domain_name   = "domain_a";
  ext.settle_cycles = 40;

  csr.domain_ctrl.write(status, 32'h1, .extension(ext));
endtask
```

This is the same shape as the fault-injection example in the extensions article: the sequence's only job is to describe *what's happening*, not to manage every component that needs to react to it. That separation is what keeps the sequence readable and keeps the reaction logic in exactly one place instead of duplicated across every sequence that might ever trigger a domain reset.

## Step 2: a callback turns the write into a coordinator event

A `uvm_reg_cbs` registered on `domain_ctrl` catches the write once it's actually landed, and hands off to the coordinator from article 01:

```systemverilog
class domain_reset_callback extends uvm_reg_cbs;
  `uvm_object_utils(domain_reset_callback)
  reset_coordinator rc;

  virtual task post_write(uvm_reg_item rw);
    reset_intent_ext ext;
    if (rw.extension != null && $cast(ext, rw.extension)) begin
      fork
        rc.announce_reset(ext.domain_name, ext.settle_cycles);
      join_none
    end
  endtask
endclass
```

`post_write` rather than `pre_write` matters here: the coordinator should only fire once the write has actually gone out over the bus, not before. Firing it in `fork`/`join_none` matters too: `post_write` runs synchronously as part of the same call chain as the `write()` that triggered it, so the sequence that issued the write is still parked inside that call, waiting for it to return, for as long as `post_write` keeps running. `announce_reset()` runs the full two-pass hook sequence from article 01 across every registered component, real work that takes real simulation time, and blocking inside `post_write` for all of it would stall the sequence's register access call for exactly as long. `join_none` lets `announce_reset()` run as its own process instead, so `post_write` returns immediately and the write() call the sequence issued completes on schedule.

That immediacy has a cost worth naming: nothing here raises a phase objection while the detached `announce_reset()` is still settling, and nothing serializes two overlapping resets against the same domain. A production version needs one or both, an objection held until the coordinator finishes, and a per-domain guard against re-entering `announce_reset()` before a prior call's settle window has drained.

## Step 3: the coordinator's two passes run

The per-component reactions are article 01's mechanism, unmodified: monitors for domain A stop sampling and discard partial transactions, the scoreboard clears its outstanding-expectation table for domain A specifically, not the whole environment, and the predictor invalidates mirrored values for every register in that domain so the next access re-establishes them from a live read rather than trusting a value that reset just made stale. What does change, covered next, is the coordinator's own `announce_reset()`, extended with a settle window between the two passes.

```systemverilog
class domain_scoreboard extends reset_aware_comp;
  function bit watches_domain(string domain);
    return (domain == "domain_a");
  endfunction

  task pre_reset(string domain);
    clear_outstanding_expectations(domain);
    `uvm_info("RST", $sformatf("scoreboard quiesced for %s", domain), UVM_LOW)
  endtask

  task post_reset(string domain);
    rearm_checking(domain);
  endtask
endclass
```

## Step 4: the settle window

`settle_cycles` from the extension is what tells the coordinator, or more precisely whatever's waiting to call `post_reset()`, how long the domain needs before it's safe to check again. This is where a naive version of this pattern goes wrong: firing `post_reset()` immediately after `pre_reset()` re-arms checking before the domain has actually finished resetting in the DUT, and the first access after re-arming compares against a domain that hasn't settled yet.

This is the one real change to article 01's coordinator: `announce_reset()` there took a single `domain` argument and ran both passes back to back. Here it gains a second, defaulted argument so every existing single-argument call site keeps compiling unchanged, while a caller that actually has a settle time to report can pass it. The two-role-pass ordering from article 01, every observer's `pre_reset()` before any consumer's, carries over unchanged; only the settle window between the pre- and post-reset hooks is new:

```systemverilog
task reset_coordinator::announce_reset(string domain, int settle_cycles = 0);
  foreach (m_registered[i])
    if (m_registered[i].watches_domain(domain) && m_registered[i].is_observer())
      m_registered[i].pre_reset(domain);

  foreach (m_registered[i])
    if (m_registered[i].watches_domain(domain) && !m_registered[i].is_observer())
      m_registered[i].pre_reset(domain);

  if (settle_cycles > 0)
    repeat (settle_cycles) @(posedge clk);

  foreach (m_registered[i])
    if (m_registered[i].watches_domain(domain))
      m_registered[i].post_reset(domain);
endtask
```

The extension is what makes this settle time a property of *this specific reset event* rather than a constant hardcoded into the coordinator. A different register, or a different domain, might need a different number of settle cycles, and the sequence issuing the reset is the thing that actually knows the answer, the same way it knows the burst length or the master tag in the extensions article's other examples.

![Timeline from register write through callback, coordinator hooks, settle window, and re-arm, with the scoreboard's quiet window marked explicitly](/images/reuse/02-reset-timeline.svg)

## What this buys over the alternative

The alternative to this whole chain is a sequence that manually calls `scoreboard.disable()`, waits some number of cycles it picked by guessing, and calls `scoreboard.enable()` again, repeated in every sequence that might trigger a reset. That version works until two sequences trigger overlapping resets on different domains and their manual disable/enable windows interleave incorrectly, or until someone adds a new domain and forgets to update the guessed wait count in a sequence written before that domain existed. The coordinator version has exactly one place that knows how to quiesce and re-arm a domain, exactly one place the settle timing is threaded through, and every sequence that ever needs to trigger a reset gets that behavior for free by attaching an extension, the same win the CSR extensions article makes for error injection, applied here to a reset instead of a fault.

---

*Next: Config Object Plumbing at SoC Scale*
