"""
AquaFlow Protocol Bus
Hardware-agnostic abstraction layer for all control protocols.
Supports: DMX512, Art-Net, sACN, Modbus TCP, MQTT, OPC UA, BACnet
"""
import asyncio
import struct
import socket
import time
from abc import ABC, abstractmethod
from typing import Optional
import logging

logger = logging.getLogger(__name__)


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
    """Modbus TCP for pump VFDs and industrial hardware"""
    name = "modbus"

    def __init__(self, host: str, port: int = 502, unit_id: int = 1):
        self.host = host
        self.port = port
        self.unit_id = unit_id
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._connected = False
        self._transaction_id = 0

    async def connect(self) -> bool:
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port), timeout=3.0
            )
            self._connected = True
            logger.info(f"Modbus TCP connected → {self.host}:{self.port}")
            return True
        except Exception as e:
            logger.warning(f"Modbus connect failed {self.host}:{self.port}: {e}")
            return False

    async def disconnect(self):
        if self._writer:
            self._writer.close()
        self._connected = False

    async def send(self, data: dict) -> bool:
        """Write holding registers"""
        register = data.get("register", 0)
        value = data.get("value", 0)
        return await self.write_register(register, value)

    async def write_register(self, register: int, value: int) -> bool:
        if not self._connected:
            return False
        try:
            self._transaction_id = (self._transaction_id + 1) & 0xFFFF
            # Modbus TCP Application Data Unit (MBAP header + PDU)
            pdu = struct.pack(">BHH", 0x06, register, value)  # Write Single Register
            mbap = struct.pack(">HHHB", self._transaction_id, 0, len(pdu) + 1, self.unit_id)
            self._writer.write(mbap + pdu)
            await self._writer.drain()
            return True
        except Exception as e:
            logger.debug(f"Modbus write error: {e}")
            self._connected = False
            return False

    async def read_register(self, register: int, count: int = 1) -> Optional[list[int]]:
        if not self._connected:
            return None
        try:
            self._transaction_id = (self._transaction_id + 1) & 0xFFFF
            pdu = struct.pack(">BHH", 0x03, register, count)  # Read Holding Registers
            mbap = struct.pack(">HHHB", self._transaction_id, 0, len(pdu) + 1, self.unit_id)
            self._writer.write(mbap + pdu)
            await self._writer.drain()
            response = await asyncio.wait_for(self._reader.read(256), timeout=1.0)
            # Parse response (skip MBAP header + function code + byte count)
            if len(response) >= 9:
                values = [struct.unpack(">H", response[9 + i*2:11 + i*2])[0] for i in range(count)]
                return values
            return None
        except Exception as e:
            logger.debug(f"Modbus read error: {e}")
            return None

    async def blackout(self):
        # Write 0 to speed register for all pumps
        await self.write_register(0x0001, 0)

    @property
    def is_connected(self) -> bool:
        return self._connected


class MQTTDriver(ProtocolDriver):
    """MQTT for sensors and IoT devices"""
    name = "mqtt"

    def __init__(self, host: str, port: int = 1883):
        self.host = host
        self.port = port
        self._connected = False
        # aiomqtt or paho-mqtt would be used in production

    async def connect(self) -> bool:
        # TODO: implement with aiomqtt
        logger.info(f"MQTT driver → {self.host}:{self.port} (stub)")
        self._connected = True
        return True

    async def disconnect(self):
        self._connected = False

    async def send(self, data: dict) -> bool:
        topic = data.get("topic", "aquaflow/control")
        payload = data.get("payload", {})
        logger.debug(f"MQTT publish {topic}: {payload}")
        return True

    async def blackout(self):
        pass

    @property
    def is_connected(self) -> bool:
        return self._connected


class ProtocolBus:
    """
    Central protocol router.
    Maps device types/protocols to correct driver instances.
    """
    SUPPORTED = ["dmx", "artnet", "sacn", "modbus", "mqtt", "opcua", "bacnet"]

    # Flame safety defaults (Stage 1, Priority 7). The hardware-level flame cutoff
    # is the last line of defence regardless of what the show timeline requests.
    FLAME_MAX_DURATION = 3.0     # max continuous on-time (seconds)
    FLAME_GAP_RESET    = 0.5     # a command gap this long ends the current burst

    def __init__(self):
        self._drivers: dict[str, ProtocolDriver] = {}
        self._device_map: dict[str, str] = {}  # device_id → driver_key
        self._dmx_state: dict[int, dict[int, int]] = {}  # universe → {channel: value}
        self._dmx_map: list[dict] = []  # fixtureId → universe/channel mapping from Pattern Designer
        # Fixture-aware Modbus routing: device_id → {host, port, unit, register}
        # derived from designed fixtures via configure_from_fixtures().
        self._fixture_registers: dict[str, dict] = {}
        self._fixtures_loaded = False
        self._running = False

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
        """Dynamically add a protocol driver for a device"""
        if protocol == "modbus":
            driver = ModbusTCPDriver(config["ip"], config.get("port", 502))
            if await driver.connect():
                self._drivers[f"modbus:{config['ip']}"] = driver
                return True
        elif protocol == "mqtt":
            driver = MQTTDriver(config["ip"], config.get("port", 1883))
            if await driver.connect():
                self._drivers[f"mqtt:{config['ip']}"] = driver
                return True
        return False

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

    async def send_batch(self, commands: list[dict]):
        """Route a batch of commands to appropriate drivers"""
        for cmd in commands:
            await self._route_command(cmd)
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

            # Fallback: try any modbus driver
            if not driver:
                for key, d in self._drivers.items():
                    if key.startswith("modbus:"):
                        driver = d
                        break

            if driver:
                # Register 0x0001 = speed/intensity (0-10000 scale for VFDs)
                value = int(intensity * 10000)
                await driver.send({"register": 0x0001, "value": value})
                logger.debug(f"Modbus → {device_id} intensity={intensity:.2f} reg=0x0001 val={value}")

        # ── DMX / Art-Net (lighting, fog) ─────────────────────────────────────
        elif device_type in ("lighting", "rgb_lights", "fog", "fog_machines", "laser", "laser_units"):
            driver = self._drivers.get("artnet")
            if not driver:
                return

            # Look up DMX address from Pattern Designer map first.
            mapped = next(
                (m for m in self._dmx_map if str(m.get("fixtureId")) == str(device_id)),
                None,
            )

            if mapped:
                dmx_addr = int(mapped.get("channel", 1))
                universe = int(mapped.get("universe", 0))
            else:
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
                    dmx_addr = device.params.get("dmxAddress", 1) if device else 1
                    universe = device.params.get("dmxUniverse", 0) if device else 0

            # Build channel map — RGB fixture: ch0=master, ch1=R, ch2=G, ch3=B
            val = int(max(0, min(1, intensity)) * 255)

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

            # Accept both 0..1 and 0..255 RGB values.
            r = int(max(0, min(255, r * 255 if r <= 1 else r)))
            g = int(max(0, min(255, g * 255 if g <= 1 else g)))
            b = int(max(0, min(255, b * 255 if b <= 1 else b)))

            channels = {
                dmx_addr - 1: val,        # Master/dimmer
                dmx_addr:     r,          # Red
                dmx_addr + 1: g,          # Green
                dmx_addr + 2: b,          # Blue
            }
            await driver.send({"universe": universe, "channels": channels})
            logger.debug(f"DMX → {device_id} addr={dmx_addr} universe={universe} val={val}")

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

                if universe < 0:
                    universe = 0

                if channel < 1:
                    channel = 1

                if channel > 512:
                    channel = 512

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
        }
_protocol_bus: Optional[ProtocolBus] = None


def get_protocol_bus() -> ProtocolBus:
    global _protocol_bus
    if _protocol_bus is None:
        _protocol_bus = ProtocolBus()
    return _protocol_bus
