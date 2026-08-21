"""
Contract tests for the hydraulic network solver (AQ-S2-001).

Asserts flow + pressure are computed at every node and that the conservation laws
hold for branched, looped, and closed-loop-recirculating networks.
"""
import math

from services.hydraulic_solver import (
    JET_EFFICIENCY,
    HydraulicNode, HydraulicPipe, HydraulicNetworkSolver, HW_EXPONENT, solve_network,
)


def _hw_headloss(Q, L, d, C):
    r = 10.67 * L / (C ** HW_EXPONENT * d ** 4.87)
    return r * abs(Q) ** (HW_EXPONENT - 1) * Q


def test_series_flow_and_pressure():
    nodes = [HydraulicNode("R", fixed_head=50.0), HydraulicNode("J", demand=0.01)]
    pipes = [HydraulicPipe("P1", "R", "J", length=100, diameter=0.1, roughness=130)]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert res.converged
    assert abs(res.pipe_flow["P1"] - 0.01) < 1e-7
    exp = _hw_headloss(0.01, 100, 0.1, 130)
    assert abs(res.node_head["J"] - (50.0 - exp)) < 1e-4
    assert res.max_continuity_residual < 1e-7


def test_branched_trunk_carries_sum_of_demands():
    nodes = [
        HydraulicNode("R", fixed_head=60.0),
        HydraulicNode("A"), HydraulicNode("B", demand=0.02), HydraulicNode("C", demand=0.03),
    ]
    pipes = [
        HydraulicPipe("trunk", "R", "A", length=200, diameter=0.15, roughness=130),
        HydraulicPipe("br1", "A", "B", length=150, diameter=0.10, roughness=130),
        HydraulicPipe("br2", "A", "C", length=120, diameter=0.10, roughness=130),
    ]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert res.topology["branched"] and not res.topology["has_loops"]
    assert abs(res.pipe_flow["trunk"] - 0.05) < 1e-6
    assert res.max_continuity_residual < 1e-6


def test_symmetric_loop_splits_evenly():
    nodes = [HydraulicNode("S", fixed_head=40.0), HydraulicNode("A"), HydraulicNode("B", demand=0.04)]
    pipes = [
        HydraulicPipe("feed", "S", "A", length=50, diameter=0.2, roughness=130),
        HydraulicPipe("top", "A", "B", length=100, diameter=0.1, roughness=130),
        HydraulicPipe("bot", "A", "B", length=100, diameter=0.1, roughness=130),
    ]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert res.topology["has_loops"] and res.topology["independent_loops"] == 1
    assert abs(res.pipe_flow["top"] - res.pipe_flow["bot"]) < 1e-7
    assert abs(res.pipe_flow["top"] - 0.02) < 1e-6
    assert res.max_loop_residual < 1e-6


def test_asymmetric_loop_analytic_split_darcy():
    nodes = [HydraulicNode("S", fixed_head=30.0), HydraulicNode("A"), HydraulicNode("B", demand=0.05)]
    pipes = [
        HydraulicPipe("feed", "S", "A", length=10, diameter=0.3, roughness=0.02),
        HydraulicPipe("p1", "A", "B", length=100, diameter=0.12, roughness=0.02),
        HydraulicPipe("p2", "A", "B", length=100, diameter=0.10, roughness=0.02),
    ]
    res = HydraulicNetworkSolver(method="darcy").solve(nodes, pipes)
    ratio = res.pipe_flow["p1"] / res.pipe_flow["p2"]
    assert abs(ratio - (0.12 / 0.10) ** 2.5) < 1e-3
    assert abs(res.pipe_flow["p1"] + res.pipe_flow["p2"] - 0.05) < 1e-6


def test_closed_loop_recirculation_conserves():
    nodes = [
        HydraulicNode("PUMP_OUT", fixed_head=55.0),
        HydraulicNode("PUMP_IN", fixed_head=5.0),
        HydraulicNode("J1", demand=0.01), HydraulicNode("J2", demand=0.01), HydraulicNode("J3", demand=0.01),
    ]
    pipes = [
        HydraulicPipe("supply", "PUMP_OUT", "J1", length=30, diameter=0.15, roughness=130),
        HydraulicPipe("m1", "J1", "J2", length=20, diameter=0.12, roughness=130),
        HydraulicPipe("m2", "J2", "J3", length=20, diameter=0.12, roughness=130),
        HydraulicPipe("ret1", "J3", "PUMP_IN", length=30, diameter=0.15, roughness=130),
        HydraulicPipe("bypass", "J1", "J3", length=45, diameter=0.10, roughness=130),
    ]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert res.converged and res.topology["has_loops"]
    assert res.max_continuity_residual < 1e-6
    assert res.max_loop_residual < 1e-6
    # Every node has a head and pressure.
    for n in nodes:
        assert n.id in res.node_head and n.id in res.node_pressure_m


def test_solve_network_dict_api_reports_pressure_units():
    payload = {
        "nodes": [{"id": "R", "fixed_head": 50.0}, {"id": "J", "demand": 0.01}],
        "pipes": [{"id": "P1", "from": "R", "to": "J", "length": 100, "diameter": 0.1, "roughness": 130}],
    }
    out = solve_network(payload)
    assert out["converged"]
    j = next(n for n in out["nodes"] if n["id"] == "J")
    # pressure_kpa ≈ rho*g*head/1000
    assert abs(j["pressure_kpa"] - 9.81 * j["pressure_m"]) < 1e-2
    assert out["topology"]["branched"] is True


def test_missing_fixed_head_raises():
    import pytest
    nodes = [HydraulicNode("A", demand=0.01), HydraulicNode("B", demand=0.01)]
    pipes = [HydraulicPipe("P", "A", "B", length=10, diameter=0.1, roughness=130)]
    with pytest.raises(ValueError):
        HydraulicNetworkSolver().solve(nodes, pipes)


# ── Emitter (nozzle) coupling — AQ-S2-002 ────────────────────────────────────
# A nozzle discharges to atmosphere, so its flow is SOLVED from the available head
# (q = k*p^0.5), not supplied as a fixed demand. These tests pin the physics to
# closed-form answers, so a regression shows up as a wrong number, not a crash.

def test_emitter_flow_matches_orifice_law_analytically():
    """Single nozzle straight off a reservoir through a very low-loss pipe.

    With negligible pipe loss the nozzle sees ~the reservoir head, so the solved
    flow must satisfy q = k*sqrt(p) to within the residual pipe loss.
    """
    k = 0.002  # m^3/s per sqrt(m)
    nodes = [
        HydraulicNode("R", fixed_head=25.0),
        HydraulicNode("NOZ", elevation=0.0, emitter_k=k),
    ]
    # Fat, short pipe => head loss is tiny, isolating the emitter law.
    pipes = [HydraulicPipe("P", "R", "NOZ", length=1.0, diameter=0.5, roughness=130)]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert res.converged

    p_solved = res.node_head["NOZ"] - 0.0
    q_expected = k * math.sqrt(p_solved)
    assert abs(res.emitter_flow["NOZ"] - q_expected) < 1e-9      # obeys the law exactly
    # And the pipe delivers exactly what the nozzle discharges (continuity).
    assert abs(res.pipe_flow["P"] - res.emitter_flow["NOZ"]) < 1e-9
    # Head at the nozzle is below the reservoir but close (low-loss pipe).
    assert 24.0 < p_solved <= 25.0


def test_emitter_exit_velocity_is_torricelli_and_jet_height_follows():
    """v = Cd*sqrt(2 g p) and h = JET_EFFICIENCY * v^2/2g."""
    nodes = [
        HydraulicNode("R", fixed_head=10.0),
        HydraulicNode("NOZ", elevation=0.0, emitter_k=0.001, discharge_coeff=1.0),
    ]
    pipes = [HydraulicPipe("P", "R", "NOZ", length=0.5, diameter=0.6, roughness=130)]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    p = res.node_head["NOZ"]
    assert abs(res.emitter_exit_velocity["NOZ"] - math.sqrt(2 * 9.81 * p)) < 1e-9
    # With Cd = 1 the jet height is JET_EFFICIENCY * p (since v^2/2g == p).
    assert abs(res.emitter_jet_height["NOZ"] - JET_EFFICIENCY * p) < 1e-6


def test_higher_nozzle_flows_less_than_lower_one():
    """Two identical nozzles at different elevations on a common manifold.

    The raised nozzle has less head above it, so by q = k*sqrt(p) it must pass
    less flow — and the ratio must equal sqrt(p_high/p_low).
    """
    k = 0.0015
    nodes = [
        HydraulicNode("R", fixed_head=30.0),
        HydraulicNode("MAN", elevation=0.0),
        HydraulicNode("LOW",  elevation=0.0,  emitter_k=k),
        HydraulicNode("HIGH", elevation=12.0, emitter_k=k),
    ]
    pipes = [
        HydraulicPipe("feed", "R", "MAN", length=5, diameter=0.3, roughness=130),
        HydraulicPipe("a", "MAN", "LOW",  length=5, diameter=0.2, roughness=130),
        HydraulicPipe("b", "MAN", "HIGH", length=5, diameter=0.2, roughness=130),
    ]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert res.converged
    q_low, q_high = res.emitter_flow["LOW"], res.emitter_flow["HIGH"]
    assert q_high < q_low                                   # elevation costs flow
    p_low = res.node_head["LOW"] - 0.0
    p_high = res.node_head["HIGH"] - 12.0
    assert abs(q_high / q_low - math.sqrt(p_high / p_low)) < 1e-6
    # The raised nozzle also produces a shorter jet.
    assert res.emitter_jet_height["HIGH"] < res.emitter_jet_height["LOW"]


def test_nozzle_above_hydraulic_grade_line_is_starved_not_negative():
    """A nozzle raised above the available head must discharge ZERO, never suck back."""
    nodes = [
        HydraulicNode("R", fixed_head=5.0),
        HydraulicNode("NOZ", elevation=40.0, emitter_k=0.002),   # far above the source
    ]
    pipes = [HydraulicPipe("P", "R", "NOZ", length=10, diameter=0.2, roughness=130)]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert res.emitter_flow["NOZ"] == 0.0
    assert res.emitter_jet_height["NOZ"] == 0.0


def test_fixed_demand_networks_are_unchanged_by_the_emitter_code():
    """Regression: with no emitter_k the solver must behave exactly as before."""
    nodes = [HydraulicNode("R", fixed_head=50.0), HydraulicNode("J", demand=0.01)]
    pipes = [HydraulicPipe("P1", "R", "J", length=100, diameter=0.1, roughness=130)]
    res = HydraulicNetworkSolver().solve(nodes, pipes)
    assert abs(res.pipe_flow["P1"] - 0.01) < 1e-7
    assert res.emitter_flow == {}
