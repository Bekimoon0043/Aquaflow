"""
validate_wind_drift.py — AQ-X-012 verification

Hand-checked scenarios for the wind drift safety engine:
  1. wind drift is calculated from weather data (matches the flight-time × wind math),
  2. safety zones expand downwind and report keep-clear / barrier breaches,
  3. operator warnings are generated and severity-ranked.

Run:  python backend/validate_wind_drift.py   (from the aquaflow/ dir)
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.weather_engine import WeatherConditions, jet_time_of_flight, wind_drift
from services.wind_drift import (
    jet_drift, compute_safety_zones, operator_warnings, analyze,
    HIGH_WIND_SHUTDOWN_MS,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def approx(a, b, tol=1e-3):
    return abs(a - b) <= tol


print("== 1. wind drift calculated from weather data ==")
# t = 2*sqrt(2*4/9.81) = 1.8063 s ; drift = 0.5 * 5 * t = 4.5157 m
tof = jet_time_of_flight(4.0)
check("time of flight (h=4m) ≈ 1.806 s", approx(tof, 1.8063, 1e-3), f"{tof:.4f}")
drift = wind_drift(4.0, 5.0, 0.5)
check("drift = coupling·wind·t ≈ 4.516 m", approx(drift, 0.5 * 5.0 * tof, 1e-6), f"{drift:.4f}")
check("zero wind → zero drift", wind_drift(4.0, 0.0) == 0.0)

# West wind (from 270°) blows the spray toward +East.
cond = WeatherConditions(wind_speed=5.0, wind_direction=270.0)
jd = jet_drift({"id": "j1", "x": 0.0, "y": 0.0, "height": 4.0, "splash_radius": 0.5}, cond)
check("west wind drifts spray eastward (+x)", jd["landing"][0] > 0 and abs(jd["landing"][1]) < 1e-6,
      f'landing={tuple(round(c,3) for c in jd["landing"])}')
check("farthest wet = landing + splash downwind",
      approx(jd["farthest_wet"][0], jd["landing"][0] + 0.5, 1e-6))

print("== 2. safety zones update + breach detection ==")
fountain = {
    "keep_clear_m": 4.0,
    "jets": [{"id": "j1", "x": 0.0, "y": 0.0, "height": 4.0, "splash_radius": 0.5}],
    "barriers": [{"name": "spectator rail", "distance_m": 6.0}],
}
# calm: drift 0 → reach = splash = 0.5, well inside keep-clear.
calm = compute_safety_zones(fountain, WeatherConditions(wind_speed=0.0))
check("calm exclusion radius = splash (0.5 m)", approx(calm["exclusion_radius_m"], 0.5, 1e-3),
      f'{calm["exclusion_radius_m"]}')
check("calm: no breaches", calm["breaches"] == [])

# 5 m/s west wind: reach ≈ drift(4.516) + splash(0.5) = 5.016 m > keep_clear 4 → breach.
windy = compute_safety_zones(fountain, cond)
check("windy exclusion radius ≈ 5.016 m", approx(windy["exclusion_radius_m"], drift + 0.5, 1e-2),
      f'{windy["exclusion_radius_m"]}')
check("keep-clear breach detected", any(b["type"] == "keep_clear" for b in windy["breaches"]))
check("exceeded_by ≈ 1.016 m",
      approx(next(b for b in windy["breaches"] if b["type"] == "keep_clear")["exceeded_by_m"],
             (drift + 0.5) - 4.0, 1e-2))
check("real-time recompute is deterministic",
      compute_safety_zones(fountain, cond)["exclusion_radius_m"] == windy["exclusion_radius_m"])

# Strong wind breaches the 6 m barrier too.
strong = compute_safety_zones(fountain, WeatherConditions(wind_speed=8.0, wind_direction=270.0))
check("strong wind breaches the barrier", any(b["type"] == "barrier" for b in strong["breaches"]))

print("== 3. operator warnings ==")
warns = operator_warnings(windy, cond)
codes = {w["code"] for w in warns}
check("keep-clear breach warning present", "keep_clear_breach" in codes, str(codes))
check("breach warning is critical",
      any(w["code"] == "keep_clear_breach" and w["severity"] == "critical" for w in warns))

high = WeatherConditions(wind_speed=HIGH_WIND_SHUTDOWN_MS + 1, wind_direction=270.0)
hz = compute_safety_zones(fountain, high)
hw = operator_warnings(hz, high)
check("high wind → critical shutdown warning", any(w["code"] == "high_wind" for w in hw))
check("warnings sorted by severity (critical first)", hw[0]["severity"] == "critical")

calm_w = operator_warnings(calm, WeatherConditions(wind_speed=1.0))
check("calm conditions → single 'clear' info", len(calm_w) == 1 and calm_w[0]["code"] == "clear")

print("== 4. gust-only breach ==")
# Tune keep-clear so the mean is inside but a gust pushes past it.
f2 = {"keep_clear_m": 5.2,
      "jets": [{"id": "j1", "x": 0.0, "y": 0.0, "height": 4.0, "splash_radius": 0.5}]}
z2 = compute_safety_zones(f2, cond)
w2 = operator_warnings(z2, cond)
check("mean within keep-clear but gust exceeds it",
      z2["exclusion_radius_m"] <= 5.2 < z2["gust_exclusion_radius_m"],
      f'mean={z2["exclusion_radius_m"]}, gust={z2["gust_exclusion_radius_m"]}')
check("gust breach warning raised", any(w["code"] == "gust_breach" for w in w2))

print("== 5. analyze() JSON entry ==")
res = analyze({"fountain": fountain, "weather": {"wind_speed": 5.0, "wind_direction": 270.0}})
check("analyze returns zones + warnings + summary",
      "zones" in res and "warnings" in res and "summary" in res)
check("summary flags unsafe on breach", res["summary"]["safe"] is False)
check("summary carries exclusion radius", res["summary"]["exclusion_radius_m"] > 4.0)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
