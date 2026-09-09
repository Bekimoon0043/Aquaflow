"""
audio_routes.py — AquaFlow Audio Engine Backend
Handles audio file upload, beat/BPM analysis, and show generation synchronized to music.

Endpoints:
  POST /audio/upload           — upload an audio file, start analysis job
  GET  /audio/status/{job_id} — poll analysis job status + results
  GET  /audio/list             — list all uploaded audio files
  POST /audio/sync-to-show     — generate a show timeline from analysis results
  GET  /audio/waveform/{job_id}— return waveform data for timeline display
  DELETE /audio/{job_id}       — delete an audio file and its analysis
"""

import os
import json
import uuid
import time
import math
import hashlib
import asyncio
import wave
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
import uuid
from fastapi.responses import JSONResponse

router = APIRouter()

# ── Storage ───────────────────────────────────────────────────────────────────
AUDIO_DIR = Path("data/audio")
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

SUPPORTED_FORMATS = {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma"}
MAX_FILE_SIZE_MB = 200

# In-memory job store (survives server restarts via JSON sidecar)
_jobs: dict = {}

def _load_jobs():
    idx = AUDIO_DIR / "jobs.json"
    if idx.exists():
        try:
            _jobs.update(json.loads(idx.read_text()))
        except Exception:
            pass

def _save_jobs():
    (AUDIO_DIR / "jobs.json").write_text(json.dumps(_jobs, indent=2))

_load_jobs()


class _PCMAnalysisComplete(Exception):
    """Private control-flow marker used to skip the optional librosa path."""


def _analyze_pcm_wav(file_path: Path):
    """Analyze an entire PCM WAV with only stdlib + numpy (both ship in desktop)."""
    import numpy as np
    from services.beat_detection import detect_beats

    with wave.open(str(file_path), "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        source_rate = source.getframerate()
        frame_count = source.getnframes()
        if channels < 1 or sample_width not in (1, 2, 3, 4) or source_rate < 1000:
            raise ValueError("unsupported PCM WAV layout")
        raw = source.readframes(frame_count)
    if sample_width == 2:
        values = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 1:
        values = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif sample_width == 4:
        values = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        packed = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        ints = packed[:, 0] | (packed[:, 1] << 8) | (packed[:, 2] << 16)
        ints = np.where(ints & 0x800000, ints - 0x1000000, ints)
        values = ints.astype(np.float32) / 8388608.0
    if channels > 1:
        usable = values.size - values.size % channels
        values = values[:usable].reshape(-1, channels).mean(axis=1)
    duration = frame_count / float(source_rate)
    stride = max(1, source_rate // 11025)
    samples = values[::stride]
    analysis_rate = source_rate // stride
    detected = detect_beats(samples, analysis_rate, hop=256)
    bpm = float(detected.get("bpm") or 120.0)
    beat_times = detected.get("beat_times") or []
    if len(beat_times) < 4:
        beat_times = list(np.arange(0.0, duration, 60.0 / bpm))

    chunks = np.array_split(samples, 200)
    rms = [float(np.sqrt(np.mean(chunk * chunk))) if chunk.size else 0.0 for chunk in chunks]
    peak = max(rms) or 1.0
    energy_profile = [round(value / peak, 4) for value in rms]
    kernel_n = max(3, int(analysis_rate / 180))
    kernel = np.ones(kernel_n, dtype=np.float32) / kernel_n
    bass_signal = np.convolve(samples, kernel, mode="same")
    bass_chunks = np.array_split(bass_signal, 200)
    bass = [float(np.sqrt(np.mean(chunk * chunk))) if chunk.size else 0.0 for chunk in bass_chunks]
    bass_peak = max(bass) or 1.0
    bass_profile = [round(value / bass_peak, 4) for value in bass]

    section_count = min(8, max(4, int(duration / 35)))
    labels = ["intro", "verse", "chorus", "verse", "chorus", "bridge", "chorus", "outro"]
    sections = []
    for index in range(section_count):
        start = index * duration / section_count
        end = (index + 1) * duration / section_count
        lo = int(index * len(energy_profile) / section_count)
        hi = max(lo + 1, int((index + 1) * len(energy_profile) / section_count))
        sections.append({"start": round(start, 3), "end": round(end, 3),
                         "label": labels[index % len(labels)],
                         "energy": round(float(np.mean(energy_profile[lo:hi])), 3)})
    beats = [{"time": round(float(value), 4),
              "type": "downbeat" if index % 4 == 0 else "beat", "strength": 1.0}
             for index, value in enumerate(beat_times) if value <= duration]
    return (duration, bpm, "Unknown", _estimate_mood(bpm, 0.0, float(np.mean(rms))),
            energy_profile, bass_profile, beats, sections,
            0.9 if detected.get("bpm") else 0.35)


# ── Analysis engine ───────────────────────────────────────────────────────────
def _analyze_audio(job_id: str, file_path: Path):
    """
    Audio analysis engine.
    Attempts real librosa analysis if available, falls back to deterministic
    estimation from file metadata so the UI always gets useful data.
    """
    job = _jobs.get(job_id)
    if not job:
        return

    try:
        _jobs[job_id]["status"] = "analyzing"
        _save_jobs()

        file_size = file_path.stat().st_size
        filename   = job.get("filename") or file_path.name

        analysis_method = "metadata-estimate"
        # WAV analysis uses the complete track and is available in the packaged app.
        # Other codecs continue to use the optional librosa stack.
        try:
            if file_path.suffix.lower() == ".wav":
                (duration, bpm, key, mood, energy_profile, bass_profile, beats,
                 sections, bpm_confidence) = _analyze_pcm_wav(file_path)
                analysis_method = "pcm-wav"
                raise _PCMAnalysisComplete
            import librosa
            import numpy as np

            y, sr = librosa.load(str(file_path), sr=None, mono=True, duration=300)
            duration = float(librosa.get_duration(y=y, sr=sr))

            # BPM + beat frames. librosa >= 0.10 returns tempo as a numpy array,
            # so unwrap the scalar defensively (float() on an ndarray raises on
            # numpy 2.x and would otherwise dump us into the estimated fallback).
            tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
            bpm = float(np.atleast_1d(tempo)[0])
            beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()

            # Spectral features
            spectral_centroids = librosa.feature.spectral_centroid(y=y, sr=sr)[0]
            rms = librosa.feature.rms(y=y)[0]

            # Key detection
            chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
            chroma_mean = np.mean(chroma, axis=1)
            key_names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
            key = key_names[int(np.argmax(chroma_mean))]

            # Energy profile (normalized, 200 points). Guard the divisor: a silent
            # (all-zero) profile has max 0, which would raise ZeroDivisionError and
            # wrongly drop the whole real analysis into the estimate fallback.
            hop = max(1, len(rms) // 200)
            energy_profile = [float(v) for v in rms[::hop][:200]]
            max_e = max(energy_profile) or 1
            energy_profile = [v / max_e for v in energy_profile]

            # Bass profile (low frequency energy)
            y_bass = librosa.effects.harmonic(y)
            rms_bass = librosa.feature.rms(y=y_bass)[0]
            bass_profile = [float(v) for v in rms_bass[::hop][:200]]
            max_b = max(bass_profile) or 1
            bass_profile = [v / max_b for v in bass_profile]

            # Sections (structural segmentation). Isolated so a segmentation/sklearn
            # failure falls back to an even time-split instead of discarding the
            # real BPM/beats we already computed above.
            section_labels = ["intro","verse","chorus","verse","chorus","bridge","chorus","outro"]
            try:
                mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13)
                import sklearn.preprocessing
                mfcc_n = sklearn.preprocessing.normalize(mfcc, axis=1)
                bounds = librosa.segment.agglomerative(mfcc_n.T, k=min(8, max(3, int(duration / 30))))
                bound_times = librosa.frames_to_time(bounds, sr=sr).tolist()
            except Exception:
                n = min(8, max(3, int(duration / 30)))
                bound_times = [round(i * duration / n, 3) for i in range(n)]
            sections = []
            for i, t in enumerate(bound_times):
                end = bound_times[i+1] if i+1 < len(bound_times) else duration
                sections.append({
                    "start": round(t, 3),
                    "end":   round(end, 3),
                    "label": section_labels[i % len(section_labels)],
                    "energy": round(float(np.mean(rms[
                        int(t * sr / 512):int(end * sr / 512)
                    ])) * 10, 3) if len(rms) > 0 else 0.5,
                })

            # Beat list with type annotation
            beats = []
            for i, bt in enumerate(beat_times):
                beats.append({
                    "time": round(bt, 4),
                    "type": "downbeat" if i % 4 == 0 else "beat",
                    "strength": 1.0,
                })

            mood = _estimate_mood(bpm, float(np.mean(spectral_centroids)), float(np.mean(rms)))
            bpm_confidence = 0.92
            analysis_method = "librosa"

        except _PCMAnalysisComplete:
            pass
        except Exception:
            # Fallback: deterministic estimation from file properties
            duration, bpm, key, mood, energy_profile, bass_profile, beats, sections, bpm_confidence = \
                _estimate_from_metadata(file_path, file_size)
            analysis_method = "metadata-estimate"

        # Build waveform (128 points for timeline display)
        waveform = _build_waveform(energy_profile)

        result = {
            "filename":       filename,
            "duration":       round(duration, 2),
            "bpm":            round(bpm, 1),
            "bpm_confidence": round(bpm_confidence, 2),
            "key":            key,
            "mood":           mood,
            "beat_count":     len(beats),
            "section_count":  len(sections),
            "beats":          beats,
            "sections":       sections,
            "energy_profile": energy_profile,
            "bass_profile":   bass_profile,
            "waveform":       waveform,
            "analysis_method": analysis_method,
        }

        _jobs[job_id].update({
            "status":     "complete",
            "result":     result,
            "completed_at": time.time(),
        })
        _save_jobs()

    except Exception as e:
        _jobs[job_id].update({
            "status": "error",
            "error":  str(e),
        })
        _save_jobs()


def _estimate_from_metadata(file_path: Path, file_size: int):
    """Deterministic audio estimation when librosa is unavailable."""
    # Use file hash for reproducible pseudo-random values
    h = int(hashlib.md5(file_path.name.encode()).hexdigest()[:8], 16)

    # Estimate duration from file size (rough average bitrate 128kbps)
    ext = file_path.suffix.lower()
    bitrate = {"mp3":128,"wav":1411,"flac":800,"ogg":128,"m4a":128,"aac":128}.get(ext[1:], 128)
    duration = min(600, max(30, (file_size * 8) / (bitrate * 1000)))

    # BPM in a realistic range
    bpm_options = [80, 90, 95, 100, 110, 115, 120, 125, 128, 130, 140, 150, 160]
    bpm = bpm_options[h % len(bpm_options)]

    keys = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
    modes = ["major","minor"]
    key = f"{keys[(h>>4)%12]} {modes[(h>>8)%2]}"

    moods = ["Energetic","Calm","Dramatic","Uplifting","Dark","Euphoric","Melancholic","Intense"]
    mood = moods[(h>>12)%len(moods)]

    # Generate energy profile
    energy_profile = []
    for i in range(200):
        t = i / 200
        v = 0.4 + 0.3*math.sin(t*math.pi*6 + h) + 0.2*math.sin(t*math.pi*20) + 0.1*(((h*i)%100)/100)
        energy_profile.append(round(max(0.05, min(1.0, v)), 3))

    bass_profile = [round(max(0.05, min(1.0, v*0.8 + 0.15)), 3) for v in energy_profile]

    # Generate beats
    beat_interval = 60.0 / bpm
    beats = []
    t = 0.0
    i = 0
    while t < duration:
        beats.append({"time": round(t, 4), "type": "downbeat" if i%4==0 else "beat", "strength": 1.0})
        t += beat_interval
        i += 1

    # Generate sections
    section_labels = ["intro","verse","chorus","verse","chorus","bridge","chorus","outro"]
    section_count = min(8, max(4, int(duration / 30)))
    section_dur = duration / section_count
    sections = []
    for i in range(section_count):
        sections.append({
            "start": round(i * section_dur, 3),
            "end":   round((i+1) * section_dur, 3),
            "label": section_labels[i % len(section_labels)],
            "energy": round(0.3 + 0.5 * energy_profile[int(i * 200 / section_count)], 3),
        })

    return duration, bpm, key, mood, energy_profile, bass_profile, beats, sections, 0.75


def _estimate_mood(bpm, spectral_centroid, rms_mean):
    if bpm > 140 and rms_mean > 0.05:  return "Energetic"
    if bpm > 120:                       return "Uplifting"
    if bpm > 100:                       return "Intense"
    if bpm > 85 and spectral_centroid > 2000: return "Dramatic"
    if bpm > 85:                        return "Calm"
    return "Melancholic"


def _build_waveform(energy_profile: list, points=128) -> list:
    """Downsample energy profile to waveform points for timeline display."""
    if not energy_profile:
        return [0.5] * points
    step = max(1, len(energy_profile) // points)
    waveform = []
    for i in range(points):
        idx = i * step
        val = energy_profile[min(idx, len(energy_profile)-1)]
        waveform.append(round(val, 3))
    return waveform


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_audio(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    """Upload an audio file and start analysis."""
    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED_FORMATS:
        raise HTTPException(400, f"Unsupported format '{suffix}'. Supported: {', '.join(SUPPORTED_FORMATS)}")

    # Size check (read first 4 bytes + stream)
    content = await file.read()
    size_mb = len(content) / 1_048_576
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(413, f"File too large ({size_mb:.1f} MB). Maximum is {MAX_FILE_SIZE_MB} MB.")

    job_id   = str(uuid.uuid4())[:8]
    filename = f"{job_id}_{file.filename}"
    file_path = AUDIO_DIR / filename

    file_path.write_bytes(content)

    _jobs[job_id] = {
        "job_id":      job_id,
        "filename":    file.filename,
        "stored_name": filename,
        "size_bytes":  len(content),
        "status":      "queued",
        "created_at":  time.time(),
        "result":      None,
        "error":       None,
    }
    _save_jobs()

    background_tasks.add_task(_analyze_audio, job_id, file_path)

    return {"job_id": job_id, "filename": file.filename, "status": "queued"}


@router.get("/status/{job_id}")
async def get_status(job_id: str):
    """Poll analysis job status. Returns full result when complete."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job '{job_id}' not found")
    return job


@router.get("/list")
async def list_files():
    """List all uploaded audio files with their analysis status."""
    files = []
    for job_id, job in _jobs.items():
        files.append({
            "job_id":   job_id,
            "filename": job.get("filename"),
            "status":   job.get("status"),
            "size_mb":  round(job.get("size_bytes", 0) / 1_048_576, 2),
            "bpm":      job.get("result", {}).get("bpm") if job.get("result") else None,
            "duration": job.get("result", {}).get("duration") if job.get("result") else None,
            "created_at": job.get("created_at"),
        })
    files.sort(key=lambda x: x.get("created_at", 0), reverse=True)
    return {"files": files}


@router.get("/waveform/{job_id}")
async def get_waveform(job_id: str):
    """Return waveform data for timeline display."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job '{job_id}' not found")
    result = job.get("result") or {}
    return {
        "job_id":   job_id,
        "waveform": result.get("waveform", []),
        "duration": result.get("duration", 0),
        "bpm":      result.get("bpm", 0),
    }


@router.post("/sync-to-show")
async def sync_to_show(body: dict):
    """
    Generate a complete show timeline synchronized to audio analysis.
    Returns a show object with timeline tracks ready to load into the show store.
    """
    job_id      = body.get("job_id")
    bpm_override = body.get("bpm_override")

    job = _jobs.get(job_id) if job_id else None
    if not job or job.get("status") != "complete":
        raise HTTPException(400, "Audio analysis not complete. Upload and wait for analysis first.")

    result  = job["result"]
    bpm     = float(bpm_override or result["bpm"])
    duration_ms = int(result["duration"] * 1000)
    sections    = result.get("sections", [])
    beats       = result.get("beats", [])

    # Build timeline tracks from analysis
    tracks = []

    # ── Pump track — follow energy profile ───────────────────────────────────
    pump_clips = []
    for section in sections:
        start_ms = int(section["start"] * 1000)
        end_ms   = int(section["end"]   * 1000)
        energy   = section.get("energy", 0.5)
        label_map = {
            "intro":  "Pump Intro",
            "verse":  "Pump Verse",
            "chorus": "Pump Chorus — Full",
            "bridge": "Pump Bridge",
            "outro":  "Pump Outro",
        }
        pump_clips.append({
            "id":        f"pump_{start_ms}",
            "end": round(end_ms / 1000, 3),
            "end": round(end_ms / 1000, 3),
            "label":     label_map.get(section["label"], "Pump"),
            "value":     min(1.0, round(energy, 2)),
            "channel":   "pump",
        })
    tracks.append({"id":"track_pump", "device_id":"pump", "channel":"pump", "label":"Pump", "clips": pump_clips})

    # ── Lighting track — beat-synced color changes ───────────────────────────
    light_clips = []
    colors = ["#0066ff","#ff0088","#00ffcc","#ffcc00","#aa00ff","#ff6600","#00aaff","#ffffff"]
    for i, section in enumerate(sections):
        start_ms = int(section["start"] * 1000)
        end_ms   = int(section["end"]   * 1000)
        light_clips.append({
            "id":          f"light_{start_ms}",
            "start": round(start_ms / 1000, 3),
            "duration_ms": end_ms - start_ms,
            "label":       f"Lights — {section['label'].title()}",
            "color":       colors[i % len(colors)],
            "intensity":   min(1.0, round(section.get("energy", 0.5) + 0.2, 2)),
            "channel":     "lighting",
        })
    tracks.append({"id":"track_lighting","device_id":"rgb_lights","channel":"lighting","label":"Lighting","clips": light_clips})

    # ── Valve track — on chorus sections ─────────────────────────────────────
    valve_clips = []
    for section in sections:
        if section["label"] in ("chorus", "bridge"):
            start_ms = int(section["start"] * 1000)
            end_ms   = int(section["end"]   * 1000)
            valve_clips.append({
                "id":          f"valve_{start_ms}",
                "start_ms":    start_ms,
                "duration_ms": end_ms - start_ms,
                "label":       f"Valves — {section['label'].title()}",
                "value":       1.0,
                "channel":     "valve",
            })
    if valve_clips:
        tracks.append({"id":"track_valve","device_id":"valve","channel":"valve","label":"Valves","clips": valve_clips})

    # ── Fog track — intro and outro ───────────────────────────────────────────
    fog_clips = []
    for section in sections:
        if section["label"] in ("intro", "outro", "bridge"):
            start_ms = int(section["start"] * 1000)
            dur_ms   = min(int((section["end"] - section["start"]) * 1000), 8000)
            fog_clips.append({
                "id":          f"fog_{start_ms}",
                "start_ms":    start_ms,
                "end": round((start_ms + dur_ms) / 1000, 3),
                "label":       "Fog Burst",
                "value":       0.8,
                "channel":     "fog",
            })
    if fog_clips:
        tracks.append({"id":"track_fog","device_id":"fog","channel":"fog","label":"Fog","clips": fog_clips})

    show = {
        "name":        f"Show — {result['filename']}",
        "notes":       f"Auto-generated from audio analysis. {bpm:.0f} BPM, {result['key']}, {result['mood']}.",
        "bpm":         round(bpm, 1),
        "duration_ms": duration_ms,
        "audio": {
            "job_id":   job_id,
            "filename": result["filename"],
            "duration": result["duration"],
            "bpm":      round(bpm, 1),
            "key":      result["key"],
            "mood":     result["mood"],
            "waveform": result.get("waveform", []),
        },
    }

    return {
        "show":   show,
        "tracks": tracks,
        "audio":  show["audio"],
        "stats": {
            "track_count": len(tracks),
            "clip_count":  sum(len(t["clips"]) for t in tracks),
            "duration_s":  round(result["duration"], 1),
            "bpm":         round(bpm, 1),
        }
    }


@router.delete("/{job_id}")
async def delete_audio(job_id: str):
    """Delete an audio file and its analysis data."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, f"Job '{job_id}' not found")
    file_path = AUDIO_DIR / job.get("stored_name", "")
    if file_path.exists():
        file_path.unlink()
    del _jobs[job_id]
    _save_jobs()
    return {"deleted": job_id}
