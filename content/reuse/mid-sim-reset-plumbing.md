---
title: "Mid-Sim Reset: Why UVM's Phase Model Doesn't Help"
weight: 1
date: 2026-07-02
publishDate: 2026-07-02
draft: false
description: "Phases run once. A reset landing mid-regression isn't a phase boundary, and the framework has no built-in answer for what should happen next."
next: /reuse/register-triggered-reset-worked-example
---

A block-level test almost never has to think hard about reset. There's a reset at the start of the test, `run_phase` begins after it deasserts, and the environment's state is clean because nothing has happened yet to make it dirty. That assumption quietly stops holding the moment the same environment gets reused at subsystem or SoC level, where a power-management sequence can assert a domain reset ten minutes into an already-running regression, with scoreboards mid-comparison and sequences mid-transaction. UVM's phase system, which every environment component is built around, has no representation for that event at all.

## Phases run once, and reset isn't one of them

`build_phase`, `connect_phase`, `run_phase` and the rest execute exactly once per test, in a fixed order, and the framework has no concept of re-entering an earlier phase partway through a later one. That's fine, because a mid-sim domain reset shouldn't re-run `build_phase` even if there were a way to trigger it. `build_phase` constructs topology: agents, sequencers, the scoreboard instance itself. None of that changed. What changed is state: the scoreboard's notion of what value it currently expects to see, the predictor's mirrored register values for that domain, whatever a monitor's internal protocol state machine currently thinks is in flight. Reset needs to clear state without touching structure, and nothing in the phase model draws that line, because the phase model was never designed to run more than once.

## What actually needs to reset, and what has to survive it

Treating reset as "tear down and rebuild" throws away things that have real value and were never supposed to be reset in the first place. Coverage sampled before the reset event is still valid coverage; a domain reset doesn't un-happen the traffic that led up to it. Factory overrides and config objects describe how the environment is built, not what state it's currently in, and rebuilding them mid-test risks silently reverting an override a higher-level test set deliberately. TLM connections between components are wiring, not state, and tearing them down and reconnecting them is both expensive and unnecessary.

What genuinely needs to reset is narrower: any component tracking an expectation about what the DUT currently holds. The scoreboard's outstanding-transaction table. The predictor's mirrored register values for the domain that just reset, specifically, not the whole register map, since a later CSR-series article already covers registers whose value changes for reasons outside any `write()` call, and a domain reset is exactly that kind of reason. A protocol checker's internal counter for "cycles since the last expected response." All of these are state that describes the DUT's *history*, and a reset makes that history irrelevant for the domain it affects.

## A coordinator, not a broadcast signal

The mechanism that works is a central reset coordinator that reset-aware components register with once, during `connect_phase`, and that fires ordered hooks when a reset event for a given domain is reported to it.

```systemverilog
class reset_coordinator extends uvm_component;
  `uvm_component_utils(reset_coordinator)

  local reset_aware_comp m_registered[$];

  function void register(reset_aware_comp c);
    m_registered.push_back(c);
  endfunction

  task announce_reset(string domain);
    // two role-grouped sub-passes, not registration order: every observer's
    // pre_reset() (monitors halting sampling) completes before any
    // consumer's pre_reset() (scoreboards, predictors clearing state) runs,
    // regardless of which order components happened to register in
    foreach (m_registered[i])
      if (m_registered[i].watches_domain(domain) && m_registered[i].is_observer())
        m_registered[i].pre_reset(domain);

    foreach (m_registered[i])
      if (m_registered[i].watches_domain(domain) && !m_registered[i].is_observer())
        m_registered[i].pre_reset(domain);

    foreach (m_registered[i])
      if (m_registered[i].watches_domain(domain))
        m_registered[i].post_reset(domain);
  endtask
endclass
```

This first cut fires `post_reset()` immediately after `pre_reset()` completes, with nothing in between. That's fine as long as nothing downstream needs time to actually settle after the two passes run, which [article 02](../register-triggered-reset-worked-example) shows isn't always true, and extends `announce_reset()` with a defaulted settle-cycle argument to cover it, without breaking the single-argument call this section shows.

```systemverilog
virtual class reset_aware_comp extends uvm_component;
  function void register_with_coordinator(reset_coordinator rc);
    rc.register(this);
  endfunction

  // not pure virtual: defaults to 0 (consumer), so existing subclasses
  // that predate this method, scoreboards and predictors, don't need to
  // change at all. Only monitors, the observers, override it to 1.
  virtual function bit is_observer();
    return 0;
  endfunction

  pure virtual function bit watches_domain(string domain);
  pure virtual task pre_reset(string domain);
  pure virtual task post_reset(string domain);
endclass
```

A monitor implements `pre_reset()` by halting sampling and discarding whatever partial transaction it was mid-collection on. A scoreboard implements it by clearing its outstanding-expectation table for that domain, and implements `post_reset()` by re-arming once the domain is confirmed back up. A predictor implements `pre_reset()` by invalidating mirrored values for every register in the domain, forcing the next access to re-establish them from a live read rather than trust a stale mirror, the same defensive move a later CSR-series article makes for ordinary volatile registers, applied here to an entire domain at once instead of one field.

![A reset coordinator firing ordered pre_reset and post_reset hooks against every registered component, contrasted against a UVM phase timeline with no representation for a mid-run reset event](/images/reuse/01-reset-coordinator.svg)

## Why the ordering matters

Firing every component's `pre_reset()` in registration order rather than a defined order is the most common way this pattern breaks in practice. A monitor that hasn't yet stopped sampling when the scoreboard clears its expected-state table can push one more observed transaction into a scoreboard that's already quiet, and that transaction is silently dropped or, worse, compared against whatever the scoreboard's table happens to contain immediately after clearing rather than before. That's why `announce_reset()` above doesn't fire `pre_reset()` in one flat pass over `m_registered`: it runs `is_observer()` components first, monitors quiescing before anything that *consumes* those observations (scoreboards, predictors) clears its state, and only after both role-passes finish does `post_reset()` run to re-arm everyone. Registration order genuinely doesn't matter anymore, which is the entire point of checking `is_observer()` instead of relying on the order components happened to call `register()` in.

## Virtual sequences mid-flight

A virtual sequence that's partway through driving a multi-step scenario when a domain reset lands is the harder case, because a sequence is a process, not a component with hooks the coordinator can call directly. Killing the process outright with `uvm_sequence_base::kill()` is tempting and usually wrong: a sequence killed mid-`fork` can leave objections raised that never get dropped, hanging the phase it was running in until a timeout fires far later with a confusing error nowhere near the actual cause.

The more robust pattern is cooperative: a reset-aware sequence subscribes to the same coordinator via a lightweight event, checks it at defined yield points between steps, and exits cleanly, dropping its own objections, the moment it observes a reset for a domain it cares about. This pushes a small amount of extra discipline onto sequence authors, checking the event between steps rather than assuming a scenario runs start to finish uninterrupted. It's the same trade the rest of this series keeps making: a small amount of upfront structure in exchange for not debugging a hung regression at two in the morning because a sequence's objection never dropped.

---

*Next: [Wiring a Register-Triggered Domain Reset End to End](../register-triggered-reset-worked-example) — the coordinator above, driven from an actual register write.*
