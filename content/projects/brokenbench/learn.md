---
title: "Learn SystemVerilog Constraints from Scratch"
weight: 2
date: 2026-10-29
publishDate: 2026-10-29
draft: false
description: "Fourteen exercises for engineers who haven't written SystemVerilog constraints before: dist weights, inside, foreach, implies, inheritance, and the UVM lifecycle calls that are easy to get wrong the first time."
next: /projects/brokenbench/sv
---

Never touched SystemVerilog constraints before? Start here. Most of these hand you a spec and a stub to write against it -- constraints, `foreach`/`implies`/`inside`, `dist` weights, array reduction -- one concept per exercise, or a short deliberate chain of them. A handful hand you real code with one call missing or misused instead: a `config_db` that's never `set()`, a sequence that's created but never `start()`ed, an objection dropped without a matching raise. Every exercise's checker is correct as given; fix only what the write-up asks for, and leave anything below the checker marker alone.

### SV Mechanics Chain {#sv-mechanics-chain}

{{< badge "write-from-scratch" >}}

**Write a class, a compound constraint, and a factory function from scratch.**

{{% details title="The spec and the fix" closed="false" %}}

A class handle that's declared but never assigned with `new()` is null -- calling a method or randomizing through it fails at runtime, not at compile time. A factory function that's supposed to hand back a ready-to-use object has exactly one job it can't skip: actually constructing the object before returning it.

Fix the class and function below so the check after it passes.

Write the constraint and the factory function from scratch:

1. addr's low 2 bits must always be 0 (addr[1:0] == 2'b00).
2. size must stay between 1 and 8, inclusive.
3. make_item() must return a valid (non-null) handle.

Try it yourself: `make run EX=sv_mechanics_chain` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/sv_mechanics_chain.sv).

{{% /details %}}

### SV Constraint Chain {#sv-constraint-chain}

{{< badge "write-from-scratch" >}}

**Write three constraints from scratch, each with its own name.**

{{% details title="Full breakdown" closed="true" %}}

Every constraint block in a class needs its own name, the same as any other class member -- two blocks sharing a name isn't two constraints being combined, it's a redefinition error. Beyond that, this is just ordinary constraint-writing: a range needs `inside`, and a field pinned to one exact value needs `==`, not `=` (which isn't a valid constraint operator at all).

Fix the class below so the check after it passes.

Write three constraints from scratch, each in its own uniquely-named constraint block:

1. priority_lo must stay in [0:3].
2. priority_hi must stay in [4:7].
3. mode must always equal 2'b01.

Try it yourself: `make run EX=sv_constraint_chain` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/sv_constraint_chain.sv).

{{% /details %}}

### Inside Operator Variants {#inside-operator-variants}

{{< badge "write-from-scratch" >}}

**Write three `inside` constraints from scratch, three different set shapes.**

{{% details title="Full breakdown" closed="true" %}}

`inside` takes a set on its right-hand side, and that set can be built three different ways:

```
  a plain list of values      -- x inside {1, 2, 3}
  a range mixed with values   -- x inside {[10:20], 255}
  a range with variable ends  -- x inside {[lo:hi]}          (lo/hi don't have to be literals)
```

Same operator every time, always wrapped in braces, entries separated by commas, a range written as [low:high] with low on the left.

Fix the class below so the check after it passes.

Write the constraints so mode, address, and val each land in their intended set on every randomize() call.

1. `mode` must be one of exactly 0, 2, 4, or 8 -- nothing else.
2. `address` must be either between 10 and 20 (inclusive), or exactly 255 -- nothing else.
3. `val` must fall between `low_bound` and `high_bound` (inclusive) -- using the two variables below, not the literal numbers they currently hold.

Try it yourself: `make run EX=inside_operator_variants` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/inside_operator_variants.sv).

{{% /details %}}

### Dist Coin and Die {#dist-coin-and-die}

{{< badge "write-from-scratch" >}} {{< badge "statistical" >}}

**Write two `dist` clauses from scratch: a fair coin, and a loaded die.**

{{% details title="Full breakdown" closed="true" %}}

`dist` takes two different weight operators, and they mean different things once one side of an entry is a range instead of a single value:

```
  value := weight        -- that value gets exactly this weight, full stop.
  [lo:hi] := weight       -- every value in the range gets this weight EACH (so a wider range
                             gets proportionally more of the total).
  [lo:hi] :/ weight       -- the range gets this weight TOTAL, divided evenly across every
                             value in it (so a wider range does NOT get more weight overall --
                             each individual value inside it gets less).
```

Fix the class below so the check after it passes.

Write two constraints from scratch:

1. `coin` is a fair coin flip -- 0 and 1 need to come up about equally often. Two single values, each with the same weight, is exactly what `:=` is for.
2. `roll` is a loaded six-sided die, values 1 through 6. It should land on 6 about half the time. The OTHER half of the time, it should be anything from 1 to 5, with all five of those values getting an even share of that other half -- not each individually getting the same weight as 6 itself. That's the difference between `:=` and `:/ ` on a range: get this one backwards and 1-5 either vanish entirely or swamp 6's intended 50%.

Try it yourself: `make run EX=dist_coin_and_die` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/dist_coin_and_die.sv).

{{% /details %}}

### Implies Basics {#implies-basics}

{{< badge "write-from-scratch" >}}

**Write two implication constraints from scratch.**

{{% details title="Full breakdown" closed="true" %}}

`a -> b` means "whenever a holds, b must also hold" -- it says nothing at all about what happens when a doesn't hold, and it isn't symmetric: `a -> b` and `b -> a` are two different constraints. Getting the two sides backwards from what you meant still compiles and still looks reasonable at a glance; it just enforces the opposite relationship.

Fix the class below so the check after it passes.

Write two implication constraints from scratch:

1. alarm_active can only ever be true when temp_reading is over 100 -- never at a safe reading, but it doesn't have to be true just because the reading is high either.
2. whenever maint_mode is true, alarm_active must be false.

Try it yourself: `make run EX=implies_basics` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/implies_basics.sv).

{{% /details %}}

### Foreach with Basics {#foreach-with-basics}

{{< badge "write-from-scratch" >}}

**Write a `foreach` constraint, and an inline `randomize() with{}` constraint.**

{{% details title="Full breakdown" closed="true" %}}

`foreach (arr[i]) ...` introduces `i` as a loop variable scoped to that constraint, usable to index the same array on each pass. Separately, `randomize() with { ... }` adds a one-off constraint for a single call without touching the class itself -- useful for pinning a `rand` field to a specific value just for that call.

Fix the class and function below so the check after it passes.

Write the constraint and the inline randomize() call from scratch:

1. every element of lens must stay in [1:100].
2. tag_item() must randomize item so that tag ends up equal to the target argument.

Try it yourself: `make run EX=foreach_with_basics` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/foreach_with_basics.sv).

{{% /details %}}

### Missing Seed Reproducibility {#missing-seed-reproducibility}

{{< badge "write-from-scratch" >}} {{< badge "best-practice" >}}

**Write a function that makes `randomize()` reproducible.**

{{% details title="Full breakdown" closed="true" %}}

`handle.randomize()` and `handle.srandom(seed)` do two different jobs, and it's easy to mix them up:

```
  handle.randomize()   -- rolls new values into the object's `rand`/`randc` fields, using
                           whatever PRNG state the object currently has. You call this every
                           time you want a new random result.
  handle.srandom(seed) -- doesn't randomize anything itself. It resets the object's internal
                           PRNG to a state fully determined by `seed`. Call it once, and every
                           randomize() call on that object afterward follows a reproducible
                           sequence -- same seed in, same sequence of results out, every time.
```

They're two separate calls on the handle, not composable -- srandom(seed) is not an argument you pass into randomize(); randomize() only takes an optional list of field names to restrict which fields get re-rolled.

Fix the function below so the check after it passes.

Write make_seeded_item() from scratch:

1. it must return a valid (non-null) handle.
2. two calls with the same seed must make every later randomize() on that object follow the same sequence of results.
3. two calls with different seeds must diverge.

Try it yourself: `make run EX=missing_seed_reproducibility` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/missing_seed_reproducibility.sv).

{{% /details %}}

### Rand Mode Leftover {#rand-mode-leftover}

{{< badge "lifecycle-hook" >}}

**A `rand_mode(0)` left on from a debug helper.**

{{% details title="Full breakdown" closed="true" %}}

rand_mode() turns randomization for a specific field on or off without touching its declaration. It's genuinely useful -- pin a field to a known value while debugging everything around it -- which is exactly why it's dangerous to leave behind: the field is still declared `rand`, still compiles, still shows up in every dump, and every OTHER field in the class keeps randomizing normally. Nothing about the class itself looks broken.

Look at the constructor: there are two rand_mode() calls, one broader and one narrower. One disables randomization for the whole object, the other re-enables it for a single field. Which field ends up silently pinned to one value forever, and which one actually stays random?

Fix the class below so the check after it passes.

This class is over-constrained today. Fix it so seq_num actually varies across repeated randomize() calls, the same way channel already does.

Try it yourself: `make run EX=rand_mode_leftover` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/rand_mode_leftover.sv).

{{% /details %}}

### Inherited Constraints Stack {#inherited-constraints-stack}

{{< badge "write-from-scratch" >}} {{< badge "inheritance" >}} {{< badge "lifecycle-hook" >}}

**A subclass's new constraint doesn't replace the base class's.**

{{% details title="Full breakdown" closed="true" %}}

Constraint blocks aren't like virtual methods -- a differently-named constraint added in a subclass doesn't override anything in the base class, it just adds another block that has to hold at the same time as everything the base class already declared. Every constraint block across the whole inheritance chain is ANDed together. A subclass that wants a wider range than its base class can't get there by just adding a second, wider constraint -- the intersection of `[0:50]` and `[0:200]` is still `[0:50]`.

What actually works: `constraint_mode()`, the same idea as `rand_mode()` but for constraint blocks instead of fields. Called on a named constraint -- including one inherited from a base class -- `constraint_mode(0)` turns that specific block off without touching its declaration. Turn the base class's range constraint off in the subclass's own constructor, then a new constraint declared in the subclass is the only one left applying.

Fix the classes below so the check after them passes.

Write constraints so that wide_item's values reach above 50:

1. add a new constraint in wide_item allowing value up to 200.
2. in wide_item's constructor, disable base_item's c_range constraint via constraint_mode(0) so it stops intersecting with the new one.

Try it yourself: `make run EX=inherited_constraints_stack` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/inherited_constraints_stack.sv).

{{% /details %}}

### Rand Queue of Objects {#rand-queue-of-objects}

{{< badge "write-from-scratch" >}} {{< badge "lifecycle-hook" >}} {{< badge "array" >}}

**Write `post_randomize()` so a queue of objects isn't full of nulls.**

{{% details title="Full breakdown" closed="true" %}}

`rand Packet queue_of_pkts[$];` makes the QUEUE randomizable -- the solver can decide how many elements it has and what each element's handle value is. What it can't do is construct the objects those handles point to: `new()` isn't a random value, it's a statement, and the solver only ever picks values, never runs code. A `rand` array/queue of class handles ends up sized correctly but full of null handles unless something else builds the actual objects.

`post_randomize()` is the natural place to do that -- it runs right after randomize() finishes picking every random value, including the queue's own size, so by the time it runs you know exactly how many elements there are to build.

Fix the class below so the check after it passes.

Write post_randomize() so every element of queue_of_pkts ends up as a real, randomized object:

1. every element must be constructed (not null).
2. every element's own fields must actually be randomized, not left at their default values.

Try it yourself: `make run EX=rand_queue_of_objects` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/rand_queue_of_objects.sv).

{{% /details %}}

### Array Reduction With {#array-reduction-with}

{{< badge "write-from-scratch" >}} {{< badge "array" >}}

**Write two `with`-transformed array reduction constraints from scratch.**

{{% details title="Full breakdown" closed="true" %}}

Array reduction methods (`sum()`, `product()`, `and()`, `or()`, `xor()`) collapse a whole array down to one value. On their own they reduce the raw elements -- `arr.sum()` adds up whatever's actually in the array. Adding `with (expression)` changes what gets reduced: the expression is evaluated once per element (the implicit name `item` stands in for that element's value), and the reduction combines the RESULTS of the expression instead of the raw elements.

That makes `sum() with (...)` a way to count: `arr.sum() with (item == N ? 1 : 0)` turns every element into a 1 (if it matches) or 0 (if it doesn't), and summing those 1s and 0s gives you exactly how many elements equal N -- without touching what any individual element's value is.

Fix the class below so the check after it passes.

Write two constraints from scratch, each using sum() with (...) to count matching elements:

1. exactly 2 of the 8 elements in levels must equal 3.
2. exactly 3 of the 8 elements in levels must equal 0.

Try it yourself: `make run EX=array_reduction_with` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/array_reduction_with.sv).

{{% /details %}}

### UVM Config DB Never Set {#uvm-config-db-never-set}

{{< badge "config-db" >}}

**`uvm_config_db::get()` works fine -- nobody ever called `set()`.**

{{% details title="Full breakdown" closed="true" %}}

`uvm_config_db` is just a global, hierarchy-scoped lookup table: `set()` writes an entry keyed by (component path, field name), `get()` reads one back. The two calls aren't a matched pair the way a constructor and a destructor are -- `get()` doesn't require a `set()` to exist. If no entry matches, `get()` returns 0 and quietly leaves the variable it was given exactly as it was. No error, no warning, nothing -- the component just keeps running with whatever default it already had.

`worker` below reads its own `mode` via `uvm_config_db#(int)::get()` in its own `build_phase()`. That's correct, working code -- the bug isn't there.

Run this: `w.mode` stays -1, `worker`'s uninitialized default, instead of becoming 1.

Fix `test::build_phase()` so `w.mode` ends up 1. Don't touch `worker`.

Try it yourself: `make run EX=uvm_config_db_never_set` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/uvm_config_db_never_set.sv).

{{% /details %}}

### UVM Objection Never Raised {#uvm-objection-never-raised}

{{< badge "objections" >}}

**Dropping an objection that was never raised doesn't just do nothing -- it's a fatal.**

{{% details title="Full breakdown" closed="true" %}}

`raise_objection()`/`drop_objection()` aren't independent calls -- together they form a counter UVM uses to decide when a phase is allowed to end. Every `raise_objection()` has to be matched by exactly one `drop_objection()`. Drop one more time than you raised, and UVM doesn't quietly clamp the counter at zero -- it reports a real `UVM_FATAL` (`OBJTN_ZERO`), because an objection count going negative means something in the testbench's bookkeeping is already wrong, and continuing to run on top of that isn't safe.

`run_phase` below does its real work (`recorded = 42;`) correctly, then drops an objection it never raised.

Run this: `recorded` does become 42 -- that part isn't the problem -- but a `UVM_FATAL` fires right after it.

Fix `run_phase` so no `UVM_FATAL` occurs.

Try it yourself: `make run EX=uvm_objection_never_raised` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/uvm_objection_never_raised.sv).

{{% /details %}}

### UVM Sequence Never Started {#uvm-sequence-never-started}

{{< badge "sequence-start" >}}

**Creating a sequence isn't the same as running it.**

{{% details title="Full breakdown" closed="true" %}}

`my_seq::type_id::create()` allocates a sequence object -- it doesn't put a single item on the sequencer. `body()` (where the actual item gets built and sent) only ever runs once something calls `.start(sequencer)` on that object. A sequence that's created but never started just sits there: no compile error, no runtime error, no `body()`, no item, nothing.

`my_driver` below is correct, working code -- it pulls items off `sqr` and records the last one it saw. `my_seq::body()` is correct too -- it builds one item with `value = 42` and sends it.

Run this: `e.drv.received_count` stays 0 -- the driver never gets anything to record.

Fix `test::run_phase()` so the driver actually receives the item. Don't touch `my_seq` or `my_driver`.

Try it yourself: `make run EX=uvm_sequence_never_started` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/learn/uvm_sequence_never_started.sv).

{{% /details %}}
