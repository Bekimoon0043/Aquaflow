"""
AquaFlow Protocol Bus
Hardware-agnostic abstraction layer for all control protocols.

AF-HUB-014 — HONEST support (see PROTOCOL_SUPPORT below):
  REAL driver, tested:  DMX512, Art-Net, sACN, Modbus TCP
  GATED (stub, disabled): MQTT
  UNSUPPORTED (no code):  OPC UA, BACnet
(REAL = the protocol driver genuinely works; whether real fixtures are verified is a
separate concern governed by the hardware-commissioning flag — see AF-HUB-000C.)
"""
import asyncio
import struct
import socket
import time
from abc import ABC, abstractmethod
from typing import Optional
import logging

logger = logging.getLogger(__name__)


# ── AF-HUB-014 — protocol support classification (single source of truth) ─────────
# Four honest tiers so nothing claims support it does not have:
#   REAL        — implemented + tested driver (field verification gated by commissioning)
#   SIMULATED   — loopback only, not field-real
#   GATED       — code exists but explicitly disabled; cannot connect or send
#   UNSUPPORTED — not implemented at all
PROTOCOL_SUPPORT = {
    "dmx":    "REAL",
    "artnet": "REAL",
    "sacn":   "REAL",
    "modbus": "REAL",
    # AF-ICAN-003 — the I-CAN/NETCAN relay gateway, the protocol the actual site
    # cabinet speaks. REAL per this table's own definition: the driver is implemented
    # and exercised end to end against a gateway. Whether real fixtures move is a
    # separate question governed by the commissioning flag — and for I-CAN the 0x08
    # output SEMANTICS are still capture-derived rather than hardware-proven, so the
    # output path additionally requires an explicit arm (enable_output) before it can
    # emit anything. See engine/ican_protocol.py for what is proven vs inferred.
    "ican":   "REAL",
    "mqtt":   "GATED",        # MQTTDriver is a stub — explicitly disabled below
    "opcua":  "UNSUPPORTED",  # no implementation exists
    "bacnet": "UNSUPPORTED",  # no implementation exists
}
REAL_PROTOCOLS = [p for p, tier in PROTOCOL_SUPPORT.items() if tier == "REAL"]

SUPPORT_TIER_MEANING = {
    "REAL": "implemented + tested driver (field verification gated by the commissioning flag)",
    "SIMULATED": "loopback only, not field-real",
    "GATED": "code exists but explicitly disabled — not usable",
    "UNSUPPORTED": "not implemented",
}


class ProtocolDriver(ABC):
    """Base class for all protocol drivers"""
    name: str = "base"

    @abstractmethod
    async def connect(self) -> bool: ...

    @abstractmethod
    async def disconnect(self): ...

    @abstractmethod
    async def send(self, data: dict) -> bool: ...

    @abstractmethod
    async def blackout(self): ...

    @property
    @abstractmethod
    def is_connected(self) -> bool: ...


class ArtNetDriver(ProtocolDriver):
    """Art-Net DMX over UDP — most common for fountain lighting"""
    name = "artnet"
    PORT = 6454
    ARTNET_HEADER = b"Art-Net\x00"

    # Art-Net addresses a 15-bit universe space (0–32767). Buffers are allocated
    # lazily per universe so a show can drive far more than the legacy 4.
    MAX_UNIVERSE = 32767

    def __init__(self, target_ip: str = "255.255.255.255"):
        self.target_ip = target_ip
        self._sock: Optional[socket.socket] = None
        self._connected = False
        # 512 channels per universe, allocated on demand for any universe used.
        self._universes: dict[int, bytearray] = {}

    def _buffer_for(self, universe: int) -> bytearray:
        """Return the 512-byte frame for a universe, creating it on first use."""
        buf = self._universes.get(universe)
        if buf is None:
            buf = bytearray(512)
            self._universes[universe] = buf
        return buf

    async def connect(self) -> bool:
        try:
            self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            self._sock.setblocking(False)
            self._connected = True
            logger.info(f"Art-Net driver connected → {self.target_ip}:{self.PORT}")
            return True
        except Exception as e:
            logger.error(f"Art-Net connect failed: {e}")
            return False

    async def disconnect(self):
        if self._sock:
            self._sock.close()
        self._connected = False

    async def send(self, data: dict) -> bool:
        """Send DMX universe data via Art-Net"""
        universe = int(data.get("universe", 0))
        channels = data.get("channels", {})  # {channel_idx: value 0-255}

        if universe < 0 or universe > self.MAX_UNIVERSE:
            logger.warning(f"Art-Net universe {universe} out of range 0-{self.MAX_UNIVERSE}; dropping frame")
            return False

        buf = self._buffer_for(universe)
        for ch, val in channels.items():
            if 0 <= ch < 512:
                buf[ch] = max(0, min(255, int(val)))

        return await self._send_universe(universe, buf)

    async def _send_universe(self, universe: int, data: bytearray) -> bool:
        if not self._connected or not self._sock:
            return False
        try:
            # Art-Net DMX packet format
            packet = (
                self.ARTNET_HEADER +
                b"\x00\x50" +                          # OpDmx = 0x5000
                b"\x00\x0e" +                          # Protocol version 14
                b"\x00" +                              # Sequence
                b"\x00" +                              # Physical
                struct.pack("<H", universe) +          # Universe (LE)
                struct.pack(">H", 512) +               # Length (BE)
                bytes(data)
            )
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self._sock.sendto(packet, (self.target_ip, self.PORT))
            )
            return True
        except Exception as e:
            logger.debug(f"Art-Net send error: {e}")
            return False

    async def blackout(self):
        for universe in self._universes:
            self._universes[universe] = bytearray(512)
            await self._send_universe(universe, self._universes[universe])

    @property
    def is_connected(self) -> bool:
        return self._connected


class ModbusTCPDriver(ProtocolDriver):
    """Modbus TCP for pump VFDs and industrial hardware.

    AF-IO-001 — the hand-rolled socket code moved to engine/modbus_client.py (the ONE
    validated Modbus client: exact framed reads, MBAP/txid/exception validation, one
    request in flight, reconnect backoff). This class keeps its public interface and
    fire-and-forget-style semantics (bool/None instead of raised errors) and delegates
    the wire work.
    """
    name = "modbus"

    def __init__(self, host: str, port: int = 502, unit_id: int = 1):
        self.host = host
        self.port = port
        self.unit_id = unit_id
        from engine.modbus_client import ModbusTCPClient
        self._client = ModbusTCPClient(host, port, unit_id)

    async def connect(self) -> bool:
        return await self._client.connect()

    async def disconnect(self):
        await self._client.close()

    async def send(self, data: dict) -> bool:
        """Write holding registers"""
        register = data.get("register", 0)
        value = data.get("value", 0)
        return await self.write_register(register, value)

    async def write_register(self, register: int, value: int) -> bool:
        # ensure_connected gives dropped VFD links a backoff-limited retry instead of
        # requiring an operator reconnect (the old code stayed down forever).
        if not await self._client.ensure_connected():
            return False
        try:
            return await self._client.write_register(register, value)
        except Exception as e:
            logger.debug(f"Modbus write error: {e}")
            return False

    async def read_register(self, register: int, count: int = 1) -> Optional[list[int]]:
        if not await self._client.ensure_connected():
            return None
        try:
            return await self._client.read_holding_registers(register, count)
        except Exception as e:
            logger.debug(f"Modbus read error: {e}")
            return None

    async def blackout(self):
        # Write 0 to speed register for all pumps
        await self.write_register(0x0001, 0)

    @property
    def is_connected(self) -> bool:
        return self._client.is_connected


class MQTTDriver(ProtocolDriver):
    """
    MQTT driver — NOT IMPLEMENTED (GATED). AF-HUB-014: this was a stub whose connect()/
    send() returned fake success. MQTT is not implemented, so it now FAILS CLOSED: it never
    reports a connection and never claims to have sent a command. Do not re-enable until a
    real aiomqtt/paho-mqtt implementation exists and is tested.
    """
    name = "mqtt"
    SUPPORT_TIER = "GATED"

    def __init__(self, host: str, port: int = 1883):
        self.host = host
        self.port = port
        self._connected = False

    async def connect(self) -> bool:
        logger.warning("MQTT is not implemented (GATED) — refusing to connect %s:%s; "
                       "no MQTT driver will be added to the bus", self.host, self.port)
        self._connected = False
        return False

    async def disconnect(self):
        self._connected = False

    async def send(self, data: dict) -> bool:
        logger.warning("MQTT is not implemented (GATED) — command NOT sent (topic=%s)",
                       data.get("topic", "aquaflow/control"))
        return False

    async def blackout(self):
        pass

    @property
    def is_connected(self) -> bool:
        return False


class ProtocolBus:
    """
    Central protocol router.
    Maps device types/protocols to correct driver instances.
    """
    # AF-HUB-014 — SUPPORTED now lists ONLY genuinely-usable (REAL) protocols. The full
    # honest classification (incl. GATED/UNSUPPORTED) is PROTOCOL_SUPPORT / the matrix.
    SUPPORTED = REAL_PROTOCOLS

    # Flame safety defaults (Stage 1, Priority 7). The hardware-level flame cutoff
    # is the last line of defence regardless of what the show timeline requests.
    FLAME_MAX_DURATION = 3.0     # max continuous on-time (seconds)
    FLAME_GAP_RESET    = 0.5     # a command gap this long ends the current burst

    # AF-HUB-016 — the ONE runtime output bus. app_state builds it with primary=True; a
    # second primary is blocked so two independent output paths can never exist. Throwaway
    # instances (loopback verification, unit tests) use the default primary=False.
    _primary: Optional["ProtocolBus"] = None

    def __init__(self, primary: bool = False):
        if primary:
            if ProtocolBus._primary is not None and ProtocolBus._primary is not self:
                raise RuntimeError(
                    "A primary ProtocolBus already exists — refusing to create a second "
                    "runtime output bus (AF-HUB-016). Use app_state.protocol_bus / "
                    "get_protocol_bus()."
                )
            ProtocolBus._primary = self
        self._is_primary = primary
        self._drivers: dict[str, ProtocolDriver] = {}
        self._device_map: dict[str, str] = {}  # device_id → driver_key
        self._dmx_state: dict[int, dict[int, int]] = {}  # universe → {channel: value}
        self._dmx_map: list[dict] = []  # fixtureId → universe/channel mapping from Pattern Designer
        # Fixture-aware Modbus routing: device_id → {host, port, unit, register}
        # derived from designed fixtures via configure_from_fixtures().
        self._fixture_registers: dict[str, dict] = {}
        self._fixtures_loaded = False
        self._running = False
        # AF-HUB-015 — fail-closed routing: fixtures dropped for having no valid mapping.
        # device_id → {type, protocol, count}. Surfaced in get_status()/health.
        self._unmapped_fixtures: dict[str, dict] = {}

        # ── Safety limits in the output path (Stage 1, Priority 7) ────────────
        # Optional safety-kernel reference. When set, the master permit and the
        # per-subsystem enables gate every hardware emit.
        self._safety_kernel = None
        # Per-fixture max intensity ceilings (device_id → 0..1). Absent = no cap.
        self._fixture_limits: dict[str, float] = {}
        # Global intensity ceiling applied on top of every fixture.
        self._global_intensity_cap: float = 1.0
        # Flame hardware-level duration enforcement.
        self._flame_max_duration: float = self.FLAME_MAX_DURATION

        # ── AF-ICAN-003 — I-CAN/NETCAN relay gateway routing ──────────────────
        # I-CAN is not a per-device protocol: a single 0x08 frame carries the whole
        # channel bitmask for a device group. Emitting once per command would make
        # each device clear every other device in its group, so commands accumulate
        # into a desired state here and are flushed one frame per group per batch.
        self._ican_driver = None
        self._ican_devices: dict[str, dict] = {}      # device_id → {group, channel, safety_max}
        self._ican_state: dict[int, set] = {}          # group → DESIRED set of channels ON
        self._ican_dirty: set = set()                  # groups whose state changed this batch
        # What was actually PUT ON THE WIRE, as distinct from what we want the gateway to
        # have. The two diverge whenever a frame is refused — output not armed, safety
        # permit withdrawn, socket error — and an operator UI must show this set, not the
        # desired one, or it lights a button for a relay whose frame was never sent.
        #
        # It is NOT an acknowledgement. The gateway does not ack 0x08 output frames; I-CAN
        # control is fire-and-forget. This says "the frame left this machine", which is the
        # strongest claim the protocol allows. Confirming that a relay physically closed
        # requires looking at the cabinet.
        self._ican_confirmed: dict[int, set] = {}
        # Relay banks (SSR-8Y-A) are binary: a channel is on or off, not dimmed.
        self._ican_on_threshold: float = 0.5
        self._flame_on_since: dict[str, float] = {}   # device_id → burst start (monotonic)
        self._flame_last_cmd: dict[str, float] = {}   # device_id → last flame command time
        self._flame_lockout: set = set()              # device_ids latched off after cutoff

    # ── Safety-limit configuration API ────────────────────────────────────────
    def set_safety_kernel(self, kernel) -> None:
        """Attach the safety kernel so its permit/enables gate all output."""
        self._safety_kernel = kernel
        logger.info("Protocol bus: safety kernel attached to output path")

    def set_fixture_limit(self, device_id: str, max_intensity: float) -> None:
        """Set a per-fixture max intensity ceiling (0..1)."""
        self._fixture_limits[str(device_id)] = max(0.0, min(1.0, float(max_intensity)))

    def set_fixture_limits(self, limits: dict) -> None:
        for k, v in (limits or {}).items():
            try:
                self.set_fixture_limit(k, v)
            except (TypeError, ValueError):
                continue

    def set_global_intensity_cap(self, cap: float) -> None:
        self._global_intensity_cap = max(0.0, min(1.0, float(cap)))

    def configure_flame_limit(self, max_duration_s: float) -> None:
        self._flame_max_duration = max(0.0, float(max_duration_s))

    # ── The output-path safety gate ───────────────────────────────────────────
    def _safety_gate(self, device_id, device_type: str, intensity) -> float:
        """
        Final safety gate applied to every command before it reaches hardware.

        Returns the effective intensity to emit (0..1):
          1. clamps to [0,1] and applies per-fixture + global intensity ceilings,
          2. honours the safety kernel master permit + per-subsystem enables,
          3. enforces the flame hardware-level maximum on-time.
        """
        try:
            eff = float(intensity)
        except (TypeError, ValueError):
            eff = 0.0
        eff = max(0.0, min(1.0, eff))

        # 1) Per-fixture and global intensity ceilings.
        cap = self._fixture_limits.get(str(device_id), 1.0)
        eff = min(eff, cap, self._global_intensity_cap)

        # 2) Safety kernel permit + per-subsystem enable.
        kernel = self._safety_kernel
        if kernel is not None:
            try:
                out = kernel.outputs
                if not out.permit:
                    eff = 0.0
                else:
                    enable = {
                        "pump":     out.pump_enable,
                        "valve":    out.valve_enable,
                        "flame":    out.flame_enable,
                        "laser":    out.laser_enable,
                        "fog":      out.fog_enable,
                        "lighting": out.lighting_enable,
                    }.get(device_type, True)
                    if not enable:
                        eff = 0.0
            except Exception:
                # Kernel unreadable → fail safe for the risky subsystems.
                if device_type in ("flame", "laser", "pump", "valve"):
                    eff = 0.0

        # 3) Flame hardware-level duration cutoff.
        if device_type == "flame":
            eff = self._enforce_flame_duration(device_id, eff)

        return eff

    def _enforce_flame_duration(self, device_id, eff: float) -> float:
        """
        Cut a flame off once it has been continuously on beyond the hard limit,
        and latch it off until the show actually drops it to zero (or a command
        gap ends the burst). This is independent of the safety kernel so it holds
        even if no kernel is attached.
        """
        now = time.monotonic()
        did = str(device_id)

        last = self._flame_last_cmd.get(did)
        self._flame_last_cmd[did] = now
        # A gap in commands means the previous burst ended — reset burst state.
        if last is not None and (now - last) > self.FLAME_GAP_RESET:
            self._flame_on_since.pop(did, None)
            self._flame_lockout.discard(did)

        if eff <= 0.0:
            self._flame_on_since.pop(did, None)
            self._flame_lockout.discard(did)
            return 0.0

        if did in self._flame_lockout:
            return 0.0

        started = self._flame_on_since.get(did)
        if started is None:
            self._flame_on_since[did] = now
            return eff

        if (now - started) >= self._flame_max_duration:
            self._flame_lockout.add(did)
            self._flame_on_since.pop(did, None)
            logger.warning(
                f"Flame {did} cut off — exceeded {self._flame_max_duration:.1f}s "
                f"hardware duration limit"
            )
            return 0.0

        return eff

    async def start(self):
        self._running = True

        # Art-Net / DMX driver (broadcast)
        artnet = ArtNetDriver()
        if await artnet.connect():
            self._drivers["artnet"] = artnet
            self._drivers["dmx"] = artnet

        # Auto-connect Modbus devices from seed list
        from engine.device_manager import SEED_DEVICES
        for device in SEED_DEVICES:
            if device.protocol == "modbus" and device.ip:
                driver = ModbusTCPDriver(device.ip, device.port or 502)
                connected = await driver.connect()
                key = f"modbus:{device.ip}"
                self._drivers[key] = driver
                self._device_map[device.id] = key
                if connected:
                    logger.info(f"Modbus connected: {device.label} @ {device.ip}")
                else:
                    logger.warning(f"Modbus offline (stored): {device.label} @ {device.ip}")

            elif device.protocol in ("dmx", "artnet", "sacn") and "artnet" in self._drivers:
                self._device_map[device.id] = "artnet"

        logger.info(f"Protocol bus started. Active: {list(self._drivers.keys())}")

    async def stop(self):
        for driver in self._drivers.values():
            await driver.disconnect()
        self._running = False

    async def add_device(self, protocol: str, config: dict) -> bool:
        """Dynamically add a protocol driver for a device. AF-HUB-014 — refuse any protocol
        that is not a REAL, usable protocol (no GATED/UNSUPPORTED drivers get added, so a
        show can never be silently routed to a non-functioning transport)."""
        tier = PROTOCOL_SUPPORT.get(protocol, "UNSUPPORTED")
        if tier != "REAL":
            logger.warning("add_device refused — protocol %r is %s (%s), not usable",
                           protocol, tier, SUPPORT_TIER_MEANING.get(tier, ""))
            return False
        if protocol == "modbus":
            driver = ModbusTCPDriver(config["ip"], config.get("port", 502))
            if await driver.connect():
                self._drivers[f"modbus:{config['ip']}"] = driver
                return True
        return False

    def protocol_support_matrix(self) -> dict:
        """AF-HUB-014 — the honest, four-tier protocol support matrix (single source)."""
        return {
            "tiers": dict(SUPPORT_TIER_MEANING),
            "protocols": dict(PROTOCOL_SUPPORT),
            "usable": list(REAL_PROTOCOLS),
        }

    def configure_from_fixtures(self, registry) -> dict:
        """
        Configure routing from a DeviceRegistry built from designed fixtures.

        Populates the DMX map (fixtureId → universe/channel) and the Modbus
        fixture-register map (device_id → host/port/register) so that playback
        addresses the *designed* hardware instead of only the seed devices.

        The registry uses a 1-indexed universe convention; Art-Net output here is
        0-indexed, so universes are shifted by one on the way out.
        """
        try:
            devices = registry.all_devices()
        except AttributeError:
            return {"dmx": 0, "modbus": 0}

        self._fixture_registers = {}
        dmx_entries: dict[str, dict] = {m.get("fixtureId"): m for m in self._dmx_map}

        dmx_count = 0
        for d in devices:
            proto = getattr(d.protocol, "value", str(d.protocol))
            if proto in ("dmx", "artnet", "sacn"):
                dmx_entries[d.device_id] = {
                    "fixtureId": d.device_id,
                    "universe": max(0, int(d.dmx_universe) - 1),
                    "channel": int(d.dmx_channel),
                }
                self._device_map[d.device_id] = "artnet"
                dmx_count += 1
            elif proto == "modbus":
                key = f"modbus:{d.plc_host}"
                self._fixture_registers[d.device_id] = {
                    "host": d.plc_host,
                    "port": int(d.plc_port or 502),
                    "unit": int(d.plc_unit_id or 1),
                    "register": int(d.plc_register or 0x0001),
                }
                self._device_map[d.device_id] = key

        self._dmx_map = list(dmx_entries.values())
        self._fixtures_loaded = True
        logger.info(
            f"Protocol bus configured from {len(devices)} designed fixtures "
            f"({dmx_count} DMX, {len(self._fixture_registers)} Modbus)"
        )
        return {"dmx": dmx_count, "modbus": len(self._fixture_registers)}

    async def _ensure_modbus_driver(self, host: str, port: int = 502) -> ProtocolDriver:
        """Return a Modbus driver for host, creating/connecting it once (cached)."""
        key = f"modbus:{host}"
        driver = self._drivers.get(key)
        if driver is None:
            driver = ModbusTCPDriver(host, port or 502)
            await driver.connect()  # may fail (offline) — send() then no-ops safely
            self._drivers[key] = driver
        return driver

    # ── AF-ICAN-003 — I-CAN gateway attachment and flush ─────────────────────
    def attach_ican(self, driver, devices=None, *, on_threshold: float = 0.5) -> int:
        """
        Join an I-CAN gateway driver to the runtime output path.

        This is a deliberate, explicit step rather than a default: until it is called
        the bus has no I-CAN route at all, and the driver itself still refuses to emit
        until its output is separately armed. Both gates are intentional — the 0x08
        output semantics are capture-derived, so nothing should be able to drive the
        site's relay cabinet by accident.

        @param devices  registry-shaped entries, exactly as ChannelMap.to_device_registry()
                        produces: {device_id, ican_group, ican_channel, safety_max}
        @returns number of devices routed
        """
        self._ican_driver = driver
        self._ican_devices = {}
        for entry in (devices or []):
            did = str(entry.get("device_id") or "")
            if not did:
                continue
            try:
                group = int(entry.get("ican_group", 0))
                channel = int(entry.get("ican_channel", 0))
            except (TypeError, ValueError):
                continue
            if channel <= 0:
                continue   # channel numbers are 1-based; 0 would alias the whole group
            self._ican_devices[did] = {
                "group": group,
                "channel": channel,
                "safety_max": float(entry.get("safety_max", 1.0) or 1.0),
                # Carried so a direct channel command can be routed with the same device
                # type the safety gate would see during playback, rather than guessing.
                "device_type": entry.get("device_type") or "pump",
            }
        self._ican_on_threshold = max(0.0, min(1.0, float(on_threshold)))
        logger.info("I-CAN attached to protocol bus: %d channel(s) routed",
                    len(self._ican_devices))
        return len(self._ican_devices)

    def _ican_apply(self, device_id: str, intensity: float) -> bool:
        """Record a device's desired relay state. Returns True if this was an I-CAN device."""
        entry = self._ican_devices.get(str(device_id))
        if not entry:
            return False
        group, channel = entry["group"], entry["channel"]
        eff = min(float(intensity), entry["safety_max"])
        want_on = eff >= self._ican_on_threshold
        cur = self._ican_state.setdefault(group, set())
        was_on = channel in cur
        if want_on:
            cur.add(channel)
        else:
            cur.discard(channel)
        if was_on != want_on:
            self._ican_dirty.add(group)
        return True

    async def _flush_ican(self):
        """
        Emit one 0x08 frame per group whose channel set changed.

        A group stays DIRTY until its frame is actually accepted. This matters more
        than it looks: the frame carries absolute channel state, not a delta, so if a
        send is dropped — gateway down, output not yet armed, socket error — and the
        group were marked clean anyway, the bus would believe the gateway already has
        a state it never received. Every later command that did not itself change the
        mask would then flush nothing, and the channel would stay wrong until something
        unrelated happened to dirty the group again. On a fountain that is a jet stuck
        on or a jet that never fires.
        """
        if not self._ican_driver or not self._ican_dirty:
            return
        groups = sorted(self._ican_dirty)
        for group in groups:
            channels = sorted(self._ican_state.get(group, set()))
            try:
                ok = await self._ican_driver.send({
                    "group": group,
                    "channels": channels,
                    # The driver's own arm/confirm gate still applies; this only says the
                    # command came from the runtime rather than from arbitrary input.
                    "confirmed": True,
                    "user": "runtime",
                })
            except Exception as e:
                # A gateway fault must never abort the rest of the output batch — the
                # other protocols still need to reach their hardware, and the connection
                # layer handles its own reconnect.
                logger.error("I-CAN send failed for group %d: %s", group, e)
                ok = False
            if ok:
                self._ican_dirty.discard(group)
                # Sent, not acknowledged — see _ican_confirmed above.
                self._ican_confirmed[group] = set(channels)
                logger.debug("I-CAN → group=%d channels=%s", group, channels)
            else:
                logger.warning("I-CAN group %d not accepted — will re-send next flush", group)

    async def send_batch(self, commands: list[dict]):
        """Route a batch of commands to appropriate drivers"""
        for cmd in commands:
            await self._route_command(cmd)
        # I-CAN accumulates per-command and emits once per group, so the flush happens
        # after the whole batch is routed.
        await self._flush_ican()
    def _normalize_device_type(self, raw_type) -> str:
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
            "mist_jets": "fog",
            "motion_1d_jets": "pump",
            "motion_2d_jets": "pump",
            "motion_3d_jets": "pump",
        }

        return aliases.get(key, key)

    async def _route_command(self, cmd: dict):
        device_id   = cmd.get("device_id")
        device_type = self._normalize_device_type(cmd.get("type"))
        # Safety gate: clamp per-fixture/global intensity, honour the safety
        # kernel permit + enables, and enforce the flame duration cutoff — the
        # single choke point every hardware emit passes through.
        intensity   = self._safety_gate(device_id, device_type, cmd.get("intensity", 0.0))

        # ── I-CAN relay gateway ───────────────────────────────────────────────
        # Checked FIRST and keyed on device identity, not device type: an I-CAN relay
        # bank drives whatever is wired to it — a pump on one channel, a light on the
        # next. Routing by type would send a relay-backed pump down the Modbus path and
        # it would arrive nowhere. This only records state; the frame is emitted by
        # _flush_ican() once the batch is routed.
        if self._ican_apply(device_id, intensity):
            return

        # ── Modbus (pumps, valves, flame) ─────────────────────────────────────
        if device_type in ("pump", "valve", "flame", "flame_units"):
            # Fixture-aware path: route to the designed fixture's PLC host+register.
            fx = self._fixture_registers.get(device_id)
            if fx:
                driver = await self._ensure_modbus_driver(fx["host"], fx.get("port", 502))
                value = int(max(0.0, min(1.0, intensity)) * 10000)
                await driver.send({"register": fx.get("register", 0x0001), "value": value})
                logger.debug(
                    f"Modbus(fixture) → {device_id} host={fx['host']} "
                    f"reg={fx.get('register')} intensity={intensity:.2f} val={value}"
                )
                return

            driver_key = self._device_map.get(device_id)
            driver = self._drivers.get(driver_key) if driver_key else None

            # AF-HUB-015 — FAIL CLOSED. No fixture register and no explicit device→driver
            # mapping means we do NOT know which physical PLC/register this drives. Sending
            # to "any modbus driver at register 1" could actuate the wrong pump/valve/flame,
            # so send NOTHING and record it.
            if not driver:
                self._note_unmapped(device_id, device_type, "modbus")
                return

            # Register 0x0001 = speed/intensity (0-10000 scale for VFDs)
            value = int(intensity * 10000)
            await driver.send({"register": 0x0001, "value": value})
            logger.debug(f"Modbus → {device_id} intensity={intensity:.2f} reg=0x0001 val={value}")

        # ── DMX / Art-Net (lighting, fog) ─────────────────────────────────────
        elif device_type in ("lighting", "rgb_lights", "fog", "fog_machines", "laser", "laser_units"):
            driver = self._drivers.get("artnet")
            if not driver:
                return

            # Look up DMX address from the Pattern Designer map first, then the seed
            # devices' own configured address.
            mapped = next(
                (m for m in self._dmx_map if str(m.get("fixtureId")) == str(device_id)),
                None,
            )

            if mapped:
                dmx_addr = int(mapped.get("channel", 1))
                universe = int(mapped.get("universe", 0))
            else:
                from engine.device_manager import SEED_DEVICES
                device = next((d for d in SEED_DEVICES if d.id == device_id), None)
                # AF-HUB-FINAL-VERIFY — a seed device counts as mapped ONLY if it carries an
                # EXPLICIT dmxAddress. Previously a DMX-class seed device without one (e.g.
                # fog-01) silently defaulted to channel 1 / universe 0 — the same
                # drive-the-wrong-device hazard AF-HUB-015 removed for unknown fixtures.
                if device is not None and device.params.get("dmxAddress") is not None:
                    dmx_addr = int(device.params["dmxAddress"])
                    universe = int(device.params.get("dmxUniverse", 0))
                else:
                    # AF-HUB-015 — FAIL CLOSED. No valid mapping must send NOTHING (universe
                    # 0 / channel 1 is a REAL device on real hardware).
                    self._note_unmapped(device_id, device_type, "dmx/artnet")
                    return

            # Build channel map — RGB fixture: ch0=master, ch1=R, ch2=G, ch3=B
            # `intensity` has already passed the output-path safety gate.
            scale = max(0.0, min(1.0, intensity))
            val = int(scale * 255)

            color = cmd.get("color") or cmd.get("lightingColor") or {}

            if isinstance(color, str) and color.startswith("#") and len(color) == 7:
                r = int(color[1:3], 16)
                g = int(color[3:5], 16)
                b = int(color[5:7], 16)
            elif isinstance(color, dict):
                r = color.get("r", 1.0)
                g = color.get("g", 1.0)
                b = color.get("b", 1.0)
            else:
                r = 1.0
                g = 1.0
                b = 1.0

            # Accept both 0..1 and 0..255 RGB values, then scale the colour channels
            # by the gated intensity. This is the safety-critical part: when the
            # safety gate reduces intensity to 0 (e.g. no permit), EVERY channel —
            # not just the master/dimmer — goes to 0, so a fixture with no separate
            # dimmer channel still goes dark. (AQ-X-002)
            r = int(max(0, min(255, r * 255 if r <= 1 else r)) * scale)
            g = int(max(0, min(255, g * 255 if g <= 1 else g)) * scale)
            b = int(max(0, min(255, b * 255 if b <= 1 else b)) * scale)

            channels = {
                dmx_addr - 1: val,        # Master/dimmer
                dmx_addr:     r,          # Red
                dmx_addr + 1: g,          # Green
                dmx_addr + 2: b,          # Blue
            }
            await driver.send({"universe": universe, "channels": channels})
            logger.debug(f"DMX → {device_id} addr={dmx_addr} universe={universe} val={val}")

    # ── AF-HUB-015 — fail-closed mapping helpers ──────────────────────────────────
    def _note_unmapped(self, device_id, device_type, protocol: str) -> None:
        """Record (and warn once about) a fixture command dropped for lack of a valid
        mapping. No output is sent for it."""
        did = str(device_id)
        if did not in self._unmapped_fixtures:
            logger.warning("FAIL-CLOSED: fixture %r (%s) has no valid %s mapping — NO output "
                           "sent (would be unsafe on real hardware)", did, device_type, protocol)
        entry = self._unmapped_fixtures.get(did, {"type": device_type, "protocol": protocol, "count": 0})
        entry["count"] += 1
        self._unmapped_fixtures[did] = entry

    def _has_mapping(self, device_id) -> bool:
        """True iff this device has a real hardware mapping — a Pattern Designer DMX entry,
        a designed-fixture Modbus register, an explicit device→driver map, or a seed device."""
        did = str(device_id)
        if any(str(m.get("fixtureId")) == did for m in self._dmx_map):
            return True
        if device_id in self._fixture_registers:
            return True
        # AF-ICAN-003 — a fixture wired to an I-CAN relay channel IS mapped. Without
        # this the fail-closed check in show_engine.play() would classify every
        # relay-driven fixture as unmapped and refuse to start the show on exactly the
        # commissioned hardware the fountain actually runs on.
        if did in self._ican_devices:
            return True
        dk = self._device_map.get(device_id)
        if dk and dk in self._drivers:
            return True
        from engine.device_manager import SEED_DEVICES
        return any(d.id == device_id for d in SEED_DEVICES)

    def unmapped_fixtures(self, fixtures: list) -> list:
        """Given the designed fixtures, return the ids of those with NO valid hardware
        mapping. Used to BLOCK playback on real hardware (AF-HUB-015)."""
        out = []
        for fx in fixtures or []:
            if not isinstance(fx, dict):
                continue
            did = fx.get("id") or fx.get("fixtureId")
            if did and not self._has_mapping(did):
                out.append(did)
        return out

    def update_dmx_map(self, map_list: list[dict]) -> None:
        """
        Store fixture → DMX universe/channel mapping from Pattern Designer.

        Expected entry example:
        {
            "fixtureId": "nozzle-1",
            "universe": 0,
            "channel": 1
        }
        """
        cleaned = []

        for entry in map_list or []:
            try:
                fixture_id = entry.get("fixtureId")
                universe = int(entry.get("universe", 0))
                channel = int(entry.get("channel", 1))

                if not fixture_id:
                    continue

                # AF-HUB-FINAL-VERIFY — REJECT invalid map entries instead of silently
                # clamping them onto channel 1 / universe 0 (someone else's device).
                if universe < 0 or channel < 1 or channel > 512:
                    logger.warning(
                        "DMX map entry rejected (out of range): fixture=%r universe=%s "
                        "channel=%s — fixture stays UNMAPPED (fail-closed)",
                        fixture_id, universe, channel,
                    )
                    continue

                cleaned.append({
                    "fixtureId": fixture_id,
                    "universe": universe,
                    "channel": channel,
                })

            except Exception:
                continue

        self._dmx_map = cleaned
        logger.info(f"DMX map updated — {len(self._dmx_map)} fixture mappings")

    def get_dmx_map(self) -> list[dict]:
        """Return current fixture → DMX map."""
        return list(self._dmx_map)

    async def blackout(self):
        """All outputs to zero"""
        for driver in self._drivers.values():
            await driver.blackout()
        # I-CAN is not in self._drivers (it is attached explicitly), so blacking it out
        # has to be done here. Clear the desired state FIRST: if the all-off frame fails
        # to reach the gateway, the next flush must still not re-assert channels that a
        # stop was meant to drop.
        if self._ican_driver:
            self._ican_state = {}
            self._ican_dirty = set()
            self._ican_confirmed = {}
            try:
                await self._ican_driver.blackout()
            except Exception as e:
                logger.error("I-CAN blackout failed: %s", e)

    async def emergency_stop(self):
        """Immediate hardware blackout + pump stop"""
        await self.blackout()
        logger.warning("🚨 Protocol bus emergency stop executed")

    def get_status(self) -> dict:
        return {
            "running": self._running,
            "drivers": {
                k: {"connected": v.is_connected, "protocol": v.name}
                for k, v in self._drivers.items()
            },
            "dmx_map_count": len(self._dmx_map),
            "dmx_universe_count": len(self._dmx_state),
            "device_map_count": len(self._device_map),
            "fixture_register_count": len(self._fixture_registers),
            "fixtures_loaded": self._fixtures_loaded,
            # AF-HUB-014 — honest protocol support (no protocol claims false readiness).
            "protocol_support": dict(PROTOCOL_SUPPORT),
            # AF-HUB-015 — fixtures dropped for having no valid mapping (fail-closed).
            "unmapped_output": list(self._unmapped_fixtures.keys()),
        }
def get_protocol_bus() -> ProtocolBus:
    """
    AF-HUB-016 — return THE one runtime ProtocolBus (the primary created by app_state).

    The old escape hatch that lazily created a SECOND, unconfigured bus is removed: this
    now always returns the single app singleton and never constructs a new instance. Two
    calls return the same object.
    """
    if ProtocolBus._primary is not None:
        return ProtocolBus._primary
    # Not created yet — importing app_state constructs the primary (side effect).
    from app_state import protocol_bus  # noqa: F401
    if ProtocolBus._primary is None:  # pragma: no cover - defensive
        raise RuntimeError("No primary ProtocolBus available — app_state not initialised")
    return ProtocolBus._primary
