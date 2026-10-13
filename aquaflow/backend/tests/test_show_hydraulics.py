"""AF-NEXT-007 — time-dependent hydraulic evaluator (services/show_hydraulics.py)."""
import asyncio
import math

import pytest

from api.routes import hydraulics_routes
from services.show_hydraulics import (FILLING, OK, RAMPING, UNDER, VALVE, evaluate_show_hydraulics,
                                      show_timeline)

DIAG_KEYS = {"code", "severity", "timeMs", "fixtureId", "clipId", "engineeringItemId", "message", "fix", "source"}


def nozzle(i, pump="P1", valve=None, x=None):
    return {"id": f"N{i}", "type": "nozzle_straight_dn25", "x": x if x is not None else 2.0 + i, "y": 5.0,
            "engineering": {"flowLpm": 82.16, "pressureBar": 1.2, "jetHeightM": 9.79, "connectionSize": "DN25",
                            "pumpId": pump, "valveId": valve}}


def pump(flow_lpm, head_m, **extra):
    return {"id": "P1", "type": "pump_submersible_3kw", "x": 0.0, "y": 5.0,
            "engineering": {"flowLpm": flow_lpm, "headM": head_m, "connectionSize": "DN80", **extra}}


def clip(cid, fid, start, end, value=100, ctype="device_intensity"):
    return {"id": cid, "fixtureId": fid, "type": ctype, "startTime": start, "duration": end - start, "value": value}


FILLED = {"pipes_initially_filled": True, "pump_tau_s": 0.01, "solenoid_response_s": 0.0}


def at(tl, nid, t_ms, key="heightM"):
    times = tl["timesMs"]
    i = min(range(len(times)), key=lambda k: abs(times[k] - t_ms))
    return tl["nozzles"][nid][key][i]


def codes(tl):
    return {d["code"] for d in tl["diagnostics"]}


def test_overloaded_pump_lowers_jets_and_reports_overload():
    show = {"clips": [clip(f"c{i}", f"N{i}", 0, 10) for i in range(8)]}
    big = evaluate_show_hydraulics({"fixtures": [pump(1000, 22)] + [nozzle(i) for i in range(8)]}, show, FILLED)
    small = evaluate_show_hydraulics({"fixtures": [pump(366.67, 12)] + [nozzle(i) for i in range(8)]}, show, FILLED)
    h_big, h_small = at(big, "N0", 5000), at(small, "N0", 5000)
    assert h_big == pytest.approx(9.79, rel=0.11)          # adequate pump holds the jet near design
    assert h_small < 0.75 * h_big                             # overloaded pump visibly lowers it
    assert "PUMP_OVERLOAD" not in codes(big)
    over = [d for d in small["diagnostics"] if d["code"] == "PUMP_OVERLOAD"]
    assert over and over[0]["severity"] == "warning" and over[0]["engineeringItemId"] == "P1"   # assumed curve
    assert "enter verified pump curve data" in over[0]["message"]
    assert over[0]["timeMs"] is not None and over[0]["clipId"] in {f"c{i}" for i in range(8)}
    assert "NOZZLE_UNDER_PRESSURE" in codes(small)
    assert at(small, "N0", 5000, "state") == UNDER
    # pump is a PumpCurve at speed, not a fixed head: operating head sits on the curve
    p = small["pumps"]["P1"]
    i = small["timesMs"].index(5000.0)
    c0, c1, c2 = p["curve"]["coeffs"]
    q = p["flowLpm"][i] / 60000.0
    assert p["headM"][i] == pytest.approx(c0 + c1 * q + c2 * q * q, abs=0.01)
    assert p["drive"] == "implicit"


def test_closed_upstream_valve_removes_jets():
    fixtures = [pump(1000, 22), {"id": "V1", "type": "valve_solenoid_dn25_24v", "x": 3.0, "y": 5.0,
                                 "engineering": {"connectionSize": "DN40", "valveType": "Solenoid"}},
                nozzle(0, valve="V1"), nozzle(1, valve="V1"), nozzle(2)]
    show = {"clips": [clip("j0", "N0", 0, 10), clip("j1", "N1", 0, 10), clip("j2", "N2", 0, 10),
                      clip("v", "V1", 0, 5, ctype="solenoid_open")]}
    tl = evaluate_show_hydraulics({"fixtures": fixtures}, show, FILLED)
    assert at(tl, "N0", 3000) > 5 and at(tl, "N2", 3000) > 5
    assert at(tl, "N0", 7000) == 0 and at(tl, "N1", 7000) == 0
    assert at(tl, "N0", 7000, "state") == VALVE
    assert at(tl, "N2", 7000) > 5                         # a jet on another branch keeps running
    closed = [d for d in tl["diagnostics"] if d["code"] == "VALVE_CLOSED_UPSTREAM"]
    assert {d["fixtureId"] for d in closed} == {"N0", "N1"}
    assert all(d["engineeringItemId"] == "V1" and d["timeMs"] == 5000.0 for d in closed)
    assert closed[0]["fix"] == {"kind": "open_clip", "target": closed[0]["clipId"]}
    assert tl["valves"]["V1"]["drive"] == "programmed"


def test_pump_ramp_and_pipe_fill_delay_jets():
    fixtures = [pump(1000, 22, rampTimeConstantS=2.0), nozzle(0)]
    show = {"clips": [clip("c0", "N0", 1, 15)]}
    tl = evaluate_show_hydraulics({"fixtures": fixtures}, show, {"pipes_initially_filled": True,
                                                              "drain_when_idle": False})
    early, late = at(tl, "N0", 1500), at(tl, "N0", 12000)
    assert late == pytest.approx(9.79, rel=0.11)
    assert early < 0.5 * late
    assert at(tl, "N0", 1500, "state") == RAMPING
    assert tl["pumps"]["P1"]["rampSource"].startswith("EQUIPMENT")
    assert tl["pumps"]["P1"]["rampTauS"] == 2.0
    delayed = [d for d in tl["diagnostics"] if d["code"] == "JET_DELAYED"]
    assert delayed and delayed[0]["timeMs"] == pytest.approx(1000, abs=150)
    # pipe fill: empty pipes hold the jet back for volume / flow
    fill = evaluate_show_hydraulics({"fixtures": [pump(1000, 22, rampTimeConstantS=0.01), nozzle(0)]}, show,
                                    {"pipes_initially_filled": False})
    states = fill["nozzles"]["N0"]["state"]
    assert FILLING in states
    first_ok = fill["timesMs"][states.index(OK)]
    assert 1100 < first_ok < 10000                    # ≈ path volume (≈10.5 L) / solved flow
    # default ramp is labelled as a default
    dflt = evaluate_show_hydraulics({"fixtures": [pump(1000, 22), nozzle(0)]}, show)
    assert dflt["pumps"]["P1"]["rampSource"].startswith("DEFAULT")


def test_si_units_provenance_and_convergence_reports():
    tl = evaluate_show_hydraulics({"fixtures": [pump(1000, 22), nozzle(0), nozzle(1)]},
                                  {"clips": [clip("a", "N0", 0, 4), clip("b", "N1", 0, 4)]}, FILLED)
    assert tl["units"]["height"] == "m" and tl["units"]["velocity"] == "m/s" and tl["units"]["time"] == "ms"
    i = tl["timesMs"].index(2000.0)
    n = tl["nozzles"]["N0"]
    # velocity, flow and height agree with the SI relations of the nozzle model
    p_eff = 1.2 * 10.19716213 * n["heightM"][i] / 9.79
    assert n["exitVelocityMs"][i] == pytest.approx(0.97 * math.sqrt(2 * 9.81 * p_eff), rel=1e-3)
    assert n["flowLpm"][i] == pytest.approx(82.16 * math.sqrt(p_eff / (1.2 * 10.19716213)), rel=1e-3)
    assert tl["converged"] is True
    s = tl["solves"][tl["pumps"]["P1"]["solve"][i]]
    assert s["converged"] and s["operatingPoint"]["converged"]
    assert s["residuals"]["max_continuity"] < 1e-6 and s["operatingPoint"]["residual_m"] < 1e-3
    assert n["equipment"]["data_source"] == "generic_estimate"
    assert tl["pumps"]["P1"]["equipment"]["curve_basis"].startswith("duty point")
    assert tl["data_provenance"]
    assert any(a["key"] == "pump_tau_default_s" and a["source"] == "DEFAULT" for a in tl["assumptions"])
    assert "PUMP_CURVE_ASSUMED" in codes(tl)
    for d in tl["diagnostics"]:
        assert DIAG_KEYS <= set(d) and d["source"] == "hydraulics"


def test_solver_non_convergence_is_reported():
    tl = evaluate_show_hydraulics({"fixtures": [pump(1000, 22), nozzle(0), nozzle(1)]},
                                  {"clips": [clip("a", "N0", 0, 2), clip("b", "N1", 0, 2)]},
                                  {**FILLED, "solver": {"max_iter": 1}})
    assert tl["converged"] is False
    bad = [d for d in tl["diagnostics"] if d["code"] == "SOLVER_NOT_CONVERGED"]
    assert bad and bad[0]["severity"] == "error" and bad[0]["engineeringItemId"] == "P1"
    assert any(not s["converged"] for s in tl["solves"])


def test_programmed_pump_speed_follows_affinity_laws_and_min_flow():
    fixtures = [pump(1000, 22), nozzle(0)]
    show = {"clips": [clip("p100", "P1", 0, 4, 100, "pump_speed"), clip("p50a", "P1", 4, 8, 50, "pump_speed"),
                      clip("p50", "P1", 8, 10, 50, "pump_speed"), clip("j", "N0", 0, 8)]}
    tl = evaluate_show_hydraulics({"fixtures": fixtures}, show, FILLED)
    assert tl["pumps"]["P1"]["drive"] == "programmed"
    h_full, h_50 = at(tl, "N0", 3000), at(tl, "N0", 7000)
    assert h_50 < h_full * 0.6                     # head ∝ N²: 50 % speed ≈ 25 % shutoff head
    assert "PUMP_BELOW_MIN_FLOW" in codes(tl)       # 8–10 s: pump runs with every jet closed
    stopped = evaluate_show_hydraulics({"fixtures": fixtures},
                                       {"clips": [clip("p", "P1", 0, 1, 100, "pump_speed"), clip("j", "N0", 2, 4)]},
                                       FILLED)
    assert "PUMP_NOT_RUNNING" in codes(stopped)
    assert at(stopped, "N0", 3000) == 0


def test_no_pump_uses_labelled_design_head_and_missing_data_is_reported():
    fixtures = [nozzle(0, pump=None), {"id": "N9", "type": "nozzle_straight_dn25", "x": 1, "y": 1, "engineering": {}}]
    tl = evaluate_show_hydraulics({"fixtures": fixtures, "params": {"design_head_m": 30}},
                                  {"clips": [clip("a", "N0", 0, 2), clip("b", "N9", 0, 2)]}, FILLED)
    assert tl["pumps"]["__design_head__"]["drive"] == "fixed-head"
    assert any(a["key"] == "design_head_source" for a in tl["assumptions"])
    assert at(tl, "N0", 1000) > 5
    assert "HYDRAULIC_DATA_MISSING" in codes(tl)


def test_route_caches_by_revision():
    payload = {"project": {"fixtures": [pump(1000, 22), nozzle(0)]},
               "show": {"clips": [clip("a", "N0", 0, 2)]}, "options": FILLED}
    first = asyncio.run(hydraulics_routes.show_hydraulic_timeline(payload))
    second = asyncio.run(hydraulics_routes.show_hydraulic_timeline(payload))
    assert first["cached"] is False and second["cached"] is True
    assert first["revision"] == second["revision"]
    assert show_timeline({**payload, "options": {**FILLED, "rate_hz": 5}})["revision"] != first["revision"]


MEASURED = {"source": "user_measured", "model": "Test pump 1.5 kW", "date": "2026-10-01", "confidence": "medium"}


def verified_small_pump():
    """The same 1.5 kW duty, but as measured curve points with a valid user_measured provenance."""
    p = pump(366.67, 12)
    p["engineering"]["pumpCurve"] = {"flowsLpm": [0, 150, 300, 366.67, 450], "headsM": [15, 14.2, 12.6, 12, 10.6]}
    p["provenance"] = MEASURED
    return p


def test_overload_severity_follows_curve_verification():
    show = {"clips": [clip(f"c{i}", f"N{i}", 0, 10) for i in range(8)]}
    tl = evaluate_show_hydraulics({"fixtures": [verified_small_pump()] + [nozzle(i) for i in range(8)]}, show, FILLED)
    assert tl["pumps"]["P1"]["equipment"]["curve_verified"] is True
    over = [d for d in tl["diagnostics"] if d["code"] == "PUMP_OVERLOAD"]
    assert over and over[0]["severity"] == "error" and "assumed" not in over[0]["message"]
    assert "PUMP_CURVE_ASSUMED" not in codes(tl)


def test_overloaded_pump_is_a_preflight_issue_end_to_end():
    """AF-NEXT-009 gate: services/preflight.py → show_hydraulics.get_hydraulic_diagnostics."""
    from services.preflight import run_preflight

    project = {"fixtures": [pump(366.67, 12)] + [nozzle(i) for i in range(8)],
               "clips": [clip(f"c{i}", f"N{i}", 0, 10) for i in range(8)]}
    result = run_preflight(project, {"kind": "preview"})
    over = [i for i in result["issues"] if i["code"] == "PUMP_OVERLOAD"]
    assert over, [i["code"] for i in result["issues"]]
    # assumed (duty-point) curve: a warning that does not block output
    assert over[0]["source"] == "hydraulics" and over[0]["severity"] == "warning"
    assert over[0]["engineeringItemId"] == "P1" and over[0]["fix"] == {"kind": "open_engineering_item", "target": "P1"}
    assert over[0]["timeMs"] is not None and over[0]["clipId"].startswith("c")
    assert result["ok"] is True, [i for i in result["issues"] if i["severity"] == "error"]
    # verified (measured) curve: the same overload is an error and fails the gate
    verified = run_preflight({**project, "fixtures": [verified_small_pump()] + [nozzle(i) for i in range(8)]},
                             {"kind": "preview"})
    v_over = [i for i in verified["issues"] if i["code"] == "PUMP_OVERLOAD"]
    assert v_over and v_over[0]["severity"] == "error" and verified["ok"] is False
    # an adequate pump passes the hydraulic part of the gate
    fine = run_preflight({**project, "fixtures": [pump(1000, 22)] + [nozzle(i) for i in range(8)]}, {"kind": "preview"})
    assert not [i for i in fine["issues"] if i["code"] == "PUMP_OVERLOAD"]


def test_preflight_topology_aliases_link_nozzle_to_valve_to_pump():
    from services.show_hydraulics import build_topology, DEFAULTS

    topo = build_topology({"fixtures": [
        pump(1000, 22), {"id": "P2", "type": "pump_submersible_3kw", "engineering": {"flowLpm": 500, "headM": 18}},
        {"id": "V1", "type": "valve_solenoid_dn25_24v", "supplyingPumpId": "P2"},
        {**nozzle(0, pump=None), "linkedValveId": "V1"}]}, dict(DEFAULTS))
    assert topo["nozzles"]["N0"]["valve_id"] == "V1" and topo["nozzles"]["N0"]["pump_id"] == "P2"


def test_frontend_preflight_golden_matches_the_evaluator():
    """The frontend preflight e2e test replays golden/overload-timeline.json; it must stay what
    this evaluator returns for the recorded request (regenerate: tests/golden_show_timeline.py)."""
    import json
    import pathlib

    golden = pathlib.Path(__file__).resolve().parents[2] / "frontend/src/preflight/__tests__/golden/overload-timeline.json"
    data = json.loads(golden.read_text(encoding="utf-8"))
    req = data["request"]
    fresh = evaluate_show_hydraulics(req["project"], req["show"], req["options"])
    assert fresh["diagnostics"] == data["response"]["diagnostics"]
    assert fresh["nozzles"]["N0"]["heightM"] == data["response"]["nozzles"]["N0"]["heightM"]
    assert "PUMP_OVERLOAD" in {d["code"] for d in fresh["diagnostics"]}
