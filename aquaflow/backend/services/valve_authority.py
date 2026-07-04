"""
valve_authority.py — AquaFlow Recovery, AQ-X-007

Valve authority engine for flow control.

Control-valve authority is the single most important number for good modulating
flow control:

    β = ΔP_valve(fully open)  /  ΔP_total(valve + rest of the controlled circuit)

evaluated at design flow. A high-authority valve (β ≥ 0.5) keeps its installed
characteristic close to its inherent one, so control is stable and near-linear; a
low-authority (oversized) valve is effectively on/off over the first part of its
travel. This module:

  * calculates valve authority correctly — from a valve Kv + circuit resistance, or
    directly from two pressure drops, with the standard installed-characteristic
    distortion  q(φ) = φ / √(β + (1−β)·φ²),
  * generates flow-control recommendations — an authority rating, the inherent
    characteristic to specify (linear vs equal-percentage), and a target Kv / valve
    ΔP to reach good authority when the valve is oversized,
  * integrates with the hydraulic solver — `kv_to_minor_loss` places a valve of a
    given Kv into a network as a minor loss, and `authority_from_network` runs the
    solver and derives the authority from the solved head losses.

Units: Kv in m³/h per √bar, flow in m³/h (SI m³/s where noted), ΔP in bar, head in m.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

from services.hydraulic_solver import solve_network, GRAVITY

BAR_TO_M = 10.19716          # 1 bar of water column ≈ 10.197 m head
M3H_PER_M3S = 3600.0


# ── Core authority maths ──────────────────────────────────────────────────────

def valve_delta_p_bar(kv: float, flow_m3h: float, sg: float = 1.0) -> float:
    """Pressure drop (bar) across a valve of coefficient Kv at flow (m³/h).  Q = Kv·√(ΔP/SG)."""
    if kv <= 0:
        raise ValueError("Kv must be > 0")
    return sg * (flow_m3h / kv) ** 2


def kv_for_delta_p(delta_p_bar: float, flow_m3h: float, sg: float = 1.0) -> float:
    """The Kv that produces `delta_p_bar` at the given flow."""
    if delta_p_bar <= 0:
        raise ValueError("delta_p must be > 0")
    return flow_m3h * math.sqrt(sg / delta_p_bar)


def authority(dp_valve_open: float, dp_rest: float) -> float:
    """β = ΔP_valve / (ΔP_valve + ΔP_rest). Both drops at design flow, same units."""
    total = dp_valve_open + dp_rest
    if total <= 0:
        return 0.0
    return dp_valve_open / total


def classify_authority(beta: float) -> str:
    """Rate a valve's authority: good ≥ 0.5, acceptable ≥ 0.25, else poor."""
    if beta >= 0.5:
        return "good"
    if beta >= 0.25:
        return "acceptable"
    return "poor"


# ── Inherent + installed characteristics ──────────────────────────────────────

def inherent_phi(lift: float, characteristic: str = "linear",
                 rangeability: float = 50.0) -> float:
    """Fractional Kv φ (0..1) at a fractional lift (0..1) for the valve's inherent curve."""
    h = 0.0 if lift < 0 else 1.0 if lift > 1 else float(lift)
    c = characteristic.lower()
    if c in ("equal_percentage", "equal-percentage", "eqpct", "="):
        return rangeability ** (h - 1.0)                 # φ(0)=1/R, φ(1)=1
    if c in ("quick_opening", "quick-opening", "quick"):
        return math.sqrt(h)
    return h                                             # linear


def installed_flow(phi: float, beta: float) -> float:
    """
    Normalised installed flow for an inherent fractional-Kv φ at authority β:
        q(φ) = φ / √(β + (1−β)·φ²)
    q(1)=1 (fully open); low β steepens the curve (poor early-travel control).
    """
    phi = max(0.0, min(1.0, phi))
    denom = beta + (1.0 - beta) * phi * phi
    return phi / math.sqrt(denom) if denom > 0 else 0.0


def installed_characteristic(beta: float, characteristic: str = "linear",
                             steps: int = 11, rangeability: float = 50.0) -> list[dict]:
    """Installed characteristic q vs lift for the given inherent curve and authority."""
    out = []
    for i in range(steps):
        h = i / (steps - 1)
        phi = inherent_phi(h, characteristic, rangeability)
        out.append({"lift": round(h, 4), "phi": round(phi, 5),
                    "installed_flow": round(installed_flow(phi, beta), 5)})
    return out


def linearity_error(beta: float, characteristic: str, steps: int = 21,
                    rangeability: float = 50.0) -> float:
    """Max deviation of the installed characteristic from the ideal linear q=lift."""
    worst = 0.0
    for i in range(steps):
        h = i / (steps - 1)
        q = installed_flow(inherent_phi(h, characteristic, rangeability), beta)
        worst = max(worst, abs(q - h))
    return worst


# ── Recommendations ───────────────────────────────────────────────────────────

def recommend_characteristic(beta: float, rangeability: float = 50.0) -> str:
    """
    Pick the inherent characteristic whose installed curve is closest to linear at
    this authority — the practical rule of thumb (equal-% for lower authority).
    """
    lin = linearity_error(beta, "linear", rangeability=rangeability)
    eqp = linearity_error(beta, "equal_percentage", rangeability=rangeability)
    return "linear" if lin <= eqp else "equal_percentage"


def kv_for_authority(dp_rest_bar: float, flow_m3h: float, beta_target: float,
                     sg: float = 1.0) -> float:
    """Kv that yields `beta_target` given the rest-of-circuit drop at design flow."""
    beta_target = min(max(beta_target, 1e-6), 0.99)
    # β = dpv/(dpv+dprest)  →  dpv = dprest·β/(1−β)
    dpv_target = dp_rest_bar * beta_target / (1.0 - beta_target)
    return kv_for_delta_p(dpv_target, flow_m3h, sg)


def recommend(dp_valve_open_bar: float, dp_rest_bar: float, flow_m3h: float,
              sg: float = 1.0) -> dict:
    """Full flow-control recommendation from the fully-open valve + rest-of-circuit drops."""
    beta = authority(dp_valve_open_bar, dp_rest_bar)
    rating = classify_authority(beta)
    char = recommend_characteristic(beta)

    messages: list[str] = []
    if rating == "good":
        messages.append("Authority is good (β ≥ 0.5) — the installed characteristic tracks "
                        "the inherent one; a linear valve gives near-linear control.")
    elif rating == "acceptable":
        messages.append("Authority is acceptable (0.25 ≤ β < 0.5) — specify an "
                        "equal-percentage characteristic to linearise the installed response.")
    else:
        messages.append("Authority is POOR (β < 0.25) — the valve is oversized and will act "
                        "nearly on/off. Reduce Kv so more of the circuit drop is taken across "
                        "the valve.")

    # Target Kv band to reach acceptable→good authority (β 0.25 … 0.5).
    kv_good = kv_for_authority(dp_rest_bar, flow_m3h, 0.5, sg)
    kv_min = kv_for_authority(dp_rest_bar, flow_m3h, 0.25, sg)
    current_kv = kv_for_delta_p(dp_valve_open_bar, flow_m3h, sg) if dp_valve_open_bar > 0 else None

    return {
        "authority": round(beta, 4),
        "rating": rating,
        "recommended_characteristic": char,
        "recommended_kv": {
            "for_good_authority_beta_0_50": round(kv_good, 3),
            "max_for_acceptable_beta_0_25": round(kv_min, 3),
            "current_kv": round(current_kv, 3) if current_kv else None,
            "oversized": bool(current_kv and current_kv > kv_min),
        },
        "installed_linearity_error": round(linearity_error(beta, char), 4),
        "messages": messages,
    }


# ── Hydraulic-solver integration ──────────────────────────────────────────────

def kv_to_minor_loss(kv: float, diameter_m: float, sg: float = 1.0) -> float:
    """
    Convert a valve Kv into the dimensionless minor-loss K the hydraulic solver uses
    (h = K·Q²/(2·g·A²)), so the valve can be dropped into a network as a pipe.

    Flow-independent: equating the valve head loss (from Kv) with the solver's minor
    loss cancels Q², giving K = 2·g·A²·SG·BAR_TO_M·(3600/Kv)².
    """
    if kv <= 0:
        raise ValueError("Kv must be > 0")
    area = math.pi * (diameter_m ** 2) / 4.0
    return 2.0 * GRAVITY * area * area * sg * BAR_TO_M * (M3H_PER_M3S / kv) ** 2


def authority_from_network(network: dict, valve_pipe_id: str, sg: float = 1.0) -> dict:
    """
    Run the hydraulic solver on `network` and derive the valve authority from the
    solved head losses: β = headloss_valve / Σ headloss_along_the_flow_path.

    The valve should be one of the pipes (model it with `kv_to_minor_loss`). Returns
    the authority plus the solved flow and a Kv cross-check at that flow.
    """
    result = solve_network(network)
    pipes = {p["id"]: p for p in result["pipes"]}
    if valve_pipe_id not in pipes:
        raise KeyError(f"valve pipe '{valve_pipe_id}' not in the network")

    total_hl = sum(abs(p["headloss_m"]) for p in result["pipes"])
    valve_hl = abs(pipes[valve_pipe_id]["headloss_m"])
    rest_hl = total_hl - valve_hl
    beta = authority(valve_hl, rest_hl)

    return {
        "converged": result["converged"],
        "authority": round(beta, 4),
        "rating": classify_authority(beta),
        "valve_headloss_m": round(valve_hl, 6),
        "circuit_headloss_m": round(rest_hl, 6),
        "total_headloss_m": round(total_hl, 6),
        "valve_flow_m3s": round(abs(pipes[valve_pipe_id]["flow_m3s"]), 8),
        "valve_flow_m3h": round(abs(pipes[valve_pipe_id]["flow_m3s"]) * M3H_PER_M3S, 4),
    }


# ── JSON entry point ──────────────────────────────────────────────────────────

def analyze(payload: dict) -> dict:
    """
    Compute authority + recommendations. Accepts either explicit pressure drops or a
    Kv + circuit drop:
      {"dp_valve_bar": .., "dp_rest_bar": .., "flow_m3h": .., "sg": 1.0}
      {"kv": .., "flow_m3h": .., "dp_rest_bar": .., "sg": 1.0}
    """
    sg = float(payload.get("sg", 1.0))
    flow = float(payload.get("flow_m3h", 0.0))
    dp_rest = float(payload.get("dp_rest_bar", 0.0))

    if "dp_valve_bar" in payload:
        dp_valve = float(payload["dp_valve_bar"])
    elif "kv" in payload:
        if flow <= 0:
            raise ValueError("flow_m3h required with kv")
        dp_valve = valve_delta_p_bar(float(payload["kv"]), flow, sg)
    else:
        raise ValueError("provide dp_valve_bar or kv")

    rec = recommend(dp_valve, dp_rest, flow if flow > 0 else 1.0, sg)
    rec["dp_valve_bar"] = round(dp_valve, 5)
    rec["dp_rest_bar"] = round(dp_rest, 5)
    rec["installed_characteristic"] = installed_characteristic(
        rec["authority"], rec["recommended_characteristic"])
    return rec
