---
title: "SystemVerilog Practice Problems"
weight: 2
date: 2026-10-29
publishDate: 2026-10-29
draft: false
description: "Twelve interview-prep SystemVerilog exercises: constrained-random gotchas, multi-dimensional uniqueness, lifecycle hooks, and the kind of mistake that compiles clean and passes a casual read."
next: /projects/brokenbench/uvm
---

Core SystemVerilog and constrained-random gotchas. Every one of these is either a documented real-world mistake or something found by actually testing this repo's own exercises against Verilator -- a tool limitation tag means the exercise needed a workaround, or a patched build, to get a real pass out of the checker at all.

### Nonoverlapping Address Ranges {#nonoverlapping-address-ranges}

{{< badge "write-from-scratch" >}} {{< badge "multi-constraint" >}} {{< badge "array" >}}

**Sorted isn't the same as non-overlapping -- unless you check the right pair.**

{{% details title="Full breakdown" closed="true" %}}

A classic memory-allocator constraint: hand out N address ranges that don't overlap. Ordering just the *starts* (`regions[0].base < regions[1].base < ...`) looks like it accomplishes that -- nothing about the constraint is obviously wrong -- but it says nothing about where each range actually *ends*. A large enough region reaches straight into the next one, sorted starting addresses and all.

The fix isn't to compare every region against every other region -- once the array is genuinely kept in ascending order by base_addr, checking each region only against its immediate predecessor is enough: if region i doesn't reach into region i+1, and region i+1 doesn't reach into region i+2, nothing earlier can reach past i+1 either, because everything is already sorted. That's the whole reason to maintain the ordering in the first place -- it turns an all-pairs check into an adjacent-pairs check.

One more thing worth being deliberate about: `regions[i-1]` only makes sense once `i > 0`. `i` in a foreach loop is unsigned, so guard that access with a real if/else, not a bare `if` with nothing to fall through to at i==0 -- a stray reference to index -1 on an unsigned type wraps to the largest possible value instead of going negative, the same silent-wraparound trap iommu_scattered_page_table's physical-bounds check calls out for address arithmetic.

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the constraints so:

1. regions.size() is randomized to somewhere between 4 and 8, inclusive.
2. regions[] stays in strictly ascending order by base_addr.
3. every region's base_addr is strictly less than its own limit_addr.
4. every base_addr and limit_addr stays within [32'h0000_0000 : 32'h7FFF_FFFF].
5. every region's size (limit_addr - base_addr + 1 -- limit_addr is the region's last byte, inclusive) is an exact multiple of 4KB (32'h1000).
6. every region's base_addr is itself 4KB-aligned (a multiple of 32'h1000), not just its size.
7. no two regions overlap -- given requirement 2 already holds, this only needs checking each region's base_addr against the *previous* region's limit_addr.

Try it yourself: `make run EX=nonoverlapping_address_ranges` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/nonoverlapping_address_ranges.sv).

{{% /details %}}

### N Bit Hamming Delta {#n-bit-hamming-delta}

{{< badge "write-from-scratch" >}} {{< badge "multi-constraint" >}} {{< badge "cross-call-state" >}} {{< badge "array" >}}

**Counting flipped bits with sum() with(), not $countones().**

{{% details title="Full breakdown" closed="true" %}}

$countones() would make this trivial -- but the point here is the array-reduction technique itself, not the answer. `sum() with (...)` needs an actual array to reduce, and a 32-bit vector isn't one: `current_data ^ previous_data` is still a single packed value, and there's no direct way to hand a packed expression straight to `.sum()` (the streaming operator `{<<{...}}` can't be chained into a method call, and comparing an unpacked array against a streaming expression with `==` fails to compile -- both real, worth hitting once so you know what doesn't work, not just what does). What DOES work: declare a plain array of individual bits, tie each element to the matching XOR bit with an ordinary `foreach` constraint (not a procedural loop -- constraints don't have those), and reduce that array. `sum() with (int'(item))` on a plain (non-struct) array of `rand bit` elements works cleanly; casting each 1-bit element to `int` before summing avoids the count silently wrapping once more than one bit is set.

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the constraints and lifecycle hook so:

1. toggle_target is randomized to somewhere between 1 and 32, inclusive.
2. changed_bits[k] equals current_data[k] ^ previous_data[k] for every k -- tie each element of the helper array to the matching bit of the XOR, via foreach.
3. changed_bits.sum() with (int'(item)) equals toggle_target -- the actual Hamming-distance constraint, expressed as an array reduction over changed_bits.
4. post_randomize() updates previous_data to current_data, so the next randomize() call (on this object, or on a brand new one -- previous_data is static) measures its distance from what was just generated, not from whatever came before that.

Try it yourself: `make run EX=n_bit_hamming_delta` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/n_bit_hamming_delta.sv).

{{% /details %}}

### Thermal Power Fuzzer {#thermal-power-fuzzer}

{{< badge "write-from-scratch" >}} {{< badge "multi-constraint" >}} {{< badge "array" >}} {{< badge "tool-limitation" >}}

**Uniqueness scoped to the wrong dimension.**

{{% details title="Full breakdown" closed="true" %}}

A `foreach (grid[i])` loop iterating rows and constraining each row's three cells to be mutually different does exactly what it says -- every row genuinely has no repeated values in it. Nothing about that constraint says anything about column 0 of row 0 versus column 0 of row 1, though. Adding a matching column-scoped check closes that gap too, but even ROW-unique AND COLUMN-unique together still isn't the same as GRID-unique: two cells that share neither a row nor a column -- the two ends of a diagonal, for instance -- never get compared by either check, and can still collide. The only way to be sure no two cells anywhere in the grid share a value is to check every pair against every other pair directly, not to assemble the guarantee out of row-shaped and column-shaped pieces that each stop short of the real requirement.

(`unique{}` isn't used here on purpose: on the current toolchain, using unique{} on a row-slice of a 2D array crashes the compiler outright -- a real, current tool limitation, not a design choice. Pairwise != is the working alternative here.)

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the constraints so:

1. every core_power[i][j] is between 1 and 9, inclusive.
2. every one of the 9 values is different from every other one -- genuinely unique across the whole grid, not just within its own row or column. Check every pair directly.
3. every row sums to exactly 15.
4. every column sums to exactly 15.
5. both main diagonals (top-left to bottom-right, and top-right to bottom-left) sum to exactly 15.

No array-reduction methods (sum() with (...), find() with (...)) anywhere in this one -- direct algebraic expressions and index-based foreach only.

Try it yourself: `make run EX=thermal_power_fuzzer` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/thermal_power_fuzzer.sv).

{{% /details %}}

### L2 Frame Fuzzer {#l2-frame-fuzzer}

{{< badge "write-from-scratch" >}} {{< badge "multi-constraint" >}} {{< badge "lifecycle-hook" >}} {{< badge "array" >}}

**Three lifecycle pieces, one class.**

{{% details title="Full breakdown" closed="true" %}}

A NIC frame has an 8-bit header, a variable-length payload, and an 8-bit CRC. None of that is solver work by itself -- the interesting part is where each piece has to live:

```
  - `header`'s low 4 bits come from a global mode flag (`jumbo_mode_en`), decided BEFORE the
    solver runs. That's pre_randomize()'s job, not a constraint -- header isn't even `rand`.
  - the payload's size DEPENDS on what pre_randomize() just decided, via `->`. Get the direction
    wrong and one branch silently swallows the other: writing only "jumbo -> big payload" and
    leaving the non-jumbo case as whatever the base size constraint allows still lets a non-jumbo
    frame roll a payload over 1500 bytes, since nothing rules it out. Both directions need their
    own `->`.
  - `crc` isn't solver output either -- it's arithmetic over values the solver already picked,
    computed AFTER the fact in post_randomize(), with an optional fault-injection twist.
```

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the class so:

1. pre_randomize() sets header[3:0] to 4'b1111 if jumbo_mode_en is set, 4'b0000 otherwise. header is not rand -- this has to happen procedurally, before the solve.
2. when header[3:0] == 4'b1111, payload.size() must be in [1501:2048]. when header[3:0] == 4'b0000, payload.size() must be in [46:1500]. Both directions need to be constrained explicitly -- don't let one fall through to whatever the base size constraint alone allows.
3. post_randomize() computes crc as an 8-bit sum of header and every payload byte (let it wrap naturally on overflow), then inverts it if crc_corrupt came out set.

Try it yourself: `make run EX=l2_frame_fuzzer` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/l2_frame_fuzzer.sv).

{{% /details %}}

### Tagged Frame Sequence {#tagged-frame-sequence}

{{< badge "write-from-scratch" >}} {{< badge "cross-call-state" >}} {{< badge "lifecycle-hook" >}} {{< badge "multi-constraint" >}}

**One distinguished header, three different kinds of persistent state.**

{{% details title="Full breakdown" closed="true" %}}

A frame stream where every frame has a header, an id, a payload, and a size. Most of that is unconstrained. The interesting part only kicks in for frames whose header equals the distinguished value XYZ:

```
  - consecutive XYZ frames carry a strictly increasing payload -- the first one 100, the next
    101, the next 102, and so on. That's state that has to survive across freshly-constructed
    objects (a real sequence doesn't reuse one transaction and re-randomize() it), which is why
    next_xyz_payload and frames_since_last_xyz below are already `static`, not something you
    need to invent.
  - XYZ frames can't come too close together -- at least 5 non-XYZ frames between any two of
    them -- and they can't be too far apart either: any run of 10 consecutive frames has to
    contain at least one. Both of those are properties of WHEN a frame is allowed to be XYZ, not
    properties of the frame's own fields, so they have to be enforced by constraining `header`
    itself against frames_since_last_xyz, not checked after the fact.
  - id has nothing to do with any of that -- it's a completely separate requirement that every
    frame's id, XYZ or not, has to differ from every id used by any earlier frame in the stream.
    `randc` looks tempting here, but the moment you're excluding more values than "the literal
    previous one" its cycling guarantee stops being reliable on this toolchain (see this repo's
    README, "Real, current tool limitations") -- a plain `rand` field plus a used-value queue
    checked with `inside {}` is the pattern that actually holds up.
```

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the class so, across many randomize() calls on freshly-constructed objects:

1. every frame's id differs from every id used by any earlier frame.
2. header may only equal XYZ (8'hAB) if at least 5 frames have passed since the last XYZ frame (or none has happened yet), and header MUST equal XYZ once 9 frames have passed since the last one, so no run of 10 consecutive frames is ever XYZ-free.
3. whenever header == XYZ, payload equals 100 for the first such frame, 101 for the second, 102 for the third, and so on, counting only XYZ frames.

Try it yourself: `make run EX=tagged_frame_sequence` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/tagged_frame_sequence.sv).

{{% /details %}}

### RISC-V Hazard Which Register {#risc-v-hazard-which-register}

{{< badge "write-from-scratch" >}} {{< badge "statistical" >}} {{< badge "cross-call-state" >}} {{< badge "multi-constraint" >}}

**When a hazard happens, decide which register(s) it hits.**

{{% details title="Full breakdown" closed="true" %}}

A pipeline hazard test needs instructions that deliberately depend on each other's registers, not just random independent ones. A read-after-write hazard is exactly that: an instruction reads a register that the instruction immediately before it is about to write. gen_hazard decides whether this instruction hazards against the one before it at all, at whatever rate you choose. That part's the easy half -- GIVEN gen_hazard is 1, the hazard still has to land somewhere: on src_reg_0 alone, src_reg_1 alone, or both, and real pipelines don't split that three ways evenly.

A real sequence doesn't reuse one transaction object and re-randomize() it -- it constructs a fresh instr_item for every instruction. Whatever holds "what did the previous instruction write" has to survive that: an ordinary (non-static) member resets to its default on every new(), so it forgets the previous instruction the moment a new object exists. It needs to be shared across every instance instead.

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the constraints so that, among instructions where gen_hazard is 1 (and there was a previous instruction), roughly 20% hazard on src_reg_0 only, 50% on src_reg_1 only, and 30% on both -- and never on neither. Registers that aren't hazarding shouldn't coincidentally match the previous instruction's dst_reg either.

Try it yourself: `make run EX=risc_v_hazard_which_register` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/risc_v_hazard_which_register.sv).

{{% /details %}}

### RISC-V Forwarding Window {#risc-v-forwarding-window}

{{< badge "write-from-scratch" >}} {{< badge "statistical" >}} {{< badge "cross-call-state" >}} {{< badge "multi-constraint" >}} {{< badge "tool-limitation" >}}

**Three forwarding paths deep, not one.**

{{% details title="Full breakdown" closed="true" %}}

risc_v_hazard_which_register only ever looked one instruction back -- a single EX-stage forward. A real pipeline has more forwarding paths than that: an instruction can also be fed from MEM (2 cycles back) or WB (3 cycles back). This exercise generates a hazard against any one of those three slots, weighted the way real pipelines actually see them: EX 40%, MEM 40%, WB 20%.

Same requirement as before carries over: a real sequence constructs a fresh instr_item per instruction, so whatever remembers recent dst_regs needs to be shared across instances, not reset by every new(). This time it's not one register, it's a 3-deep sliding window -- keep it as a static array and shift it in post_randomize() every call: what was 1-cycle-ago becomes 2-cycles-ago, what was 2-cycles-ago becomes 3-cycles-ago, and the newest dst_reg becomes 1-cycle-ago.

Two things make the spec itself, not just the mechanics, worth getting exactly right:

```
  - register x0 is hardwired to zero in RISC-V. A "hazard" against a history slot that holds x0
    isn't a real hazard -- nothing legally forwards from it. That has to rule x0-holding slots
    out of the target selection dynamically, not just skip checking them afterward.
  - "no coincidental match to a slot you didn't target" needs a precise definition. If two
    different history slots happen to hold the identical nonzero value (nothing stops that --
    dst_reg is unconstrained), matching your targeted slot unavoidably also numerically matches
    the other one. That isn't a coincidental leak, it's the same register value appearing twice
    in the window -- don't treat it as a violation of isolation.
```

One tool-specific thing to know before you reach for the obvious approach: putting a `dist{}` clause directly on an enum-typed rand variable does not reproduce its declared weights reliably on this toolchain (confirmed in this repo's own README -- see the "Real, current tool limitations" section). Drive the weighted pick through a plain-width rand field instead, and map it onto the enum afterward with an ordinary equality constraint.

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the class so:

1. history is a static, 3-deep sliding window: history[0] is 1-cycle-ago (EX), history[1] is 2-cycles-ago (MEM), history[2] is 3-cycles-ago (WB). post_randomize() shifts it every call and inserts the just-generated dst_reg at history[0].
2. Given gen_hazard is 1, the targeted slot is EX 40% of the time, MEM 40%, WB 20% -- except a slot currently holding x0 (5'd0) can never be targeted; its share of the weight goes away rather than being redistributed.
3. When a slot is targeted, at least one of src_reg_0/src_reg_1 equals that slot's value, and neither source register coincidentally matches a DIFFERENT-valued slot elsewhere in the window (a slot that happens to share the targeted slot's own value doesn't count).
4. When gen_hazard is 0, neither source register matches any nonzero slot in the window.

Try it yourself: `make run EX=risc_v_forwarding_window` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/risc_v_forwarding_window.sv).

{{% /details %}}

### Command Stream Bandwidth Cap {#command-stream-bandwidth-cap}

{{< badge "write-from-scratch" >}} {{< badge "tool-limitation" >}} {{< badge "multi-constraint" >}} {{< badge "array" >}} {{< badge "statistical" >}}

**Aggregate constraints on an array of structs: what with() can and can't do here.**

{{% details title="Full breakdown" closed="true" %}}

Array reduction/locator methods (`sum()`, `find()`, ... `with (...)`) are the normal SystemVerilog tool for aggregate constraints -- "exactly N elements satisfy X," "the total of some field stays under a cap." On the current toolchain, none of that machinery works reliably once the array holds a STRUCT instead of a plain scalar type -- confirmed directly, not assumed:

```
  - `array.find() with (...)` inside a constraint block compiles, but is silently dropped --
    `%Warning-CONSTRAINTIGN: Unsupported: randomizing this expression, treating as state`. It
    reports randomize() success while enforcing nothing. This is true for locator methods on
    any array, struct-typed or not.
  - `struct_array.sum() with (...)` -- for ANY struct-typed array, regardless of what the with
    expression computes -- generates a malformed query the solver itself rejects
    (`Sorts (...) are incompatible`), and randomize() reports failure (returns 0) instead of
    succeeding. Confirmed down to the simplest possible case: a one-field struct, summed with
    no cast, no filter, no transformation at all. This is specific to the array holding a
    struct -- the identical reduction on a plain (non-struct) array of the same element type
    works correctly.
  - Comparing an enum-typed field against an enum value (`item.cmd_type == WRITE`) inside ANY
    with (...) clause crashes the compiler outright, independent of the struct issue above --
    reproduces on a bare enum array too, not just a struct field.
```

So for this class, every aggregate requirement below needs a different tool. The alternative that actually works: express a running total as its own `rand int` array, one element per cmd_list entry, related to its neighbor by an ordinary per-element constraint inside `foreach` (`running[i] == running[i-1] + (...)`) -- a "prefix sum," built entirely from plain equality constraints the solver already handles correctly, with no with (...) clause anywhere. The last element of that running array is the total you actually want to bound.

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the constraints so:

1. cmd_list.size() is randomized to somewhere between 15 and 20 elements, inclusive. Keep hi_count and dma_running the same length as cmd_list -- they're prefix-sum helper arrays, one running total per position, per the note above.
2. Every element's cmd_type is READ, WRITE, or FLUSH -- never INVALID.
3. Exactly 3 elements have prio == PRIO_HIGH, via hi_count's prefix-sum recurrence: hi_count[0] is 1 or 0 depending on cmd_list[0].prio, and each later hi_count[i] is hi_count[i-1] plus 1 or 0 depending on cmd_list[i].prio. The last element of hi_count must equal 3.
4. Among elements with prio == PRIO_LOW, cmd_type should favor READ and WRITE over FLUSH, roughly 3:3:1.
5. dma_running is the same prefix-sum idea, but summing dma_size for WRITE elements only (0 contribution from non-WRITE elements). The last element of dma_running -- the total WRITE bandwidth across the whole stream -- must not exceed 4096. Watch the width: dma_size is only 8 bits, so accumulating into it directly overflows well before 4096; dma_running is declared as a plain int specifically so the running total doesn't wrap.

Try it yourself: `make run EX=command_stream_bandwidth_cap` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/command_stream_bandwidth_cap.sv).

{{% /details %}}

### IOMMU Scattered Page Table {#iommu-scattered-page-table}

{{< badge "write-from-scratch" >}} {{< badge "multi-constraint" >}} {{< badge "array" >}}

**No sorting allowed: check every pair, not just neighbors.**

{{% details title="Full breakdown" closed="true" %}}

The trick that makes nonoverlapping_address_ranges cheap -- keep the array sorted, then only check each element against its immediate predecessor -- depends entirely on the array actually being sorted. Take that away and the shortcut goes with it: with physical pages genuinely scattered in no particular order, page 3 could overlap page 9 just as easily as page 4, and there's no single neighbor whose check would have caught it. The only way to be sure none of them touch is to check every pair, not just adjacent ones -- an ordinary nested `foreach` (a loop inside a loop, both walking the same array) inside a `constraint` block, comparing each pair once.

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the constraints so:

1. page_table.size() is randomized to somewhere between 8 and 16, inclusive.
2. v_start_addr[0] is exactly 32'h1000_0000. For every later entry, v_start_addr[i] equals v_start_addr[i-1] + page_size[i-1] -- the virtual space is one unbroken continuum, no gaps and no overlaps, entry by entry.
3. Every page_size is one of exactly three values: 4KB (32'h1000), 64KB (32'h10000), or 2MB (32'h200000).
4. Do NOT add any constraint that orders p_start_addr by index -- physical pages must be free to land anywhere, in any order.
5. No two physical pages overlap. Since nothing keeps the array sorted, this means checking every pair (i, j) with i != j, not just neighbors.
6. No two physical pages are adjacent either -- page i's p_start_addr must never land exactly where page j ends (p_start_addr[j] + page_size[j]), for every pair i != j.
7. Every physical page fits inside [32'h0000_0000 : 32'hFFFF_FFFF]. Watch the upper bound: a naive `p_start_addr + page_size <= 32'hFFFF_FFFF` can silently wrap around 32 bits near the top of the range and let an out-of-bounds page through looking valid.

Try it yourself: `make run EX=iommu_scattered_page_table` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/iommu_scattered_page_table.sv).

{{% /details %}}

### DMA Ring Allocator {#dma-ring-allocator}

{{< badge "tool-limitation" >}} {{< badge "write-from-scratch" >}} {{< badge "requires-patched-verilator" >}} {{< badge "array" >}} {{< badge "multi-constraint" >}} {{< badge "statistical" >}}

**Three techniques, one class, all of them have to actually work together.**

{{% details title="Full breakdown" closed="true" %}}

REQUIRES A PATCHED VERILATOR -- see the note in README.md before you spend time on this one. `unique{}` on a foreach-indexed row of a 2D array crashes the compiler outright on every released Verilator as of this writing (an internal fault, not a graceful error) -- the same bug `thermal_power_fuzzer` avoids entirely by using pairwise inequality instead. This exercise is that same construct, at real scale, combined with everything else below:

```
  make run EX=dma_ring_allocator VERILATOR=/path/to/patched/verilator_bin
```

A DMA scheduler's allocation grid: 4 channels, each with 4 ring-buffer slots, each slot holding an 8-bit physical-block pointer. Nothing here is individually exotic -- row/column uniqueness, a weighted mode pick, a conditional bound, a conditional sum -- but getting all three to hold at once, in the same randomize() call, is where it actually gets hard.

```
  - every channel (row) must route to entirely distinct blocks, AND every slot-index across
    channels (column) must too. A row has a natural answer -- `grid[i]` is already a valid
    array-typed slice, so `unique {grid[i]}` names the whole row in one shot. A column doesn't:
    there's no `grid[:][j]` slicing syntax in SystemVerilog, so unique{}'s range_list has to be
    given the column's elements explicitly, one by one, inside something that iterates the
    column index. IEEE 1800-2023 18.5.4 is the section to read if you want to know why a whole
    row and a single cell inside a foreach over that row aren't equivalent.
  - qos_mode has to land on BURST_MODE 70% of the time and SPARSE_MODE 30%, and which
    bound/sum requirement applies depends on which mode was picked -- `solve ... before` has to
    sequence qos_mode ahead of dma_grid, or nothing downstream is guaranteed to see a settled
    value to condition on.
  - the BURST_MODE sum is over channel 1's whole row UNION slot 3's whole column -- not the sum
    of both taken separately. Row 1 and column 3 share exactly one cell (dma_grid[1][3]); count
    it once. Summing all 4 row cells plus all 4 column cells adds that shared cell twice, which
    quietly makes the >1000 requirement easier to satisfy than it's supposed to be -- exactly
    the kind of bug that still passes a handful of manual spot checks.
```

Fix the class below so the check after it passes. Don't edit anything at or below the "checker" marker.

Write the class so, on every randomize() call:

1. every dma_grid[ch][slot] is inside [1:255].
2. within any one channel (row), all 4 slot values are distinct. Within any one slot-index (column), all 4 channel values are distinct. Use unique{} for both, not pairwise inequality.
3. qos_mode resolves to BURST_MODE 70% of the time, SPARSE_MODE 30% of the time.
4. if qos_mode == SPARSE_MODE, every cell in the grid is inside [1:20].
5. if qos_mode == BURST_MODE, the sum of the 7 distinct cells in channel 1's row union slot 3's column (not 8 -- the shared cell counts once) is strictly greater than 1000.

Try it yourself: `make run EX=dma_ring_allocator` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/dma_ring_allocator.sv).

{{% /details %}}

### Unchecked Randomize Hides Unsat Conflict {#unchecked-randomize-hides-unsat-conflict}

{{< badge "best-practice" >}} {{< badge "multi-constraint" >}} {{< badge "plausible-pass" >}}

**Desc_item.randomize() fails every single call -- and nothing that matters ever checks.**

{{% details title="Full breakdown" closed="true" %}}

```
SPEC, for a DMA descriptor (addr, len):
  - addr (descriptor start) must land in the start window [0x1000:0x1FFF].
  - len (transfer length) must be at least 4097 bytes -- the current minimum burst granularity.
  - The underlying buffer this window addresses is 8 KB (0x2000 bytes) total, based at 0x1000 --
    a descriptor may never read past the end of that buffer.
```

desc_item below is exactly the kind of class a model writes with total confidence when asked to implement the spec above: one constraint per bullet, each individually unremarkable. Read any single constraint in isolation and nothing looks wrong -- the three only contradict each other once you work out what they jointly allow.

The loop below is the kind of driving loop that shows up in a thousand sequences -- create an item, randomize it, use it. It compiles. It runs. Run it: every single descriptor comes back with addr == 0 and len == 0, and the return value randomize() hands back -- the one piece of information that would have said so directly -- is never looked at. Verilator itself prints an UNSATCONSTR warning on every failed call; that's realistic, not a tell -- a plain $warning never fails a regression, and a log with warnings scrolling by looks identical to a clean one unless someone is actually grepping for them.

Fix whatever's actually broken against the spec above -- not a leftover default. Don't edit anything at or below the "checker" marker; it's correct as given and is what's judging you.

Try it yourself: `make run EX=unchecked_randomize_hides_unsat_conflict` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/unchecked_randomize_hides_unsat_conflict.sv).

{{% /details %}}

### Off By One Credit Deadlocks a Full Depth Burst {#off-by-one-credit-deadlocks-a-full-depth-burst}

{{< badge "best-practice" >}} {{< badge "plausible-pass" >}}

**The link never deadlocks under everyday traffic -- only a full-depth burst finds it.**

{{% details title="Full breakdown" closed="true" %}}

SPEC: at reset, credits must equal DEPTH (16) -- the receive buffer's actual physical capacity, since nothing is in flight yet. A full-depth burst is one indivisible 16-flit transfer: the receiver returns no credit for any of it until all 16 flits have landed, then returns all 16 at once. (Everyday, non-burst traffic acks per flit and never approaches this limit -- it isn't modeled here because it isn't where the bug lives.)

link_model below is exactly the kind of class a model writes with total confidence when asked to implement the spec above: `credits = DEPTH - 1` reads like the array-index idiom that's correct everywhere else in a file like this one (`buf[DEPTH-1]` is the last valid index) -- it just isn't an index here, it's a count, and a count has to equal the thing it's counting. Run this: the burst never completes.

Fix link_model so a full-depth burst actually completes. Don't edit anything at or below the "checker" marker; it's correct as given and is what's judging you.

Try it yourself: `make run EX=off_by_one_credit_deadlocks_a_full_depth_burst` after cloning
[brokenBench](https://github.com/adibis/brokenBench), or read the
[full source on GitHub](https://github.com/adibis/brokenBench/blob/master/exercises/sv/off_by_one_credit_deadlocks_a_full_depth_burst.sv).

{{% /details %}}
