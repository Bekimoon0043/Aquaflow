"""
validate_pump_curve.py — AQ-X-006 verification

Hand-checked scenarios for the pump curve engine:
  1. pump curve data integrated (quadratic fit through manufacturer H–Q points),
  2. operating point correct (pump ∩ system curve, cross-checked against algebra),
  3. multiple pump configurations (parallel, series, variable-speed affinity laws).

All heads/flows below are cross-checked by solving the quadratic intersection by hand.

Run:  python backend/validate_pump_curve.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import math
from services.pump_curve import (
    PumpCurve, SystemCurve, PumpSystem, operating_point, load_catalog_pump,
    analyze, GRAVITY, WATER_DENSITY,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def approx(a, b, tol=1e-4):
    return abs(a - b) <= tol


# Reference pump: H = 50 - 1000·Q²  (shutoff 50 m). System: H = 10 + 3000·Q².
pump = PumpCurve(50.0, 0.0, -1000.0, name="ref")
system = SystemCurve(static_head=10.0, k=3000.0)

print("== 1. pump curve data integrated ==")
cat = load_catalog_pump("fountain-medium")
check("catalog pump fits (shutoff ~ 48 m)", approx(cat.shutoff_head, 48.0, 1.5),
      f"{cat.shutoff_head:.2f} m")
check("head decreases with flow", cat.head(0.03) > cat.head(0.09))
check("fit passes near a data point (Q=0.06 → ~39 m)", approx(cat.head(0.06), 39.0, 2.0),
      f"{cat.head(0.06):.2f} m")
check("max flow found (head→0)", approx(cat.head(cat.max_flow), 0.0, 1e-3),
      f"maxQ={cat.max_flow:.4f}")
check("flow_at_head inverts head", approx(cat.flow_at_head(cat.head(0.05)), 0.05, 1e-4))

print("== 2. operating point correct ==")
# 50 - 1000Q² = 10 + 3000Q²  →  40 = 4000Q²  →  Q = 0.1, H = 40.
op = operating_point(pump, system)
check("duty flow Q = 0.10 m³/s", approx(op["flow_m3s"], 0.10), f'{op["flow_m3s"]:.5f}')
check("duty head H = 40 m", approx(op["head_m"], 40.0), f'{op["head_m"]:.4f}')
check("pump head == system head at duty", approx(op["residual_m"], 0.0, 1e-3))
check("hydraulic power = ρgQH", approx(op["hydraulic_power_w"],
      WATER_DENSITY * GRAVITY * 0.10 * 40.0, 1.0), f'{op["hydraulic_power_w"]:.1f} W')

# No-duty case: static head above the pump's shutoff head.
noop = operating_point(pump, SystemCurve(static_head=60.0, k=1000.0))
check("no duty point when static head > shutoff", noop["converged"] is False)

print("== 2b. efficiency + shaft power ==")
effpump = PumpCurve.from_points([0.0, 0.05, 0.1, 0.15, 0.2], [50, 48, 40, 27, 8],
                                eff_points=([0.02, 0.08, 0.14], [0.55, 0.78, 0.6]))
ope = operating_point(effpump, system)
check("efficiency reported at duty", ope.get("efficiency") is not None
      and 0.0 < ope["efficiency"] <= 1.0, str(ope.get("efficiency")))
check("shaft power = hydraulic / efficiency",
      approx(ope["shaft_power_w"], ope["hydraulic_power_w"] / ope["efficiency"], 1.0))

print("== 3. multiple pump configurations ==")
# Parallel (2×): head(Q) = 50 - 250Q². 50-250Q² = 10+3000Q² → 40=3250Q² → Q=0.11094.
par = PumpSystem([pump, pump], mode="parallel")
opp = operating_point(par, system)
q_par = math.sqrt(40.0 / 3250.0)
check("parallel duty flow matches algebra", approx(opp["flow_m3s"], q_par, 1e-3),
      f'{opp["flow_m3s"]:.5f} vs {q_par:.5f}')
check("parallel moves MORE flow than single", opp["flow_m3s"] > op["flow_m3s"])
check("parallel splits flow evenly across pumps",
      approx(opp["per_pump_flow_m3s"][0], opp["flow_m3s"] / 2.0, 1e-3))

# Series (2×): head(Q) = 100 - 2000Q². 100-2000Q² = 10+3000Q² → 90=5000Q² → Q=0.13416, H=64.
ser = PumpSystem([pump, pump], mode="series")
ops = operating_point(ser, system)
check("series duty flow = 0.13416", approx(ops["flow_m3s"], math.sqrt(0.018), 1e-3),
      f'{ops["flow_m3s"]:.5f}')
check("series duty head = 64 m", approx(ops["head_m"], 64.0, 0.05), f'{ops["head_m"]:.3f}')
check("series builds MORE head than single", ops["head_m"] > op["head_m"])

print("== 3b. variable speed (affinity laws) ==")
half = pump.at_speed(0.5)
check("shutoff head scales with s² (50→12.5)", approx(half.shutoff_head, 12.5),
      f"{half.shutoff_head:.3f}")
# At the same flow, a point on the base curve maps: Q→Q·s, H→H·s².
# base head(0.1)=40 → scaled head(0.05) should be 40·0.25 = 10.
check("affinity maps duty point (Q·s, H·s²)", approx(half.head(0.05), 10.0, 1e-6),
      f"{half.head(0.05):.4f}")
check("slower pump delivers less flow at same system",
      operating_point(half, system)["flow_m3s"] < op["flow_m3s"]
      if operating_point(half, system)["converged"] else True)

print("== 4. JSON analyze() entry point ==")
res = analyze({"pump": {"model": "fountain-large", "count": 2, "mode": "parallel"},
               "system": {"static_head": 8.0, "q_design": 0.15, "h_design": 45.0}})
check("analyze returns a converged duty point",
      res["operating_point"]["converged"] is True, str(res["operating_point"].get("flow_m3s")))
check("analyze reports the configuration", res["configuration"]["mode"] == "parallel")

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
