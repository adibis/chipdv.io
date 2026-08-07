---
title: "Config Object Plumbing at SoC Scale"
weight: 3
date: 2026-07-30
publishDate: 2026-07-30
draft: false
description: "uvm_config_db works fine at block level and gets quietly fragile the moment a block is reused more than once in the same SoC."
prev: /reuse/register-triggered-reset-worked-example
---

`uvm_config_db` feels bulletproof the first time anyone uses it, because a block-level environment usually has one instance of everything, a flat hierarchy, and paths simple enough that a wildcard like `"*"` matches exactly what it was supposed to and nothing else. None of those three properties survive a block being reused at subsystem or SoC level, where the same environment gets instantiated more than once under different instance names, nested several levels deeper than it was at block level, and configured by a parent that doesn't necessarily know every field the block's internals care about. The failure mode that results is a specific kind of dangerous: `config_db::get()` doesn't error when it can't find a matching `set()`. It silently returns whatever default the caller supplied, and the test keeps running against a component that's quietly misconfigured.

## The path-fragility failure

A block-level test sets a field using a path that matches the block-level environment's own instance name:

```systemverilog
// works fine in the block-level test: "env" is this environment's actual name
uvm_config_db#(int)::set(this, "env.agent.driver", "delay_cycles", 4);
```

That block gets integrated into an SoC environment, instantiated as `periph_a`, alongside `periph_b` and `periph_c` using the same environment class. The exact path `"env.agent.driver"` no longer matches anything, because nothing in the SoC-level hierarchy is named `env`. No error. No warning. `driver.delay_cycles` silently falls back to whatever default the driver's own `get()` call supplied, and the test that depended on `delay_cycles` being 4 passes or fails for reasons that have nothing to do with what it was actually testing.

![A block-level config set() using an exact instance path, and the same path failing to match once the block is reused under a different instance name at SoC integration](/images/reuse/03-config-path-mismatch.svg)

The fix is to stop anchoring paths to a specific instance name at all. `uvm_config_db` supports relative wildcards for exactly this reason:

```systemverilog
// matches "driver" underneath any agent, underneath any environment,
// regardless of what the environment instance happens to be named
uvm_config_db#(int)::set(this, "*.agent.driver", "delay_cycles", 4);
```

This works, but it trades one fragility for a milder version of the same problem: a wildcard broad enough to survive instance renaming is also broad enough to accidentally match a driver in a completely unrelated part of the hierarchy that happens to share a path suffix. The more robust fix is structural, not stringly-typed at all: pass configuration through a handle to a config object, set once by whichever component is doing the instantiating, rather than through a field-by-field string path that has to be independently correct at every level of reuse.

## Config object design: nested beats monolithic

The next decision is whether a block's configuration is one large object holding every field the environment might ever need, or a small object per reusable unit, composed together. Monolithic feels simpler to write once, but it inverts who needs to know what: an SoC-level integrator configuring `periph_a` shouldn't need to know or care about `periph_a`'s driver's internal delay settings, only about the handful of fields that actually matter at integration, which bus it's on, what its base address is, whether it's active or passive.

```systemverilog
class periph_agent_cfg extends uvm_object;
  `uvm_object_utils(periph_agent_cfg)
  rand int delay_cycles;
  uvm_active_passive_enum is_active = UVM_ACTIVE;
endclass

class periph_env_cfg extends uvm_object;
  `uvm_object_utils(periph_env_cfg)
  periph_agent_cfg agent_cfg;
  int              base_addr;

  function new(string name = "periph_env_cfg");
    super.new(name);
    agent_cfg = periph_agent_cfg::type_id::create("agent_cfg");
  endfunction
endclass
```

The block's own environment builds a `periph_env_cfg` with sensible defaults during its own `build_phase`, so a block-level test that never touches configuration at all still gets a working environment. An SoC-level test overrides only what integration actually changes, `base_addr` and maybe `is_active`, by reaching into the object it was handed rather than re-deriving every field from scratch:

```systemverilog
function void soc_env::build_phase(uvm_phase phase);
  periph_env_cfg cfg = periph_env_cfg::type_id::create("cfg");
  cfg.base_addr = 'h4000_0000;
  cfg.agent_cfg.is_active = UVM_PASSIVE;  // SoC level only observes this agent
  uvm_config_db#(periph_env_cfg)::set(this, "periph_a", "cfg", cfg);
endfunction
```

One object, set once, retrieved once by the block's own `build_phase` with a single `get()` call. Nothing downstream needs a wildcard, and nothing about the block's internals is a string path an SoC-level integrator has to get exactly right.

## The sibling build_phase ordering trap

The other failure mode is subtler and shows up even with a clean, structural config object: `build_phase` is guaranteed to run parent-before-children, but UVM makes no guarantee about the order two sibling components' `build_phase` methods run in relative to each other. A config `set()` issued from one sibling's `build_phase`, intending to configure another sibling, is a race against tree traversal order that happens to work under one simulator's implementation and silently breaks under another, or breaks the moment component registration order in the parent changes for an unrelated reason.

```systemverilog
// fragile: relies on sibling_a's build_phase running before sibling_b's,
// which UVM does not guarantee -- and even if it did, "sibling_b" here
// only resolves if sibling_b sits under this component, which it doesn't
function void sibling_a::build_phase(uvm_phase phase);
  uvm_config_db#(int)::set(this, "sibling_b", "some_field", 1);
endfunction
```

The fix is a rule, not a workaround: configuration is only ever set by an ancestor, in that ancestor's own `build_phase`, before it constructs the children the configuration is for. Parent-before-children is the one ordering UVM actually promises. Sibling-to-sibling configuration should be re-modeled as parent-mediated instead, the parent reads or computes whatever `sibling_a` would have wanted to tell `sibling_b`, and sets it before either child's `build_phase` runs.

## Making a missing config loud instead of silent

The single change that catches most of this category of bug before it costs a debugging session: stop calling `get()` with a default value silently accepted, and check the boolean return instead.

```systemverilog
periph_env_cfg cfg;
if (!uvm_config_db#(periph_env_cfg)::get(this, "", "cfg", cfg))
  `uvm_fatal("CFG", "periph_env_cfg was not set by the instantiating parent")
```

A block-level environment that always sets its own default before children run never hits this fatal. An SoC-level integration that renamed an instance, or a sibling-ordering race that fired too late, hits it immediately, at the point of the actual mistake, with a message that says exactly what's missing, instead of surfacing forty minutes into a regression as a data mismatch that traces back to a driver silently running with the wrong delay.
