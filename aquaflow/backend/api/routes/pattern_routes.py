"""
backend/api/routes/pattern_routes.py
─────────────────────────────────────
Phase 15 additions:
  POST   /api/patterns            – save named pattern
  GET    /api/patterns            – list all saved patterns
  DELETE /api/patterns/{name}     – delete a pattern
  POST   /api/dmx-map             – set full DMX fixture→channel map
  GET    /api/dmx-map             – get current DMX map
  POST   /api/timeline/clips      – import recorded clips into timeline

Persists to:  backend/data/patterns.json
              backend/data/dmx_map.json
              backend/data/timeline_clips.json
"""

import json
import os
import time
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# ─── persistence helpers ─────────────────────────────────────────────────────

DATA_DIR = os.path.join(os.path.dirname(__file__), "../../data")
os.makedirs(DATA_DIR, exist_ok=True)

PATTERNS_FILE = os.path.join(DATA_DIR, "patterns.json")
DMX_FILE      = os.path.join(DATA_DIR, "dmx_map.json")
CLIPS_FILE    = os.path.join(DATA_DIR, "timeline_clips.json")


def _load(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def _save(path: str, data: Any) -> None:
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


# ─── models ──────────────────────────────────────────────────────────────────

class PatternModel(BaseModel):
    name: str
    patternType: str = "wave"
    intensity: float = 0.8
    speed: float = 1.0
    stepDuration: int = 200
    beatSync: bool = False
    seqSteps: List[int] = []
    dmxMap: List[Dict] = []
    lightColor: str = "#ffffff"
    createdAt: float = 0.0


class DmxEntry(BaseModel):
    fixtureId: Any
    universe: int
    channel: int


class DmxMapPayload(BaseModel):
    map: List[DmxEntry]


class TimelineKeyframe(BaseModel):
    time: float   # seconds
    value: float  # 0..1


class TimelineClipTrack(BaseModel):
    fixtureId: Any
    fixtureName: str = ""
    fixtureType: str = ""
    type: str = ""
    groupId: str = ""
    color: str = ""
    rgb: Any = None
    lightColor: str = ""
    keyframes: List[TimelineKeyframe]
    duration: float


class TimelineClipsPayload(BaseModel):
    clips: List[TimelineClipTrack]
    name: str = "Untitled"


# ─── patterns ────────────────────────────────────────────────────────────────

@router.get("/api/patterns")
def list_patterns():
    """Return all saved patterns (newest first)."""
    patterns = _load(PATTERNS_FILE, [])
    return sorted(patterns, key=lambda p: p.get("createdAt", 0), reverse=True)


@router.post("/api/patterns")
def save_pattern(pattern: PatternModel):
    """Upsert a pattern by name."""
    patterns = _load(PATTERNS_FILE, [])
    # Remove existing entry with the same name
    patterns = [p for p in patterns if p.get("name") != pattern.name]
    data = pattern.dict()
    data["createdAt"] = time.time()
    patterns.append(data)
    _save(PATTERNS_FILE, patterns)
    return data


@router.delete("/api/patterns/{name}")
def delete_pattern(name: str):
    """Delete a pattern by name."""
    patterns = _load(PATTERNS_FILE, [])
    before = len(patterns)
    patterns = [p for p in patterns if p.get("name") != name]
    if len(patterns) == before:
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    _save(PATTERNS_FILE, patterns)
    return {"deleted": name}


# ─── DMX map ─────────────────────────────────────────────────────────────────

@router.get("/api/dmx-map")
def get_dmx_map():
    """Return the current fixture→DMX channel mapping."""
    return _load(DMX_FILE, {"map": []})


@router.post("/api/dmx-map")
async def set_dmx_map(payload: DmxMapPayload):
    """
    Persist the DMX fixture mapping and push to the protocol bus.
    The protocol bus (protocol_bus.py) is expected to expose
    update_dmx_map(map_list) — we call it here if available.
    """
    data = {"map": [e.dict() for e in payload.map], "updatedAt": time.time()}
    _save(DMX_FILE, data)

    # Attempt live push to protocol bus (non-fatal if bus not ready)
    try:
        from engine.protocol_bus import get_protocol_bus
        bus = get_protocol_bus()
        if hasattr(bus, "update_dmx_map"):
            bus.update_dmx_map(data["map"])
    except Exception as exc:
        # Bus offline or method not yet implemented — log and continue
        print(f"[pattern_routes] DMX push skipped: {exc}")

    return data


# ─── timeline clip export ─────────────────────────────────────────────────────

@router.post("/api/timeline/clips")
async def import_timeline_clips(payload: TimelineClipsPayload):
    """
    Accept recorded pattern keyframes from PatternDesignerPanel
    and insert them into the timeline as clips.

    Clip format written to disk and returned to the client:
    {
      "clipId": "<timestamp>",
      "name": "Manual 12:34:56",
      "tracks": [
        {
          "fixtureId": "...",
          "fixtureName": "...",
          "keyframes": [{"time": 0.0, "value": 0.82}, ...],
          "duration": 12.4
        }
      ]
    }

    Downstream: show_engine.py can poll GET /api/timeline/clips to
    hydrate its track list, or subscribe to the WebSocket events below.
    """
    clip_id = str(int(time.time() * 1000))
    clip = {
        "clipId": clip_id,
        "name": payload.name,
        "createdAt": time.time(),
        "tracks": [t.dict() for t in payload.clips],
    }

    # Append to the clip store
    clips_store = _load(CLIPS_FILE, [])
    clips_store.append(clip)
    _save(CLIPS_FILE, clips_store)

    # Attempt live injection into show_engine timeline
    try:
        from engine.show_engine import get_show_engine
        engine = get_show_engine()
        if hasattr(engine, "inject_manual_clips"):
            engine.inject_manual_clips(clip)
    except Exception as exc:
        print(f"[pattern_routes] Timeline injection skipped: {exc}")

    # Broadcast via WebSocket so the frontend timeline panel updates live
    try:
        from backend.main import broadcast
        import asyncio
        asyncio.create_task(broadcast({
            "type": "timeline_clips_updated",
            "clipId": clip_id,
            "name": payload.name,
        }))
    except Exception:
        pass

    return {"clipId": clip_id, "name": payload.name, "trackCount": len(payload.clips)}


@router.get("/api/timeline/clips")
def list_timeline_clips():
    """Return all stored timeline clips (newest first)."""
    clips = _load(CLIPS_FILE, [])
    return sorted(clips, key=lambda c: c.get("createdAt", 0), reverse=True)


@router.delete("/api/timeline/clips/{clip_id}")
def delete_timeline_clip(clip_id: str):
    clips = _load(CLIPS_FILE, [])
    before = len(clips)
    clips = [c for c in clips if c.get("clipId") != clip_id]
    if len(clips) == before:
        raise HTTPException(status_code=404, detail=f"Clip '{clip_id}' not found")
    _save(CLIPS_FILE, clips)
    return {"deleted": clip_id}
