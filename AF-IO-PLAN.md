# AF-IO — Field I/O for the S7-1215C rack (loop checklist)

Single source of truth for the `/af-io` loop. One package per iteration, fully landed
(code + tests + CURRENT_STATUS entry + commit) before its box is checked. Blockers get
written under the package instead of spinning.

Target hardware: CPU 1215C DC/DC/DC (6ES7215-1AG40-0XB0, 14 DI / 10 DO / 2 AI 0-10V /
2 AO 0-20mA, PROFINET :102 rack 0 slot 1), SM 1222 DQ16, PM 1207. SM 1231 AI 8x13-bit
recommended-to-add; design for it, degrade gracefully to the 2 onboard AI.

- [x] **AF-IO-001 — unified Modbus TCP client** (`engine/modbus_client.py`). DONE
      2026-09-03: client landed with 18 tests; both drivers delegate; suite
      611 passed / 21 skipped / 0 failures (632).
      FC02/03/04/05/06, full MBAP validation (txid, protocol id, length, unit,
      exception decode, exact framed reads), one in-flight request per connection,
      reconnect with backoff, fixed address parsing ("45" is never a negative
      register). `ModbusTCPDriver` + `ModbusTCPPLCDriver` delegate to it, public
      interfaces unchanged.
- [x] **AF-IO-002 — field point model** (`engine/field_points.py`). DONE 2026-09-03:
      FieldPoint + FieldPointStore (JSON, ChannelMap pattern); Reading carries
      quality; 4-20mA < 3.5 mA ⇒ FAULT value None; 0-10V no fake detection;
      binds_to/required validated at the form; 12 tests; suite 623/21/0 (644).
- [x] **AF-IO-003 — FieldIOManager** (`engine/field_io.py`). DONE 2026-09-03:
      per-source poll tasks (FC02/03/04 by point kind + address dialect), STALE via
      read-time aging, UNKNOWN for unavailable transports (s7: until 005),
      heartbeat-judged-on-change, worst-of bound_snapshot for the kernel, singleton
      in app_state + lifespan; 9 tests; suite 632/21/0 (653).
- [x] **AF-IO-008 — bench harness + tests**. DONE 2026-09-03: pymodbus (test-only,
      SimData/SimDevice — the deprecated 3.13 context serves hr/ir SWAPPED and the
      cross-validation caught it) validates modbus_client on all 5 FCs;
      engine/fake_s7_server.py speaks COTP/S7comm with correct bit addressing,
      halted-CPU frozen heartbeat, error/short/drop fault modes scoped to the data
      phase; 6 tests; suite 638/21/0 (659).
- [x] **AF-IO-004 — safety kernel wiring**. DONE 2026-09-03: _ingest_field_io in the
      50 Hz tick (sync pulls only); SENSOR_FAULT (edge-logged, non-latched — permit
      returns by itself on GOOD); required not-GOOD ⇒ permit withdrawn incl. dead
      required heartbeat; GOOD DI bools drive the real interlocks (E-stop transition
      proven); SAFETY_BYPASS + field_io block in get_status; e2e device-death test;
      9 tests; suite 647/21/0 (668).
- [x] **AF-IO-005 — S7-1200 driver, correct**. DONE 2026-09-03:
      engine/s7_client.py (bit addressing offset*8, validated TPKT/pdu_ref/item
      retcodes, item-vs-frame errors, backoff); DBX/DBB/DBW/DBD read AND write +
      INT/DINT/REAL; SiemensS7Driver raw path delegates (and can finally WRITE
      without snap7; snap7 DBD REAL fixed); FieldIOManager polls s7: sources;
      docs/S7_DB_CONTRACT.md published; 11 tests; suite 658/21/0 (679).
- [ ] **AF-IO-006 — honest PLC support matrix**. Four tiers mirrored into
      plc_engine/api; no silent Modbus substitution for unsupported types;
      /api/plc/types + PLCPanel reflect reality.
- [ ] **AF-IO-007 — telemetry + Field I/O panel**. `field_io` message on the 250 ms
      websocket loop; Field I/O tab in PLCPanel (raw counts, scaled value, unit,
      quality badge, age, last raw frame hex).
- [ ] **AF-IO-009 — VFD write-back (optional, last)**. Safety-gated command path to
      the 1215C's 2 AO for the ZONCEN speed reference; 0-20 mA vs 0-10 V caveat in
      the DB contract.

## Log

(loop appends one line per iteration: date · package · result)

- 2026-09-03 · AF-IO-005 · landed: engine/s7_client.py (correct bit addressing,
  typed R/W, validated framing), plc_engine raw path delegates + writes,
  FieldIOManager s7: dialect, docs/S7_DB_CONTRACT.md; 11 tests; backend 658/21/0.
- 2026-09-03 · AF-IO-004 · landed: safety kernel ingests field I/O (required
  not-GOOD withdraws permit; DI bools drive interlocks; heartbeat-on-change is PLC
  liveness; SAFETY_BYPASS visible); 9 tests; backend 647/21/0.
- 2026-09-03 · AF-IO-008 · landed: pymodbus cross-validation (caught the 3.13
  deprecated-context hr/ir swap), engine/fake_s7_server.py + reference request
  encoder for AF-IO-005; pymodbus moved to test-only requirements; backend 638/21/0.
- 2026-09-03 · AF-IO-003 · landed: engine/field_io.py (FieldIOManager reader loop,
  sync pull accessors, heartbeat-on-change, app_state/lifespan wiring); 9 tests;
  backend 632/21/0.
- 2026-09-03 · AF-IO-002 · landed: engine/field_points.py (FieldPoint, Reading with
  GOOD/STALE/FAULT/UNKNOWN, FieldPointStore persistence); 12 tests; backend 623/21/0.
- 2026-09-03 · AF-IO-001 · landed: engine/modbus_client.py (FC02/03/04/05/06, full
  MBAP validation, serialised transactions, backoff reconnect, honest address
  parsing); ModbusTCPDriver + ModbusTCPPLCDriver now delegate; 18 new tests;
  backend 611/21/0.
