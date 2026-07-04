"""
beat_routes.py — AquaFlow Recovery, AQ-X-013

Beat detection engine API (lightweight, numpy-only; complements the librosa upload path).

  POST /api/beat/detect  → offline BPM + beat times from {samples:[...], sample_rate}
  GET  /api/beat/demo    → self-test on a synthesised click track (?bpm=120&duration=8)
"""
from fastapi import APIRouter, HTTPException

from services.beat_detection import detect_from_payload, demo_detect

router = APIRouter()


@router.post("/detect")
async def detect(payload: dict):
    """Detect BPM + beats in a recorded mono sample buffer."""
    try:
        return detect_from_payload(payload or {})
    except (TypeError, ValueError) as exc:
        raise HTTPException(400, f"invalid audio request: {exc}")


@router.get("/demo")
async def demo(bpm: float = 120.0, duration: float = 8.0, sample_rate: int = 44100,
               live: bool = True):
    """Verify the engine end-to-end on a synthesised click track of known tempo."""
    return demo_detect(bpm=bpm, duration_s=duration, sr=sample_rate, live=live)
