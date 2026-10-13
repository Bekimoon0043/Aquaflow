"""
pump_curve.py — AquaFlow Recovery, AQ-X-006

Pump curve engine for hydraulic calculations.

A centrifugal pump is characterised by its head–flow (H–Q) curve. The duty (operating)
point of an installation is where the pump curve meets the system curve
(H_sys = H_static + k·Q²). This module:

  * integrates pump curve data — fits manufacturer H–Q (and optional efficiency)
    points to a quadratic characteristic H(Q) = c0 + c1·Q + c2·Q², with a small
    built-in catalog of realistic pumps,
  * computes the operating point correctly — the true intersection of the pump curve
    and the system curve (robust bracketed root find), plus efficiency, hydraulic and
    shaft power at the duty point,
  * supports multiple pump configurations — pumps in parallel (flows add at equal
    head), in series (heads add at equal flow), and variable speed via the affinity
    laws (Q∝N, H∝N², P∝N³).

SI units throughout: flow Q in m³/s, head H in m, power in W. Efficiency is 0..1.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

from services.equipment_provenance import cite, normalize_provenance, summarize

GRAVITY = 9.81          # m/s²
WATER_DENSITY = 1000.0  # kg/m³ (fresh water)


# ── Pump curve (single pump) ──────────────────────────────────────────────────

class PumpCurve:
    """
    A single pump's head–flow characteristic H(Q) = c0 + c1·Q + c2·Q².

    Build from manufacturer H–Q points (`from_points`) or directly from coefficients.
    Head decreases monotonically from the shutoff head (Q=0) to zero at the pump's
    maximum flow.
    """

    def __init__(self, c0: float, c1: float, c2: float, name: str = "pump",
                 eff_coeffs: Optional[tuple] = None,
                 speed_ratio: float = 1.0, rated_speed: float = 1.0):
        self.name = name
        self.c0, self.c1, self.c2 = float(c0), float(c1), float(c2)
        self.eff_coeffs = eff_coeffs          # (e0, e1, e2) for η(Q), or None
        self.speed_ratio = float(speed_ratio)
        self.rated_speed = float(rated_speed)
        # AF-NEXT-012 — curve-set provenance; generic estimate unless stated.
        self.provenance = normalize_provenance(None, kind="pump", model=name)
        self.shutoff_head = self.head(0.0)
        self.max_flow = self._solve_zero_head()

    # ── Construction ──────────────────────────────────────────────────────────
    @classmethod
    def from_points(cls, flows: list, heads: list, name: str = "pump",
                    eff_points: Optional[tuple] = None) -> "PumpCurve":
        """Least-squares fit a quadratic H(Q) to measured H–Q points."""
        q = np.asarray(flows, dtype=float)
        h = np.asarray(heads, dtype=float)
        if q.size < 3:
            raise ValueError("need at least 3 H–Q points to fit a pump curve")
        c2, c1, c0 = np.polyfit(q, h, 2)      # highest power first
        eff_coeffs = None
        if eff_points is not None:
            eq, ee = np.asarray(eff_points[0], float), np.asarray(eff_points[1], float)
            if eq.size >= 3:
                e2, e1, e0 = np.polyfit(eq, ee, 2)
                eff_coeffs = (float(e0), float(e1), float(e2))
        return cls(float(c0), float(c1), float(c2), name=name, eff_coeffs=eff_coeffs)

    # ── Evaluation ────────────────────────────────────────────────────────────
    def head(self, q: float) -> float:
        """Head (m) developed at flow q (m³/s)."""
        q = max(0.0, float(q))
        return self.c0 + self.c1 * q + self.c2 * q * q

    def efficiency(self, q: float) -> Optional[float]:
        if not self.eff_coeffs:
            return None
        e0, e1, e2 = self.eff_coeffs
        return max(0.0, min(1.0, e0 + e1 * q + e2 * q * q))

    def _solve_zero_head(self) -> float:
        """Largest positive flow at which head reaches 0 (the pump's max flow)."""
        a, b, c = self.c2, self.c1, self.c0
        if abs(a) < 1e-15:
            if abs(b) < 1e-15:
                return 1.0
            root = -c / b
            return root if root > 0 else 1.0
        disc = b * b - 4 * a * c
        if disc < 0:
            return 1.0
        r1 = (-b + math.sqrt(disc)) / (2 * a)
        r2 = (-b - math.sqrt(disc)) / (2 * a)
        roots = [r for r in (r1, r2) if r > 1e-9]
        return min(roots) if roots else 1.0

    def flow_at_head(self, h: float) -> float:
        """Inverse: the flow (m³/s) at which the pump produces head h."""
        if h >= self.shutoff_head:
            return 0.0
        if h <= self.head(self.max_flow):
            return self.max_flow
        lo, hi = 0.0, self.max_flow
        for _ in range(80):
            mid = 0.5 * (lo + hi)
            if self.head(mid) > h:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    # ── Affinity laws (variable speed) ────────────────────────────────────────
    def at_speed(self, speed_ratio: float) -> "PumpCurve":
        """
        Scale the curve to a new speed via the affinity laws: Q∝N, H∝N².
        H_s(Q) = s²·H(Q/s) ⇒ coefficients (s²·c0, s·c1, c2).
        """
        s = max(1e-6, float(speed_ratio))
        scaled = PumpCurve(self.c0 * s * s, self.c1 * s, self.c2,
                           name=f"{self.name}@{s:.2f}",
                           eff_coeffs=self.eff_coeffs, speed_ratio=s)
        scaled.provenance = self.provenance      # same curve set, scaled by affinity laws
        return scaled

    def with_provenance(self, prov) -> "PumpCurve":
        self.provenance = normalize_provenance(prov, kind="pump", model=self.name)
        return self

    def citation(self) -> dict:
        return cite(self.provenance, equipment_model=self.name, kind="pump",
                    units={"flow": "m3/s", "head": "m", "power": "W"})

    # ── Power ─────────────────────────────────────────────────────────────────
    def hydraulic_power(self, q: float, h: Optional[float] = None) -> float:
        """Water (hydraulic) power P = ρ·g·Q·H (W)."""
        h = self.head(q) if h is None else h
        return WATER_DENSITY * GRAVITY * max(0.0, q) * max(0.0, h)

    def shaft_power(self, q: float, h: Optional[float] = None) -> Optional[float]:
        """Shaft power = hydraulic power / efficiency (W); None without an eff curve."""
        eff = self.efficiency(q)
        if not eff or eff <= 0:
            return None
        return self.hydraulic_power(q, h) / eff

    def to_dict(self) -> dict:
        return {"name": self.name, "coeffs": [self.c0, self.c1, self.c2],
                "shutoff_head_m": round(self.shutoff_head, 4),
                "max_flow_m3s": round(self.max_flow, 6),
                "speed_ratio": self.speed_ratio,
                "provenance": self.provenance, "citation": self.citation()}


# ── System curve ──────────────────────────────────────────────────────────────

@dataclass
class SystemCurve:
    """Installation resistance: H_sys(Q) = static_head + k·Q²."""
    static_head: float = 0.0     # m — the lift the pump must overcome at zero flow
    k: float = 0.0               # s²/m⁵ — resistance coefficient

    def head(self, q: float) -> float:
        q = max(0.0, float(q))
        return self.static_head + self.k * q * q

    def flow_at_head(self, h: float) -> float:
        if h <= self.static_head or self.k <= 0:
            return 0.0
        return math.sqrt((h - self.static_head) / self.k)

    @classmethod
    def from_design_point(cls, static_head: float, q_design: float, h_design: float) -> "SystemCurve":
        """Fit k so the curve passes through a known duty point (Q_d, H_d)."""
        if q_design <= 0:
            raise ValueError("design flow must be > 0")
        k = (h_design - static_head) / (q_design * q_design)
        return cls(static_head=static_head, k=max(0.0, k))


# ── Multiple pump configurations ──────────────────────────────────────────────

class PumpSystem:
    """
    A group of pumps in `parallel` (flows add at equal head) or `series` (heads add
    at equal flow). Exposes the same head(Q) / flow_at_head(H) interface as a single
    pump so the operating point solves uniformly.
    """

    def __init__(self, pumps: list[PumpCurve], mode: str = "parallel", name: str = ""):
        if not pumps:
            raise ValueError("a pump system needs at least one pump")
        self.pumps = pumps
        self.mode = mode.lower()
        if self.mode not in ("parallel", "series", "single"):
            raise ValueError("mode must be parallel, series or single")
        self.name = name or f"{len(pumps)}× {self.mode}"
        if self.mode == "series":
            self.shutoff_head = sum(p.shutoff_head for p in pumps)
            self.max_flow = min(p.max_flow for p in pumps)
        elif self.mode == "parallel":
            self.shutoff_head = max(p.shutoff_head for p in pumps)
            self.max_flow = sum(p.max_flow for p in pumps)
        else:  # single
            self.shutoff_head = pumps[0].shutoff_head
            self.max_flow = pumps[0].max_flow

    def head(self, q: float) -> float:
        q = max(0.0, float(q))
        if self.mode == "series":
            return sum(p.head(q) for p in self.pumps)
        if self.mode == "single":
            return self.pumps[0].head(q)
        # parallel: find the common head H at which the pumps together pass flow q.
        if q <= 0:
            return self.shutoff_head
        if q >= self.max_flow:
            return 0.0
        lo, hi = 0.0, self.shutoff_head
        for _ in range(80):
            mid = 0.5 * (lo + hi)
            if self.total_flow_at_head(mid) > q:
                lo = mid            # too much flow → need higher head
            else:
                hi = mid
        return 0.5 * (lo + hi)

    def total_flow_at_head(self, h: float) -> float:
        if self.mode == "series":
            # invert the summed head curve numerically
            if h >= self.shutoff_head:
                return 0.0
            if h <= self.head(self.max_flow):
                return self.max_flow
            lo, hi = 0.0, self.max_flow
            for _ in range(80):
                mid = 0.5 * (lo + hi)
                if self.head(mid) > h:
                    lo = mid
                else:
                    hi = mid
            return 0.5 * (lo + hi)
        if self.mode == "single":
            return self.pumps[0].flow_at_head(h)
        return sum(p.flow_at_head(h) for p in self.pumps)   # parallel

    def per_pump_flow(self, q_total: float, h_op: float) -> list[float]:
        """How the total duty flow splits across the pumps at the operating head."""
        if self.mode == "series":
            return [q_total for _ in self.pumps]            # same flow through all
        if self.mode == "single":
            return [q_total]
        return [p.flow_at_head(h_op) for p in self.pumps]   # parallel: split by head


# ── Operating point ───────────────────────────────────────────────────────────

def operating_point(pump, system: SystemCurve) -> dict:
    """
    Duty point where the pump (or pump system) curve meets the system curve.

    Returns flow, head, per-pump flow split, and efficiency/power where available.
    `converged` is False when the pump cannot overcome the static head (no duty point).
    """
    max_flow = getattr(pump, "max_flow", 1.0)

    def f(q):
        return pump.head(q) - system.head(q)

    # If the pump can't even lift the static head at shutoff, there is no duty point.
    if f(0.0) <= 0:
        return {"converged": False, "flow_m3s": 0.0, "head_m": pump.head(0.0),
                "reason": "pump shutoff head below system static head"}

    lo, hi = 0.0, max_flow
    if f(hi) > 0:                        # pump curve never drops below system in range
        hi = max_flow                    # clamp; head at max_flow is ~0
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            lo = mid
        else:
            hi = mid
    q_op = 0.5 * (lo + hi)
    h_op = system.head(q_op)

    result = {
        "converged": True,
        "flow_m3s": q_op,
        "flow_lpm": q_op * 60000.0,
        "head_m": h_op,
        "residual_m": abs(pump.head(q_op) - h_op),
    }

    # Per-pump split + power (for a PumpSystem) or single-pump efficiency/power.
    if isinstance(pump, PumpSystem):
        splits = pump.per_pump_flow(q_op, h_op)
        result["per_pump_flow_m3s"] = splits
        hyd = sum(WATER_DENSITY * GRAVITY * qf * (h_op if pump.mode != "series" else p.head(qf))
                  for qf, p in zip(splits, pump.pumps))
        result["hydraulic_power_w"] = hyd
    elif isinstance(pump, PumpCurve):
        eff = pump.efficiency(q_op)
        result["hydraulic_power_w"] = pump.hydraulic_power(q_op, h_op)
        if eff is not None:
            result["efficiency"] = eff
            sp = pump.shaft_power(q_op, h_op)
            if sp is not None:
                result["shaft_power_w"] = sp
    return result


# ── Built-in pump catalog (data integration) ──────────────────────────────────
# GENERIC H–Q curve sets (flow m³/s, head m). They are shaped like typical fountain
# pumps but are NOT any manufacturer's published curve — AF-NEXT-012 labels them
# generic_estimate. Verified pump curves (datasheet / measured) come from the
# equipment registry (services/equipment_registry.py) and are looked up by id.
GENERIC_PUMP_PROVENANCE = {
    "source": "generic_estimate",
    "notes": "AquaFlow generic pump curve — not a manufacturer curve. Verify with the supplier datasheet.",
}
PUMP_CATALOG: dict = {
    "fountain-small": {
        "flows": [0.0, 0.01, 0.02, 0.03, 0.04],
        "heads": [22.0, 20.6, 17.8, 13.2, 6.5],
    },
    "fountain-medium": {
        "flows": [0.0, 0.03, 0.06, 0.09, 0.12],
        "heads": [48.0, 45.0, 39.0, 29.5, 16.0],
    },
    "fountain-large": {
        "flows": [0.0, 0.05, 0.10, 0.15, 0.20, 0.25],
        "heads": [72.0, 69.0, 62.0, 51.0, 36.0, 17.0],
    },
}


def _verified_pump(model: str) -> Optional[dict]:
    try:
        from services.equipment_registry import get_equipment_registry
        return get_equipment_registry().get("pump", model)
    except Exception:
        return None


def load_catalog_pump(model: str) -> PumpCurve:
    if model in PUMP_CATALOG:
        d = PUMP_CATALOG[model]
        return PumpCurve.from_points(d["flows"], d["heads"], name=model).with_provenance(
            {**GENERIC_PUMP_PROVENANCE, "model": model})
    rec = _verified_pump(model)
    if rec is None:
        raise KeyError(f"unknown pump model '{model}'")
    d = rec.get("data") or {}
    eff = d.get("efficiency") or {}
    eff_points = (eff.get("flows"), eff.get("values")) if eff.get("flows") and eff.get("values") else None
    return PumpCurve.from_points(d["flows"], d["heads"], name=rec["id"],
                                 eff_points=eff_points).with_provenance(rec["provenance"])


def analyze(payload: dict) -> dict:
    """
    JSON-friendly entry point.

    payload = {
      "pump": {"model": "fountain-medium"}  OR  {"flows":[...], "heads":[...]}
               (+ optional "speed_ratio", "count", "mode": parallel|series),
      "system": {"static_head": .., "k": ..}  OR  {"static_head":.., "q_design":.., "h_design":..}
    }
    """
    pspec = payload.get("pump", {}) or {}
    if pspec.get("model"):
        base = load_catalog_pump(pspec["model"])
    else:
        # Ad-hoc points: generic estimate unless the caller supplies a provenance block
        # that meets the trust rules (normalize_provenance downgrades otherwise).
        base = PumpCurve.from_points(pspec["flows"], pspec["heads"],
                                     name=pspec.get("name", "pump"))
        base.with_provenance(pspec.get("provenance"))
    if pspec.get("speed_ratio", 1.0) != 1.0:
        base = base.at_speed(float(pspec["speed_ratio"]))

    count = int(pspec.get("count", 1))
    mode = pspec.get("mode", "single")
    if count > 1 and mode in ("parallel", "series"):
        pump = PumpSystem([base] * count, mode=mode)
    else:
        pump = base

    sspec = payload.get("system", {}) or {}
    if "k" in sspec:
        system = SystemCurve(static_head=float(sspec.get("static_head", 0.0)),
                             k=float(sspec["k"]))
    else:
        system = SystemCurve.from_design_point(
            float(sspec.get("static_head", 0.0)),
            float(sspec["q_design"]), float(sspec["h_design"]))

    op = operating_point(pump, system)
    citation = base.citation()
    op["equipment"] = citation
    return {
        "data_provenance": summarize([citation]),
        "pump": base.to_dict(),
        "configuration": {"count": count, "mode": mode if count > 1 else "single"},
        "system": {"static_head_m": system.static_head, "k": system.k},
        "operating_point": op,
    }
