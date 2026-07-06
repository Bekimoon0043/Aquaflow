# AF-HUB-011 — Real Bench Commissioning Record (= AQ-X-002)

> ## ⛔ STATUS: NOT EXECUTED — awaiting on-site hardware commissioning
>
> **This record is a BLANK TEMPLATE.** AF-HUB-011 is real, physical bench commissioning:
> it requires actual DMX/Art-Net/Modbus hardware, real fixtures, and a qualified engineer
> physically present to run the harness, visually confirm every fixture, verify safety
> behaviour on live hardware, and sign off. **Claude Code cannot and did not perform it**,
> and did **not** set `AQUAFLOW_HARDWARE_COMMISSIONED`. The system correctly still reports
> `SIMULATED` / `deployment_ready: false`.
>
> An on-site engineer completes and signs this record using
> [HARDWARE_COMMISSIONING_CHECKLIST.md](HARDWARE_COMMISSIONING_CHECKLIST.md) and
> `aquaflow/backend/hardware_verification_harness.py`. Only then is the flag set, and this
> record + the harness JSON outputs feed the AF-HUB-012 acceptance pack.

---

## Site & equipment

- **Site / project:** ____________________  **Date:** __________
- **Commissioning engineer (name + qualification):** ____________________
- **Witness / site authority:** ____________________
- **AquaFlow version:** ____________  **Audit commit:** ____________  **Harness version:** ____________
- **Controllers / nodes under test (make, model, IP, protocol):**
  1. ____________________
  2. ____________________
  3. ____________________

## Harness runs (attach JSON outputs)

| Run | Command | Node IP | Universe | Protocol | `transmitted` | Fixture physically responded | JSON file |
|-----|---------|---------|----------|----------|---------------|------------------------------|-----------|
| Self-test | `hardware_verification_harness.py --out selftest.json` | loopback | — | all | — (loopback_checks_passed = ___) | — | selftest.json |
| Real 1 | `... --target ___ --universe ___ --protocol ___` | | | | ☐ | ☐ | |
| Real 2 | | | | | ☐ | ☐ | |
| Real 3 | | | | | ☐ | ☐ | |

## Safety verification on REAL hardware (all must PASS — record evidence)

| Check | Result | Evidence / notes |
|-------|--------|------------------|
| Software E-stop zeros ALL outputs (lights/pumps/flame/fog/laser) | ☐ PASS ☐ FAIL | |
| Blackout zeros DMX + Modbus | ☐ PASS ☐ FAIL | |
| Safety permit withheld → no output reaches fixtures | ☐ PASS ☐ FAIL | |
| Flame max-on cutoff forces off + cooldown blocks re-fire | ☐ PASS ☐ FAIL | |
| Recovery is gated (refused with reason while hazard asserted) | ☐ PASS ☐ FAIL | |
| PLC-heartbeat loss → health critical + output inhibited | ☐ PASS ☐ FAIL | |
| On-wire timing within 44 Hz / 22.7 ms DMX512 frame floor | ☐ PASS ☐ FAIL | measured Hz: ___ |
| Full-show dress run — no faults, no address conflicts | ☐ PASS ☐ FAIL | |

## Per-fixture confirmation

| Fixture ID | Type | Address (U:Ch or PLC reg) | Correct physical unit | Colour/motion/flow correct | Pass |
|------------|------|---------------------------|-----------------------|----------------------------|------|
| | | | ☐ | ☐ | ☐ |
| | | | ☐ | ☐ | ☐ |

## Attestation & flag change

All sections PASS with real fixtures physically confirmed:

- **Commissioning engineer signature:** __________________  **Date:** __________
- **Witness signature:** __________________  **Date:** __________

On both signatures, set in the deployment environment and persist per the service manager:

```
AQUAFLOW_HARDWARE_COMMISSIONED=1
```

Then confirm the system now reports commissioned truthfully:

```
GET /api/hardware/verify        # expect real_hardware_verified: true, deployment_ready: true
GET /api/hardware/commissioning # expect commissioned: true
GET /api/health/runtime         # expect commissioning subsystem = commissioned
```

Record the post-flip results and attach this signed record + all `*.json` harness outputs to the **AF-HUB-012** acceptance pack.

> If ANY item is FAIL or unverified, do **not** set the flag. The deployment remains
> uncommissioned (SIMULATED) and **no live show may run**.
