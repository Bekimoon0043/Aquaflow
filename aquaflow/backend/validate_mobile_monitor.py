"""
validate_mobile_monitor.py — AquaFlow Stage 3, Priority 9 (AQ-S3-009)

Proves the three acceptance criteria for the Mobile Monitoring App backend:
  1. Live monitoring supported (compact snapshot from the operator status).
  2. Alerts supported (prioritized, de-duplicated, acknowledgeable).
  3. Remote control supported (commands validated against the live safety state).

No server. Exit code 0 = all pass.
Run:  python validate_mobile_monitor.py
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.mobile_monitor import (
    build_snapshot, evaluate_alerts, AlertManager, validate_remote_command,
    build_mobile_status,
)

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


def healthy_status(**over):
    s = {
        "safety": {"state": "LIVE", "permit": True, "active_faults": [], "latched_faults": [],
                   "pump_enable": True, "valve_enable": True, "flame_enable": False,
                   "laser_enable": False, "fog_enable": True, "lighting_enable": True,
                   "inputs": {"water_level_ok": True, "pressure_ok": True,
                              "estop_chain_closed": True, "plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 30000, "duration_ms": 120000, "show_id": "show-1"},
        "engine": {"state": "PLAYING", "duration": 120},
        "hardware_conflicts": [],
    }
    s.update(over)
    return s


# ── Criterion 1: live monitoring ────────────────────────────────────────────────
def test_live_monitoring():
    snap = build_snapshot(healthy_status())
    check("Live: reports playing state + progress",
          snap["playing"] and abs(snap["progress_pct"] - 25.0) < 1e-6, f"{snap['progress_pct']}")
    check("Live: health 'live' when playing + no faults", snap["health"] == "live", f"{snap['health']}")
    check("Live: subsystem enables surfaced",
          snap["subsystems"]["pump"] is True and snap["subsystems"]["flame"] is False, f"{snap['subsystems']}")
    check("Live: fault_count 0 + permit true on healthy system",
          snap["fault_count"] == 0 and snap["permit"] is True, f"{snap}")

    estop = build_snapshot(healthy_status(safety={"state": "EMERGENCY_STOP",
                                                  "active_faults": ["ESTOP_OPEN"],
                                                  "inputs": {"estop_chain_closed": False}}))
    check("Live: health 'estop' during emergency stop", estop["health"] == "estop", f"{estop['health']}")

    idle = build_snapshot(healthy_status(transport={"state": "STOPPED", "position_ms": 0, "duration_ms": 0},
                                         engine={"state": "STOPPED", "duration": 0}))
    check("Live: health 'idle' when stopped + progress 0",
          idle["health"] == "idle" and idle["progress_pct"] == 0.0, f"{idle['health']}")


# ── Criterion 2: alerts ─────────────────────────────────────────────────────────
def test_alerts():
    check("Alerts: healthy system → no alerts", evaluate_alerts(healthy_status()) == [], "")

    over = healthy_status(safety={"state": "FAULT", "active_faults": ["OVER_PRESSURE"],
                                  "inputs": {"pressure_ok": False, "plc_heartbeat_ok": True}})
    al = evaluate_alerts(over)
    check("Alerts: over-pressure raises a CRITICAL alert",
          any(a["code"] == "OVER_PRESSURE" and a["severity"] == "critical" for a in al), f"{al}")

    estop = healthy_status(safety={"state": "EMERGENCY_STOP", "active_faults": ["ESTOP_OPEN"],
                                   "inputs": {"estop_chain_closed": False}})
    check("Alerts: E-stop raises a critical ESTOP alert",
          any(a["code"] == "ESTOP" and a["severity"] == "critical" for a in evaluate_alerts(estop)), "")

    conf = healthy_status(hardware_conflicts=["DMX collision: U1 Ch1"])
    check("Alerts: hardware conflict raises a critical alert",
          any(a["code"] == "HW_CONFLICT" and a["severity"] == "critical" for a in evaluate_alerts(conf)), "")

    plc = healthy_status(safety={"state": "LIVE", "inputs": {"plc_heartbeat_ok": False}})
    al2 = evaluate_alerts(plc)
    check("Alerts: PLC comm loss is a warning (not critical)",
          any(a["code"] == "PLC_COMM_LOSS" and a["severity"] == "warning" for a in al2), f"{al2}")

    # AlertManager: dedupe, ack, clear, ordering.
    mgr = AlertManager()
    mgr.ingest(over)
    mgr.ingest(over)   # same condition again
    active = mgr.active()
    check("Alerts: manager de-duplicates repeated conditions",
          sum(1 for a in active if a["code"] == "OVER_PRESSURE") == 1, f"{active}")
    check("Alerts: unacknowledged count > 0", mgr.unacknowledged_count() > 0, "")
    mgr.acknowledge("OVER_PRESSURE")
    check("Alerts: acknowledge marks the alert + lowers unacked count",
          mgr.active()[0]["acknowledged"] is True and mgr.unacknowledged_count() == 0, "")
    mgr.ingest(healthy_status())   # condition resolved
    check("Alerts: resolved condition clears from active", mgr.active() == [], f"{mgr.active()}")

    # Critical sorts before warning.
    multi = healthy_status(safety={"state": "FAULT", "active_faults": ["VALVE_TIMEOUT", "OVER_PRESSURE"],
                                   "inputs": {"pressure_ok": False, "plc_heartbeat_ok": False}})
    ordered = AlertManager(); ordered.ingest(multi)
    check("Alerts: critical alerts sort before warnings",
          ordered.active()[0]["severity"] == "critical", f"{[a['severity'] for a in ordered.active()]}")


# ── Criterion 3: remote control ─────────────────────────────────────────────────
def test_remote_control():
    healthy = healthy_status(safety={"state": "ARMED", "permit": True, "inputs": {}})
    check("Remote: play allowed when armed + no conflict",
          validate_remote_command("play", healthy)["allowed"] is True, "")

    not_armed = healthy_status(safety={"state": "SAFE_IDLE", "permit": False, "inputs": {}})
    r = validate_remote_command("play", not_armed)
    check("Remote: play blocked when not armed", r["allowed"] is False and "arm" in r["reason"].lower(), f"{r}")

    conflict = healthy_status(safety={"state": "ARMED", "permit": True, "inputs": {}},
                              hardware_conflicts=["x", "y"])
    r2 = validate_remote_command("play", conflict)
    check("Remote: play blocked on hardware conflict",
          r2["allowed"] is False and "conflict" in r2["reason"].lower(), f"{r2}")

    estop = healthy_status(safety={"state": "EMERGENCY_STOP", "permit": False, "inputs": {}})
    check("Remote: play blocked during E-stop",
          validate_remote_command("play", estop)["allowed"] is False, "")
    check("Remote: E-STOP always allowed (even during E-stop)",
          validate_remote_command("estop", estop)["allowed"] is True, "")
    check("Remote: STOP always allowed", validate_remote_command("stop", estop)["allowed"] is True, "")
    check("Remote: arm blocked during E-stop",
          validate_remote_command("arm", estop)["allowed"] is False, "")
    check("Remote: unknown command rejected",
          validate_remote_command("launch_rockets", healthy)["allowed"] is False, "")


# ── Aggregate payload ───────────────────────────────────────────────────────────
def test_mobile_payload():
    out = build_mobile_status(healthy_status(safety={"state": "FAULT", "active_faults": ["OVER_PRESSURE"],
                                                     "inputs": {"pressure_ok": False}}))
    check("Payload: has snapshot + alerts + counts",
          "snapshot" in out and "alerts" in out and out["alert_count"] >= 1 and out["unacknowledged"] >= 1,
          f"{ {k:out[k] for k in ('alert_count','unacknowledged')} }")


def main() -> int:
    for fn in (test_live_monitoring, test_alerts, test_remote_control, test_mobile_payload):
        fn()
    print("\n" + "=" * 72)
    print("AQ-S3-009 Mobile Monitoring App — Verification")
    print("=" * 72)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    print("-" * 72)
    print(f"{passed}/{len(results)} checks passed")
    print("=" * 72)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
