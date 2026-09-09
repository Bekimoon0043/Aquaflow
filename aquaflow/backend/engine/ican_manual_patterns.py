"""Persistent, server-timed manual patterns for the proven I-CAN transport.

The physical layout is based on the site operator's description and the provisional
address suggestions are derived from the capture's shape.  Suggestions are never
treated as commissioned mappings: the run API has a separate confirmation gate.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from pathlib import Path
from typing import Callable


MANUAL_RUN_CONFIRMATION = "RUN MANUAL PATTERN"
SITE_PATTERN_GROUPS = (1, 2, 9, 17, 25)
CAPTURED_GROUP17_SUPPORT = (9, 25, 29, 31, 32, 33, 37)
MIN_STEP_MS = 100
MAX_STEP_MS = 60_000
MAX_STEPS = 500
MAX_REPEAT = 20
MAX_TOTAL_MS = 600_000


SITE_FOUNTAIN_LAYOUT = {
    "id": "curved-six-pump-fountain-v1",
    "name": "Curved site fountain",
    "mapping_status": "provisional",
    "physical_summary": {
        "front_outputs": 9,
        "front_pumps": 1,
        "rear_high_sides": 2,
        "rear_pumps": 1,
        "middle_nozzles": 64,
        "middle_pumps": 4,
        "total_pumps": 6,
    },
    "sections": [
        {"id": "front-9", "label": "Front 9 outputs", "outputs": 9,
         "pumps": 1, "mapping_note": "Capture shows only 8 candidates; output 9 is unassigned."},
        {"id": "rear-high", "label": "Rear left + right high", "outputs": 2,
         "pumps": 1, "mapping_note": "Two pulsed candidates; physical identity must be confirmed."},
        {"id": "middle-64", "label": "Middle 64 nozzles", "outputs": 64,
         "pumps": 4, "mapping_note": "Capture has two matching banks of 32; split into four banks of 16."},
    ],
    "cabinet_observations": [
        "A blue I-CAN NETCAN converter feeds the black Music Fountain Control System output controller.",
        "Rows of JGX4080 solid-state relays switch individual field loads.",
        "CHINT multi-pole breakers and heavier wiring feed separate power circuits.",
        "The cabinet labels do not expose the I-CAN group/channel translation clearly enough to assign addresses.",
        "Unknown power or pump circuits must not be rapidly pulsed during commissioning.",
    ],
    "presets": [
        {"id": "proven-opening", "label": "Proven opening state", "section": "captured",
         "confidence": "hardware-proven",
         "addresses": [
             {"group": 1, "channels": [9, 13, 17, 21, 25, 29, 33, 37]},
             {"group": 9, "channels": [9, 13, 17, 21, 25, 29, 33, 37]},
             {"group": 17, "channels": list(CAPTURED_GROUP17_SUPPORT)},
         ]},
        {"id": "captured-support", "label": "Captured G17 support", "section": "captured",
         "confidence": "capture-derived",
         "addresses": [{"group": 17, "channels": list(CAPTURED_GROUP17_SUPPORT)}]},
        {"id": "middle-a", "label": "Middle bank A (16)", "section": "middle-64",
         "confidence": "provisional",
         "addresses": [{"group": 1, "channels": list(range(9, 25))}]},
        {"id": "middle-b", "label": "Middle bank B (16)", "section": "middle-64",
         "confidence": "provisional",
         "addresses": [{"group": 1, "channels": list(range(25, 41))}]},
        {"id": "middle-c", "label": "Middle bank C (16)", "section": "middle-64",
         "confidence": "provisional",
         "addresses": [{"group": 9, "channels": list(range(9, 25))}]},
        {"id": "middle-d", "label": "Middle bank D (16)", "section": "middle-64",
         "confidence": "provisional",
         "addresses": [{"group": 9, "channels": list(range(25, 41))}]},
        {"id": "middle-all", "label": "Middle all 64", "section": "middle-64",
         "confidence": "provisional",
         "addresses": [
             {"group": 1, "channels": list(range(9, 41))},
             {"group": 9, "channels": list(range(9, 41))},
        ]},
        {"id": "front-candidates", "label": "Front candidates 1-8", "section": "front-9",
         "confidence": "provisional",
         "addresses": [{"group": 2, "channels": list(range(1, 9))}]},
        {"id": "rear-candidates", "label": "Rear high candidates", "section": "rear-high",
         "confidence": "provisional",
         "addresses": [{"group": 25, "channels": [33, 34]}]},
    ],
    "unresolved": [
        "The ninth front output address is unknown.",
        "All six pump addresses and their start/stop ordering are unknown.",
        "Group 17 contains active site signals whose physical functions are unknown.",
        "Every provisional preset requires physical channel commissioning.",
    ],
}


class ManualPatternError(ValueError):
    """A manual pattern is invalid or cannot start in the current state."""


def _data_file() -> Path:
    root = Path(os.getenv("AQUAFLOW_DATA_DIR", Path.home() / ".aquaflow"))
    return root / "ican" / "manual_patterns.json"


def normalize_pattern(raw: dict, *, assign_id: bool = False) -> dict:
    """Validate and return a canonical absolute-state manual pattern."""
    if not isinstance(raw, dict):
        raise ManualPatternError("pattern must be an object")
    name = str(raw.get("name", "")).strip()
    if not name or len(name) > 80:
        raise ManualPatternError("pattern name must contain 1 to 80 characters")
    steps = raw.get("steps")
    if not isinstance(steps, list) or not 1 <= len(steps) <= MAX_STEPS:
        raise ManualPatternError(f"pattern must contain 1 to {MAX_STEPS} steps")

    canonical_steps = []
    for index, step in enumerate(steps, 1):
        if not isinstance(step, dict):
            raise ManualPatternError(f"step {index} must be an object")
        try:
            duration_ms = int(step.get("duration_ms", 1000))
        except (TypeError, ValueError) as exc:
            raise ManualPatternError(f"step {index} duration is invalid") from exc
        if not MIN_STEP_MS <= duration_ms <= MAX_STEP_MS:
            raise ManualPatternError(
                f"step {index} duration must be {MIN_STEP_MS}..{MAX_STEP_MS} ms")
        groups = step.get("groups", {})
        if not isinstance(groups, dict):
            raise ManualPatternError(f"step {index} groups must be an object")
        # Every step is a complete state for every group observed in the site capture.
        # An omitted group therefore means OFF rather than "leave whatever was running".
        canonical_groups: dict[str, list[int]] = {
            str(group): [] for group in SITE_PATTERN_GROUPS
        }
        for raw_group, raw_channels in groups.items():
            try:
                group = int(raw_group)
            except (TypeError, ValueError) as exc:
                raise ManualPatternError(f"step {index} has an invalid group") from exc
            if group not in SITE_PATTERN_GROUPS:
                raise ManualPatternError(
                    f"step {index} group {group} is not one of the captured site groups "
                    f"{SITE_PATTERN_GROUPS}")
            if not isinstance(raw_channels, list):
                raise ManualPatternError(
                    f"step {index} group {group} channels must be a list")
            try:
                channels = sorted({int(channel) for channel in raw_channels})
            except (TypeError, ValueError) as exc:
                raise ManualPatternError(
                    f"step {index} group {group} contains an invalid channel") from exc
            if any(channel < 1 or channel > 40 for channel in channels):
                raise ManualPatternError(
                    f"step {index} group {group} channels must be in 1..40")
            if group == 17 and channels not in ([], list(CAPTURED_GROUP17_SUPPORT)):
                raise ManualPatternError(
                    f"step {index} group 17 is locked to all-off or the captured support "
                    "state until its pump/power circuits are commissioned")
            canonical_groups[str(group)] = channels
        canonical_steps.append({"duration_ms": duration_ms, "groups": canonical_groups})

    total_ms = sum(step["duration_ms"] for step in canonical_steps)
    if total_ms > MAX_TOTAL_MS:
        raise ManualPatternError("one pattern pass may not exceed 10 minutes")
    now = time.time()
    pattern_id = str(raw.get("id", "")).strip()
    if assign_id and not pattern_id:
        pattern_id = uuid.uuid4().hex[:12]
    return {
        "id": pattern_id,
        "name": name,
        "description": str(raw.get("description", "")).strip()[:500],
        "layout_id": str(raw.get("layout_id") or SITE_FOUNTAIN_LAYOUT["id"]),
        "steps": canonical_steps,
        "duration_ms": total_ms,
        "created_at": float(raw.get("created_at") or now),
        "updated_at": now,
    }


class ManualPatternStore:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else _data_file()

    def list(self) -> list[dict]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            items = data.get("patterns", []) if isinstance(data, dict) else []
            return sorted(items, key=lambda item: item.get("updated_at", 0), reverse=True)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return []

    def save(self, raw: dict) -> dict:
        pattern = normalize_pattern(raw, assign_id=True)
        patterns = self.list()
        existing = next((item for item in patterns if item.get("id") == pattern["id"]), None)
        if existing:
            pattern["created_at"] = existing.get("created_at", pattern["created_at"])
        patterns = [item for item in patterns if item.get("id") != pattern["id"]]
        patterns.append(pattern)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(f".tmp-{os.getpid()}-{time.time_ns()}")
        temporary.write_text(
            json.dumps({"version": 1, "patterns": patterns}, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)
        return pattern

    def delete(self, pattern_id: str) -> bool:
        patterns = self.list()
        kept = [item for item in patterns if item.get("id") != pattern_id]
        if len(kept) == len(patterns):
            return False
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(f".tmp-{os.getpid()}-{time.time_ns()}")
        temporary.write_text(
            json.dumps({"version": 1, "patterns": kept}, indent=2), encoding="utf-8")
        os.replace(temporary, self.path)
        return True


def _default_safety_permit() -> bool:
    from safety.safety_kernel import get_safety_kernel

    return bool(get_safety_kernel().outputs.permit)


class ICANManualPatternRunner:
    """Run operator-authored absolute group states with deterministic backend timing."""

    def __init__(self, safety_permit: Callable[[], bool] = _default_safety_permit):
        self._safety_permit = safety_permit
        self._task: asyncio.Task | None = None
        self._stop_event: asyncio.Event | None = None
        self._connection = None
        self._pattern: dict | None = None
        self._repeat = 1
        self._run_id = ""
        self._started_wall: float | None = None
        self._started_mono: float | None = None
        self._ended_wall: float | None = None
        self._frames_sent = 0
        self._step_index = -1
        self._pass_index = 0
        self._outcome = "idle"
        self._error = ""
        self._stop_reason = "stopped"

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    def _permit(self) -> bool:
        try:
            return bool(self._safety_permit())
        except Exception:
            return False

    def status(self) -> dict:
        duration_s = 0.0
        if self._pattern:
            duration_s = self._pattern["duration_ms"] * self._repeat / 1000.0
        elapsed = 0.0
        if self._started_mono is not None:
            if self.running:
                elapsed = min(duration_s, time.monotonic() - self._started_mono)
            elif self._started_wall is not None and self._ended_wall is not None:
                elapsed = min(duration_s, self._ended_wall - self._started_wall)
        return {
            "running": self.running,
            "run_id": self._run_id,
            "outcome": self._outcome,
            "pattern_id": self._pattern.get("id", "") if self._pattern else "",
            "pattern_name": self._pattern.get("name", "") if self._pattern else "",
            "duration_s": round(duration_s, 3),
            "elapsed_s": round(max(0.0, elapsed), 2),
            "remaining_s": round(max(0.0, duration_s - elapsed), 2),
            "frames_sent": self._frames_sent,
            "step_index": self._step_index,
            "step_count": len(self._pattern.get("steps", [])) if self._pattern else 0,
            "pass_index": self._pass_index,
            "repeat": self._repeat,
            "started_at": self._started_wall,
            "ended_at": self._ended_wall,
            "error": self._error,
        }

    async def start(self, connection, raw_pattern: dict, repeat: int = 1) -> dict:
        if self.running:
            raise ManualPatternError("a manual pattern is already running")
        state = connection.status()
        if state.get("state") != "connected":
            raise ManualPatternError("connect the I-CAN gateway before running a pattern")
        if not state.get("output_enabled"):
            raise ManualPatternError("arm I-CAN output before running a pattern")
        if not self._permit():
            raise ManualPatternError("arm the safety system before running a pattern")
        try:
            repeat = int(repeat)
        except (TypeError, ValueError) as exc:
            raise ManualPatternError("repeat must be a number") from exc
        if not 1 <= repeat <= MAX_REPEAT:
            raise ManualPatternError(f"repeat must be 1..{MAX_REPEAT}")
        pattern = normalize_pattern(raw_pattern)
        if pattern["duration_ms"] * repeat > MAX_TOTAL_MS:
            raise ManualPatternError("total manual run may not exceed 10 minutes")

        self._connection = connection
        self._pattern = pattern
        self._repeat = repeat
        self._stop_event = asyncio.Event()
        self._run_id = uuid.uuid4().hex[:12]
        self._started_wall = time.time()
        self._started_mono = time.monotonic()
        self._ended_wall = None
        self._frames_sent = 0
        self._step_index = -1
        self._pass_index = 0
        self._outcome = "running"
        self._error = ""
        self._stop_reason = "stopped"
        self._task = asyncio.create_task(
            self._run(), name=f"ican-manual-pattern-{self._run_id}")
        await asyncio.sleep(0)
        return self.status()

    async def _wait(self, delay_s: float) -> str | None:
        deadline = time.monotonic() + delay_s
        while True:
            if self._stop_event is not None and self._stop_event.is_set():
                return self._stop_reason
            if not self._permit():
                return "safety_stopped"
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None
            try:
                await asyncio.wait_for(self._stop_event.wait(), timeout=min(remaining, 0.1))
            except asyncio.TimeoutError:
                continue

    async def _run(self):
        connection = self._connection
        pattern = self._pattern or {"steps": []}
        target_groups = sorted({
            int(group)
            for step in pattern["steps"]
            for group in step["groups"]
        })
        try:
            # Begin from a known safe state; a manual pattern never inherits the demo.
            if not await connection.blackout():
                self._outcome = "error"
                self._error = "could not establish the initial all-off state"
                return
            # blackout() knows the groups driven during this connection. Explicitly clear
            # every group in this pattern as well, including a group not seen previously.
            for group in target_groups:
                if not await connection.send_output(
                        group, [], confirmed=True, user="manual-pattern"):
                    self._outcome = "error"
                    self._error = f"could not clear I-CAN group {group} before playback"
                    return
            for pass_index in range(self._repeat):
                self._pass_index = pass_index + 1
                for step_index, step in enumerate(pattern["steps"]):
                    if not self._permit():
                        self._outcome = "safety_stopped"
                        self._error = "safety permit was withdrawn during the pattern"
                        return
                    self._step_index = step_index
                    for group in target_groups:
                        channels = step["groups"].get(str(group), [])
                        ok = await connection.send_output(
                            group, channels, confirmed=True, user="manual-pattern")
                        if not ok:
                            self._outcome = "error"
                            self._error = f"I-CAN output was refused at step {step_index + 1}"
                            return
                        self._frames_sent += 1
                    interrupted = await self._wait(step["duration_ms"] / 1000.0)
                    if interrupted:
                        self._outcome = interrupted
                        if interrupted == "safety_stopped":
                            self._error = "safety permit was withdrawn during the pattern"
                        return
            self._outcome = "completed"
        except asyncio.CancelledError:
            self._outcome = self._stop_reason or "cancelled"
        except Exception as exc:  # cleanup below is the priority
            self._outcome = "error"
            self._error = str(exc)
        finally:
            try:
                ok = await asyncio.shield(connection.blackout())
                if not ok and not self._error:
                    self._error = "one or more final all-off frames failed"
                    self._outcome = "error"
            except Exception as exc:  # pragma: no cover - hardware/OS dependent
                self._error = f"final all-off failed: {exc}"
                self._outcome = "error"
            self._ended_wall = time.time()

    async def stop(self, reason: str = "stopped") -> dict:
        if self.running and self._stop_event is not None:
            self._stop_reason = reason
            self._stop_event.set()
            try:
                await asyncio.wait_for(asyncio.shield(self._task), timeout=3.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except asyncio.CancelledError:
                    pass
        return self.status()
