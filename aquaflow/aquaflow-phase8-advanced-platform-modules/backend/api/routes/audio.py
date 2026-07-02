"""
API Routes — Audio
Handles audio file upload, analysis, and show generation from music.
"""
import os
import json
import asyncio
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from typing import Optional
from audio.audio_engine import audio_engine, AUDIO_DIR

router = APIRouter()

# Track analysis jobs
_analysis_jobs: dict[str, dict] = {}


class SyncRequest(BaseModel):
    analysis_id: str
    bpm_override: Optional[float] = None
    include_flame: bool = False
    include_laser: bool = False
    include_fog: bool = True
    style: str = "auto"  # auto | aggressive | calm | cinematic


@router.post("/upload")
async def upload_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """Upload an audio file and start analysis"""
    # Validate file type
    allowed = {".mp3", ".wav", ".flac", ".ogg", ".aac", ".m4a"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(400, f"Unsupported format: {ext}. Allowed: {', '.join(allowed)}")

    # Save file
    safe_name = "".join(c if c.isalnum() or c in ".-_" else "_" for c in file.filename)
    filepath = AUDIO_DIR / safe_name
    content = await file.read()
    filepath.write_bytes(content)

    # Create job
    job_id = safe_name.replace(".", "_")
    _analysis_jobs[job_id] = {
        "status": "queued",
        "filename": file.filename,
        "filepath": str(filepath),
        "progress": 0.0,
        "result": None,
    }

    # Start analysis in background
    background_tasks.add_task(_run_analysis, job_id, filepath)

    return {
        "job_id": job_id,
        "filename": file.filename,
        "size": len(content),
        "status": "queued",
        "message": "Analysis started. Poll /api/audio/status/{job_id} for progress.",
    }


async def _run_analysis(job_id: str, filepath: Path):
    """Background analysis task"""
    try:
        _analysis_jobs[job_id]["status"] = "analyzing"
        _analysis_jobs[job_id]["progress"] = 0.1

        result = await audio_engine.analyze_file(filepath)

        _analysis_jobs[job_id]["status"] = "complete"
        _analysis_jobs[job_id]["progress"] = 1.0
        _analysis_jobs[job_id]["result"] = {
            "filename": result.filename,
            "duration": result.duration,
            "bpm": result.bpm,
            "bpm_confidence": result.bpm_confidence,
            "key": result.key,
            "mood": result.mood,
            "sample_rate": result.sample_rate,
            "beat_count": len(result.beats),
            "section_count": len(result.sections),
            "sections": result.sections,
            "beats": result.beats[:64],  # First 64 beats as preview
            "energy_profile": result.energy_profile,
            "bass_profile": result.bass_profile,
            "treble_profile": result.treble_profile,
            "analysis_id": result.analysis_id,
            "capabilities": audio_engine.get_capabilities(),
        }
    except Exception as e:
        _analysis_jobs[job_id]["status"] = "error"
        _analysis_jobs[job_id]["error"] = str(e)


@router.get("/status/{job_id}")
async def get_analysis_status(job_id: str):
    """Poll analysis job status"""
    if job_id not in _analysis_jobs:
        raise HTTPException(404, f"Job '{job_id}' not found")
    return _analysis_jobs[job_id]


@router.get("/list")
async def list_audio_files():
    """List all uploaded audio files"""
    files = []
    for f in AUDIO_DIR.iterdir():
        if f.suffix.lower() in {".mp3", ".wav", ".flac", ".ogg", ".aac"}:
            files.append({
                "filename": f.name,
                "size": f.stat().st_size,
                "size_mb": round(f.stat().st_size / 1024 / 1024, 2),
            })
    return {"files": files}


@router.post("/sync-to-show")
async def sync_to_show(req: SyncRequest):
    """Generate a complete show synchronized to analyzed audio."""
    # Find the analysis result by exact analysis_id or exact job_id
    job = _analysis_jobs.get(req.analysis_id)
    if not job:
        job = next(
            (
                j for j in _analysis_jobs.values()
                if j.get("status") == "complete"
                and j.get("result", {}).get("analysis_id") == req.analysis_id
            ),
            None,
        )

    # If not in memory, try to find the file and re-analyze
    if not job or job["status"] != "complete":
        # Try to find matching audio file
        matching_file = None
        for f in AUDIO_DIR.iterdir():
            job_id_guess = "".join(c if c.isalnum() or c in ".-_" else "_" for c in f.name).replace(".", "_")
            if job_id_guess == req.analysis_id or f.stem.replace(" ", "_") in req.analysis_id:
                matching_file = f
                break

        if not matching_file:
            raise HTTPException(404, "Audio analysis not found for the requested analysis_id. Please upload and analyze the intended file first.")

        if matching_file:
            # Re-analyze synchronously
            result_obj = await audio_engine.analyze_file(matching_file)
            job_id = matching_file.name.replace(".", "_")
            _analysis_jobs[job_id] = {
                "status": "complete",
                "filename": matching_file.name,
                "progress": 1.0,
                "result": {
                    "filename": result_obj.filename,
                    "duration": result_obj.duration,
                    "bpm": result_obj.bpm,
                    "bpm_confidence": result_obj.bpm_confidence,
                    "key": result_obj.key,
                    "mood": result_obj.mood,
                    "sample_rate": result_obj.sample_rate,
                    "beat_count": len(result_obj.beats),
                    "section_count": len(result_obj.sections),
                    "sections": result_obj.sections,
                    "beats": result_obj.beats[:64],
                    "energy_profile": result_obj.energy_profile,
                    "bass_profile": result_obj.bass_profile,
                    "treble_profile": result_obj.treble_profile,
                    "analysis_id": result_obj.analysis_id,
                }
            }
            job = _analysis_jobs[job_id]

    result = job["result"]
    bpm = req.bpm_override or result["bpm"]
    sections = result["sections"]
    energy_profile = result["energy_profile"]
    bass_profile = result["bass_profile"]
    duration = result["duration"]

    # Import choreography generator
    from ai.choreography_engine import analyzer, generator

    analysis = analyzer.analyze_from_params(
        bpm=bpm,
        duration=duration,
        mood=result["mood"],
    )
    # Override sections with real detected ones
    from ai.choreography_engine import Section
    analysis.sections = [
        Section(
            start=s["start"], end=s["end"],
            label=s["label"], energy=s["energy"]
        )
        for s in sections
    ]

    show = generator.generate_from_analysis(
        analysis=analysis,
        prompt=f"Music-synchronized show: {result['mood']} mood, {result['key']}",
        include_flame=req.include_flame,
        include_laser=req.include_laser,
        include_fog=req.include_fog,
    )

    return {
        "status": "generated",
        "show": {
            "name": f"Show — {result['filename']}",
            "bpm": bpm,
            "duration": duration,
            "notes": f"Synchronized to {result['filename']}. "
                     f"BPM: {bpm}, Key: {result['key']}, Mood: {result['mood']}. "
                     f"{result['beat_count']} beats detected across {result['section_count']} sections.",
        },
        "tracks": show.tracks,
        "audio": {
            "filename": result["filename"],
            "bpm": result["bpm"],
            "key": result["key"],
            "mood": result["mood"],
            "duration": result["duration"],
        }
    }


@router.get("/stream/{filename}")
async def stream_audio(filename: str):
    """Stream an audio file for playback in the browser"""
    safe = "".join(c if c.isalnum() or c in ".-_" else "_" for c in filename)
    filepath = AUDIO_DIR / safe
    if not filepath.exists():
        raise HTTPException(404, "Audio file not found")

    ext = filepath.suffix.lower()
    media_types = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".aac": "audio/aac",
        ".m4a": "audio/mp4",
    }
    media_type = media_types.get(ext, "audio/mpeg")
    return FileResponse(filepath, media_type=media_type)


@router.delete("/{filename}")
async def delete_audio(filename: str):
    safe = "".join(c if c.isalnum() or c in ".-_" else "_" for c in filename)
    filepath = AUDIO_DIR / safe
    if filepath.exists():
        filepath.unlink()
    return {"deleted": safe}


@router.get("/capabilities")
async def get_capabilities():
    return audio_engine.get_capabilities()
