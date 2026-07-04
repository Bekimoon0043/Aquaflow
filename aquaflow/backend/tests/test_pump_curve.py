"""
Contract tests for the Pump Curve Engine (AQ-X-006).

Asserts the three acceptance criteria against hand-solved algebra:
  1. pump curve data is integrated (quadratic fit through H–Q points),
  2. the operating point is the correct pump ∩ system-curve intersection,
  3. multiple pump configurations (parallel / series / variable speed) work.
"""
import math

import pytest

from services.pump_curve import (
    PumpCurve, SystemCurve, PumpSystem, operating_point, load_catalog_pump,
    analyze, PUMP_CATALOG, WATER_DENSITY, GRAVITY,
)


def _approx(a, b, tol=1e-4):
    return abs(a - b) <= tol


# Reference: pump H = 50 - 1000·Q², system H = 10 + 3000·Q²  →  Q=0.1, H=40.
REF_PUMP = PumpCurve(50.0, 0.0, -1000.0)
REF_SYS = SystemCurve(static_head=10.0, k=3000.0)


# ── 1. data integration ───────────────────────────────────────────────────────

def test_fit_from_points_matches_shutoff():
    pc = PumpCurve.from_points([0.0, 0.05, 0.1, 0.15, 0.2], [50, 48, 40, 27, 8])
    assert _approx(pc.shutoff_head, 50.0, 0.5)
    assert pc.head(0.0) > pc.head(0.2)          # monotonic decrease


def test_from_points_needs_three_points():
    with pytest.raises(ValueError):
        PumpCurve.from_points([0.0, 0.1], [50, 40])


@pytest.mark.parametrize("model", list(PUMP_CATALOG.keys()))
def test_catalog_pumps_are_well_formed(model):
    pc = load_catalog_pump(model)
    assert pc.shutoff_head > 0
    assert pc.max_flow > 0
    assert _approx(pc.head(pc.max_flow), 0.0, 1e-2)     # head → 0 at max flow


def test_flow_at_head_inverts_head():
    pc = load_catalog_pump("fountain-large")
    assert _approx(pc.flow_at_head(pc.head(0.1)), 0.1, 1e-4)
    assert pc.flow_at_head(pc.shutoff_head + 5) == 0.0  # above shutoff → no flow


# ── 2. operating point ────────────────────────────────────────────────────────

def test_operating_point_intersection():
    op = operating_point(REF_PUMP, REF_SYS)
    assert op["converged"] is True
    assert _approx(op["flow_m3s"], 0.10)
    assert _approx(op["head_m"], 40.0)
    assert _approx(op["residual_m"], 0.0, 1e-3)


def test_operating_point_hydraulic_power():
    op = operating_point(REF_PUMP, REF_SYS)
    assert _approx(op["hydraulic_power_w"], WATER_DENSITY * GRAVITY * 0.10 * 40.0, 1.0)


def test_no_duty_point_when_static_head_exceeds_shutoff():
    op = operating_point(REF_PUMP, SystemCurve(static_head=60.0, k=1000.0))
    assert op["converged"] is False


def test_efficiency_and_shaft_power():
    pc = PumpCurve.from_points([0.0, 0.05, 0.1, 0.15, 0.2], [50, 48, 40, 27, 8],
                               eff_points=([0.02, 0.08, 0.14], [0.55, 0.78, 0.6]))
    op = operating_point(pc, REF_SYS)
    assert op["efficiency"] is not None and 0 < op["efficiency"] <= 1
    assert _approx(op["shaft_power_w"], op["hydraulic_power_w"] / op["efficiency"], 1.0)


def test_system_curve_from_design_point():
    sys = SystemCurve.from_design_point(static_head=10.0, q_design=0.1, h_design=40.0)
    assert _approx(sys.k, 3000.0)               # (40-10)/0.1² = 3000
    assert _approx(sys.head(0.1), 40.0)


# ── 3. multiple configurations ────────────────────────────────────────────────

def test_parallel_moves_more_flow():
    par = PumpSystem([REF_PUMP, REF_PUMP], mode="parallel")
    op_single = operating_point(REF_PUMP, REF_SYS)
    op_par = operating_point(par, REF_SYS)
    assert op_par["flow_m3s"] > op_single["flow_m3s"]
    # 50 - 250Q² = 10 + 3000Q²  →  Q = sqrt(40/3250)
    assert _approx(op_par["flow_m3s"], math.sqrt(40.0 / 3250.0), 1e-3)
    # flow splits evenly across the two identical pumps
    assert _approx(op_par["per_pump_flow_m3s"][0], op_par["flow_m3s"] / 2.0, 1e-3)


def test_series_builds_more_head():
    ser = PumpSystem([REF_PUMP, REF_PUMP], mode="series")
    op_single = operating_point(REF_PUMP, REF_SYS)
    op_ser = operating_point(ser, REF_SYS)
    assert op_ser["head_m"] > op_single["head_m"]
    # 100 - 2000Q² = 10 + 3000Q²  →  Q = sqrt(0.018), H = 64
    assert _approx(op_ser["flow_m3s"], math.sqrt(0.018), 1e-3)
    assert _approx(op_ser["head_m"], 64.0, 0.05)
    # series: same flow through every pump
    assert op_ser["per_pump_flow_m3s"] == [op_ser["flow_m3s"], op_ser["flow_m3s"]]


def test_affinity_laws_scale_curve():
    half = REF_PUMP.at_speed(0.5)
    assert _approx(half.shutoff_head, 12.5)     # H ∝ s²
    assert _approx(half.head(0.05), 10.0)       # base head(0.1)=40 → 40·0.25 at Q·0.5
    assert _approx(half.max_flow, REF_PUMP.max_flow * 0.5, 1e-3)   # Q ∝ s


def test_pump_system_requires_pumps():
    with pytest.raises(ValueError):
        PumpSystem([], mode="parallel")


# ── analyze() JSON entry ──────────────────────────────────────────────────────

def test_analyze_end_to_end():
    res = analyze({
        "pump": {"model": "fountain-medium", "count": 2, "mode": "parallel"},
        "system": {"static_head": 8.0, "q_design": 0.06, "h_design": 40.0},
    })
    assert res["operating_point"]["converged"] is True
    assert res["configuration"]["mode"] == "parallel"
    assert res["operating_point"]["flow_m3s"] > 0


def test_analyze_with_raw_points_and_speed():
    res = analyze({
        "pump": {"flows": [0, 0.05, 0.1, 0.15, 0.2], "heads": [50, 48, 40, 27, 8],
                 "speed_ratio": 0.8},
        "system": {"static_head": 5.0, "k": 2000.0},
    })
    assert res["operating_point"]["converged"] is True
