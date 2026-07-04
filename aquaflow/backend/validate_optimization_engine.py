"""
validate_optimization_engine.py — AQ-S5-002 verification

Hand-checked scenarios for the AI optimization engine:
  1. energy optimised (pump affinity P∝N³ + LED swap, cross-checked),
  2. water optimised (recirculation + drift/evaporation reduction),
  3. performance optimised (trim low impact-per-flow jets to raise efficiency).

Run:  python backend/validate_optimization_engine.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.optimization_engine import (
    optimize_energy, optimize_water, optimize_performance, analyze,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def approx(a, b, tol=1e-2):
    return abs(a - b) <= tol


print("== 1. energy optimised ==")
# Pump 4000 W at full speed but only 80% flow needed, 8 h/day. Affinity: opt = 4000·0.8³ = 2048 W.
# Base 4000 W → 32 kWh/day; opt 2048 W → 16.384 kWh/day; saving 15.616 (48.8%).
e = optimize_energy({"pumps": [{"id": "p1", "power_w": 4000, "speed": 1.0,
                                "required_flow_fraction": 0.8, "hours_per_day": 8}],
                     "lights": [{"id": "l1", "power_w": 1000, "type": "incandescent", "hours_per_day": 6}],
                     "tariff": {"energy_rate": 0.20}})
check("baseline 38 kWh/day (32 pump + 6 light)", approx(e["baseline_kwh_day"], 38, 0.01),
      str(e["baseline_kwh_day"]))
check("pump optimized via affinity (2.048 kW → 16.384 kWh)",
      approx(e["optimized_kwh_day"], 16.384 + 1.2, 0.01), str(e["optimized_kwh_day"]))
check("energy savings ≈ 53%", approx(e["savings_percent"], round((20.416) / 38 * 100, 1), 0.2),
      str(e["savings_percent"]))
check("pump speed reduction recommended", any("Reduce pump" in r["action"] for r in e["recommendations"]))
check("LED swap recommended", any("LED" in r["action"] for r in e["recommendations"]))
check("cost saving reported", e["cost_saving_per_day"] > 0)

print("== 2. water optimised ==")
# Open-loop: 2 jets × 5 L/s, 8 h → 288000 L/day pumped away; evap 200 L/day.
w = optimize_water({"jets": [{"id": "j1", "flow_lps": 5, "height_m": 4},
                             {"id": "j2", "flow_lps": 5, "height_m": 4}],
                    "pool": {"surface_area_m2": 50}, "operating_hours_per_day": 8,
                    "recirculation": False, "weather": {"wind_speed": 3}})
check("open-loop baseline ≈ 288200 L/day", approx(w["baseline_l_day"], 288200, 1), str(w["baseline_l_day"]))
check("recirculation recommended", any("recirculation" in r["action"].lower() for r in w["recommendations"]))
check("recirculation cuts water > 90%", w["savings_percent"] > 90, str(w["savings_percent"]))

# Already recirculating + windy tall jets → drift/evaporation optimisation.
w2 = optimize_water({"jets": [{"id": "j1", "flow_lps": 5, "height_m": 5}],
                     "pool": {"surface_area_m2": 50}, "operating_hours_per_day": 8,
                     "recirculation": True, "weather": {"wind_speed": 10}})
check("recirc design still finds savings", w2["savings_percent"] > 0, str(w2["savings_percent"]))
check("tall-jet-in-wind reduction recommended",
      any("tall-jet" in r["action"].lower() or "wind" in r["action"].lower() for r in w2["recommendations"]))

print("== 3. performance optimised ==")
# 3 jets: two good (impact 1 / flow 1), one wasteful (impact 0.2 / flow 5).
p = optimize_performance({"jets": [
    {"id": "a", "impact": 1.0, "flow_lps": 1}, {"id": "b", "impact": 1.0, "flow_lps": 1},
    {"id": "c", "impact": 0.2, "flow_lps": 5}]})
check("wasteful jet trimmed → impact mostly retained", p["impact_retained_percent"] > 85,
      str(p["impact_retained_percent"]))
check("efficiency improves (impact per flow up)", p["efficiency_optimized"] > p["efficiency_baseline"],
      f'{p["efficiency_baseline"]} -> {p["efficiency_optimized"]}')
check("trim recommended", any("Trim" in r["action"] for r in p["recommendations"]))
# Over-spec output rate is capped.
p2 = optimize_performance({"jets": [{"impact": 1, "flow_lps": 1}], "output_hz": 120})
check("output rate capped to 44 Hz", any("44 Hz" in r["action"] for r in p2["recommendations"]))

print("== 4. aggregate analyze() ==")
res = analyze({
    "pumps": [{"id": "p1", "power_w": 4000, "speed": 1.0, "required_flow_fraction": 0.7, "hours_per_day": 10}],
    "lights": [{"id": "l1", "power_w": 800, "type": "incandescent", "hours_per_day": 6}],
    "jets": [{"id": "a", "impact": 1, "flow_lps": 1}, {"id": "b", "impact": 1, "flow_lps": 1},
             {"id": "c", "impact": 0.2, "flow_lps": 5}],
    "pool": {"surface_area_m2": 60}, "recirculation": False,
    "tariff": {"energy_rate": 0.2, "water_rate": 0.002}, "operating_hours_per_day": 8,
})
check("report has energy/water/performance", all(k in res for k in ("energy", "water", "performance")))
check("summary lists all three optimisation percentages",
      all(k in res["summary"] for k in ("energy_savings_percent", "water_savings_percent",
                                        "performance_improvement_percent")))
check("all three optimised (savings > 0)",
      res["summary"]["energy_savings_percent"] > 0 and res["summary"]["water_savings_percent"] > 0
      and res["summary"]["performance_improvement_percent"] > 0)
check("recommendations aggregated", res["summary"]["recommendation_count"] >= 3)
check("total cost saving reported", res["summary"]["total_cost_saving_per_day"] > 0)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
