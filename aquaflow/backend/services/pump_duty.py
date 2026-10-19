"""
pump_duty.py — a placed pump's duty point and what its motor can actually drive.

The Engineering Designer edits a pump's Flow (m³/h), Head (m), Power (kW) and
Efficiency (%). The duty point comes from flow + head. Power and efficiency matter
when the motor cannot supply that duty: the water power available is η·P, the duty
needs ρ·g·Q·H, and a pump short of power runs slower. By the affinity laws (P ∝ N³)
its speed ratio is (η·P / ρgQH)^(1/3), capped at 1 — a bigger motor or a better
efficiency never spins the impeller faster than its rated speed.

Mirrored in frontend/src/engineering/pumpDuty.js (Properties panel read-out).
"""
from __future__ import annotations

import math
from typing import Optional

RHO_G = 1000.0 * 9.81
BAR_TO_M = 10.197


def _num(v) -> Optional[float]:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def efficiency_fraction(v) -> Optional[float]:
    """Efficiency as 0..1. The designer stores percent (e.g. 70); library data may store 0.7."""
    n = _num(v)
    if n is None or n <= 0:
        return None
    return min(1.0, n / 100.0 if n > 1.0 else n)


def duty_point(e: dict) -> tuple[float, float]:
    """(flow m³/s, head m). Flow (m³/h) is the designer's field, so it wins over a
    library-derived flowLpm that the designer does not show or update."""
    q_m3h = _num(e.get("flowM3Hr"))
    q_lpm = _num(e.get("flowLpm"))
    q = q_m3h / 3600.0 if q_m3h and q_m3h > 0 else (q_lpm / 60000.0 if q_lpm and q_lpm > 0 else 0.0)
    h = _num(e.get("headM"))
    if not h or h <= 0:
        h = (_num(e.get("pressureBar")) or 0.0) * BAR_TO_M
    return q, max(0.0, h)


def motor_power_w(e: dict) -> Optional[float]:
    kw = _num(e.get("powerKw"))
    if kw and kw > 0:
        return kw * 1000.0
    w = _num(e.get("wattage")) or _num(e.get("powerW"))
    return w if w and w > 0 else None


def pump_rating(e: dict) -> dict:
    """Duty point plus the power-limited speed ratio for one pump's engineering block."""
    q, h = duty_point(e or {})
    p = motor_power_w(e or {})
    eta = efficiency_fraction((e or {}).get("efficiency"))
    out = {"flow_m3s": q, "head_m": h, "power_w": p, "efficiency": eta,
           "required_power_w": None, "available_water_power_w": None,
           "speed_ratio": 1.0, "power_limited": False}
    if q <= 0 or h <= 0 or p is None or eta is None:
        return out
    water = RHO_G * q * h
    out["required_power_w"] = water / eta
    out["available_water_power_w"] = eta * p
    ratio = (eta * p) / water
    if ratio < 1.0:
        out["speed_ratio"] = max(0.05, ratio) ** (1.0 / 3.0)
        out["power_limited"] = True
    return out
