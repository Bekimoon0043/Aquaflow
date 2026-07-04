"""
device_registry.py — AquaFlow Team D
Device address registry scaffold.

Maps logical device IDs (from engineering design) to physical hardware addresses
(DMX universe/channel, Modbus register, relay board/index).

This is the single source of truth for all hardware routing.
Stored as: backend/data/device_registry.json

Does NOT touch:
  - Frontend timeline, ShowProgrammerPanel
  - showStore.js, engineeringStore.js
  - Persistence routes (show_programmer_routes.py)
  - show_engine.py, protocol_bus.py (reads from those, doesn't modify)
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Any, Optional

# ── Storage ───────────────────────────────────────────────────────────────────

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "data" / "device_registry.json"
REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)


# ── Enums ─────────────────────────────────────────────────────────────────────

class Protocol(str, Enum):
    DMX    = "dmx"
    ARTNET = "artnet"
    SACN   = "sacn"
    MODBUS = "modbus"
    RELAY  = "relay"
    CANBUS = "canbus"


class EmergencyState(str, Enum):
    OFF   = "off"    # zero all channels
    CLOSE = "close"  # close valve / relay
    HOLD  = "hold"   # hold last position (for motors)


# ── Data Classes ──────────────────────────────────────────────────────────────

@dataclass
class DeviceAddress:
    """
    Physical hardware address for one fountain device.
    Only fields relevant to the active protocol need to be populated.
    """
    # Logical identity
    device_id:    str
    device_type:  str                    # "geyser", "light_uw_rgb_36w", etc.
    zone:         str         = "main"   # spatial zone name
    group_id:     str         = ""       # control group (center_jets, rgb_lights, etc.)
    label:        str         = ""       # human-readable label

    # Protocol routing
    protocol:     Protocol    = Protocol.RELAY

    # DMX / Art-Net / sACN
    dmx_universe: int         = 1        # 1-indexed
    dmx_channel:  int         = 1        # 1-indexed, start channel
    dmx_channels: int         = 1        # number of channels consumed
    dmx_profile:  str         = "dimmer_1ch"

    # Modbus / PLC
    plc_host:     str         = ""       # "192.168.1.10"
    plc_port:     int         = 502      # Modbus TCP default
    plc_unit_id:  int         = 1
    plc_register: int         = 0        # holding register address
    plc_data_type:str         = "uint16"  # "uint16" | "float32" | "coil" | "bit"

    # Relay board
    relay_board_id: str       = ""
    relay_index:  int         = 1        # 1-indexed

    # Latency compensation
    latency_ms:   int         = 0        # hydraulic/mechanical lag to pre-compensate

    # Safety
    emergency_state: EmergencyState = EmergencyState.OFF
    requires_manual_enable: bool    = False

    def to_dict(self) -> dict:
        d = asdict(self)
        d["protocol"]        = self.protocol.value
        d["emergency_state"] = self.emergency_state.value
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "DeviceAddress":
        d = dict(d)
        d["protocol"]        = Protocol(d.get("protocol", "relay"))
        d["emergency_state"] = EmergencyState(d.get("emergency_state", "off"))
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


@dataclass
class SafetyLimit:
    """Per-device safety operating limits."""
    device_id:             str
    max_intensity:         float  = 1.0
    max_on_duration_ms:    int    = 3_600_000   # 1 hour default
    min_off_duration_ms:   int    = 0
    max_on_per_hour:       int    = 9999
    requires_manual_enable: bool  = False
    interlock_chain:       Optional[str] = None
    cooldown_temp_c:       float  = 85.0        # thermal limit
    emergency_state:       EmergencyState = EmergencyState.OFF

    def to_dict(self) -> dict:
        d = asdict(self)
        d["emergency_state"] = self.emergency_state.value
        return d


# ── Device Registry ───────────────────────────────────────────────────────────

class DeviceRegistry:
    """
    In-memory device registry with file persistence.

    Usage:
        registry = DeviceRegistry()
        registry.load()
        addr = registry.get("geyser-01")
        group = registry.get_by_group("center_jets")
    """

    def __init__(self, path: Path = REGISTRY_PATH):
        self._path    = path
        self._devices: dict[str, DeviceAddress] = {}
        self._limits:  dict[str, SafetyLimit]   = {}

    # ── CRUD ──────────────────────────────────────────────────────────────────

    def register(self, address: DeviceAddress, limit: Optional[SafetyLimit] = None) -> None:
        """Add or update a device address in the registry."""
        self._devices[address.device_id] = address
        if limit:
            self._limits[address.device_id] = limit
        else:
            self._limits[address.device_id] = _default_safety_limit(address)

    def get(self, device_id: str) -> Optional[DeviceAddress]:
        return self._devices.get(device_id)

    def get_limit(self, device_id: str) -> Optional[SafetyLimit]:
        return self._limits.get(device_id)

    def remove(self, device_id: str) -> bool:
        removed = device_id in self._devices
        self._devices.pop(device_id, None)
        self._limits.pop(device_id, None)
        return removed

    def all_devices(self) -> list[DeviceAddress]:
        return list(self._devices.values())

    # ── Query ─────────────────────────────────────────────────────────────────

    def get_by_group(self, group_id: str) -> list[DeviceAddress]:
        return [d for d in self._devices.values() if d.group_id == group_id]

    def get_by_zone(self, zone: str) -> list[DeviceAddress]:
        return [d for d in self._devices.values() if d.zone == zone]

    def get_by_protocol(self, protocol: Protocol) -> list[DeviceAddress]:
        return [d for d in self._devices.values() if d.protocol == protocol]

    def get_by_universe(self, universe: int) -> list[DeviceAddress]:
        return [
            d for d in self._devices.values()
            if d.protocol in (Protocol.DMX, Protocol.ARTNET, Protocol.SACN)
            and d.dmx_universe == universe
        ]

    def get_by_type(self, device_type: str) -> list[DeviceAddress]:
        return [d for d in self._devices.values() if d.device_type == device_type]

    # ── Validation ────────────────────────────────────────────────────────────

    def validate(self) -> list[str]:
        """
        Check for configuration errors.
        Returns a list of error strings (empty = valid).
        """
        errors = []

        # Check for DMX channel collisions within the same universe
        universe_channels: dict[tuple[int, int], str] = {}
        for device in self._devices.values():
            if device.protocol not in (Protocol.DMX, Protocol.ARTNET, Protocol.SACN):
                continue
            for ch_offset in range(device.dmx_channels):
                key = (device.dmx_universe, device.dmx_channel + ch_offset)
                if key in universe_channels:
                    errors.append(
                        f"DMX collision: Universe {key[0]} Ch {key[1]} "
                        f"used by '{device.device_id}' and '{universe_channels[key]}'"
                    )
                else:
                    universe_channels[key] = device.device_id

        # Check for channels beyond 512 per universe
        universe_ends: dict[int, int] = {}
        for device in self._devices.values():
            if device.protocol not in (Protocol.DMX, Protocol.ARTNET, Protocol.SACN):
                continue
            end_ch = device.dmx_channel + device.dmx_channels - 1
            if end_ch > 512:
                errors.append(
                    f"DMX overflow: Device '{device.device_id}' "
                    f"ends at Universe {device.dmx_universe} Ch {end_ch} (> 512)"
                )

        # Check for Modbus register collisions on the same PLC
        plc_registers: dict[tuple[str, int, int], str] = {}
        for device in self._devices.values():
            if device.protocol != Protocol.MODBUS:
                continue
            key = (device.plc_host, device.plc_unit_id, device.plc_register)
            if key in plc_registers:
                errors.append(
                    f"Modbus collision: {device.plc_host}:{device.plc_unit_id} "
                    f"Register {device.plc_register} used by '{device.device_id}' "
                    f"and '{plc_registers[key]}'"
                )
            else:
                plc_registers[key] = device.device_id

        return errors

    # ── Auto Channel Assignment ───────────────────────────────────────────────

    def auto_assign_dmx(
        self,
        devices: list[DeviceAddress],
        start_universe: int = 1,
        start_channel: int  = 1,
    ) -> list[str]:
        """
        Automatically assign conflict-free DMX addresses to ``devices`` and register
        them.

        Conflict-free means the packer honours channels already occupied by
        DMX/Art-Net/sACN devices registered earlier — i.e. manually / explicitly
        addressed fixtures. Those are reserved first and the incoming ``devices`` are
        first-fit packed into the remaining free channels, rolling to the next
        universe when one fills (AQ-X-001). Delegates to ``dmx_assigner``.

        Returns a list of warnings (manual collisions, overflow, exhaustion).
        """
        from services.dmx_assigner import DMXFixture, assign_dmx

        incoming = {d.device_id for d in devices}

        # Reserve already-registered DMX devices (manual/explicit addresses) as locks.
        fixtures: list[DMXFixture] = []
        for d in self._devices.values():
            if d.protocol in (Protocol.DMX, Protocol.ARTNET, Protocol.SACN) and d.device_id not in incoming:
                fixtures.append(DMXFixture(
                    id=d.device_id, channels=d.dmx_channels, profile=d.dmx_profile,
                    locked=True, universe=d.dmx_universe, channel=d.dmx_channel,
                ))

        for d in devices:
            fixtures.append(DMXFixture(
                id=d.device_id, channels=d.dmx_channels, profile=d.dmx_profile, locked=False,
            ))

        _, warnings = assign_dmx(fixtures, start_universe=start_universe, start_channel=start_channel)

        placed = {f.id: f for f in fixtures}
        for d in devices:
            f = placed.get(d.device_id)
            if f and f.universe:
                d.dmx_universe = f.universe
                d.dmx_channel  = f.channel
            self.register(d)

        return warnings

    # ── Persistence ───────────────────────────────────────────────────────────

    def load(self) -> None:
        """Load registry from JSON file. Creates empty registry if file absent."""
        if not self._path.exists():
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            self._devices = {
                d["device_id"]: DeviceAddress.from_dict(d)
                for d in raw.get("devices", [])
            }
            self._limits = {
                lim["device_id"]: SafetyLimit(**{
                    k: v for k, v in lim.items() if k != "emergency_state"
                } | {"emergency_state": EmergencyState(lim.get("emergency_state", "off"))})
                for lim in raw.get("safety_limits", [])
            }
        except Exception as exc:
            raise RuntimeError(f"Failed to load device registry: {exc}") from exc

    def save(self) -> None:
        """Persist registry to JSON file."""
        payload = {
            "version":  "1.0",
            "devices":  [d.to_dict() for d in self._devices.values()],
            "safety_limits": [lim.to_dict() for lim in self._limits.values()],
        }
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def to_dict(self) -> dict:
        """Return full registry as a dict (for API responses)."""
        return {
            "device_count": len(self._devices),
            "devices":      [d.to_dict() for d in self._devices.values()],
            "safety_limits":[lim.to_dict() for lim in self._limits.values()],
            "validation":   self.validate(),
        }


# ── Default Safety Limit Factory ─────────────────────────────────────────────

def _default_safety_limit(address: DeviceAddress) -> SafetyLimit:
    dtype = address.device_type

    if "flame" in dtype or "fire" in dtype:
        return SafetyLimit(
            device_id             = address.device_id,
            max_on_duration_ms    = 10_000,
            min_off_duration_ms   = 5_000,
            max_on_per_hour       = 120,
            requires_manual_enable= True,
            interlock_chain       = "chain_b_fire",
            emergency_state       = EmergencyState.OFF,
        )

    if "laser" in dtype:
        return SafetyLimit(
            device_id           = address.device_id,
            interlock_chain     = "chain_c_laser",
            emergency_state     = EmergencyState.OFF,
        )

    if "motion" in dtype:
        return SafetyLimit(
            device_id           = address.device_id,
            interlock_chain     = "chain_c_motion",
            emergency_state     = EmergencyState.HOLD,
        )

    return SafetyLimit(device_id=address.device_id)


# ── Singleton ─────────────────────────────────────────────────────────────────

_registry_instance: Optional[DeviceRegistry] = None


def get_device_registry() -> DeviceRegistry:
    """
    Return the global DeviceRegistry singleton.
    Loads from disk on first call.
    """
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = DeviceRegistry()
        _registry_instance.load()
    return _registry_instance
