"""
Contract tests for the AI Optimization Engine (AQ-S5-002).

Asserts the three acceptance criteria against hand-checked physics:
  1. energy optimised (pump affinity P∝N³ + LED),
  2. water optimised (recirculation + drift/evaporation reduction),
  3. performance optimised (trim low impact-per-flow jets to raise efficiency).
"""
from services.optimization_engine import (
    optimize_energy, optimize_water, optimize_performance, analyze,
)


def _approx(a, b, tol=1e-2):
    return abs(a - b) <= tol


# ── 1. energy ─────────────────────────────────────────────────────────────────

def test_pump_affinity_energy_saving():
    e = optimize_energy({"pumps": [{"id": "p1", "power_w": 4000, "speed": 1.0,
                                    "required_flow_fraction": 0.8, "hours_per_day": 8}],
                         "tariff": {"energy_rate": 0.2}})
    # 4000 W → 32 kWh; 4000·0.8³ = 2048 W → 16.384 kWh; saving 15.616 (48.8%).
    assert _approx(e["baseline_kwh_day"], 32)
    assert _approx(e["optimized_kwh_day"], 16.384)
    assert _approx(e["savings_percent"], 48.8, 0.1)
    assert e["cost_saving_per_day"] > 0
    assert any("Reduce pump" in r["action"] for r in e["recommendations"])


def test_led_swap_saving():
    e = optimize_energy({"lights": [{"id": "l1", "power_w": 1000, "type": "incandescent", "hours_per_day": 6}]})
    assert _approx(e["baseline_kwh_day"], 6)
    assert _approx(e["optimized_kwh_day"], 1.2)          # LED ≈ 20%
    assert any("LED" in r["action"] for r in e["recommendations"])


def test_no_energy_change_for_efficient_design():
    e = optimize_energy({"pumps": [{"id": "p", "power_w": 3000, "speed": 1.0, "required_flow_fraction": 1.0}],
                         "lights": [{"id": "l", "power_w": 500, "type": "led"}]})
    assert e["savings_percent"] == 0.0
    assert e["recommendations"] == []


# ── 2. water ──────────────────────────────────────────────────────────────────

def test_open_loop_recommends_recirculation():
    w = optimize_water({"jets": [{"flow_lps": 5}, {"flow_lps": 5}], "pool": {"surface_area_m2": 50},
                        "operating_hours_per_day": 8, "recirculation": False})
    assert _approx(w["baseline_l_day"], 288200, 1)       # 288000 pumped + 200 evap
    assert w["savings_percent"] > 90
    assert any("recirculation" in r["action"].lower() for r in w["recommendations"])


def test_recirc_design_optimises_drift_and_evaporation():
    w = optimize_water({"jets": [{"flow_lps": 5, "height_m": 5}], "pool": {"surface_area_m2": 50},
                        "operating_hours_per_day": 8, "recirculation": True, "weather": {"wind_speed": 10}})
    assert w["savings_percent"] > 0
    assert any("wind" in r["action"].lower() or "tall-jet" in r["action"].lower()
               for r in w["recommendations"])


# ── 3. performance ────────────────────────────────────────────────────────────

def test_trims_low_impact_jets():
    p = optimize_performance({"jets": [
        {"id": "a", "impact": 1.0, "flow_lps": 1}, {"id": "b", "impact": 1.0, "flow_lps": 1},
        {"id": "c", "impact": 0.2, "flow_lps": 5}]})
    assert p["impact_retained_percent"] > 85
    assert p["efficiency_optimized"] > p["efficiency_baseline"]
    assert any("Trim" in r["action"] for r in p["recommendations"])


def test_output_rate_capped():
    p = optimize_performance({"jets": [{"impact": 1, "flow_lps": 1}], "output_hz": 120})
    assert any("44 Hz" in r["action"] for r in p["recommendations"])


def test_balanced_jets_not_trimmed():
    p = optimize_performance({"jets": [
        {"impact": 1, "flow_lps": 1}, {"impact": 1, "flow_lps": 1}, {"impact": 1, "flow_lps": 1}]})
    assert p["impact_retained_percent"] == 100.0
    assert not any("Trim" in r["action"] for r in p["recommendations"])


# ── aggregate ─────────────────────────────────────────────────────────────────

def test_analyze_optimises_all_three():
    res = analyze({
        "pumps": [{"id": "p1", "power_w": 4000, "speed": 1.0, "required_flow_fraction": 0.7, "hours_per_day": 10}],
        "lights": [{"id": "l1", "power_w": 800, "type": "incandescent", "hours_per_day": 6}],
        "jets": [{"impact": 1, "flow_lps": 1}, {"impact": 1, "flow_lps": 1}, {"impact": 0.2, "flow_lps": 5}],
        "pool": {"surface_area_m2": 60}, "recirculation": False,
        "tariff": {"energy_rate": 0.2, "water_rate": 0.002}, "operating_hours_per_day": 8})
    s = res["summary"]
    assert s["energy_savings_percent"] > 0
    assert s["water_savings_percent"] > 0
    assert s["performance_improvement_percent"] > 0
    assert s["recommendation_count"] >= 3
    assert s["total_cost_saving_per_day"] > 0


def test_analyze_empty_design_is_safe():
    res = analyze({})
    assert res["summary"]["energy_savings_percent"] == 0.0
    assert res["summary"]["recommendation_count"] == 0
