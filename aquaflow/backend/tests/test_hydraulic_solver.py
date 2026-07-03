"""
Contract tests for the hydraulic network solver (AQ-S2-001).

Asserts flow + pressure are computed at every node and that the conservation laws
hold for branched, looped, and closed-loop-recirculating networks.
"""
import math

from services.hydraulic_solver import (
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
