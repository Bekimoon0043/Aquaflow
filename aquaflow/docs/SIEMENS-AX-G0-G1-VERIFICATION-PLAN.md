# SIMATIC AX — Gate 0 / Gate 1 Verification Plan (S7-1200 G2, zero-TIA)

**Purpose:** settle the single unanswered question in
`docs/SIEMENS-ZERO-TIA-ARCHITECTURE-DECISION.md` — **does SIMATIC AX support S7-1200 G2
for hardware configuration + compilation + download, without TIA Portal?** This plan proves
(or rejects) the complete chain before any AquaFlow code is written. No AquaFlow integration,
no production code, no fake success.

**Bottom line of the decision doc:** the full A–J chain for G2 is UNVERIFIED. Items C, D, F, G,
H, I, J all hinge on whether G2 is on AX's supported-device list for **hardware config + download**.

---

## Gate 0 — Documentation / licensing check (no hardware, no code)

**Goal:** convert "G2 is on AX's supported list" from assumption to a recorded fact — or reject it.

| # | Step | Record |
|---|---|---|
| 0.1 | Obtain a **SIMATIC AX license (subscription)** quote/entitlement and portal access to `console.simatic-ax.siemens.io` | entitlement type, subscription tier, offline-license availability |
| 0.2 | Pull the official **supported devices / supported PLCs** list | URL + capture date |
| 0.3 | Confirm whether **S7-1200 G2** is listed as an **engineering** target | yes/no |
| 0.4 | Record the **exact G2 order numbers** (e.g. 6ES7 21x-…) and **firmware range** | list + FW min/max |
| 0.5 | Confirm whether G2 support covers **hardware configuration (HWC/HWLD) + download**, not just ST logic download | yes/no + which features |
| 0.6 | Confirm whether `apax hw_compile` / `apax dl` support **offline** operation after install (no registry/license-server call at build/download time) | yes/no + evidence |
| 0.7 | Confirm the required **hardware support packages** for G2 are obtainable via `apax` | package names + registry |

**Gate 0 go/no-go:**
- **GO** — G2 is listed, with exact order number + firmware, for hardware config + download, offline-capable.
- **NO-GO (G2 rejected)** — G2 is not on the list, or is listed only for logic download (HW config still TIA).
  In that case the zero-TIA target narrows to **S7-1500**, and the G2 assumption is retired.

---

## Gate 1 — One real S7-1200 G2, `apax` only (no AquaFlow code, no TIA)

**Goal:** prove the complete chain on hardware, manually, with `apax` as the only engineering tool.

**Prerequisites (Gate 0 = GO):**
- One **S7-1200 G2 CPU** (exact model from Gate 0.4) + 24 V supply; outputs to **indicator LEDs only**.
- Bench PC with **SIMATIC AX + apax installed** and logged in; **no TIA Portal installed on this PC**.
- Wireshark/Npcap capturing the bench NIC for every step.

| # | Step | Command / action | Pass criterion |
|---|---|---|---|
| 1.1 | Create AX project | `apax create …` | project scaffold exists |
| 1.2 | Add SDK + hardware packages | `apax add --dev @ax/sdk` (HWC/HWLD) | deps resolve from registry |
| 1.3 | Write minimal **`.hwl.yml`** (CPU G2 + one SM module + I/O addresses + IP) | hand-written | file accepted |
| 1.4 | Write minimal **ST** program (cyclic OB blinking an LED) | hand-written | compiles |
| 1.5 | Compile ST → loadables | `apax build` | zero errors, artifacts emitted |
| 1.6 | Compile hardware config → system data | `apax hw_compile` | zero errors, system-data emitted |
| 1.7 | Establish engineering session (cert/user) | AX/HWC security setup | session established, no TIA |
| 1.8 | **Download program + hardware config** | `apax dl` (or `dlplc` + HWLD) | download reports success, CPU left in STOP |
| 1.9 | Transition to RUN | `apax plc-info` (Start) | CPU enters RUN |
| 1.10 | Verify online/offline hardware | `apax hw-diag compare` | "Actual" == "Configured" |
| 1.11 | Observe execution | — | LED blinks from the downloaded program |
| 1.12 | Archive evidence | pcap + screenshots | signed receipt, no TIA ever invoked |

**Gate 1 go/no-go:**
- **GO** — 1.1–1.12 all pass, fully offline, no TIA Portal anywhere in the loop.
- **NO-GO** — any step requires TIA Portal, or G2 refuses the AX download, or offline is not possible.

---

## Decision tree after both gates

```
Gate 0
 ├─ NO-GO (G2 not on AX list)  →  zero-TIA target = S7-1500 only; retire G2/G1 assumption.
 └─ GO
     └─ Gate 1
          ├─ NO-GO  →  AX does not cover G2 engineering in practice; document and stop.
          └─ GO     →  C/D/F/G/H/I/J for G2 are VERIFIED.
                       Decision doc may move to CONDITIONALLY VIABLE (G2 scope).
                       Only then begin AquaFlow integration:
                       (a) retarget program generator to AX ST;
                       (b) add .hwl.yml generator;
                       (c) wrap apax behind /api/siemens-sites/{sid}/engineering/* with honest gates.
```

**Nothing in this plan modifies production code, contacts a PLC outside the controlled bench, or claims
success without the recorded evidence above.**
