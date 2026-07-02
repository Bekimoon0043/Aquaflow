"""
Show Programmer Service — Complete with Persistence
Place in: backend/services/show_programmer_service.py
"""
from schemas.afshow_schema_v1 import AFShowV1, AFShowHeaderV1, MetadataV1, ClipV1, BeatMarkerV1, CueV1, EffectV1, AFShowValidator, AFSHOW_SCHEMA_VERSION, AFSHOW_MAGIC_BYTES, AFSHOW_FILE_EXTENSION

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any, Tuple
import os
import json
import hashlib
import uuid
import asyncio
from datetime import datetime
from pathlib import Path
from schemas.autosave_schemas import (
    AutosaveData, AutosaveMetadata, AutosaveCreateRequest,
    AutosaveRecoveryResponse, AutosaveValidationResult
)

# ─── Router Setup ─────────────────────────────────────────────────────
show_programmer_router = APIRouter(tags=["show-programmer"])

# ─── Data Directories ─────────────────────────────────────────────────
UPLOAD_DIR = Path("uploads/show_programmer")
PROGRAMS_DIR = Path("backend/data/show_programs")

# Create directories if they don't exist
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
PROGRAMS_DIR.mkdir(parents=True, exist_ok=True)

# Add autosave directory
AUTOSAVE_DIR = Path("data/autosaves")
AUTOSAVE_DIR.mkdir(parents=True, exist_ok=True)
MAX_AUTOSAVES = 10

# ─── Data Models ──────────────────────────────────────────────────────

class AudioFeatures(BaseModel):
    bpm: float = Field(default=120.0, ge=20, le=300)
    key: Optional[str] = None
    energy: float = Field(default=0.5, ge=0, le=1)
    duration: float = Field(default=60.0, gt=0)
    segments: List[Dict[str, Any]] = Field(default_factory=list)

class EffectParams(BaseModel):
    intensity: Optional[float] = Field(default=None, ge=0, le=1)
    height: Optional[float] = Field(default=None, ge=0, le=3)
    tiltX: Optional[float] = Field(default=None, ge=-90, le=90)
    tiltZ: Optional[float] = Field(default=None, ge=-90, le=90)
    color: Optional[str] = None
    rampUp: Optional[float] = Field(default=None, ge=0)
    rampDown: Optional[float] = Field(default=None, ge=0)
    frequency: Optional[float] = Field(default=None, ge=0)
    audioReactive: Optional[bool] = False

class ShowEffect(BaseModel):
    type: str
    startTime: float = Field(ge=0)
    duration: float = Field(gt=0)
    params: EffectParams = Field(default_factory=EffectParams)

class ShowClip(BaseModel):
    id: str
    name: Optional[str] = "Untitled"
    type: str
    startTime: float = Field(ge=0)
    duration: float = Field(gt=0)
    effects: List[ShowEffect] = Field(default_factory=list)
    fixtures: List[str] = Field(default_factory=list)
    color: Optional[str] = "#4a9eff"
    locked: bool = False
    muted: bool = False

class FixtureInfo(BaseModel):
    id: str
    type: str
    label: Optional[str] = None
    x: Optional[float] = 0
    y: Optional[float] = 0
    dmxChannel: Optional[int] = None
    dmxUniverse: Optional[int] = Field(default=1, ge=1, le=16)
    motorId: Optional[str] = None
    relayId: Optional[str] = None

class CompileOptions(BaseModel):
    fps: int = Field(default=30, ge=15, le=60)
    optimize: bool = True
    includeMetadata: bool = True

class AIChoreographyRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=1000)
    options: Dict[str, Any] = Field(default_factory=dict)
    audioFeatures: Optional[AudioFeatures] = None
    currentClips: List[ShowClip] = Field(default_factory=list)
    availableFixtures: List[FixtureInfo] = Field(default_factory=list)

class ValidateProgramRequest(BaseModel):
    timelineClips: List[Dict[str, Any]] = Field(default_factory=list)
    fixtures: List[Dict[str, Any]] = Field(default_factory=list)
    audioDuration: Optional[float] = None
    program_id: Optional[str] = None

class SaveProgramRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    timelineClips: List[Dict]
    beatMarkers: List[Dict]
    cues: List[Dict]
    audioDuration: float = Field(..., gt=0)
    zoom: float = Field(40, ge=20, le=300)
    bpm: float = Field(120, ge=20, le=300)

class CompiledShowResponse(BaseModel):
    id: str
    duration: float
    fps: int
    frameCount: int
    fixtureCommands: List[Dict[str, Any]]
    cuePoints: List[Dict[str, Any]]
    metadata: Dict[str, Any]

class CompileRequest(BaseModel):
    program_id: Optional[str] = None
    clips: Optional[List[ShowClip]] = None
    fixtures: Optional[List[FixtureInfo]] = None
    options: CompileOptions = CompileOptions()
    audio_features: Optional[AudioFeatures] = None
    dryRun: bool = False


class CompiledShowResponse(BaseModel):
    id: str
    duration: float
    fps: int
    frameCount: int
    fixtureCommands: List[Dict[str, Any]]
    cuePoints: List[Dict[str, Any]]
    metadata: Dict[str, Any]

# ─── In-Memory Storage (replace with DB in production) ───────────────
_show_cache: Dict[str, Dict] = {}
_audio_cache: Dict[str, bytes] = {}

# ============================================================
# PROGRAM PERSISTENCE ENDPOINTS (NEW)
# ============================================================

@show_programmer_router.post("/programs/save")
async def save_program(request: SaveProgramRequest):
    """
    Save full timeline program state (clips, markers, cues)
    This is the main save endpoint for the Show Programmer
    """
    # Generate unique ID (8 characters for easy typing)
    program_id = str(uuid.uuid4())[:8]
    now = datetime.utcnow().isoformat()
    
    # Create the program data structure
    program_data = {
        "program_id": program_id,
        "name": request.name,
        "timelineClips": request.timelineClips,
        "beatMarkers": request.beatMarkers,
        "cues": request.cues,
        "audioDuration": request.audioDuration,
        "zoom": request.zoom,
        "bpm": request.bpm,
        "createdAt": now,
        "updatedAt": now,
        "version": "aquaflow-show-programmer-v1"
    }
    
    # Validate required fields exist
    required_fields = ['timelineClips', 'beatMarkers', 'cues', 'audioDuration', 'zoom']
    for field in required_fields:
        if field not in program_data:
            raise HTTPException(400, f"Missing required field: {field}")
    
    # Save to JSON file
    file_path = PROGRAMS_DIR / f"{program_id}.json"
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(program_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(500, f"Failed to save: {str(e)}")
    
    # Return success with stats
    return {
        "success": True,
        "program_id": program_id,
        "name": request.name,
        "saved_at": now,
        "stats": {
            "clips": len(request.timelineClips),
            "beat_markers": len(request.beatMarkers),
            "cues": len(request.cues),
            "duration": request.audioDuration
        }
    }


@show_programmer_router.get("/programs/list")
async def list_programs():
    """
    List all saved timeline programs
    Returns programs sorted by most recent first
    """
    programs = []
    
    # Loop through all JSON files in the programs directory
    for file_path in PROGRAMS_DIR.glob("*.json"):
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
            programs.append({
                "program_id": data.get("program_id", file_path.stem),
                "name": data.get("name", "Untitled"),
                "updatedAt": data.get("updatedAt", ""),
                "createdAt": data.get("createdAt", ""),
                "clipCount": len(data.get("timelineClips", [])),
                "cueCount": len(data.get("cues", [])),
                "beatMarkerCount": len(data.get("beatMarkers", [])),
                "duration": data.get("audioDuration", 0)
            })
        except Exception as e:
            print(f"Error reading {file_path}: {e}")
            continue
    
    # Sort by updated date (most recent first)
    programs.sort(key=lambda x: x.get("updatedAt", ""), reverse=True)
    
    return {
        "success": True,
        "programs": programs,
        "total": len(programs)
    }


@show_programmer_router.get("/programs/load/{program_id}")
async def load_program(program_id: str):
    """
    Load a saved timeline program by ID
    Returns full program data ready for timeline restoration
    Includes corruption detection and recovery
    """
    file_path = PROGRAMS_DIR / f"{program_id}.json"
    
    # Check if file exists
    if not file_path.exists():
        raise HTTPException(404, f"Program '{program_id}' not found")
    
    # Load and parse the JSON file with corruption protection
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            file_content = f.read()
        
        # Check for empty file
        if not file_content or file_content.strip() == '':
            raise HTTPException(500, "Program file is empty (corrupted)")
        
        program_data = json.loads(file_content)
        
        # Validate required fields exist
        required_fields = ['timelineClips', 'beatMarkers', 'cues', 'audioDuration', 'zoom']
        for field in required_fields:
            if field not in program_data:
                raise HTTPException(400, f"Program corrupted: missing {field}")
        
        # Validate data types
        if not isinstance(program_data.get('timelineClips'), list):
            raise HTTPException(400, "Program corrupted: timelineClips is not an array")
        if not isinstance(program_data.get('beatMarkers'), list):
            raise HTTPException(400, "Program corrupted: beatMarkers is not an array")
        if not isinstance(program_data.get('cues'), list):
            raise HTTPException(400, "Program corrupted: cues is not an array")
        
        # Sanitize numeric values
        try:
            program_data['audioDuration'] = float(program_data.get('audioDuration', 120))
            if program_data['audioDuration'] <= 0:
                program_data['audioDuration'] = 120
        except (ValueError, TypeError):
            program_data['audioDuration'] = 120
        
        try:
            program_data['zoom'] = float(program_data.get('zoom', 80))
            if program_data['zoom'] < 20:
                program_data['zoom'] = 80
            if program_data['zoom'] > 300:
                program_data['zoom'] = 80
        except (ValueError, TypeError):
            program_data['zoom'] = 80
        
        # Add missing fields with defaults
        if 'version' not in program_data:
            program_data['version'] = '0.0.0'
        if 'createdAt' not in program_data:
            program_data['createdAt'] = datetime.utcnow().isoformat()
        if 'updatedAt' not in program_data:
            program_data['updatedAt'] = program_data.get('createdAt', datetime.utcnow().isoformat())
        
        return {
            "success": True,
            "program": program_data,
            "loaded_at": datetime.utcnow().isoformat()
        }
        
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"Program file is corrupted (invalid JSON): {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to load: {str(e)}")


@show_programmer_router.delete("/programs/{program_id}")
async def delete_program(program_id: str):
    """
    Delete a saved program by ID
    """
    file_path = PROGRAMS_DIR / f"{program_id}.json"
    
    if not file_path.exists():
        raise HTTPException(404, "Program not found")
    
    try:
        file_path.unlink()  # Delete the file
        return {
            "success": True,
            "program_id": program_id,
            "deleted_at": datetime.utcnow().isoformat()
        }
    except Exception as e:
        raise HTTPException(500, f"Failed to delete: {str(e)}")


# ============================================================
# AUDIO ANALYSIS ENDPOINTS (Existing - keep as is)
# ============================================================

@show_programmer_router.post("/analyze-audio")
async def analyze_audio(file: UploadFile = File(...)):
    """Upload and analyze audio file to extract BPM, key, and energy."""
    if not file.content_type or not file.content_type.startswith("audio/"):
        raise HTTPException(400, "File must be an audio file")
    
    show_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"{show_id}_{file.filename}"
    
    # Save uploaded file
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
    
    _audio_cache[show_id] = content
    
    # Simulate audio analysis
    try:
        # Rough duration estimate (assuming 44.1kHz stereo)
        duration = len(content) / 44100 / 4
        bpm = await _analyze_bpm(file_path)
        
        features = AudioFeatures(
            bpm=bpm,
            key="C minor",
            energy=0.7,
            duration=max(duration, 1.0),
            segments=_generate_segments(duration, bpm),
        )
        
        _show_cache[show_id] = {
            "audio_features": features.model_dump(),
            "file_path": str(file_path),
            "created_at": datetime.utcnow().isoformat(),
        }
        
        return {
            "show_id": show_id,
            "features": features.model_dump(),
        }
    except Exception as e:
        raise HTTPException(500, f"Audio analysis failed: {str(e)}")


async def _analyze_bpm(file_path: Path) -> float:
    """Analyze BPM from audio file (placeholder)."""
    await asyncio.sleep(0.5)
    return 128.0


def _generate_segments(duration: float, bpm: float) -> List[Dict]:
    """Generate audio segments for dynamic reactivity."""
    beat_duration = 60.0 / bpm
    segments = []
    t = 0.0
    while t < duration:
        seg_duration = min(beat_duration * 4, duration - t)
        loudness = 0.5 + 0.3 * (0.5 - (t / duration))
        segments.append({
            "start": round(t, 3),
            "end": round(t + seg_duration, 3),
            "loudness": round(loudness, 3),
            "confidence": 0.9,
        })
        t += seg_duration
    return segments


# ============================================================
# COMPILATION ENDPOINTS (Existing - keep as is)
# ============================================================

@show_programmer_router.post("/compile")
async def compile_show_endpoint(request: CompileRequest):
    """
    Compile timeline clips into DMX/PLC-ready command sequences.
    
    Supports:
    - Load by program_id
    - Direct compilation with clips + fixtures
    - Dry-run mode (validation only, no compilation)
    
    Returns validation report + compilation results.
    """
    clips = request.clips
    fixtures = request.fixtures
    program_id = request.program_id
    options = request.options
    audio_features = request.audio_features
    dry_run = request.dryRun
    
    # Handle program_id mode
    if program_id and not clips:
        file_path = PROGRAMS_DIR / f"{program_id}.json"
        if not file_path.exists():
            raise HTTPException(404, f"Program '{program_id}' not found")
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                program_data = json.load(f)
            
            clips_data = program_data.get('timelineClips', [])
            clips = [ShowClip(**clip) for clip in clips_data if isinstance(clip, dict)]
            
            if not fixtures:
                fixtures = []
                
        except Exception as e:
            raise HTTPException(500, f"Failed to load program: {str(e)}")
    
    # Set defaults
    if not clips:
        clips = []
    if not fixtures:
        fixtures = []
    
    # Convert to dict for validation
    clips_dict = [c.model_dump() if hasattr(c, 'model_dump') else c for c in clips]
    fixtures_dict = [f.model_dump() if hasattr(f, 'model_dump') else f for f in fixtures]
    
    # Run comprehensive validation
    validation = validate_show_for_compilation(
        clips=clips_dict,
        fixtures=fixtures_dict,
        duration=audio_features.duration if audio_features else None
    )
    
    # Generate report
    report = generate_compilation_report(clips_dict, fixtures_dict, validation)
    
    # If dry-run, return validation report + compiled events (for preview)
    if dry_run:
        # Still compile to get events, but don't send to hardware
        compiled = _compile_show_logic(
            clips=clips_dict,
            fixtures=fixtures_dict,
            options=options.model_dump(),
            audio_features=audio_features.model_dump() if audio_features else None,
        ) if validation['valid'] else None
        
        return {
            "success": True,
            "dryRun": True,
            "validationPassed": validation['valid'],
            "warnings": validation['warnings'],
            "report": report,
            "compiled": compiled,  # Now returns compiled events for dry-run preview
            "note": "Dry-run mode: compiled events returned but NO hardware output"
        }
    
    # If validation fails, return errors
    if not validation['valid']:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Compilation validation failed",
                "errors": validation['errors'],
                "warnings": validation['warnings'],
                "report": report
            }
        )
    
    # Proceed with compilation
    try:
        compiled = _compile_show_logic(
            clips=clips_dict,
            fixtures=fixtures_dict,
            options=options.model_dump(),
            audio_features=audio_features.model_dump() if audio_features else None,
        )
        
        return {
            "success": True,
            "dryRun": False,
            "validationPassed": True,
            "warnings": validation['warnings'],
            "report": report,
            "compiled": compiled
        }
        
    except Exception as e:
        raise HTTPException(500, f"Compilation failed: {str(e)}")
@show_programmer_router.post("/validate-only")
async def validate_only_endpoint(
    clips: List[ShowClip] = None,
    fixtures: List[FixtureInfo] = None,
    program_id: str = None,
):
    """
    Validate a show without compiling it.
    Returns only validation report.
    """
    # Handle program_id mode
    if program_id and not clips:
        file_path = PROGRAMS_DIR / f"{program_id}.json"
        if not file_path.exists():
            raise HTTPException(404, f"Program '{program_id}' not found")
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                program_data = json.load(f)
            clips_data = program_data.get('timelineClips', [])
            clips = [ShowClip(**clip) for clip in clips_data if isinstance(clip, dict)]
            fixtures = []
        except Exception as e:
            raise HTTPException(500, f"Failed to load program: {str(e)}")
    
    if not clips:
        clips = []
    if not fixtures:
        fixtures = []
    
    clips_dict = [c.model_dump() if hasattr(c, 'model_dump') else c for c in clips]
    fixtures_dict = [f.model_dump() if hasattr(f, 'model_dump') else f for f in fixtures]
    
    validation = validate_show_for_compilation(clips_dict, fixtures_dict)
    report = generate_compilation_report(clips_dict, fixtures_dict, validation)
    
    return {
        "success": validation['valid'],
        "report": report
    }

# ============================================================
# VALIDATION FUNCTIONS (Team B - Phase 1)
# ============================================================

def validate_show_for_compilation(clips: List[Dict], fixtures: List[Dict], duration: float = None) -> Dict:
    """
    Comprehensive validation of a show before compilation.
    Returns detailed report with errors and warnings.
    """
    errors = []
    warnings = []
    
    # 1. Total clips count
    total_clips = len(clips)
    if total_clips == 0:
        warnings.append("No clips in timeline - compilation will produce empty output")
    
    # 2. Total tracks used (unique track IDs)
    track_ids = set()
    for clip in clips:
        if clip.get('trackId'):
            track_ids.add(clip['trackId'])
    total_tracks = len(track_ids)
    
    # 3. Missing fixture IDs
    fixture_ids_in_use = set()
    for clip in clips:
        # Check if clip has fixtures array
        if 'fixtures' in clip and clip['fixtures']:
            for fid in clip['fixtures']:
                fixture_ids_in_use.add(fid)
        # Also check fixtureId field (legacy support)
        elif clip.get('fixtureId'):
            fixture_ids_in_use.add(clip['fixtureId'])
    
    # Check which fixtures are missing from the fixtures list
    available_fixture_ids = {f.get('id') for f in fixtures if f.get('id')}
    missing_fixture_ids = fixture_ids_in_use - available_fixture_ids
    
    if missing_fixture_ids:
        errors.append({
            'type': 'missing_fixtures',
            'message': f'Missing fixture IDs: {", ".join(missing_fixture_ids)}',
            'fixture_ids': list(missing_fixture_ids)
        })
    
    # 4. Invalid durations
    for clip in clips:
        clip_id = clip.get('id', clip.get('name', 'unknown'))
        duration_val = clip.get('duration', 0)
        start_time = clip.get('startTime', 0)
        
        if duration_val <= 0:
            errors.append({
                'type': 'invalid_duration',
                'clip': clip_id,
                'message': f'Clip "{clip_id}" has invalid duration: {duration_val}s (must be > 0)'
            })
        
        if start_time < 0:
            errors.append({
                'type': 'invalid_start_time',
                'clip': clip_id,
                'message': f'Clip "{clip_id}" has invalid start time: {start_time}s (must be >= 0)'
            })
    
    # 5. Overlapping clips on same track (enhanced detection)
    track_timelines = {}
    for clip in clips:
        track_id = clip.get('trackId')
        if not track_id:
            # Track missing - already handled above, but add to tracking for completeness
            continue
        
        if track_id not in track_timelines:
            track_timelines[track_id] = []
        
        start_time = clip.get('startTime', 0)
        duration = clip.get('duration', 0)
        end_time = start_time + duration
        
        track_timelines[track_id].append({
            'clip_id': clip.get('id', clip.get('name', 'unknown')),
            'clip_name': clip.get('name', 'Untitled'),
            'start': start_time,
            'end': end_time,
            'duration': duration
        })
    
    # Check each track for overlaps
    for track_id, timeline in track_timelines.items():
        # Sort by start time
        timeline.sort(key=lambda x: x['start'])
        
        # Check each pair of clips
        for i in range(len(timeline)):
            current = timeline[i]
            
            # Check for invalid start time (negative)
            if current['start'] < 0:
                errors.append({
                    'type': 'invalid_start_time',
                    'track': track_id,
                    'clip': current['clip_name'],
                    'start_time': current['start'],
                    'message': f'Clip "{current["clip_name"]}" on track "{track_id}" has invalid start time: {current["start"]}s'
                })
            
            # Check for invalid duration (zero or negative)
            if current['duration'] <= 0:
                errors.append({
                    'type': 'invalid_duration',
                    'track': track_id,
                    'clip': current['clip_name'],
                    'duration': current['duration'],
                    'message': f'Clip "{current["clip_name"]}" on track "{track_id}" has invalid duration: {current["duration"]}s'
                })
            
            # Check against next clips for overlap
            for j in range(i + 1, len(timeline)):
                next_clip = timeline[j]
                
                # Check if clips overlap
                if next_clip['start'] < current['end']:
                    overlap_start = next_clip['start']
                    overlap_end = min(current['end'], next_clip['end'])
                    overlap_duration = overlap_end - overlap_start
                    
                    errors.append({
                        'type': 'clip_overlap',
                        'track': track_id,
                        'clip1': current['clip_name'],
                        'clip2': next_clip['clip_name'],
                        'overlap_start': overlap_start,
                        'overlap_end': overlap_end,
                        'overlap_duration': round(overlap_duration, 3),
                        'message': f'Clip "{next_clip["clip_name"]}" overlaps with "{current["clip_name"]}" on track "{track_id}" from {overlap_start:.2f}s to {overlap_end:.2f}s'
                    })
                    
                    # Add warning for tiny overlaps (less than 0.1s)
                    if overlap_duration < 0.1 and overlap_duration > 0:
                        warnings.append({
                            'type': 'tiny_overlap',
                            'track': track_id,
                            'clip1': current['clip_name'],
                            'clip2': next_clip['clip_name'],
                            'overlap_duration': round(overlap_duration, 3),
                            'message': f'Tiny overlap ({overlap_duration:.3f}s) between "{current["clip_name"]}" and "{next_clip["clip_name"]}" on track "{track_id}"'
                        })
    
    # 6. Unsupported track types
    supported_types = {
        'lighting_master', 'lighting_red', 'lighting_green', 'lighting_blue',
        'pump_speed', 'pump_pressure',
        'solenoid_open', 'solenoid_duration',
        'fire_trigger', 'fire_intensity',
        'fog_density',
        'laser_intensity', 'laser_pattern',
        'device_enable', 'device_intensity',
        'motion_intensity', 'motion_angle', 'motion_pan', 'motion_tilt',
        'ai_generated', 'lighting'
    }
    
    unsupported_types = set()
    for clip in clips:
        clip_type = clip.get('type', '')
        if clip_type and clip_type not in supported_types:
            unsupported_types.add(clip_type)
    
    if unsupported_types:
        warnings.append({
            'type': 'unsupported_track_types',
            'message': f'Unsupported track types found: {", ".join(unsupported_types)}',
            'types': list(unsupported_types)
        })
    
    # 7. Estimated show duration
    if clips:
        max_end = max((c.get('startTime', 0) + c.get('duration', 0)) for c in clips)
        estimated_duration = max(max_end, duration or 0)
    else:
        estimated_duration = duration or 60.0
    
    # 8. Check for zero-duration clips
    zero_duration_clips = [c.get('name', c.get('id', 'unknown')) for c in clips if c.get('duration', 0) <= 0.01]
    if zero_duration_clips:
        warnings.append({
            'type': 'zero_duration',
            'message': f'Clips with near-zero duration: {", ".join(zero_duration_clips[:5])}',
            'clips': zero_duration_clips
        })
    
    # 9. Check for clips with no effects
    no_effect_clips = [c.get('name', c.get('id', 'unknown')) for c in clips if not c.get('effects')]
    if no_effect_clips:
        warnings.append({
            'type': 'no_effects',
            'message': f'Clips with no effects (will use default): {", ".join(no_effect_clips[:5])}',
            'clips': no_effect_clips
        })
    
    # 10. Check DMX channel allocation (if fixtures have DMX info)
    dmx_channels_used = {}
    for fixture in fixtures:
        if fixture.get('type', '').startswith('light_') or 'light' in fixture.get('type', ''):
            channel = fixture.get('dmxChannel')
            universe = fixture.get('dmxUniverse', 1)
            if channel:
                key = f"universe_{universe}"
                if key not in dmx_channels_used:
                    dmx_channels_used[key] = []
                dmx_channels_used[key].append(channel)
    
    for universe, channels in dmx_channels_used.items():
        if len(channels) > 32:  # Rough limit (512/16 channels per fixture)
            warnings.append({
                'type': 'dmx_density',
                'message': f'High DMX channel density in {universe}: {len(channels)} channels'
            })
    
    return {
        'valid': len(errors) == 0,
        'total_clips': total_clips,
        'total_tracks': total_tracks,
        'missing_fixture_ids': list(missing_fixture_ids),
        'invalid_durations': [e for e in errors if e.get('type') in ('invalid_duration', 'invalid_start_time')],
        'overlapping_clips': [e for e in errors if e.get('type') == 'clip_overlap'],
        'unsupported_track_types': list(unsupported_types),
        'estimated_duration': round(estimated_duration, 2),
        'warnings': warnings,
        'errors': errors,
        'has_clips': total_clips > 0,
        'has_fixtures': len(fixtures) > 0
    }


def generate_compilation_report(clips: List[Dict], fixtures: List[Dict], validation: Dict, compiled_data: Dict = None) -> Dict:
    """
    Generate a human-readable compilation report.
    """
    report = {
        'summary': {
            'status': 'PASSED' if validation['valid'] else 'FAILED',
            'total_clips': validation['total_clips'],
            'total_tracks': validation['total_tracks'],
            'estimated_duration_seconds': validation['estimated_duration'],
            'formatted_duration': f"{int(validation['estimated_duration'] // 60)}:{int(validation['estimated_duration'] % 60):02d}",
            'fixtures_in_use': len(set().union(*[set(c.get('fixtures', [c.get('fixtureId')] if c.get('fixtureId') else [])) for c in clips if c.get('fixtureId') or c.get('fixtures')])) if clips else 0,
            'available_fixtures': len(fixtures)
        },
        'errors': validation['errors'],
        'warnings': validation['warnings'],
        'statistics': {
            'clips_with_effects': len([c for c in clips if c.get('effects')]),
            'clips_without_effects': len([c for c in clips if not c.get('effects')]),
            'unique_track_types': len(set(c.get('type', '') for c in clips if c.get('type'))),
            'total_effect_count': sum(len(c.get('effects', [])) for c in clips)
        }
    }
    
    if compiled_data:
        report['compilation'] = {
            'frame_count': compiled_data.get('frameCount', 0),
            'command_count': len(compiled_data.get('fixtureCommands', [])),
            'cue_point_count': len(compiled_data.get('cuePoints', []))
        }
    
    return report

def _compile_show_logic(
    clips: List[Dict],
    fixtures: List[Dict],
    options: Dict,
    audio_features: Optional[Dict] = None,
) -> Dict:
    """Core compilation logic."""
    fps = options.get("fps", 30)
    duration = max(
        (c["startTime"] + c["duration"] for c in clips),
        default=60.0
    )
    frame_count = int(duration * fps)
    
    frames = []
    for i in range(frame_count):
        frame = {
            "time": round(i / fps, 4),
            "states": {f["id"]: _default_fixture_state(f["type"]) for f in fixtures}
        }
        frames.append(frame)
    
    fixture_commands = []
    cue_points = []
    
    for clip in clips:
        clip_start = clip.get("startTime", 0)
        clip_end = clip_start + clip.get("duration", 0)
        
        cue_points.append({
            "time": round(clip_start, 3),
            "label": f"{clip.get('name', clip['type'])} start",
            "type": "effect_start"
        })
        
        for effect in clip.get("effects", []):
            effect_start = clip_start + effect.get("startTime", 0)
            effect_duration = effect.get("duration", 1.0)
            effect_end = effect_start + effect_duration
            
            start_frame = int(effect_start * fps)
            end_frame = min(int(effect_end * fps), frame_count)
            
            target_fixtures = clip.get("fixtures", []) or [f["id"] for f in fixtures]
            
            for fi in range(start_frame, end_frame):
                frame_time = round(fi / fps, 3)
                local_time = frame_time - effect_start
                progress = local_time / effect_duration if effect_duration > 0 else 1
                
                envelope = _compute_envelope(effect["type"], progress, effect.get("params", {}))
                
                for fixture_id in target_fixtures:
                    fixture = next((f for f in fixtures if f["id"] == fixture_id), None)
                    if not fixture:
                        continue
                    
                    state = _compute_fixture_state(
                        fixture, effect, envelope, progress,
                        clip.get("color"), audio_features
                    )
                    frames[fi]["states"][fixture_id] = state
                    
                    if fi == start_frame or _state_changed(
                        state, frames[fi-1]["states"].get(fixture_id)
                    ):
                        fixture_commands.append({
                            "time": round(frame_time, 4),
                            "fixtureId": fixture_id,
                            "type": _get_fixture_protocol(fixture),
                            "params": _state_to_protocol(fixture, state)
                        })
        
        cue_points.append({
            "time": round(clip_end, 3),
            "label": f"{clip.get('name', clip['type'])} end",
            "type": "effect_end"
        })
    
    cue_points.sort(key=lambda x: x["time"])
    fixture_commands.sort(key=lambda x: x["time"])
    
    if options.get("optimize", True):
        fixture_commands = _optimize_commands(fixture_commands)
    
    show_id = f"show_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    # Sort commands by time, then by fixtureId for deterministic order
    fixture_commands.sort(key=lambda x: (x["time"], x["fixtureId"]))
    
    # Sort cue points by time, then by label for deterministic order
    cue_points.sort(key=lambda x: (x["time"], x.get("label", "")))
    
    return {
        "id": show_id,
        "duration": round(duration, 3),
        "fps": fps,
        "frameCount": frame_count,
        "fixtureCommands": fixture_commands,
        "cuePoints": cue_points,
        "metadata": {
            "clipCount": len(clips),
            "fixtureCount": len(fixtures),
            "frameCount": frame_count,
            "commandCount": len(fixture_commands),
            "generatedAt": datetime.utcnow().isoformat(),
        }
    }


def _default_fixture_state(fixture_type: str) -> Dict:
    return {
        "intensity": 0,
        "tiltX": 0,
        "tiltZ": 0,
        "color": "#88ccff",
        "heightScale": 1.0,
        "on": False
    }


def _compute_envelope(effect_type: str, progress: float, params: Dict) -> float:
    """Compute effect envelope (0-1) at given progress."""
    if effect_type == "jet_burst":
        ramp_up = params.get("rampUp", 0.1)
        ramp_down = params.get("rampDown", 0.3)
        peak = params.get("peakIntensity", 1.0)
        if progress < ramp_up:
            return (progress / ramp_up) * peak if ramp_up > 0 else peak
        elif progress < ramp_up + 0.1:
            return peak
        else:
            decay = (progress - ramp_up - 0.1) / ramp_down if ramp_down > 0 else 1
            return max(peak * (1 - decay), 0)
    elif effect_type == "fade_in":
        ramp = params.get("rampUp", 2.0)
        return min(progress / ramp, 1.0) if ramp > 0 else 1.0
    elif effect_type == "fade_out":
        ramp = params.get("rampDown", 2.0)
        return max(1.0 - (progress / ramp), 0.0) if ramp > 0 else 0.0
    elif effect_type == "pulse":
        ramp_up = params.get("rampUp", 0.2)
        sustain = params.get("sustain", 0.6)
        ramp_down = params.get("rampDown", 0.2)
        peak = params.get("peakIntensity", 1.0)
        if progress < ramp_up:
            return (progress / ramp_up) * peak if ramp_up > 0 else peak
        elif progress < ramp_up + sustain:
            return peak
        else:
            decay = (progress - ramp_up - sustain) / ramp_down if ramp_down > 0 else 1
            return max(peak * (1 - decay), 0)
    elif effect_type == "wave":
        freq = params.get("frequency", 1.0)
        peak = params.get("peakIntensity", 1.0)
        import math
        return ((1 + math.sin(progress * freq * 2 * math.pi)) / 2) * peak
    elif effect_type == "strobe":
        freq = params.get("frequency", 10)
        duty = params.get("dutyCycle", 0.5)
        cycle = (progress * freq) % 1.0
        peak = params.get("peakIntensity", 1.0)
        return peak if cycle < duty else 0.0
    else:
        return params.get("intensity", 1.0)


def _compute_fixture_state(
    fixture: Dict, effect: Dict, envelope: float,
    progress: float, clip_color: Optional[str], audio_features: Optional[Dict]
) -> Dict:
    state = _default_fixture_state(fixture["type"])
    params = effect.get("params", {})
    
    state["intensity"] = envelope
    state["on"] = envelope > 0.01
    
    if params.get("height") is not None:
        state["heightScale"] = params["height"]
    if params.get("tiltX") is not None:
        state["tiltX"] = params["tiltX"]
    if params.get("tiltZ") is not None:
        state["tiltZ"] = params["tiltZ"]
    
    if params.get("color"):
        state["color"] = params["color"]
    elif clip_color:
        state["color"] = clip_color
    
    if audio_features and params.get("audioReactive"):
        segments = audio_features.get("segments", [])
        seg = next((s for s in segments if s["start"] <= progress < s["end"]), None)
        if seg:
            loudness = seg.get("loudness", 1.0)
            state["intensity"] = min(state["intensity"] * loudness, 1.0)
            state["heightScale"] = min(state["heightScale"] * loudness * 1.5, 3.0)
    
    return state


def _get_fixture_protocol(fixture: Dict) -> str:
    ftype = fixture.get("type", "")
    if ftype.startswith("light_") or "light" in ftype:
        return "dmx"
    if "motion" in ftype or "robotic" in ftype:
        return "plc"
    return "relay"


def _state_to_protocol(fixture: Dict, state: Dict) -> Dict:
    protocol = _get_fixture_protocol(fixture)
    
    if protocol == "dmx":
        return {
            "channel": fixture.get("dmxChannel", 1),
            "universe": fixture.get("dmxUniverse", 1),
            "intensity": int(state["intensity"] * 255),
            "tiltX": int((state["tiltX"] + 90) / 180 * 255),
            "tiltZ": int((state["tiltZ"] + 90) / 180 * 255),
            "color": state["color"],
            "on": state["on"],
            "heightScale": int(state["heightScale"] * 85),
        }
    elif protocol == "plc":
        return {
            "motorId": fixture.get("motorId", fixture["id"]),
            "tiltX": state["tiltX"],
            "tiltZ": state["tiltZ"],
            "speed": state["intensity"] * 100,
            "enable": state["on"],
        }
    else:
        return {
            "relayId": fixture.get("relayId", fixture["id"]),
            "state": state["on"],
            "intensity": state["intensity"],
        }


def _state_changed(current: Dict, previous: Optional[Dict]) -> bool:
    if not previous:
        return True
    return (
        current["intensity"] != previous.get("intensity") or
        current["tiltX"] != previous.get("tiltX") or
        current["tiltZ"] != previous.get("tiltZ") or
        current["color"] != previous.get("color") or
        current["on"] != previous.get("on")
    )


def _optimize_commands(commands: List[Dict]) -> List[Dict]:
    """Remove redundant consecutive commands."""
    if not commands:
        return []
    
    optimized = []
    last_by_fixture = {}
    
    for cmd in commands:
        key = f"{cmd['fixtureId']}_{cmd['type']}"
        prev = last_by_fixture.get(key)
        
        if not prev or cmd["params"] != prev["params"]:
            optimized.append(cmd)
            last_by_fixture[key] = cmd
    
    return optimized


# ============================================================
# AI CHOREOGRAPHY ENDPOINT (Existing - keep as is)
# ============================================================

@show_programmer_router.post("/ai-choreograph")
async def ai_choreograph(request: AIChoreographyRequest):
    """Generate choreography suggestions using AI analysis."""
    try:
        suggestions = await _generate_choreography(
            prompt=request.prompt,
            options=request.options,
            audio_features=request.audioFeatures.model_dump() if request.audioFeatures else None,
            current_clips=[c.model_dump() for c in request.currentClips],
            available_fixtures=[f.model_dump() for f in request.availableFixtures],
        )
        return {"suggestions": suggestions}
    except Exception as e:
        raise HTTPException(500, f"AI generation failed: {str(e)}")


async def _generate_choreography(
    prompt: str,
    options: Dict,
    audio_features: Optional[Dict],
    current_clips: List[Dict],
    available_fixtures: List[Dict],
) -> List[Dict]:
    """AI choreography generation (placeholder - will be enhanced later)."""
    await asyncio.sleep(1.5)
    
    prompt_lower = prompt.lower()
    intensity = options.get("intensity", "medium")
    style = options.get("style", "synchronized")
    
    effects = []
    if "burst" in prompt_lower or "explode" in prompt_lower:
        effects.append("jet_burst")
    if "fade" in prompt_lower and "in" in prompt_lower:
        effects.append("fade_in")
    if "fade" in prompt_lower and "out" in prompt_lower:
        effects.append("fade_out")
    if "pulse" in prompt_lower or "beat" in prompt_lower:
        effects.append("pulse")
    if "wave" in prompt_lower:
        effects.append("wave")
    if not effects:
        effects = ["pulse", "jet_burst"]
    
    duration = options.get("duration", 60)
    bpm = audio_features.get("bpm", 120) if audio_features else 120
    beat_duration = 60.0 / bpm
    
    clips = []
    num_clips = min(options.get("maxSimultaneous", 8), len(available_fixtures))
    
    water_fixtures = [f for f in available_fixtures 
                      if not f["type"].startswith("light_")]
    light_fixtures = [f for f in available_fixtures 
                      if f["type"].startswith("light_")]
    
    use_water = options.get("includeWater", True) and water_fixtures
    use_lights = options.get("includeLights", True) and light_fixtures
    
    if use_water:
        fixtures_per_clip = max(1, len(water_fixtures) // max(num_clips, 1))
        
        for i in range(num_clips):
            start_time = i * beat_duration * 2
            clip_duration = beat_duration * 4
            
            selected_fixtures = water_fixtures[
                i * fixtures_per_clip : (i + 1) * fixtures_per_clip
            ]
            
            effect_type = effects[i % len(effects)]
            
            clips.append({
                "id": f"ai_clip_{i}",
                "name": f"AI {effect_type.replace('_', ' ').title()} {i+1}",
                "type": "ai_generated",
                "startTime": round(start_time, 3),
                "duration": round(clip_duration, 3),
                "effects": [{
                    "type": effect_type,
                    "startTime": 0,
                    "duration": round(clip_duration, 3),
                    "params": {
                        "intensity": 0.8 if intensity == "intense" else 0.5,
                        "peakIntensity": 1.0 if intensity in ["intense", "extreme"] else 0.7,
                        "audioReactive": options.get("matchDynamics", True),
                    }
                }],
                "fixtures": [f["id"] for f in selected_fixtures],
                "color": ["#4a9eff", "#ff6b6b", "#51cf66", "#ffd43b"][i % 4],
            })
    
    if use_lights:
        for i, light in enumerate(light_fixtures[:4]):
            clips.append({
                "id": f"ai_light_{i}",
                "name": f"AI Light Chase {i+1}",
                "type": "lighting",
                "startTime": round(i * beat_duration, 3),
                "duration": round(duration, 3),
                "effects": [{
                    "type": "color_fade",
                    "startTime": 0,
                    "duration": round(duration, 3),
                    "params": {
                        "colors": ["#ff0000", "#00ff00", "#0000ff", "#ff00ff"],
                        "intensity": 0.6,
                    }
                }],
                "fixtures": [light["id"]],
                "color": "#ffffff",
            })
    
    return [{
        "clips": clips,
        "description": f"AI choreography: {style} style, {intensity} intensity, {len(clips)} clips",
        "confidence": 0.85,
    }]


# ============================================================
# EXPORT ENDPOINTS (Existing - keep as is)
# ============================================================

@show_programmer_router.post("/export/dmx")
async def export_dmx(compiled_show: Dict):
    """Export compiled show to DMX512 format."""
    frames = compiled_show.get("frames", [])
    fps = compiled_show.get("fps", 30)
    
    universes = []
    for frame in frames:
        universe = [0] * 512
        for fixture_id, state in frame.get("states", {}).items():
            base = (hash(fixture_id) % 64) * 8
            if base + 7 < 512:
                universe[base] = int(state.get("intensity", 0) * 255)
                universe[base + 1] = int((state.get("tiltX", 0) + 90) / 180 * 255)
                universe[base + 2] = int((state.get("tiltZ", 0) + 90) / 180 * 255)
                color = state.get("color", "#88ccff")
                universe[base + 3] = int(color[1:3], 16) if len(color) >= 3 else 136
                universe[base + 4] = int(color[3:5], 16) if len(color) >= 5 else 204
                universe[base + 5] = int(color[5:7], 16) if len(color) >= 7 else 255
                universe[base + 6] = 255 if state.get("on") else 0
                universe[base + 7] = int(state.get("heightScale", 1) * 85)
        universes.append(universe)
    
    return {
        "format": "dmx512",
        "fps": fps,
        "frameCount": len(universes),
        "universes": universes,
    }


@show_programmer_router.post("/export/plc")
async def export_plc(compiled_show: Dict):
    """Export compiled show to PLC command sequence."""
    commands = [
        {
            "timestamp": int(cmd["time"] * 1000),
            "motorId": cmd["params"].get("motorId", cmd["params"].get("relayId", cmd["fixtureId"])),
            "command": "MOVE" if cmd["type"] == "plc" else "SET",
            "params": cmd["params"],
        }
        for cmd in compiled_show.get("fixtureCommands", [])
        if cmd["type"] in ("plc", "relay")
    ]
    
    return {
        "format": "plc",
        "commandCount": len(commands),
        "commands": commands,
    }


@show_programmer_router.post("/validate")
async def validate_show_endpoint(request: ValidateProgramRequest):
    """
    Validate a show program for errors before compilation.
    
    Supports two modes:
    1. Direct validation with clips + fixtures
    2. Load by program_id (loads from saved program first)
    
    Returns validation report with errors, warnings, and statistics.
    """
    clips_dict = request.timelineClips or []
    fixtures_dict = request.fixtures or []
    duration = request.audioDuration

    # Handle program_id mode
    if request.program_id and not clips_dict:
        file_path = PROGRAMS_DIR / f"{request.program_id}.json"
        if not file_path.exists():
            raise HTTPException(404, f"Program '{request.program_id}' not found")

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                program_data = json.load(f)

            clips_dict = program_data.get('timelineClips', [])
            fixtures_dict = program_data.get('fixtures', [])
            duration = program_data.get('audioDuration', duration)

        except Exception as e:
            raise HTTPException(500, f"Failed to load program: {str(e)}")
    
    # Run validation
    errors = []
    warnings = []
    
    # 1. Check for missing timelineClips (empty show)
    if len(clips_dict) == 0:
        warnings.append({
            'type': 'empty_show',
            'message': 'No clips in timeline - show is empty'
        })
    
    # 2. Check clips with missing trackId
    missing_track_ids = []
    for i, clip in enumerate(clips_dict):
        clip_name = clip.get('name', f'Clip {i+1}')
        if not clip.get('trackId'):
            missing_track_ids.append(clip_name)
    
    if missing_track_ids:
        errors.append({
            'type': 'missing_track_id',
            'message': f'Clips missing trackId: {", ".join(missing_track_ids[:5])}',
            'clips': missing_track_ids
        })
    
    # 3. Check clips with missing fixtureId
    missing_fixture_ids = []
    for i, clip in enumerate(clips_dict):
        clip_name = clip.get('name', f'Clip {i+1}')
        has_fixtures = clip.get('fixtures') and len(clip.get('fixtures', [])) > 0
        has_fixture_id = clip.get('fixtureId') is not None
        
        if not has_fixtures and not has_fixture_id:
            missing_fixture_ids.append(clip_name)
    
    if missing_fixture_ids:
        errors.append({
            'type': 'missing_fixture_id',
            'message': f'Clips missing fixture assignment: {", ".join(missing_fixture_ids[:5])}',
            'clips': missing_fixture_ids
        })
    
    # 4. Check clips with invalid duration
    invalid_durations = []
    for i, clip in enumerate(clips_dict):
        clip_name = clip.get('name', f'Clip {i+1}')
        duration = clip.get('duration', 0)
        start_time = clip.get('startTime', 0)
        
        if duration <= 0:
            invalid_durations.append({
                'name': clip_name,
                'duration': duration,
                'reason': 'duration must be > 0'
            })
        elif start_time < 0:
            invalid_durations.append({
                'name': clip_name,
                'start_time': start_time,
                'reason': 'startTime must be >= 0'
            })
    
    if invalid_durations:
        errors.append({
            'type': 'invalid_duration',
            'message': f'Clips with invalid duration/timing: {len(invalid_durations)} clips affected',
            'clips': invalid_durations[:5]
        })
    
    # 5. Check overlapping clips on same track
    track_timelines = {}
    for clip in clips_dict:
        track_id = clip.get('trackId')
        if not track_id:
            continue
        
        if track_id not in track_timelines:
            track_timelines[track_id] = []
        
        track_timelines[track_id].append({
            'name': clip.get('name', 'Untitled'),
            'start': clip.get('startTime', 0),
            'end': clip.get('startTime', 0) + clip.get('duration', 0)
        })
    
    overlaps = []
    for track_id, timeline in track_timelines.items():
        timeline.sort(key=lambda x: x['start'])
        
        for i in range(1, len(timeline)):
            prev = timeline[i-1]
            curr = timeline[i]
            
            if curr['start'] < prev['end']:
                overlaps.append({
                    'track': track_id,
                    'clip1': prev['name'],
                    'clip2': curr['name'],
                    'overlap_start': curr['start'],
                    'overlap_end': min(prev['end'], curr['end'])
                })
    
    if overlaps:
        errors.append({
            'type': 'overlap',
            'message': f'Found {len(overlaps)} overlapping clip(s) on same track',
            'overlaps': overlaps[:5]
        })
    
    # 6. Check unknown track types
    known_types = {
        'lighting_master', 'lighting_red', 'lighting_green', 'lighting_blue',
        'pump_speed', 'pump_pressure', 'solenoid_open', 'solenoid_duration',
        'fire_trigger', 'fire_intensity', 'fog_density', 'laser_intensity',
        'laser_pattern', 'device_enable', 'device_intensity',
        'motion_intensity', 'motion_angle', 'motion_pan', 'motion_tilt',
        'ai_generated', 'lighting'
    }
    
    unknown_types = set()
    for clip in clips_dict:
        clip_type = clip.get('type', '')
        if clip_type and clip_type not in known_types:
            unknown_types.add(clip_type)
    
    if unknown_types:
        warnings.append({
            'type': 'unknown_track_type',
            'message': f'Unknown track types found: {", ".join(unknown_types)}',
            'types': list(unknown_types)
        })
    
    # 7. Empty show warning (already added above)
    
    # 8. Estimated show duration
    if clips_dict:
        max_end = max((c.get('startTime', 0) + c.get('duration', 0)) for c in clips_dict)
        estimated_duration = max(max_end, 0)
    else:
        estimated_duration = 0
    
    # Statistics
    total_tracks = len(set(c.get('trackId') for c in clips_dict if c.get('trackId')))
    total_effects = sum(len(c.get('effects', [])) for c in clips_dict)
    clips_with_effects = len([c for c in clips_dict if c.get('effects')])
    
    # Track type distribution
    track_type_counts = {}
    for clip in clips_dict:
        clip_type = clip.get('type', 'unknown')
        track_type_counts[clip_type] = track_type_counts.get(clip_type, 0) + 1
    
    return {
        "success": True,
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "estimatedDuration": round(estimated_duration, 2),
        "overlapCount": len(overlaps),
        "unsupportedTrackTypes": list(unknown_types),
        "stats": {
            "totalClips": len(clips_dict),
            "totalTracks": total_tracks,
            "estimatedDurationSeconds": round(estimated_duration, 2),
            "formattedDuration": f"{int(estimated_duration // 60)}:{int(estimated_duration % 60):02d}" if estimated_duration > 0 else "0:00",
            "totalEffects": total_effects,
            "clipsWithEffects": clips_with_effects,
            "clipsWithoutEffects": len(clips_dict) - clips_with_effects,
            "trackTypeDistribution": track_type_counts,
            "errorCount": len(errors),
            "warningCount": len(warnings)
        }
    }


# ============================================================
# SHOW STORAGE ENDPOINTS (Existing - keep as is)
# ============================================================

@show_programmer_router.post("/shows/save")
async def save_show_endpoint(
    show_data: Dict,
    name: str = Form(...),
):
    """Save a show to persistent storage."""
    show_id = str(uuid.uuid4())
    file_path = UPLOAD_DIR / f"show_{show_id}.json"
    
    with open(file_path, "w") as f:
        json.dump({
            "id": show_id,
            "name": name,
            "data": show_data,
            "saved_at": datetime.utcnow().isoformat(),
        }, f, indent=2)
    
    return {"show_id": show_id, "name": name}


@show_programmer_router.get("/shows/list")
async def list_shows_endpoint():
    """List all saved shows."""
    shows = []
    for file_path in UPLOAD_DIR.glob("show_*.json"):
        try:
            with open(file_path) as f:
                data = json.load(f)
                shows.append({
                    "id": data.get("id"),
                    "name": data.get("name"),
                    "saved_at": data.get("saved_at"),
                })
        except Exception:
            continue
    
    return {"shows": sorted(shows, key=lambda x: x.get("saved_at", ""), reverse=True)}


@show_programmer_router.get("/shows/{show_id}")
async def load_show_endpoint(show_id: str):
    """Load a saved show."""
    file_path = UPLOAD_DIR / f"show_{show_id}.json"
    if not file_path.exists():
        raise HTTPException(404, "Show not found")
    
    with open(file_path) as f:
        data = json.load(f)
    
    return data
# ============================================================
# AUTOSAVE ENDPOINTS
# ============================================================

@show_programmer_router.post("/autosave")
async def create_autosave_endpoint(request: AutosaveCreateRequest):
    try:
        result = create_autosave(
            request.sessionId,
            request.programData,
            request.programId,
            request.programName
        )
        
        if not result["success"]:
            return {
                "success": False,
                "error": result["error"],
                "autosaveId": None,
                "timestamp": None
            }
        
        return {
            "success": True,
            "autosaveId": result["autosaveId"],
            "timestamp": result["timestamp"],
            "clipCount": result["clipCount"],
            "checksum": result["checksum"],
            "message": result["message"]
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Server error: {str(e)}",
            "autosaveId": None,
            "timestamp": None,
            "clipCount": 0,
            "checksum": None,
            "message": "Autosave failed due to server error"
        }


@show_programmer_router.get("/recovery")
async def get_recovery_autosave(sessionId: str):
    """
    Get the latest autosave for a session
    """
    try:
        result = get_latest_autosave(sessionId)
        
        return {
            "found": result.get("found", False),
            "autosave": result.get("autosave"),
            "autosaveCount": result.get("autosaveCount", 0),
            "latestTimestamp": result.get("latestTimestamp"),
            "error": result.get("error")
        }
        
    except Exception as e:
        return {
            "found": False,
            "autosave": None,
            "autosaveCount": 0,
            "latestTimestamp": None,
            "error": f"Recovery lookup failed: {str(e)}"
        }


@show_programmer_router.delete("/autosave/cleanup")
async def cleanup_autosaves_endpoint():
    """Manually trigger autosave cleanup"""
    try:
        deleted = _cleanup_old_autosaves()
        return {
            "success": True,
            "deleted": deleted,
            "kept": MAX_AUTOSAVES,
            "message": f"Cleaned up {deleted} old autosaves"
        }
    except Exception as e:
        return {
            "deleted": 0,
            "kept": MAX_AUTOSAVES,
            "message": f"Cleanup failed: {str(e)}"
        }


@show_programmer_router.get("/autosave/list")
async def list_autosaves_endpoint(sessionId: str = None):
    """List all autosaves, optionally filtered by session"""
    try:
        autosaves = list_all_autosaves(sessionId)
        return {
            "success": True,
            "autosaves": autosaves,
            "count": len(autosaves)
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "autosaves": []
        }
# ============================================================
# AFShow EXPORT/IMPORT ENDPOINTS
# ============================================================

@show_programmer_router.post("/export/afshow")
async def export_afshow(program_id: str):
    """
    Export a saved program to .afshow format.
    
    Returns the complete show file with schema validation and checksum.
    """
    # Load program from storage
    file_path = PROGRAMS_DIR / f"{program_id}.json"
    if not file_path.exists():
        raise HTTPException(404, f"Program '{program_id}' not found")
    
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            program_data = json.load(f)
    except Exception as e:
        raise HTTPException(500, f"Failed to load program: {str(e)}")
    
    # Build metadata
    metadata = MetadataV1(
        title=program_data.get('name', 'Untitled Show'),
        author=None,
        description=None,
        duration=program_data.get('audioDuration', 0),
        bpm=program_data.get('bpm', 120),
        tags=[],
        notes=None
    )
    
    # Convert timeline clips
    clips = []
    for clip in program_data.get('timelineClips', []):
        try:
            clips.append(ClipV1(
                id=clip.get('id', f"clip_{len(clips)}"),
                name=clip.get('name', 'Untitled'),
                type=clip.get('type', 'unknown'),
                trackId=clip.get('trackId', ''),
                fixtureId=clip.get('fixtureId'),
                fixtures=clip.get('fixtures', []),
                startTime=clip.get('startTime', 0),
                duration=clip.get('duration', 1),
                value=clip.get('value', 100),
                color=clip.get('color', '#00b7ff'),
                fadeIn=clip.get('fadeIn', 0),
                fadeOut=clip.get('fadeOut', 0),
                curveType=clip.get('curveType', 'linear'),
                effects=[EffectV1(**e) for e in clip.get('effects', [])],
                locked=clip.get('locked', False),
                muted=clip.get('muted', False),
                pan=clip.get('pan', 0),
                tilt=clip.get('tilt', 0),
                angle=clip.get('angle', 0),
                r=clip.get('r', 255),
                g=clip.get('g', 255),
                b=clip.get('b', 255)
            ))
        except Exception as e:
            raise HTTPException(400, f"Invalid clip data: {str(e)}")
    
    # Convert beat markers
    beat_markers = []
    for marker in program_data.get('beatMarkers', []):
        try:
            beat_markers.append(BeatMarkerV1(
                time=marker.get('time', 0),
                bpm=marker.get('bpm', 120),
                label=marker.get('label')
            ))
        except Exception as e:
            raise HTTPException(400, f"Invalid beat marker: {str(e)}")
    
    # Convert cues
    cues = []
    for cue in program_data.get('cues', []):
        try:
            cues.append(CueV1(
                id=cue.get('id', f"cue_{len(cues)}"),
                number=cue.get('number', len(cues) + 1),
                label=cue.get('label', 'Cue'),
                time=cue.get('time', 0),
                color=cue.get('color', '#00d4ff')
            ))
        except Exception as e:
            raise HTTPException(400, f"Invalid cue: {str(e)}")
    
    # Create header (temporary without checksum)
    now = datetime.utcnow().isoformat()
    header_data = {
        "magic": AFSHOW_MAGIC_BYTES,
        "version": AFSHOW_SCHEMA_VERSION,
        "createdAt": program_data.get('createdAt', now),
        "updatedAt": now,
        "checksum": "",  # Placeholder
        "fileSize": 0    # Placeholder
    }
    
    # Create full show object
    show = AFShowV1(
        header=AFShowHeaderV1(**header_data),
        metadata=metadata,
        timelineClips=clips,
        beatMarkers=beat_markers,
        cues=cues,
        zoom=program_data.get('zoom', 80),
        audioDuration=program_data.get('audioDuration', 0)
    )
    
    # Calculate checksum using the AFShow schema method.
    # This must exclude the header so export and import validation match.
    checksum = show.calculate_checksum()

    # Update header with checksum, then calculate final file size.
    show.header.checksum = checksum
    final_show_json = show.to_json()
    show.header.fileSize = len(final_show_json.encode('utf-8'))
    
    # Save to file
    export_filename = f"{program_data.get('name', 'show')}_{program_id}{AFSHOW_FILE_EXTENSION}"
    export_path = UPLOAD_DIR / export_filename
    
    with open(export_path, 'w', encoding='utf-8') as f:
        f.write(show.to_json())
    
    # Return file for download
    from fastapi.responses import FileResponse
    return FileResponse(
        path=export_path,
        filename=export_filename,
        media_type='application/json'
    )


@show_programmer_router.post("/import/afshow")
async def import_afshow(
    file: UploadFile = File(...),
    validate_only: bool = False
):
    """
    Import an .afshow file.
    
    Validates schema, checksum, and returns the imported program data.
    If validate_only is True, only validates without importing.
    """
    # Check file extension
    if not file.filename.endswith(AFSHOW_FILE_EXTENSION):
        raise HTTPException(400, f"Invalid file extension. Expected {AFSHOW_FILE_EXTENSION}")
    
    # Save uploaded file temporarily
    temp_path = UPLOAD_DIR / f"temp_{uuid.uuid4().hex}{AFSHOW_FILE_EXTENSION}"
    content = await file.read()
    
    with open(temp_path, 'wb') as f:
        f.write(content)
    
    try:
        # Validate the file
        validation = AFShowValidator.validate_file(temp_path)
        
        if not validation['valid']:
            # Clean up temp file
            temp_path.unlink()
            raise HTTPException(400, f"Invalid AFShow file: {', '.join(validation['errors'])}")
        
        if validate_only:
            # Clean up temp file
            temp_path.unlink()
            return {
                "valid": True,
                "warnings": validation['warnings'],
                "schema_version": validation['schema_version'],
                "stats": {
                    "total_clips": len(validation['data'].get('timelineClips', [])),
                    "total_cues": len(validation['data'].get('cues', [])),
                    "total_beat_markers": len(validation['data'].get('beatMarkers', [])),
                    "duration": validation['data'].get('audioDuration', 0)
                }
            }
        
        # Convert imported data to program format
        imported_data = validation['data']
        
        # Generate new program ID
        program_id = str(uuid.uuid4())[:8]
        now = datetime.utcnow().isoformat()
        
        # Build program data
        program_data = {
            "program_id": program_id,
            "name": imported_data['metadata']['title'],
            "timelineClips": imported_data['timelineClips'],
            "beatMarkers": imported_data['beatMarkers'],
            "cues": imported_data['cues'],
            "audioDuration": imported_data['audioDuration'],
            "zoom": imported_data['zoom'],
            "bpm": imported_data['metadata']['bpm'],
            "createdAt": now,
            "updatedAt": now,
            "version": "aquaflow-show-programmer-v1",
            "imported_from": file.filename,
            "original_schema": validation['schema_version']
        }
        
        # Save to programs directory
        save_path = PROGRAMS_DIR / f"{program_id}.json"
        with open(save_path, 'w', encoding='utf-8') as f:
            json.dump(program_data, f, indent=2, ensure_ascii=False)
        
        # Clean up temp file
        temp_path.unlink()
        
        return {
            "success": True,
            "program_id": program_id,
            "name": imported_data['metadata']['title'],
            "imported_at": now,
            "schema_version": validation['schema_version'],
            "warnings": validation['warnings'],
            "stats": {
                "clips": len(imported_data['timelineClips']),
                "cues": len(imported_data['cues']),
                "beat_markers": len(imported_data['beatMarkers']),
                "duration": imported_data['audioDuration']
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        # Clean up temp file if it exists
        if temp_path.exists():
            temp_path.unlink()
        raise HTTPException(500, f"Import failed: {str(e)}")

# ============================================================
# AUTOSAVE HELPER FUNCTIONS
# ============================================================

def _compute_checksum(data: Dict[str, Any]) -> str:
    """Compute SHA256 checksum of program data"""
    data_string = json.dumps(data, sort_keys=True)
    return hashlib.sha256(data_string.encode()).hexdigest()


def _validate_autosave_data(program_data: Dict[str, Any]) -> Dict:
    """Validate program data before autosaving"""
    try:
        if not program_data:
            return {"valid": False, "error": "Program data is empty or None"}
        
        if not isinstance(program_data, dict):
            return {"valid": False, "error": "Program data must be a dictionary"}
        
        # Check for required fields
        if 'timelineClips' not in program_data:
            return {"valid": False, "error": "Missing timelineClips in program data"}
        
        try:
            json.dumps(program_data)
        except (TypeError, ValueError) as e:
            return {"valid": False, "error": f"Program data is not JSON serializable: {str(e)}"}
        
        return {"valid": True}
        
    except Exception as e:
        return {"valid": False, "error": f"Validation error: {str(e)}"}


def _safe_write_autosave(autosave_data: Dict) -> tuple:
    """Safely write autosave with corruption protection"""
    autosave_path = None
    temp_path = None
    try:
        autosave_id = autosave_data['metadata']['autosaveId']
        autosave_path = AUTOSAVE_DIR / f"{autosave_id}.json"
        temp_path = AUTOSAVE_DIR / f"{autosave_id}.tmp"
        
        # Write to temp file first
        with open(temp_path, 'w', encoding='utf-8') as f:
            json.dump(autosave_data, f, indent=2, default=str)
        
        # Verify the temp file is readable
        with open(temp_path, 'r', encoding='utf-8') as f:
            test_load = json.load(f)
            if not test_load:
                raise ValueError("Temp file verification failed")
        
        # Replace with atomic operation
        temp_path.replace(autosave_path)
        
        return True, None
        
    except Exception as e:
        if temp_path and temp_path.exists():
            temp_path.unlink()
        return False, str(e)


def create_autosave(sessionId: str, programData: Dict, programId: str = None, programName: str = None) -> Dict:
    """Create an autosave of current program state"""
    try:
        # Validate incoming data
        validation = _validate_autosave_data(programData)
        if not validation['valid']:
            return {
                "success": False,
                "error": validation['error'],
                "autosaveId": None
            }
        
        # Compute clip count
        clip_count = len(programData.get('timelineClips', []))
        
        # Generate autosave ID and checksum
        autosave_id = str(uuid.uuid4())
        checksum = _compute_checksum(programData)
        timestamp = datetime.now().isoformat()
        
        # Create metadata
        metadata = {
            "autosaveId": autosave_id,
            "timestamp": timestamp,
            "sessionId": sessionId,
            "clipCount": clip_count,
            "checksum": checksum,
            "programId": programId,
            "programName": programName
        }
        
        # Create full autosave object
        autosave_data = {
            "metadata": metadata,
            "programData": programData
        }
        
        # Safely write to disk
        success, error = _safe_write_autosave(autosave_data)
        
        if not success:
            return {
                "success": False,
                "error": f"Failed to write autosave: {error}",
                "autosaveId": None
            }
        
        # Cleanup old autosaves
        deleted_count = _cleanup_old_autosaves()
        
        return {
            "success": True,
            "autosaveId": autosave_id,
            "timestamp": timestamp,
            "clipCount": clip_count,
            "checksum": checksum,
            "cleanupDeleted": deleted_count,
            "message": f"Autosave created successfully. Cleaned up {deleted_count} old autosaves."
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": f"Unexpected error: {str(e)}",
            "autosaveId": None
        }


def get_latest_autosave(sessionId: str) -> Dict:
    """Get the latest autosave for a session"""
    try:
        # Get all autosave files for this session
        autosave_files = []
        for file_path in AUTOSAVE_DIR.glob("*.json"):
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    if data.get('metadata', {}).get('sessionId') == sessionId:
                        autosave_files.append((file_path, data))
            except (json.JSONDecodeError, KeyError, Exception):
                # Skip corrupted files
                continue
        
        if not autosave_files:
            return {"found": False, "autosave": None, "autosaveCount": 0, "latestTimestamp": None}
        
        # Sort by timestamp (newest first)
        autosave_files.sort(
            key=lambda x: x[1].get('metadata', {}).get('timestamp', ''),
            reverse=True
        )
        
        latest_file_path, latest_data = autosave_files[0]
        
        # Verify checksum
        program_data = latest_data.get('programData', {})
        stored_checksum = latest_data.get('metadata', {}).get('checksum', '')
        actual_checksum = _compute_checksum(program_data)
        
        checksum_match = (stored_checksum == actual_checksum)
        
        latest_timestamp = latest_data.get('metadata', {}).get('timestamp')
        
        if not checksum_match:
            return {
                "found": False,
                "autosave": None,
                "autosaveCount": len(autosave_files),
                "latestTimestamp": latest_timestamp,
                "error": "Checksum mismatch - data corrupted"
            }
        
        return {
            "found": True,
            "autosave": latest_data,
            "autosaveCount": len(autosave_files),
            "latestTimestamp": latest_timestamp
        }
        
    except Exception as e:
        return {
            "found": False,
            "autosave": None,
            "error": str(e)
        }


def _cleanup_old_autosaves() -> int:
    """Keep only the latest MAX_AUTOSAVES files"""
    try:
        # Get all autosave files with their timestamps
        autosave_files = []
        for file_path in AUTOSAVE_DIR.glob("*.json"):
            try:
                with open(file_path, 'r') as f:
                    data = json.load(f)
                    timestamp_str = data.get('metadata', {}).get('timestamp')
                    if timestamp_str:
                        timestamp = datetime.fromisoformat(timestamp_str)
                    else:
                        timestamp = datetime.fromtimestamp(file_path.stat().st_mtime)
            except Exception:
                try:
                    timestamp = datetime.fromtimestamp(file_path.stat().st_mtime)
                except Exception:
                    continue
            
            autosave_files.append((file_path, timestamp))
        
        # Sort by timestamp (newest first)
        autosave_files.sort(key=lambda x: x[1], reverse=True)
        
        # Delete older files beyond MAX_AUTOSAVES
        deleted_count = 0
        for file_path, _ in autosave_files[MAX_AUTOSAVES:]:
            try:
                file_path.unlink()
                deleted_count += 1
            except Exception:
                pass
        
        return deleted_count
        
    except Exception as e:
        return 0


def list_all_autosaves(sessionId: str = None) -> List[Dict]:
    """List all autosaves, optionally filtered by sessionId"""
    autosaves = []
    
    for file_path in AUTOSAVE_DIR.glob("*.json"):
        try:
            with open(file_path, 'r') as f:
                data = json.load(f)
                
                if sessionId and data.get('metadata', {}).get('sessionId') != sessionId:
                    continue
                
                autosaves.append({
                    "autosaveId": data.get('metadata', {}).get('autosaveId'),
                    "timestamp": data.get('metadata', {}).get('timestamp'),
                    "sessionId": data.get('metadata', {}).get('sessionId'),
                    "clipCount": data.get('metadata', {}).get('clipCount'),
                    "programName": data.get('metadata', {}).get('programName')
                })
        except Exception:
            continue
    
    # Sort by timestamp descending
    autosaves.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    return autosaves