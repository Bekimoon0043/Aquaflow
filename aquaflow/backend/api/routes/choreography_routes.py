"""
choreography_routes.py — AquaFlow Stage 3, Priority 3 (AQ-S3-003)

API surface for the AI Choreography Engine: generate a full, fixture-aware show
timeline from a prompt, and apply prompt revisions to an existing show.
"""
from fastapi import APIRouter, HTTPException

from services.choreography_engine import generate_choreography, revise_show

router = APIRouter()


@router.post("/generate")
async def generate(payload: dict):
    """
    Generate a full choreography.

    Body: {"prompt","fixtures":[{id,type,groupId,maxIntensity?,maxOnTime?}],
           "duration"?,"bpm"?,"mood"?,"loop"?}
    Returns `{show, timelineTracks, interpretation, constraints, warnings, ...}`.
    """
    try:
        return generate_choreography(
            payload.get("prompt", ""),
            payload.get("fixtures", []),
            duration=payload.get("duration"),
            bpm=payload.get("bpm"),
            mood=payload.get("mood"),
            loop=bool(payload.get("loop", False)),
        )
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/revise")
async def revise(payload: dict):
    """
    Apply a prompt revision to an existing choreography show.

    Body: {"show": <show payload>, "revision_prompt": "...", "fixtures": [...]}.
    """
    show = payload.get("show")
    if not isinstance(show, dict):
        raise HTTPException(400, "show payload is required")
    try:
        return revise_show(show, payload.get("revision_prompt", ""), payload.get("fixtures"))
    except Exception as e:
        raise HTTPException(400, detail=str(e))
