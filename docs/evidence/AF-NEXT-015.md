# AF-NEXT-015 evidence: controlled integration and commissioning

Date: 2026-10-13. This ticket ran software simulation, protocol loopback and PLC simulator tests only. It did not connect to a physical controller, target the fountain subnet, arm an output, pulse a channel, start a show, set `AQUAFLOW_HARDWARE_COMMISSIONED`, or claim a site is commissioned.

## Outcome

AquaFlow now exposes two independent facts for every controller catalog entry:

- `tier`: whether an enabled AquaFlow driver exists (`REAL`, `GATED`, or `UNSUPPORTED`);
- `verification_level`: the strongest recorded integration evidence (`simulated`, `bench_verified`, `site_commissioned`, or `unsupported`).

The Device Discovery → Controllers view shows both badges on catalog entries and discovered controllers. Expanding a catalog row shows the evidence scope and the remaining physical work. A newly discovered endpoint is still `unverified` and has no invented health value. Discovery remains read-only.

No entry is currently labeled `site_commissioned`. That level requires an exact installation record plus the signed operator checklist. The global commissioning status remains false.

## Evidence classification shipped in the catalog

| Catalog device/class | Protocol | Driver tier | Verification label | Evidence boundary |
| --- | --- | --- | --- | --- |
| I-CAN music fountain + NETCAN gateway | I-CAN | REAL | **bench verified** | This PC operated the specific `192.168.5.2` gateway/fountain path, including shortened capture, one-minute demo and Stop/blackout. Exact outlet/electrical mapping and signed full-site commissioning remain pending. A detected I-CAN gateway at any other IP is downgraded to **simulated**. |
| Siemens S7-1200 | S7comm | REAL | **simulated** | PLCSIM/S7comm identity and contract reads; no signed physical CPU/I/O/actuator run. |
| Siemens S7-1500 | S7comm | REAL | **simulated** | Same simulator evidence; exact hardware not signed off. |
| Siemens S7-300/400 | S7comm | REAL | **simulated** | Same driver/simulator evidence; exact legacy rack not signed off. |
| Generic Modbus TCP server | Modbus TCP | REAL | **simulated** | Scripted software server and protocol tests only. |
| Advantech ADAM-6000 | Modbus TCP | REAL | **simulated** | Driver-family tests only; no exact module record. |
| Moxa ioLogik E1200 | Modbus TCP | REAL | **simulated** | Driver-family tests only; no exact module record. |
| Schneider Modicon | Modbus TCP | REAL | **simulated** | Driver-family tests only; no exact PLC record. |
| Delta DVP/AS through Modbus TCP | Modbus TCP | REAL | **simulated** | Generic Modbus route only; native Delta protocol remains unavailable. |
| WAGO 750 Modbus coupler | Modbus TCP | REAL | **simulated** | Driver-family tests only; no exact coupler record. |
| Art-Net node / DMX gateway | Art-Net | REAL | **simulated** | Live UDP loopback packet output, safety zeroing and timing; no physical node/fixture sign-off. |
| sACN receiver | sACN | REAL | **simulated** | Live UDP loopback packet output, safety zeroing and timing; no physical receiver/fixture sign-off. |
| OASE WECS III native surface | proprietary / DMX-only workaround | UNSUPPORTED | **unsupported** | No native AquaFlow driver; use a separately commissioned Art-Net/DMX gateway where applicable. |
| Safe-Rain native controller surface | proprietary / DMX-only workaround | UNSUPPORTED | **unsupported** | No native AquaFlow driver; use a separately commissioned Art-Net/DMX gateway where applicable. |
| Allen-Bradley Logix | EtherNet/IP | REAL | **simulated** | cpppo simulator connect/identity/read evidence; writes unit-tested, no physical Logix sign-off. |
| OPC UA server | OPC UA | REAL | **simulated** | asyncua software server sessions and typed reads/writes; no physical PLC/server sign-off. |
| Mitsubishi MELSEC native MC | MC protocol | GATED | **unsupported** | Native driver unavailable; a unit explicitly configured for Modbus TCP can use the generic Modbus path. |
| Omron native FINS | FINS | GATED | **unsupported** | Native driver unavailable; a unit explicitly configured for Modbus TCP can use the generic Modbus path. |
| Beckhoff TwinCAT ADS | ADS | UNSUPPORTED | **unsupported** | Identify-only; OPC UA can be used only when the target separately exposes and configures it. |
| Fountain VFD through Modbus TCP | Modbus TCP | REAL | **simulated** | Generic Modbus behavior only; exact drive register map, wiring and physical response are not signed off. |

## Software evidence run

### Hardware-output loopback harness

Command: `python hardware_verification_harness.py`

- Report mode: `loopback_selftest`
- `hardware_commissioned: false`
- `verification_mode: SIMULATED`
- `loopback_checks_passed: true`
- 5 passed, 0 failed, 0 skipped
- Art-Net universe 0 payload passed
- Art-Net high universe 300 passed
- sACN universe 1 payload passed
- output safety gate passed: no-permit output zeroed; permitted output passed
- timing passed: 43.77 Hz measured, 22.848 ms median interval, 22.059 ms minimum interval, within the 44 Hz / 22.668 ms floor contract

This proves the host output path against local UDP receivers. It is not physical fixture evidence.

### PLC/protocol simulator regression

The focused 223-test set passed outside the restricted filesystem sandbox:

`test_hardware_output.py`, `test_ican.py`, `test_ican_discovery_readonly.py`, `test_modbus_client.py`, `test_modbus_identify.py`, `test_plc_libraries.py`, `test_plc_support.py`, `test_s7_client.py`, `test_s7_identify.py`, `test_s7_profile_contract.py`, `test_siemens_devices.py`, and `test_siemens_site.py`.

This includes simulated Siemens acceptance/watchdog/Stop behavior, PLCSIM network-mode labeling, read-only S7 verification, Modbus identification/client behavior, I-CAN read-only discovery, and protocol output loopback. The first sandboxed attempt hit Windows pytest temp-directory permissions; the same unchanged tests passed when rerun with normal temp-directory access.

### New classification tests

- Backend controller catalog: all entries have exactly one allowed evidence level; non-REAL entries are `unsupported`; I-CAN alone is `bench_verified`; no entry is `site_commissioned`; the catalog summary counts every entry.
- Frontend: all four operator labels render exactly, independently of the driver-support badge.

## Physical work still required

An approved site operator must execute [HARDWARE_COMMISSIONING_CHECKLIST.md](../../HARDWARE_COMMISSIONING_CHECKLIST.md) and complete [AF-HUB-011_COMMISSIONING_RECORD.md](../../AF-HUB-011_COMMISSIONING_RECORD.md) for each exact target. Record make/model, firmware, wiring, IP/addressing, latency, output map, blackout/E-stop, watchdog, network loss, restart behavior, and witnessed fixture response. Only a signed record can promote an exact installation to `site commissioned`.

## Files changed

- `aquaflow/backend/engine/controller_catalog.py`
- `aquaflow/backend/engine/controller_identify.py`
- `aquaflow/backend/tests/test_controller_catalog.py`
- `aquaflow/frontend/src/utils/controllerDiscovery.js`
- `aquaflow/frontend/src/components/panels/DeviceDiscoveryPanel.jsx`
- `aquaflow/frontend/src/components/panels/__tests__/ControllersTab.test.js`
- `docs/evidence/AF-NEXT-015.md`
- `HANDOVER.md`
