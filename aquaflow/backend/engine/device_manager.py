"""
AquaFlow Device Manager
Handles device discovery, health monitoring, and command routing
"""
import asyncio
import time
import logging
from typing import Optional
from dataclasses import dataclass, field, asdict
from enum import Enum

logger = logging.getLogger(__name__)


class DeviceStatus(str, Enum):
    ONLINE  = "online"
    OFFLINE = "offline"
    WARN    = "warn"
    INIT    = "init"


@dataclass
class Device:
    id: str
    label: str
    type: str           # pump, valve, lighting, flame, fog, laser, sensor
    protocol: str       # dmx, artnet, sacn, modbus, mqtt
    ip: Optional[str]   = None
    port: Optional[int] = None
    status: DeviceStatus = DeviceStatus.OFFLINE
    health: int = 0     # 0-100
    last_seen: float = 0.0
    params: dict = field(default_factory=dict)
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        d["last_seen"] = round(self.last_seen, 2)
        return d


# Seed devices matching the frontend store
SEED_DEVICES = [
    Device("pump-01",  "Master Pump Array", "pump",    "modbus", "192.168.1.10", 502,  DeviceStatus.ONLINE,  98),
    Device("pump-02",  "Side Pumps",        "pump",    "modbus", "192.168.1.11", 502,  DeviceStatus.ONLINE,  96),
    Device("valve-01", "Solenoid Bank A",   "valve",   "artnet", "192.168.1.20", 6454, DeviceStatus.ONLINE,  100),
    Device("valve-02", "Solenoid Bank B",   "valve",   "artnet", "192.168.1.21", 6454, DeviceStatus.ONLINE,  100),
    Device("light-01", "RGB Ring Lights",   "lighting","dmx",    None,           None, DeviceStatus.ONLINE,  92,  params={"dmxAddress":1,  "dmxUniverse":0}),
    Device("light-02", "Spotlights",        "lighting","sacn",   "192.168.1.30", 5568, DeviceStatus.ONLINE,  88,  params={"dmxAddress":10, "dmxUniverse":0}),
    Device("flame-01", "Flame System",      "flame",   "modbus", "192.168.1.40", 502,  DeviceStatus.OFFLINE, 0),
    Device("fog-01",   "Fog Machines",      "fog",     "dmx",    None,           None, DeviceStatus.WARN,    65),
    Device("laser-01", "Laser Array",       "laser",   "ilda",   "192.168.1.50", 7770, DeviceStatus.OFFLINE, 0),
    Device("sensor-01","Pressure Sensor",   "sensor",  "mqtt",   "192.168.1.60", 1883, DeviceStatus.ONLINE,  100),
]


class DeviceManager:
    HEALTH_CHECK_INTERVAL = 5.0  # seconds

    def __init__(self):
        self._devices: dict[str, Device] = {}
        self._monitor_task: Optional[asyncio.Task] = None

    async def start(self):
        # Load seed devices
        for device in SEED_DEVICES:
            device.last_seen = time.time()
            self._devices[device.id] = device

        self._monitor_task = asyncio.create_task(self._health_monitor())
        logger.info(f"Device manager started with {len(self._devices)} devices")

    async def stop(self):
        if self._monitor_task:
            self._monitor_task.cancel()

    async def _health_monitor(self):
        """Periodic health checks — would ping real devices"""
        while True:
            try:
                await asyncio.sleep(self.HEALTH_CHECK_INTERVAL)
                for device in self._devices.values():
                    if device.ip:
                        # In production: actually ping / query the device
                        # For now simulate slight health fluctuation
                        if device.status == DeviceStatus.ONLINE:
                            device.last_seen = time.time()
            except asyncio.CancelledError:
                break

    def get_device(self, device_id: str) -> Optional[Device]:
        return self._devices.get(device_id)

    def get_all_devices(self) -> list[dict]:
        return [d.to_dict() for d in self._devices.values()]

    def get_summary(self) -> dict:
        statuses = [d.status for d in self._devices.values()]
        return {
            "total": len(self._devices),
            "online": statuses.count(DeviceStatus.ONLINE),
            "offline": statuses.count(DeviceStatus.OFFLINE),
            "warn": statuses.count(DeviceStatus.WARN),
        }

    async def send_command(self, device_id: str, command: dict) -> dict:
        device = self.get_device(device_id)
        if not device:
            return {"success": False, "error": "Device not found"}
        if device.status == DeviceStatus.OFFLINE:
            return {"success": False, "error": "Device offline"}
        logger.info(f"Command → {device.label}: {command}")
        # In production: route to protocol bus
        return {"success": True, "device_id": device_id, "command": command}

    async def scan_network(self, subnet: str = "192.168.1") -> list[dict]:
        """Discover devices on the network (stub — would use protocol-specific discovery)"""
        logger.info(f"Scanning network {subnet}.0/24")
        await asyncio.sleep(1)  # Simulated scan delay
        return self.get_all_devices()  # Return known devices for now
