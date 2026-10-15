---
title: "SoC-Level Register Stress Patterns"
weight: 6
date: 2026-10-10
publishDate: 2026-10-10
draft: false
description: "Parallel access through a shared CSR bridge with multiple masters, and back-to-back zero-delay writes followed by readback."
prev: /csr/volatile-registers
---

Everything in this series so far tests a register in isolation: one master, one access, checked against the model. At the SoC level, registers are frequently reachable from more than one master through a shared bridge, and the built-in sequences from [What the Built-in Sequences Actually Test](../builtin-sequence-limits) have no concept of that at all. They issue one transaction, wait for it to complete, and move to the next. The bugs that live at this level aren't register-model bugs. They're bridge arbitration, ordering, and timing bugs that only exist under contention, and no amount of single-master register testing will find them.

## Why a shared CSR bridge with multiple masters is a real test target

A shared CSR bridge, the block that fans a register address space out to more than one bus master, common where a management processor and a DMA engine (or two independent processors) both need access to the same control block, has to arbitrate. Arbitration logic is simple to write and easy to get subtly wrong under contention: a grant that doesn't fully revoke before the next request is serviced, a response FIFO that returns a completion to the wrong requester if two responses land in the same cycle, an address-phase/data-phase pipeline that assumes single-master traffic and quietly corrupts the second master's transaction when both fire in the same cycle. None of this shows up if the testbench only ever drives one master through the bridge at a time, which is what block-level register tests do by construction, because they typically don't have a second master agent connected in the first place.

## Building the parallel access test

This needs two, or more, virtual sequences running concurrently, each driving a different master's agent, targeting either the same register or two registers that share bridge resources: an output buffer, an arbitration slot. The test isn't about whether either individual write succeeds. Each one would pass fine on its own. It's about whether the interleaving corrupts either transaction. Concretely: master A issues a write to register R at the same simulation time master B issues a read of register R. Does the read return the pre-write or post-write value in a way consistent with some valid arbitration order, or does it return a torn, partially-updated value that corresponds to neither ordering? A correct arbiter guarantees one of the two orderings happened. A buggy one can produce a result that isn't the outcome of either.

The scoreboard side of this is worth being deliberate about, because the correct answer is "either ordering is acceptable." The check can't be a simple expected-value compare against a single predicted result. It needs to accept either legal ordering and only flag a failure when the observed value matches neither, otherwise the test becomes flaky by design, failing on a valid interleaving the arbiter was entitled to choose. This is one of the few places in register verification where the RAL mirrored value, built for exactly one requester's view of the world, stops being the right tool, and the check has to be written directly against what both masters observed.

![Two masters contending for register R through a shared bridge: a legal result matches one of two orderings, an illegal one matches neither](/images/csr/06-parallel-access.svg)

```systemverilog
// virtual sequence: two masters contend for the same register
task parallel_access_seq::body();
  fork
    begin
      master_a_write_seq.start(p_sequencer.master_a_sqr);
    end
    begin
      master_b_read_seq.start(p_sequencer.master_b_sqr);
    end
  join

  // scoreboard accepts either legal ordering, not one predicted value
  if (observed_read_value !== pre_write_value &&
      observed_read_value !== post_write_value)
    `uvm_error("SOC_CSR", "torn value, matches neither legal ordering")
endtask
```

## Back-to-back zero-delay writes and readback

The second gap the built-ins leave open: nothing in `reg_bit_bash_seq` or `reg_access_seq` issues a write and then immediately, same cycle or the next available cycle, no idle gap, issues another write to the same or an adjacent register, followed by a readback confirming both landed. Most register test sequences insert enough delay between transactions, deliberately or as a side effect of how the sequence is written, that zero-delay back-to-back access simply never gets exercised.

This matters because that's exactly the pattern a real firmware burst write or a DMA descriptor update produces: writing several adjacent configuration registers as fast as the protocol allows, no software-inserted delay between them, then reading the block back to confirm the whole burst landed before proceeding. A bridge or register bank with a pipelining bug, a write that hasn't fully committed to storage before the next write's address phase begins, a bug in how consecutive same-address writes are handled if the second write's data arrives before the first write's completion is signaled, is invisible to any test that pads even a single idle cycle between transactions. The test needs to explicitly configure zero inter-transaction delay at the driver level (most UVM drivers default to some gap unless told otherwise) and read every register in the burst back in the same tight-timing style, to catch a completion that silently didn't finish before the next operation started.

```systemverilog
// zero-delay burst write, then readback: most sequences never do this
task back_to_back_burst_seq::body();
  uvm_status_e status[int];

  driver_cfg.min_gap_cycles = 0;   // no idle cycle between transactions

  // write() is a blocking task with no non-blocking mode of its own;
  // fork each call so the next write's address phase can start before
  // the previous one's completion is signaled.
  foreach (burst_regs[i]) begin
    automatic int idx = i;
    fork
      burst_regs[idx].write(status[idx], burst_data[idx]);
    join_none
  end
  wait fork;   // block here until every forked write has completed

  foreach (burst_regs[i]) begin
    uvm_reg_data_t readback;
    burst_regs[i].read(status[i], readback);
    if (readback !== burst_data[i])
      `uvm_error("SOC_CSR", $sformatf(
        "reg %s: wrote 'h%0h, read back 'h%0h, burst write did not fully commit",
        burst_regs[i].get_name(), burst_data[i], readback))
  end
endtask
```

## Why these belong in the SoC-level test plan, not the block-level one

Neither scenario means much at the block level. A block-level register environment typically has exactly one master agent, so there's no second requester to race against and no shared bridge arbitration logic to stress. These are structurally SoC-level tests. They require the actual integration topology, the real bridge, the real number of masters, to exist in the testbench at all. Trying to back-port them into a block-level environment usually means building a fake second master and a fake bridge that don't match what ships in the SoC, which is effort spent verifying a model of the integration instead of the integration itself. The test plan should place these explicitly at the SoC level and treat their absence from block-level register sign-off as expected, not as a gap block-level regression somehow needs to cover.

---

*Next: The Waiver Problem and a Scalable Waiver Manager — why blanket register testing fails for interrupt generators and FSM-driven registers, and a singleton waiver manager built on include files.*
