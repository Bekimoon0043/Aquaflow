"""
pipe_sizing.py — AquaFlow Stage 2, Priority 3 (AQ-S2-003)

Pipe sizing engine for fountain hydraulic networks.

For a given flow rate it suggests an optimal commercial pipe diameter, and it
flags existing pipes that are undersized (velocity too high → excessive head
loss, noise, erosion, water hammer) or oversized (velocity too low → settling of
debris, wasted capital and space).

The design driver is fluid velocity: v = Q / A, A = π d² / 4. The target velocity
band is configurable; the fountain-industry defaults below are conservative for
continuously-run recirculating systems.

Pairs with the hydraulic solver (AQ-S2-001): solve a network for its pipe flows,
then size every pipe against those flows via ``size_network``.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional


# Standard commercial pipe catalog — DN nominal (mm) → representative inner
# diameter (mm). Nominal bore is used as the sizing reference; real projects can
# substitute a schedule-specific ID table without changing the algorithm.
STANDARD_PIPE_SIZES_MM: list[tuple[str, float]] = [
    ("DN15", 15), ("DN20", 20), ("DN25", 25), ("DN32", 32), ("DN40", 40),
    ("DN50", 50), ("DN65", 65), ("DN80", 80), ("DN100", 100), ("DN125", 125),
    ("DN150", 150), ("DN200", 200), ("DN250", 250), ("DN300", 300),
    ("DN350", 350), ("DN400", 400), ("DN450", 450), ("DN500", 500),
    ("DN600", 600),
]


@dataclass
class VelocityLimits:
    """Configurable acceptable-velocity band (m/s)."""
    v_min: float = 0.6      # below → oversized (sedimentation, wasted capital)
    v_max: float = 2.5      # above → undersized (head loss, noise, erosion)
    v_target: float = 1.5   # preferred design velocity

    def normalized(self) -> "VelocityLimits":
        vmin = max(0.0, float(self.v_min))
        vmax = max(vmin + 1e-6, float(self.v_max))
        vt = min(max(float(self.v_target), vmin), vmax)
        return VelocityLimits(vmin, vmax, vt)


@dataclass
class PipeSizingResult:
    pipe_id: str
    flow_m3s: float
    current_diameter_m: Optional[float]
    current_velocity_ms: Optional[float]
    status: str                       # "ok" | "undersized" | "oversized" | "no_flow"
    suggested_size: Optional[str]     # DN label
    suggested_diameter_m: Optional[float]
    suggested_velocity_ms: Optional[float]
    message: str = ""
    details: dict = field(default_factory=dict)


def velocity(flow_m3s: float, diameter_m: float) -> float:
    """Fluid velocity (m/s). Sign follows flow direction."""
    d = max(float(diameter_m), 1e-9)
    area = math.pi * d * d / 4.0
    return float(flow_m3s) / area


def required_diameter(flow_m3s: float, v_target: float) -> float:
    """Continuous inner diameter (m) that hits the target velocity exactly."""
    q = abs(float(flow_m3s))
    v = max(float(v_target), 1e-9)
    return math.sqrt(4.0 * q / (math.pi * v))


class PipeSizingEngine:
    def __init__(self, limits: Optional[VelocityLimits] = None):
        self.limits = (limits or VelocityLimits()).normalized()

    # ── Diameter suggestion ────────────────────────────────────────────────────
    def suggest_size(self, flow_m3s: float) -> tuple[Optional[str], Optional[float], Optional[float]]:
        """
        Suggest the optimal standard pipe size: the smallest catalog diameter at
        least as large as the continuous diameter that hits the target velocity
        (i.e. round the target-velocity diameter up to the next standard size).
        This lands the velocity at or just below v_target — comfortably inside the
        [v_min, v_max] band with head-loss margin, rather than right at v_max.

        Returns (DN label, inner diameter m, resulting velocity m/s), or
        (None, ...) for zero flow.
        """
        q = abs(float(flow_m3s))
        if q < 1e-12:
            return None, None, None
        lim = self.limits
        d_target = required_diameter(q, lim.v_target)
        # Standard sizes are ascending; pick the first at least d_target so the
        # resulting velocity is <= v_target (never undersized, with margin).
        for label, dn_mm in STANDARD_PIPE_SIZES_MM:
            d = dn_mm / 1000.0
            if d >= d_target:
                return label, d, velocity(q, d)
        # Target diameter exceeds the largest catalog size — return the largest.
        label, dn_mm = STANDARD_PIPE_SIZES_MM[-1]
        d = dn_mm / 1000.0
        return label, d, velocity(q, d)

    # ── Existing-pipe evaluation ───────────────────────────────────────────────
    def evaluate(self, pipe_id: str, flow_m3s: float,
                 diameter_m: Optional[float]) -> PipeSizingResult:
        lim = self.limits
        q = float(flow_m3s)
        suggested_label, suggested_d, suggested_v = self.suggest_size(q)

        if abs(q) < 1e-12:
            return PipeSizingResult(
                pipe_id=pipe_id, flow_m3s=q, current_diameter_m=diameter_m,
                current_velocity_ms=(velocity(q, diameter_m) if diameter_m else 0.0),
                status="no_flow", suggested_size=None, suggested_diameter_m=None,
                suggested_velocity_ms=None,
                message="No flow — sizing not applicable.",
                details={"limits": vars(lim)},
            )

        if diameter_m is None:
            return PipeSizingResult(
                pipe_id=pipe_id, flow_m3s=q, current_diameter_m=None,
                current_velocity_ms=None, status="ok",
                suggested_size=suggested_label, suggested_diameter_m=suggested_d,
                suggested_velocity_ms=suggested_v,
                message=f"Suggested {suggested_label} "
                        f"({suggested_d*1000:.0f} mm, v≈{suggested_v:.2f} m/s).",
                details={"limits": vars(lim)},
            )

        v = velocity(q, diameter_m)
        if v > lim.v_max:
            status = "undersized"
            msg = (f"Undersized: v={v:.2f} m/s exceeds {lim.v_max:.2f} m/s max. "
                   f"Increase to {suggested_label} ({suggested_d*1000:.0f} mm).")
        elif v < lim.v_min:
            status = "oversized"
            msg = (f"Oversized: v={v:.2f} m/s below {lim.v_min:.2f} m/s min. "
                   f"Reduce to {suggested_label} ({suggested_d*1000:.0f} mm).")
        else:
            status = "ok"
            msg = f"OK: v={v:.2f} m/s within [{lim.v_min:.2f}, {lim.v_max:.2f}] m/s."

        return PipeSizingResult(
            pipe_id=pipe_id, flow_m3s=q, current_diameter_m=float(diameter_m),
            current_velocity_ms=v, status=status,
            suggested_size=suggested_label, suggested_diameter_m=suggested_d,
            suggested_velocity_ms=suggested_v, message=msg,
            details={
                "limits": vars(lim),
                "required_diameter_m": required_diameter(q, lim.v_target),
            },
        )


# ── Dict / network convenience APIs ────────────────────────────────────────────
def _limits_from_payload(payload: dict) -> VelocityLimits:
    lim = payload.get("velocity_limits") or payload.get("limits") or {}
    return VelocityLimits(
        v_min=float(lim.get("v_min", 0.6)),
        v_max=float(lim.get("v_max", 2.5)),
        v_target=float(lim.get("v_target", 1.5)),
    )


def size_pipes(payload: dict) -> dict:
    """
    Size a list of pipes whose flows are already known.

    payload = {
      "pipes": [{"id","flow_m3s","diameter"(optional)}, ...],
      "velocity_limits": {"v_min","v_max","v_target"}   # optional
    }
    """
    engine = PipeSizingEngine(_limits_from_payload(payload))
    results = []
    for p in payload.get("pipes", []):
        res = engine.evaluate(
            pipe_id=str(p.get("id")),
            flow_m3s=float(p.get("flow_m3s", p.get("flow", 0.0))),
            diameter_m=(None if p.get("diameter") is None else float(p["diameter"])),
        )
        results.append(_result_to_dict(res))
    return {
        "velocity_limits": vars(engine.limits),
        "pipes": results,
        "summary": _summarize(results),
    }


def size_network(payload: dict) -> dict:
    """
    Solve a hydraulic network for its flows (AQ-S2-001) and size every pipe
    against those flows. payload is a hydraulic-solver network plus optional
    "velocity_limits".
    """
    from services.hydraulic_solver import solve_network

    solved = solve_network(payload)
    flow_by_id = {p["id"]: p["flow_m3s"] for p in solved["pipes"]}
    diameter_by_id = {str(p["id"]): float(p.get("diameter", p.get("diameter_m", 0.0)) or 0.0)
                      for p in payload.get("pipes", [])}

    engine = PipeSizingEngine(_limits_from_payload(payload))
    results = []
    for pid, flow in flow_by_id.items():
        d = diameter_by_id.get(pid) or None
        results.append(_result_to_dict(engine.evaluate(pid, flow, d)))

    return {
        "velocity_limits": vars(engine.limits),
        "hydraulics": {
            "converged": solved["converged"],
            "topology": solved["topology"],
            "residuals": solved["residuals"],
        },
        "pipes": results,
        "summary": _summarize(results),
    }


def _result_to_dict(r: PipeSizingResult) -> dict:
    return {
        "pipe_id": r.pipe_id,
        "flow_m3s": round(r.flow_m3s, 8),
        "flow_lpm": round(r.flow_m3s * 60000.0, 3),
        "current_diameter_m": r.current_diameter_m,
        "current_velocity_ms": (None if r.current_velocity_ms is None
                                else round(r.current_velocity_ms, 4)),
        "status": r.status,
        "suggested_size": r.suggested_size,
        "suggested_diameter_m": r.suggested_diameter_m,
        "suggested_velocity_ms": (None if r.suggested_velocity_ms is None
                                  else round(r.suggested_velocity_ms, 4)),
        "message": r.message,
        "details": r.details,
    }


def _summarize(results: list[dict]) -> dict:
    counts = {"ok": 0, "undersized": 0, "oversized": 0, "no_flow": 0}
    for r in results:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    return {
        "total": len(results),
        **counts,
        "issues": counts.get("undersized", 0) + counts.get("oversized", 0),
    }
