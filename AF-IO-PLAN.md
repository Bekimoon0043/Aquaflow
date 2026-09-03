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
- [ ] **AF-IO-002 — field point model** (`engine/field_points.py`). FieldPoint +
      persisted config; every reading `{value, quality GOOD|STALE|FAULT|UNKNOWN, ts}`;
      4-20mA under-range (< ~3.5 mA) ⇒ FAULT not zero; 0-10V honestly cannot detect
      broken wire.
- [ ] **AF-IO-003 — FieldIOManager** (`engine/field_io.py`). Poll loop, timestamps,
      STALE past 3× scan period, in-memory input bus the safety kernel PULLS from
      (never awaits network in its 50 Hz tick). Singleton in app_state.
- [ ] **AF-IO-008 — bench harness + tests** (before safety wiring). pymodbus as
      TEST-ONLY dep for a fake Modbus server; minimal fake S7 responder like
      fake_ican_gateway.py; injectable faults (exception reply, short frame, dropped
      socket, frozen values, halted-CPU static heartbeat).
- [ ] **AF-IO-004 — safety kernel wiring**. Tri-state inputs + per-input `required`
      (default False = today's behaviour); SENSOR_FAULT code; required
      UNKNOWN/STALE/FAULT withdraws permit; heartbeat liveness from FieldIOManager
      counter; SAFETY_BYPASS visible in status payload.
- [ ] **AF-IO-005 — S7-1200 driver, correct**. Fix raw S7comm bit addressing
      (offset*8, 3-byte BE); DBX/DBB/DBW/DBD read AND write; REAL/DINT; snap7
      preferred + raw fallback; `docs/S7_DB_CONTRACT.md` (non-optimized DB1 layout,
      heartbeat counter, PUT/GET checklist for the TIA electrician).
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

- 2026-09-03 · AF-IO-001 · landed: engine/modbus_client.py (FC02/03/04/05/06, full
  MBAP validation, serialised transactions, backoff reconnect, honest address
  parsing); ModbusTCPDriver + ModbusTCPPLCDriver now delegate; 18 new tests;
  backend 611/21/0.
