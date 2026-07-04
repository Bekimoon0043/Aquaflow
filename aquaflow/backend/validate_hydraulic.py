"""
validate_hydraulic.py — AQ-X-015 verification

Confirms the old linear hydraulic approximation in geometry_service has been replaced
by the real Hazen-Williams / Darcy-Weisbach engine (services/hydraulic_solver.py):

  1. the correct formulas — the solver's head loss matches the Hazen-Williams and
     Darcy-Weisbach equations computed by hand,
  2. geometry_service.export_for_hydraulics now returns a real solver solution,
  3. the old ``turnover_rate_hint_hours`` approximation is gone.

Run:  python backend/validate_hydraulic.py   (from the aquaflow/ dir)
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.hydraulic_solver import solve_network, GRAVITY
from services.geometry_service import GeometryService, get_geometry_service

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


print("== 1. correct Hazen-Williams formula ==")
# R(head 50) -> J(demand 0.01), pipe L=100 m, d=0.1 m, C=130.
L, d, C, Q = 100.0, 0.1, 130.0, 0.01
r = 10.67 * L / (C ** 1.852 * d ** 4.87)
expected_hl = r * Q ** 1.852          # head loss (m)
net = {"method": "hazen-williams",
       "nodes": [{"id": "R", "fixed_head": 50.0}, {"id": "J", "demand": Q}],
       "pipes": [{"id": "P1", "from": "R", "to": "J", "length": L, "diameter": d, "roughness": C}]}
sol = solve_network(net)
p1 = next(p for p in sol["pipes"] if p["id"] == "P1")
j = next(n for n in sol["nodes"] if n["id"] == "J")
check("solver converged", sol["converged"])
check(f"HW head loss matches formula ({expected_hl:.4f} m)",
      abs(p1["headloss_m"] - expected_hl) < 1e-3, f'solver {p1["headloss_m"]:.4f} m')
check("node head = source − head loss", abs(j["head_m"] - (50.0 - expected_hl)) < 1e-3,
      f'{j["head_m"]:.4f} m')
check("flow conserved (P1 carries the 0.01 m³/s demand)",
      abs(p1["flow_m3s"] - Q) < 1e-6, f'{p1["flow_m3s"]:.6f}')
check("continuity residual ~0", sol["residuals"]["max_continuity"] < 1e-6)

print("== 2. correct Darcy-Weisbach formula ==")
f = 0.02
rd = 8.0 * f * L / (math.pi ** 2 * GRAVITY * d ** 5)
expected_dw = rd * Q ** 2
netd = {"method": "darcy",
        "nodes": [{"id": "R", "fixed_head": 50.0}, {"id": "J", "demand": Q}],
        "pipes": [{"id": "P1", "from": "R", "to": "J", "length": L, "diameter": d, "roughness": f}]}
sold = solve_network(netd)
p1d = next(p for p in sold["pipes"] if p["id"] == "P1")
check("DW head loss matches formula", abs(p1d["headloss_m"] - expected_dw) < 1e-3,
      f'solver {p1d["headloss_m"]:.4f} vs {expected_dw:.4f} m')

print("== 3. geometry_service uses the new solver ==")
gs = GeometryService()
nozzles = [{"id": "n1", "type": "nozzle_jet", "x": 0, "y": 0},
           {"id": "n2", "type": "nozzle_jet", "x": 3, "y": 0},
           {"id": "n3", "type": "geyser", "x": 0, "y": 3}]
hyd = gs._solve_pool_hydraulics(nozzles, {"width": 12, "length": 8, "depth": 0.8}, 76800.0)
check("hydraulics carries a real solver solution", hyd.get("hydraulic_solution") is not None)
check("solution converged with Hazen-Williams", hyd["converged"] and hyd["method"] == "hazen-williams")
check("total design flow computed from demands (3 × 0.5 L/s = 90 L/min)",
      abs(hyd["total_design_flow_lpm"] - 90.0) < 0.1, str(hyd["total_design_flow_lpm"]))
check("real turnover time reported", isinstance(hyd["turnover_time_hours"], (int, float)))
check("MAIN pipe carries the full flow (continuity)",
      abs(next(p["flow_lpm"] for p in hyd["hydraulic_solution"]["pipes"] if p["id"] == "MAIN") - 90.0) < 0.1)

print("== 4. old linear approximation removed ==")
check("no 'turnover_rate_hint_hours' key", "turnover_rate_hint_hours" not in hyd)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "services", "geometry_service.py"), encoding="utf-8").read()
# The old approximation was `volume * 1000 / max(1, len(nozzles) * 5)` — its unique
# signature is the `len(nozzles) * 5` divisor. (The name may survive in a docstring
# describing what was replaced.)
check("old linear-approximation code gone from source", "len(nozzles) * 5" not in src)
check("old approximation not emitted as a dict field",
      '"turnover_rate_hint_hours":' not in src)
check("geometry_service imports the real solver", "from services.hydraulic_solver import solve_network" in src)

print("== 5. full export_for_hydraulics round-trip ==")
svc = get_geometry_service()
saved = svc.save_project({"name": "AQ-X-015 Validate", "pool_type": "rectangular",
                          "params": {"width": 12, "length": 8, "depth": 0.8},
                          "fixtures": nozzles})
try:
    exp = svc.export_for_hydraulics(saved["id"])
    h = exp["hydraulics"]
    check("export hydraulics uses the solver", h.get("hydraulic_solution") is not None
          and h.get("converged") is True)
    check("export keeps geometry summary (volume litres)", h.get("volume_litres") is not None)
    check("export has no old approximation key", "turnover_rate_hint_hours" not in h)
finally:
    svc.delete_project(saved["id"])       # clean up the test project file

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
