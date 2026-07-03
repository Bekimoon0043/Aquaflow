"""
energy_routes.py — AquaFlow Stage 2, Priority 13 (AQ-S2-013)

API surface for the energy consumption model: compute kWh, annual operating cost,
and peak demand from a set of electrical loads or from fixture-library entries.
"""
from fastapi import APIRouter, HTTPException

from services.energy_model import model_energy, model_from_fixtures

router = APIRouter()


@router.post("/model")
async def model(payload: dict):
    """
    Evaluate an energy model.

    Body: {"loads":[{"id","power_w","hours_per_day","days_per_year","duty_cycle",
                     "peak_fraction","hourly_profile"}],
           "defaults":{...}, "simultaneity_factor":1.0,
           "tariff":{"energy_rate","demand_charge","standing_charge_per_year",
                     "currency","co2_factor_kg_per_kwh"}}

    Returns a summary (kWh daily/monthly/annual, peak demand kW, annual operating
    cost, CO2) plus a per-load breakdown.
    """
    try:
        return model_energy(payload)
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/from-fixtures")
async def from_fixtures(payload: dict):
    """
    Evaluate an energy model from fixture-library entries carrying
    `electrical.powerW`. Body: {"fixtures":[...], "defaults":{...}, "tariff":{...}}.
    """
    try:
        return model_from_fixtures(payload.get("fixtures", []), payload)
    except Exception as e:
        raise HTTPException(400, detail=str(e))
