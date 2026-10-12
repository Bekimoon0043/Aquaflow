# Siemens S7-1200 independent-programming feasibility audit

**Date:** 2026-09-21  ·  **Scope:** `aquaflow/backend`, `aquaflow/tools/tia-openness-bridge`, `aquaflow/frontend`, `aquaflow/docs`
**Method:** static code review, execution of the existing Siemens/S7 test suites against the repository's own
fake servers, inspection of the development machine, and public protocol/toolchain documentation.
**Not done (by instruction):** no production code was changed, no PLC was contacted, no S7 write was sent.

## 0. Verdict (read this first)

**Fully independent programming of the supported classic S7-1200 CPUs (CPU 1211C/1212C/1214C/1215C/1217C,
6ES7 21x-1xx40-0XB0, firmware V4.x) — hardware configuration + compilation + download — without TIA Portal,
TIA Openness or any Siemens engineering software is NOT currently feasible with a verified, legally usable
toolchain.** The blocker is not AquaFlow code quality; it is that three required components are Siemens-proprietary
and undocumented:

1. the executable block format the S7-1200 CPU loads (what TIA's compiler emits from SCL/LAD/FBD);
2. the hardware-configuration/system-data format and the hardware catalogue (HSP) data it is built from;
3. the S7CommPlus **PG** services (block download, hardware download, RUN/STOP) with their integrity/anti-replay
   (FW V4.0–V4.4) and TLS + certificate/password (FW ≥ V4.5) protection.

Every open implementation that exists (snap7, python-snap7, libnodave, the `s7commplus` PyPI library) covers **HMI-level
data access only**. snap7's own compatibility table marks *Block Upload/Download/Delete*, *Control Run/Stop*, *Security*
and *Directory* as unsupported on S7-1200/1500 and states that PG operations require the extended protocol it does
not cover. Reproducing those services would require reverse engineering Siemens firmware/TIA and the use of Siemens'
secret key material published by security researchers, which is neither a verified nor a legally usable basis for a
commercial product.

What AquaFlow **does** have, and what can be demonstrated on a real S7-1200 without TIA on the day, is the
**runtime side**: PROFINET DCP discovery, S7comm identity (order number / firmware / station name), read-only
verification of a data block, and the handshake-protected command runtime — **provided the CPU already carries a
program that somebody downloaded with TIA Portal.** Everything in this repository that says "generate / compile /
download" is either a text export for a human to import into TIA, or an orchestration of TIA Portal Openness that
has never been built or executed against a Siemens installation.

Section 5 gives options that genuinely remove TIA from the workflow; none of them is "program a classic S7-1200 with
no Siemens software", and this report does not pretend otherwise.

---

## 1. Capability audit of the current codebase

Legend: **VERIFIED-FAKE** = implemented and passing automated tests, but only against repository fakes;
**SOURCE-ONLY** = produces text for another tool; **TIA-ORCH** = orchestrates TIA Openness; **UNBUILT** = code exists
| Capability | Where | Status | Evidence / notes |
| --- | --- | --- | --- |
| Discovery — PROFINET DCP Identify-All (L2) | `engine/profinet_dcp.py`, `engine/net_adapters.py` | VERIFIED-FAKE | Identify service only (no Set/Get/Signal). Windows transport = Npcap `wpcap.dll` via ctypes; Npcap is **not** bundled and **not installed on this machine**. Tests use `FakeEthernetProvider`. |
| Discovery — IP sweep + protocol probe | `engine/controller_identify.py`, `engine/network_scanner.py`, `engine/discovery_jobs.py` | VERIFIED-FAKE | S7 promoted to "configurable PLC" only after a validated S7comm handshake. |
| Identity — COTP + S7comm setup + SZL 0x0011/0x001C | `engine/s7_identify.py` | VERIFIED-FAKE | Strict field validation; yields order number, HW/FW version, module/PLC name. Profiles rack0/slot1 then rack0/slot2. Tests vs `FakeS7Server`. |
| Runtime — S7comm (0x32) Read/Write Var on non-optimized DBs | `engine/s7_client.py`, `plc/plc_engine.py::SiemensS7Driver` | VERIFIED-FAKE | Raw client is the always-available path; python-snap7 "preferred" but **not installed**. Requires PUT/GET permitted + non-optimized DB — both are **TIA-side CPU/DB settings**. |
| Runtime — read-only verification (heartbeat must move) | `engine/plc_verify.py`, `POST /api/plc/verify-s7`, `plc/s7_profiles.py` | VERIFIED-FAKE | Classifies access-denied / missing DB / optimized-or-short DB / static heartbeat. |
| Runtime — armed show playback via command DB contract | `engine/siemens_runtime.py`, `engine/siemens_site.py`, `api/routes/siemens_sites.py` | VERIFIED-FAKE | Contract `aquaflow-siemens-site-v1` (212-byte DB ≥ 100): magic, heartbeat, permit, signature, BUSY/RUN flags, sequence/ack handshake, 16 pump UINTs, 512 valve bits. Safety-kernel permit, single-owner lock, OFF handshake. |
| Code generation — SCL text | `services/siemens_tia_package.py`; `docs/plc/AquaFlowIO.db` + `AquaFlow_Main.scl` | SOURCE-ONLY | Two **different** DB contracts: `aquaflow-s7-1215c-v1` (DB1, manual TIA walkthrough) and `aquaflow-siemens-site-v1` (DB≥100, Openness path). SCL is never parsed, type-checked or compiled by AquaFlow; only string-tested. |
| Hardware configuration | `siemens_site.py::tia.*`, bridge `Device.CreateWithItem` / `PlugNew` | TIA-ORCH / UNBUILT | Operator types TIA-catalogue `TypeIdentifier` strings; AquaFlow hands them to Openness. No independent catalogue, slot/address model or system-data generation. |
| Compilation | `services/siemens_openness.py::compile_project` → bridge `ICompilable.Compile()` | TIA-ORCH / UNBUILT | No AquaFlow compiler exists. |
| Download to CPU | `services/siemens_openness.py::download` → bridge `DownloadProvider.Download(PN/IE)` | TIA-ORCH / UNBUILT | No AquaFlow download path exists (S7comm client has no block/PG services). |
| Online diagnostics | bridge `OnlineProvider` | TIA-ORCH / UNBUILT | — |
| CPU RUN/STOP, memory reset, DCP Set, time sync, block upload | — | NONE | Deliberately absent; S7-1200 refuses S7comm PLC-control anyway (§3). |
| S7CommPlus (0x72) client of any kind | — | NONE | Only classic S7comm is implemented. |

### 1.1 Test evidence actually executed for this audit

`pytest tests/test_siemens_site.py tests/test_s7_identify.py tests/test_s7_client.py tests/test_s7_profile_contract.py
tests/test_profinet_dcp.py tests/test_profinet_dcp_windows.py tests/test_plc_support.py` → **108 passed**.
All S7 traffic in these tests terminates at `engine/fake_s7_server.py` on 127.0.0.1; all Openness calls terminate at
`FakeOpennessBridge` (a Python stub returning canned `ok: true`); DCP frames are constructed in-process. **No test in
the repository has ever talked to a Siemens CPU.** `CURRENT_STATUS.md` (lines 276–278, 489) says the same: S7 has
"only been exercised against the fake servers" and is "not yet verified on" the purchased 1215C. The only packet
captures in the repo (`aquaflow/olympia.pcap`, `kitfolder/ican_map.pcapng`) are I-CAN gateway captures, not S7.

### 1.2 Development-machine facts (checked 2026-09-21)

* `C:\Program Files\Siemens\Automation` — absent (no TIA Portal, no PublicAPI, no Openness).
* `aquaflow/tools/tia-openness-bridge/` contains only `Program.cs`, `.csproj`, `build.ps1`, `README.md` — **no `bin/`**;
  the bridge has never been compiled here. The unit test that "covers" it
  (`test_openness_bridge_round_trips_cyclic_ob_and_recompiles_before_download`) string-matches the C# source; it does
  not compile or run it.
* `snap7` and `asyncua` are not importable in the backend venv; Npcap is not installed.
* A `dotnet` SDK exists, but the bridge targets .NET Framework 4.8 + `Siemens.Engineering.dll` (never redistributable).


but has never been compiled/run against its real dependency; **NONE** = not implemented.

---

## 2. Every TIA Portal / TIA Openness / Siemens-software dependency

| # | Component | Kind of dependency | Consequence for the requirement |
| --- | --- | --- | --- |
| D1 | `aquaflow/tools/tia-openness-bridge/Program.cs`, `.csproj`, `build.ps1`, `README.md` | **Hard.** References `Siemens.Engineering.dll` from `Portal Vxx\PublicAPI`; uses `TiaPortal`, `Project`, `Device.CreateWithItem`, `PlcExternalSource.GenerateBlocksFromSource`, `ICompilable`, `DownloadProvider`, `OnlineProvider`. Needs licensed STEP 7 Basic/Professional + Openness option + "Siemens TIA Openness" Windows group. | Entire engineering path (project / compile / download / diagnostics) is TIA. |
| D2 | `backend/services/siemens_openness.py` (`OpennessBridge`, `SiemensEngineeringService`) | **Hard.** Locates the bridge exe and the installed PublicAPI, checks Windows group membership, sends `generate` / `compile` / `download` / `diagnostics` requests. Fails closed without TIA. | The only implemented "compile" and "download" in the product. |
| D3 | `backend/api/routes/siemens_sites.py` — `GET /engineering/status`, `GET /{sid}/engineering/status`, `POST /{sid}/engineering/{generate,compile,download,diagnostics}` | **Hard** (delegates to D2). | Public API surface is TIA-shaped. |
| D4 | `backend/engine/siemens_site.py::_tia_defaults / validate_site` | **Data model.** Persists `tia.version` (17–21), `project_name`, `device_name`, `cpu_name`, `cpu_type_identifier` (must start `OrderNumber:` — the TIA catalogue format), `modules[].type_identifier`, `network_interface` (Siemens PG/PC name). | Site schema assumes TIA catalogue semantics. |
| D5 | `backend/services/siemens_tia_package.py` | **Soft (workflow).** Emits SCL/DB external sources + README that instruct "Import … in TIA Portal", "Compile hardware/software in TIA". `CYCLIC_OB_REQUIREMENT.generation_method` describes an Openness SimaticML round-trip. | Output is only consumable by TIA. |
| D6 | `frontend/src/components/panels/SiemensSitePanel.jsx` | **UI.** "TIA Portal Openness: READY/NOT READY" box, TIA version / TypeIdentifier / PG-PC interface fields, "Generate TIA project", "Compile with Siemens", "Download to PLC", "Export TIA package (.zip)". | Operator workflow is TIA-centric. |
| D7 | `docs/SIEMENS-TIA-OPENNESS-INTEGRATION.md`, `docs/plc/TIA_WALKTHROUGH.md`, `docs/SIEMENS-SITE-COMMISSIONING.md`, `tmp/pdfs/s7-new-site/build_guide.py` (→ `output/pdf/AquaFlow-Siemens-S7-1200-New-Site-Guide.pdf`) | **Documentation.** All prescribe TIA Portal for hardware config, PUT/GET enabling, DB numbering, download. | — |
| D8 | `plc/s7_profiles.py` requirements, `engine/plc_verify.py` outcome texts, `docs/S7_DB_CONTRACT.md` | **Implicit.** "PUT/GET must be permitted", "DB1 must be NON-OPTIMIZED", "DB1 is not downloaded" — all are properties that can **only** be set through Siemens engineering software. | Runtime is TIA-*independent* but TIA-*preconditioned*. |
| D9 | `python-snap7` (optional, commented out in `requirements.txt`) | **None on TIA**, but it is also HMI-level only (see §3). | Does not help with programming. |

Nothing in the runtime path (`s7_client.py`, `s7_identify.py`, `profinet_dcp.py`, `siemens_runtime.py`) imports or
shells out to Siemens software. That is the honest boundary: **AquaFlow can talk to a programmed S7-1200 without TIA;
it cannot program one.**

---

## 3. Feasibility of an independent, legally usable engineering toolchain

### 3.1 What "programming an S7-1200" actually requires on the wire

| Step | Protocol / artefact on classic S7-1200 (FW V4.x) | Public spec? | Open implementation? |
| --- | --- | --- | --- |
| Find CPU, set IP / station name | PROFINET DCP Identify / **Set** (IEC 61158-6-10) | Yes (IEC, PI) | Yes — AquaFlow has Identify; Set is straightforward and standards-based. |
| Read identity (order no., FW) | S7comm SZL 0x0011/0x001C, or S7CommPlus | De-facto (Wireshark dissector) | Yes — AquaFlow has it. |
| Hardware configuration | TIA hardware catalogue (HSP) → proprietary system-data objects downloaded with the program | **No** | **No** |
| Compile SCL/LAD → CPU-executable blocks | TIA compiler; S7-1200 block object format | **No** | **No** (no open compiler emits S7-1200 executable objects) |
| Download blocks + HW config | **S7CommPlus (0x72) PG services**, protected by: V4.0–V4.4 integrity/anti-replay; **V4.5+ TLS 1.3 with CPU certificate + password-derived key** | **No** | **No** — snap7's own table: Block Upload/Down/Delete, Control Run/Stop, Security, Directory unsupported on 1200/1500; the `s7commplus` PyPI library implements DB/tag read-write sessions only, is "unofficial", and derives its session authentication from HarpoS7 (reverse-engineered key material). |
| CPU STOP/RUN, memory reset | S7CommPlus PG service | **No** | **No** |
| Cyclic data exchange afterwards | S7comm Read/Write Var (needs PUT/GET enabled + non-optimized DB) or S7CommPlus symbolic | De-facto | Yes — AquaFlow (S7comm) / `s7commplus` (data only). |


### 3.2 Legal / licensing assessment (engineering view, not legal advice)

* **Siemens.Engineering.dll (Openness)** is licensed only with TIA Portal; the existing bridge is correct not to
  redistribute it — and therefore it cannot ship as part of a TIA-free product.
* **Reverse-engineered S7CommPlus PG download** would depend on Siemens firmware/TIA internals disclosed by security
  research (the S7-1200/1500 key-extraction disclosures that Siemens answered with TLS in FW V4.5 / V2.9). Shipping a
  product that authenticates to customer CPUs with leaked Siemens key material, or that bypasses CPU access protection,
  is neither "verified" nor "legally usable"; it also fails on any CPU ≥ V4.5 with protection enabled and voids
  Siemens support for the installation.
* **snap7 / python-snap7** and a from-scratch S7comm client are legitimate — AquaFlow already uses the latter — but only
  for data access.
* **SIMATIC AX** (Siemens' TIA-free, VS-Code-based toolchain: `apax build`, `apax hw_compile`, HSP/HWC packages) is
  legitimate and licensed separately from TIA Portal, but (a) it is still Siemens engineering software under a
  subscription, and (b) its S7-1200 support is **S7-1200 G2 only** (e.g. CPU 1212C 6ES7 212-1AG50-0XB0, CPU 1214C
  6ES7 214-1AH50-0XB0, FW V4.1 G2). It does **not** target the classic 6ES7 21x-1xx40 CPUs in AquaFlow's catalogue,
  `s7_profiles.py` or `supported_s7_1200_identifier()`. It cannot satisfy the requirement as worded.
* **SIMATIC memory card (program/transfer card):** S7-1200 loads a program from a card, but the card is written by TIA
  Portal — it moves *where* TIA runs, not *whether*.

### 3.3 Conclusion

There is **no verified, legally usable toolchain — open-source, third-party or Siemens-supplied — that configures,
compiles and downloads a program to a classic S7-1200 CPU without TIA Portal**. The requirement, as stated, cannot be
met today for the CPUs AquaFlow supports. The remaining engineering choices are in §5 and §6.

---

## 4. CPU / firmware compatibility matrix

Scope = what AquaFlow can do **from its own code** (no Siemens software on the AquaFlow PC). "Runtime" means the DCP →
S7comm identify → read-only verify → armed command-DB path. "Program" means configure + compile + download.

| CPU family / order numbers | Firmware | Runtime (S7comm, needs PUT/GET + non-optimized DB set by TIA) | Identity (SZL 0x0011/0x001C) | Program without TIA | Notes |
| --- | --- | --- | --- | --- | --- |
| S7-1200 classic: CPU 1211C/1212C/1214C/1215C/1217C — 6ES7 211/212/214/215/217-1xx40-0XB0 (incl. bench 6ES7215-1AG40-0XB0) | V4.0 – V4.4 | **Supported (unverified on hardware)** | Supported (unverified) | **Not possible** — PG services are S7CommPlus with integrity protection; no open, lawful implementation. | This is the family AquaFlow targets (`_SUPPORTED_S7_1200`, `s7_profiles.py`, `controller_catalog.py`). |
| S7-1200 classic, same order numbers | **V4.5 – V4.7** | **Supported (unverified)** — PUT/GET is still a CPU option on classic V4.5+ | Supported (unverified) | **Not possible** — PG channel is TLS 1.3 + CPU certificate + password; strictly Siemens-only. | Newly shipped 1215C stock is typically V4.5+. Confirm the label / SZL before planning. |
| S7-1200 classic, FW V4.x with "Full access incl. fail-safe" or PUT/GET **disabled** | any | **Not supported** — S7comm Read/Write Var is refused (item code 0x03 ACCESS_DENIED). | S7comm handshake may still succeed; SZL may be refused. | Not possible | AquaFlow would need an S7CommPlus data client (only data, still not programming). |
| S7-1200 classic with **optimized** command DB | any | **Not supported** by design — absolute addressing unavailable (`OPTIMIZED_OR_SHORT_DB`). | — | — | Contract requires `S7_Optimized_Access := 'FALSE'`. |
| **S7-1200 G2**: CPU 1212C/1214C/1215C… — 6ES7 21x-1xx**50**-0XB0 | V4.1 (G2) | **Unknown / probably not** — G2 is S7CommPlus-first; classic PUT/GET availability must be confirmed on hardware. | Unknown | **Only with Siemens SIMATIC AX** (TIA-free but Siemens-licensed). | Out of AquaFlow's declared scope; the only route to "no TIA Portal" that is lawful. |
| S7-1500 | V2.x/V3.x | Supported (unverified) when PUT/GET + non-optimized DB | Supported (unverified) | Not possible (same S7CommPlus PG protection) | Same driver; catalogue lists it. |
| S7-300 / S7-400 (legacy) | any | Supported (unverified), rack 0 slot 2 | Supported (unverified) | Technically feasible via snap7 block download (classic S7comm PG functions) — **but** these CPUs are not S7-1200, are discontinued, and Siemens STEP 7 is still required to *compile* MC7 blocks. | Not a route to the requirement. |
| Any CPU behind CP 1243/1543, or with access level "No access" | any | Not supported | — | — | — |

**Firmware determination:** `s7_identify.py::parse_szl_0011` already decodes `firmware_version` (index 7). The
first bench action (§7, T1) is to record this value; the V4.4/V4.5 boundary decides which protection regime applies.


---

## 5. Missing technical components (for each conceivable route)

### 5.1 Route R0 — "program a classic S7-1200 with zero Siemens software" (the literal requirement)

| Missing component | Exists anywhere lawfully? | Effort / risk |
| --- | --- | --- |
| S7-1200 hardware catalogue (module types, slot rules, I/O address ranges, parameter records) | No — HSP data is Siemens-proprietary | Would need to be hand-derived per module from manuals; system-data encoding still unknown. |
| System-data (hardware config) object encoder | No | Reverse engineering only. |
| SCL → S7-1200 executable block compiler | No | Reverse engineering only; block format changes with firmware. |
| S7CommPlus PG client: session with integrity/anti-replay (V4.0–4.4) or TLS + certificate + password (≥ V4.5), block download, HW download, STOP/RUN, memory reset | No lawful implementation | Requires leaked/derived Siemens keys; blocked on ≥ V4.5 with protection. |
| Verification that a self-made program is what the CPU runs (checksum/consistency) | No | — |

**Assessment: not feasible.** Recommend the team formally records that R0 is infeasible for classic S7-1200 and
re-scopes the requirement (R1–R3 below).

### 5.2 Route R1 — TIA-free **runtime**, TIA-once **provisioning** (what the codebase almost is today)

Missing to make the runtime honest and demonstrable on real hardware without TIA on the AquaFlow PC:

1. **Real-hardware verification** of `s7_identify.py`, `s7_client.py`, `plc_verify.py`, `siemens_runtime.py`
   (never done — §1.1). Capture and archive a pcap as the I-CAN work did.
2. **DCP Set (IP / station name)** — a standards-based, TIA-free way to give a factory-fresh CPU an IP. Currently only
   Identify exists (`profinet_dcp.py`). Needs Npcap on Windows; must be gated behind explicit operator confirmation.
3. **One DB contract, not two.** `aquaflow-s7-1215c-v1` (DB1, `docs/plc/`) and `aquaflow-siemens-site-v1` (DB≥100,
   `siemens_site.py`) are different layouts with different heartbeat offsets (DBW0 vs DBW2). Pick one; retire the other.
4. **Program-identity check before writes** — `siemens_runtime._header` checks magic + site signature; extend with the
   SZL order number / FW recorded at commissioning so a swapped CPU is refused.
5. **Firmware-aware capability report** — surface `firmware_version` in the UI and refuse the runtime when PUT/GET is
   evidently off (0x03) with a message that names the TIA setting, instead of "connection failed".
6. **Optional S7CommPlus data client** (e.g. the MIT `s7commplus` package) as a *second* data transport for CPUs where
   the customer will not enable PUT/GET. Data only; still needs a bench qualification; still not programming.
7. **Rename / re-label** the engineering endpoints and UI so "compile" and "download" are never shown as AquaFlow
   capabilities on a PC without TIA (today the UI already says NOT READY, which is honest, but the API names remain).

### 5.3 Route R2 — TIA Openness automation (already coded, **unbuilt**, **TIA-dependent**)

This route **does not satisfy the requirement** and is listed only so the team knows what state it is in: bridge never
compiled; `Device.CreateWithItem` + `PlugNew` + `GenerateBlocksFromSource` + SimaticML round-trip + `DownloadProvider`
callbacks are all unexecuted against any Siemens release; needs licensed TIA + Openness on the engineering PC.

### 5.4 Route R3 — Siemens SIMATIC AX for **S7-1200 G2** (TIA-free, Siemens-licensed, different CPUs)

Missing: purchase of G2 CPUs (6ES7 21x-1xx50) and an AX subscription; an `apax`-based generator replacing
`siemens_tia_package.py` (ST source + `.hwl.yml` hardware templates); `apax hw_compile` / build / download
orchestration replacing `siemens_openness.py`; confirmation on hardware that AquaFlow's S7comm runtime (or an
S7CommPlus data path) works against G2. This is the only route that removes TIA Portal *and* stays lawful — but it
is not TIA-independent in the sense of "no Siemens software", and it changes the hardware target.

---

## 6. Proposed architecture and implementation plan

### 6.1 Architecture (R1 as the product path; R3 as the future TIA-free engineering path)

```
                 ┌──────────────────────────── AquaFlow PC (no Siemens software) ────────────────────────────┐
                 │  Discovery      Identity        Provision (new)     Verify (RO)      Runtime (armed)       │
                 │  DCP Identify → S7 SZL 0011/1C → DCP Set IP/name  → plc_verify     → siemens_runtime      │
                 │  (Npcap)        (S7comm)         (Npcap, gated)      (S7comm)         (S7comm / S7C+ data) │
                 │                     │                                    ▲                                 │
                 │                     └── firmware/order no. ──► capability gate ── refuses PUT/GET-off etc. │
                 └──────────────────────────────────────────────────────────────────────────────────────────┘
                                                        │  reads/writes ONE non-optimized command DB
                                                        ▼
                                         ┌──────────────────────────┐
                                         │  S7-1200 CPU (classic)   │  program = AquaFlow-generated SCL/DB
                                         │  PUT/GET on, DB≥100      │  loaded ONCE by a controls engineer
                                         └──────────────────────────┘
                                                        ▲
   Engineering PC (separate, Siemens-licensed) ─────────┘
     • today: TIA Portal (manual import of AquaFlow package)   • optional later: Openness bridge (R2)
     • S7-1200 G2 sites: SIMATIC AX (R3) — no TIA Portal, still Siemens
```

Key rule: **the engineering PC is never assumed to be the AquaFlow PC**, and no AquaFlow feature label may say
"compile"/"download" unless a Siemens toolchain is actually present and reported by `engineering/status`.


### 6.2 Implementation plan (R1 — no production code touched by this audit; these are proposals)

| Phase | Work item | Files (proposed) | Exit criterion |
| --- | --- | --- | --- |
| P0 — Decision | Team accepts that R0 is infeasible; re-words the requirement to "AquaFlow runtime, discovery and provisioning must not depend on TIA; program load is a documented one-time controls-engineer step (TIA or, for G2 hardware, SIMATIC AX)". | — | Signed decision recorded in `CURRENT_STATUS.md`. |
| P1 — Truth in labelling | Rename engineering endpoints/UI to make TIA dependency explicit (`/engineering/tia/*`); hide compile/download buttons unless `engineering/status.available`. Add `firmware_version`, `order_number` to Siemens-site status. | `api/routes/siemens_sites.py`, `SiemensSitePanel.jsx`, `siemens_runtime.py::status` | No screen on a Siemens-free PC shows AquaFlow "compiling" or "downloading". |
| P2 — One contract | Retire `aquaflow-s7-1215c-v1`/DB1 (or `aquaflow-siemens-site-v1`); regenerate `docs/plc/*` from the single generator; update `plc_verify` outcome texts. | `plc/s7_profiles.py`, `services/siemens_tia_package.py`, `docs/S7_DB_CONTRACT.md`, `docs/plc/` | One heartbeat offset, one DB number rule, tests asserting doc ⇄ code. |
| P3 — Provisioning | Add DCP **Set** (IP/mask/gateway, station name) with explicit operator confirmation, MAC-pinned target, one frame per request, and a read-back Identify. | `engine/profinet_dcp.py` (+ new `dcp_set.py`), `api/routes/controllers.py`, tests vs `FakeEthernetProvider` | Factory-fresh CPU gets an IP from AquaFlow on the bench (T3). |
| P4 — Hardware qualification of runtime | Execute §7 on the purchased 1215C; archive pcaps; fix any framing/timing defects; flip nothing until T1–T8 pass. | `docs/SIEMENS-HARDWARE-EVIDENCE.md` (new), pcaps under `kitfolder/` | Signed commissioning record. |
| P5 — CPU identity pinning | Store SZL order number + FW + serial at commissioning; `verify` refuses a different CPU. | `engine/siemens_site.py`, `engine/siemens_runtime.py` | Swapping the CPU makes Verify fail with a named reason. |
| P6 — Optional S7CommPlus data transport | Evaluate the MIT `s7commplus` package on the bench for customers who refuse PUT/GET. Data only; must pass the same fake-server + hardware gates. | `engine/s7plus_client.py` (new), `plc/plc_engine.py` | Bench evidence or an explicit "not adopted" note. |
| P7 — TIA-free engineering for G2 (R3, only if the team buys G2 CPUs) | `apax` project generator (ST + `.hwl.yml`), build/hw_compile/download orchestration, status reporting. | `services/siemens_ax.py` (new), `tools/ax-project-template/` | AX-built program downloaded to a G2 CPU from a licensed AX PC; AquaFlow runtime verified against it. |

Not proposed: building the Openness bridge (R2) — the team can keep the code, but it cannot count toward this
requirement and should not consume effort before P0–P5 are done.

---

## 7. Real-hardware test plan (safe commissioning, no water until T14)

**Bench:** CPU 1215C DC/DC/DC (6ES7215-1AG40-0XB0) + PM 1207 (+ SM 1222 DQ16 if fitted), isolated Ethernet switch,
AquaFlow PC with Npcap installed, Wireshark capturing on the AquaFlow NIC for every test, **no pumps, valves or VFD
wired — outputs go to indicator LEDs / a relay board only.** A second, Siemens-licensed PC (TIA Portal) is used
exactly once (T5) by the controls engineer and is then disconnected.

| # | Test | AquaFlow action (no Siemens software on this PC) | Pass criterion | Evidence |
| --- | --- | --- | --- | --- |
| T1 | Firmware/identity baseline | `Discovery → Controllers` on the bench adapter | SZL 0x0011 order number matches the CPU label; `firmware_version` recorded (decides V4.4/V4.5 regime); station name from DCP | pcap + JSON of `DetectedController` |
| T2 | DCP Identify on a CPU **without IP** (factory reset) | DCP scan | CPU appears by MAC with empty IP | pcap |
| T3 | DCP Set (after P3) | Assign bench IP to the MAC from T2, then re-Identify | CPU answers Identify with the new IP; TCP 102 opens | pcap |
| T4 | Negative: unprogrammed CPU | `POST /api/plc/verify-s7` | Outcome `missing_db` (or `access_denied` if PUT/GET is off by default) with the exact reason text — proves the verifier does not fake success | JSON |
| T5 | **One-time program load** (controls engineer, TIA PC) | Import the AquaFlow package, set DB number, PUT/GET on, non-optimized DB, 100 ms cyclic OB, CPU → RUN, then disconnect the TIA PC | TIA watch table shows heartbeat counting | Photo/screenshot, signed |
| T6 | Read-only verify on programmed CPU | `verify-s7` / Siemens-site **Verify** | `verified`; heartbeat moves; magic 0xAF02 and site signature match; `hardware_verified: true` | JSON + pcap |
| T7 | Negative: CPU in STOP | Put CPU to STOP | Verify returns `heartbeat_static`; runtime raises "heartbeat is not moving" | JSON |
| T8 | Negative: wrong rack/slot, wrong DB, optimized DB | Edit site to a DB that does not exist; use a second optimized DB | `missing_db`, `optimized_or_short_db`, `wrong_rack_slot` respectively — all *before* any write | JSON |


| T9 | Arm (OFF handshake) with LEDs only | Safety Monitor permits on; **Arm** | Sequence/ack round-trip completes; PLC reports RUN=0; no output LED lit | pcap shows Write Var to DBW18/DBW16 only |
| T10 | Single-outlet test, 3 s, LEDs | **Test outlet** on valve 1 | Exactly one valve LED for 3 s; pump AO ≤ 10 % on a meter; auto OFF; ack sequence advances | video + pcap |
| T11 | Watchdog | Pull the Ethernet cable mid-outlet test | PLC outputs drop within ~1 s (10 missed cycles); AquaFlow reports "Stop unconfirmed" | video + pcap |
| T12 | Permit withdrawal | Open the E-stop input during T10 | PLC clears outputs immediately; AquaFlow reports "Safety permit withdrawn"; restart needs new Verify/Arm | video |
| T13 | Full 60-s bench show, LEDs | Compile example, Start | Valve LEDs step every 15 s; pump AO 30 % only while an outlet is open; STOP disarms | video + pcap |
| T14 | Water, attended (site only, after T1–T13 signed) | Repeat T10 → T13 with real actuators at commissioning limits | Observed physical response recorded per channel (`observation`, `commissioned`) | Site record |

**Rules:** every test is captured; a failed negative test (T4, T7, T8) is a release blocker even if positive tests
pass; nobody alters CPU protection, passwords or access level from AquaFlow (it cannot, and must not try).

---

## 8. Exactly what can be demonstrated on a real S7-1200 without TIA Portal

**On a PC with no Siemens software at all:**

1. Find the CPU by PROFINET DCP, including one with no IP (needs Npcap).
2. Read its order number, hardware/firmware version, PLC/station name via S7comm SZL.
3. (After P3) give it an IP address and station name via DCP Set.
4. Prove, read-only, whether an AquaFlow-contract program is present, running (heartbeat), and correctly numbered /
   non-optimized — and name the exact TIA setting that is wrong when it is not.
5. Arm, run, single-outlet-test and stop a show through the sequence/ack command DB, with watchdog and permit behaviour.

**Not demonstrable without TIA Portal (or, for G2 hardware only, SIMATIC AX):** putting any program or hardware
configuration onto the CPU, enabling PUT/GET, creating or renumbering the DB, setting the CPU to RUN/STOP, changing
protection. Items 4–5 above therefore only work on a CPU that a controls engineer has loaded once with TIA.

**Not demonstrable today at all (never executed on hardware):** every item above — all evidence in this repository is
against `fake_s7_server.py` / `FakeEthernetProvider` / `FakeOpennessBridge`. §7 T1–T13 is the minimum to change that.

---

## 9. Summary statement for the project team

> AquaFlow cannot independently program the supported classic Siemens S7-1200 CPUs without TIA Portal, and no
> verified, legally usable third-party toolchain exists that can. The blocker is Siemens' undocumented executable block
> format, hardware-configuration data and protected S7CommPlus PG download services. The codebase's "generate / compile
> / download" features are (a) SCL text for a human to import into TIA and (b) an unbuilt, untested TIA Openness
> orchestration — neither satisfies the requirement, and this report does not present them as doing so. What AquaFlow
> can honestly own without TIA is discovery, identity, provisioning (after adding DCP Set), read-only verification and
> the armed runtime against a CPU that was programmed once with TIA — and none of that has yet been exercised on real
> hardware. The recommended path is to re-scope the requirement (§5.2/§6.2), qualify the runtime on the bench (§7),
> and evaluate SIMATIC AX with S7-1200 G2 hardware if a TIA-Portal-free engineering path is a firm business need.

