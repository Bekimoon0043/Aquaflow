"""
AquaFlow AI Choreography Engine
Handles:
- Beat detection and audio analysis
- Text-to-show generation
- Pattern generation per device type
- Show enhancement suggestions
- Energy optimization
"""
import re
import json
import math
import random
import asyncio
import hashlib
from dataclasses import dataclass, field
from typing import Optional


# ── Data structures ────────────────────────────────────────────────────────────

@dataclass
class Beat:
    time: float
    strength: float  # 0.0 - 1.0
    type: str        # kick | snare | hihat | downbeat

@dataclass
class Section:
    start: float
    end: float
    label: str       # intro | verse | chorus | bridge | outro | drop
    energy: float    # 0.0 - 1.0

@dataclass
class AudioAnalysis:
    bpm: float
    beats: list[Beat]
    sections: list[Section]
    duration: float
    key: str
    mood: str        # energetic | calm | dramatic | playful | cinematic
    bass_profile: list[float]   # energy per second
    treble_profile: list[float]

@dataclass
class GeneratedClip:
    track_type: str  # pump | valve | lighting | flame | fog | laser
    start: float
    end: float
    intensity: int   # 0-100
    label: str
    color: Optional[str] = None
    params: dict = field(default_factory=dict)

@dataclass
class GeneratedShow:
    name: str
    bpm: float
    duration: float
    tracks: list[dict]
    notes: str


# ── Beat & Audio Analyzer ──────────────────────────────────────────────────────

class AudioAnalyzer:
    """
    Audio analysis engine.
    In production: uses librosa for real audio files.
    Currently provides deterministic analysis from BPM + duration parameters,
    and stub analysis for uploaded files.
    """

    def analyze_from_params(self, bpm: float, duration: float, mood: str = "energetic") -> AudioAnalysis:
        """Generate a synthetic audio analysis from BPM and duration"""
        beat_interval = 60.0 / bpm
        beats = []
        t = 0.0
        beat_num = 0
        while t < duration:
            # Determine beat type
            bar_pos = beat_num % 4
            if bar_pos == 0:
                btype = "downbeat"
                strength = 1.0
            elif bar_pos == 2:
                btype = "snare"
                strength = 0.8
            else:
                btype = "hihat"
                strength = 0.4 + random.random() * 0.2

            beats.append(Beat(time=round(t, 3), strength=strength, type=btype))
            t += beat_interval
            beat_num += 1

        sections = self._generate_sections(duration, mood)
        bass_profile  = self._generate_energy_profile(duration, sections, "bass")
        treble_profile = self._generate_energy_profile(duration, sections, "treble")

        moods = {
            "energetic": ("A minor", "energetic"),
            "calm":      ("C major", "calm"),
            "dramatic":  ("D minor", "dramatic"),
            "cinematic": ("G minor", "cinematic"),
            "playful":   ("E major", "playful"),
        }
        key, detected_mood = moods.get(mood, ("A minor", mood))

        return AudioAnalysis(
            bpm=bpm,
            beats=beats,
            sections=sections,
            duration=duration,
            key=key,
            mood=detected_mood,
            bass_profile=bass_profile,
            treble_profile=treble_profile,
        )

    def _generate_sections(self, duration: float, mood: str) -> list[Section]:
        """Divide show into musical sections"""
        if duration <= 60:
            structure = [
                ("intro",  0.0,  0.15, 0.3),
                ("verse",  0.15, 0.45, 0.6),
                ("chorus", 0.45, 0.75, 1.0),
                ("outro",  0.75, 1.0,  0.4),
            ]
        else:
            structure = [
                ("intro",   0.0,   0.10,  0.3),
                ("verse",   0.10,  0.25,  0.5),
                ("chorus",  0.25,  0.40,  0.9),
                ("verse",   0.40,  0.55,  0.55),
                ("drop",    0.55,  0.70,  1.0),
                ("bridge",  0.70,  0.82,  0.7),
                ("finale",  0.82,  0.93,  1.0),
                ("outro",   0.93,  1.0,   0.3),
            ]

        sections = []
        for label, start_pct, end_pct, energy in structure:
            sections.append(Section(
                start=round(start_pct * duration, 1),
                end=round(end_pct * duration, 1),
                label=label,
                energy=energy,
            ))
        return sections

    def _generate_energy_profile(self, duration: float, sections: list[Section], freq_type: str) -> list[float]:
        """Generate per-second energy profile"""
        profile = []
        for sec in range(int(duration)):
            # Find which section this second falls in
            section = next((s for s in sections if s.start <= sec < s.end), None)
            base = section.energy if section else 0.5
            # Add some variation
            noise = math.sin(sec * 0.7) * 0.1 + math.sin(sec * 1.3) * 0.05
            if freq_type == "bass":
                val = base * 0.9 + noise
            else:
                val = base * 0.7 + abs(noise) * 1.5
            profile.append(round(max(0.0, min(1.0, val)), 3))
        return profile


# ── Choreography Generator ─────────────────────────────────────────────────────

class ChoreographyGenerator:
    """
    Core AI choreography generator.
    Converts audio analysis + text prompt into timeline tracks with clips.
    """

    TRACK_COLORS = {
        "pump":     "#00d4ff",
        "valve":    "#8b5cf6",
        "lighting": "#f59e0b",
        "flame":    "#ef4444",
        "fog":      "#6b7280",
        "laser":    "#f97316",
    }

    def generate_from_analysis(
        self,
        analysis: AudioAnalysis,
        prompt: str = "",
        include_flame: bool = False,
        include_laser: bool = False,
        include_fog: bool = True,
    ) -> GeneratedShow:
        """Generate a full show from audio analysis + optional text prompt"""

        parsed = self._parse_prompt(prompt)
        tracks = []

        # Always generate pump + valve + lighting
        tracks.append(self._gen_pump_track(analysis, parsed))
        tracks.append(self._gen_valve_track(analysis, parsed))
        tracks.append(self._gen_lighting_track(analysis, parsed))

        if include_fog:
            tracks.append(self._gen_fog_track(analysis, parsed))
        if include_flame or parsed.get("flame"):
            tracks.append(self._gen_flame_track(analysis, parsed))
        if include_laser or parsed.get("laser"):
            tracks.append(self._gen_laser_track(analysis, parsed))

        # Determine show name
        name = parsed.get("name") or f"AI Show {analysis.bpm:.0f}BPM"

        notes = self._generate_notes(analysis, parsed, len(tracks))

        return GeneratedShow(
            name=name,
            bpm=analysis.bpm,
            duration=analysis.duration,
            tracks=tracks,
            notes=notes,
        )

    def _parse_prompt(self, prompt: str) -> dict:
        """Extract intent from natural language prompt"""
        p = prompt.lower()
        return {
            "aggressive":  any(w in p for w in ["aggressive", "powerful", "intense", "dramatic", "epic"]),
            "calm":        any(w in p for w in ["calm", "gentle", "soft", "peaceful", "ambient"]),
            "cinematic":   any(w in p for w in ["cinematic", "film", "movie", "grand"]),
            "synchronized": any(w in p for w in ["sync", "synchronized", "beat", "rhythm"]),
            "flame":       any(w in p for w in ["flame", "fire", "burst"]),
            "laser":       any(w in p for w in ["laser", "beam"]),
            "blue":        any(w in p for w in ["blue", "cyan", "cool", "water"]),
            "colorful":    any(w in p for w in ["color", "rainbow", "rgb", "colorful"]),
            "name":        self._extract_name(prompt),
        }

    def _extract_name(self, prompt: str) -> Optional[str]:
        for phrase in ["called", "named", "title"]:
            if phrase in prompt.lower():
                parts = prompt.lower().split(phrase)
                if len(parts) > 1:
                    return parts[1].strip().split()[0].title()
        return None

    def _gen_pump_track(self, analysis: AudioAnalysis, parsed: dict) -> dict:
        clips = []
        clip_id = 1000
        for section in analysis.sections:
            base_intensity = int(section.energy * 100)
            if parsed.get("aggressive"):
                base_intensity = min(100, int(base_intensity * 1.2))
            if parsed.get("calm"):
                base_intensity = max(20, int(base_intensity * 0.7))

            # Split section into clips based on beats
            beat_interval = 60.0 / analysis.bpm
            bars = max(1, int((section.end - section.start) / (beat_interval * 4)))
            bar_dur = (section.end - section.start) / bars

            for b in range(bars):
                start = round(section.start + b * bar_dur, 2)
                end   = round(start + bar_dur, 2)
                # Vary intensity within section
                variation = random.randint(-8, 8)
                intensity = max(10, min(100, base_intensity + variation))
                clips.append({
                    "id": f"ai-pump-{clip_id}",
                    "start": start, "end": end,
                    "intensity": intensity,
                    "label": section.label.title(),
                })
                clip_id += 1

        return {
            "id": "ai-track-pump",
            "label": "AI Pump Array",
            "type": "pump",
            "color": self.TRACK_COLORS["pump"],
            "deviceId": "pump-01",
            "clips": clips,
        }

    def _gen_valve_track(self, analysis: AudioAnalysis, parsed: dict) -> dict:
        clips = []
        clip_id = 2000
        beat_interval = 60.0 / analysis.bpm

        for section in analysis.sections:
            if section.energy < 0.2:
                continue  # No valves in very quiet sections
            # Generate valve bursts on downbeats
            t = section.start
            while t < section.end - beat_interval:
                # Burst on every downbeat or every 2 beats
                interval = beat_interval * (2 if section.energy < 0.6 else 1)
                burst_len = beat_interval * 0.8
                intensity = int(section.energy * 90 + random.randint(-5, 5))
                clips.append({
                    "id": f"ai-valve-{clip_id}",
                    "start": round(t, 2),
                    "end": round(min(t + burst_len, section.end), 2),
                    "intensity": max(20, min(100, intensity)),
                    "label": "Burst" if section.energy > 0.7 else "Flow",
                })
                clip_id += 1
                t += interval

        return {
            "id": "ai-track-valve",
            "label": "AI Solenoid Valves",
            "type": "valve",
            "color": self.TRACK_COLORS["valve"],
            "deviceId": "valve-01",
            "clips": clips,
        }

    def _gen_lighting_track(self, analysis: AudioAnalysis, parsed: dict) -> dict:
        clips = []
        clip_id = 3000

        section_colors = {
            "intro":   "Blue Wash",
            "verse":   "Soft Pulse",
            "chorus":  "Full Color",
            "drop":    "Strobe",
            "bridge":  "Color Sweep",
            "finale":  "Grand Finale",
            "outro":   "Fade Out",
        }

        for section in analysis.sections:
            label = section_colors.get(section.label, "Color Chase")
            intensity = int(section.energy * 100)
            if section.label in ("chorus", "drop", "finale"):
                intensity = min(100, intensity + 10)
            clips.append({
                "id": f"ai-light-{clip_id}",
                "start": section.start,
                "end": section.end,
                "intensity": intensity,
                "label": label,
            })
            clip_id += 1

        return {
            "id": "ai-track-lighting",
            "label": "AI RGB Lighting",
            "type": "lighting",
            "color": self.TRACK_COLORS["lighting"],
            "deviceId": "light-01",
            "clips": clips,
        }

    def _gen_flame_track(self, analysis: AudioAnalysis, parsed: dict) -> dict:
        clips = []
        clip_id = 4000
        # Flame only on highest energy moments
        for section in analysis.sections:
            if section.energy >= 0.85 or section.label in ("drop", "finale", "chorus"):
                mid = (section.start + section.end) / 2
                clips.append({
                    "id": f"ai-flame-{clip_id}",
                    "start": round(mid - 1.5, 2),
                    "end": round(mid + 1.5, 2),
                    "intensity": 100,
                    "label": "Flame Burst",
                })
                clip_id += 1

        return {
            "id": "ai-track-flame",
            "label": "AI Flame System",
            "type": "flame",
            "color": self.TRACK_COLORS["flame"],
            "deviceId": "flame-01",
            "clips": clips,
        }

    def _gen_fog_track(self, analysis: AudioAnalysis, parsed: dict) -> dict:
        clips = []
        clip_id = 5000
        for section in analysis.sections:
            if section.label in ("intro", "verse", "bridge", "outro"):
                clips.append({
                    "id": f"ai-fog-{clip_id}",
                    "start": section.start,
                    "end": section.end,
                    "intensity": int(section.energy * 60 + 20),
                    "label": "Atmospheric Fog",
                })
                clip_id += 1

        return {
            "id": "ai-track-fog",
            "label": "AI Fog System",
            "type": "fog",
            "color": self.TRACK_COLORS["fog"],
            "deviceId": "fog-01",
            "clips": clips,
        }

    def _gen_laser_track(self, analysis: AudioAnalysis, parsed: dict) -> dict:
        clips = []
        clip_id = 6000
        for section in analysis.sections:
            if section.energy > 0.6:
                clips.append({
                    "id": f"ai-laser-{clip_id}",
                    "start": section.start,
                    "end": section.end,
                    "intensity": int(section.energy * 100),
                    "label": "Laser Sweep",
                })
                clip_id += 1

        return {
            "id": "ai-track-laser",
            "label": "AI Laser Array",
            "type": "laser",
            "color": self.TRACK_COLORS["laser"],
            "deviceId": "laser-01",
            "clips": clips,
        }

    def _generate_notes(self, analysis: AudioAnalysis, parsed: dict, track_count: int) -> str:
        mood_desc = {
            "energetic": "high-energy performance",
            "calm": "gentle ambient display",
            "dramatic": "dramatic cinematic experience",
            "cinematic": "grand cinematic show",
            "playful": "playful interactive display",
        }.get(analysis.mood, "dynamic performance")

        return (
            f"Generated {track_count} tracks for a {mood_desc} at {analysis.bpm:.0f} BPM. "
            f"Show duration: {analysis.duration:.0f}s with {len(analysis.sections)} sections. "
            f"Key: {analysis.key}. "
            + ("Flame bursts added at peak moments. " if parsed.get("flame") else "")
            + ("Aggressive jet patterns applied. " if parsed.get("aggressive") else "")
            + ("Calm water patterns applied. " if parsed.get("calm") else "")
        )


# ── Suggestion Engine ──────────────────────────────────────────────────────────

class SuggestionEngine:
    """Analyzes an existing show and suggests improvements"""

    def suggest(self, tracks: list, bpm: float) -> list[str]:
        suggestions = []
        track_types = {t["type"] for t in tracks}

        if "flame" not in track_types:
            suggestions.append("Add flame bursts at chorus sections for dramatic effect")
        if "fog" not in track_types:
            suggestions.append("Add atmospheric fog during intro and outro sections")
        if "laser" not in track_types:
            suggestions.append("Laser beams during high-energy sections would enhance visual impact")

        for track in tracks:
            if track["type"] == "pump" and track.get("clips"):
                intensities = [c["intensity"] for c in track["clips"]]
                if max(intensities) < 80:
                    suggestions.append(f"Increase pump intensity peaks — current max is {max(intensities)}%")
                if min(intensities) > 50:
                    suggestions.append("Add low-intensity resting phases between pump bursts for contrast")

        if bpm > 140:
            suggestions.append("High BPM detected — consider using 1/8 note valve patterns for tight sync")
        elif bpm < 80:
            suggestions.append("Slow tempo — long flowing water arcs will suit this BPM well")

        suggestions.append("Enable energy optimization to reduce pump idle consumption by ~15-20%")
        return suggestions[:6]  # Return top 6


# ── Module singletons ──────────────────────────────────────────────────────────
analyzer  = AudioAnalyzer()
generator = ChoreographyGenerator()
suggester = SuggestionEngine()
