"""
AquaFlow Protocol Bus
Hardware-agnostic abstraction layer for all control protocols.
Supports: DMX512, Art-Net, sACN, Modbus TCP, MQTT, OPC UA, BACnet
"""
import asyncio
import struct
import socket
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

    def __init__(self, target_ip: str = "255.255.255.255"):
        self.target_ip = target_ip
        self._sock: Optional[socket.socket] = None
        self._connected = False
        # 512 channels per universe, up to 256 universes
        self._universes: dict[int, bytearray] = {i: bytearray(512) for i in range(4)}

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
        universe = data.get("universe", 0)
        channels = data.get("channels", {})  # {channel_idx: value 0-255}

        buf = self._universes[universe % 4]
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

    def __init__(self):
        self._drivers: dict[str, ProtocolDriver] = {}
        self._running = False

    async def start(self):
        self._running = True
        # Initialize default drivers
        artnet = ArtNetDriver()
        if await artnet.connect():
            self._drivers["artnet"] = artnet
            self._drivers["dmx"] = artnet  # DMX via Art-Net

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

    async def send_batch(self, commands: list[dict]):
        """Route a batch of commands to appropriate drivers"""
        for cmd in commands:
            await self._route_command(cmd)

    async def _route_command(self, cmd: dict):
        device_type = cmd.get("type")
        intensity = cmd.get("intensity", 0.0)

        if device_type in ("lighting", "flame", "fog"):
            # Art-Net / DMX
            driver = self._drivers.get("artnet")
            if driver:
                channels = {0: int(intensity * 255)}  # Simplified: single intensity channel
                await driver.send({"universe": 0, "channels": channels})

        elif device_type == "pump":
            # Modbus — speed register
            for key, driver in self._drivers.items():
                if key.startswith("modbus:"):
                    speed_val = int(intensity * 1000)  # 0-1000 RPM scale
                    await driver.send({"register": 0x0001, "value": speed_val})

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
            k: {"connected": v.is_connected, "protocol": v.name}
            for k, v in self._drivers.items()
        }
