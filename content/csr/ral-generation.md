---
title: "RAL Generation in Practice"
weight: 3
date: 2026-07-23
publishDate: 2026-07-23
draft: false
description: "Nobody hand-writes register models anymore. Generating from a spec source of truth, and keeping custom hooks alive across regeneration."
prev: /csr/register-access-types
next: /csr/builtin-sequence-limits
---

Hand-writing a `uvm_reg_block` for anything past a handful of registers isn't a serious option on a real project and hasn't been for years. A moderately sized peripheral easily has a hundred registers with several fields each; an SoC-level address map has thousands. Every one of those needs an offset, a reset value, an access type, and field boundaries that match a specification exactly. Typing that by hand is slow, and it's a guaranteed source of the exact class of bug [article 02](../register-access-types) describes, where a field's access type gets transcribed wrong and every test built on top of it inherits the mistake.

## The model is generated, the spec is authoritative

The register model should come from whatever the project treats as the actual source of truth for the register map: an IP-XACT XML description, a spreadsheet with a defined schema, an internal DSL, or a vendor tool's own register description format. The generator's job is mechanical translation. Read the source of truth, emit a `uvm_reg_block` (or the SystemVerilog RAL package most frontends produce) with every register, field, offset, reset value, and access policy filled in exactly as specified. The moment someone opens the generated RAL file and hand-edits a reset value because "the spec must be wrong," the model stops being trustworthy. Not because the edit was wrong, but because the next regeneration silently reverts it, and nobody notices until a test that depended on the manual fix starts failing again for no visible reason.

If the spec is wrong, fix the spec, or whatever document is the actual source of truth, then regenerate. That discipline is what lets the rest of the testbench trust the model without re-verifying it by hand every time.

## What actually needs custom logic, and where it goes

A pure mechanical translation gets the layout right but has no way to know about behavior that isn't representable in the source format: a register whose value changes from a state machine the spec doesn't formally describe, or a field whose write triggers a side effect on a completely different register. RAL's answer here is the same one used throughout the class hierarchy: keep generated code and custom code in separate files, connected through composition rather than hand-edits. Generated register classes should stay thin, and any custom behavior, callbacks (covered later in this series), non-standard predict logic, waiver metadata (covered later in this series), belongs in an extension file or a registered callback object, never edited into the generated file directly.

The practical pattern: the generator emits something like `csr_block_top` as a file fully regenerated on every run. A separate, hand-maintained extension file, never touched by the generator, instantiates callbacks, sets `hdl_path`, and registers waiver tags against the generated register handles once `build()` completes. Regeneration replaces the mechanical file completely. The hand-maintained file doesn't need to change unless the custom behavior itself changes. Build systems already separate generated code from hand-written code for the same reason: mixing them in one file turns every regeneration into a manual merge.

![RAL generation pipeline: source of truth through the generator, split into a fully-regenerated file and a hand-maintained extension file](/images/csr/03-generation-pipeline.svg)

```systemverilog
// csr_block_top.svh: regenerated on every run, never hand-edited
class csr_block_top extends uvm_reg_block;
  rand int_status_reg int_status;
  rand ctrl_reg        ctrl;
  // ... every register in the map, mechanically emitted
endclass

// csr_block_ext.sv: hand-maintained, generator never touches this
class csr_block_ext;
  static extern function void connect_extensions(csr_block_top blk);
endclass

function void csr_block_ext::connect_extensions(csr_block_top blk);
  int_status_cb cb = new();
  uvm_reg_cb::add(blk.int_status, cb);
  blk.ctrl.add_hdl_path_slice("u_dut.u_ctrl.ctrl_reg", 0, 32);
  csr_waiver_manager::get().load_file("block_a_csr_waivers.txt");
endfunction
```

## Keeping the model synchronized with the spec over time

A register map isn't static once a project starts. Fields get added late in the design cycle, reset values change during bring-up, and access types occasionally get corrected after a review catches a mistake. Generation needs to run automatically whenever the source of truth changes, ideally as part of whatever build or CI trigger regenerates RTL headers from the same source, so the register model and the RTL are never verifying against two different versions of the same map. A stale generated RAL model checked in and manually regenerated "when someone remembers" is worse than no generation step at all. It looks authoritative while quietly drifting from the hardware it claims to describe.

## What generation doesn't solve

Generation gets the structure right: offsets, widths, access strings, reset values. It does nothing for behavioral correctness the source format can't express, and nothing to catch a spec that's ambiguous or simply wrong. A generated model reproduces a mistake in the spec exactly as faithfully as it reproduces a correct field. Generation eliminates transcription errors between the spec and the testbench. It's not a substitute for someone actually reviewing what the spec says a register is supposed to do.

---

*Next: What the Built-in Sequences Actually Test*
