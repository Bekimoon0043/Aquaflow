"""
show_hydraulics.py — AF-NEXT-007 time-dependent hydraulic evaluator.

Connects the canonical evaluated show frame (engine/show_frame.py) to the hydraulic
network solver (services/hydraulic_solver.py) and the pump curves (services/pump_curve.py)
so the engineering preview can show what the water will actually do at every show time.

Pipeline, per sample time t (default 10 Hz plus every clip boundary):

  1. Show frame       evaluate_show_frame_at(show, t) → nozzle levels, pump speeds, valve states.
  2. Commands         a pump that the show programs (has any clip) follows its pump_speed
                      channel; an unprogrammed pump is driven IMPLICITLY at
                      sqrt(max level of the nozzles it feeds) — the speed whose affinity-law
                      head (H ∝ N²) gives the requested height fraction. Valves that the
                      show programs follow their channel; unprogrammed valves open whenever a
                      nozzle behind them is demanded. Both are labelled in the result.
  3. Dynamics         first-order pump ramp (τ from equipment data, else a labelled default),
                      linear valve stroke (response time from equipment data, else default),
                      quantised (speed 2 %, valve 25 %) so solves can be cached.
  4. Quasi-steady     one network per pump group: pump (PumpCurve scaled by the affinity
                      laws to the effective speed — NOT a fixed head) → main → valve
                      (minor loss K/f²) → branch → nozzle emitter. Closed valves and closed
                      nozzles drop their branches. The operating point is the root of
                      H − H_pump(Q_sys(H)) found with Illinois regula falsi on top of the
                      Global Gradient solve; every unique state is cached by its signature.
  5. Pipe fill        branch pipes start empty (configurable) and drain when they stop
                      flowing; a jet appears only after its path volume has been filled
                      (volume / flow, integrated sample by sample).
  6. Diagnostics      PUMP_OVERLOAD, PUMP_BELOW_MIN_FLOW, PUMP_NOT_RUNNING,
                      VALVE_CLOSED_UPSTREAM, SOLVER_NOT_CONVERGED, NOZZLE_UNDER_PRESSURE,
                      JET_DELAYED, NOZZLE_NOT_CONNECTED, HYDRAULIC_DATA_MISSING,
                      PUMP_CURVE_ASSUMED — merged into time spans, in the shared Diagnostic
                      shape (+ endMs) consumed by the AF-NEXT-009 preflight gate.

SI units throughout (m, s, m³/s, m/s); L/min is reported alongside for display. Every
pump and nozzle result cites its equipment data source (AF-NEXT-012). Pure: no I/O and
no hardware access.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import time
from collections import OrderedDict

from engine.show_frame import evaluate_show_frame_at, fixture_kind, prepare_show
from services.equipment_provenance import cite, is_verified, normalize_provenance, summarize
from services.hydraulic_solver import (GRAVITY, JET_EFFICIENCY, HydraulicNetworkSolver, HydraulicNode,
                                       HydraulicPipe, check_pump_adequacy)
from services.pump_curve import PUMP_CATALOG, PumpCurve, load_catalog_pump

CONTRACT = "aquaflow-show-hydraulics"
VERSION = "1.0.0"
BAR_TO_M = 10.19716213

DEFAULTS = {
    "rate_hz": 10.0,               # uniform sample rate (clip boundaries are always added)
    "max_samples": 3000,           # the uniform rate is lowered to stay below this
    "pump_tau_s": 1.5,             # first-order pump ramp time constant when no data
    "solenoid_response_s": 0.3,    # valve stroke time when no data (solenoid)
    "motorised_response_s": 6.0,   # valve stroke time when no data (motorised / butterfly)
    "valve_k_open": 2.0,           # fully open valve minor-loss K when no data
    "pipes_initially_filled": False,
    "drain_when_idle": True,       # branch pipes drain when they stop flowing
    "speed_quantum": 0.02,
    "valve_quantum": 0.25,
    "under_pressure_tol": 0.10,    # jet below (1 - tol) × demanded height → diagnostic
    "adequacy_margin": 1.05,       # PUMP_OVERLOAD when the duty exceeds the operating point by >5 %
    "min_flow_fraction": 0.10,     # pump minimum flow = 10 % of rated duty flow when no data
    "rated_max_flow_factor": 1.3,  # end of curve = 1.3 × duty flow when no curve data
    "shutoff_ratio": 1.25,         # generic curve: shutoff head = 1.25 × duty head
    "design_head_m": 40.0,         # fixed-head source when the design has no pump
    "delay_report_min_s": 1.0,     # JET_DELAYED reported only for lags at least this long
}

STATE_CODES = {0: "off", 1: "ok", 2: "under_pressure", 3: "valve_closed", 4: "pump_off",
               5: "filling", 6: "ramping", 7: "no_hydraulic_data", 8: "solver_failed",
               9: "not_connected"}
OFF, OK, UNDER, VALVE, PUMP_OFF, FILLING, RAMPING, NO_DATA, FAILED, UNCONNECTED = range(10)

_NOT_JET = re.compile(r"mist|fog|flame|fire|burner|haze|laser|light", re.I)
_MOTOR_VALVE = re.compile(r"motor|butterfly|ball|actuat", re.I)


# ── small helpers ─────────────────────────────────────────────────────────────

def _num(v, default=None):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _dn_m(conn, default):
    m = re.match(r"^\s*(?:DN)?\s*(\d+(?:\.\d+)?)\s*(?:mm)?\s*$", str(conn or ""), re.I)
    return max(0.01, float(m.group(1)) / 1000.0) if m else default


def _r(v, nd=4):
    return None if v is None else round(float(v), nd)


def _dist(a, b):
    return math.hypot(_num(a.get("x"), 0.0) - _num(b.get("x"), 0.0), _num(a.get("y"), 0.0) - _num(b.get("y"), 0.0))


def _pipe_volume(length, dia):
    return math.pi * dia * dia / 4.0 * length


def _eng(f):
    return f.get("engineering") or {}


# ── equipment models ──────────────────────────────────────────────────────────

def _is_water_nozzle(f):
    return fixture_kind(f) == "water" and not _NOT_JET.search(str(f.get("type") or ""))


def _nozzle_model(f, assumptions):
    e = _eng(f)
    q_lpm = _num(e.get("flowLpm"))
    if q_lpm is None and _num(e.get("design_flow_lps")) is not None:
        q_lpm = _num(e.get("design_flow_lps")) * 60.0
    p_m = _num(e.get("design_pressure_m"))
    if p_m is None and _num(e.get("pressureBar")) is not None:
        p_m = _num(e.get("pressureBar")) * BAR_TO_M
    cd = _num(e.get("dischargeCoeff", e.get("discharge_coeff")), 0.97) or 0.97
    model = {
        "id": str(f["id"]), "x": _num(f.get("x"), 0.0), "y": _num(f.get("y"), 0.0),
        "elevation": _num(e.get("elevationM", e.get("elevation_m")), 0.0) or 0.0,
        "pipe_dia": _num(e.get("pipeDiameterM", e.get("pipe_diameter_m"))) or _dn_m(e.get("connectionSize"), 0.05),
        "cd": cd, "has_data": bool(q_lpm and q_lpm > 0 and p_m and p_m > 0),
        "pump_id": e.get("pumpId") or f.get("supplyingPumpId") or f.get("pumpId"),
        "valve_id": e.get("valveId") or f.get("linkedValveId") or f.get("valveId"),
        "type": f.get("type"),
    }
    if model["has_data"]:
        model["q_design"] = q_lpm / 60000.0
        model["p_design"] = p_m
        model["k"] = model["q_design"] / math.sqrt(p_m)
        h = _num(e.get("jetHeightM", e.get("jet_height_m")))
        model["h_design"] = h if h and h > 0 else JET_EFFICIENCY * cd * cd * p_m
        model["h_basis"] = "EQUIPMENT" if h and h > 0 else "ESTIMATED"
    model["citation"] = cite(normalize_provenance(f.get("provenance"), kind="nozzle", model=str(f.get("type") or "nozzle")),
                             equipment_model=str(f.get("type") or "unspecified nozzle"), kind="nozzle",
                             units={"flow": "m3/s (L/min shown)", "head": "m", "velocity": "m/s", "jet_height": "m"})
    return model


def _pump_model(f, params, cfg, assumptions):
    e = _eng(f)
    pid = str(f["id"])
    prov = f.get("provenance")
    curve, curve_source, rated_max = None, "", None
    pc = e.get("pumpCurve") or e.get("pump_curve")
    if isinstance(pc, dict):
        flows = pc.get("flows") or ([q / 60000.0 for q in pc.get("flowsLpm")] if pc.get("flowsLpm") else None)
        heads = pc.get("heads") or pc.get("headsM")
        if flows and heads and len(flows) >= 3 and len(flows) == len(heads):
            curve = PumpCurve.from_points(flows, heads, name=str(f.get("type") or pid)).with_provenance(prov)
            curve_source, rated_max = "EQUIPMENT curve points", max(float(q) for q in flows)
    model_key = e.get("curveModel") or e.get("pumpModel")
    if curve is None and model_key:
        try:
            curve = load_catalog_pump(str(model_key))
            curve_source = "catalog curve " + str(model_key)
            if model_key in PUMP_CATALOG:
                rated_max = max(PUMP_CATALOG[model_key]["flows"])
        except KeyError:
            curve = None
    q_duty = _num(e.get("flowLpm"))
    q_duty = q_duty / 60000.0 if q_duty else (_num(e.get("flowM3Hr"), 0.0) or 0.0) / 3600.0
    h_duty = _num(e.get("headM")) or (_num(e.get("pressureBar"), 0.0) or 0.0) * BAR_TO_M
    assumed_curve = False
    if curve is None and q_duty > 0 and h_duty > 0:
        c0 = cfg["shutoff_ratio"] * h_duty
        c2 = -(c0 - h_duty) / (q_duty * q_duty)
        curve = PumpCurve(c0, 0.0, c2, name=str(f.get("type") or pid)).with_provenance(prov)
        curve_source, assumed_curve = "duty point (generic quadratic shape)", True
    if curve is None:
        return None
    if rated_max is None:
        rated_max = (q_duty or curve.max_flow / 1.7) * cfg["rated_max_flow_factor"]
    duty_ref = q_duty or rated_max / cfg["rated_max_flow_factor"]
    tau, tau_src = _num(e.get("rampTimeConstantS")), "EQUIPMENT (rampTimeConstantS)"
    if tau is None and _num(e.get("rampTimeS", e.get("accelerationTimeS"))):
        tau, tau_src = _num(e.get("rampTimeS", e.get("accelerationTimeS"))) / 3.0, "EQUIPMENT (VFD ramp time / 3)"
    if tau is None:
        tau, tau_src = cfg["pump_tau_s"], "DEFAULT (no ramp data)"
    min_q = _num(e.get("minFlowLpm"))
    min_q, min_src = (min_q / 60000.0, "EQUIPMENT") if min_q else (cfg["min_flow_fraction"] * duty_ref, "DEFAULT (10 % of duty flow)")
    citation = curve.citation()
    citation["curve_basis"] = curve_source
    # Only verified (manufacturer datasheet / measured) curve data may block hardware output.
    citation["curve_verified"] = (not assumed_curve) and is_verified(curve.provenance)
    return {"id": pid, "virtual": False, "curve": curve, "curve_source": curve_source, "assumed_curve": assumed_curve,
            "curve_verified": citation["curve_verified"],
            "rated_max_q": rated_max, "min_q": min_q, "min_q_source": min_src,
            "tau": max(1e-3, tau), "tau_source": tau_src, "x": _num(f.get("x"), 0.0), "y": _num(f.get("y"), 0.0),
            "dia": _num(e.get("pipeDiameterM")) or _dn_m(e.get("connectionSize"), 0.08),
            "main_len": _num(e.get("mainLengthM")), "citation": citation, "type": f.get("type")}


def _valve_model(f, cfg):
    e = _eng(f)
    vtype = f"{e.get('valveType', '')} {f.get('type', '')}"
    resp = _num(e.get("responseTimeS", e.get("actuationTimeS")))
    src = "EQUIPMENT"
    if resp is None:
        motor = bool(_MOTOR_VALVE.search(vtype))
        resp = cfg["motorised_response_s"] if motor else cfg["solenoid_response_s"]
        src = f"DEFAULT ({'motorised' if motor else 'solenoid'})"
    k_open = _num(e.get("kOpen", e.get("minorLossK")))
    return {"id": str(f["id"]), "x": _num(f.get("x"), 0.0), "y": _num(f.get("y"), 0.0),
            "pump_id": e.get("pumpId") or f.get("supplyingPumpId") or f.get("pumpId"),
            "response": max(0.0, resp), "response_source": src,
            "k_open": k_open if k_open is not None else cfg["valve_k_open"],
            "k_source": "EQUIPMENT" if k_open is not None else "DEFAULT",
            "dia": _num(e.get("pipeDiameterM")) or _dn_m(e.get("connectionSize"), 0.05)}


# ── topology ──────────────────────────────────────────────────────────────────

def build_topology(project, cfg):
    """Pump → valve → nozzle groups from fixtures (engineering.pumpId/valveId) and
    project.hydraulic_network.groups; static diagnostics for what cannot be connected."""
    fixtures = [f for f in project.get("fixtures") or [] if isinstance(f, dict) and f.get("id") is not None]
    params = project.get("params") or {}
    assumptions, static_diags = [], []
    pumps, valves, nozzles = {}, {}, {}
    for f in fixtures:
        kind = fixture_kind(f)
        if kind == "pump":
            pm = _pump_model(f, params, cfg, assumptions)
            if pm:
                pumps[pm["id"]] = pm
            else:
                static_diags.append(_diag("HYDRAULIC_DATA_MISSING", "info", None, str(f["id"]), None, str(f["id"]),
                                          f"Pump {f['id']} has no curve or duty point (flow + head); it is not modelled.",
                                          ("open_engineering_item", str(f["id"]))))
        elif kind == "valve":
            valves[str(f["id"])] = _valve_model(f, cfg)
        elif _is_water_nozzle(f):
            nozzles[str(f["id"])] = _nozzle_model(f, assumptions)
    # hydraulic_network groups (CAD) fill in missing links; fixture fields win.
    for g in ((project.get("hydraulic_network") or {}).get("groups") or []):
        pid = g.get("pumpId")
        for nid in g.get("nozzleIds") or []:
            n = nozzles.get(str(nid))
            if n and not n["pump_id"]:
                n["pump_id"] = pid
    for n in nozzles.values():
        if n["valve_id"] and str(n["valve_id"]) not in valves:
            n["valve_id"] = None
        if n["valve_id"] and not n["pump_id"]:
            n["pump_id"] = valves[str(n["valve_id"])].get("pump_id")   # nozzle → valve → pump
    virtual = None
    unassigned = [n for n in nozzles.values() if not n["pump_id"] or str(n["pump_id"]) not in pumps]
    if unassigned:
        if len(pumps) == 1:
            only = next(iter(pumps))
            for n in unassigned:
                n["pump_id"] = only
            assumptions.append({"key": "single_pump_feeds_all", "value": only, "unit": None, "source": "ASSUMED",
                                "note": "Nozzles without engineering.pumpId are assumed to be fed by the only pump."})
        elif not pumps:
            head = _num(params.get("design_head_m", params.get("designHeadM")), cfg["design_head_m"])
            virtual = {"id": "__design_head__", "virtual": True, "fixed_head": head, "tau": 1e-3,
                       "tau_source": "n/a (fixed-head source)", "x": 0.0, "y": 0.0, "dia": 0.15, "main_len": 10.0,
                       "rated_max_q": math.inf, "min_q": 0.0, "min_q_source": "n/a", "assumed_curve": True,
                       "curve_source": "fixed design head (no pump in design)",
                       "citation": cite(None, equipment_model="design-head source", kind="pump",
                                        units={"head": "m"})}
            pumps[virtual["id"]] = virtual
            for n in unassigned:
                n["pump_id"] = virtual["id"]
            assumptions.append({"key": "design_head_source", "value": head, "unit": "m", "source": "ASSUMED",
                                "note": "The design has no pump: nozzles are fed from a fixed design head (legacy preview model)."})
        else:
            for n in unassigned:
                n["pump_id"] = None
                static_diags.append(_diag("NOZZLE_NOT_CONNECTED", "warning", None, n["id"], None, n["id"],
                                          f"Nozzle {n['id']} has no supplying pump (engineering.pumpId) in a multi-pump "
                                          "design; its jet is not hydraulically evaluated.",
                                          ("open_engineering_item", n["id"])))
    for n in nozzles.values():
        if not n["has_data"]:
            static_diags.append(_diag("HYDRAULIC_DATA_MISSING", "info", None, n["id"], None, n["id"],
                                      f"Nozzle {n['id']} has no design flow + pressure; the engineering preview shows "
                                      "its creative height unchanged.", ("open_engineering_item", n["id"])))
    groups = {}
    for pid, pm in pumps.items():
        members = [n for n in nozzles.values() if n["pump_id"] == pid]
        hydraulic = [n for n in members if n["has_data"]]
        if pm.get("assumed_curve") and not pm.get("virtual"):
            static_diags.append(_diag("PUMP_CURVE_ASSUMED", "info", None, pid, None, pid,
                                      f"Pump {pid}: curve shape assumed from its duty point (generic quadratic, shutoff "
                                      f"{cfg['shutoff_ratio']:.2f} × duty head). Load the manufacturer curve to verify.",
                                      ("open_engineering_item", pid)))
        groups[pid] = _build_group(pm, hydraulic, valves, cfg)
    return {"pumps": pumps, "valves": valves, "nozzles": nozzles, "groups": groups,
            "assumptions": assumptions, "static_diagnostics": static_diags}


def _build_group(pm, members, valves, cfg):
    """Pipes of one pump group. Lengths are straight-line plan distances (labelled)."""
    if members:
        cx = sum(n["x"] for n in members) / len(members)
        cy = sum(n["y"] for n in members) / len(members)
    else:
        cx, cy = pm["x"], pm["y"]
    main_len = pm.get("main_len") or max(2.0, math.hypot(cx - pm["x"], cy - pm["y"]))
    group = {"pump": pm, "nozzles": [n["id"] for n in members], "members": {n["id"]: n for n in members},
             "main": {"id": "MAIN", "length": main_len, "dia": pm["dia"]},
             "valves": {}, "branches": {}}
    group["main"]["volume"] = _pipe_volume(main_len, pm["dia"])
    for n in members:
        vid = n["valve_id"]
        if vid:
            v = valves[str(vid)]
            if vid not in group["valves"]:
                length = max(1.0, _dist(v, {"x": cx, "y": cy}))
                group["valves"][vid] = {"id": vid, "length": length, "dia": v["dia"], "model": v,
                                        "volume": _pipe_volume(length, v["dia"]), "nozzles": []}
            group["valves"][vid]["nozzles"].append(n["id"])
            start = v
        else:
            start = {"x": cx, "y": cy}
        length = max(1.0, _dist(start, n))
        group["branches"][n["id"]] = {"length": length, "dia": n["pipe_dia"],
                                      "volume": _pipe_volume(length, n["pipe_dia"])}
    return group


# ── quasi-steady solve of one group state ────────────────────────────────────

class _GroupSolver:
    def __init__(self, solver_opts):
        self.solver = HydraulicNetworkSolver(method="hazen-williams",
                                             max_iter=int(solver_opts.get("max_iter", 200)),
                                             tol=float(solver_opts.get("tol", 1e-8)))
        self.cache = {}
        self.hits = 0
        self.records = []

    def solve(self, group, speed, valve_fracs, open_ids):
        key = (group["pump"]["id"], speed, tuple(sorted(valve_fracs.items())), tuple(sorted(open_ids)))
        if key in self.cache:
            self.hits += 1
            return self.cache[key]
        res = self._solve(group, speed, valve_fracs, open_ids)
        res["index"] = len(self.records)
        res["signature"] = hashlib.sha1(repr(key).encode()).hexdigest()[:12]
        self.records.append(res)
        self.cache[key] = res
        return res

    def _network(self, group, valve_fracs, open_ids):
        nodes = [HydraulicNode("P", elevation=0.0, fixed_head=0.0), HydraulicNode("M", elevation=0.0)]
        pipes = [HydraulicPipe("MAIN", "P", "M", group["main"]["length"], group["main"]["dia"], 130.0)]
        used_valves = set()
        for nid in open_ids:
            n = group["members"][nid]
            vid = n["valve_id"]
            src = "M"
            if vid:
                src = "V:" + str(vid)
                if vid not in used_valves:
                    used_valves.add(vid)
                    vg = group["valves"][vid]
                    frac = max(0.05, valve_fracs.get(vid, 1.0))
                    nodes.append(HydraulicNode(src, elevation=0.0))
                    pipes.append(HydraulicPipe("VP:" + str(vid), "M", src, vg["length"], vg["dia"], 130.0,
                                               minor_loss=vg["model"]["k_open"] / (frac * frac)))
            b = group["branches"][nid]
            nodes.append(HydraulicNode("N:" + nid, elevation=n["elevation"], emitter_k=n["k"], discharge_coeff=n["cd"]))
            pipes.append(HydraulicPipe("B:" + nid, src, "N:" + nid, b["length"], b["dia"], 130.0))
        return nodes, pipes

    def _run(self, nodes, pipes, head):
        nodes[0].fixed_head = head
        res = self.solver.solve(nodes, pipes)
        return res, sum(res.emitter_flow.values())

    def _solve(self, group, speed, valve_fracs, open_ids):
        pm = group["pump"]
        out = {"pumpId": pm["id"], "speed": speed, "open": list(open_ids), "nozzles": {}, "flow": 0.0,
               "head": 0.0, "converged": True, "iterations": 0, "residuals": None, "op_iterations": 0,
               "op_converged": True, "op_residual_m": 0.0, "error": None}
        if not open_ids:
            out["head"] = 0.0 if pm["virtual"] else pm["curve"].at_speed(speed).shutoff_head if speed > 0 else 0.0
            return out
        nodes, pipes = self._network(group, valve_fracs, open_ids)
        try:
            if pm["virtual"]:
                res, q = self._run(nodes, pipes, pm["fixed_head"])
                head, it_op, op_ok, resid = pm["fixed_head"], 1, True, 0.0
            else:
                curve = pm["curve"].at_speed(speed)
                res, q, head, it_op, op_ok, resid = self._operating_point(nodes, pipes, curve)
        except Exception as exc:  # singular network etc. — reported, never fatal
            out.update({"converged": False, "op_converged": False, "error": str(exc)})
            return out
        out.update({"flow": q, "head": head, "converged": bool(res.converged), "iterations": res.iterations,
                    "residuals": {"max_continuity": res.max_continuity_residual,
                                  "max_loop_energy": res.max_loop_residual},
                    "op_iterations": it_op, "op_converged": op_ok, "op_residual_m": resid})
        for nid in open_ids:
            key = "N:" + nid
            p = max(0.0, res.node_head.get(key, 0.0) - group["members"][nid]["elevation"])
            out["nozzles"][nid] = {"p": p, "q": res.emitter_flow.get(key, 0.0)}
        return out

    def _operating_point(self, nodes, pipes, curve):
        """Root of f(H) = H − H_pump(Q_sys(H)) by Illinois regula falsi. f(0) < 0 and
        f(shutoff) ≥ 0 because the system flow rises and the pump head falls with H."""
        shutoff = curve.shutoff_head
        if shutoff <= 0:
            res, q = self._run(nodes, pipes, 0.0)
            return res, q, 0.0, 1, True, 0.0
        a, fa = 0.0, -shutoff
        res_b, q_b = self._run(nodes, pipes, shutoff)
        b, fb = shutoff, shutoff - curve.head(q_b)
        best = (res_b, q_b, b, abs(fb))
        side, it = 0, 1
        tol = 1e-4
        if abs(fb) < tol:
            return res_b, q_b, b, it, True, abs(fb)
        for it in range(2, 61):
            c = (a * fb - b * fa) / (fb - fa) if fb != fa else 0.5 * (a + b)
            res_c, q_c = self._run(nodes, pipes, c)
            fc = c - curve.head(q_c)
            if abs(fc) < best[3]:
                best = (res_c, q_c, c, abs(fc))
            if abs(fc) < tol or abs(b - a) < 1e-7:
                break
            if fc * fb > 0:
                b, fb = c, fc
                if side == -1:
                    fa /= 2.0
                side = -1
            else:
                a, fa = c, fc
                if side == 1:
                    fb /= 2.0
                side = 1
        res, q, head, resid = best
        return res, q, head, it, resid < 1e-3, resid


# ── diagnostics ──────────────────────────────────────────────────────────────

def _diag(code, severity, time_ms, fixture_id, clip_id, item_id, message, fix, end_ms=None):
    d = {"code": code, "severity": severity, "timeMs": time_ms, "fixtureId": fixture_id, "clipId": clip_id,
         "engineeringItemId": item_id, "message": message,
         "fix": {"kind": fix[0], "target": fix[1]} if fix else None, "source": "hydraulics"}
    if end_ms is not None:
        d["endMs"] = end_ms
    return d


class _Spans:
    """Merge per-sample findings into contiguous time spans (one diagnostic per span)."""

    def __init__(self):
        self.open, self.closed = {}, []

    def mark(self, k, t_ms, severity, fixture_id, clip_id, item_id, message, fix, worst=0.0):
        cur = self.open.get(k)
        if cur is None:
            self.open[k] = {"start": t_ms, "end": t_ms, "severity": severity, "fixtureId": fixture_id,
                            "clipId": clip_id, "itemId": item_id, "message": message, "fix": fix, "worst": worst,
                            "seen": True}
        else:
            cur["end"], cur["seen"] = t_ms, True
            if worst > cur["worst"]:
                cur["worst"], cur["message"] = worst, message
            if cur["clipId"] is None and clip_id:
                cur["clipId"] = clip_id

    def step(self, t_ms):
        for k in list(self.open):
            cur = self.open[k]
            if not cur["seen"]:
                self._close(k, t_ms)
            else:
                cur["seen"] = False

    def _close(self, k, t_ms):
        cur = self.open.pop(k)
        self.closed.append(_diag(k[0], cur["severity"], _r(cur["start"], 1), cur["fixtureId"], cur["clipId"],
                                 cur["itemId"], cur["message"], cur["fix"], end_ms=_r(t_ms, 1)))

    def finish(self, t_ms, delay_min_ms=1000.0):
        for k in list(self.open):
            self._close(k, t_ms)
        # JET_DELAYED is expected at every jet start: report only lags of at least
        # `delay_min_ms`, once per jet (first occurrence, with the count and the longest).
        kept, delays = [], {}
        for d in self.closed:
            if d["code"] != "JET_DELAYED":
                kept.append(d)
            elif d["endMs"] - d["timeMs"] >= delay_min_ms:
                delays.setdefault(d["fixtureId"], []).append(d)
        for spans in delays.values():
            first = dict(spans[0])
            longest = max(spans, key=lambda d: d["endMs"] - d["timeMs"])
            if len(spans) > 1:
                first["message"] += (f" Occurs {len(spans)} times; longest {(longest['endMs'] - longest['timeMs']) / 1000:.1f} s "
                                     f"at {longest['timeMs'] / 1000:.1f} s.")
            kept.append(first)
        return sorted(kept, key=lambda d: (d["timeMs"], d["code"], str(d["fixtureId"])))


# ── sampling ─────────────────────────────────────────────────────────────────

def sample_times(prepared, duration, rate_hz, max_samples):
    boundaries = set()
    for c in prepared["clips"]:
        for t in (c["start"], c["end"], c["start"] + c["fadeIn"], c["end"] - c["fadeOut"]):
            if 0.0 <= t <= duration:
                boundaries.add(round(t, 6))
    rate = max(0.1, float(rate_hz))
    budget = max(10, int(max_samples) - len(boundaries))
    if duration * rate + 1 > budget:
        rate = max(0.1, (budget - 1) / max(duration, 1e-9))
    n = int(math.floor(duration * rate + 1e-9))
    uniform = {round(i / rate, 6) for i in range(n + 1)}
    times = sorted(uniform | boundaries | {0.0, round(duration, 6)})
    return times, rate


# ── main entry point ─────────────────────────────────────────────────────────

def evaluate_show_hydraulics(project: dict, show: dict, options: dict | None = None) -> dict:
    """Evaluate the engineering hydraulics of `show` on `project` across show time.

    project: engineering project {fixtures (with engineering + provenance), params,
             hydraulic_network?}; show: {clips, duration?, groups?, recipes?, tempo?,
             sections?, frameOpts?}; options: overrides for DEFAULTS plus
             {solver: {max_iter, tol}, durationS}.
    """
    t0 = time.perf_counter()
    options = dict(options or {})
    cfg = {**DEFAULTS, **{k: v for k, v in options.items() if k in DEFAULTS}}
    topo = build_topology(project or {}, cfg)
    pumps, valves, nozzles, groups = topo["pumps"], topo["valves"], topo["nozzles"], topo["groups"]

    show = dict(show or {})
    show_project = {**show, "fixtures": project.get("fixtures") or show.get("fixtures") or []}
    frame_opts = show.get("frameOpts") or options.get("frameOpts") or {}
    prepared = prepare_show(show_project)
    duration = _num(options.get("durationS"), None) or prepared["duration"]
    times, rate = sample_times(prepared, duration, cfg["rate_hz"], cfg["max_samples"])

    programmed = {c["fixtureId"] for c in prepared["clips"]}
    pump_drive = {pid: ("fixed-head" if pm["virtual"] else "programmed" if pid in programmed else "implicit")
                  for pid, pm in pumps.items()}
    valve_drive = {vid: ("programmed" if vid in programmed else "implicit") for vid in valves}

    gsolver = _GroupSolver(options.get("solver") or {})
    spans = _Spans()

    # state
    s_eff = {pid: (1.0 if pm["virtual"] else 0.0) for pid, pm in pumps.items()}
    s_cmd_prev = dict(s_eff)
    v_frac = {vid: 0.0 for vid in valves}
    v_cmd_prev = dict(v_frac)
    fill_left = {}
    for pid, g in groups.items():
        filled = cfg["pipes_initially_filled"]
        fill_left[(pid, "MAIN")] = 0.0 if filled else g["main"]["volume"]
        for vid, vg in g["valves"].items():
            fill_left[(pid, "VP:" + str(vid))] = 0.0 if filled else vg["volume"]
        for nid, b in g["branches"].items():
            fill_left[(pid, "B:" + nid)] = 0.0 if filled else b["volume"]
    prev_flows = {}  # pipe key -> m3/s during the previous interval

    n_out = {nid: {"pumpId": n["pump_id"], "valveId": n["valve_id"],
                   "designHeightM": _r(n.get("h_design")), "heightBasis": n.get("h_basis", "NONE"),
                   "heightM": [], "demandHeightM": [], "exitVelocityMs": [], "flowLpm": [], "state": [],
                   "equipment": n["citation"]} for nid, n in nozzles.items()}
    p_out = {pid: {"drive": pump_drive[pid], "virtual": pm["virtual"], "curveSource": pm["curve_source"],
                   "rampTauS": _r(pm["tau"], 3), "rampSource": pm["tau_source"],
                   "ratedMaxFlowLpm": None if pm["rated_max_q"] == math.inf else _r(pm["rated_max_q"] * 60000.0, 2),
                   "minFlowLpm": _r(pm["min_q"] * 60000.0, 2), "minFlowSource": pm["min_q_source"],
                   "curve": None if pm["virtual"] else pm["curve"].to_dict(),
                   "speedCmd": [], "speedEff": [], "flowLpm": [], "headM": [], "solve": [],
                   "nozzleIds": groups[pid]["nozzles"], "equipment": pm["citation"]} for pid, pm in pumps.items()}
    v_out = {vid: {"drive": valve_drive[vid], "responseTimeS": v["response"], "responseSource": v["response_source"],
                   "kOpen": v["k_open"], "kSource": v["k_source"], "openCmd": [], "openFraction": []}
             for vid, v in valves.items()}

    prev_t = None
    for t in times:
        dt = 0.0 if prev_t is None else t - prev_t
        prev_t = t
        t_ms = t * 1000.0
        frame = evaluate_show_frame_at(show_project, t, frame_opts, prepared)
        playing = frame["state"] == "playing"
        fx = frame["fixtures"]
        level = {nid: (fx.get(nid, {}).get("level", 0.0) if playing else 0.0) for nid in nozzles}
        clip_of = {nid: ((fx.get(nid) or {}).get("source") or {}).get("clipId") for nid in nozzles}

        # 1. dynamics: integrate over [prev_t, t] with the previous command held.
        for pid, pm in pumps.items():
            if not pm["virtual"] and dt > 0:
                s_eff[pid] += (s_cmd_prev[pid] - s_eff[pid]) * (1.0 - math.exp(-dt / pm["tau"]))
        for vid, v in valves.items():
            if dt > 0:
                step = 1.0 if v["response"] <= 0 else dt / v["response"]
                target = v_cmd_prev[vid]
                v_frac[vid] = min(target, v_frac[vid] + step) if target > v_frac[vid] else max(target, v_frac[vid] - step)
        for key, q in prev_flows.items():
            if q > 0 and dt > 0:
                fill_left[key] = max(0.0, fill_left[key] - q * dt)

        # 2. commands at t (they act on the next interval).
        s_cmd = {}
        for pid, pm in pumps.items():
            if pm["virtual"]:
                s_cmd[pid] = 1.0
            elif pump_drive[pid] == "programmed":
                s_cmd[pid] = (frame["pumps"].get(pid) or {}).get("speed", 0.0) if playing else 0.0
            else:
                lv = max((level[n] for n in groups[pid]["nozzles"]), default=0.0)
                s_cmd[pid] = math.sqrt(lv) if lv > 0 else 0.0
        v_cmd = {}
        for vid in valves:
            if valve_drive[vid] == "programmed":
                v_cmd[vid] = 1.0 if (playing and (frame["valves"].get(vid) or {}).get("open")) else 0.0
            else:
                v_cmd[vid] = 1.0 if any(level.get(n["id"], 0) > 0 for n in nozzles.values() if n["valve_id"] == vid) else 0.0
        for vid in valves:
            v_out[vid]["openCmd"].append(v_cmd[vid])
            v_out[vid]["openFraction"].append(_r(v_frac[vid], 3))

        flows_now = {}
        nozzle_rows = {}
        for pid, g in groups.items():
            pm = pumps[pid]
            sq = cfg["speed_quantum"]
            speed = 1.0 if pm["virtual"] else round(round(s_eff[pid] / sq) * sq, 4)
            vq = cfg["valve_quantum"]
            fracs = {vid: round(round(v_frac[vid] / vq) * vq, 4) for vid in g["valves"]}
            open_ids = []
            for nid in g["nozzles"]:
                vid = g["members"][nid]["valve_id"]
                if level[nid] > 0 and speed > 0 and (not vid or fracs.get(vid, 0) > 0):
                    open_ids.append(nid)
            sol = gsolver.solve(g, speed, fracs, open_ids)
            po = p_out[pid]
            po["speedCmd"].append(_r(s_cmd[pid], 4))
            po["speedEff"].append(_r(s_eff[pid], 4))
            po["flowLpm"].append(_r(sol["flow"] * 60000.0, 2))
            po["headM"].append(_r(sol["head"], 3))
            po["solve"].append(sol["index"])
            # pump-level findings
            solve_ok = sol["converged"] and sol["op_converged"] and not sol["error"]
            if not solve_ok:
                spans.mark(("SOLVER_NOT_CONVERGED", pid), t_ms, "error", pid, None, pid,
                           f"Hydraulic solve for pump {pid} did not converge"
                           + (f" ({sol['error']})" if sol["error"] else
                              f" (network {sol['iterations']} iterations, operating point residual "
                              f"{sol['op_residual_m']:.3g} m)") + " — jet heights here are not trustworthy.",
                           ("open_panel", "hydraulics"))
            demanded = [nid for nid in g["nozzles"] if level[nid] > 0]
            if demanded and not pm["virtual"] and s_cmd[pid] <= 0:
                spans.mark(("PUMP_NOT_RUNNING", pid), t_ms, "warning", pid, clip_of[demanded[0]], pid,
                           f"{len(demanded)} jet(s) on pump {pid} are programmed while the pump is commanded off.",
                           ("open_clip", clip_of[demanded[0]]) if clip_of[demanded[0]] else ("open_engineering_item", pid))
            # Pump duty findings are steady-state findings: a ramping pump is reported via JET_DELAYED.
            steady = abs(s_eff[pid] - s_cmd[pid]) <= sq
            if not pm["virtual"] and speed > 0 and steady:
                rated = pm["rated_max_q"] * speed
                req_h = max((level[n] * g["members"][n]["p_design"] + g["members"][n]["elevation"] for n in open_ids), default=0.0)
                req_q = sum(g["members"][n]["k"] * math.sqrt(level[n] * g["members"][n]["p_design"]) for n in open_ids)
                finding = check_pump_adequacy(req_h, req_q, sol["head"], sol["flow"]) if open_ids and sol["flow"] > 0 else None
                overload = finding is not None and finding["value"] > cfg["adequacy_margin"]
                runout = sol["flow"] > rated * 1.001
                if open_ids and (overload or runout):
                    msg = (f"Pump {pid} overloaded at {speed * 100:.0f}% speed: operating point "
                           f"{sol['flow'] * 60000:.0f} L/min @ {sol['head']:.1f} m")
                    msg += (f" is past the end of its curve ({rated * 60000:.0f} L/min)" if runout else "")
                    msg += (f"; the open jets need {req_q * 60000:.0f} L/min @ {req_h:.1f} m" if overload else "")
                    msg += ". Jets fall short — reduce simultaneous jets/heights or select a larger pump."
                    verified = pm.get("curve_verified", False)
                    if not verified:
                        msg += (" The pump curve is assumed (generic estimate), so this is a warning: enter verified "
                                "pump curve data (manufacturer datasheet or measured) to confirm.")
                    worst = max(finding["value"] if finding else 0.0, sol["flow"] / rated if rated > 0 else 0.0)
                    clip = next((clip_of[n] for n in open_ids if clip_of[n]), None)
                    spans.mark(("PUMP_OVERLOAD", pid), t_ms, "error" if verified else "warning", pid, clip, pid, msg,
                               ("open_engineering_item", pid), worst)
                if speed > 0 and sol["flow"] < pm["min_q"] and s_cmd[pid] > 0:
                    spans.mark(("PUMP_BELOW_MIN_FLOW", pid), t_ms, "warning", pid, None, pid,
                               f"Pump {pid} runs at {speed * 100:.0f}% with {sol['flow'] * 60000:.0f} L/min, below its "
                               f"minimum flow {pm['min_q'] * 60000:.0f} L/min ({pm['min_q_source']}) — risk of overheating "
                               "(dead-heading). Open a jet or stop the pump.", ("open_engineering_item", pid))
            # per-nozzle results
            flows_now[(pid, "MAIN")] = sol["flow"]
            for vid in g["valves"]:
                flows_now[(pid, "VP:" + str(vid))] = sum(sol["nozzles"].get(n, {}).get("q", 0.0)
                                                         for n in g["valves"][vid]["nozzles"])
            for nid in g["nozzles"]:
                n = g["members"][nid]
                q = sol["nozzles"].get(nid, {}).get("q", 0.0)
                flows_now[(pid, "B:" + nid)] = q
                lv = level[nid]
                h_dem = lv * n["h_design"]
                vid = n["valve_id"]
                path = [(pid, "MAIN"), (pid, "B:" + nid)] + ([(pid, "VP:" + str(vid))] if vid else [])
                filling = any(fill_left[k] > 1e-12 for k in path)
                h, v_exit, flow, state = 0.0, 0.0, 0.0, OFF
                if lv <= 0:
                    state = OFF
                elif not pm["virtual"] and speed <= 0:
                    state = PUMP_OFF if s_cmd[pid] <= 0 else RAMPING
                elif vid and fracs.get(vid, 0) <= 0:
                    state = VALVE if v_cmd[vid] <= 0 else RAMPING
                elif not solve_ok and nid not in sol["nozzles"]:
                    state = FAILED
                else:
                    p_av = sol["nozzles"].get(nid, {}).get("p", 0.0)
                    h_av = n["h_design"] * p_av / n["p_design"]
                    h = min(h_dem, h_av)
                    p_eff = n["p_design"] * h / n["h_design"] if n["h_design"] > 0 else 0.0
                    v_exit = n["cd"] * math.sqrt(2.0 * GRAVITY * p_eff)
                    flow = n["k"] * math.sqrt(p_eff)
                    dynamic = (not pm["virtual"] and s_eff[pid] < s_cmd[pid] - sq) or \
                              (vid and v_frac[vid] < v_cmd[vid] - 1e-9)
                    if filling:
                        state, h, v_exit, flow = FILLING, 0.0, 0.0, 0.0
                    elif h < (1.0 - cfg["under_pressure_tol"]) * h_dem:
                        state = RAMPING if dynamic else UNDER
                    else:
                        state = OK
                    if not solve_ok:
                        state = FAILED if state == OK else state
                # nozzle findings
                clip = clip_of[nid]
                fix_clip = ("open_clip", clip) if clip else ("open_engineering_item", nid)
                if lv > 0 and vid and v_cmd[vid] <= 0 and valve_drive[vid] == "programmed":
                    spans.mark(("VALVE_CLOSED_UPSTREAM", nid), t_ms, "warning", nid, clip, vid,
                               f"Jet {nid} is programmed at {lv * 100:.0f}% but its upstream valve {vid} is closed — "
                               "no water reaches it.", fix_clip)
                if state == UNDER:
                    short = 1.0 - h / h_dem if h_dem > 0 else 0.0
                    spans.mark(("NOZZLE_UNDER_PRESSURE", nid), t_ms, "warning", nid, clip, pid,
                               f"Jet {nid} reaches {h:.2f} m of the {h_dem:.2f} m programmed ({short * 100:.0f}% short): "
                               f"pump {pid} cannot hold its design pressure with the jets open at this time.",
                               ("open_engineering_item", pid), short)
                if state in (FILLING, RAMPING):
                    cause = "pipe filling" if state == FILLING else "pump ramp / valve stroke"
                    spans.mark(("JET_DELAYED", nid), t_ms, "info", nid, clip, pid,
                               f"Jet {nid} lags its programmed height because of {cause} "
                               f"(pump τ {pm['tau']:.2f} s, {pm['tau_source']}).", fix_clip)
                if not n["has_data"]:
                    state = NO_DATA
                nozzle_rows[nid] = (h, h_dem, v_exit, flow, state)
        # nozzles outside any modelled group (no data / not connected)
        for nid, n in nozzles.items():
            if nid in nozzle_rows:
                continue
            lv = level[nid]
            h_dem = lv * n["h_design"] if n.get("h_design") else None
            st = OFF if lv <= 0 else (NO_DATA if not n["has_data"] else UNCONNECTED)
            nozzle_rows[nid] = (h_dem, h_dem, None, None, st)
        for nid, (h, h_dem, v_exit, flow, state) in nozzle_rows.items():
            o = n_out[nid]
            o["heightM"].append(_r(h, 3))
            o["demandHeightM"].append(_r(h_dem, 3))
            o["exitVelocityMs"].append(_r(v_exit, 3))
            o["flowLpm"].append(None if flow is None else _r(flow * 60000.0, 2))
            o["state"].append(state)

        # drain idle branches, remember interval flows
        if cfg["drain_when_idle"]:
            for pid, g in groups.items():
                for nid, b in g["branches"].items():
                    if flows_now.get((pid, "B:" + nid), 0.0) <= 0:
                        fill_left[(pid, "B:" + nid)] = b["volume"]
        prev_flows = flows_now
        s_cmd_prev, v_cmd_prev = s_cmd, v_cmd
        spans.step(t_ms)

    end_ms = (times[-1] * 1000.0) if times else 0.0
    diagnostics = topo["static_diagnostics"] + spans.finish(end_ms, cfg["delay_report_min_s"] * 1000.0)
    nominal = _nominal(groups, gsolver)

    assumptions = topo["assumptions"] + [
        {"key": "sample_rate_hz", "value": round(rate, 3), "unit": "Hz", "source": "SETTING",
         "note": "Uniform sampling plus every clip start/end and fade boundary."},
        {"key": "pipe_lengths", "value": "straight-line", "unit": "m", "source": "ASSUMED",
         "note": "Main = pump to group centroid (min 2 m) unless engineering.mainLengthM; branches = valve/centroid to nozzle (min 1 m); Hazen-Williams C=130."},
        {"key": "pipes_initially_filled", "value": cfg["pipes_initially_filled"], "unit": None, "source": "SETTING",
         "note": "Branch pipes drain when idle" if cfg["drain_when_idle"] else "Pipes stay full once filled."},
        {"key": "implicit_pump_drive", "value": "sqrt(max nozzle level)", "unit": None, "source": "ASSUMED",
         "note": "Pumps without show clips follow the most demanding jet they feed (affinity law H∝N²)."},
        {"key": "implicit_valve_drive", "value": "open while a downstream jet is programmed", "unit": None,
         "source": "ASSUMED", "note": "Valves without show clips."},
        {"key": "jet_height", "value": "design height × available / design pressure", "unit": "m",
         "source": "CALCULATED", "note": "Capped at the programmed height (level × design height)."},
        {"key": "pump_tau_default_s", "value": cfg["pump_tau_s"], "unit": "s", "source": "DEFAULT",
         "note": "Used only for pumps without ramp data."},
        {"key": "valve_response_default_s", "value": cfg["solenoid_response_s"], "unit": "s", "source": "DEFAULT",
         "note": f"Solenoid; motorised {cfg['motorised_response_s']} s. Used only without equipment data."},
    ]
    citations = [p["equipment"] for p in p_out.values()] + [n["equipment"] for n in n_out.values()]
    solves = [{"index": r["index"], "signature": r["signature"], "pumpId": r["pumpId"], "speed": r["speed"],
               "openNozzles": len(r["open"]), "converged": r["converged"], "iterations": r["iterations"],
               "residuals": r["residuals"], "error": r["error"],
               "operatingPoint": {"flow_m3s": _r(r["flow"], 7), "flowLpm": _r(r["flow"] * 60000.0, 2),
                                  "head_m": _r(r["head"], 4), "iterations": r["op_iterations"],
                                  "converged": r["op_converged"], "residual_m": _r(r["op_residual_m"], 6)}}
              for r in gsolver.records]
    return {
        "contract": CONTRACT, "version": VERSION, "mode": "engineering",
        "units": {"time": "ms", "height": "m", "velocity": "m/s", "flow": "L/min (SI m3/s in solves)",
                  "head": "m", "speed": "fraction of rated"},
        "stateCodes": STATE_CODES,
        "durationMs": _r(duration * 1000.0, 1),
        "timesMs": [_r(t * 1000.0, 1) for t in times],
        "nozzles": n_out, "pumps": p_out, "valves": v_out,
        "nominal": nominal,
        "solves": solves,
        "converged": all(s["converged"] and s["operatingPoint"]["converged"] and not s["error"] for s in solves),
        "diagnostics": diagnostics,
        "assumptions": assumptions,
        "data_provenance": summarize(citations),
        "stats": {"samples": len(times), "uniqueSolves": len(gsolver.records), "cacheHits": gsolver.hits,
                  "elapsedMs": round((time.perf_counter() - t0) * 1000.0, 1)},
    }


def _nominal(groups, gsolver):
    """Every jet open at full design demand, pump at rated speed, valves open."""
    out = {}
    for pid, g in groups.items():
        if not g["nozzles"]:
            continue
        fracs = {vid: 1.0 for vid in g["valves"]}
        sol = gsolver.solve(g, 1.0, fracs, list(g["nozzles"]))
        for nid in g["nozzles"]:
            n = g["members"][nid]
            p = sol["nozzles"].get(nid, {}).get("p", 0.0)
            h = min(n["h_design"], n["h_design"] * p / n["p_design"])
            out[nid] = {"heightM": _r(h, 3), "designHeightM": _r(n["h_design"], 3),
                        "renderSpeedMs": _r(math.sqrt(2.0 * GRAVITY * n["h_design"]), 3),
                        "exitVelocityMs": _r(n["cd"] * math.sqrt(2.0 * GRAVITY * n["p_design"] * h / n["h_design"]), 3),
                        "flowLpm": _r(sol["nozzles"].get(nid, {}).get("q", 0.0) * 60000.0, 2)}
    return out


# ── cache per show revision ───────────────────────────────────────────────────

_CACHE: "OrderedDict[str, dict]" = OrderedDict()
_CACHE_SIZE = 8


def revision_of(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def show_timeline(payload: dict) -> dict:
    """Cached entry point for POST /api/hydraulics/show-timeline."""
    rev = revision_of({k: payload.get(k) for k in ("project", "show", "options")})
    hit = _CACHE.get(rev)
    if hit is not None:
        _CACHE.move_to_end(rev)
        return {**hit, "revision": rev, "cached": True}
    result = evaluate_show_hydraulics(payload.get("project") or {}, payload.get("show") or {}, payload.get("options") or {})
    _CACHE[rev] = result
    while len(_CACHE) > _CACHE_SIZE:
        _CACHE.popitem(last=False)
    return {**result, "revision": rev, "cached": False}


# ── AF-NEXT-009 preflight hook ────────────────────────────────────────────────

_SHOW_KEYS = ("clips", "duration", "groups", "recipes", "tempo", "sections", "frameOpts")


def get_hydraulic_diagnostics(project: dict, show: dict | None = None, options: dict | None = None) -> list:
    """Diagnostics in the shared shape (services/preflight.py `_hydraulics` hook).

    `show` defaults to the project itself (preflight projects carry their clips). The
    request mirrors the frontend's buildShowTimelinePayload exactly, so the revision cache
    is shared and the backend gate and the Preflight panel report identical findings.
    Splash (AF-NEXT-008) is evaluated in the frontend only (engineering/splashEnvelope.js);
    it is advisory and is not part of the backend hardware gate.
    """
    project = project or {}
    show = show if isinstance(show, dict) else project
    fixtures = [f for f in project.get("fixtures") or [] if isinstance(f, dict) and f.get("id") is not None]
    if not any(_is_water_nozzle(f) for f in fixtures):
        return []
    payload = {
        "project": {"fixtures": fixtures, "params": project.get("params") or {},
                    **({"hydraulic_network": project["hydraulic_network"]} if project.get("hydraulic_network") else {})},
        "show": {k: show[k] for k in _SHOW_KEYS if show.get(k) is not None},
        "options": dict(options or {}),
    }
    payload["show"].setdefault("clips", [])
    return [{k: v for k, v in d.items() if k != "endMs"} for d in show_timeline(payload)["diagnostics"]]
