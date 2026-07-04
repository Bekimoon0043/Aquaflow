"""
optimize_routes.py — AquaFlow Stage 5, AQ-S5-002

AI Optimization Engine API. Analyses a design/show and returns energy, water and
performance optimisation recommendations.

  POST /api/optimize/analyze      → full energy + water + performance report
  POST /api/optimize/energy       → energy-only optimisation
  POST /api/optimize/water        → water-only optimisation
  POST /api/optimize/performance  → performance-only optimisation
"""
from fastapi import APIRouter

from services.optimization_engine import (
    analyze, optimize_energy, optimize_water, optimize_performance,
)

router = APIRouter()


@router.post("/analyze")
async def analyze_design(payload: dict):
    return analyze(payload or {})


@router.post("/energy")
async def energy(payload: dict):
    return optimize_energy(payload or {})


@router.post("/water")
async def water(payload: dict):
    return optimize_water(payload or {})


@router.post("/performance")
async def performance(payload: dict):
    return optimize_performance(payload or {})
