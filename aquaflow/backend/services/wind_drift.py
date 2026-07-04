"""
wind_drift.py — AquaFlow Recovery, AQ-X-012

Wind drift calculation engine for outdoor fountain safety.

Builds a safety layer on top of the weather engine's wind physics (AQ-S3-005): given
live weather data and the fountain layout it computes, per jet, how far the spray
drifts downwind, expands each jet's wet/exclusion zone accordingly, and raises
operator warnings when the drifted spray reaches beyond the keep-clear distance or a
defined barrier — so spectators never get soaked and slip hazards are flagged before
they happen.

  * wind drift calculated from weather data — reuses `wind_drift` /`wind_vector`
    (droplet flight time × wind, with a droplet-coupling factor and a gust case),
  * safety zones updated in real-time — pure O(n) recompute of every jet's drifted
    wet zone + the aggregate exclusion radius on each weather update,
  * operator warnings displayed — structured, severity-ranked warnings (keep-clear
    breach, barrier breach, high wind, gust exceedance) for the operator UI.

SI units: positions/height/reach in metres, wind in m/s, bearings in degrees.
"""
from __future__ import annotations

import math
from typing import Optional

from services.weather_engine import (
    WeatherConditions, wind_vector, jet_time_of_flight, wind_drift, GRAVITY,
)

DEFAULT_SPLASH_RADIUS_M = 0.5
DEFAULT_COUPLING = 0.5
HIGH_WIND_SHUTDOWN_MS = 12.0     # pause tall jets at/above this mean wind
MODERATE_WIND_MS = 8.0

_SEVERITY_RANK = {"critical": 0, "warning": 1, "caution": 2, "info": 3}


# ── Per-jet drift ─────────────────────────────────────────────────────────────

def jet_drift(jet: dict, conditions: WeatherConditions,
              coupling: float = DEFAULT_COUPLING) -> dict:
    """
    Drift geometry for one jet. Returns the drift magnitude, the downwind unit
    vector, the landing point (where the bulk of the water lands) and the farthest
    wet point (landing + splash radius downwind) — the edge of the wet zone.
    """
    x = float(jet.get("x", 0.0)); y = float(jet.get("y", 0.0))
    height = float(jet.get("height", jet.get("jet_height_m", 4.0)))
    splash = float(jet.get("splash_radius", DEFAULT_SPLASH_RADIUS_M))

    drift = wind_drift(height, conditions.wind_speed, coupling)
    gust_drift = wind_drift(height, conditions.wind_speed * conditions.gust_factor, coupling)
    v = wind_vector(conditions.wind_speed, conditions.wind_direction)
    mag = max(1e-9, v["magnitude"])
    ux, uy = v["east"] / mag, v["north"] / mag        # downwind unit vector

    landing = (x + drift * ux, y + drift * uy)
    gust_landing = (x + gust_drift * ux, y + gust_drift * uy)
    # Downwind edge of the wet circle around each landing point (for visualization).
    farthest = (landing[0] + splash * ux, landing[1] + splash * uy)
    gust_farthest = (gust_landing[0] + splash * ux, gust_landing[1] + splash * uy)
    return {
        "id": jet.get("id"),
        "origin": (x, y), "height_m": height, "splash_radius_m": splash,
        "drift_m": drift, "gust_drift_m": gust_drift,
        "downwind_unit": (ux, uy),
        "landing": landing, "gust_landing": gust_landing,
        "farthest_wet": farthest, "gust_farthest_wet": gust_farthest,
        "time_of_flight_s": jet_time_of_flight(height),
    }


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


# ── Safety zones ──────────────────────────────────────────────────────────────

def compute_safety_zones(fountain: dict, conditions: WeatherConditions,
                         coupling: float = DEFAULT_COUPLING) -> dict:
    """
    Compute the drifted wet/exclusion zones for a fountain under the given weather.

    fountain = {center?[x,y], keep_clear_m, jets:[{id,x,y,height,splash_radius?}],
                barriers?:[{name, distance_m}]}
    Returns per-jet zones, the aggregate exclusion radius needed (max distance from
    the fountain centre to any farthest wet point) and any keep-clear / barrier
    breaches.
    """
    jets = fountain.get("jets") or []
    keep_clear = float(fountain.get("keep_clear_m", 0.0))
    if fountain.get("center"):
        cx, cy = float(fountain["center"][0]), float(fountain["center"][1])
    elif jets:
        cx = sum(float(j.get("x", 0.0)) for j in jets) / len(jets)
        cy = sum(float(j.get("y", 0.0)) for j in jets) / len(jets)
    else:
        cx = cy = 0.0
    center = (cx, cy)

    zones = []
    max_reach = 0.0
    max_gust_reach = 0.0
    for j in jets:
        d = jet_drift(j, conditions, coupling)
        # The wet zone is a circle of radius `splash` around the landing point, so the
        # farthest wet point from the fountain centre is dist(centre, landing) + splash.
        reach = _dist(center, d["landing"]) + d["splash_radius_m"]
        gust_reach = _dist(center, d["gust_landing"]) + d["splash_radius_m"]
        d["reach_from_center_m"] = reach
        d["gust_reach_from_center_m"] = gust_reach
        d["beyond_keep_clear"] = reach > keep_clear if keep_clear > 0 else False
        zones.append(d)
        max_reach = max(max_reach, reach)
        max_gust_reach = max(max_gust_reach, gust_reach)

    breaches = []
    if keep_clear > 0 and max_reach > keep_clear:
        breaches.append({"type": "keep_clear", "name": "keep-clear perimeter",
                         "limit_m": keep_clear, "reach_m": round(max_reach, 3),
                         "exceeded_by_m": round(max_reach - keep_clear, 3)})
    for b in fountain.get("barriers") or []:
        limit = float(b.get("distance_m", 0.0))
        if limit > 0 and max_reach > limit:
            breaches.append({"type": "barrier", "name": b.get("name", "barrier"),
                             "limit_m": limit, "reach_m": round(max_reach, 3),
                             "exceeded_by_m": round(max_reach - limit, 3)})

    return {
        "center": center,
        "keep_clear_m": keep_clear,
        "exclusion_radius_m": round(max_reach, 3),
        "gust_exclusion_radius_m": round(max_gust_reach, 3),
        "jets": zones,
        "breaches": breaches,
        "wind": wind_vector(conditions.wind_speed, conditions.wind_direction),
    }


# ── Operator warnings ─────────────────────────────────────────────────────────

def operator_warnings(zones: dict, conditions: WeatherConditions) -> list[dict]:
    """Severity-ranked operator warnings from the computed zones + weather."""
    out = []

    def add(severity, code, message, meta=None):
        out.append({"severity": severity, "code": code, "message": message, "meta": meta or {}})

    ws = conditions.wind_speed
    gust = ws * conditions.gust_factor

    if ws >= HIGH_WIND_SHUTDOWN_MS:
        add("critical", "high_wind",
            f"High wind {ws:.1f} m/s — pause tall jets or cut jet heights; heavy overspray/drift.",
            {"wind_speed": ws})
    elif ws >= MODERATE_WIND_MS:
        add("caution", "moderate_wind",
            f"Moderate wind {ws:.1f} m/s — expect noticeable drift and overspray at the pool edge.",
            {"wind_speed": ws})

    for b in zones.get("breaches", []):
        sev = "critical" if b["type"] == "keep_clear" else "warning"
        add(sev, f"{b['type']}_breach",
            f"Spray drifts {b['exceeded_by_m']:.2f} m beyond the {b['name']} "
            f"({b['reach_m']:.2f} m vs {b['limit_m']:.2f} m limit) — move spectators back "
            f"or reduce jet heights.",
            {"limit_m": b["limit_m"], "reach_m": b["reach_m"]})

    # Gust could breach even if the mean does not.
    keep_clear = zones.get("keep_clear_m", 0.0)
    if keep_clear > 0 and zones["exclusion_radius_m"] <= keep_clear \
            and zones["gust_exclusion_radius_m"] > keep_clear:
        add("warning", "gust_breach",
            f"Gusts reach {zones['gust_exclusion_radius_m']:.2f} m — beyond the "
            f"{keep_clear:.2f} m keep-clear during gusts.", {"keep_clear_m": keep_clear})

    if not out:
        add("info", "clear", "Wind drift within safe limits — no operator action required.")

    out.sort(key=lambda w: _SEVERITY_RANK.get(w["severity"], 9))
    return out


# ── JSON entry point ──────────────────────────────────────────────────────────

def _conditions_from(payload: dict) -> WeatherConditions:
    c = payload.get("weather") or payload.get("conditions") or {}
    return WeatherConditions(
        wind_speed=float(c.get("wind_speed", 0.0)),
        wind_direction=float(c.get("wind_direction", 0.0)),
        temperature_c=float(c.get("temperature_c", 20.0)),
        humidity_pct=float(c.get("humidity_pct", 50.0)),
        condition=str(c.get("condition", "clear")),
        gust_factor=float(c.get("gust_factor", 1.4)),
    )


def analyze(payload: dict) -> dict:
    """
    payload = {"fountain": {center?, keep_clear_m, jets:[...], barriers?:[...]},
               "weather":  {wind_speed, wind_direction, gust_factor?, ...},
               "coupling"?: 0.5}
    Returns the safety zones + operator warnings + a compact summary.
    """
    conditions = _conditions_from(payload)
    fountain = payload.get("fountain") or {}
    coupling = float(payload.get("coupling", DEFAULT_COUPLING))
    zones = compute_safety_zones(fountain, conditions, coupling)
    warnings = operator_warnings(zones, conditions)
    # Round jet geometry for transport.
    for z in zones["jets"]:
        for k in ("drift_m", "gust_drift_m", "reach_from_center_m",
                  "gust_reach_from_center_m", "time_of_flight_s"):
            z[k] = round(z[k], 4)
        for k in ("origin", "landing", "gust_landing", "farthest_wet",
                  "gust_farthest_wet", "downwind_unit"):
            z[k] = [round(z[k][0], 4), round(z[k][1], 4)]
    return {
        "zones": zones,
        "warnings": warnings,
        "summary": {
            "wind_speed": conditions.wind_speed,
            "wind_direction": conditions.wind_direction,
            "exclusion_radius_m": zones["exclusion_radius_m"],
            "keep_clear_m": zones["keep_clear_m"],
            "breach_count": len(zones["breaches"]),
            "highest_severity": warnings[0]["severity"] if warnings else "info",
            "safe": not zones["breaches"] and conditions.wind_speed < HIGH_WIND_SHUTDOWN_MS,
        },
    }
