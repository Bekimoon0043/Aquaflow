"""
Contract tests for the pipe sizing engine (AQ-S2-003).

Asserts the engine suggests a diameter, detects undersized pipes (velocity too
high), and detects oversized pipes (velocity too low), with configurable limits.
"""
import math

from services.pipe_sizing import (
    PipeSizingEngine, VelocityLimits, velocity, required_diameter,
    size_pipes, size_network,
)


def _v(flow, d):
    return flow / (math.pi * d * d / 4.0)


def test_suggests_a_standard_diameter():
    engine = PipeSizingEngine(VelocityLimits(0.6, 2.5, 1.5))
    label, d, vel = engine.suggest_size(0.03)
    assert label is not None and d is not None
    assert 0.6 <= vel <= 2.5
    # Rounded up to at least the target-velocity diameter.
    assert d >= required_diameter(0.03, 1.5) - 1e-9


def test_detects_undersized_and_suggests_larger():
    engine = PipeSizingEngine(VelocityLimits(0.6, 2.5, 1.5))
    res = engine.evaluate("P", 0.05, 0.1)   # v ≈ 6.4 m/s
    assert res.status == "undersized"
    assert abs(res.current_velocity_ms - _v(0.05, 0.1)) < 1e-3
    assert res.suggested_diameter_m > 0.1
    assert res.suggested_velocity_ms <= 2.5


def test_detects_oversized_and_suggests_smaller():
    engine = PipeSizingEngine(VelocityLimits(0.6, 2.5, 1.5))
    res = engine.evaluate("P", 0.002, 0.2)  # v ≈ 0.064 m/s
    assert res.status == "oversized"
    assert res.suggested_diameter_m < 0.2


def test_ok_band():
    engine = PipeSizingEngine(VelocityLimits(0.6, 2.5, 1.5))
    flow = 1.5 * (math.pi * 0.1 ** 2 / 4.0)   # exactly v=1.5 in DN100
    assert engine.evaluate("P", flow, 0.1).status == "ok"


def test_limits_are_configurable():
    flow = 1.5 * (math.pi * 0.1 ** 2 / 4.0)
    strict = PipeSizingEngine(VelocityLimits(0.6, 1.0, 0.9))
    assert strict.evaluate("P", flow, 0.1).status == "undersized"


def test_no_flow_is_not_flagged():
    engine = PipeSizingEngine()
    assert engine.evaluate("P", 0.0, 0.1).status == "no_flow"


def test_size_pipes_dict_api_summary():
    out = size_pipes({
        "pipes": [
            {"id": "a", "flow_m3s": 0.05, "diameter": 0.1},   # undersized
            {"id": "b", "flow_m3s": 0.002, "diameter": 0.2},  # oversized
        ],
        "velocity_limits": {"v_min": 0.6, "v_max": 2.5, "v_target": 1.5},
    })
    assert out["summary"]["undersized"] == 1
    assert out["summary"]["oversized"] == 1
    assert out["summary"]["issues"] == 2


def test_size_network_uses_solved_flows():
    out = size_network({
        "nodes": [{"id": "R", "fixed_head": 50}, {"id": "J", "demand": 0.03}],
        "pipes": [{"id": "feed", "from": "R", "to": "J",
                   "length": 50, "diameter": 0.05, "roughness": 130}],
        "velocity_limits": {"v_min": 0.6, "v_max": 2.5, "v_target": 1.5},
    })
    assert out["hydraulics"]["converged"]
    feed = next(p for p in out["pipes"] if p["pipe_id"] == "feed")
    assert feed["status"] == "undersized"
    assert feed["suggested_diameter_m"] > 0.05
