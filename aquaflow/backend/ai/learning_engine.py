"""
AquaFlow AI Learning Engine — Phase 14
Self-improving choreography system that learns from:
  1. Manual patterns created by operators
  2. Audio-synced shows (from the audio engine)
  3. Operator ratings/feedback on generated shows
  4. Built-in pattern library (professional fountain choreography templates)
  5. Pattern evolution — mutates and recombines high-scoring patterns

Architecture:
  PatternMemory      — persistent storage of learned patterns + scores
  PatternExtractor   — extracts reusable patterns from any show/tracks
  PatternEvolver     — mutates and recombines patterns to create new ones
  LearningGenerator  — uses learned patterns to generate better shows
  FeedbackCollector  — records operator ratings and show performance
"""

import json
import math
import random
import hashlib
import time
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional


# ── Storage ────────────────────────────────────────────────────────────────────

LEARNING_DIR = Path("data/ai_learning")
LEARNING_DIR.mkdir(parents=True, exist_ok=True)

PATTERN_DB   = LEARNING_DIR / "patterns.json"
FEEDBACK_DB  = LEARNING_DIR / "feedback.json"
EVOLUTION_DB = LEARNING_DIR / "evolution.json"


# ── Data structures ────────────────────────────────────────────────────────────

@dataclass
class LearnedPattern:
    id: str
    name: str
    device_type: str          # pump | valve | lighting | flame | fog | laser
    mood: str                 # energetic | calm | dramatic | cinematic | playful
    bpm_range: list           # [min_bpm, max_bpm]
    section_label: str        # intro | verse | chorus | drop | bridge | finale | outro | any
    clips: list               # normalized clip sequence (relative timing 0.0-1.0)
    score: float = 0.5        # 0.0-1.0 learned quality score
    usage_count: int = 0
    source: str = "manual"    # manual | audio_sync | generated | evolved | library
    created_at: float = 0.0
    tags: list = field(default_factory=list)

    def to_dict(self):
        return asdict(self)


@dataclass
class ShowFeedback:
    show_id: str
    rating: int               # 1-5 stars
    mood: str
    bpm: float
    duration: float
    track_types: list
    notes: str = ""
    timestamp: float = 0.0


# ── Pattern Memory ─────────────────────────────────────────────────────────────

class PatternMemory:
    """Persistent storage and retrieval of learned patterns."""

    def __init__(self):
        self._patterns: dict[str, LearnedPattern] = {}
        self._feedback: list[ShowFeedback] = []
        self._load()
        self._seed_library()

    def _load(self):
        if PATTERN_DB.exists():
            try:
                data = json.loads(PATTERN_DB.read_text())
                for pid, p in data.items():
                    self._patterns[pid] = LearnedPattern(**p)
            except Exception:
                pass
        if FEEDBACK_DB.exists():
            try:
                data = json.loads(FEEDBACK_DB.read_text())
                self._feedback = [ShowFeedback(**f) for f in data]
            except Exception:
                pass

    def save(self):
        PATTERN_DB.write_text(json.dumps(
            {pid: p.to_dict() for pid, p in self._patterns.items()}, indent=2
        ))
        FEEDBACK_DB.write_text(json.dumps(
            [asdict(f) for f in self._feedback], indent=2
        ))

    def add_pattern(self, pattern: LearnedPattern):
        self._patterns[pattern.id] = pattern
        self.save()

    def update_score(self, pattern_id: str, delta: float):
        if pattern_id in self._patterns:
            p = self._patterns[pattern_id]
            p.score = max(0.0, min(1.0, p.score + delta))
            p.usage_count += 1
            self.save()

    def get_best_patterns(
        self,
        device_type: str,
        mood: str,
        bpm: float,
        section_label: str = "any",
        top_n: int = 5,
    ) -> list[LearnedPattern]:
        candidates = []
        for p in self._patterns.values():
            if p.device_type != device_type:
                continue
            if p.mood not in (mood, "any"):
                continue
            if not (p.bpm_range[0] <= bpm <= p.bpm_range[1]):
                continue
            if p.section_label not in (section_label, "any"):
                continue
            candidates.append(p)

        candidates.sort(key=lambda x: x.score * 0.7 + random.random() * 0.3, reverse=True)
        return candidates[:top_n]

    def add_feedback(self, feedback: ShowFeedback):
        self._feedback.append(feedback)
        if len(self._feedback) > 500:
            self._feedback = self._feedback[-500:]
        self.save()

    def get_all_patterns(self) -> list[dict]:
        return [p.to_dict() for p in self._patterns.values()]

    def get_stats(self) -> dict:
        total = len(self._patterns)
        by_source = {}
        by_type = {}
        avg_score = 0.0
        for p in self._patterns.values():
            by_source[p.source] = by_source.get(p.source, 0) + 1
            by_type[p.device_type] = by_type.get(p.device_type, 0) + 1
            avg_score += p.score
        return {
            "total_patterns": total,
            "by_source": by_source,
            "by_device_type": by_type,
            "avg_score": round(avg_score / total, 3) if total else 0,
            "feedback_count": len(self._feedback),
            "high_quality_patterns": sum(1 for p in self._patterns.values() if p.score >= 0.7),
        }

    def _seed_library(self):
        """Seed with professional fountain choreography templates on first run."""
        if len(self._patterns) > 0:
            return

        templates = _build_library_templates()
        for t in templates:
            self._patterns[t.id] = t
        self.save()


# ── Built-in Pattern Library ───────────────────────────────────────────────────

def _build_library_templates() -> list[LearnedPattern]:
    """
    Professional fountain choreography templates.
    Clips use normalized time (0.0 = section start, 1.0 = section end).
    """
    templates = []

    def pid(name: str) -> str:
        return "lib-" + hashlib.md5(name.encode()).hexdigest()[:8]

    # ── PUMP patterns ──────────────────────────────────────────────────────────
    templates += [
        LearnedPattern(
            id=pid("pump-surge-energetic"),
            name="Power Surge",
            device_type="pump", mood="energetic",
            bpm_range=[100, 200], section_label="chorus",
            clips=[
                {"start":0.0, "end":0.25, "intensity":60},
                {"start":0.25,"end":0.5,  "intensity":85},
                {"start":0.5, "end":0.75, "intensity":100},
                {"start":0.75,"end":1.0,  "intensity":90},
            ],
            score=0.85, source="library",
            tags=["high-energy","climax","aggressive"],
        ),
        LearnedPattern(
            id=pid("pump-breathe-calm"),
            name="Breathing Wave",
            device_type="pump", mood="calm",
            bpm_range=[60, 110], section_label="any",
            clips=[
                {"start":0.0, "end":0.3,  "intensity":30},
                {"start":0.3, "end":0.6,  "intensity":60},
                {"start":0.6, "end":0.85, "intensity":45},
                {"start":0.85,"end":1.0,  "intensity":25},
            ],
            score=0.80, source="library",
            tags=["gentle","ambient","flowing"],
        ),
        LearnedPattern(
            id=pid("pump-dramatic-build"),
            name="Cinematic Build",
            device_type="pump", mood="dramatic",
            bpm_range=[70, 140], section_label="bridge",
            clips=[
                {"start":0.0, "end":0.2,  "intensity":20},
                {"start":0.2, "end":0.4,  "intensity":35},
                {"start":0.4, "end":0.6,  "intensity":55},
                {"start":0.6, "end":0.8,  "intensity":78},
                {"start":0.8, "end":1.0,  "intensity":95},
            ],
            score=0.88, source="library",
            tags=["build","tension","cinematic"],
        ),
        LearnedPattern(
            id=pid("pump-finale-blast"),
            name="Grand Finale Blast",
            device_type="pump", mood="energetic",
            bpm_range=[100, 200], section_label="finale",
            clips=[
                {"start":0.0, "end":0.1,  "intensity":100},
                {"start":0.1, "end":0.2,  "intensity":75},
                {"start":0.2, "end":0.3,  "intensity":100},
                {"start":0.3, "end":0.4,  "intensity":80},
                {"start":0.4, "end":0.6,  "intensity":100},
                {"start":0.6, "end":0.8,  "intensity":90},
                {"start":0.8, "end":1.0,  "intensity":100},
            ],
            score=0.92, source="library",
            tags=["finale","maximum","blast"],
        ),
        LearnedPattern(
            id=pid("pump-intro-gentle"),
            name="Soft Opening",
            device_type="pump", mood="any",
            bpm_range=[60, 200], section_label="intro",
            clips=[
                {"start":0.0, "end":0.4,  "intensity":15},
                {"start":0.4, "end":0.7,  "intensity":30},
                {"start":0.7, "end":1.0,  "intensity":50},
            ],
            score=0.78, source="library",
            tags=["intro","gentle","opening"],
        ),
    ]

    # ── VALVE patterns ─────────────────────────────────────────────────────────
    templates += [
        LearnedPattern(
            id=pid("valve-burst-chorus"),
            name="Burst Sync",
            device_type="valve", mood="energetic",
            bpm_range=[100, 200], section_label="chorus",
            clips=[
                {"start":0.0,   "end":0.08,  "intensity":100},
                {"start":0.125, "end":0.205, "intensity":100},
                {"start":0.25,  "end":0.33,  "intensity":100},
                {"start":0.375, "end":0.455, "intensity":100},
                {"start":0.5,   "end":0.58,  "intensity":100},
                {"start":0.625, "end":0.705, "intensity":100},
                {"start":0.75,  "end":0.83,  "intensity":100},
                {"start":0.875, "end":0.955, "intensity":100},
            ],
            score=0.90, source="library",
            tags=["sync","beat","burst","quarter-note"],
        ),
        LearnedPattern(
            id=pid("valve-half-note-verse"),
            name="Half-Note Flow",
            device_type="valve", mood="calm",
            bpm_range=[60, 140], section_label="verse",
            clips=[
                {"start":0.0,  "end":0.22, "intensity":60},
                {"start":0.25, "end":0.47, "intensity":70},
                {"start":0.5,  "end":0.72, "intensity":65},
                {"start":0.75, "end":0.97, "intensity":60},
            ],
            score=0.76, source="library",
            tags=["smooth","half-note","flowing"],
        ),
        LearnedPattern(
            id=pid("valve-cascade-drop"),
            name="Cascade Drop",
            device_type="valve", mood="dramatic",
            bpm_range=[80, 180], section_label="drop",
            clips=[
                {"start":0.0,  "end":0.05, "intensity":100},
                {"start":0.06, "end":0.11, "intensity":90},
                {"start":0.12, "end":0.17, "intensity":80},
                {"start":0.18, "end":0.23, "intensity":70},
                {"start":0.3,  "end":0.5,  "intensity":100},
                {"start":0.5,  "end":0.55, "intensity":100},
                {"start":0.56, "end":0.61, "intensity":90},
                {"start":0.75, "end":1.0,  "intensity":100},
            ],
            score=0.87, source="library",
            tags=["cascade","stagger","drop"],
        ),
    ]

    # ── LIGHTING patterns ──────────────────────────────────────────────────────
    templates += [
        LearnedPattern(
            id=pid("light-strobe-drop"),
            name="Beat Strobe",
            device_type="lighting", mood="energetic",
            bpm_range=[110, 200], section_label="drop",
            clips=[
                {"start":0.0,    "end":0.045, "intensity":100},
                {"start":0.055,  "end":0.1,   "intensity":0},
                {"start":0.1,    "end":0.145, "intensity":100},
                {"start":0.155,  "end":0.2,   "intensity":0},
                {"start":0.25,   "end":1.0,   "intensity":95},
            ],
            score=0.84, source="library",
            tags=["strobe","drop","high-energy"],
        ),
        LearnedPattern(
            id=pid("light-sweep-verse"),
            name="Color Sweep",
            device_type="lighting", mood="cinematic",
            bpm_range=[60, 140], section_label="verse",
            clips=[
                {"start":0.0,  "end":0.5,  "intensity":55},
                {"start":0.5,  "end":1.0,  "intensity":70},
            ],
            score=0.75, source="library",
            tags=["sweep","color","cinematic"],
        ),
        LearnedPattern(
            id=pid("light-pulse-chorus"),
            name="Pulse Chase",
            device_type="lighting", mood="playful",
            bpm_range=[90, 180], section_label="chorus",
            clips=[
                {"start":0.0,  "end":0.12, "intensity":100},
                {"start":0.15, "end":0.27, "intensity":80},
                {"start":0.3,  "end":0.42, "intensity":100},
                {"start":0.45, "end":0.57, "intensity":70},
                {"start":0.6,  "end":0.72, "intensity":100},
                {"start":0.75, "end":0.87, "intensity":85},
                {"start":0.9,  "end":1.0,  "intensity":100},
            ],
            score=0.82, source="library",
            tags=["pulse","chase","playful"],
        ),
    ]

    # ── FOG patterns ───────────────────────────────────────────────────────────
    templates += [
        LearnedPattern(
            id=pid("fog-atmospheric-intro"),
            name="Atmospheric Blanket",
            device_type="fog", mood="cinematic",
            bpm_range=[60, 200], section_label="intro",
            clips=[
                {"start":0.0,  "end":0.6, "intensity":35},
                {"start":0.6,  "end":1.0, "intensity":50},
            ],
            score=0.80, source="library",
            tags=["atmospheric","intro","mystery"],
        ),
        LearnedPattern(
            id=pid("fog-burst-outro"),
            name="Fog Burst Outro",
            device_type="fog", mood="dramatic",
            bpm_range=[60, 200], section_label="outro",
            clips=[
                {"start":0.0,  "end":0.3, "intensity":60},
                {"start":0.3,  "end":0.6, "intensity":80},
                {"start":0.6,  "end":1.0, "intensity":40},
            ],
            score=0.72, source="library",
            tags=["outro","fade","dramatic"],
        ),
    ]

    # ── FLAME patterns ─────────────────────────────────────────────────────────
    templates += [
        LearnedPattern(
            id=pid("flame-accent-finale"),
            name="Flame Accent",
            device_type="flame", mood="energetic",
            bpm_range=[80, 200], section_label="finale",
            clips=[
                {"start":0.0,  "end":0.05, "intensity":100},
                {"start":0.25, "end":0.3,  "intensity":100},
                {"start":0.5,  "end":0.55, "intensity":100},
                {"start":0.75, "end":0.8,  "intensity":100},
                {"start":0.95, "end":1.0,  "intensity":100},
            ],
            score=0.88, source="library",
            tags=["flame","accent","finale","punctuation"],
        ),
    ]

    now = time.time()
    for t in templates:
        t.created_at = now

    return templates


# ── Pattern Extractor ──────────────────────────────────────────────────────────

class PatternExtractor:
    """
    Extracts reusable patterns from manually created or audio-synced shows.
    Normalizes clip timing to 0.0-1.0 relative scale so patterns
    can be applied to any section duration.
    """

    def extract_from_tracks(
        self,
        tracks: list,
        bpm: float,
        mood: str = "energetic",
        source: str = "manual",
    ) -> list[LearnedPattern]:
        patterns = []
        for track in tracks:
            clips = track.get("clips", [])
            if len(clips) < 2:
                continue
            device_type = track.get("type", "pump")
            extracted = self._extract_pattern(
                clips=clips,
                device_type=device_type,
                bpm=bpm,
                mood=mood,
                source=source,
                track_label=track.get("label", ""),
            )
            if extracted:
                patterns.append(extracted)
        return patterns

    def _extract_pattern(
        self, clips, device_type, bpm, mood, source, track_label
    ) -> Optional[LearnedPattern]:
        if not clips:
            return None

        start = float(clips[0].get("start", 0))
        end = float(clips[-1].get("end", start + 1))
        duration = max(0.01, end - start)

        normalized = []
        for clip in clips:
            cs = float(clip.get("start", 0))
            ce = float(clip.get("end", cs + 0.5))
            normalized.append({
                "start":     round((cs - start) / duration, 4),
                "end":       round((ce - start) / duration, 4),
                "intensity": int(clip.get("intensity", 80)),
            })

        avg_intensity = sum(c["intensity"] for c in normalized) / len(normalized)
        bpm_min = max(60,  bpm - 20)
        bpm_max = min(220, bpm + 20)

        pattern_id = "learned-" + hashlib.md5(
            f"{device_type}{mood}{bpm}{normalized}".encode()
        ).hexdigest()[:10]

        return LearnedPattern(
            id=pattern_id,
            name=f"{track_label or device_type.title()} {mood.title()} Pattern",
            device_type=device_type,
            mood=mood,
            bpm_range=[bpm_min, bpm_max],
            section_label="any",
            clips=normalized,
            score=0.55,
            usage_count=0,
            source=source,
            created_at=time.time(),
            tags=[mood, device_type, source],
        )


# ── Pattern Evolver ────────────────────────────────────────────────────────────

class PatternEvolver:
    """
    Creates new patterns by mutating and recombining existing high-scoring ones.
    Implements a simple genetic algorithm for pattern evolution.
    """

    def evolve(
        self, memory: PatternMemory, device_type: str, mood: str, bpm: float
    ) -> Optional[LearnedPattern]:
        parents = memory.get_best_patterns(device_type, mood, bpm, top_n=4)
        if len(parents) < 2:
            return None

        parent_a = parents[0]
        parent_b = parents[1]

        child_clips = self._crossover(parent_a.clips, parent_b.clips)
        child_clips = self._mutate(child_clips)

        child_id = "evolved-" + hashlib.md5(
            f"{device_type}{mood}{bpm}{time.time()}".encode()
        ).hexdigest()[:10]

        child = LearnedPattern(
            id=child_id,
            name=f"Evolved {parent_a.name[:12]} × {parent_b.name[:12]}",
            device_type=device_type,
            mood=mood,
            bpm_range=[
                max(60,  min(parent_a.bpm_range[0], parent_b.bpm_range[0])),
                min(220, max(parent_a.bpm_range[1], parent_b.bpm_range[1])),
            ],
            section_label="any",
            clips=child_clips,
            score=(parent_a.score + parent_b.score) / 2 * 0.85,
            source="evolved",
            created_at=time.time(),
            tags=["evolved"] + list(set(parent_a.tags + parent_b.tags))[:4],
        )
        return child

    def _crossover(self, clips_a: list, clips_b: list) -> list:
        """Single-point crossover between two clip sequences."""
        if not clips_a:
            return clips_b
        if not clips_b:
            return clips_a
        cut = random.randint(1, min(len(clips_a), len(clips_b)) - 1)
        result = clips_a[:cut] + clips_b[cut:]
        return sorted(result, key=lambda c: c["start"])

    def _mutate(self, clips: list, mutation_rate: float = 0.25) -> list:
        """Randomly mutate clip intensities and timings."""
        mutated = []
        for clip in clips:
            c = dict(clip)
            if random.random() < mutation_rate:
                delta = random.randint(-15, 15)
                c["intensity"] = max(5, min(100, c["intensity"] + delta))
            if random.random() < mutation_rate * 0.5:
                jitter = random.uniform(-0.03, 0.03)
                c["start"] = round(max(0.0, min(0.95, c["start"] + jitter)), 4)
                c["end"]   = round(max(c["start"] + 0.02, min(1.0, c["end"] + jitter)), 4)
            mutated.append(c)
        return mutated


# ── Learning Generator ─────────────────────────────────────────────────────────

class LearningGenerator:
    """
    Generates shows using learned patterns from the memory store.
    Falls back to the base ChoreographyGenerator when no learned patterns exist.
    Blends learned patterns with generated ones based on memory quality.
    """

    TRACK_COLORS = {
        "pump":     "#00d4ff",
        "valve":    "#8b5cf6",
        "lighting": "#f59e0b",
        "flame":    "#ef4444",
        "fog":      "#6b7280",
        "laser":    "#f97316",
    }

    def generate_with_learning(
        self,
        memory: PatternMemory,
        evolver: PatternEvolver,
        analysis,            # AudioAnalysis from choreography_engine
        prompt: str = "",
        include_flame: bool = False,
        include_laser: bool = False,
        include_fog: bool = True,
        use_evolution: bool = True,
    ) -> dict:
        """
        Generate a full show using learned patterns.
        Returns same format as ChoreographyGenerator.generate_from_analysis.
        """
        mood = analysis.mood
        bpm  = analysis.bpm
        tracks = []
        patterns_used = []

        device_types = ["pump", "valve", "lighting"]
        if include_fog:    device_types.append("fog")
        if include_flame:  device_types.append("flame")
        if include_laser:  device_types.append("laser")

        for dtype in device_types:
            track, used = self._build_track(
                memory=memory,
                evolver=evolver,
                device_type=dtype,
                analysis=analysis,
                mood=mood,
                bpm=bpm,
                use_evolution=use_evolution,
            )
            if track:
                tracks.append(track)
                patterns_used.extend(used)

        stats = memory.get_stats()
        name  = self._show_name(prompt, mood, bpm)
        notes = self._show_notes(mood, bpm, patterns_used, stats)

        return {
            "name":          name,
            "bpm":           bpm,
            "duration":      analysis.duration,
            "tracks":        tracks,
            "notes":         notes,
            "patterns_used": patterns_used,
            "learning_stats": stats,
        }

    def _build_track(
        self, memory, evolver, device_type, analysis, mood, bpm, use_evolution
    ) -> tuple[Optional[dict], list]:
        clips = []
        patterns_used = []
        clip_id = abs(hash(device_type)) % 9000 + 1000

        device_ids = {
            "pump":     "pump-01",
            "valve":    "valve-01",
            "lighting": "light-01",
            "fog":      "fog-01",
            "flame":    "flame-01",
            "laser":    "laser-01",
        }

        for section in analysis.sections:
            sec_dur = max(0.1, section.end - section.start)

            patterns = memory.get_best_patterns(
                device_type=device_type,
                mood=mood,
                bpm=bpm,
                section_label=section.label,
                top_n=3,
            )

            if not patterns and use_evolution:
                evolved = evolver.evolve(memory, device_type, mood, bpm)
                if evolved:
                    memory.add_pattern(evolved)
                    patterns = [evolved]

            if patterns:
                pattern = patterns[0]
                patterns_used.append(pattern.id)
                for nc in pattern.clips:
                    abs_start = round(section.start + nc["start"] * sec_dur, 3)
                    abs_end   = round(section.start + nc["end"]   * sec_dur, 3)
                    if abs_end <= abs_start:
                        abs_end = abs_start + 0.1
                    intensity = int(nc["intensity"] * section.energy * 1.1)
                    intensity = max(5, min(100, intensity))
                    clips.append({
                        "id":        f"lg-{device_type}-{clip_id}",
                        "start":     abs_start,
                        "end":       abs_end,
                        "intensity": intensity,
                        "label":     f"{pattern.name} [{section.label.title()}]",
                    })
                    clip_id += 1
            else:
                clips.extend(self._fallback_clips(
                    device_type, section, bpm, clip_id
                ))
                clip_id += 4

        if not clips:
            return None, []

        return {
            "id":       f"lg-track-{device_type}",
            "label":    f"AI {device_type.title()} (Learned)",
            "type":     device_type,
            "color":    self.TRACK_COLORS.get(device_type, "#94a3b8"),
            "deviceId": device_ids.get(device_type, f"{device_type}-01"),
            "clips":    clips,
        }, patterns_used

    def _fallback_clips(self, device_type, section, bpm, clip_id) -> list:
        beat = 60.0 / bpm
        clips = []
        if device_type == "pump":
            clips.append({
                "id": f"fb-{clip_id}", "start": section.start, "end": section.end,
                "intensity": int(section.energy * 80), "label": section.label.title(),
            })
        elif device_type == "valve":
            t = section.start
            while t < section.end - beat:
                clips.append({
                    "id": f"fb-{clip_id}", "start": round(t, 3),
                    "end": round(min(t + beat * 0.8, section.end), 3),
                    "intensity": int(section.energy * 90), "label": "Flow",
                })
                t += beat * 2
                clip_id += 1
        else:
            clips.append({
                "id": f"fb-{clip_id}", "start": section.start, "end": section.end,
                "intensity": int(section.energy * 75), "label": section.label.title(),
            })
        return clips

    def _show_name(self, prompt: str, mood: str, bpm: float) -> str:
        if prompt and len(prompt) > 3:
            words = prompt.strip().split()[:4]
            return " ".join(w.title() for w in words)
        return f"AI Learned Show — {mood.title()} {bpm:.0f}BPM"

    def _show_notes(
        self, mood: str, bpm: float, patterns_used: list, stats: dict
    ) -> str:
        unique = len(set(patterns_used))
        total  = stats.get("total_patterns", 0)
        hq     = stats.get("high_quality_patterns", 0)
        return (
            f"Generated using {unique} learned pattern(s) from a library of {total} "
            f"({hq} high-quality). Mood: {mood}, BPM: {bpm:.0f}. "
            f"The AI improves with every rated show — rate this show to help it learn."
        )


# ── Feedback Processor ─────────────────────────────────────────────────────────

class FeedbackProcessor:
    """
    Processes operator ratings to update pattern scores.
    A 5-star rating boosts used patterns; 1-2 stars penalizes them.
    """

    def process_rating(
        self,
        memory: PatternMemory,
        rating: int,
        patterns_used: list,
        mood: str,
        bpm: float,
        duration: float,
        notes: str = "",
    ):
        feedback = ShowFeedback(
            show_id=f"show-{int(time.time())}",
            rating=rating,
            mood=mood,
            bpm=bpm,
            duration=duration,
            track_types=list(set(p.split("-")[0] for p in patterns_used if "-" in p)),
            notes=notes,
            timestamp=time.time(),
        )
        memory.add_feedback(feedback)

        score_delta = {
            5: +0.12,
            4: +0.06,
            3:  0.0,
            2: -0.06,
            1: -0.12,
        }.get(rating, 0.0)

        for pid in set(patterns_used):
            memory.update_score(pid, score_delta)


# ── Module singletons ──────────────────────────────────────────────────────────

pattern_memory    = PatternMemory()
pattern_extractor = PatternExtractor()
pattern_evolver   = PatternEvolver()
learning_generator = LearningGenerator()
feedback_processor = FeedbackProcessor()
