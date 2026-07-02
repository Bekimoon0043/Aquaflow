"""
API Routes — AI Learning Engine
Endpoints for self-learning choreography, pattern management, and feedback.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from ai.choreography_engine import analyzer
from ai.learning_engine import (
    pattern_memory, pattern_extractor, pattern_evolver,
    learning_generator, feedback_processor,
)

router = APIRouter()


# ── Request models ─────────────────────────────────────────────────────────────

class LearnedGenerateRequest(BaseModel):
    prompt: str = ""
    duration: float = 120.0
    bpm: float = 128.0
    mood: str = "energetic"
    include_flame: bool = False
    include_laser: bool = False
    include_fog: bool = True
    use_evolution: bool = True


class LearnFromTracksRequest(BaseModel):
    tracks: list
    bpm: float = 128.0
    mood: str = "energetic"
    source: str = "manual"


class RatingRequest(BaseModel):
    rating: int                    # 1-5
    patterns_used: list = []
    mood: str = "energetic"
    bpm: float = 128.0
    duration: float = 120.0
    notes: str = ""


class EvolveRequest(BaseModel):
    device_type: str
    mood: str = "energetic"
    bpm: float = 128.0


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/learned/generate")
async def generate_learned_show(req: LearnedGenerateRequest):
    """
    Generate a show using the learning engine.
    Uses learned patterns from memory + evolution.
    Progressively improves as more shows are rated.
    """
    try:
        analysis = analyzer.analyze_from_params(
            bpm=req.bpm,
            duration=req.duration,
            mood=req.mood,
        )
        result = learning_generator.generate_with_learning(
            memory=pattern_memory,
            evolver=pattern_evolver,
            analysis=analysis,
            prompt=req.prompt,
            include_flame=req.include_flame,
            include_laser=req.include_laser,
            include_fog=req.include_fog,
            use_evolution=req.use_evolution,
        )
        return {
            "status": "generated",
            "show": {
                "name":     result["name"],
                "bpm":      result["bpm"],
                "duration": result["duration"],
                "notes":    result["notes"],
            },
            "tracks":          result["tracks"],
            "patterns_used":   result["patterns_used"],
            "learning_stats":  result["learning_stats"],
            "analysis": {
                "bpm":         analysis.bpm,
                "mood":        analysis.mood,
                "key":         analysis.key,
                "beat_count":  len(analysis.beats),
                "sections": [
                    {"start": s.start, "end": s.end, "label": s.label, "energy": s.energy}
                    for s in analysis.sections
                ],
            },
        }
    except Exception as e:
        raise HTTPException(500, f"Learned generation failed: {str(e)}")


@router.post("/learned/learn-from-tracks")
async def learn_from_tracks(req: LearnFromTracksRequest):
    """
    Extract patterns from manually created or audio-synced tracks.
    The AI learns from these and improves future generations.
    """
    try:
        patterns = pattern_extractor.extract_from_tracks(
            tracks=req.tracks,
            bpm=req.bpm,
            mood=req.mood,
            source=req.source,
        )
        saved = []
        for p in patterns:
            pattern_memory.add_pattern(p)
            saved.append({
                "id":          p.id,
                "name":        p.name,
                "device_type": p.device_type,
                "clips":       len(p.clips),
                "source":      p.source,
            })
        return {
            "status":           "learned",
            "patterns_extracted": len(saved),
            "patterns":         saved,
            "total_in_memory":  pattern_memory.get_stats()["total_patterns"],
        }
    except Exception as e:
        raise HTTPException(500, f"Learning failed: {str(e)}")


@router.post("/learned/rate")
async def rate_show(req: RatingRequest):
    """
    Submit operator rating (1-5 stars) for a generated show.
    Updates pattern scores so better patterns get used more often.
    """
    if req.rating < 1 or req.rating > 5:
        raise HTTPException(400, "Rating must be between 1 and 5")
    try:
        feedback_processor.process_rating(
            memory=pattern_memory,
            rating=req.rating,
            patterns_used=req.patterns_used,
            mood=req.mood,
            bpm=req.bpm,
            duration=req.duration,
            notes=req.notes,
        )
        stats = pattern_memory.get_stats()
        return {
            "status":    "rated",
            "rating":    req.rating,
            "message":   f"Thank you! The AI has updated {len(set(req.patterns_used))} pattern score(s).",
            "stats":     stats,
        }
    except Exception as e:
        raise HTTPException(500, f"Rating failed: {str(e)}")


@router.post("/learned/evolve")
async def evolve_pattern(req: EvolveRequest):
    """
    Create a new evolved pattern by combining existing high-scoring patterns.
    Genetic algorithm — crossover + mutation.
    """
    try:
        evolved = pattern_evolver.evolve(
            memory=pattern_memory,
            device_type=req.device_type,
            mood=req.mood,
            bpm=req.bpm,
        )
        if not evolved:
            raise HTTPException(400, f"Not enough patterns to evolve for {req.device_type}/{req.mood}")
        pattern_memory.add_pattern(evolved)
        return {
            "status":  "evolved",
            "pattern": evolved.to_dict(),
            "total_in_memory": pattern_memory.get_stats()["total_patterns"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Evolution failed: {str(e)}")


@router.get("/learned/patterns")
async def list_patterns(
    device_type: Optional[str] = None,
    mood:        Optional[str] = None,
    source:      Optional[str] = None,
    min_score:   float = 0.0,
):
    """List all learned patterns with optional filtering."""
    patterns = pattern_memory.get_all_patterns()
    if device_type:
        patterns = [p for p in patterns if p["device_type"] == device_type]
    if mood:
        patterns = [p for p in patterns if p["mood"] in (mood, "any")]
    if source:
        patterns = [p for p in patterns if p["source"] == source]
    patterns = [p for p in patterns if p["score"] >= min_score]
    patterns.sort(key=lambda x: x["score"], reverse=True)
    return {
        "patterns": patterns,
        "count":    len(patterns),
        "stats":    pattern_memory.get_stats(),
    }


@router.get("/learned/stats")
async def get_learning_stats():
    """Get statistics about the AI learning system."""
    stats = pattern_memory.get_stats()
    return {
        "stats": stats,
        "capabilities": {
            "can_generate":       stats["total_patterns"] >= 3,
            "can_evolve":         stats["total_patterns"] >= 4,
            "learning_quality":   "high" if stats["avg_score"] >= 0.75
                                  else "medium" if stats["avg_score"] >= 0.55
                                  else "building",
            "improvement_trend":  "improving" if stats["feedback_count"] >= 3
                                  else "needs_feedback",
        },
        "tips": _get_learning_tips(stats),
    }


@router.delete("/learned/patterns/{pattern_id}")
async def delete_pattern(pattern_id: str):
    """Delete a specific pattern from memory."""
    if pattern_id not in pattern_memory._patterns:
        raise HTTPException(404, f"Pattern {pattern_id} not found")
    del pattern_memory._patterns[pattern_id]
    pattern_memory.save()
    return {"status": "deleted", "pattern_id": pattern_id}


@router.post("/learned/reset")
async def reset_learning():
    """Reset all learned patterns (keeps library templates)."""
    to_delete = [
        pid for pid, p in pattern_memory._patterns.items()
        if p.source != "library"
    ]
    for pid in to_delete:
        del pattern_memory._patterns[pid]
    pattern_memory._feedback = []
    pattern_memory.save()
    return {
        "status": "reset",
        "kept":   len(pattern_memory._patterns),
        "deleted": len(to_delete),
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _get_learning_tips(stats: dict) -> list[str]:
    tips = []
    if stats["total_patterns"] < 10:
        tips.append("Generate and rate shows to build the pattern library")
    if stats["feedback_count"] == 0:
        tips.append("Rate generated shows (1-5 stars) to help the AI learn your preferences")
    if stats.get("by_source", {}).get("manual", 0) == 0:
        tips.append("Use the Learn tab to import patterns from manually created shows")
    if stats["avg_score"] < 0.6:
        tips.append("Keep rating shows — the AI needs more feedback to improve quality")
    if stats["high_quality_patterns"] >= 5:
        tips.append("You have high-quality patterns — try the Evolve feature to create new variations")
    if not tips:
        tips.append("AI is performing well — keep rating shows for continuous improvement")
    return tips
