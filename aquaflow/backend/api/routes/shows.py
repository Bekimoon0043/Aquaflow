"""
API Routes — Shows
Handles show file save/load/list on the backend.
Shows are stored as .aqua JSON files in the shows/ directory.
"""
import json
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from app_state import SHOWS_DIR, sanitize_show_id, load_saved_show, apply_show_payload, show_engine

router = APIRouter()


class ShowData(BaseModel):
    aquaflow: str
    savedAt: str
    show: dict
    nodes: list = []
    connections: list = []
    timelineTracks: list = []
    devices: list = []
    ui: dict = {}


@router.get("/")
async def list_shows():
    shows = []
    for f in SHOWS_DIR.glob("*.aqua"):
        try:
            data = json.loads(f.read_text())
            shows.append({
                "id": f.stem,
                "filename": f.name,
                "name": data.get("show", {}).get("name", f.stem),
                "bpm": data.get("show", {}).get("bpm", 128),
                "duration": data.get("show", {}).get("duration", 240),
                "savedAt": data.get("savedAt"),
                "size": f.stat().st_size,
            })
        except Exception:
            pass
    return {"shows": sorted(shows, key=lambda x: x.get("savedAt", ""), reverse=True)}


@router.get("/{show_id}")
async def get_show(show_id: str):
    path = SHOWS_DIR / f"{show_id}.aqua"
    if not path.exists():
        raise HTTPException(404, f"Show '{show_id}' not found")
    return JSONResponse(json.loads(path.read_text()))


@router.post("/")
async def save_show(data: ShowData):
    name = data.show.get("name", "untitled")
    safe_name = sanitize_show_id(name)
    filename = f"{safe_name}.aqua"
    path = SHOWS_DIR / filename
    path.write_text(data.model_dump_json(indent=2))
    return {"saved": True, "filename": filename, "show_id": safe_name}


@router.delete("/{show_id}")
async def delete_show(show_id: str):
    path = SHOWS_DIR / f"{show_id}.aqua"
    if not path.exists():
        raise HTTPException(404, "Show not found")
    path.unlink()
    return {"deleted": True, "show_id": show_id}


@router.get("/{show_id}/download")
async def download_show(show_id: str):
    path = SHOWS_DIR / f"{show_id}.aqua"
    if not path.exists():
        raise HTTPException(404, "Show not found")
    return FileResponse(path, media_type="application/json", filename=f"{show_id}.aqua")


@router.post("/upload")
async def upload_show(file: UploadFile = File(...)):
    content = await file.read()
    try:
        data = json.loads(content)
        if "aquaflow" not in data:
            raise HTTPException(400, "Not a valid .aqua file")
        name = data.get("show", {}).get("name", "uploaded")
        safe_name = sanitize_show_id(name)
        path = SHOWS_DIR / f"{safe_name}.aqua"
        path.write_bytes(content)
        return {"uploaded": True, "show_id": safe_name, "filename": path.name}
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON")


@router.post("/{show_id}/play")
async def play_show(show_id: str):
    payload = load_saved_show(show_id)
    if not payload:
        raise HTTPException(404, "Show not found")
    apply_show_payload(payload)
    await show_engine.seek(0)
    await show_engine.play()
    return {"status": "playing", "show_id": show_id, "engine": show_engine.get_state()}


@router.post("/{show_id}/stop")
async def stop_show(show_id: str):
    await show_engine.stop_playback()
    return {"status": "stopped", "show_id": show_id, "engine": show_engine.get_state()}
