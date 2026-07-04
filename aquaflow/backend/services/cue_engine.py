"""
cue_engine.py — AquaFlow Recovery, AQ-X-004

Cue stack management and scene recall — the theatrical playback model on top of the
timeline: capture a *look* as a Scene, order Scenes into Cues inside a CueStack, and
GO through them with smooth crossfades.

Concepts:
  * Scene    — a named snapshot of per-target levels (fixture/channel → 0..1). The
               captured "look".
  * Cue      — a numbered step in a stack: a target Scene plus a fade-in time.
  * CueStack — an ordered list of cues with a live playhead. GO advances to the next
               cue and crossfades the output from the current look to the cue's scene
               over its fade time; when the fade completes the output equals the scene
               exactly (correct recall).
  * CueStackManager — holds many independent cue stacks at once.

The engine is pure and clock-injectable (every time-dependent call takes an explicit
`now`), so transitions are exactly reproducible and unit-testable without sleeping,
and everything round-trips through `to_dict`/`from_dict` for persistence
(save/recall).
"""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Optional


# ── Helpers ───────────────────────────────────────────────────────────────────

def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def clamp01(v) -> float:
    try:
        v = float(v)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def ease(progress: float, curve: str = "linear") -> float:
    """Map linear 0..1 progress through a fade curve."""
    p = 0.0 if progress < 0 else 1.0 if progress > 1 else float(progress)
    if curve == "smooth":       # smoothstep — gentle ease in/out
        return p * p * (3 - 2 * p)
    if curve == "ease_in":
        return p * p
    if curve == "ease_out":
        return 1 - (1 - p) * (1 - p)
    return p                    # linear


def crossfade(from_values: dict, to_values: dict, progress: float,
              curve: str = "linear") -> dict:
    """
    Interpolate every target between two looks. Targets present in only one look
    fade to / from 0, so a smooth transition never snaps a channel. At progress 0 the
    result equals `from_values`; at 1 it equals `to_values` exactly.
    """
    p = ease(progress, curve)
    out: dict = {}
    for key in set(from_values) | set(to_values):
        a = clamp01(from_values.get(key, 0.0))
        b = clamp01(to_values.get(key, 0.0))
        out[key] = a + (b - a) * p
    return out


def scene_values_from_commands(commands: list) -> dict:
    """Capture a live look from emitted output commands ({device_id, intensity})."""
    values: dict = {}
    for c in commands or []:
        did = c.get("device_id") if isinstance(c, dict) else None
        if did is not None:
            values[str(did)] = clamp01(c.get("intensity", 0.0))
    return values


# ── Scene ─────────────────────────────────────────────────────────────────────

@dataclass
class Scene:
    id: str
    name: str
    values: dict = field(default_factory=dict)   # target_key → level 0..1
    captured_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name,
                "values": {k: clamp01(v) for k, v in self.values.items()},
                "captured_at": self.captured_at}

    @classmethod
    def from_dict(cls, d: dict) -> "Scene":
        return cls(id=d.get("id") or _new_id("scene"),
                   name=d.get("name", "Scene"),
                   values={k: clamp01(v) for k, v in (d.get("values") or {}).items()},
                   captured_at=d.get("captured_at", time.time()))


def make_scene(name: str, values: dict) -> Scene:
    return Scene(id=_new_id("scene"), name=name,
                 values={k: clamp01(v) for k, v in (values or {}).items()})


# ── Cue ───────────────────────────────────────────────────────────────────────

@dataclass
class Cue:
    id: str
    number: float
    label: str
    scene: Scene
    fade_in: float = 3.0        # seconds
    follow: Optional[float] = None   # auto-GO this many seconds after completing
    notes: str = ""

    def to_dict(self) -> dict:
        return {"id": self.id, "number": self.number, "label": self.label,
                "fade_in": self.fade_in, "follow": self.follow, "notes": self.notes,
                "scene": self.scene.to_dict()}

    @classmethod
    def from_dict(cls, d: dict) -> "Cue":
        return cls(id=d.get("id") or _new_id("cue"),
                   number=float(d.get("number", 1)),
                   label=d.get("label", "Cue"),
                   scene=Scene.from_dict(d.get("scene") or {}),
                   fade_in=float(d.get("fade_in", 3.0)),
                   follow=d.get("follow"),
                   notes=d.get("notes", ""))


# ── Cue stack ─────────────────────────────────────────────────────────────────

class CueStack:
    """
    An ordered cue list with a live playhead and a smooth crossfade engine.

    Cues are kept sorted by number. GO advances to the next cue and crossfades from
    the current output to the cue's scene over its fade time; `output_at(now)` returns
    the interpolated look. Released state (`current_index == -1`) means no active cue.
    """

    def __init__(self, id: str, name: str):
        self.id = id
        self.name = name
        self.cues: list[Cue] = []
        self.current_index: int = -1
        # transition state (runtime only, not serialised)
        self._from: dict = {}
        self._to: dict = {}
        self._fade_start: float = 0.0
        self._fade_dur: float = 0.0
        self._curve: str = "linear"
        self._active: bool = False

    # ── Cue editing ───────────────────────────────────────────────────────────
    def add_cue(self, scene: Scene, number: Optional[float] = None, label: str = "",
                fade_in: float = 3.0, follow: Optional[float] = None,
                notes: str = "") -> Cue:
        if number is None:
            number = (max((c.number for c in self.cues), default=0.0)) + 1.0
        cue = Cue(id=_new_id("cue"), number=float(number), label=label or f"Cue {number}",
                  scene=scene, fade_in=float(fade_in), follow=follow, notes=notes)
        self.cues.append(cue)
        self._resort()
        return cue

    def remove_cue(self, cue_id: str) -> bool:
        before = len(self.cues)
        active = self.current_cue()
        self.cues = [c for c in self.cues if c.id != cue_id]
        self._resort()
        # keep the playhead pointing at the same cue if it survived
        if active and active.id != cue_id:
            self.current_index = self.cues.index(active)
        elif active and active.id == cue_id:
            self.current_index = min(self.current_index, len(self.cues) - 1)
        return len(self.cues) < before

    def _resort(self):
        active = self.current_cue()
        self.cues.sort(key=lambda c: c.number)
        self.current_index = self.cues.index(active) if active in self.cues else self.current_index
        if self.current_index >= len(self.cues):
            self.current_index = len(self.cues) - 1

    def cue_numbers(self) -> list:
        return [c.number for c in self.cues]

    def current_cue(self) -> Optional[Cue]:
        if 0 <= self.current_index < len(self.cues):
            return self.cues[self.current_index]
        return None

    # ── Playback ──────────────────────────────────────────────────────────────
    def _begin_transition(self, target_index: int, now: float):
        target = self.cues[target_index]
        self._from = dict(self.output_at(now)) if self._active else {}
        self._to = dict(target.scene.values)
        self._fade_start = now
        self._fade_dur = max(0.0, float(target.fade_in))
        self._active = True
        self.current_index = target_index

    def go(self, now: Optional[float] = None) -> Optional[Cue]:
        """Advance to the next cue (wraps to the first from released)."""
        if not self.cues:
            return None
        now = time.monotonic() if now is None else now
        nxt = self.current_index + 1
        if nxt >= len(self.cues):
            nxt = 0 if self.current_index == -1 else len(self.cues) - 1
        self._begin_transition(nxt, now)
        return self.current_cue()

    def go_to(self, number: float, now: Optional[float] = None) -> Optional[Cue]:
        """Jump to a specific cue number and crossfade to it."""
        now = time.monotonic() if now is None else now
        for i, c in enumerate(self.cues):
            if c.number == number:
                self._begin_transition(i, now)
                return self.current_cue()
        return None

    def back(self, now: Optional[float] = None) -> Optional[Cue]:
        if not self.cues or self.current_index <= 0:
            return None
        now = time.monotonic() if now is None else now
        self._begin_transition(self.current_index - 1, now)
        return self.current_cue()

    def release(self, fade: float = 0.0, now: Optional[float] = None):
        """Fade the stack out to blackout and release the playhead."""
        now = time.monotonic() if now is None else now
        self._from = dict(self.output_at(now)) if self._active else {}
        self._to = {k: 0.0 for k in self._from}
        self._fade_start = now
        self._fade_dur = max(0.0, float(fade))
        self._active = self._fade_dur > 0.0
        self.current_index = -1

    # ── Output ────────────────────────────────────────────────────────────────
    def progress_at(self, now: float) -> float:
        if self._fade_dur <= 0.0:
            return 1.0
        return clamp01((now - self._fade_start) / self._fade_dur)

    def is_transitioning(self, now: float) -> bool:
        return self._active and self.progress_at(now) < 1.0

    def output_at(self, now: Optional[float] = None) -> dict:
        """The current interpolated look (target_key → 0..1)."""
        if not self._active and self.current_index == -1 and not self._to:
            return {}
        now = time.monotonic() if now is None else now
        p = self.progress_at(now)
        return crossfade(self._from, self._to, p, self._curve)

    def recalled_values(self, now: Optional[float] = None) -> dict:
        """Output with fully-off targets dropped — the clean recalled scene."""
        return {k: v for k, v in self.output_at(now).items() if v > 0.0}

    # ── Persistence ───────────────────────────────────────────────────────────
    def to_dict(self) -> dict:
        return {"id": self.id, "name": self.name,
                "current_index": self.current_index,
                "cues": [c.to_dict() for c in self.cues]}

    @classmethod
    def from_dict(cls, d: dict) -> "CueStack":
        stack = cls(id=d.get("id") or _new_id("stack"), name=d.get("name", "Cue Stack"))
        stack.cues = [Cue.from_dict(c) for c in (d.get("cues") or [])]
        stack._resort()
        idx = d.get("current_index", -1)
        stack.current_index = idx if -1 <= idx < len(stack.cues) else -1
        return stack

    def status(self, now: Optional[float] = None) -> dict:
        now = time.monotonic() if now is None else now
        cur = self.current_cue()
        return {"id": self.id, "name": self.name, "cue_count": len(self.cues),
                "current_cue": cur.number if cur else None,
                "current_label": cur.label if cur else None,
                "transitioning": self.is_transitioning(now),
                "progress": round(self.progress_at(now), 4)}


# ── Manager (multiple cue stacks) ─────────────────────────────────────────────

class CueStackManager:
    """Holds any number of independent cue stacks."""

    def __init__(self):
        self._stacks: dict[str, CueStack] = {}

    def create(self, name: str, id: Optional[str] = None) -> CueStack:
        sid = id or _new_id("stack")
        stack = CueStack(id=sid, name=name)
        self._stacks[sid] = stack
        return stack

    def get(self, stack_id: str) -> Optional[CueStack]:
        return self._stacks.get(stack_id)

    def list_stacks(self) -> list[str]:
        return list(self._stacks.keys())

    def delete(self, stack_id: str) -> bool:
        return self._stacks.pop(stack_id, None) is not None

    def to_dict(self) -> dict:
        return {"stacks": [s.to_dict() for s in self._stacks.values()]}

    def load_dict(self, d: dict) -> None:
        for sd in (d or {}).get("stacks", []):
            stack = CueStack.from_dict(sd)
            self._stacks[stack.id] = stack


# ── Singleton ─────────────────────────────────────────────────────────────────

_manager: Optional[CueStackManager] = None


def get_cue_manager() -> CueStackManager:
    global _manager
    if _manager is None:
        _manager = CueStackManager()
    return _manager
