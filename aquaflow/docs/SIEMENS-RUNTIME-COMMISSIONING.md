# Commission an S7-1200 for AquaFlow runtime

This procedure uses TIA Portal to engineer the PLC once. AquaFlow operates the commissioned runtime interface after TIA Portal is closed.

## 1. Prepare the cabinet safely

Have a qualified controls/electrical engineer verify the CPU order number and firmware, I/O modules, 24 V supply, output types, contactors, VFD interfaces, motor protection, hardwired E-stop and hydraulic protection. Isolate or mechanically secure pumps and valves before the first download. Configure safe CPU-STOP substitute output behavior.

## 2. Create the AquaFlow site

1. Open **Siemens new-site setup**.
2. Enter pump, independently switched valve/nozzle and PLC-driven RGB-light counts.
3. Save the site in **SIMULATED** mode.
4. Enter the PLC IP, TCP port 102, rack 0, slot 1 and chosen DB number.
5. Enter the expected CPU order number and firmware exactly when known.
6. Map each pump to its `%QW` speed word and digital enable output.
7. Map each valve to `%Qx.y`.
8. Map each RGB light to its first `%QB` byte; AquaFlow uses that byte plus the next two.
9. Map optional digital running/open and fault inputs. Unmapped feedback is reported as PLC-applied, not physical.
10. Map healthy-high E-stop, level, thermal, drive and pressure inputs.

Avoid overlapping addresses. Record the VFD minimum usable speed and keep each AquaFlow pump ceiling within the commissioned hydraulic limit.

## 3. Export and review the TIA package

Export **AquaFlow-Siemens-TIA-Package.zip**. It contains:

- `AquaFlowSiteIO.db`;
- `AquaFlowSiteControl.scl`;
- `AquaFlowCycle.scl`;
- cyclic OB requirements;
- I/O schedule;
- frozen site JSON;
- review notes.

The site signature changes when routing, safety bindings, feedback bindings, limits, DB number or selected hardware changes. Re-export and re-download after any such change.

## 4. Configure in TIA Portal

1. Create the project and add the exact CPU/firmware printed on the device.
2. Add the installed modules in their real positions.
3. Configure the plant IP, subnet and PROFINET device name.
4. Configure protection and connection mechanisms so the approved AquaFlow host can use classic S7 absolute DB reads/writes. Do not bypass CPU access protection.
5. Import the DB and SCL FB sources.
6. Ensure `AquaFlowSiteIO` is the configured DB number and **optimized access is disabled**.
7. Use a non-retentive `AquaFlowSiteControlInstance`.
8. Import/create `AquaFlowCycle` as a 100 ms cyclic interrupt and call the instance exactly once.
9. Replace every generated `FALSE` safety argument with the verified healthy-high cabinet input.
10. Verify physical addresses and optional feedback inputs against the I/O schedule.
11. Compile hardware and software. Resolve every error and review warnings.
12. Inspect the DB offsets against `SIEMENS-PLC-RUNTIME-CONTRACT.md`.
13. Download while outputs are secured. Leave the CPU stopped until the controls engineer is ready.

## 5. PLC-only commissioning

With AquaFlow disconnected, put the CPU in RUN and confirm:

- PLC heartbeat changes every 100 ms;
- local permit is false when any required interlock opens;
- all outputs remain zero without fresh command sequences;
- command watchdog removes Ready/Running within about one second;
- CPU STOP, E-stop, low level, drive trip and thermal trip produce the designed safe state.

## 6. AquaFlow verification

Close TIA Portal completely. Put the engineering PC and AquaFlow PC on the approved control network.

1. Use controller discovery on the selected Ethernet adapter/CIDR.
2. Treat DCP results as device identity only. Require an S7 handshake and, where exposed, SZL CPU identity.
3. Open the saved Siemens site and switch it to **PHYSICAL** only after entering the real address.
4. Click **Identify CPU** and compare order number/firmware with the cabinet and TIA project.
5. Click **Verify**. This is read-only.
6. Confirm the UI reports contract v2, moving heartbeat, no fault and an acknowledged stopped state.
7. If Verify reports old magic/version, download the newly exported TIA package. Do not force compatibility.

## 6a. PLCSIM: reachability and CPU identity

The simulator decides whether AquaFlow can reach it at all, and whether it answers the identity lists. Neither is an AquaFlow setting.

| Simulator | Reachable on TCP 102 from AquaFlow? | Identity (SZL 0x0011/0x001C)? |
|---|---|---|
| S7-PLCSIM (standard, ships with TIA Portal; S7-1200/1500) | **No** by itself. Port 102 on the TIA PC belongs to the Siemens S7ONLINE service (`s7oiehsx64`), not to the simulated CPU. Reachable only through **NetToPLCsim** (station rack 0, slot 1; let it stop the S7DOS service). | Depends on PLCSIM/NetToPLCsim version; may answer an error. |
| S7-PLCSIM Advanced (S7-1500, ET 200SP) | Yes, when the instance uses **PLCSIM Virtual Ethernet Adapter** with an IP; not in "PLCSIM" local mode. | Normally yes. |
| Physical S7-1200 | Yes. | Yes (order number, firmware, station name). Access protection can refuse it. |

What discovery shows, and what it means:

- **"Siemens SIMATIC S7 family (S7comm) · protocol confirmed"** with a warning that CPU identity is not claimed: the endpoint speaks S7comm and accepted the connection, but did not serve the identity lists. The warning names the exact reason and a hex excerpt of the reply. This is expected with several simulators. **AquaFlow does not need the identity.** Leave *expected order number* and *expected firmware* blank on the Siemens site and use **Verify**, which checks the AquaFlow DB contract (magic, version, signature, moving heartbeat) directly.
- **"ISO-on-TCP endpoint on 102 — not an S7 CPU (setup refused)"**: something at that address speaks COTP but refused the S7 setup on rack 0/slot 1 and rack 0/slot 2. On a bench this is almost always the TIA Portal PC itself. Use NetToPLCsim or PLCSIM Advanced as above.
- **Nothing found** while the CPU is running: port 102 is not reachable from the AquaFlow PC. Check with `Test-NetConnection <ip> -Port 102` before changing anything in AquaFlow.

Identity lists larger than one PDU (a real S7-1200 negotiates 240 bytes, and its component list is longer) are read in parts with the standard SZL continuation telegram. The firmware version is decoded from the wire encoding (`V<major>.<minor>.<patch>`).

Fill the **PLCSIM** row of the evidence table below only after the recorded run captures: simulator product and version, TIA version, CPU order number and firmware in the project, DB number, the Verify result, and the observed heartbeat/acknowledgement behaviour.

## 7. Commission channels

Use site staff with direct observation and radio/phone communication:

1. Enable the AquaFlow safety monitor permissions.
2. Confirm a safe flow path.
3. Test one outlet for three seconds at the bounded commissioning speed.
4. Observe the actual nozzle/valve/pump response.
5. Enter a specific observation and mark it commissioned.
6. Repeat one channel at a time.
7. Test RGB colors at a safe output and confirm R/G/B wiring.
8. Where sensors exist, confirm the UI says feedback source `physical`; otherwise it will say `plc_applied`.

## 8. Acceptance sequence

Run this attended sequence only after channel commissioning:

| Time | Command |
|---:|---|
| 0 s | Valve 1 open, then Pump 1 at commissioned low speed |
| 2 s | Confirm pump running/open feedback |
| 4 s | Pump 2 on with its outlet |
| 6 s | RGB light scene |
| 10 s | Valve 1 close under PLC timing rules |
| 12 s | Pump 2 off |
| 15 s | Stop and disarm |

Confirm every command sequence is acknowledged and feedback returns with the same sequence.

## 9. Failure tests

Perform these with qualified staff and outputs secured:

| Test | Required result |
|---|---|
| Wrong DB/IP | Clear failure, zero writes to an unverified DB |
| Incompatible signature/version | Verify rejects |
| PLC STOP | Heartbeat stops; AquaFlow disarms |
| Remove Ethernet cable | PLC watchdog makes outputs safe; AquaFlow reports unconfirmed Stop |
| Restore cable | Reconnect verifies only; no automatic restart |
| Restart AquaFlow | Verify/Arm/Start required |
| Restart PLC | No automatic show resume |
| Remove local permit | PLC forces safe state and AquaFlow stops |
| Missing acknowledgement | No success is claimed and no next nonzero frame is sent |

## Current test evidence

| Test | Environment | Real PLC communication? | Result |
|---|---|---:|---|
| S7 discovery/identity parser | constructed packets/fake endpoints | No | Passed unit tests |
| Contract detection | FakeS7Server | No | Passed |
| DB read/write and staged commit | FakeS7Server | No | Passed |
| Pump/valve manual command and feedback | FakeS7Server | No | Passed |
| RGB encoding/generated PLC mapping | generated source/unit tests | No | Passed |
| Heartbeat, missing ack and permit loss | FakeS7Server | No | Passed |
| Reconnect without resume | FakeS7Server | No | Passed |
| PLCSIM | Not available/used in this workspace | No | **UNVERIFIED** |
| Physical S7-1200 | Not connected for this work | No | **UNVERIFIED** |

Do not change the last two rows to Passed until the result is captured with the actual TIA version, CPU order number, firmware, project signature and observed I/O behavior.
