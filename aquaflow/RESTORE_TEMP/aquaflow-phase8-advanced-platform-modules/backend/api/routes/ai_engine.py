"""
API Routes — AI Choreography Engine
Full endpoints for text-to-show, audio analysis, pattern generation,
show enhancement, and energy optimization.
"""
import asyncio
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional
from ai.choreography_engine import analyzer, generator, suggester

router = APIRouter()


class GenerateRequest(BaseModel):
    prompt: str = ""
    duration: float = 120.0
    bpm: float = 128.0
    mood: str = "energetic"       # energetic | calm | dramatic | cinematic | playful
    include_flame: bool = False
    include_laser: bool = False
    include_fog: bool = True
    style: Optional[str] = None


class EnhanceRequest(BaseModel):
    tracks: list
    bpm: float = 128.0
    instructions: Optional[str] = None


class PatternRequest(BaseModel):
    device_type: str              # pump | valve | lighting | flame
    duration: float = 32.0
    bpm: float = 128.0
    intensity: int = 80
    pattern: str = "cascade"      # cascade | burst | wave | pulse | random


@router.post("/generate")
async def generate_show(req: GenerateRequest):
    """
    Text-to-show: generate a full show from a text prompt + parameters.
    Example prompt: "Dramatic cinematic fountain show with aggressive jets and flame bursts"
    """
    try:
        # Analyze audio parameters
        analysis = analyzer.analyze_from_params(
            bpm=req.bpm,
            duration=req.duration,
            mood=req.mood,
        )
        # Generate choreography
        show = generator.generate_from_analysis(
            analysis=analysis,
            prompt=req.prompt,
            include_flame=req.include_flame,
            include_laser=req.include_laser,
            include_fog=req.include_fog,
        )
        return {
            "status": "generated",
            "show": {
                "name": show.name,
                "bpm": show.bpm,
                "duration": show.duration,
                "notes": show.notes,
            },
            "tracks": show.tracks,
            "analysis": {
                "bpm": analysis.bpm,
                "mood": analysis.mood,
                "key": analysis.key,
                "sections": [
                    {"start": s.start, "end": s.end, "label": s.label, "energy": s.energy}
                    for s in analysis.sections
                ],
                "beat_count": len(analysis.beats),
            }
        }
    except Exception as e:
        raise HTTPException(500, f"Generation failed: {str(e)}")


@router.post("/analyze-params")
async def analyze_from_params(bpm: float = 128.0, duration: float = 120.0, mood: str = "energetic"):
    """Analyze show parameters and return beat/section data"""
    analysis = analyzer.analyze_from_params(bpm=bpm, duration=duration, mood=mood)
    return {
        "bpm": analysis.bpm,
        "key": analysis.key,
        "mood": analysis.mood,
        "duration": analysis.duration,
        "beat_count": len(analysis.beats),
        "sections": [
            {"start": s.start, "end": s.end, "label": s.label, "energy": s.energy}
            for s in analysis.sections
        ],
        "beats": [
            {"time": b.time, "strength": b.strength, "type": b.type}
            for b in analysis.beats[:32]  # First 32 beats as preview
        ],
    }


@router.post("/enhance")
async def enhance_show(req: EnhanceRequest):
    """Get AI suggestions to improve an existing show"""
    suggestions = suggester.suggest(req.tracks, req.bpm)
    return {
        "suggestions": suggestions,
        "track_count": len(req.tracks),
        "bpm": req.bpm,
    }


@router.post("/generate-pattern")
async def generate_pattern(req: PatternRequest):
    """Generate a single-device pattern clip sequence"""
    beat_interval = 60.0 / req.bpm
    clips = []
    clip_id = 9000

    if req.pattern == "cascade":
        t = 0.0
        step = beat_interval * 2
        while t < req.duration:
            intensity = int(req.intensity * (0.6 + 0.4 * (t / req.duration)))
            clips.append({"id": f"pat-{clip_id}", "start": round(t, 2),
                          "end": round(t + step * 0.9, 2), "intensity": intensity, "label": "Cascade"})
            t += step
            clip_id += 1

    elif req.pattern == "burst":
        t = 0.0
        step = beat_interval * 4
        while t < req.duration:
            clips.append({"id": f"pat-{clip_id}", "start": round(t, 2),
                          "end": round(t + beat_interval, 2), "intensity": req.intensity, "label": "Burst"})
            t += step
            clip_id += 1

    elif req.pattern == "wave":
        t = 0.0
        step = beat_interval
        import math
        while t < req.duration:
            intensity = int(req.intensity * (0.5 + 0.5 * math.sin(t * 3.14 / 8)))
            clips.append({"id": f"pat-{clip_id}", "start": round(t, 2),
                          "end": round(t + step * 0.95, 2), "intensity": max(10, intensity), "label": "Wave"})
            t += step
            clip_id += 1

    elif req.pattern == "pulse":
        t = 0.0
        step = beat_interval * 0.5
        on = True
        while t < req.duration:
            if on:
                clips.append({"id": f"pat-{clip_id}", "start": round(t, 2),
                              "end": round(t + step * 0.8, 2), "intensity": req.intensity, "label": "Pulse"})
                clip_id += 1
            t += step
            on = not on

    elif req.pattern == "random":
        import random
        t = 0.0
        while t < req.duration:
            dur = beat_interval * random.choice([1, 2, 4])
            intensity = random.randint(30, req.intensity)
            clips.append({"id": f"pat-{clip_id}", "start": round(t, 2),
                          "end": round(min(t + dur, req.duration), 2), "intensity": intensity, "label": "Random"})
            t += dur
            clip_id += 1

    return {
        "device_type": req.device_type,
        "pattern": req.pattern,
        "clips": clips,
        "clip_count": len(clips),
        "bpm": req.bpm,
        "duration": req.duration,
    }


@router.post("/optimize-energy")
async def optimize_energy(tracks: list, bpm: float = 128.0):
    """Optimize power consumption while maintaining visual quality"""
    optimizations = []
    total_savings = 0

    for track in tracks:
        if track.get("type") == "pump":
            clips = track.get("clips", [])
            idle_clips = [c for c in clips if c.get("intensity", 100) < 30]
            if idle_clips:
                savings = len(idle_clips) * 5
                total_savings += savings
                optimizations.append({
                    "track": track.get("label"),
                    "action": f"Reduce {len(idle_clips)} idle clips from 30% to 15%",
                    "savings_pct": savings,
                })

    return {
        "estimated_savings": f"{min(total_savings, 35)}%",
        "optimizations": optimizations,
        "recommendations": [
            "Use VFD speed ramping instead of instant on/off for pumps",
            "Stagger jet start times to reduce peak current draw",
            "Schedule maintenance windows during low-energy sections",
        ],
    }


@router.get("/moods")
async def list_moods():
    return {"moods": ["energetic", "calm", "dramatic", "cinematic", "playful"]}


@router.get("/patterns")
async def list_patterns():
    return {"patterns": ["cascade", "burst", "wave", "pulse", "random"]}
