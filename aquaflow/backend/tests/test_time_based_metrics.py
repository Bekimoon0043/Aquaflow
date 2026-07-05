"""
Time-based metric / timer contracts (AQ-FIX-009).

EVAL-AQ-001 noted that time-driven behaviour (escalation timers, offline/heartbeat
timeouts, reachability windows) is clock-injected and unit-tested but never observed
over real elapsed calendar time. This module pins the "time advances → state
changes" contract for those timers in one place, driving each engine's injected
clock across its thresholds so a regression in any timer fails the suite.
"""
from datetime import datetime, timedelta, timezone

from services.fault_alerting import FaultAlertEngine
from services.fleet_manager import FleetManager
from services.asset_cloud import AssetCloud

BASE = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)


def _iso(sec):
    return (BASE + timedelta(seconds=sec)).isoformat()


LIVE = {"safety": {"state": "LIVE", "permit": True, "active_faults": [],
                   "inputs": {"plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 1, "duration_ms": 10}}


# ── Fault escalation climbs tiers as unacknowledged time elapses ───────────────

def test_fault_escalation_over_elapsed_time():
    eng = FaultAlertEngine()
    eng.raise_fault("PUMP_FAIL", severity="warning", now=0.0)

    eng.evaluate_escalations(now=30.0)                 # < 60 s → no escalation yet
    assert eng.get("PUMP_FAIL").escalation_level == 0

    eng.evaluate_escalations(now=90.0)                 # > 60 s → supervisor tier
    assert eng.get("PUMP_FAIL").escalation_level == 1

    eng.evaluate_escalations(now=400.0)                # > 300 s → on-call, forced critical
    alert = eng.get("PUMP_FAIL")
    assert alert.escalation_level == 2
    assert alert.severity == "critical"


def test_acknowledge_freezes_escalation():
    eng = FaultAlertEngine()
    eng.raise_fault("PUMP_FAIL", severity="warning", now=0.0)
    eng.acknowledge("PUMP_FAIL", now=10.0)
    eng.evaluate_escalations(now=1000.0)               # long after both tiers
    assert eng.get("PUMP_FAIL").escalation_level == 0  # frozen by the ack


# ── Fleet site goes offline once the heartbeat times out ──────────────────────

def test_fleet_heartbeat_timeout(tmp_path):
    fm = FleetManager(tmp_path / "fleet")
    fm.register_site("s1", "Site One")
    fm.report_status("s1", LIVE, timestamp=_iso(0))
    assert fm.get_site("s1", now=_iso(60))["online"] is True     # within 120 s
    assert fm.get_site("s1", now=_iso(200))["online"] is False   # past the timeout


# ── Cloud remote diagnostics become unreachable after the timeout ─────────────

def test_cloud_diagnostics_reachability_window(tmp_path):
    cloud = AssetCloud(tmp_path / "cloud")
    cloud.register_company("acme", "ACME")
    cloud.report_diagnostics("acme", "site", LIVE, timestamp=_iso(0))
    assert cloud.run_remote_diagnostic("acme", "site", now=_iso(120))["reachable"] is True
    late = cloud.run_remote_diagnostic("acme", "site", now=_iso(1000))   # > 300 s
    assert late["reachable"] is False
    assert any("unreachable" in r.lower() for r in late["recommendations"])
