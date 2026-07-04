"""
Contract tests for the Digital Twin Engine (AQ-S5-001).

Asserts the three acceptance criteria:
  1. real assets mirrored (register + ingest → live state),
  2. historical replay (state as-of a timestamp + range query),
  3. predictive maintenance (accrual-based service forecast + trend anomalies).
"""
from datetime import datetime, timedelta, timezone

import pytest

from services.digital_twin import DigitalTwin

BASE = datetime(2026, 7, 1, tzinfo=timezone.utc)


def _day(d):
    return (BASE + timedelta(days=d)).isoformat()


@pytest.fixture
def twin(tmp_path):
    t = DigitalTwin(tmp_path / "twin")
    t.register_asset("pump-1", "pump", "Main Pump", service_interval_hours=2000, max_temp_c=85)
    return t


# ── 1. mirrored assets ────────────────────────────────────────────────────────

def test_asset_registered_and_mirrored(twin):
    twin.ingest("pump-1", {"running": True, "runtime_hours": 100, "temperature_c": 55}, _day(0))
    a = twin.get_asset("pump-1")
    assert a["state"]["runtime_hours"] == 100
    assert a["state"]["temperature_c"] == 55
    assert a["state"]["running"] is True


def test_fleet_mirror(twin):
    twin.register_asset("valve-1", "valve", "Valve")
    twin.ingest("pump-1", {"running": True, "runtime_hours": 10}, _day(0))
    m = twin.mirror()
    assert len(m) == 2
    assert sum(1 for x in m if x["state"].get("running")) == 1


def test_ingest_unknown_asset_errors(twin):
    with pytest.raises(ValueError):
        twin.ingest("ghost", {"running": True})


# ── 2. historical replay ──────────────────────────────────────────────────────

def test_replay_at_and_range(twin):
    for d in range(0, 31):
        twin.ingest("pump-1", {"running": True, "runtime_hours": 100 + d * 10,
                               "temperature_c": 55 + d * 0.5}, _day(d))
    r = twin.replay_at("pump-1", _day(10))
    assert r["state"]["runtime_hours"] == 200          # 100 + 10*10
    assert r["samples_before"] == 11
    assert twin.replay_at("pump-1", (BASE - timedelta(days=3)).isoformat()) is None
    rng = twin.replay_range("pump-1", _day(5), _day(9))
    assert rng["count"] == 5


# ── 3. predictive maintenance ─────────────────────────────────────────────────

def test_service_forecast(twin):
    twin.ingest("pump-1", {"running": True, "runtime_hours": 100}, _day(0))
    twin.ingest("pump-1", {"running": True, "runtime_hours": 400}, _day(30))   # 10 h/day
    fc = twin.maintenance_forecast("pump-1", now=_day(30))
    assert abs(fc["accrual_hours_per_day"] - 10.0) < 0.5
    assert abs(fc["hours_remaining"] - 1600) < 1
    assert abs(fc["days_to_service"] - 160) < 2
    assert fc["status"] == "ok"
    assert fc["estimated_service_date"] is not None


def test_due_soon_and_overdue_and_service_reset(twin):
    twin.ingest("pump-1", {"running": True, "runtime_hours": 1500}, _day(0))
    twin.ingest("pump-1", {"running": True, "runtime_hours": 1950}, _day(30))
    assert twin.maintenance_forecast("pump-1", now=_day(30))["status"] == "due_soon"
    twin.ingest("pump-1", {"running": True, "runtime_hours": 2100}, _day(45))
    assert twin.maintenance_forecast("pump-1")["status"] == "overdue"
    twin.mark_serviced("pump-1", _day(46))
    assert twin.maintenance_forecast("pump-1")["status"] == "ok"


def test_temperature_trend_anomaly(twin):
    for d in range(0, 31):
        twin.ingest("pump-1", {"running": True, "runtime_hours": 100 + d * 5,
                               "temperature_c": 55 + d * 0.6}, _day(d))
    alerts = twin.predict_anomalies("pump-1", horizon_days=90)
    trend = next((a for a in alerts if a["type"] == "temperature_trend"), None)
    assert trend is not None
    assert trend["days_to_limit"] > 0
    assert trend["slope_per_day"] > 0


def test_no_false_temperature_alert_when_stable(twin):
    for d in range(0, 10):
        twin.ingest("pump-1", {"running": True, "runtime_hours": 100 + d, "temperature_c": 50}, _day(d))
    alerts = twin.predict_anomalies("pump-1")
    assert not any(a["type"] == "temperature_trend" for a in alerts)


def test_summary(twin):
    twin.register_asset("pump-2", "pump", "Aux", service_interval_hours=2000)
    twin.ingest("pump-1", {"running": True, "runtime_hours": 10}, _day(0))
    twin.ingest("pump-2", {"running": False, "runtime_hours": 1990}, _day(0))
    s = twin.summary()
    assert s["asset_count"] == 2
    assert s["running"] == 1
    assert isinstance(s["alerts"], list)


def test_state_persists_across_instances(tmp_path):
    t1 = DigitalTwin(tmp_path / "t")
    t1.register_asset("p", "pump", "P")
    t1.ingest("p", {"running": True, "runtime_hours": 42}, _day(0))
    t2 = DigitalTwin(tmp_path / "t")
    assert t2.get_asset("p")["state"]["runtime_hours"] == 42
