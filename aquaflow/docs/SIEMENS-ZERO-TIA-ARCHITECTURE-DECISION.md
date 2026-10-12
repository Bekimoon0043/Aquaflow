# AquaFlow Zero-TIA Siemens Engineering — Architecture Decision

> **Historical decision - superseded for the current product direction.** TIA Portal is now the approved engineering tool. AquaFlow operates the commissioned PLC after TIA closes. See `SIEMENS-RUNTIME-ARCHITECTURE.md`.


**Status:** FINAL (investigation complete) · **Date:** 2026-09-22
**Scope:** `aquaflow/backend`, `aquaflow/tools/tia-openness-bridge`, `aquaflow/frontend`, `aquaflow/docs`
**Method:** primary-source review (Siemens product pages, `simatic-ax` GitHub, snap7, PyPI `s7commplus`), plus the existing feasibility audit.
**Constraint honored:** no production code modified, no PLC contacted, no fake success claimed.

---

## 1. Requirement (restated)

AquaFlow must take a supported Siemens S7-1200 CPU that has never been commissioned for
AquaFlow and, **without TIA Portal, TIA Openness, `Siemens.Engineering.dll`, STEP 7, or any
TIA Portal license**, independently:

1. Discover the PLC.
2. Identify the exact CPU, order number, and firmware.
3. Configure the CPU and supported I/O modules.
4. Generate the hardware/system configuration.
5. Generate AquaFlow's PLC control program.
6. Compile the program into the actual executable format the CPU loads.
7. Generate all loadable artifacts.
8. Establish engineering communication for that CPU/firmware.
9. Download hardware configuration and program.
10. Verify the downloaded configuration and program.
11. Transition the PLC to the required operating state.

Capability ladder used throughout: **A** source generation · **B** SCL/ST parsing ·
**C** PLC compilation · **D** executable block generation · **E** hardware-config generation ·
**F** system-data generation · **G** engineering session · **H** PLC download · **I** verification ·
**J** RUN/STOP control. A solution that only performs A, B, runtime-data G/H, or DCP discovery fails.

---

## 2. Existing architecture (what AquaFlow has today)

| Layer | Capability | Status |
|---|---|---|
| DCP Identify | discover CPU by MAC (read-only) | implemented; Windows transport needs Npcap (not bundled) |
| S7comm identity (SZL 0x0011/0x001C) | order number / firmware / station name | implemented (`engine/s7_identify.py`) |
| S7comm Read/Write Var (classic 0x32) | runtime DB access only | implemented (`engine/s7_client.py`) |
| Read-only verification | heartbeat must move, magic/signature match | implemented (`engine/plc_verify.py`, `engine/siemens_runtime.py`) |
| Armed command runtime | contract `aquaflow-siemens-site-v1` (212-byte DB) | implemented (`engine/siemens_runtime.py`) |
| SCL **text** generation | `AquaFlowSiteIO.db`, `AquaFlowSiteControl.scl`, `AquaFlowCycle.scl` | **SOURCE-ONLY** (`services/siemens_tia_package.py`) — never parsed/compiled |
| TIA Openness orchestration | `.NET` bridge over `Siemens.Engineering.dll` | **UNBUILT / UNTESTED** — no `bin/`, no Siemens assembly on this machine |
| Compiler (A→D) | none | **absent** |
| Hardware catalog / config / system-data (E/F) | none — operator types `TypeIdentifier` strings handed to Openness | **absent** |
| Engineering download (H) | none — S7comm client has no PG/block services | **absent** |
| RUN/STOP (J) | deliberately absent | **absent** |

**Conclusion:** AquaFlow performs A (text only), B (absent), runtime-data G/H/I. It performs none of
C, D, E, F, or engineering H/J.

---

## 3. Candidate solutions (summary)

| Candidate | A | B | C | D | E | F | G(eng) | H(eng) | I | J | Zero-TIA? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TIA Openness (R2) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | No (is TIA) | Excluded by requirement |
| **SIMATIC AX** | ✓ | ✓ | ✓ | ✓ | ⚠️ | ⚠️ | ✓ | ⚠️ | ✓ | ✓ | Yes (not TIA) | **Unverified for G2** (§4) |
| snap7 / python-snap7 / libnodave / nodeS7 | – | – | – | – | – | – | ✗ | ✗ | data only | ✗ | Yes | Fails (data-only) |
| `s7commplus` (PyPI, MIT) | – | – | – | – | – | – | ✗ | ✗ | data only | ✗ | Yes | Fails (data-only) |
| OpenPLC / Beremiz / matiec | ✓ | ✓ | ✓ | ✓(C→C) | – | – | – | – | – | – | Yes | Fails (emits C/PLCopen, not Siemens blocks) |
| Codesys | ✓ | ✓ | ✓ | ✓(own runtime) | – | – | – | – | – | – | Yes | Fails (does not emit S7-1200 blocks) |
| Build-from-scratch | ✓ | ✓ | ✓ | **blocked** | ✗ | ✗ | ✗ | **blocked** | partial | **blocked** | Yes | **Not viable** (§7–§9) |

---

## 4. SIMATIC AX — deep investigation

SIMATIC AX is Siemens' TIA-free, VS-Code/CLI-based engineering product line
("SIMATIC AX Logic Control Engineering"). Verified facts from primary sources:

- The product toolchain is **not** open source; GitHub hosts only samples/libraries. The community
  README states *"The actual product toolchain of SIMATIC AX is not hosted within this community space"*
  and *"You may need to order SIMATIC AX."*
- The CLI is **`apax`** (package manager + build + load). `apax.yml` declares dependencies and registers
  `@ax/*` packages from Siemens' product registry (community packages from `npm.pkg.github.com`, key-pinned).
- The **`@ax/sdk: 2405.0.0`** dependency provides engineering tools: **HWC** (Hardware Compiler),
  **HWLD** (Hardware Loader), `apax hw-diag compare`, `plc-info` (Start/Stop over CLI).

Answering the 16 questions (evidence in parentheses):

| # | Question | Finding | Evidence |
|---|---|---|---|
| 1 | Supported S7-1200 CPUs | **G2 only, and not verified.** No S7-1200 appears in AX's `types` library. | `@simatic-ax/types` lists S7-1500 compact + ET 200MP/SP + PROFIdrive only |
| 2 | Firmware | G2 firmware line; exact range **UNVERIFIED** | no primary source found |
| 3 | Configure hardware | **Yes in principle** — YAML `.hwl.yml`, HWC | learning-path `03_hardware_configuration` |
| 4 | Compile PLC logic | **Yes** — ST compiled by `apax build` | `axlp_apax_and_project_creation` |
| 5 | Generates loadable artifacts | **Yes for S7-1500/PLCSIM**; G2 **UNVERIFIED** | `ae-trafficlight` (`apax dlplc`) |
| 6 | Downloads directly | **Yes for user program (S7-1500/PLCSIM)**; G2 **UNVERIFIED** | `ae-trafficlight` |
| 7 | Whole process from uncommissioned CPU | **UNVERIFIED** — HW config still routed through TIA in current examples | ch.04 "TIAX direct loading", `ae-trafficlight` |
| 8 | Without TIA Portal | **Yes for user program; HW config "recommended via TIA"** in examples | ch.04, `ae-trafficlight` |
| 9 | Programmatic invocation | **Yes** — `apax` is a scriptable CLI | ch.03/04 |
| 10 | API/CLI/SDK | **Yes** — `apax` + `@ax/sdk` + `plc-info` | ch.03 |
| 11 | Redistribute vs customer-installed | **Customer-installed.** AX/`@ax/*` are subscription-licensed; must not be redistributed | product page + community README |
| 12 | AX as backend, AquaFlow as UI | **Yes** — AquaFlow generates ST + `.hwl.yml` and drives `apax` | §11 |
| 13 | Auth/subscription/registry/certs | **Yes** — AX license + package registry auth; certificates/user mgmt via HWC | ch.03 |
| 14 | Fully offline after install | **UNVERIFIED** — must be confirmed on the bench | no primary source found |
| 15 | Supports current target hardware | **No.** Current target is classic G1 (6ES7 21x-1xx40); AX does not cover it | `types` repo + audit |
| 16 | Commercial use | **Yes** with a valid AX subscription; it is Siemens-licensed software (TIA-free, not Siemens-free) | product page |

### A–J evidence matrix for S7-1200 G2

Legend: ✅ verified from a primary source · ⚠️ partial/conditional · ❌ **UNVERIFIED**

| Item | Capability | AX component | No-TIA? | Automatable | On real HW | Verdict |
|---|---|---|---|---|---|---|
| A | Discover PLC | AquaFlow native (DCP Identify) | ✅ | ✅ | ⚠️ not on G2 | ✅ (AquaFlow) |
| B | Identify CPU/FW | AquaFlow native (S7comm SZL) | ✅ | ✅ | ⚠️ not on G2 | ✅ (AquaFlow) |
| C | Configure CPU + I/O | HWC (`@ax/sdk`) | ⚠️ (examples still use TIA) | ✅ | ❌ | ❌ UNVERIFIED for G2 |
| D | Generate HW/system config | HWC + `.hwl.yml` | ⚠️ | ✅ | ❌ | ❌ UNVERIFIED for G2 |
| E | Generate AquaFlow program | AquaFlow (retarget to AX ST) | ✅ | ✅ | n/a | ⚠️ generator must be rewritten |
| F | Compile PLC program | `apax build` | ✅ (user program) | ✅ | ❌ (PLCSIM only) | ⚠️ S7-1500; ❌ G2 |
| G | Generate loadable artifacts | `apax build` | ✅ | ✅ | ❌ | ⚠️ S7-1500; ❌ G2 |
| H | Engineering communication | AX load/download (S7CommPlus PG) | ✅ | ✅ | ❌ | ⚠️ protocol; ❌ G2 session |
| I | Download to G2 | `apax dl`/`dlplc` + HWLD | ⚠️ (HW via TIA in examples) | ✅ | ❌ | ❌ UNVERIFIED for G2 |
| J | Verify + RUN/STOP | `apax hw-diag compare` + `plc-info` | ✅ | ✅ | ❌ | ⚠️ S7-1500; ❌ G2 |

**The missing links are C, D, F, G, H, I, J for S7-1200 G2.** Every one hinges on one unanswered fact:
whether SIMATIC AX lists S7-1200 G2 as an engineering target for **hardware configuration + download**
(and which firmware), or whether G2 remains TIA-only for hardware configuration. That fact is behind
Siemens' AX console/login and could not be verified from public sources. The S7-1200 G2 product page is
framed entirely around TIA Portal and does not mention AX.

---

## 5. Existing open-source solutions (individually)

| Project | Covers (A–J) | License | Evidence |
|---|---|---|---|
| snap7 / python-snap7 | G/H/I **data only** | LGPL | snap7's own S7-1200/1500 table: Block Upload/Down/Delete, Control Run/Stop, Security, Directory = **unsupported**; *"PG operations must follow the extended protocol, not (yet) covered by Snap7"* |
| libnodave | data only | LGPL | same S7comm limitation |
| nodeS7 | data only | MIT | same limitation |
| s7commplus (PyPI) | data read/write only (`db_read`) | MIT | README: S7CommPlus V1/V2(TLS)/V3 data access; session auth "derives from HarpoS7"; no block download, no RUN/STOP, no HW config |
| matiec (Beremiz) | A,B,C → C code + PLCopen XML | GPL | emits C/PLCopen, not Siemens blocks |
| OpenPLC | A,B,C → own runtime | GPL | runs on Arduino/RPi/PC, not Siemens CPUs |
| Beremiz | A,B,C → Linux RTE/CANopen | GPL | does not target Siemens S7-1200 |

No open-source project generates Siemens S7-1200 executable block objects or performs engineering downloads.

---

## 6. Commercial SDK solutions (individually)

| Product | Vendor | Covers (A–J) | Zero-TIA? | Evidence |
|---|---|---|---|---|
| TIA Openness (`Siemens.Engineering.dll`) | Siemens | A–J (via TIA) | No | Excluded by requirement |
| SIMATIC AX | Siemens | A–J (S7-1500, G2 unverified) | Yes (not TIA) | §4 |
| STEP 7 / TIA Portal | Siemens | A–J | No | Excluded |
| Softing / Hilscher / KEPServerEX / Inat / ProSoft data drivers | 3rd party | G/H/I data only | Yes | communication/diagnostics, not engineering; none generates Siemens loadables |

The only commercial path that can compile Siemens logic, generate loadables, and download without TIA is
**SIMATIC AX** — and only for S7-1500 (strong evidence) and S7-1200 G2 (unverified).

---

## 7. Build-from-scratch option

Classification: **P** public/documented · **O** open impl · **C** commercial SDK · **R** reverse-engineered/legally uncertain · **X** proprietary/undocumented

| Subsystem | Class |
|---|---|
| IEC 61131-3 / ST lexer+parser | P/O |
| Siemens SCL semantics | P (language) / X (codegen mapping) |
| Symbol table / type system | P/O |
| Memory / DB / FB-FC-OB layout | P (partial) |
| Instance-DB generation | X |
| **CPU-specific code generation → S7-1200 executable block format** | **X** |
| Hardware catalog (HSP) | X |
| Module configuration | X |
| **Hardware-config compiler → system data (SDB)** | **X** |
| Block dependency resolver / download package builder | P |
| Engineering protocol (S7CommPlus PG) | X/R |
| Secure session / auth / certificate handling | R |
| Integrity/anti-replay (FW V4.0–4.4) | R |
| TLS + CPU cert + password (FW ≥ V4.5) | X |
| Download transaction / recovery | X |
| RUN/STOP control | X |

**Verdict:** the P/O subsystems (parser, type system, dependency resolver, package builder) are ordinary
compiler work AquaFlow could do. Three hard blockers remain class **X/R**: (1) the S7-1200 executable block
format, (2) the system-data/hardware-config encoding, (3) the S7CommPlus PG download service with its
integrity/TLS protection. Reimplementing (3) requires Siemens' leaked key material — technically unverified
and **not legally usable**. The from-scratch route is not realistically implementable for classic S7-1200 G1.

---

## 8. Security and protocol requirements (real engineering download)

- Engineering session on classic S7-1200 = **S7CommPlus (0x72) PG services**, not the S7comm (0x32) data channel.
- FW V4.0–4.4: integrity + anti-replay protection (requires Siemens key material not lawfully published).
- FW ≥ V4.5: **TLS 1.3 with CPU certificate** + password-derived key; trust chain established via Siemens software.
- Access protection must be honored, never bypassed.
- Certificates/user management: on AX handled by HWC (legitimate only for AX-supported devices).
- Download transaction: STOP → block transfer → system-data transfer → verify → (RUN left to operator).
  No lawful open implementation of block/system-data transfer exists for classic S7-1200.

---

## 9. Legal / licensing constraints

- `Siemens.Engineering.dll` (Openness) is licensed only with TIA Portal — cannot ship in a TIA-free product.
- Reverse-engineered S7CommPlus PG download would depend on Siemens internals disclosed by security research
  (key-extraction disclosures). Shipping leaked key material, or bypassing access protection, is neither
  verified nor legally usable; it fails on FW ≥ V4.5 with protection and voids Siemens support.
- snap7 / from-scratch S7comm are legitimate but data-only.
- SIMATIC AX is legitimate and licensed separately from TIA Portal, but it **is Siemens engineering software
  under subscription** — "TIA-free," not "Siemens-free." AquaFlow may require it; must not redistribute it.

---

## 10. CPU / firmware compatibility matrix

| | Classic S7-1200 **G1** | S7-1200 **G2** | S7-1500 |
|---|---|---|---|
| Example order numbers | 6ES7 21x-1xx40-0XB0 | 6ES7 21x-1xx5x/6x | 6ES7 5xx/1xx |
| AquaFlow current scope | **Yes** | No | No |
| TIA Portal | required | TIA-framed (AX unverified) | optional |
| SIMATIC AX | **not supported** | **unverified** | **supported (strong evidence)** |
| Zero-TIA engineering download | **No** | **unverified** | **yes (user program)** |

---

## 11. Recommended zero-TIA architecture

**Presented as a candidate only — its S7-1200 G2 leg is unverified (§4).** It contains no TIA Portal,
no Openness, no `Siemens.Engineering.dll`, no STEP 7, no TIA license.

```
AquaFlow UI (honest capability report)
        │
AquaFlow Engineering API  (POST /api/siemens-sites/{sid}/engineering/*)
        │
PLC Project Model         (site → ST program + hardware .hwl.yml, signature-pinned)
        │
Hardware Configuration    (generate .hwl.yml: CPU + SM modules, I/O addresses, security)
        │
PLC Program Generator     (AquaFlow ST: IO DB + AquaFlowSiteControl FB + cyclic OB)
        │
SIMATIC AX Engineering Engine  ←─ external dependency #1 (customer-installed, licensed)
        │   apax build            compile ST → loadables        [C+D]
        │   apax hw_compile       .hwl.yml → system data        [E+F]
        │   apax dl / dlplc       download program + HW config  [G+H]
        │   apax plc-info         Start/Stop                     [J]
        │   apax hw-diag compare  online/offline compare         [I]
        ▼
Siemens S7-1200 G2 CPU (target must be confirmed on AX supported-device list)
        ▲
AquaFlow Runtime / Verify  (S7comm read-only: heartbeat, magic, signature)  [I]
```

External dependencies: (1) SIMATIC AX (`apax` + `@ax/sdk` + hardware support packages), customer-installed
under subscription, never redistributed; (2) bench proof that the HWC/HWLD path covers the selected G2 and
works offline. This is a **candidate** architecture, not a claimed working one.

---

## 12. Proof-of-concept plan

See `docs/SIEMENS-AX-G0-G1-VERIFICATION-PLAN.md` for the full checklist. In short:

- **Gate 0 (no hardware, no code):** obtain licensed AX access; confirm S7-1200 G2 on the official
  supported-device list (exact order number + firmware) for **hardware configuration + download**.
- **Gate 1 (one real G2, `apax` only, no AquaFlow code):** minimal `.hwl.yml` + minimal ST (blink OB);
  run `apax build` → `apax hw_compile` → `apax dl` → `apax plc-info` STOP→RUN → `apax hw-diag compare`,
  with pcap capture and no TIA Portal on that PC.

Only if both gates pass do C/D/F/G/H/I/J for G2 become verified, and the candidate architecture becomes
defensible (CONDITIONALLY VIABLE). If Gate 0 rejects G2, the zero-TIA target narrows to S7-1500.

---

## 13. Final decision

**NOT CURRENTLY VIABLE.**

- Classic S7-1200 **G1** (AquaFlow's current target): no verified zero-TIA path — proprietary/undocumented
  executable block format, system-data encoding, and S7CommPlus PG download, with no lawful open or
  commercial toolchain.
- S7-1200 **G2** via SIMATIC AX: a real hypothesis, but **unverified** — the complete hardware-config →
  compile → download chain has no primary-source confirmation, and current AX examples still route
  hardware configuration through TIA Portal.
- S7-1500 via AX: the strongest evidence, but outside the current target scope.

This is a conclusion of absence of proof, not proof of absence. A defined, low-cost verification path
(Gate 0 → Gate 1, §12) exists and may move the G2 hypothesis to CONDITIONALLY VIABLE; that path is a
future investigation, not a claim of current viability, and no partial implementation is offered as a
substitute.



