"""
Contract tests for the Fleet Management System (AQ-S5-004).

Asserts the three acceptance criteria:
  1. multiple sites monitored (register + report + offline detection),
  2. central dashboard works (counts, online/offline, health breakdown),
  3. alerts centralised (merged, attributed, ranked, acknowledgeable).
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.fleet_manager import FleetManager

BASE = datetime(2026, 7, 5, 12, 0, tzinfo=timezone.utc)


def _t(sec):
    return (BASE + timedelta(seconds=sec)).isoformat()


LIVE = {"safety": {"state": "LIVE", "permit": True, "active_faults": [], "inputs": {"plc_heartbeat_ok": True}},
        "transport": {"state": "PLAYING", "position_ms": 5000, "duration_ms": 10000}}
ESTOP = {"safety": {"state": "EMERGENCY_STOP", "permit": False, "active_faults": ["ESTOP_OPEN"],
                    "inputs": {"plc_heartbeat_ok": True}}}


@pytest.fixture
def fleet(tmp_path):
    fm = FleetManager(tmp_path / "fleet")
    fm.register_site("dubai", "Dubai Mall", "Dubai")
    fm.register_site("marina", "Marina Bay", "Singapore")
    fm.register_site("vegas", "Bellagio", "Las Vegas")
    return fm


# ── 1. multi-site monitoring ──────────────────────────────────────────────────

def test_sites_report_and_mirror(fleet):
    fleet.report_status("dubai", LIVE, timestamp=_t(0))
    fleet.report_status("marina", ESTOP, timestamp=_t(0))
    assert fleet.get_site("dubai", now=_t(1))["snapshot"]["health"] == "live"
    assert fleet.get_site("marina", now=_t(1))["snapshot"]["health"] == "estop"


def test_never_reported_is_offline(fleet):
    assert fleet.get_site("vegas", now=_t(1))["online"] is False


def test_offline_after_timeout(fleet):
    fleet.report_status("dubai", LIVE, timestamp=_t(0))
    assert fleet.get_site("dubai", now=_t(60))["online"] is True
    assert fleet.get_site("dubai", now=_t(300))["online"] is False


def test_report_unknown_site_errors(fleet):
    with pytest.raises(ValueError):
        fleet.report_status("nope", LIVE)


# ── 2. central dashboard ──────────────────────────────────────────────────────

def test_dashboard_rollup(fleet):
    fleet.report_status("dubai", LIVE, timestamp=_t(0))
    fleet.report_status("marina", ESTOP, timestamp=_t(0))
    d = fleet.dashboard(now=_t(1))
    assert d["site_count"] == 3
    assert d["online"] == 2 and d["offline"] == 1
    assert d["health"]["live"] == 1 and d["health"]["estop"] == 1 and d["health"]["offline"] == 1
    assert len(d["sites"]) == 3
    assert d["critical_alerts"] >= 1


# ── 3. centralised alerts ─────────────────────────────────────────────────────

def test_alerts_merged_and_attributed(fleet):
    fleet.report_status("marina", ESTOP, timestamp=_t(0))
    alerts = fleet.central_alerts(now=_t(1))
    codes = {(a["site_id"], a["code"]) for a in alerts}
    assert ("marina", "ESTOP") in codes
    assert ("vegas", "SITE_OFFLINE") in codes           # never reported
    assert ("dubai", "SITE_OFFLINE") in codes           # never reported either
    assert all("site_name" in a for a in alerts)
    assert alerts[0]["severity"] == "critical"          # sorted critical-first


def test_acknowledge_alert(fleet):
    fleet.report_status("marina", ESTOP, timestamp=_t(0))
    fleet.acknowledge("marina", "ESTOP")
    a = next(x for x in fleet.central_alerts(now=_t(1)) if x["site_id"] == "marina" and x["code"] == "ESTOP")
    assert a["acknowledged"] is True


def test_recovery_clears_alert_and_ack(fleet):
    fleet.report_status("marina", ESTOP, timestamp=_t(0))
    fleet.acknowledge("marina", "ESTOP")
    fleet.report_status("marina", LIVE, timestamp=_t(1))
    after = fleet.central_alerts(now=_t(2))
    assert not any(a["site_id"] == "marina" and a["code"] == "ESTOP" for a in after)
    assert fleet._load("marina")["acks"] == []


def test_acknowledge_unknown_site_errors(fleet):
    with pytest.raises(ValueError):
        fleet.acknowledge("ghost", "X")
