"""
validate_valve_authority.py — AQ-X-007 verification

Hand-checked scenarios for the valve authority engine:
  1. authority is calculated correctly (β = ΔPv/(ΔPv+ΔPrest), Kv↔ΔP, installed curve),
  2. flow-control recommendations are generated (rating, characteristic, target Kv),
  3. integration with the hydraulic solver: a Kv-modelled valve dropped into a network
     produces a solver head loss that matches the Kv formula at the solved flow.

Run:  python backend/validate_valve_authority.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.valve_authority import (
    valve_delta_p_bar, kv_for_delta_p, authority, classify_authority,
    installed_flow, linearity_error, recommend, kv_to_minor_loss,
    authority_from_network, analyze, BAR_TO_M, M3H_PER_M3S,
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


print("== 1. valve authority calculated correctly ==")
# β = ΔPv/(ΔPv+ΔPrest)
check("equal drops → β = 0.5", approx(authority(1.0, 1.0), 0.5))
check("ΔPv=1, ΔPrest=3 → β = 0.25", approx(authority(1.0, 3.0), 0.25))
check("ΔPv=1, ΔPrest=9 → β = 0.10", approx(authority(1.0, 9.0), 0.10))
check("ΔPv=3, ΔPrest=1 → β = 0.75", approx(authority(3.0, 1.0), 0.75))
check("classify 0.6 good", classify_authority(0.6) == "good")
check("classify 0.3 acceptable", classify_authority(0.3) == "acceptable")
check("classify 0.1 poor", classify_authority(0.1) == "poor")

# Kv ↔ ΔP: Q = Kv·√(ΔP/SG). Kv=10, Q=10 m³/h → ΔP = 1 bar; Q=20 → 4 bar.
check("Kv=10 @ 10 m³/h → ΔP 1 bar", approx(valve_delta_p_bar(10, 10), 1.0))
check("Kv=10 @ 20 m³/h → ΔP 4 bar", approx(valve_delta_p_bar(10, 20), 4.0))
check("kv_for_delta_p inverts", approx(kv_for_delta_p(1.0, 10.0), 10.0))

# Installed characteristic distortion.
check("installed q(1) = 1 for any β", approx(installed_flow(1.0, 0.3), 1.0))
check("β=1 → installed == inherent", approx(installed_flow(0.5, 1.0), 0.5))
check("low β distorts (half-lift ≈ full flow)", installed_flow(0.5, 0.01) > 0.95,
      f"{installed_flow(0.5, 0.01):.3f}")
check("high-authority linear valve is near-linear",
      linearity_error(1.0, "linear") < 1e-9)

print("== 2. flow-control recommendations ==")
good = recommend(dp_valve_open_bar=1.0, dp_rest_bar=1.0, flow_m3h=10.0)
check("β=0.5 rated good", good["rating"] == "good", str(good["authority"]))
poor = recommend(dp_valve_open_bar=0.1, dp_rest_bar=9.9, flow_m3h=10.0)
check("oversized valve rated poor", poor["rating"] == "poor", str(poor["authority"]))
check("poor valve flagged oversized", poor["recommended_kv"]["oversized"] is True)
check("recommended Kv for good authority is smaller than current",
      poor["recommended_kv"]["for_good_authority_beta_0_50"] < poor["recommended_kv"]["current_kv"],
      f'{poor["recommended_kv"]}')
check("recommendation carries a message", len(poor["messages"]) >= 1)
acc = recommend(dp_valve_open_bar=1.0, dp_rest_bar=2.5, flow_m3h=10.0)  # β≈0.286
check("mid authority rated acceptable", acc["rating"] == "acceptable", str(acc["authority"]))

print("== 3. integration with the hydraulic solver ==")
Kv = 25.0
d = 0.05
K = kv_to_minor_loss(Kv, d)                     # valve as a solver minor loss
network = {
    "method": "hazen-williams",
    "nodes": [{"id": "src", "fixed_head": 20.0}, {"id": "n1"}, {"id": "sink", "fixed_head": 0.0}],
    "pipes": [
        {"id": "line",  "from": "src", "to": "n1",   "length": 30.0, "diameter": d, "roughness": 130.0},
        {"id": "valve", "from": "n1",  "to": "sink", "length": 0.0,  "diameter": d, "minor_loss": K},
    ],
}
res = authority_from_network(network, "valve")
check("solver converged", res["converged"])
check("authority in (0,1)", 0.0 < res["authority"] < 1.0, str(res["authority"]))
# Cross-check: the valve head loss the SOLVER reports must equal the Kv formula at
# the flow the solver found.
q_m3h = res["valve_flow_m3h"]
hl_from_kv = valve_delta_p_bar(Kv, q_m3h) * BAR_TO_M
check("solver valve head loss matches Kv formula at solved flow",
      approx(res["valve_headloss_m"], hl_from_kv, max(1e-4, 1e-3 * hl_from_kv)),
      f'solver={res["valve_headloss_m"]:.4f} m, Kv-calc={hl_from_kv:.4f} m')
check("β equals headloss ratio",
      approx(res["authority"],
             res["valve_headloss_m"] / res["total_headloss_m"], 1e-3))
# A much larger Kv (less restrictive valve) must give LOWER authority.
K_big = kv_to_minor_loss(Kv * 4, d)
net2 = {**network, "pipes": [network["pipes"][0],
        {**network["pipes"][1], "minor_loss": K_big}]}
res2 = authority_from_network(net2, "valve")
check("bigger Kv → lower authority", res2["authority"] < res["authority"],
      f'{res2["authority"]:.3f} < {res["authority"]:.3f}')

print("== 4. JSON analyze() entry point ==")
a = analyze({"kv": 40.0, "flow_m3h": 30.0, "dp_rest_bar": 1.2})
check("analyze returns authority + rating", "authority" in a and "rating" in a, str(a.get("rating")))
check("analyze includes installed characteristic", len(a["installed_characteristic"]) == 11)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
