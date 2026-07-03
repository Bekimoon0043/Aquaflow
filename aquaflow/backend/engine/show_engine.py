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
        # Fixture-aware runtime model (Stage 1, Priority 1): the designed
        # engineering fixtures + control groups that a real show is built from.
        self.fixtures: list = []
        self.groups: list = []
        self.device_registry_summary: dict = {}
        # Hardware conflict detection (Stage 1, Priority 3): the last operator-facing
        # error, set when a show is blocked from starting due to address conflicts.
        self.last_error: str = ""

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
        # Fixture-aware: accept designed fixtures (frontend sends them as
        # `fixtures`, or as `engineeringFixtures` from the show store) and their
        # control groups. Groups are derived from fixture groupIds when absent.
        self.fixtures = payload.get("fixtures", payload.get("engineeringFixtures", self.fixtures)) or []
        self.groups = payload.get("groups", self.groups) or []
        if not self.groups and self.fixtures:
            self.groups = self._derive_groups(self.fixtures)
        self.last_error = ""  # fresh show — clear any prior conflict block
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

    def _derive_groups(self, fixtures: list) -> list:
        """Derive control groups from fixture groupIds when none are supplied."""
        groups: dict = {}
        for fx in fixtures:
            if not isinstance(fx, dict):
                continue
            gid = fx.get("groupId") or "ungrouped"
            g = groups.setdefault(gid, {"id": gid, "label": gid, "type": None, "memberIds": []})
            fid = fx.get("id")
            if fid:
                g["memberIds"].append(fid)
            if g["type"] is None:
                g["type"] = fx.get("type")
        return list(groups.values())

    def set_bpm(self, bpm: float):
        self.show_state.bpm = float(bpm)
        self.current_show["bpm"] = float(bpm)
        self._bump_revision()

    def get_hardware_conflicts(self) -> list[str]:
        """
        Return the list of hardware address conflicts in the designed fixtures —
        duplicate DMX universe/channel, DMX channel overflow, or duplicate Modbus
        registers. Empty list means the show is safe to send to hardware.

        Derived from the DeviceRegistry validation the fixture-aware pipeline
        already computes when a show is applied (device_registry_summary).
        """
        summary = self.device_registry_summary or {}
        conflicts: list[str] = []
        for msg in (summary.get("validation") or []):
            if msg and msg not in conflicts:
                conflicts.append(msg)
        for w in (summary.get("warnings") or []):
            wl = str(w).lower()
            if ("collision" in wl or "overflow" in wl) and w not in conflicts:
                conflicts.append(w)
        return conflicts

    async def play(self):
        if self.show_state.state == PlaybackState.PLAYING:
            return True
        # ── Pre-flight hardware conflict check (Stage 1, Priority 3) ──────────────
        # Refuse to start a show whose designed fixtures have duplicate/overflowing
        # addresses — running it would drive the wrong hardware. The operator sees
        # a clear error via get_state()/operator status and the WS log.
        conflicts = self.get_hardware_conflicts()
        if conflicts:
            extra = f" (+{len(conflicts) - 5} more)" if len(conflicts) > 5 else ""
            self.last_error = (
                "Hardware address conflict — show blocked. "
                "Resolve duplicate addresses before running: "
                + "; ".join(conflicts[:5]) + extra
            )
            print("[BLOCKED] " + self.last_error)
            return False
        self.last_error = ""
        await self._cancel_playback_task()
        self._start_time = time.monotonic()
        self._start_playhead = self.show_state.playhead
        self.show_state.state = PlaybackState.PLAYING
        self._task = asyncio.create_task(self._playback_loop())
        print(f"▶  Playback started at {self.show_state.playhead:.2f}s")
        return True

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

    def _normalize_track_type(self, raw_type) -> str:
        key = str(raw_type or "").strip().lower()

        aliases = {
            "rgb_lights": "lighting",
            "light": "lighting",
            "lights": "lighting",
            "led": "lighting",
            "rgb": "lighting",
            "rgbw": "lighting",

            "flame_units": "flame",
            "fire": "flame",

            "fog_machines": "fog",
            "smoke": "fog",
            "haze": "fog",

            "laser_units": "laser",

            "center_jets": "pump",
            "outer_ring_jets": "pump",
            "arch_jets": "pump",
            "cascade_jets": "pump",
            "motion_1d_jets": "pump",
            "motion_2d_jets": "pump",
            "motion_3d_jets": "pump",
            "mist_jets": "fog",
        }

        return aliases.get(key, key)

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
                        "type": self._normalize_track_type(track.get("type")),
                        "label": clip.get("label"),
                        "intensity": float(clip.get("intensity", 100)) / 100.0,
                        "progress": progress,
                        "clip_id": clip.get("id"),
                        "color": (
                            clip.get("color")
                            or clip.get("lightColor")
                            or clip.get("lightingColor")
                            or track.get("color")
                        ),
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
            "type": self._normalize_track_type(command.get("type") or command.get("device_type") or "manual"),
            "label": command.get("label") or command.get("action") or command.get("command") or "Recorded Cue",
            "start": clip_start,
            "end": clip_end,
            "intensity": int(max(0, min(100, command.get("intensity", command.get("value", 100))))),
            "color": command.get("color") or command.get("lightColor") or "",
            "rgb": command.get("rgb"),
            "lightColor": command.get("lightColor") or command.get("color") or "",
            "groupId": command.get("groupId") or "",
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
                    "type": self._normalize_track_type(recorded["type"]),
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
                "color": recorded.get("color") or recorded.get("lightColor") or "",
                "rgb": recorded.get("rgb"),
                "lightColor": recorded.get("lightColor") or recorded.get("color") or "",
                "groupId": recorded.get("groupId") or "",
            })
        if self._recording_buffer:
            latest_end = max(item["end"] for item in self._recording_buffer)
            self.show_state.duration = max(self.show_state.duration, latest_end)
            self.current_show["duration"] = self.show_state.duration
            self._bump_revision()
        self._recording_buffer = []

    def inject_manual_clips(self, clip: dict):
        """
        Inject clips recorded from PatternDesignerPanel into the show timeline.

        Expected incoming format:
        {
            "clipId": "...",
            "name": "...",
            "tracks": [
                {
                    "fixtureId": "...",
                    "fixtureName": "...",
                    "keyframes": [{"time": 0.0, "value": 0.8}],
                    "duration": 3.0
                }
            ]
        }
        """
        if not isinstance(clip, dict):
            return False

        clip_id = clip.get("clipId") or f"manual-{int(time.time() * 1000)}"
        clip_name = clip.get("name") or "Manual Pattern"
        tracks = clip.get("tracks") or []

        if not isinstance(tracks, list):
            return False

        for item in tracks:
            if not isinstance(item, dict):
                continue

            fixture_id = item.get("fixtureId")
            fixture_name = item.get("fixtureName") or fixture_id or "Manual Fixture"
            keyframes = item.get("keyframes") or []
            duration = float(item.get("duration") or 0)

            if not fixture_id:
                continue

            if duration <= 0 and keyframes:
                duration = max(float(k.get("time", 0)) for k in keyframes if isinstance(k, dict))

            if duration <= 0:
                duration = 1.0

            intensity = 100
            if keyframes:
                values = [
                    float(k.get("value", 0))
                    for k in keyframes
                    if isinstance(k, dict)
                ]
                if values:
                    intensity = int(max(0, min(100, max(values) * 100)))

            track = next(
                (
                    t for t in self.timeline_tracks
                    if t.get("deviceId") == fixture_id
                ),
                None,
            )

            if not track:
                fixture_type = (
                    item.get("fixtureType")
                    or item.get("type")
                    or "pump"
                )

                track = {
                    "id": f"track-manual-{fixture_id}",
                    "label": fixture_name,
                    "color": "#00d4ff",
                    "type": self._normalize_track_type(fixture_type),
                    "deviceId": fixture_id,
                    "muted": False,
                    "solo": False,
                    "clips": [],
                }

                self.timeline_tracks.append(track)

            track.setdefault("clips", []).append({
                "id": f"{clip_id}-{len(track['clips']) + 1}",
                "start": 0,
                "end": duration,
                "label": clip_name,
                "intensity": intensity,
                "source": "manual_pattern",
                "keyframes": keyframes,
                "fixtureType": item.get("fixtureType") or item.get("type") or "",
                "type": item.get("type") or item.get("fixtureType") or "",
                "groupId": item.get("groupId") or "",
                "color": item.get("color") or item.get("lightColor") or "",
                "rgb": item.get("rgb"),
                "lightColor": item.get("lightColor") or item.get("color") or "",
            })

            self.show_state.duration = max(self.show_state.duration, duration)
            self.current_show["duration"] = self.show_state.duration

        self._bump_revision()
        return True    

    def get_state(self) -> dict:
        return {
            "state": self.show_state.state,
            "playhead": round(self.show_state.playhead, 3),
            "bpm": self.show_state.bpm,
            "duration": self.show_state.duration,
            "loop": self.show_state.loop,
            "track_count": len(self.timeline_tracks),
            "fixture_count": len(self.fixtures),
            "show_id": self.current_show.get("id"),
            "show_name": self.current_show.get("name"),
            "revision": self._revision,
            "hardware_conflicts": self.get_hardware_conflicts(),
            "error": self.last_error,
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
            "fixtures": self.fixtures,
            "groups": self.groups,
            "deviceRegistry": self.device_registry_summary,
            "ui": {
                "timelineZoom": 4,
                "showGrid": True,
                "snapToGrid": True,
            },
            "revision": self._revision,
        }
