"""
runtime_bridge.py — AquaFlow Team D
Compiled show → live hardware output bridge scaffold.

This is the last mile between the compiled event list and the physical devices.
At each SHOW tick (100Hz), the bridge:
  1. Reads the current show clock position
  2. Fetches newly-crossed compiled events
  3. Routes each event to the appropriate protocol driver
  4. Handles safety limits (blocks unsafe commands)
  5. On ESTOP: sends blackout to all protocols immediately

Architecture position:
  CompiledShow (event list)
       │
       ▼
  RuntimeBridge.tick()  ← called by TimingEngine SHOW tier
       │
       ├──→ SafetyGuard.check(event)     → blocks if limit exceeded
       │
       ├──→ ProtocolRouter.route(event)  → sends to correct driver
       │         │
       │         ├──→ ArtNetDriver (DMX lights, fog)
       │         ├──→ sACNDriver   (backup DMX)
       │         ├──→ ModbusDriver (VFD pumps, solenoids, motion)
       │         └──→ RelayDriver  (simple on/off devices)
       │
       └──→ StateTracker.update()       → maintains last-known device state

Does NOT touch:
  - Frontend code, ShowProgrammerPanel, showStore
  - Persistence routes
  - show_engine.py state (reads from it, doesn't modify it)
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field, replace
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


# ── Bridge State ──────────────────────────────────────────────────────────────

class BridgeState(str, Enum):
    IDLE     = "idle"      # no show loaded
    READY    = "ready"     # show loaded, not playing
    PLAYING  = "playing"   # outputting to hardware
    PAUSED   = "paused"    # paused, holding last state
    ESTOP    = "estop"     # emergency stop, blackout active


# ── Compiled Event (matches runtimeSignalCompiler.js output) ──────────────────

@dataclass
class CompiledEvent:
    time:         float
    device_id:    str
    channel_id:   str
    value:        float         # 0.0-1.0 normalized
    easing:       str           = "linear"
    easing_params: list         = field(default_factory=list)
    priority:     int           = 2   # TIMELINE priority
    flags:        int           = 0


# ── Device State Tracker ──────────────────────────────────────────────────────

class DeviceStateTracker:
    """
    Maintains the last-known output value for each device channel.
    Used to:
      - Skip redundant protocol writes (value unchanged)
      - Restore state after un-pause
      - Report current state to frontend telemetry
    """

    def __init__(self):
        self._state: dict[str, dict[str, float]] = {}   # {device_id: {channel_id: value}}

    def update(self, device_id: str, channel_id: str, value: float) -> bool:
        """
        Update state and return True if the value actually changed.
        """
        if device_id not in self._state:
            self._state[device_id] = {}
        prev = self._state[device_id].get(channel_id)
        if prev is not None and abs(prev - value) < 0.001:
            return False   # unchanged
        self._state[device_id][channel_id] = value
        return True        # changed

    def get(self, device_id: str, channel_id: str) -> float:
        return self._state.get(device_id, {}).get(channel_id, 0.0)

    def get_device(self, device_id: str) -> dict[str, float]:
        return dict(self._state.get(device_id, {}))

    def get_all(self) -> dict[str, dict[str, float]]:
        return {d: dict(c) for d, c in self._state.items()}

    def zero_all(self) -> dict[str, dict[str, float]]:
        """Zero all channels and return the previous state (for E-stop)."""
        previous = self.get_all()
        for device_id in self._state:
            for channel_id in self._state[device_id]:
                self._state[device_id][channel_id] = 0.0
        return previous


# ── Safety Guard ──────────────────────────────────────────────────────────────

class SafetyGuard:
    """
    Per-device runtime safety enforcement.
    Blocks commands that would violate safety limits.
    Reports violations to the safety kernel.
    """

    def __init__(self):
        self._on_time_start: dict[str, float] = {}   # device_id → monotonic time when turned on
        self._cumulative_on: dict[str, float] = {}   # device_id → seconds on this hour
        self._blocked_until: dict[str, float] = {}   # device_id → unblock time
        self._limits:        dict[str, Any]   = {}   # device_id → SafetyLimit

    def load_limits(self, safety_limits: dict) -> None:
        """Load compiled safety limits from CompiledShow.safety_limits."""
        self._limits = safety_limits

    def check(self, event: CompiledEvent) -> tuple[bool, str, CompiledEvent]:
        """
        Check if an event is safe to dispatch.
        Returns (allowed: bool, reason: str).
        """
        limit = self._limits.get(event.device_id)
        if not limit:
            return True, "no_limit", event

        # Check if device is in cooldown
        now = time.monotonic()
        blocked_until = self._blocked_until.get(event.device_id, 0)
        if now < blocked_until:
            remaining = blocked_until - now
            return False, f"cooldown:{remaining:.1f}s_remaining", event

        # Fire devices: track continuous on time
        if limit.get("max_on_duration_ms", 3_600_000) < 60_000:
            max_on_s = limit["max_on_duration_ms"] / 1000

            if event.value > 0.01:
                # Device being turned on
                if event.device_id not in self._on_time_start:
                    self._on_time_start[event.device_id] = now

                on_duration = now - self._on_time_start.get(event.device_id, now)
                if on_duration >= max_on_s:
                    # Force off and enter cooldown
                    min_off_s = limit.get("min_off_duration_ms", 5000) / 1000
                    self._blocked_until[event.device_id] = now + min_off_s
                    self._on_time_start.pop(event.device_id, None)
                    logger.warning(
                        f"[SafetyGuard] {event.device_id} exceeded max on time "
                        f"({max_on_s}s) — forced off for {min_off_s}s"
                    )
                    return False, f"max_on_exceeded:forced_off:{min_off_s}s", event
            else:
                # Device being turned off
                if event.device_id in self._on_time_start:
                    self._on_time_start.pop(event.device_id)

        # Check max intensity ceiling
        max_intensity = limit.get("max_intensity", 1.0)
        if event.value > max_intensity:
            logger.debug(
                f"[SafetyGuard] {event.device_id} intensity clamped "
                f"{event.value:.3f} → {max_intensity:.3f}"
            )
            event = replace(event, value=max_intensity)

        return True, "ok", event

    def get_status(self) -> dict:
        now = time.monotonic()
        return {
            device_id: {
                "blocked":    now < until,
                "blocked_until": round(until - now, 1) if now < until else 0,
                "on_since":   round(now - self._on_time_start[device_id], 1)
                              if device_id in self._on_time_start else None,
            }
            for device_id, until in self._blocked_until.items()
        }


# ── Protocol Router ───────────────────────────────────────────────────────────

class ProtocolRouter:
    """
    Routes compiled events to the correct protocol driver based on the
    device address map loaded from the CompiledShow.
    """

    def __init__(self, protocol_bus):
        """
        protocol_bus: the existing AquaFlow ProtocolBus instance
        (from engine/protocol_bus.py — not modified by Team D)
        """
        self._bus        = protocol_bus
        self._device_map: dict[str, Any] = {}  # device_id → DeviceAddress

    def load_device_map(self, device_map: dict) -> None:
        """Load and normalize device map from compiled show."""
        self._device_map = {
            device_id: normalize_device_address(address)
            for device_id, address in (device_map or {}).items()
        }

    async def dispatch(self, event: CompiledEvent) -> bool:
        """
        Translate a CompiledEvent into a protocol bus command and send it.
        Returns True if dispatched successfully.
        """
        address = self._device_map.get(event.device_id)
        if not address:
            logger.debug(f"[ProtocolRouter] No address for device {event.device_id}")
            return False

        protocol = address.get("protocol", "relay")

        try:
            if protocol in ("dmx", "artnet", "sacn"):
                return await self._dispatch_dmx(event, address, protocol)
            elif protocol == "modbus":
                return await self._dispatch_modbus(event, address)
            elif protocol == "relay":
                return await self._dispatch_relay(event, address)
            else:
                logger.warning(f"[ProtocolRouter] Unknown protocol: {protocol}")
                return False
        except Exception as exc:
            logger.error(f"[ProtocolRouter] Dispatch failed for {event.device_id}: {exc}")
            return False

    async def _dispatch_dmx(self, event: CompiledEvent, address: dict, protocol: str) -> bool:
        """
        Convert a normalized value to DMX and send.

        Supports:
        - camelCase/snake_case normalized addresses
        - profile channel offsets
        - signed motion channels: pan / tilt / angle
        """
        address = normalize_device_address(address)

        universe = address.get("dmx_universe", 1)
        start_ch = address.get("dmx_channel", 1) - 1
        profile = address.get("dmx_profile", "dimmer_1ch")
        profile_map = _get_profile_map(profile)

        channel_offset = profile_map.get(event.channel_id, 0)
        absolute_channel = start_ch + channel_offset

        signed_channels = {"pan", "tilt", "angle"}

        if event.channel_id in signed_channels:
            raw_value = int(max(0, min(255, ((event.value + 1.0) / 2.0) * 255)))
        else:
            raw_value = int(max(0, min(255, event.value * 255)))

        channels = {
            absolute_channel: raw_value
        }

        return await self._bus.send_artnet({
            "universe": universe - 1,
            "channels": channels,
        })

    async def _dispatch_modbus(self, event: CompiledEvent, address: dict) -> bool:
        """
        Write a normalized value to a Modbus register.
        uint16:  maps 0.0-1.0 → 0-65535
        coil:    maps value > 0.5 → True
        """
        plc_host   = address.get("plc_host", "127.0.0.1")
        plc_port   = address.get("plc_port", 502)
        unit_id    = address.get("plc_unit_id", 1)
        register   = address.get("plc_register", 0)
        data_type  = address.get("plc_data_type", "uint16")

        if data_type == "coil":
            raw_value = event.value > 0.01
        elif data_type == "uint16":
            raw_value = int(event.value * 65535)
        else:
            raw_value = int(event.value * 65535)

        # TODO Phase 2: implement via protocol_bus Modbus driver
        # For now: log the intended command
        logger.debug(
            f"[ProtocolRouter] Modbus {plc_host}:{plc_port} "
            f"unit={unit_id} reg={register} val={raw_value}"
        )
        return True  # stub

    async def _dispatch_relay(self, event: CompiledEvent, address: dict) -> bool:
        """Simple relay on/off based on value threshold."""
        relay_board = address.get("relay_board_id", "default")
        relay_index = address.get("relay_index", 1)
        state       = event.value > 0.01

        # TODO Phase 2: implement via protocol_bus relay driver
        logger.debug(
            f"[ProtocolRouter] Relay {relay_board}:{relay_index} → {'ON' if state else 'OFF'}"
        )
        return True  # stub

    async def blackout(self) -> None:
        """Send zero to all known devices across all protocols."""
        logger.critical("[ProtocolRouter] BLACKOUT — zeroing all devices")
        try:
            await self._bus.blackout()
        except Exception as exc:
            logger.error(f"[ProtocolRouter] Blackout failed: {exc}")


# ── Runtime Bridge ────────────────────────────────────────────────────────────

class RuntimeBridge:
    """
    Main bridge: reads compiled events, runs safety checks, routes to hardware.
    Designed to be driven by the TimingEngine's SHOW tick (100Hz).
    """

    def __init__(self, protocol_bus, dry_run: bool = False):
        self._state       = BridgeState.IDLE
        self._compiled    = None          # the loaded CompiledShow dict
        self._events      = []            # sorted CompiledEvent list
        self._event_head  = 0             # index of next unprocessed event
        self._last_tick   = 0.0           # last playhead position processed
        self._dry_run     = dry_run       # NEW: if True, skip hardware output

        self.state_tracker = DeviceStateTracker()
        self.safety_guard  = SafetyGuard()
        self.router        = ProtocolRouter(protocol_bus)

    # ── Show Loading ──────────────────────────────────────────────────────────

    def load_compiled_show(self, compiled: dict) -> list[str]:
        """
        Load a CompiledShow (from runtimeSignalCompiler.js output, received via API).
        Returns a list of load warnings.
        """
        warnings = []

        self._compiled  = compiled
        raw_events      = compiled.get("events", [])

# Deserialize events and sort by (time ASC, priority DESC).
        # This matches RuntimePlaybackQueue.js tiebreak behavior so that
        # higher-priority events at the same timestamp are always dispatched
        # first — important when a safety event and a timeline event share t=0.
        self._events = sorted(
            [
                CompiledEvent(
                    time          = e["time"],
                    device_id     = e["deviceId"],
                    channel_id    = e["channelId"],
                    value         = e["value"],
                    easing        = e.get("easing", "linear"),
                    easing_params = e.get("easingParams", []),
                    priority      = e.get("priority", 2),
                    flags         = e.get("flags", 0),
                )
                for e in raw_events
            ],
            key=lambda ev: (ev.time, -ev.priority),
        )
        self._event_head = 0
        self._last_tick  = 0.0

        # Load device map into router
        self.router.load_device_map(compiled.get("deviceMap", {}))

        # Load safety limits
        self.safety_guard.load_limits(compiled.get("safetyLimits", {}))

        # Validate
        if not self._events:
            warnings.append("Compiled show has no events — nothing will output to hardware")

        self._state = BridgeState.READY
        logger.info(
            f"[RuntimeBridge] Show loaded: {len(self._events)} events, "
            f"duration={compiled.get('duration', 0):.1f}s"
        )
        return warnings

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def set_playing(self) -> None:
        if self._state == BridgeState.READY:
            self._state = BridgeState.PLAYING

    def set_paused(self) -> None:
        if self._state == BridgeState.PLAYING:
            self._state = BridgeState.PAUSED

    def set_stopped(self) -> None:
        self._state      = BridgeState.READY
        self._event_head = 0
        self._last_tick  = 0.0

    # ── Main Tick ─────────────────────────────────────────────────────────────

    async def tick(self, playhead: float, delta: float) -> None:
        """
        Called each SHOW tick (100Hz) by the TimingEngine.

        delta == -1.0 signals an E-stop condition.
        """
        # E-stop: immediate blackout, no further processing
        if delta == -1.0 or self._state == BridgeState.ESTOP:
            if self._state != BridgeState.ESTOP:
                self._state = BridgeState.ESTOP
                await self._execute_estop()
            return

        if self._state != BridgeState.PLAYING:
            return

        # Find all events that crossed the playhead since last tick
        newly_crossed = self._get_events_between(self._last_tick, playhead)
        self._last_tick = playhead

        for event in newly_crossed:
            # Safety check
            allowed, reason, event = self.safety_guard.check(event)
            if not allowed:
                logger.warning(
                    f"[RuntimeBridge] Blocked {event.device_id}/{event.channel_id} "
                    f"— safety: {reason}"
                )
                continue

            # Skip if value hasn't changed (avoid redundant protocol writes)
            changed = self.state_tracker.update(event.device_id, event.channel_id, event.value)
            if not changed and event.easing == "step":
                continue

            # DRY RUN: Log but do NOT send to hardware
            if self._dry_run:
                logger.info(f"[DRY-RUN] {event.device_id}/{event.channel_id} = {event.value:.3f} @ {playhead:.3f}s")
                continue

            # Route to hardware (only when dry_run=False)
            await self.router.dispatch(event)

    async def _execute_estop(self) -> None:
        """
        Immediate emergency stop:
        1. Zero all state tracker channels
        2. Send blackout to all protocols
        """
        logger.critical("[RuntimeBridge] EXECUTING EMERGENCY STOP")
        self.state_tracker.zero_all()
        await self.router.blackout()

    # ── Event Fetching ────────────────────────────────────────────────────────

    def _get_events_between(self, from_time: float, to_time: float) -> list[CompiledEvent]:
        """
        Return all events with time in (from_time, to_time].
        Uses the stored event_head index for O(1) typical case.
        """
        result = []
        i = self._event_head
        while i < len(self._events):
            e = self._events[i]
            if e.time > to_time:
                break
            if e.time > from_time:
                result.append(e)
                self._event_head = i + 1
            i += 1
        return result

    def seek(self, position: float) -> None:
        """Update event head after a seek operation."""
        self._last_tick  = position
        # Binary search for new event head
        lo, hi = 0, len(self._events)
        while lo < hi:
            mid = (lo + hi) >> 1
            if self._events[mid].time <= position:
                lo = mid + 1
            else:
                hi = mid
        self._event_head = lo

    # ── Status ────────────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        return {
            "state":          self._state.value,
            "event_count":    len(self._events),
            "event_head":     self._event_head,
            "last_tick":      round(self._last_tick, 3),
            "device_count":   len(self._compiled.get("deviceMap", {})) if self._compiled else 0,
            "safety_status":  self.safety_guard.get_status(),
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_bridge_instance: Optional[RuntimeBridge] = None


def get_runtime_bridge(protocol_bus=None, dry_run: bool = False) -> RuntimeBridge:
    """
    Return the global RuntimeBridge singleton.
    Must be initialized with a protocol_bus on first call.
    If protocol_bus is None, auto-creates VirtualProtocolBus for dry-run.
    
    Args:
        protocol_bus: Optional protocol bus instance
        dry_run: If True, skip all hardware output (only logs)
    """
    global _bridge_instance
    if _bridge_instance is None:
        if protocol_bus is None:
            protocol_bus = _create_virtual_bus()
            logger.info("[RuntimeBridge] Dry-run mode: using VirtualProtocolBus")
        _bridge_instance = RuntimeBridge(protocol_bus, dry_run=dry_run)
    return _bridge_instance


def reset_runtime_bridge() -> None:
    """Reset the global RuntimeBridge singleton. For test isolation."""
    global _bridge_instance
    _bridge_instance = None
    logger.info("[RuntimeBridge] Singleton reset")


def _create_virtual_bus():
    """Create a virtual protocol bus that captures commands in memory."""
    class VirtualProtocolBus:
        def __init__(self, name="virtual"):
            self._name = name
            self._dmx_state = {}
            self._command_count = 0
            self._blackout_count = 0

        async def send_artnet(self, data):
            universe = data.get("universe", 0)
            channels = data.get("channels", {})
            if universe not in self._dmx_state:
                self._dmx_state[universe] = {}
            for ch, val in channels.items():
                self._dmx_state[universe][ch] = val
            self._command_count += 1
            return True

        async def blackout(self):
            for universe in self._dmx_state:
                for ch in self._dmx_state[universe]:
                    self._dmx_state[universe][ch] = 0
            self._blackout_count += 1
            logger.critical("[VirtualBus] BLACKOUT executed")

        def get_dmx_state(self, universe=None):
            if universe is not None:
                return dict(self._dmx_state.get(universe, {}))
            return {u: dict(ch) for u, ch in self._dmx_state.items()}

        def get_state(self):
            return {
                "bus_type": "virtual",
                "bus_name": self._name,
                "dmx": self.get_dmx_state(),
                "stats": {
                    "command_count": self._command_count,
                    "blackout_count": self._blackout_count,
                },
            }

    return VirtualProtocolBus()


# ── Internal: Fixture Profile Channel Map ─────────────────────────────────────

def _pick(address: dict, camel_key: str, snake_key: str, default=None):
    """Read either camelCase or snake_case address fields safely."""
    if camel_key in address:
        return address.get(camel_key, default)
    if snake_key in address:
        return address.get(snake_key, default)
    return default


def normalize_device_address(address: dict) -> dict:
    """
    Normalize device address fields so runtime bridge accepts both:
    - frontend camelCase
    - backend snake_case

    This keeps Team D runtime bridge compatible with runtimeSignalSchema.js.
    """
    if not isinstance(address, dict):
        return {}

    return {
        **address,
        "protocol": address.get("protocol", "relay"),

        "dmx_universe": _pick(address, "dmxUniverse", "dmx_universe", 1),
        "dmx_channel": _pick(address, "dmxChannel", "dmx_channel", 1),
        "dmx_profile": _pick(address, "dmxProfile", "dmx_profile", "dimmer_1ch"),

        "plc_host": _pick(address, "plcHost", "plc_host", "127.0.0.1"),
        "plc_port": _pick(address, "plcPort", "plc_port", 502),
        "plc_unit_id": _pick(address, "plcUnitId", "plc_unit_id", 1),
        "plc_register": _pick(address, "plcRegister", "plc_register", 0),
        "plc_data_type": _pick(address, "plcDataType", "plc_data_type", "uint16"),

        "relay_board_id": _pick(address, "relayBoardId", "relay_board_id", "default"),
        "relay_index": _pick(address, "relayIndex", "relay_index", 1),
    }

_PROFILE_OFFSETS = {
    "dimmer_1ch":   {"intensity": 0},
    "rgb_3ch":      {"r": 0, "g": 1, "b": 2},
    "rgbw_4ch":     {"r": 0, "g": 1, "b": 2, "w": 3},
    "rgbwi_5ch":    {"r": 0, "g": 1, "b": 2, "w": 3, "intensity": 4},
    "moving_head_8ch": {"pan": 0, "tilt": 1, "intensity": 2, "r": 3, "g": 4, "b": 5, "speed": 6},
    "vfd_pump_2ch": {"pump_speed": 0, "direction": 1},
    "vfd_pump_pressure_2ch": {"pump_speed": 0, "pressure": 1},
    "motion_1d_2ch": {"angle": 0, "speed": 1},
    "fog_machine_2ch": {"fog_density": 0, "fog_fan": 1},
    "relay_1ch":    {"enable": 0},
    "laser_2ch":    {"laser_beam": 0, "laser_pattern": 1},
}


def _get_profile_map(profile: str) -> dict[str, int]:
    return _PROFILE_OFFSETS.get(profile, {"intensity": 0})
