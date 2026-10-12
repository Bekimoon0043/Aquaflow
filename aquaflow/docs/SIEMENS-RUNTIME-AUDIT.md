# Siemens runtime audit

Date: 2026-09-24

This audit records the repository state before the Siemens runtime work. It separates engineering in TIA Portal from the data connection AquaFlow uses after commissioning. A passing fake-server test is not evidence that a physical S7-1200 has been controlled.

## Required operating model

```text
TIA Portal (hardware, PLC logic, compile, download, commissioning)
    -> commissioned S7-1200 and AquaFlow data block
    -> Ethernet / ISO-on-TCP / classic S7comm
    -> AquaFlow verification and runtime commands
    -> PLC interlocks and physical outputs
```

TIA Portal does not need to remain open for the runtime data connection. The commissioned CPU must permit the configured S7 communication mechanism and expose the non-optimized AquaFlow DB.

## Inventory and evidence classification

| Area | Implementation | Classification | Evidence and limitation |
|---|---|---|---|
| ISO-on-TCP and COTP | `backend/engine/s7_client.py` | REAL PROTOCOL / HARDWARE UNVERIFIED | Opens TCP 102, negotiates COTP and S7 setup, validates frames and PDU references. No physical S7-1200 result is recorded in this repository. |
| Absolute DB access | `backend/engine/s7_client.py` | REAL PROTOCOL / HARDWARE UNVERIFIED | Implements S7comm Read Var and Write Var for bits, bytes, 16/32-bit integers and REAL values. Requires classic absolute access to a non-optimized DB and CPU access configured in TIA. |
| Siemens identity | `backend/engine/s7_identify.py` | REAL READ-ONLY PROTOCOL / HARDWARE UNVERIFIED | Strict COTP/S7 setup plus SZL 0x0011 and 0x001C parsing for order number, firmware and names. An S7 handshake without SZL is deliberately not promoted to exact CPU identity. |
| PROFINET discovery | `backend/engine/profinet_dcp.py`, `controller_identify.py` | REAL READ-ONLY PROTOCOL / PLATFORM LIMITED | Sends DCP Identify at layer 2 and preserves MAC/IP evidence. Raw Ethernet availability is platform/driver dependent; DCP alone cannot prove a device is an S7 PLC. |
| Controller subnet scan | `backend/engine/controller_identify.py` and controller routes | PARTIALLY REAL | Bounded adapter-scoped TCP discovery and protocol identification exist. It is not yet connected directly to a saved Siemens site selection workflow. |
| Generic S7 profile verification | `backend/engine/plc_verify.py`, `backend/plc/s7_profiles.py` | REAL READ-ONLY PROTOCOL / HARDWARE UNVERIFIED | Checks configured fields and a moving heartbeat. It uses a separate older DB profile and is not the Siemens Site runtime contract. |
| Siemens Site persistence and show compilation | `backend/engine/siemens_site.py` | REAL APPLICATION LOGIC | Persists mappings, compiles pump/valve clips, enforces timing and pump outlet constraints, and produces deterministic command frames. Lighting is rejected and unused. |
| Siemens Site runtime | `backend/engine/siemens_runtime.py` | PARTIALLY REAL | Physical mode uses `S7Client`; Verify is read-only; Arm commits an OFF frame; playback commits frames and waits for acknowledgements. Tests use the fake S7 server only. |
| S7 fake server | `backend/engine/fake_s7_server.py` | SIMULATED | Exercises wire framing and DB reads/writes. It is not PLCSIM and is not proof of CPU compatibility. |
| PLC-side source package | `backend/services/siemens_tia_package.py` | ENGINEERING SOURCE GENERATION | Produces non-optimized DB, SCL FB and cyclic OB source. TIA must review, compile, download and commission it. |
| TIA Openness service/bridge | `backend/services/siemens_openness.py`, `tools/tia-openness-bridge` | ENGINEERING-ONLY / ENVIRONMENT UNVERIFIED | Orchestrates installed licensed Siemens engineering components. It is not needed while AquaFlow operates an already commissioned PLC. |
| Siemens REST API | `backend/api/routes/siemens_sites.py` | PARTIALLY REAL | CRUD, source export, engineering actions, Verify/Arm/Start/Stop and bounded outlet test exist. Runtime diagnostics, direct equipment commands and discovery-to-site adoption are missing. |
| Siemens UI | `frontend/src/components/panels/SiemensSitePanel.jsx`, `components/programmer/SiemensShowControls.jsx` | PARTIALLY REAL | Exposes site engineering/runtime workflow and show controls. It inherits the backend gaps and does not display actual equipment feedback. |
| Generic fountain protocols | `backend/engine/protocol_bus.py`, `field_io.py` | SEPARATE RUNTIME | DMX/Art-Net/sACN/Modbus and other adapters exist. They are not the Siemens Site DB contract and must not be mistaken for proof of this PLC path. |
| Coordinated stop | `backend/engine/runtime_authority.py` | REAL APPLICATION LOGIC | Fans out emergency stop/blackout to Siemens runtime and other engines. It is software coordination, not a safety-rated E-stop. |

## Existing runtime contract

The current `aquaflow-siemens-site-v1` data block is 212 bytes:

| Bytes | Owner | Meaning |
|---:|---|---|
| 0..1 | PLC | Magic `0xAF02` |
| 2..3 | PLC | Incrementing heartbeat |
| 4..5 | PLC | Permit word; bit 0 is the combined local permit |
| 6..7 | PLC | Status word; bit 0 means show command is running |
| 8..11 | PLC | CRC32 site/program signature |
| 12..13 | PLC | Last adopted command sequence |
| 14..15 | reserved | Unused |
| 16..17 | AquaFlow | Command sequence; written last |
| 18..19 | AquaFlow | Command flags; bit 0 run, bit 15 staging/busy |
| 20..51 | AquaFlow | Sixteen pump speed commands, raw 0..27648 |
| 52..115 | AquaFlow | 512 valve command bits |
| 116..211 | reserved | 32 RGB triples, not implemented |

The commit algorithm writes the staging flag, payload, final flags, and then sequence. The PLC snapshots a stable new frame, applies interlocks, and publishes the acknowledgement after outputs/status. Missing frames for approximately one second force the generated PLC logic to zero its run state and require a new OFF handshake.

## What already works logically

- Simulation never constructs a network client.
- Physical Verify performs reads only and requires the expected magic, site signature and moving heartbeat.
- Physical Arm requires a current verification, AquaFlow safety permits, operator flow-path confirmation, commissioning observations and output mappings.
- Pump commands are clamped and suppressed unless an associated outlet is commanded open.
- The generated PLC FB repeats flow-path protection, minimum valve timing, local healthy-high interlocks and a command watchdog.
- Start/Stop frames require a PLC acknowledgement; failure is not reported as confirmed success.
- Global AquaFlow emergency stop invokes the Siemens runtime stop path.

## Broken or missing pieces

1. **No explicit contract metadata.** Magic plus a site CRC identifies one generated mapping, but there is no independently readable contract version, project ID, PLC ID or program version.
2. **No feedback model.** AquaFlow sees only permit, a running bit, heartbeat and acknowledgement. It cannot distinguish commanded state from pump-running, valve-open, light-active, trip, interlock or fault feedback.
3. **Lighting is reserved only.** The site validator rejects physical lighting mappings, the show compiler rejects light tracks, and the PLC FB does not consume the reserved RGB data.
4. **No detailed diagnostics.** The runtime does not expose connection phase, timestamps, reconnect count, last transaction, PLC status bits, fault code, rejected command reason or feedback quality.
5. **No reconnect state machine.** A transport failure invalidates verification. There is no bounded retry loop, re-handshake, stale-session rejection or controlled recovery workflow.
6. **No runtime CPU identity binding.** Network discovery can identify model/firmware, but saved sites do not retain and enforce the expected order number/firmware at runtime.
7. **Discovery is detached from site commissioning.** Controller discovery exists elsewhere; a detected endpoint cannot yet be adopted and compatibility-checked from the Siemens Site workflow.
8. **No manual pump/valve/light runtime API.** Only a bounded outlet test and compiled show playback are exposed.
9. **Two Siemens contract concepts coexist.** The generic PLC profile (`AquaFlowIO`/DB1 documentation) and Siemens Site (`AquaFlowSiteIO`/configurable DB) serve different workflows and can confuse commissioning.
10. **Status label overstates proof.** `quality=PHYSICAL` currently means physical mode was selected; it does not mean physical hardware was verified.
11. **No PLCSIM evidence in the repository.** Current integration tests use `FakeS7Server`. No installed/running TIA Portal or PLCSIM environment was established by this audit.
12. **No physical S7-1200 evidence.** There is no checked, reproducible record of a real CPU executing the generated FB and returning feedback.

## Safety boundary

The PLC owns deterministic output application, hydraulic sequencing constraints, local interlocks, command timeout and safe substitute outputs. Electrical protection, hardwired emergency stop, motor protection and hydraulic relief remain outside AquaFlow. AquaFlow owns show timing, operator command gating, connection supervision, command acknowledgement and clear diagnostics. A software Stop is operational control; it must never be described as a safety-rated emergency stop.

## Implementation decision

Extend the existing Siemens Site path rather than add another driver:

1. Put every DB offset, bit and encoder/decoder in one runtime contract module.
2. Version the wire contract and add project/program identity, detailed status/fault fields and actual feedback banks.
3. Keep staged command commit and PLC acknowledgement semantics.
4. Add RGB light commands and feedback using the existing light capacity.
5. Add a supervised connection state with honest evidence labels and safe, explicit re-verification after loss.
6. Reuse S7 identity/DCP discovery and bind expected CPU identity to the site without treating discovery as compatibility.
7. Generate the matching TIA source and commissioning documentation from the same constants.
8. Test byte-exact behavior against the fake S7 server and label it simulated. PLCSIM and real-hardware rows remain unverified until those environments are actually used.

## Acceptance evidence required later

The software can be called physically verified only after a commissioned S7-1200 runs the exact generated contract and the recorded test demonstrates: TIA closed, identity and contract verification, pump/valve/light command and feedback, sequence execution, cable loss to PLC safe state, and controlled recovery. Until then, runtime protocol implementation is real but target-hardware compatibility remains unverified.
