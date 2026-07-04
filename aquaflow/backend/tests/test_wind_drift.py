"""
Contract tests for the Wind Drift Calculation Engine (AQ-X-012).

Asserts the three acceptance criteria against hand-solved physics:
  1. wind drift is calculated from weather data,
  2. safety zones update (downwind expansion) and report breaches,
  3. operator warnings are generated and severity-ranked.
"""
import math

from services.weather_engine import WeatherConditions, jet_time_of_flight, wind_drift
from services.wind_drift import (
    jet_drift, compute_safety_zones, operator_warnings, analyze,
    HIGH_WIND_SHUTDOWN_MS,
)


def _approx(a, b, tol=1e-3):
    return abs(a - b) <= tol


WEST_WIND = WeatherConditions(wind_speed=5.0, wind_direction=270.0)
JET = {"id": "j1", "x": 0.0, "y": 0.0, "height": 4.0, "splash_radius": 0.5}
FOUNTAIN = {"keep_clear_m": 4.0, "jets": [JET],
            "barriers": [{"name": "spectator rail", "distance_m": 6.0}]}


# ── 1. drift from weather ─────────────────────────────────────────────────────

def test_drift_matches_flight_time_times_wind():
    t = jet_time_of_flight(4.0)
    assert _approx(t, 2 * math.sqrt(2 * 4 / 9.81), 1e-9)
    assert _approx(wind_drift(4.0, 5.0, 0.5), 0.5 * 5.0 * t, 1e-9)
    assert wind_drift(4.0, 0.0) == 0.0


def test_west_wind_drifts_spray_eastward():
    d = jet_drift(JET, WEST_WIND)
    assert d["landing"][0] > 0 and abs(d["landing"][1]) < 1e-6
    assert _approx(d["farthest_wet"][0], d["landing"][0] + 0.5, 1e-9)
    assert d["gust_drift_m"] > d["drift_m"]        # gust drifts further


# ── 2. safety zones ───────────────────────────────────────────────────────────

def test_calm_zone_is_splash_radius():
    z = compute_safety_zones(FOUNTAIN, WeatherConditions(wind_speed=0.0))
    assert _approx(z["exclusion_radius_m"], 0.5, 1e-3)     # circle of splash around the jet
    assert z["breaches"] == []


def test_wind_expands_zone_and_breaches_keep_clear():
    z = compute_safety_zones(FOUNTAIN, WEST_WIND)
    drift = wind_drift(4.0, 5.0, 0.5)
    assert _approx(z["exclusion_radius_m"], drift + 0.5, 1e-2)
    kc = next(b for b in z["breaches"] if b["type"] == "keep_clear")
    assert _approx(kc["exceeded_by_m"], (drift + 0.5) - 4.0, 1e-2)


def test_strong_wind_breaches_barrier():
    z = compute_safety_zones(FOUNTAIN, WeatherConditions(wind_speed=8.0, wind_direction=270.0))
    assert any(b["type"] == "barrier" for b in z["breaches"])


def test_zone_recompute_is_deterministic():
    a = compute_safety_zones(FOUNTAIN, WEST_WIND)["exclusion_radius_m"]
    b = compute_safety_zones(FOUNTAIN, WEST_WIND)["exclusion_radius_m"]
    assert a == b


def test_zone_center_is_jet_centroid():
    z = compute_safety_zones({"keep_clear_m": 10, "jets": [
        {"id": "a", "x": 0, "y": 0, "height": 2}, {"id": "b", "x": 4, "y": 0, "height": 2}]},
        WeatherConditions(wind_speed=0.0))
    assert _approx(z["center"][0], 2.0) and _approx(z["center"][1], 0.0)


# ── 3. operator warnings ──────────────────────────────────────────────────────

def test_breach_raises_critical_warning():
    z = compute_safety_zones(FOUNTAIN, WEST_WIND)
    w = operator_warnings(z, WEST_WIND)
    kc = next(x for x in w if x["code"] == "keep_clear_breach")
    assert kc["severity"] == "critical"


def test_high_wind_warning_sorts_first():
    high = WeatherConditions(wind_speed=HIGH_WIND_SHUTDOWN_MS + 1, wind_direction=270.0)
    z = compute_safety_zones(FOUNTAIN, high)
    w = operator_warnings(z, high)
    assert w[0]["severity"] == "critical"
    assert any(x["code"] == "high_wind" for x in w)


def test_calm_returns_single_clear_info():
    z = compute_safety_zones(FOUNTAIN, WeatherConditions(wind_speed=1.0))
    w = operator_warnings(z, WeatherConditions(wind_speed=1.0))
    assert len(w) == 1 and w[0]["code"] == "clear" and w[0]["severity"] == "info"


def test_gust_only_breach():
    f = {"keep_clear_m": 5.2, "jets": [JET]}
    z = compute_safety_zones(f, WEST_WIND)
    w = operator_warnings(z, WEST_WIND)
    assert z["exclusion_radius_m"] <= 5.2 < z["gust_exclusion_radius_m"]
    assert any(x["code"] == "gust_breach" for x in w)


# ── analyze() ─────────────────────────────────────────────────────────────────

def test_analyze_end_to_end():
    res = analyze({"fountain": FOUNTAIN, "weather": {"wind_speed": 5.0, "wind_direction": 270.0}})
    assert set(res) == {"zones", "warnings", "summary"}
    assert res["summary"]["safe"] is False
    assert res["summary"]["exclusion_radius_m"] > 4.0
    assert res["summary"]["highest_severity"] == "critical"


def test_analyze_safe_when_calm():
    res = analyze({"fountain": FOUNTAIN, "weather": {"wind_speed": 1.0, "wind_direction": 0.0}})
    assert res["summary"]["safe"] is True
    assert res["summary"]["breach_count"] == 0
