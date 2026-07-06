# AquaFlow — Hardware Commissioning Checklist & Sign-Off

**Prepared by AF-HUB-010 (code-prep). Executed on-site in AF-HUB-011.**

This is the runbook the on-site commissioning engineer follows to verify AquaFlow's real
hardware output, and the sign-off that authorizes flipping the commissioning flag. **Until
this checklist is completed and signed, `AQUAFLOW_HARDWARE_COMMISSIONED` stays FALSE and
every report is labelled SIMULATED.**

> ⚠️ **Safety first.** All hardware present risk (water, electricity, fire, lasers).
> Follow site lockout/tagout and PPE rules. Keep a hardware E-stop within reach at all
> times. Do not proceed past any FAIL until it is resolved.

- **Site / project:** ____________________  **Date:** __________
- **Commissioning engineer:** ____________________
- **AquaFlow version:** ____________________  **Audit commit:** ____________________

---

## 0. Pre-flight (before any output)

- [ ] Backend runs in **production mode** (no auto-reload): `python main.py` (not `AQUAFLOW_DEV=1`).
- [ ] `AQUAFLOW_LICENSE_SECRET` is set (server-side); `/api/health` returns and license state is as expected.
- [ ] `/api/health/runtime` verdict reviewed; no unexpected **critical** issues before hardware is energized.
- [ ] Commissioning flag is **FALSE** at start: `GET /api/hardware/commissioning` → `commissioned: false`.
- [ ] Hardware E-stop tested **cold** (before software): pressing it physically de-energizes output.
- [ ] Designed show loaded; `hardware_conflicts` is empty (no duplicate DMX/Modbus addresses).

## 1. Host output-path self-test (SIMULATED — run first)

Run the loopback self-test; it must pass before touching real fixtures:

```
python hardware_verification_harness.py --out selftest.json
```

- [ ] `loopback_checks_passed: true` (Art-Net, sACN, DMX, safety-gate, timing).
- [ ] Report is labelled **SIMULATED** (`verification_mode: SIMULATED`) — expected at this stage.
- [ ] Attach `selftest.json` to the commissioning record.

## 2. Real per-protocol transmission (REAL target)

For each controller/node, drive a known test frame and **visually confirm** the fixture:

```
python hardware_verification_harness.py --target <NODE_IP> --universe <N> --protocol artnet --out real_<n>.json
```

| # | Node IP | Universe | Protocol | Frame sent (`transmitted:true`) | Fixture physically responded? | Pass |
|---|---------|----------|----------|-------------------------------|-------------------------------|------|
| 1 |         |          |          | ☐ | ☐ | ☐ |
| 2 |         |          |          | ☐ | ☐ | ☐ |
| 3 |         |          |          | ☐ | ☐ | ☐ |

> The harness only proves the **frame left this host**. The "fixture physically responded"
> column is the engineer's **visual** confirmation and is the actual hardware evidence.

## 3. Per-fixture address & channel map

- [ ] Every designed fixture drives the **correct physical unit** (no cross-wiring / address clash).
- [ ] RGB fixtures show correct colour channels (R/G/B not swapped).
- [ ] Motion/pan-tilt fixtures move in the commanded direction and range.
- [ ] Pumps/valves (Modbus) actuate at the commanded intensity; flow confirmed.

## 4. Safety verification on REAL hardware (must all pass)

- [ ] **Software E-stop** (`emergency_stop`) zeros ALL outputs within one refresh — visually confirmed on every subsystem (lights, pumps, flame, fog, laser).
- [ ] **Blackout** (`/api/devices/dmx/blackout`) zeros DMX/Modbus output.
- [ ] **Safety permit withheld** → no output reaches fixtures (matches the loopback safety-gate check).
- [ ] **Flame max-on cutoff** forces flame off after its duration limit, then cooldown blocks re-fire.
- [ ] **Recovery is gated**: with a hazard input asserted, `/api/safety/reset` is **refused** with a reason; only clears once conditions are safe.
- [ ] **PLC heartbeat loss** drives the runtime-health verdict to critical and inhibits output.

## 5. Output timing on the wire

- [ ] Art-Net/sACN refresh stays within the 44 Hz spec (no faster than the 22.7 ms DMX512 frame floor).
- [ ] No visible flicker or dropped frames during a full show run.

## 6. Full-show dress run

- [ ] Run one complete designed show end-to-end on real hardware; no faults, no address conflicts.
- [ ] E-stop mid-show halts everything cleanly; recovery returns to a safe idle state.

---

## Sign-off (authorizes AF-HUB-011 commissioning)

All sections above PASS, with real fixtures physically confirmed:

- **Commissioning engineer:** ____________________  **Signature:** __________  **Date:** __________
- **Witness / site authority:** ____________________  **Signature:** __________  **Date:** __________

**Only after both signatures**, set the commissioning flag for this deployment (AF-HUB-011):

```
# Set in the deployment environment (persist per your service manager):
AQUAFLOW_HARDWARE_COMMISSIONED=1
```

Then re-run `GET /api/hardware/verify` and confirm `real_hardware_verified: true` and
`deployment_ready: true`. Attach this signed checklist plus all `*.json` harness outputs to
the **AF-HUB-012** acceptance pack.

> If any item is FAIL or unverified, the deployment is **NOT** commissioned. Leave
> `AQUAFLOW_HARDWARE_COMMISSIONED` unset (FALSE) and do not run a live show.
