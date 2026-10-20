"""
music_deep_routes.py — Phase 3 deep music analysis API.

  POST /api/music/deep        { pcm16: base64 little-endian int16 mono, rate, bpm?, beats?, beatsPerBar? }
                              → { job_id, status, result? }  (cached results return at once)
  GET  /api/music/deep/{id}   → { status: queued | running | done | error, progress, result?, error? }
  GET  /api/music/plugins     → optional models installed in this engine
"""
from __future__ import annotations

import base64
import json
import threading
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import deep_music

router = APIRouter()
CACHE = Path("data/deep_music")
_jobs: dict[str, dict] = {}
_lock = threading.Lock()
MAX_SECONDS = 600


class DeepRequest(BaseModel):
    pcm16: str
    rate: int = 11025
    bpm: Optional[float] = None
    beats: Optional[list[float]] = None
    beatsPerBar: int = 4


def _cache_path(key: str) -> Path:
    return CACHE / f"{key}.json"


def _run(job_id: str, samples: np.ndarray, req: DeepRequest, key: str) -> None:
    def progress(p: float) -> None:
        with _lock:
            _jobs[job_id]["progress"] = round(p, 2)
    try:
        with _lock:
            _jobs[job_id]["status"] = "running"
        result = deep_music.analyze(samples, req.rate, bpm=req.bpm, beats=req.beats, beats_per_bar=req.beatsPerBar, progress=progress)
        try:
            CACHE.mkdir(parents=True, exist_ok=True)
            _cache_path(key).write_text(json.dumps(result))
        except OSError:
            pass
        with _lock:
            _jobs[job_id].update(status="done", progress=1.0, result=result)
    except Exception as exc:  # pragma: no cover - reported to the client
        with _lock:
            _jobs[job_id].update(status="error", error=str(exc))


@router.post("/deep")
def start_deep(req: DeepRequest, wait: bool = False):
    try:
        raw = base64.b64decode(req.pcm16)
    except Exception as exc:
        raise HTTPException(400, f"pcm16 is not base64: {exc}") from exc
    samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    if not (1000 <= req.rate <= 96000):
        raise HTTPException(400, "rate must be 1,000–96,000 Hz")
    if len(samples) < req.rate:
        raise HTTPException(400, "at least 1 s of audio is needed")
    if len(samples) > MAX_SECONDS * req.rate:
        raise HTTPException(413, f"at most {MAX_SECONDS} s of audio")
    key = deep_music.pcm_hash(samples, req.rate) + f"-{req.beatsPerBar}-{round(req.bpm or 0, 2)}-v{deep_music.VERSION}"
    job_id = uuid.uuid4().hex[:10]
    cached = _cache_path(key)
    if cached.exists():
        try:
            result = json.loads(cached.read_text())
            job = {"job_id": job_id, "status": "done", "progress": 1.0, "result": result, "cached": True}
            with _lock:
                _jobs[job_id] = job
            return job
        except (OSError, ValueError):
            pass
    with _lock:
        _jobs[job_id] = {"job_id": job_id, "status": "queued", "progress": 0.0}
    if wait:
        _run(job_id, samples, req, key)
        return _jobs[job_id]
    threading.Thread(target=_run, args=(job_id, samples, req, key), daemon=True).start()
    return {"job_id": job_id, "status": "queued", "progress": 0.0}


@router.get("/deep/{job_id}")
def deep_status(job_id: str):
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "unknown job")
    return job


@router.get("/plugins")
def plugins():
    return {"plugins": deep_music.available_plugins(), "version": deep_music.VERSION}
