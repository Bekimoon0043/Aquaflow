"""
Contract tests for the Valve Authority Engine (AQ-X-007).

Asserts the three acceptance criteria:
  1. valve authority is calculated correctly (β, Kv↔ΔP, installed characteristic),
  2. flow-control recommendations are generated (rating, characteristic, target Kv),
  3. integration with the hydraulic solver is verified (a Kv-modelled valve in a
     network produces a solver head loss that matches the Kv formula at the solved flow).
"""
import math

import pytest

from services.valve_authority import (
    valve_delta_p_bar, kv_for_delta_p, authority, classify_authority,
    installed_flow, installed_characteristic, linearity_error, recommend,
    recommend_characteristic, kv_for_authority, kv_to_minor_loss,
    authority_from_network, analyze, BAR_TO_M,
)


def _approx(a, b, tol=1e-4):
    return abs(a - b) <= tol


# ── 1. authority maths ────────────────────────────────────────────────────────

@pytest.mark.parametrize("dpv,dprest,beta", [
    (1.0, 1.0, 0.5), (1.0, 3.0, 0.25), (1.0, 9.0, 0.10), (3.0, 1.0, 0.75),
])
def test_authority_formula(dpv, dprest, beta):
    assert _approx(authority(dpv, dprest), beta)


def test_classify_authority_bands():
    assert classify_authority(0.6) == "good"
    assert classify_authority(0.5) == "good"
    assert classify_authority(0.3) == "acceptable"
    assert classify_authority(0.24) == "poor"


def test_kv_delta_p_round_trip():
    assert _approx(valve_delta_p_bar(10, 10), 1.0)      # Q=Kv → ΔP=1
    assert _approx(valve_delta_p_bar(10, 20), 4.0)      # ΔP ∝ Q²
    assert _approx(kv_for_delta_p(1.0, 10.0), 10.0)
    assert _approx(kv_for_delta_p(valve_delta_p_bar(25, 30), 30.0), 25.0)


def test_installed_characteristic_distortion():
    assert _approx(installed_flow(1.0, 0.3), 1.0)       # fully open always q=1
    assert _approx(installed_flow(0.5, 1.0), 0.5)       # β=1 → installed == inherent
    assert installed_flow(0.5, 0.05) > 0.9              # low β: half-lift ≈ full flow
    chars = installed_characteristic(0.5, "linear")
    assert len(chars) == 11
    assert chars[0]["installed_flow"] == 0.0 and _approx(chars[-1]["installed_flow"], 1.0)


def test_linearity_error_zero_at_unit_authority():
    assert linearity_error(1.0, "linear") < 1e-9        # installed q = lift exactly
    assert linearity_error(0.1, "linear") > 0.2         # poor authority → big distortion


# ── 2. recommendations ────────────────────────────────────────────────────────

def test_recommend_good_authority():
    r = recommend(dp_valve_open_bar=1.0, dp_rest_bar=1.0, flow_m3h=10.0)
    assert r["rating"] == "good"
    assert r["recommended_characteristic"] in ("linear", "equal_percentage")


def test_recommend_oversized_valve():
    r = recommend(dp_valve_open_bar=0.1, dp_rest_bar=9.9, flow_m3h=10.0)
    assert r["rating"] == "poor"
    assert r["recommended_kv"]["oversized"] is True
    # a valve giving good authority must be smaller (lower Kv) than the current one
    assert r["recommended_kv"]["for_good_authority_beta_0_50"] < r["recommended_kv"]["current_kv"]
    assert r["messages"]


def test_kv_for_authority_targets_beta():
    # choose Kv so β=0.5 given rest drop; verify the resulting β is 0.5
    dp_rest, flow = 2.0, 20.0
    kv = kv_for_authority(dp_rest, flow, 0.5)
    dp_valve = valve_delta_p_bar(kv, flow)
    assert _approx(authority(dp_valve, dp_rest), 0.5, 1e-3)


def test_recommend_characteristic_prefers_eqpct_for_low_authority():
    # at low authority an equal-% inherent linearises the installed curve better
    assert recommend_characteristic(0.2) == "equal_percentage"


# ── 3. hydraulic-solver integration ───────────────────────────────────────────

def _network(kv, d=0.05):
    return {
        "method": "hazen-williams",
        "nodes": [{"id": "src", "fixed_head": 20.0}, {"id": "n1"}, {"id": "sink", "fixed_head": 0.0}],
        "pipes": [
            {"id": "line",  "from": "src", "to": "n1",   "length": 30.0, "diameter": d, "roughness": 130.0},
            {"id": "valve", "from": "n1",  "to": "sink", "length": 0.0,  "diameter": d,
             "minor_loss": kv_to_minor_loss(kv, d)},
        ],
    }


def test_authority_from_network_matches_kv_formula():
    kv = 25.0
    res = authority_from_network(_network(kv), "valve")
    assert res["converged"]
    assert 0.0 < res["authority"] < 1.0
    # the solver's valve head loss must equal the Kv head loss at the solved flow
    hl_from_kv = valve_delta_p_bar(kv, res["valve_flow_m3h"]) * BAR_TO_M
    assert _approx(res["valve_headloss_m"], hl_from_kv, max(1e-3, 1e-3 * hl_from_kv))


def test_authority_equals_headloss_ratio():
    res = authority_from_network(_network(25.0), "valve")
    assert _approx(res["authority"], res["valve_headloss_m"] / res["total_headloss_m"], 1e-3)


def test_bigger_kv_gives_lower_authority():
    small = authority_from_network(_network(25.0), "valve")
    big = authority_from_network(_network(100.0), "valve")
    assert big["authority"] < small["authority"]


def test_missing_valve_pipe_raises():
    with pytest.raises(KeyError):
        authority_from_network(_network(25.0), "no-such-valve")


# ── analyze() JSON entry ──────────────────────────────────────────────────────

def test_analyze_from_kv():
    a = analyze({"kv": 40.0, "flow_m3h": 30.0, "dp_rest_bar": 1.2})
    assert "authority" in a and a["rating"] in ("good", "acceptable", "poor")
    assert len(a["installed_characteristic"]) == 11
    assert a["dp_valve_bar"] > 0


def test_analyze_from_pressures():
    a = analyze({"dp_valve_bar": 2.0, "dp_rest_bar": 2.0, "flow_m3h": 10.0})
    assert _approx(a["authority"], 0.5)


def test_analyze_requires_valve_input():
    with pytest.raises(ValueError):
        analyze({"dp_rest_bar": 1.0, "flow_m3h": 10.0})
