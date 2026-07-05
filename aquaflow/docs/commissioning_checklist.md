# Hardware Output Commissioning Checklist (AQ-FIX-001)

**Status of the known issue:** the output path is verified in software against a
**virtual loopback DMX/Art-Net/sACN node** (`validate_hardware_output.py` 20/20,
`test_hardware_output.py`), with the `_safety_gate` choke point proven on the wire.
The remaining, un-closable-in-CI step is a **first bring-up against a physical
fixture on real cabling**. This checklist turns that first bring-up into a *formal
test*, not a formality.

> ⚠️ This document is the procedure + acceptance record. The physical session
> requires real hardware and an authorised operator on site; it cannot be executed
> in CI. Until it is signed off, treat "hardware output" as **loopback-verified,
> physical-pending** — do not run a live public site.

## Pre-conditions (must be green before touching hardware)

- [ ] `python -m pytest` full backend suite green (incl. `test_hardware_output.py`,
      `test_journeys_e2e.py`, `test_time_based_metrics.py`).
- [ ] `python validate_hardware_output.py` → `deployment_ready: True` (5/5 loopback).
- [ ] `python validate_safety_output_limits.py` → 15/15 (safety gate intact).
- [ ] Frontend `npm run build` clean.

## Equipment & wiring record

| Field | Value |
|---|---|
| Date / operator | |
| Controller (NIC / IP) | |
| Protocol under test | DMX512 / Art-Net / sACN (E1.31) |
| Node / fixture make + model | |
| Universe(s) | |
| Address map (fixture → universe:channel) | |
| Cable type / length / termination | |

## On-wire verification (per protocol)

- [ ] **Levels:** command a known channel value; measure the value **arriving at the
      fixture/node** matches the commanded value (± the protocol's quantisation).
- [ ] **15-bit universes:** command a universe > 255 (Art-Net net/sub/low split) and
      confirm it is decoded correctly at the node.
- [ ] **Refresh rate:** capture transmit cadence; confirm **≤ 44 Hz** (Art-Net ceiling)
      and the ~22.7 ms DMX512 physical frame floor is respected.
- [ ] **Safety gate — no permit:** with the master permit OFF, confirm **all** emitted
      channels (incl. R/G/B colour channels, not just dimmer) read **zero** on the wire.
- [ ] **Safety gate — permit:** with permit ON, confirm the commanded value reaches the
      wire; per-fixture intensity clamp still applied.
- [ ] **Flame duration:** confirm a flame channel latches OFF after `FLAME_MAX_DURATION`
      (3 s) continuous on-time, independent of the safety kernel.

## Acceptance (sign-off)

- [ ] All on-wire checks above pass on the physical target.
- [ ] No regression: `validate_safety_output_limits.py` and
      `validate_hardware_output.py` re-run green after the session.
- [ ] This record is completed (equipment, address map, measured timing) and stored
      with the project.
- [ ] Sign-off name / date: ____________________

## Deliberate-break assurance (already automated)

The automated suite fails if the output path regresses: `test_hardware_output.py`
asserts on-wire channel values and the safety gate through `protocol_bus` into the
loopback node. A change that (e.g.) stops scaling colour channels by the gated
intensity, or lets output through with no permit, makes those tests **fail** — the
same assertions this physical checklist mirrors on real hardware.

## Rollback

Nothing in this task weakens a safety limit. The commissioning artifacts are additive
(docs + tests); reverting the commit removes only those artifacts, leaving the
`_safety_gate` choke point unchanged.
