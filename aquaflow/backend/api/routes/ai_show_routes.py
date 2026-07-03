"""
ai_show_routes.py — AquaFlow Stage 3, Priority 1 (AQ-S3-001)

API surface for the AI show generator: turn a natural-language prompt / mood
description into a playable fountain show timeline.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

from services.ai_show_generator import generate_show, interpret_prompt, MOOD_PROFILES

router = APIRouter()


class ShowPromptRequest(BaseModel):
    prompt: str = ""
    duration: Optional[float] = None
    bpm: Optional[float] = None
    mood: Optional[str] = None
    loop: bool = False


@router.post("/generate")
async def generate(req: ShowPromptRequest):
    """
    Generate a playable show timeline from a text prompt / mood description.

    Returns `{show, timelineTracks, interpretation, stats}` — `timelineTracks`
    loads directly into the show engine.
    """
    try:
        return generate_show(req.prompt, duration=req.duration, bpm=req.bpm,
                             mood=req.mood, loop=req.loop)
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.post("/interpret")
async def interpret(req: ShowPromptRequest):
    """Return only the parsed intent (mood/energy/tempo/effects) for a prompt."""
    try:
        intent = interpret_prompt(req.prompt, duration=req.duration, bpm=req.bpm, mood=req.mood)
        return {
            "mood": intent.mood, "energy": intent.energy, "bpm": intent.bpm,
            "duration": intent.duration, "effects": intent.effects,
            "palette": intent.palette, "name": intent.name,
            "matched_keywords": intent.matched_keywords,
        }
    except Exception as e:
        raise HTTPException(400, detail=str(e))


@router.get("/moods")
async def list_moods():
    """List the supported moods and the keywords that trigger each."""
    return {
        "moods": [
            {"mood": name, "energy": prof["energy"], "bpm": prof["bpm"],
             "palette": prof["palette"], "keywords": prof["keywords"]}
            for name, prof in MOOD_PROFILES.items()
        ]
    }
