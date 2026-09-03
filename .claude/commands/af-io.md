# AF-IO loop — make AquaFlow read/write the S7-1215C field-I/O rack

You are one iteration of a self-pacing loop. Each firing: pick up the next unfinished
work package, land it completely (code + tests + docs + commit), then yield. Do NOT try
to do everything in one iteration — one package (or one coherent slice of a large one)
per firing, fully green.

## Target hardware (purchased BOM)

- SIMATIC S7-1200 **CPU 1215C DC/DC/DC** (6ES7215-1AG40-0XB0) — 14 DI, 10 DO,
  2 AI (0–10 V), **2 AO (0–20 mA)**, dual PROFINET, S7comm TCP :102, rack 0 / slot 1.
- SM 1222 DQ16 24VDC transistor (6ES7222-1BH32-0XB0) — 16 digital outputs.
- PM 1207 24 VDC 2.5 A supply.
- SM 1231 AI 8×13-bit (6ES7231-4HF32-0XB0) is recommended-to-add for 4–20 mA analog;
  design for it, but everything must degrade gracefully to just the 2 onboard AI.
- PLC will sit on 192.168.5.x beside the existing I-CAN gateway (192.168.5.2:200).
  Nothing in this loop touches CAN or the I-CAN output path semantics.

Siemens-side facts the code and docs must encode:
- "Permit access with PUT/GET" must be enabled on the CPU (off by default on FW 4.x) —
  connection-refused/access errors must surface this hint to the operator.
- Data blocks must be **non-optimized** or absolute addressing (DB1.DBW0) doesn't exist.
- Heartbeat must be a PLC-incremented **counter**, never a constant.

## State: the checklist is the single source of truth

`AF-IO-PLAN.md` at repo root holds the package checklist. First iteration: create it
with the packages below as unchecked items (with their acceptance criteria), then start
AF-IO-001. Every iteration: read it, pick the FIRST unchecked package, do it, check it
off with a one-line result note, commit. When all are checked and the full suite is
green, run `ScheduleWakeup` with `stop: true` and write a closing summary to
CURRENT_STATUS.md.

Before starting work each firing: `git status` + `git log --oneline -5` — other
sessions touch this repo; rebase your understanding, stage only your own files by
explicit path, never `git add -A`.

## Work packages, in order

1. **AF-IO-001 — unified Modbus TCP client** (`aquaflow/backend/engine/modbus_client.py`).
   FC02/FC03/FC04/FC05/FC06. Full MBAP validation: transaction-id match, protocol id 0,
   declared length, unit id, exception responses (0x8x) decoded to named errors, exact
   framed reads (read the MBAP header, then exactly the declared remainder — never
   `read(256)`). One in-flight request per connection (asyncio.Lock). Reconnect with
   backoff. Fix `_parse_modbus_address` (a bare "4xxxx" offset conversion must require
   5–6 digits, never turn "45" into a negative register). Refactor `ModbusTCPDriver`
   (protocol_bus.py) and `ModbusTCPPLCDriver` (plc_engine.py) to delegate to it without
   changing their public interfaces or existing test behaviour.
2. **AF-IO-002 — field point model** (`engine/field_points.py`). `FieldPoint {id, source,
   address, kind AI/DI/AO/DO, raw_type, scale, offset, unit, deadband, required,
   binds_to}` + persisted config (JSON beside the I-CAN channel map, same pattern).
   Every reading is `{value, quality: GOOD|STALE|FAULT|UNKNOWN, ts}`. 4–20 mA points:
   raw below ~3.5 mA ⇒ quality FAULT, not value 0. 0–10 V points cannot detect broken
   wire — model that honestly (no fake FAULT detection).
3. **AF-IO-003 — FieldIOManager** (`engine/field_io.py`). Owns drivers, polls at
   configured scan rate, timestamps, marks STALE past 3× scan period, publishes to an
   in-memory input bus. The safety kernel PULLS from it in its 50 Hz tick — the kernel
   must never await a network call. Singleton wired in app_state like protocol_bus.
4. **AF-IO-008 — bench harness + tests** (yes, before the safety wiring). Fake Modbus
   server using the ALREADY-INSTALLED `pymodbus` server/simulator as a test-only dep
   (move `pymodbus>=3.6.0` into the test-harness block of requirements.txt with a note;
   it must NOT enter the PyInstaller bundle). Fake S7 server: minimal COTP/S7comm
   responder like `engine/fake_ican_gateway.py`. Injectable faults: exception response,
   short frame, dropped socket, frozen values, halted-CPU (static heartbeat). Tests for
   every AF-IO-001 validation path and AF-IO-002 quality transition.
5. **AF-IO-004 — safety kernel wiring**. Tri-state safety inputs with per-input
   `required` flag (default False ⇒ behaviour identical to today). New
   `SENSOR_FAULT` fault code. Required input UNKNOWN/STALE/FAULT ⇒ permit withdrawn;
   non-required ⇒ permit held, "unmonitored" surfaced in get_status(). Replace the
   faked `update_plc_heartbeat()` path: heartbeat liveness comes from FieldIOManager
   (counter advancing), and `SAFETY_BYPASS` must appear in the status payload so the UI
   can never look clean while it is set. Do not change existing test expectations for
   the default (nothing-required) configuration.
6. **AF-IO-005 — S7-1200 driver, correct** (`engine/s7_client.py` or fixed in place).
   Fix the raw S7comm bit-addressing (address bytes = offset*8, 3-byte big-endian);
   DBX/DBB/DBW/DBD read AND write; REAL and DINT types; snap7 preferred when importable,
   raw fallback otherwise; snap7 declared optional in requirements with a comment about
   bundling snap7.dll. Deliverable: `aquaflow/docs/S7_DB_CONTRACT.md` — DB1
   non-optimized layout (heartbeat counter word, estop bit, level/pressure/flow words,
   VFD status word, command area incl. the 2 AO), plus the PUT/GET and non-optimized
   checklist for the TIA-side electrician.
7. **AF-IO-006 — honest PLC support matrix**. Mirror AF-HUB-014's four tiers into
   plc_engine/api: siemens_s7 REAL, modbus_tcp REAL, everything else GATED or removed;
   `_create_driver` must never substitute Modbus for an unsupported type;
   `/api/plc/types` reflects reality; PLCPanel type list updated to match.
8. **AF-IO-007 — telemetry + Field I/O panel**. `field_io` message on the existing
   250 ms websocket loop; a Field I/O tab in the PLCPanel shell: per point raw counts,
   scaled value, unit, quality badge, age, and the last raw frame hex (mirror the
   AF-ICAN-006 per-command hex idiom). Frontend tests per existing panel test patterns.
9. **AF-IO-009 — VFD write-back (last, optional)**. Command path to the 1215C's 2 AO
   through the safety gate (pump enable + permit), for the ZONCEN speed reference.
   Document the 0–20 mA vs 0–10 V reference-input caveat in the DB contract. If time
   or clarity runs out, leave unchecked with a note rather than landing it half-gated.

## Invariants — every iteration

- Fail-closed INPUT semantics: an absent/stale reading is never a permit; no new
  boolean safety input may default to a permissive value.
- Never modify I-CAN 0x08 output semantics, the arm gate, or the 10 Hz refresh stream.
- Backend: run the targeted tests, then the FULL pytest suite — baseline 593 passed /
  21 skipped, 0 failures; it may only grow. Frontend (if touched): vitest baseline 391.
- No session-report.json (manual session). No force-adding gitignored tooling.
- Commit per package: `AF-IO-00X: <what changed and why>`, stage explicit paths, push
  to origin. Append a dated entry to CURRENT_STATUS.md in the house style (what, why,
  test counts) as part of the same commit.
- If truly blocked (needs hardware on the desk, or a user decision), write the blocker
  into AF-IO-PLAN.md under that package, skip to the next package; if nothing is
  workable, stop the loop with a summary instead of spinning.

## Pacing

After committing, schedule the next firing: 60–120 s if mid-package with clear next
steps, 300 s after finishing a package. `noop: true` only if you genuinely changed
nothing.
