# AquaFlow Studio 1.1.7 — Field I/O, the Siemens path, and the controller catalog

The biggest build since fountain control began. 1.1.5 finished the OUTPUT side
(streaming I-CAN). 1.1.7 gives AquaFlow an INPUT side and prepares the Siemens
S7-1215C rack — plus auto-detection of whatever controller is on the wire.

## What's new

**Field I/O (the S7-1215C / Modbus remote-I/O input side)**
- New Modbus TCP client that validates every reply (the old one could read
  garbage as data), plus FC02/FC04/FC05 for ADAM/Moxa-class remote I/O.
- New S7 (Siemens) client with CORRECT DB addressing — the old raw driver read
  the wrong location at every offset except 0.
- Field points: every sensor reading carries a quality — GOOD / STALE / FAULT /
  UNKNOWN. A 4-20 mA broken wire reads FAULT, never "tank empty".
- The safety kernel now reads REAL sensors: a required sensor that is not GOOD
  withdraws the master permit, and it comes back by itself when the sensor does.
  PLC liveness = its heartbeat counter MOVING (a halted CPU still answers reads).
- PLC panel → new **Field I/O** tab: live values, quality badges, age, raw frame
  hex per source, heartbeat verdict.
- Safety-gated VFD speed path (ZONCEN reference via the PLC's analog output).
  STOP is never gated — no permit, broken kernel, it still stops.

**Controllers (Device Discovery → new "Controllers" tab)**
- **DETECT** sweeps the network with read-only probes and names what it finds:
  Siemens S7 (real handshake), Modbus devices (vendor identification), I-CAN
  gateways (safe probe), Allen-Bradley (identified, honestly marked NOT drivable).
- Below it: an 18-entry catalog of fountain controllers/PLCs with pre-filled
  configs — including the reverse-engineered profile of YOUR site cabinet
  (gateway 192.168.5.2:200, local port 2002, group 0, 10 Hz streaming).

**For the Siemens rack (when it arrives)**
- `docs/S7_DB_CONTRACT.md` — the exact PLC data-block layout + the three settings
  that break everything (PUT/GET, non-optimized DB, heartbeat counter).
- `docs/plc/` — the COMPLETE TIA program (import, don't write) + a click-by-click
  walkthrough. Programming the PLC is an import-and-download job.

Nothing in the I-CAN path changed — 1.1.5's streaming behaviour is untouched.

**1.1.7 over 1.1.6:** the PLC panel now lists ALL 8 PLC families again
(operator request) — each honestly labeled: Siemens S7 + Modbus TCP have full
drivers; Delta / Mitsubishi / Omron connect through their Modbus TCP interface
(shown as "via Modbus TCP"); OPC UA / Allen Bradley / Beckhoff are visible but
marked "no driver" with Connect disabled — never the old silent wrong-driver
connection.

## Install

1. Close AquaFlow Studio.
2. Run `AquaFlowSetup-1.1.7.exe`. SmartScreen → More info → Run anyway.
3. **Help → About must say 1.1.7.**

## Test (5 minutes, no hardware needed)

1. **Devices → Device Discovery → Controllers tab** → press **DETECT**.
   With the site network attached it should find the I-CAN gateway; on a bare
   network it reports the scan honestly and shows the catalog below.
2. Click the "I-CAN 32-ch Music Fountain" catalog entry — confirm it shows your
   site profile (192.168.5.2:200, local port 2002, group 0, 10 Hz).
3. **Devices → PLC panel** — the type list now offers only what genuinely works
   (Siemens S7, Modbus TCP), and there is a new **Field I/O** tab.
4. Fountain Control (I-CAN): connect / arm / streaming counter — exactly as in
   1.1.5, unchanged.

## Test counts for this build

Backend 685 passed / 21 skipped / 0 failures (706) · Frontend 396 passed (31
files). Field I/O + S7 proven against a bench-fake PLC and pymodbus
cross-validation; physical-rack sign-off follows the S7_DB_CONTRACT checklist.

## Send back

1. Version in Help → About
2. What DETECT found on the site network (screenshot of the Controllers tab)
3. Anything red in the Field I/O tab once the PLC is commissioned
