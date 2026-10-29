---
title: "UVM Testbench Interview Problems"
weight: 4
date: 2026-10-29
publishDate: 2026-10-29
draft: false
description: "Eight UVM component-level bugs: config_db scoping and precedence, factory-override ordering, objection lifecycle errors, analysis-port aliasing, scoreboard correlation design, virtual-sequencer handshake timing."
prev: /projects/brokenbench/sv
next: /projects/brokenbench/csr
---

UVM component-level bugs, the kind that compile clean, run clean, and still don't test what they look like they're testing. `config_db` scoping and precedence, factory-override ordering, objection lifecycle errors, analysis-port aliasing, scoreboard correlation design, virtual-sequencer handshake timing. Every checker is correct as given; fix only what the write-up asks for, and leave anything below the checker marker alone.

### Factory Override {#factory-override}

{{< badge "factory-override" >}} {{< badge "phase-ordering" >}}

**Factory override compiles clean and runs clean, but the DUT's parity checker never actually gets tested.**

{{% details title="The spec and the fix" closed="false" %}}

A register-write test wants to run with an error-injecting driver instead of the normal one, so the DUT's write-parity checker actually gets exercised: the error-injecting driver corrupts one bit of every write, and the checker is supposed to catch it. Swapping drivers is done with a factory type override -- `base_write_driver` -> `error_inject_write_driver` -- so the env's own code never has to know the error-injecting variant exists.

Run this: the test believes it configured the error-injecting driver, but `env.drv` is still a plain `base_write_driver`.

Fix the code so `env.drv` really is an `error_inject_write_driver`.

Try it yourself: `make run EX=factory_override` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/factory_override.sv).

{{% /details %}}

### Error Path Double Drops Objection {#error-path-double-drops-objection}

{{< badge "objections" >}} {{< badge "phase-ending" >}} {{< badge "error-path" >}}

**Five items, one of them bad, and the simulation dies on the bad one -- not with a checker failure, with a UVM_FATAL.**

{{% details title="Full breakdown" closed="true" %}}

`run_phase` processes 5 items, one at a time: raise an objection for the item, process it, drop the objection. Item 2 fails validation. The error-handling path added for that case works fine on its own -- it's the interaction with the rest of the loop body that's wrong.

Run this: the test never gets past item 2.

Fix the code so all 5 items are processed, including the bad one, without the simulation dying.

Try it yourself: `make run EX=error_path_double_drops_objection` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/error_path_double_drops_objection.sv).

{{% /details %}}

### Agent IDs via Config DB {#agent-ids-via-config-db}

{{< badge "config-db" >}} {{< badge "multi-instance" >}} {{< badge "fork-join" >}}

**Four DMA channel agents, four configured channel ids, one wrong answer reported four times.**

{{% details title="Full breakdown" closed="true" %}}

A DMA subsystem env builds one agent per channel -- NUM_CHANNELS of them, each one talking to a different hardware DMA channel. Every agent needs to know which channel it owns, so the test configures each agent's `channel_id` via `uvm_config_db` before the env is built: channel 0 must end up owning id 10, channel 1 owning 20, channel 2 owning 30, channel 3 owning 40.

Before trusting the rest of the environment to run real stimulus, `run_phase` does a standard sanity check first: query every channel agent concurrently and confirm each one owns the channel the test actually configured it for. Catching a wiring mistake here, before stimulus starts, is a lot cheaper than debugging why traffic meant for one channel mysteriously shows up on a different channel's monitor two hours into a regression.

Run this: the sanity check fails, and it reports the same channel id four times.

Fix the code so every channel agent reports its own configured id.

Try it yourself: `make run EX=agent_ids_via_config_db` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/agent_ids_via_config_db.sv).

{{% /details %}}

### Config Override Loses to Legacy Default {#config-override-loses-to-legacy-default}

{{< badge "config-db" >}} {{< badge "precedence" >}}

**The test's override compiles clean, runs clean, and still silently loses.**

{{% details title="Full breakdown" closed="true" %}}

Early in `build_phase`, the test sets a broad default for everything under the agent -- config that predates this test and is meant to apply hierarchy-wide. Further down the same `build_phase`, the test sets a specific override for this run, scoped directly through the agent handle it just created, since that's the most precise handle available.

Run this: the override is 7. `a.channel_id` comes out 999 -- the broad default -- instead.

`uvm_config_db::set()` computes precedence from the depth of the component passed as its first argument, not from which call is more specific or which one runs last. A call scoped through a deeper component's handle gets a lower precedence than one scoped through a shallower one, even when the deeper call is the one meant to win.

Fix the test's override so `a.channel_id` ends up 7. Don't touch `chan_agent`.

Try it yourself: `make run EX=config_override_loses_to_legacy_default` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/config_override_loses_to_legacy_default.sv).

{{% /details %}}

### Deferred Subscriber Needs Clone {#deferred-subscriber-needs-clone}

{{< badge "analysis-port" >}} {{< badge "clone" >}} {{< badge "do_copy" >}}

**Every deferred transaction ends up showing the very last one's data, not its own.**

{{% details title="Full breakdown" closed="true" %}}

`producer` reuses a single `xact` handle across every broadcast instead of allocating a fresh one each time -- a legitimate, common pattern for a monitor that samples the bus every cycle and doesn't want to allocate garbage on every sample. `imm_sub` consumes each broadcast the instant it arrives and is correct. `batch_sub` defers its checking to the end of the test instead -- nothing about that choice is wrong on its own.

Run this: `imm_sub` reports every transaction correctly. `batch_sub` reports the same, single, final transaction's `id`/`data` for every entry it collected -- as if all N broadcasts had carried identical data, even though the checker can already see from `imm_sub` that they didn't.

Fix the code below so `batch_sub` reports what each transaction's `id`/`data` actually were at the moment it arrived.

Try it yourself: `make run EX=deferred_subscriber_needs_clone` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/deferred_subscriber_needs_clone.sv).

{{% /details %}}

### Scoreboard Correlate By ID {#scoreboard-correlate-by-id}

{{< badge "write-from-scratch" >}} {{< badge "scoreboard" >}} {{< badge "analysis-port" >}}

**Write a scoreboard that correlates two independent transaction streams by id, not by arrival order.**

{{% details title="Full breakdown" closed="true" %}}

A reference model publishes the expected result of every transaction; a monitor publishes what actually came back from the DUT. The two streams don't arrive in the same order as each other -- the DUT itself reorders responses -- so a scoreboard that just compares the Nth expected item against the Nth actual item will misreport perfectly correct traffic as one long string of mismatches.

Every transaction (`xaction`) carries an `id` -- the correlation key both sides agree on -- and a `data` payload -- the value actually being checked. Write `sb`'s callbacks, and whatever internal state you need, so that:

1. `write_expected(t)` and `write_actual(t)` can each arrive in any order, interleaved arbitrarily with each other and with other ids -- a transaction on one side has to wait, correctly, for its matching id to show up on the other side, however long that takes and regardless of what else arrives in between.
2. Once both sides have reported the same `id`: if `data` matches on both sides, increment `match_count`. If `data` differs, increment `mismatch_count` instead -- that's still a completed, resolved comparison, not a leftover.
3. The same `id` can legitimately show up more than once over the life of the test -- once a given occurrence is resolved (matched or mismatched), it's consumed. A later, independent occurrence of that same `id` starts a fresh correlation; it is never compared against whatever it was already resolved with, and never silently overwrites an *unresolved* earlier occurrence of the same `id` either -- if `id`=7 arrives twice on one side before its first occurrence has been resolved, both occurrences are still owed a match.
4. `pending_count()` returns exactly how many transactions are still waiting, on either side, for their other half to show up, at whatever point it's called.

Try it yourself: `make run EX=scoreboard_correlate_by_id` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/scoreboard_correlate_by_id.sv).

{{% /details %}}

### Coordinated Channel Write {#coordinated-channel-write}

{{< badge "write-from-scratch" >}} {{< badge "virtual-sequencer" >}} {{< badge "fork-join" >}}

**Write `coord_vseq::body()` so channel B's item carries the exact value channel A's driver actually processed -- not a value you compute or guess ahead of time.**

{{% details title="Full breakdown" closed="true" %}}

coord_vseqr is already wired (see env below) to three things: `chan_a_sqr` and `chan_b_sqr`, the two real channel sequencers to send items on, and `chan_a_drv`, channel A's driver -- the only place that ever learns what tag channel A's item actually carried, once it's actually been driven.

Write `coord_vseq::body()` so that:

1. It sends exactly one item on `p_sequencer.chan_a_sqr`, with `tag` set to any value of your choosing (e.g. `$urandom`).
2. Concurrently -- via `fork`/`join`, not one item after the other -- it sends exactly one item on `p_sequencer.chan_b_sqr`, with `tag` set to the exact value `p_sequencer.chan_a_drv` recorded for channel A's item.

`p_sequencer.chan_a_drv.last_tag` only becomes correct once channel A's driver has actually pulled the item and processed it -- not the instant you call `start_item` on channel A, and not just because your channel A branch happens to be the first one written in the `fork`. Reading it too early doesn't error -- it silently reads whatever channel A's driver last recorded, which at the very start of the test is nothing at all.

Try it yourself: `make run EX=coordinated_channel_write` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/coordinated_channel_write.sv).

{{% /details %}}

### Scoreboard Reuses DUT Checksum {#scoreboard-reuses-dut-checksum}

{{< badge "scoreboard" >}} {{< badge "plausible-pass" >}}

**The scoreboard's predictor calls the same CRC-8 function the "DUT" does -- of course they agree.**

{{% details title="Full breakdown" closed="true" %}}

```
SPEC: CRC-8/SMBUS over the packet payload.
  - polynomial x^8 + x^2 + x + 1 (0x07)
  - MSB-first bit processing
  - initial value 0x00
  - no input or output reflection, no final XOR
  - public catalog check value, for verifying any from-scratch implementation before trusting
    it against anything else: CRC-8/SMBUS(ASCII "123456789") = 0xF4
```

sb::predict() below is exactly the kind of predictor a model writes with total confidence when asked to check CRC-8 against the spec above: dut_pkg::crc8() (a separate file, compiled alongside this one -- open it if you want to, but you don't need to in order to find the bug) is already written, already named crc8, already the obvious thing to reach for instead of re-deriving polynomial division by hand. Run this: every single comparison matches.

A scoreboard whose predictor calls the DUT's own function has no way to disagree with it, no matter what that function actually computes. Reading predict() in isolation won't tell you anything is wrong -- it calls a function named crc8 and returns what it returns. The only way to know whether that's actually CRC-8/SMBUS is to implement the spec above independently and check.

Fix sb::predict() so it's an actual independent implementation of CRC-8/SMBUS, as specified above -- not a call to dut_pkg::crc8(). Verify your implementation against the 0xF4 check value before assuming it's right.

Try it yourself: `make run EX=scoreboard_reuses_dut_checksum` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/uvm/scoreboard_reuses_dut_checksum.sv).

{{% /details %}}
