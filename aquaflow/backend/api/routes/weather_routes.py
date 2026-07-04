"""
weather_routes.py — AquaFlow Stage 3, Priority 5 (AQ-S3-005)

API surface for the weather simulation engine: given ambient conditions + show
geometry, return the wind drift, evaporation loss, and visibility impact.
"""
from fastapi import APIRouter, HTTPException

from services.weather_engine import simulate_weather_dict

router = APIRouter()


@router.post("/simulate")
async def simulate(payload: dict):
    """
    Simulate weather effects on a fountain show.

    Body: {"conditions": {"wind_speed","wind_direction","temperature_c",
             "water_temp_c","humidity_pct","condition","pressure_kpa"},
           "jet_height_m","pool_area_m2","spray_density","viewing_distance_m","night"}

    Returns wind (vector, drift, splash radius), evaporation (L/day), and
    visibility (visual range + show clarity), plus a suitability summary.
    """
    try:
        return simulate_weather_dict(payload)
    except Exception as e:
        raise HTTPException(400, detail=str(e))
