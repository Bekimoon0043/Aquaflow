"""
weather_engine.py — AquaFlow Stage 3, Priority 5 (AQ-S3-005)

Weather simulation engine for outdoor fountain shows.

Given ambient weather conditions it computes the three effects that matter for a
water show:

  * Wind — a wind vector plus the horizontal drift and splash-radius growth it
    imparts to water jets (droplets are carried downwind during their flight).
  * Evaporation — the water-loss rate from the pool surface, using the standard
    mass-transfer (Θ) model driven by temperature, humidity, and wind.
  * Visibility — meteorological visual range via the Koschmieder relation, plus a
    "show clarity" score combining atmospheric visibility, fountain spray, and
    night lighting so the operator knows whether the audience can actually see it.

All physics are SI and hand-verifiable; the module is pure and unit-tested.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

GRAVITY = 9.81
WATER_DENSITY = 1000.0          # kg/m^3 (1 L ≈ 1 kg)
STD_PRESSURE_KPA = 101.325

# Koschmieder visual-range constant (5% contrast threshold): V = 3.912 / beta.
KOSCHMIEDER = 3.912

# Base atmospheric extinction coefficient per condition (1/km).
CONDITION_BETA = {
    "clear": 0.011, "haze": 0.5, "mist": 3.0, "light_rain": 2.0,
    "rain": 4.0, "heavy_rain": 10.0, "fog": 20.0, "dense_fog": 60.0,
}


@dataclass
class WeatherConditions:
    wind_speed: float = 0.0        # m/s
    wind_direction: float = 0.0    # degrees the wind blows FROM (0=N, 90=E)
    temperature_c: float = 20.0
    water_temp_c: Optional[float] = None   # defaults to air temp
    humidity_pct: float = 50.0     # relative humidity 0..100
    condition: str = "clear"       # clear|haze|mist|rain|fog...
    pressure_kpa: float = STD_PRESSURE_KPA
    gust_factor: float = 1.4       # peak gust / mean wind


# ── Psychrometrics ─────────────────────────────────────────────────────────────
def saturation_vapor_pressure_kpa(temp_c: float) -> float:
    """Tetens/Magnus saturation vapour pressure over water (kPa)."""
    return 0.61078 * math.exp(17.27 * temp_c / (temp_c + 237.3))


def humidity_ratio(temp_c: float, rh_pct: float, pressure_kpa: float = STD_PRESSURE_KPA) -> float:
    """Humidity ratio x (kg water / kg dry air) at temp/RH."""
    pw = max(0.0, min(1.0, rh_pct / 100.0)) * saturation_vapor_pressure_kpa(temp_c)
    pw = min(pw, pressure_kpa - 1e-6)
    return 0.62198 * pw / (pressure_kpa - pw)


# ── Wind ────────────────────────────────────────────────────────────────────────
def wind_vector(speed: float, from_direction_deg: float) -> dict:
    """
    Wind velocity vector in the horizontal plane, returned as the direction the
    wind blows TOWARD. x = East, z = North. `from_direction_deg` is the
    meteorological direction the wind comes from (0=N, 90=E, 180=S, 270=W).
    """
    to_rad = math.radians((from_direction_deg + 180.0) % 360.0)
    # Compass bearing → components: bearing 0 = North (+z), 90 = East (+x).
    east = speed * math.sin(to_rad)
    north = speed * math.cos(to_rad)
    return {"east": east, "north": north,
            "magnitude": abs(speed), "to_bearing": (from_direction_deg + 180.0) % 360.0}


def jet_time_of_flight(jet_height_m: float, g: float = GRAVITY) -> float:
    """Rise+fall time (s) for a vertical jet reaching apex `jet_height_m`."""
    return 2.0 * math.sqrt(2.0 * max(0.0, jet_height_m) / g)


def wind_drift(jet_height_m: float, wind_speed: float, coupling: float = 0.5,
               g: float = GRAVITY) -> float:
    """
    Horizontal drift (m) of a jet's droplets due to wind over their flight time.
    `coupling` (0..1) is how strongly small droplets follow the wind (they lag,
    so < 1). drift = coupling * wind_speed * time_of_flight.
    """
    t = jet_time_of_flight(jet_height_m, g)
    return max(0.0, coupling) * abs(wind_speed) * t


def simulate_wind(conditions: WeatherConditions, jet_height_m: float,
                  base_splash_radius_m: float = 0.5, coupling: float = 0.5) -> dict:
    """Full wind effect on one jet: drift, downwind splash offset, splash radius."""
    v = wind_vector(conditions.wind_speed, conditions.wind_direction)
    t = jet_time_of_flight(jet_height_m)
    drift = wind_drift(jet_height_m, conditions.wind_speed, coupling)
    gust_drift = wind_drift(jet_height_m, conditions.wind_speed * conditions.gust_factor, coupling)
    mag = max(1e-9, v["magnitude"])
    # Landing offset points downwind (unit wind-to vector scaled by drift).
    landing = {"east": drift * v["east"] / mag, "north": drift * v["north"] / mag}
    return {
        "wind_vector": v,
        "time_of_flight_s": round(t, 4),
        "drift_m": round(drift, 4),
        "gust_drift_m": round(gust_drift, 4),
        "landing_offset": {"east": round(landing["east"], 4), "north": round(landing["north"], 4)},
        "splash_radius_m": round(base_splash_radius_m + drift, 4),
        "wind_advisory": _wind_advisory(conditions.wind_speed, drift, jet_height_m),
    }


def _wind_advisory(wind_speed: float, drift: float, jet_height_m: float) -> str:
    if wind_speed >= 12:
        return "High wind — reduce jet heights or pause tall jets (large drift/overspray)."
    if drift > 0.5 * max(jet_height_m, 0.1) or wind_speed >= 8:
        return "Moderate wind — expect noticeable drift and overspray at the pool edge."
    return "Wind within normal range."


# ── Evaporation ─────────────────────────────────────────────────────────────────
def evaporation_rate_kg_per_h(area_m2: float, conditions: WeatherConditions) -> float:
    """
    Water-loss rate (kg/h) from a free surface via the mass-transfer Θ model:
        E = Θ · A · (x_s(T_water) − x_air),   Θ = 25 + 19·v
    where x_s is the saturation humidity ratio at the water temperature and x_air
    the ambient humidity ratio. Clamped at 0 (no negative/condensation credit).
    """
    v = abs(conditions.wind_speed)
    theta = 25.0 + 19.0 * v
    tw = conditions.water_temp_c if conditions.water_temp_c is not None else conditions.temperature_c
    x_s = humidity_ratio(tw, 100.0, conditions.pressure_kpa)
    x_air = humidity_ratio(conditions.temperature_c, conditions.humidity_pct, conditions.pressure_kpa)
    return max(0.0, theta * max(0.0, area_m2) * (x_s - x_air))


def estimate_evaporation(area_m2: float, conditions: WeatherConditions) -> dict:
    kg_h = evaporation_rate_kg_per_h(area_m2, conditions)
    liters_h = kg_h / (WATER_DENSITY / 1000.0)   # kg → L (1 L = 1 kg)
    return {
        "rate_kg_per_h": round(kg_h, 4),
        "rate_l_per_h": round(liters_h, 4),
        "l_per_day": round(liters_h * 24.0, 3),
        "l_per_m2_per_day": round((liters_h * 24.0) / area_m2, 4) if area_m2 > 0 else 0.0,
        "mm_per_day": round((liters_h * 24.0) / area_m2, 4) if area_m2 > 0 else 0.0,  # 1 L/m² = 1 mm
    }


# ── Visibility ──────────────────────────────────────────────────────────────────
def extinction_coefficient(conditions: WeatherConditions, spray_density: float = 0.0) -> float:
    """Total atmospheric extinction β (1/km): condition base + high-humidity haze
    + fountain spray."""
    beta = CONDITION_BETA.get(str(conditions.condition or "clear").lower(), CONDITION_BETA["clear"])
    rh = conditions.humidity_pct
    if rh > 80:
        beta += (rh - 80) / 20.0 * 0.6      # rising haze as RH → 100%
    beta += max(0.0, min(1.0, spray_density)) * 2.5   # dense spray scatters light
    return max(1e-4, beta)


def meteorological_visibility_km(conditions: WeatherConditions, spray_density: float = 0.0,
                                 cap_km: float = 50.0) -> float:
    """Koschmieder visual range (km): V = 3.912 / β."""
    return min(cap_km, KOSCHMIEDER / extinction_coefficient(conditions, spray_density))


def visibility_impact(conditions: WeatherConditions, spray_density: float = 0.0,
                      viewing_distance_m: float = 80.0, night: bool = True) -> dict:
    """
    Visibility impact on the show. Returns meteorological visibility plus a
    show-clarity score (0..100): how clearly the audience sees the display at the
    given viewing distance, factoring spray and night lighting (lit water reads
    better against a dark sky).
    """
    vis_km = meteorological_visibility_km(conditions, spray_density)
    vis_m = vis_km * 1000.0
    # Clarity from Koschmieder contrast transmission over the viewing distance:
    # C = exp(-beta * distance). Use the same extinction in per-metre units.
    beta_per_m = extinction_coefficient(conditions, spray_density) / 1000.0
    transmission = math.exp(-beta_per_m * max(1.0, viewing_distance_m))
    clarity = transmission
    if night:
        clarity = min(1.0, clarity * 1.15)   # lit water contrasts better after dark
    # Heavy spray very close still reduces clarity slightly (self-occlusion).
    clarity *= (1.0 - 0.15 * max(0.0, min(1.0, spray_density)))
    clarity_pct = round(max(0.0, min(1.0, clarity)) * 100.0, 1)
    return {
        "visibility_km": round(vis_km, 3),
        "visibility_m": round(vis_m, 1),
        "extinction_per_km": round(extinction_coefficient(conditions, spray_density), 4),
        "viewing_distance_m": viewing_distance_m,
        "show_clarity_pct": clarity_pct,
        "rating": _clarity_rating(clarity_pct),
        "night": night,
    }


def _clarity_rating(pct: float) -> str:
    if pct >= 85:
        return "excellent"
    if pct >= 65:
        return "good"
    if pct >= 40:
        return "fair"
    return "poor"


# ── Aggregate simulation ─────────────────────────────────────────────────────────
def simulate_weather(conditions: WeatherConditions, *, jet_height_m: float = 4.0,
                     pool_area_m2: float = 50.0, spray_density: float = 0.3,
                     viewing_distance_m: float = 80.0, night: bool = True) -> dict:
    """Run the full weather simulation for a show and return a combined report."""
    wind = simulate_wind(conditions, jet_height_m)
    evap = estimate_evaporation(pool_area_m2, conditions)
    vis = visibility_impact(conditions, spray_density, viewing_distance_m, night)
    return {
        "conditions": {
            "wind_speed": conditions.wind_speed, "wind_direction": conditions.wind_direction,
            "temperature_c": conditions.temperature_c,
            "water_temp_c": conditions.water_temp_c if conditions.water_temp_c is not None else conditions.temperature_c,
            "humidity_pct": conditions.humidity_pct, "condition": conditions.condition,
        },
        "wind": wind,
        "evaporation": evap,
        "visibility": vis,
        "show_suitability": _suitability(conditions, wind, vis),
    }


def _suitability(conditions: WeatherConditions, wind: dict, vis: dict) -> dict:
    issues = []
    if conditions.wind_speed >= 12:
        issues.append("wind too high (drift/overspray)")
    if vis["show_clarity_pct"] < 40:
        issues.append("poor visibility for the audience")
    ok = len(issues) == 0
    return {"suitable": ok, "issues": issues,
            "summary": "Conditions suitable for the show." if ok
                       else "Caution: " + "; ".join(issues) + "."}


# ── Dict API ──────────────────────────────────────────────────────────────────
def _conditions_from(payload: dict) -> WeatherConditions:
    c = payload.get("conditions", payload) or {}
    return WeatherConditions(
        wind_speed=float(c.get("wind_speed", 0.0)),
        wind_direction=float(c.get("wind_direction", 0.0)),
        temperature_c=float(c.get("temperature_c", 20.0)),
        water_temp_c=(None if c.get("water_temp_c") is None else float(c["water_temp_c"])),
        humidity_pct=float(c.get("humidity_pct", 50.0)),
        condition=str(c.get("condition", "clear")),
        pressure_kpa=float(c.get("pressure_kpa", STD_PRESSURE_KPA)),
        gust_factor=float(c.get("gust_factor", 1.4)),
    )


def simulate_weather_dict(payload: dict) -> dict:
    return simulate_weather(
        _conditions_from(payload),
        jet_height_m=float(payload.get("jet_height_m", 4.0)),
        pool_area_m2=float(payload.get("pool_area_m2", 50.0)),
        spray_density=float(payload.get("spray_density", 0.3)),
        viewing_distance_m=float(payload.get("viewing_distance_m", 80.0)),
        night=bool(payload.get("night", True)),
    )
