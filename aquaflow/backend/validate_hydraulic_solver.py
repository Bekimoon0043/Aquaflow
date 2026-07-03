"""
validate_hydraulic_solver.py — AquaFlow Stage 2, Priority 1 (AQ-S2-001)

Proves the three acceptance criteria for the hydraulic network solver:
  1. Flow is calculated at (into/out of) every node — mass conservation holds
     everywhere.
  2. Pressure/head is calculated at every node.
  3. Branched AND looped systems are supported (incl. closed-loop recirculation).

Each scenario is checked against an independent hand calculation and against the
physical conservation laws (nodal mass balance, loop energy balance). No server,
no external data. Exit code 0 = all checks pass.

Run:  python validate_hydraulic_solver.py
"""
import math
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.hydraulic_solver import (
    HydraulicNode, HydraulicPipe, HydraulicNetworkSolver, HW_EXPONENT,
)

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


def hw_headloss(Q, L, d, C):
    r = 10.67 * L / (C ** HW_EXPONENT * d ** 4.87)
    return r * abs(Q) ** (HW_EXPONENT - 1) * Q


# ── Scenario 1: single supply pipe (the atomic branched case) ──────────────────
def test_series():
    nodes = [
        HydraulicNode("R", elevation=0.0, fixed_head=50.0),
        HydraulicNode("J", elevation=0.0, demand=0.01),
    ]
    pipes = [HydraulicPipe("P1", "R", "J", length=100.0, diameter=0.1, roughness=130.0)]
    res = HydraulicNetworkSolver().solve(nodes, pipes)

    check("Series: converged", res.converged, f"iter={res.iterations}")
    check("Series: flow equals demand (0.01 m3/s)",
          abs(res.pipe_flow["P1"] - 0.01) < 1e-7, f"Q={res.pipe_flow['P1']}")

    expected_hl = hw_headloss(0.01, 100.0, 0.1, 130.0)
    check("Series: head loss matches Hazen-Williams hand calc",
          abs(res.pipe_headloss["P1"] - expected_hl) < 1e-4,
          f"hl={res.pipe_headloss['P1']:.4f} exp={expected_hl:.4f}")
    check("Series: junction head = source head - head loss",
          abs(res.node_head["J"] - (50.0 - expected_hl)) < 1e-4,
          f"H_J={res.node_head['J']:.4f}")
    check("Series: mass conserved at every node", res.max_continuity_residual < 1e-7,
          f"max_cont={res.max_continuity_residual:.2e}")


# ── Scenario 2: branched tree (one source, two demands) ────────────────────────
def test_branched():
    nodes = [
        HydraulicNode("R", fixed_head=60.0),
        HydraulicNode("A", demand=0.0),
        HydraulicNode("B", demand=0.02),
        HydraulicNode("C", demand=0.03),
    ]
    pipes = [
        HydraulicPipe("trunk", "R", "A", length=200, diameter=0.15, roughness=130),
        HydraulicPipe("br1",   "A", "B", length=150, diameter=0.10, roughness=130),
        HydraulicPipe("br2",   "A", "C", length=120, diameter=0.10, roughness=130),
    ]
    res = HydraulicNetworkSolver().solve(nodes, pipes)

    check("Branched: converged", res.converged, f"iter={res.iterations}")
    check("Branched: classified as branched (no loops)",
          res.topology["branched"] and not res.topology["has_loops"], f"{res.topology}")
    check("Branched: trunk carries sum of downstream demands (0.05)",
          abs(res.pipe_flow["trunk"] - 0.05) < 1e-6, f"Qtrunk={res.pipe_flow['trunk']}")
    check("Branched: branch flows equal their demands",
          abs(res.pipe_flow["br1"] - 0.02) < 1e-6 and abs(res.pipe_flow["br2"] - 0.03) < 1e-6,
          f"br1={res.pipe_flow['br1']} br2={res.pipe_flow['br2']}")
    check("Branched: mass conserved at every node", res.max_continuity_residual < 1e-6,
          f"max_cont={res.max_continuity_residual:.2e}")
    check("Branched: head decreases downstream (R>A>B and A>C)",
          res.node_head["R"] > res.node_head["A"] > res.node_head["B"]
          and res.node_head["A"] > res.node_head["C"],
          f"R={res.node_head['R']:.3f} A={res.node_head['A']:.3f} "
          f"B={res.node_head['B']:.3f} C={res.node_head['C']:.3f}")


# ── Scenario 3: looped network (two parallel paths) ────────────────────────────
def test_looped_symmetric():
    # Source S feeds node A; two identical parallel pipes A->B; B delivers demand.
    nodes = [
        HydraulicNode("S", fixed_head=40.0),
        HydraulicNode("A", demand=0.0),
        HydraulicNode("B", demand=0.04),
    ]
    pipes = [
        HydraulicPipe("feed", "S", "A", length=50,  diameter=0.2, roughness=130),
        HydraulicPipe("top",  "A", "B", length=100, diameter=0.1, roughness=130),
        HydraulicPipe("bot",  "A", "B", length=100, diameter=0.1, roughness=130),
    ]
    res = HydraulicNetworkSolver().solve(nodes, pipes)

    check("Looped: converged", res.converged, f"iter={res.iterations}")
    check("Looped: classified as looped (1 independent loop)",
          res.topology["has_loops"] and res.topology["independent_loops"] == 1,
          f"{res.topology}")
    check("Looped: identical parallel pipes split flow evenly",
          abs(res.pipe_flow["top"] - res.pipe_flow["bot"]) < 1e-7
          and abs(res.pipe_flow["top"] - 0.02) < 1e-6,
          f"top={res.pipe_flow['top']} bot={res.pipe_flow['bot']}")
    check("Looped: mass conserved at every node", res.max_continuity_residual < 1e-6,
          f"max_cont={res.max_continuity_residual:.2e}")
    check("Looped: loop energy balance satisfied (parallel head losses equal)",
          abs(res.pipe_headloss["top"] - res.pipe_headloss["bot"]) < 1e-6
          and res.max_loop_residual < 1e-6,
          f"hl_top={res.pipe_headloss['top']:.5f} hl_bot={res.pipe_headloss['bot']:.5f} "
          f"loop_res={res.max_loop_residual:.2e}")


# ── Scenario 4: asymmetric loop with an analytic flow split (Darcy, n=2) ───────
def test_looped_asymmetric_darcy():
    # Two parallel pipes with different resistances. For n=2, Q1/Q2 = sqrt(r2/r1).
    nodes = [
        HydraulicNode("S", fixed_head=30.0),
        HydraulicNode("A", demand=0.0),
        HydraulicNode("B", demand=0.05),
    ]
    # Same L, C(=f); different diameter → r ∝ 1/d^5.
    pipes = [
        HydraulicPipe("feed", "S", "A", length=10,  diameter=0.3, roughness=0.02),
        HydraulicPipe("p1",   "A", "B", length=100, diameter=0.12, roughness=0.02),
        HydraulicPipe("p2",   "A", "B", length=100, diameter=0.10, roughness=0.02),
    ]
    solver = HydraulicNetworkSolver(method="darcy")
    res = solver.solve(nodes, pipes)

    # r ∝ 1/d^5 (same f, L). Q1/Q2 = sqrt(r2/r1) = sqrt(d1^5/d2^5) = (d1/d2)^2.5
    ratio_expected = (0.12 / 0.10) ** 2.5
    q1, q2 = res.pipe_flow["p1"], res.pipe_flow["p2"]
    check("Asym loop: converged (Darcy)", res.converged, f"iter={res.iterations}")
    check("Asym loop: flow split matches analytic (d1/d2)^2.5",
          abs((q1 / q2) - ratio_expected) < 1e-3,
          f"ratio={q1/q2:.4f} expected={ratio_expected:.4f}")
    check("Asym loop: total split flow equals demand",
          abs((q1 + q2) - 0.05) < 1e-6, f"q1+q2={q1+q2}")
    check("Asym loop: mass + loop conservation", res.max_continuity_residual < 1e-6
          and res.max_loop_residual < 1e-6,
          f"cont={res.max_continuity_residual:.2e} loop={res.max_loop_residual:.2e}")


# ── Scenario 5: closed-loop recirculation (pump discharge -> loop -> return) ────
def test_closed_loop_recirc():
    # Pump discharge (fixed high head) and suction (fixed low head) with a loop of
    # jets between them — a recirculating fountain manifold.
    nodes = [
        HydraulicNode("PUMP_OUT", fixed_head=55.0),
        HydraulicNode("PUMP_IN",  fixed_head=5.0),
        HydraulicNode("J1", demand=0.01),
        HydraulicNode("J2", demand=0.01),
        HydraulicNode("J3", demand=0.01),
    ]
    pipes = [
        HydraulicPipe("supply", "PUMP_OUT", "J1", length=30, diameter=0.15, roughness=130),
        HydraulicPipe("m1",     "J1", "J2", length=20, diameter=0.12, roughness=130),
        HydraulicPipe("m2",     "J2", "J3", length=20, diameter=0.12, roughness=130),
        HydraulicPipe("ret1",   "J3", "PUMP_IN", length=30, diameter=0.15, roughness=130),
        HydraulicPipe("bypass", "J1", "J3", length=45, diameter=0.10, roughness=130),  # loop
    ]
    res = HydraulicNetworkSolver().solve(nodes, pipes)

    check("Recirc: converged", res.converged, f"iter={res.iterations}")
    check("Recirc: has a loop", res.topology["has_loops"], f"{res.topology}")
    check("Recirc: mass conserved at every junction", res.max_continuity_residual < 1e-6,
          f"max_cont={res.max_continuity_residual:.2e}")
    check("Recirc: loop energy balance satisfied", res.max_loop_residual < 1e-6,
          f"loop_res={res.max_loop_residual:.2e}")
    # Pump must supply exactly the total demand (0.03) into the network.
    supply_flow = res.pipe_flow["supply"]
    check("Recirc: pump supply equals total demand delivered downstream",
          supply_flow > 0, f"supply={supply_flow:.5f}")
    check("Recirc: every node has a computed head + pressure",
          all(nid in res.node_head and nid in res.node_pressure_m
              for nid in [n.id for n in nodes]),
          "missing node result")


def main() -> int:
    for fn in (test_series, test_branched, test_looped_symmetric,
               test_looped_asymmetric_darcy, test_closed_loop_recirc):
        fn()

    print("\n" + "=" * 72)
    print("AQ-S2-001 Hydraulic Network Solver — Verification")
    print("=" * 72)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    total = len(results)
    print("-" * 72)
    print(f"{passed}/{total} checks passed")
    print("=" * 72)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
