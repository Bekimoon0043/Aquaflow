"""
AquaFlow Show Engine
Real-time show playback with deterministic timing
"""
import asyncio
import time
from dataclasses import dataclass
from typing import Optional
from enum import Enum


class PlaybackState(str, Enum):
    STOPPED = "stopped"
    PLAYING = "playing"
    PAUSED = "paused"
    RECORDING = "recording"


@dataclass
class ShowState:
    state: PlaybackState = PlaybackState.STOPPED
    playhead: float = 0.0
    bpm: float = 128.0
    duration: float = 240.0
    loop: bool = False


class ShowEngine:
    """
    Core deterministic show playback engine.
    Runs at up to 100Hz tick rate for smooth control.
    """
    TICK_RATE = 100

    def __init__(self):
        self.show_state = ShowState()
        self.device_manager = None
        self.protocol_bus = None
        self._task: Optional[asyncio.Task] = None
        self._start_time: Optional[float] = None
        self._start_playhead: float = 0.0
        self._recording_buffer: list[dict] = []
        self._revision: int = 0

        self.current_show: dict = {
            "id": "show-001",
            "name": "Untitled Show",
            "bpm": 128.0,
            "duration": 240.0,
            "sampleRate": 48000,
            "loop": False,
        }
        self.runtime_devices: list = []
        self.nodes: dict = {}
        self.connections: list = []
        self.timeline_tracks: list = []

    def _bump_revision(self):
        self._revision += 1

    async def start(self, device_manager, protocol_bus):
        self.device_manager = device_manager
        self.protocol_bus = protocol_bus
        print("⚙️  Show engine initialized")

    async def stop(self):
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def _cancel_playback_task(self):
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    def load_show(self, payload: dict, preserve_transport: bool = False):
        show_data = payload.get("show", payload.get("currentShow", {}))
        nodes = payload.get("nodes", [])
        previous_state = self.show_state.state
        previous_playhead = self.show_state.playhead

        self.current_show = {
            "id": show_data.get("id", self.current_show.get("id", "show-001")),
            "name": show_data.get("name", self.current_show.get("name", "Untitled Show")),
            "bpm": float(show_data.get("bpm", self.show_state.bpm)),
            "duration": float(show_data.get("duration", self.show_state.duration)),
            "sampleRate": int(show_data.get("sampleRate", self.current_show.get("sampleRate", 48000))),
            "loop": bool(show_data.get("loop", self.show_state.loop)),
        }
        self.nodes = {n["id"]: n for n in nodes if isinstance(n, dict) and n.get("id")}
        self.connections = payload.get("connections", [])
        self.timeline_tracks = payload.get("timelineTracks", payload.get("tracks", [])) or []
        self.runtime_devices = payload.get("devices", self.runtime_devices) or []
        self._recording_buffer = []

        inferred_duration = max(
            [self.current_show["duration"]] + [float(c.get("end", 0)) for t in self.timeline_tracks for c in t.get("clips", [])],
            default=self.current_show["duration"],
        )
        self.show_state.bpm = float(self.current_show.get("bpm", self.show_state.bpm))
        self.show_state.duration = float(max(self.current_show.get("duration", inferred_duration), inferred_duration))
        self.show_state.loop = bool(self.current_show.get("loop", self.show_state.loop))
        self.current_show["duration"] = self.show_state.duration
        self.current_show["bpm"] = self.show_state.bpm

        if preserve_transport:
            self.show_state.playhead = max(0.0, min(previous_playhead, self.show_state.duration))
            self.show_state.state = previous_state
            if previous_state in (PlaybackState.PLAYING, PlaybackState.RECORDING):
                self._start_time = time.monotonic()
                self._start_playhead = self.show_state.playhead
        else:
            self.show_state.playhead = 0.0
            self.show_state.state = PlaybackState.STOPPED

        self._bump_revision()

    def set_bpm(self, bpm: float):
        self.show_state.bpm = float(bpm)
        self.current_show["bpm"] = float(bpm)
        self._bump_revision()

    async def play(self):
        if self.show_state.state == PlaybackState.PLAYING:
            return
        await self._cancel_playback_task()
        self._start_time = time.monotonic()
        self._start_playhead = self.show_state.playhead
        self.show_state.state = PlaybackState.PLAYING
        self._task = asyncio.create_task(self._playback_loop())
        print(f"▶  Playback started at {self.show_state.playhead:.2f}s")

    async def start_recording(self):
        await self._cancel_playback_task()
        self._recording_buffer = []
        self.show_state.playhead = 0.0
        self._start_time = time.monotonic()
        self._start_playhead = 0.0
        self.show_state.state = PlaybackState.RECORDING
        self._task = asyncio.create_task(self._playback_loop())
        print("⏺  Recording armed")

    async def stop_playback(self):
        was_recording = self.show_state.state == PlaybackState.RECORDING
        self.show_state.state = PlaybackState.STOPPED
        await self._cancel_playback_task()
        if was_recording:
            self._commit_recording_buffer()
        self.show_state.playhead = 0.0
        if self.protocol_bus:
            await self.protocol_bus.blackout()
        print("⏹  Playback stopped")

    async def pause(self):
        self.show_state.state = PlaybackState.PAUSED
        await self._cancel_playback_task()
        print(f"⏸  Playback paused at {self.show_state.playhead:.2f}s")

    async def seek(self, position: float):
        self.show_state.playhead = max(0, min(self.show_state.duration, position))
        if self.show_state.state == PlaybackState.PLAYING:
            self._start_time = time.monotonic()
            self._start_playhead = self.show_state.playhead

    async def emergency_stop(self):
        self.show_state.state = PlaybackState.STOPPED
        self.show_state.playhead = 0.0
        await self._cancel_playback_task()
        print("🚨 EMERGENCY STOP")

    async def _playback_loop(self):
        interval = 1.0 / self.TICK_RATE
        try:
            while self.show_state.state in (PlaybackState.PLAYING, PlaybackState.RECORDING):
                elapsed = time.monotonic() - self._start_time
                playhead = self._start_playhead + elapsed

                if playhead >= self.show_state.duration:
                    if self.show_state.loop:
                        self._start_time = time.monotonic()
                        self._start_playhead = 0.0
                        playhead = 0.0
                    else:
                        await self.stop_playback()
                        break

                self.show_state.playhead = playhead
                active_commands = self._evaluate_timeline(playhead) if self.show_state.state == PlaybackState.PLAYING else []
                if active_commands and self.protocol_bus:
                    await self.protocol_bus.send_batch(active_commands)
                await asyncio.sleep(interval)
        except asyncio.CancelledError:
            pass

    def _evaluate_timeline(self, t: float) -> list[dict]:
        commands = []
        solo_tracks = [track for track in self.timeline_tracks if track.get("solo")]
        active_tracks = solo_tracks if solo_tracks else [track for track in self.timeline_tracks if not track.get("muted")]

        for track in active_tracks:
            for clip in track.get("clips", []):
                clip_start = float(clip.get("start", 0))
                clip_end = float(clip.get("end", clip_start))
                if clip_start <= t < clip_end:
                    progress = (t - clip_start) / max(1e-6, clip_end - clip_start)
                    commands.append({
                        "track_id": track.get("id"),
                        "device_id": track.get("deviceId"),
                        "type": track.get("type"),
                        "label": clip.get("label"),
                        "intensity": float(clip.get("intensity", 100)) / 100.0,
                        "progress": progress,
                        "clip_id": clip.get("id"),
                    })
        return commands

    def update_node_param(self, node_id: str, key: str, value):
        if node_id in self.nodes:
            self.nodes[node_id].setdefault("params", {})[key] = value
            self._bump_revision()

    def record_device_command(self, device_id: str | None, command: dict):
        if self.show_state.state != PlaybackState.RECORDING:
            return
        clip_start = round(self.show_state.playhead, 3)
        clip_end = round(clip_start + max(0.2, float(command.get("duration", 0.5))), 3)
        self._recording_buffer.append({
            "device_id": device_id,
            "type": command.get("type") or command.get("device_type") or "manual",
            "label": command.get("label") or command.get("action") or command.get("command") or "Recorded Cue",
            "start": clip_start,
            "end": clip_end,
            "intensity": int(max(0, min(100, command.get("intensity", command.get("value", 100))))),
        })

    def _commit_recording_buffer(self):
        for recorded in self._recording_buffer:
            track = next(
                (
                    t for t in self.timeline_tracks
                    if (recorded["device_id"] and t.get("deviceId") == recorded["device_id"])
                    or t.get("type") == recorded["type"]
                ),
                None,
            )
            if not track:
                track = {
                    "id": f"track-record-{len(self.timeline_tracks) + 1}",
                    "label": recorded["device_id"] or f"{recorded['type'].title()} Track",
                    "color": {
                        "pump": "#00d4ff",
                        "valve": "#8b5cf6",
                        "lighting": "#f59e0b",
                        "flame": "#ef4444",
                        "fog": "#6b7280",
                        "laser": "#f97316",
                        "manual": "#94a3b8",
                    }.get(recorded["type"], "#94a3b8"),
                    "type": recorded["type"],
                    "deviceId": recorded["device_id"],
                    "muted": False,
                    "solo": False,
                    "clips": [],
                }
                self.timeline_tracks.append(track)
            track.setdefault("clips", []).append({
                "id": f"clip-record-{len(track['clips']) + 1}",
                "start": recorded["start"],
                "end": recorded["end"],
                "label": recorded["label"],
                "intensity": recorded["intensity"],
            })
        if self._recording_buffer:
            latest_end = max(item["end"] for item in self._recording_buffer)
            self.show_state.duration = max(self.show_state.duration, latest_end)
            self.current_show["duration"] = self.show_state.duration
            self._bump_revision()
        self._recording_buffer = []

    def get_state(self) -> dict:
        return {
            "state": self.show_state.state,
            "playhead": round(self.show_state.playhead, 3),
            "bpm": self.show_state.bpm,
            "duration": self.show_state.duration,
            "loop": self.show_state.loop,
            "track_count": len(self.timeline_tracks),
            "show_id": self.current_show.get("id"),
            "show_name": self.current_show.get("name"),
            "revision": self._revision,
        }

    def get_snapshot(self) -> dict:
        return {
            "currentShow": {
                **self.current_show,
                "bpm": self.show_state.bpm,
                "duration": self.show_state.duration,
                "loop": self.show_state.loop,
            },
            "nodes": list(self.nodes.values()),
            "connections": self.connections,
            "timelineTracks": self.timeline_tracks,
            "devices": self.runtime_devices,
            "ui": {
                "timelineZoom": 4,
                "showGrid": True,
                "snapToGrid": True,
            },
            "revision": self._revision,
        }
