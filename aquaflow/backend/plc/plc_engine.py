"""
AquaFlow PLC Integration Engine
Supports:
- Siemens S7 (S7-300/400/1200/1500) via snap7 or raw S7comm
- Allen Bradley CompactLogix/MicroLogix via EtherNet/IP (pycomm3)
- OPC UA client (opcua/asyncua)
- Modbus TCP with register mapping
- Generic tag-based abstraction layer
"""
import asyncio
import struct
import logging
from dataclasses import dataclass, field
from typing import Optional, Any
from enum import Enum

logger = logging.getLogger(__name__)


class PLCType(str, Enum):
    SIEMENS_S7   = "siemens_s7"
    ALLEN_BRADLEY = "allen_bradley"
    MODBUS_TCP   = "modbus_tcp"
    OPC_UA       = "opc_ua"
    MITSUBISHI   = "mitsubishi"
    DELTA        = "delta"
    OMRON        = "omron"
    BECKHOFF     = "beckhoff"


class TagType(str, Enum):
    BOOL   = "bool"
    INT    = "int"
    DINT   = "dint"
    REAL   = "real"
    WORD   = "word"
    DWORD  = "dword"
    STRING = "string"


@dataclass
class PLCTag:
    """A single PLC memory location mapped to a fountain device parameter"""
    id: str
    name: str
    address: str          # e.g. "DB1.DBW0", "%MW100", "N7:0"
    tag_type: TagType
    description: str = ""
    unit: str = ""
    min_value: float = 0.0
    max_value: float = 100.0
    scale_factor: float = 1.0
    offset: float = 0.0
    mapped_device: str = ""     # device ID in AquaFlow
    mapped_param: str = ""      # parameter name
    current_value: Any = None
    last_updated: float = 0.0


@dataclass
class PLCConnection:
    """Configuration for a PLC connection"""
    id: str
    name: str
    plc_type: PLCType
    ip: str
    port: int = 102
    rack: int = 0
    slot: int = 1
    unit_id: int = 1         # Modbus unit ID
    tags: list = field(default_factory=list)
    connected: bool = False
    last_error: str = ""
    scan_rate_ms: int = 100  # Polling interval


class PLCDriver:
    """Base class for PLC drivers"""

    def __init__(self, config: PLCConnection):
        self.config = config
        self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> bool:
        raise NotImplementedError

    async def disconnect(self):
        raise NotImplementedError

    async def read_tag(self, tag: PLCTag) -> Any:
        raise NotImplementedError

    async def write_tag(self, tag: PLCTag, value: Any) -> bool:
        raise NotImplementedError

    async def read_all_tags(self, tags: list[PLCTag]) -> dict:
        raise NotImplementedError


class SiemensS7Driver(PLCDriver):
    """
    Siemens S7 PLC driver.
    Uses snap7 library if available, otherwise raw S7comm TCP.
    Supports S7-300, S7-400, S7-1200, S7-1500.
    """

    S7COMM_PORT = 102

    def __init__(self, config: PLCConnection):
        super().__init__(config)
        self._snap7 = None
        self._reader = None
        self._writer = None
        self._has_snap7 = self._check_snap7()

    def _check_snap7(self) -> bool:
        try:
            import snap7
            return True
        except ImportError:
            return False

    async def connect(self) -> bool:
        if self._has_snap7:
            return await self._connect_snap7()
        return await self._connect_raw()

    async def _connect_snap7(self) -> bool:
        try:
            import snap7
            loop = asyncio.get_event_loop()
            client = snap7.client.Client()
            await loop.run_in_executor(
                None,
                lambda: client.connect(self.config.ip, self.config.rack, self.config.slot)
            )
            self._snap7 = client
            self._connected = True
            logger.info(f"Siemens S7 connected via snap7: {self.config.ip}")
            return True
        except Exception as e:
            self.config.last_error = str(e)
            logger.warning(f"snap7 connect failed: {e}")
            return False

    async def _connect_raw(self) -> bool:
        """Raw S7comm connection (COTP + S7 protocol)"""
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.config.ip, self.S7COMM_PORT),
                timeout=3.0
            )
            # COTP connection request (CR TPDU)
            cotp_cr = bytes([
                0x03, 0x00, 0x00, 0x16,  # TPKT header
                0x11, 0xe0, 0x00, 0x00,  # COTP CR
                0x00, 0x01, 0x00, 0xc0,
                0x01, 0x0a, 0xc1, 0x02,
                0x01, 0x00, 0xc2, 0x02,
                0x01, 0x02,
            ])
            self._writer.write(cotp_cr)
            await self._writer.drain()
            response = await asyncio.wait_for(self._reader.read(22), timeout=2.0)

            if len(response) >= 4 and response[5] == 0xd0:  # CC TPDU
                # S7 communication setup
                s7_setup = bytes([
                    0x03, 0x00, 0x00, 0x19,
                    0x02, 0xf0, 0x80,
                    0x32, 0x01, 0x00, 0x00,
                    0x00, 0x00, 0x00, 0x08,
                    0x00, 0x00, 0xf0, 0x00,
                    0x00, 0x01, 0x00, 0x01,
                    0x00, 0xf0,
                ])
                self._writer.write(s7_setup)
                await self._writer.drain()
                await asyncio.wait_for(self._reader.read(27), timeout=2.0)
                self._connected = True
                logger.info(f"Siemens S7 connected (raw): {self.config.ip}")
                return True
        except Exception as e:
            self.config.last_error = str(e)
            logger.warning(f"S7 raw connect failed {self.config.ip}: {e}")
        return False

    async def read_tag(self, tag: PLCTag) -> Any:
        """Read a tag value from the PLC"""
        if not self._connected:
            return None
        try:
            if self._has_snap7 and self._snap7:
                return await self._read_snap7(tag)
            return await self._read_raw_db(tag)
        except Exception as e:
            logger.debug(f"S7 read error {tag.address}: {e}")
            return None

    async def _read_snap7(self, tag: PLCTag) -> Any:
        import snap7
        import snap7.util as util
        loop = asyncio.get_event_loop()

        # Parse address like "DB1.DBW0" or "DB1.DBD4"
        parts = tag.address.upper().split(".")
        if len(parts) < 2:
            return None
        db_num = int(parts[0].replace("DB", ""))
        area = parts[1][:3]  # DBW, DBD, DBX, DBB

        if "DBW" in area:
            offset = int(parts[1].replace("DBW", ""))
            data = await loop.run_in_executor(None, lambda: self._snap7.db_read(db_num, offset, 2))
            return util.get_int(data, 0)
        elif "DBD" in area:
            offset = int(parts[1].replace("DBD", ""))
            data = await loop.run_in_executor(None, lambda: self._snap7.db_read(db_num, offset, 4))
            return util.get_dword(data, 0)
        elif "DBX" in area:
            parts2 = parts[1].replace("DBX", "").split(".")
            offset, bit = int(parts2[0]), int(parts2[1])
            data = await loop.run_in_executor(None, lambda: self._snap7.db_read(db_num, offset, 1))
            return util.get_bool(data, 0, bit)
        return None

    async def _read_raw_db(self, tag: PLCTag) -> Any:
        """Read data block via raw S7comm"""
        if not self._writer:
            return None
        try:
            parts = tag.address.upper().split(".")
            db_num = int(parts[0].replace("DB", ""))
            offset = int(''.join(filter(str.isdigit, parts[1])))

            # S7 Read Var request
            request = self._build_s7_read_request(db_num, offset, 2)
            self._writer.write(request)
            await self._writer.drain()
            response = await asyncio.wait_for(self._reader.read(256), timeout=1.0)

            if len(response) > 25 and response[21] == 0xff:
                value = struct.unpack(">H", response[25:27])[0]
                return value
        except Exception as e:
            logger.debug(f"Raw DB read error: {e}")
        return None

    def _build_s7_read_request(self, db: int, offset: int, length: int) -> bytes:
        """Build S7comm Read Var PDU"""
        return bytes([
            0x03, 0x00, 0x00, 0x1f,  # TPKT
            0x02, 0xf0, 0x80,         # COTP
            0x32, 0x01, 0x00, 0x00,  # S7 header
            0x00, 0x00, 0x00, 0x0e,
            0x00, 0x00, 0x04, 0x01,
            0x12, 0x0a, 0x10,
            0x02,                     # Transport size: BYTE
            0x00, length & 0xff,
            (db >> 8) & 0xff, db & 0xff,
            0x84,                     # Area: DB
            (offset >> 5) & 0xff, ((offset & 0x1f) << 3) & 0xff,
            0x00,
        ])

    async def write_tag(self, tag: PLCTag, value: Any) -> bool:
        if not self._connected:
            return False
        try:
            if self._has_snap7 and self._snap7:
                import snap7, snap7.util as util
                parts = tag.address.upper().split(".")
                db_num = int(parts[0].replace("DB", ""))
                offset = int(''.join(filter(str.isdigit, parts[1])))
                data = bytearray(2)
                util.set_int(data, 0, int(value))
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, lambda: self._snap7.db_write(db_num, offset, data))
                return True
        except Exception as e:
            logger.debug(f"S7 write error: {e}")
        return False

    async def disconnect(self):
        self._connected = False
        if self._snap7:
            try: self._snap7.disconnect()
            except: pass
        if self._writer:
            try: self._writer.close()
            except: pass

    async def read_all_tags(self, tags: list[PLCTag]) -> dict:
        results = {}
        for tag in tags:
            val = await self.read_tag(tag)
            if val is not None:
                results[tag.id] = val
        return results


class ModbusTCPPLCDriver(PLCDriver):
    """Enhanced Modbus TCP driver with tag mapping.

    AF-IO-001 — delegates the wire work to engine/modbus_client.ModbusTCPClient (the
    ONE validated Modbus client). Address parsing is the shared parse_register_address:
    a malformed address now raises there, so read_tag/write_tag refuse (None/False)
    instead of silently touching register 0 as the old parser did.
    """

    def __init__(self, config: PLCConnection):
        super().__init__(config)
        from engine.modbus_client import ModbusTCPClient
        self._client = ModbusTCPClient(
            config.ip, config.port or 502, config.unit_id or 1)

    @property
    def is_connected(self) -> bool:
        return self._client.is_connected

    async def connect(self) -> bool:
        ok = await self._client.connect()
        self._connected = ok
        if not ok:
            self.config.last_error = self._client.last_error
        return ok

    async def read_tag(self, tag: PLCTag) -> Any:
        """Read tag — address like '%MW100' or '40001' """
        if not await self._client.ensure_connected():
            self._connected = False
            return None
        self._connected = True
        try:
            register = self._parse_modbus_address(tag.address)
            values = await self._client.read_holding_registers(register, 1)
            if values:
                raw = values[0]
                scaled = (raw * tag.scale_factor) + tag.offset
                return scaled
        except Exception as e:
            logger.debug(f"Modbus read error {tag.address}: {e}")
        return None

    def _parse_modbus_address(self, address: str) -> int:
        """Parse Modbus address formats: %MW100, 40001, HR100.
        Raises ValueError on malformed addresses (fail-closed)."""
        from engine.modbus_client import parse_register_address
        return parse_register_address(address)

    async def write_tag(self, tag: PLCTag, value: Any) -> bool:
        if not await self._client.ensure_connected():
            self._connected = False
            return False
        self._connected = True
        try:
            register = self._parse_modbus_address(tag.address)
            scaled = int((float(value) - tag.offset) / max(tag.scale_factor, 0.001))
            scaled = max(0, min(65535, scaled))
            return await self._client.write_register(register, scaled)
        except Exception as e:
            logger.debug(f"Modbus write error: {e}")
            return False

    async def disconnect(self):
        self._connected = False
        await self._client.close()

    async def read_all_tags(self, tags: list[PLCTag]) -> dict:
        results = {}
        for tag in tags:
            val = await self.read_tag(tag)
            if val is not None:
                results[tag.id] = val
        return results


class OPCUADriver(PLCDriver):
    """OPC UA client driver — works with Siemens, Beckhoff, any OPC UA server"""

    def __init__(self, config: PLCConnection):
        super().__init__(config)
        self._client = None
        self._has_opcua = self._check_opcua()

    def _check_opcua(self) -> bool:
        try:
            import asyncua
            return True
        except ImportError:
            try:
                import opcua
                return True
            except ImportError:
                return False

    async def connect(self) -> bool:
        if not self._has_opcua:
            logger.warning("OPC UA library not installed. Run: pip install asyncua")
            return False
        try:
            from asyncua import Client
            url = f"opc.tcp://{self.config.ip}:{self.config.port or 4840}"
            self._client = Client(url=url)
            await asyncio.wait_for(self._client.connect(), timeout=5.0)
            self._connected = True
            logger.info(f"OPC UA connected: {url}")
            return True
        except Exception as e:
            self.config.last_error = str(e)
            logger.warning(f"OPC UA connect failed: {e}")
            return False

    async def read_tag(self, tag: PLCTag) -> Any:
        if not self._connected or not self._client: return None
        try:
            node = self._client.get_node(tag.address)
            value = await node.read_value()
            return float(value) * tag.scale_factor + tag.offset
        except Exception as e:
            logger.debug(f"OPC UA read error {tag.address}: {e}")
            return None

    async def write_tag(self, tag: PLCTag, value: Any) -> bool:
        if not self._connected or not self._client: return False
        try:
            from asyncua import ua
            node = self._client.get_node(tag.address)
            scaled = (float(value) - tag.offset) / max(tag.scale_factor, 0.001)
            await node.write_value(ua.DataValue(ua.Variant(scaled, ua.VariantType.Float)))
            return True
        except Exception as e:
            logger.debug(f"OPC UA write error: {e}")
            return False

    async def disconnect(self):
        self._connected = False
        if self._client:
            try: await self._client.disconnect()
            except: pass

    async def read_all_tags(self, tags: list) -> dict:
        results = {}
        for tag in tags:
            val = await self.read_tag(tag)
            if val is not None:
                results[tag.id] = val
        return results


class PLCManager:
    """
    Central PLC manager.
    Manages multiple PLC connections and provides
    a unified tag read/write interface.
    """

    def __init__(self):
        self._connections: dict[str, PLCConnection] = {}
        self._drivers: dict[str, PLCDriver] = {}
        self._poll_tasks: dict[str, asyncio.Task] = {}
        self._tag_values: dict[str, Any] = {}
        self._running = False

    async def start(self):
        self._running = True
        logger.info("PLC Manager started")

    async def stop(self):
        self._running = False
        for task in self._poll_tasks.values():
            task.cancel()
        for driver in self._drivers.values():
            await driver.disconnect()

    def _create_driver(self, config: PLCConnection) -> PLCDriver:
        if config.plc_type == PLCType.SIEMENS_S7:
            return SiemensS7Driver(config)
        elif config.plc_type in (PLCType.MODBUS_TCP, PLCType.DELTA, PLCType.MITSUBISHI):
            return ModbusTCPPLCDriver(config)
        elif config.plc_type == PLCType.OPC_UA:
            return OPCUADriver(config)
        else:
            return ModbusTCPPLCDriver(config)  # Default fallback

    async def add_plc(self, config: PLCConnection) -> dict:
        """Add and connect a PLC"""
        self._connections[config.id] = config
        driver = self._create_driver(config)
        self._drivers[config.id] = driver

        connected = await driver.connect()
        config.connected = connected

        if connected:
            # Start polling task
            self._poll_tasks[config.id] = asyncio.create_task(
                self._poll_loop(config.id)
            )
            logger.info(f"PLC {config.name} connected and polling started")
        else:
            logger.warning(f"PLC {config.name} connection failed: {config.last_error}")

        return {"connected": connected, "error": config.last_error if not connected else ""}

    async def remove_plc(self, plc_id: str):
        if plc_id in self._poll_tasks:
            self._poll_tasks[plc_id].cancel()
        if plc_id in self._drivers:
            await self._drivers[plc_id].disconnect()
            del self._drivers[plc_id]
        self._connections.pop(plc_id, None)

    async def write_tag(self, plc_id: str, tag_id: str, value: Any) -> bool:
        driver = self._drivers.get(plc_id)
        config = self._connections.get(plc_id)
        if not driver or not config: return False
        tag = next((t for t in config.tags if t["id"] == tag_id), None)
        if not tag: return False
        tag_obj = PLCTag(**tag)
        return await driver.write_tag(tag_obj, value)

    async def write_device_output(self, plc_id: str, device_id: str, param: str, value: float):
        """Write to all tags mapped to a specific device/param"""
        config = self._connections.get(plc_id)
        driver = self._drivers.get(plc_id)
        if not config or not driver: return

        for tag_data in config.tags:
            if tag_data.get("mapped_device") == device_id and tag_data.get("mapped_param") == param:
                tag = PLCTag(**tag_data)
                await driver.write_tag(tag, value)

    async def _poll_loop(self, plc_id: str):
        """Continuous polling loop for a PLC"""
        config = self._connections.get(plc_id)
        driver = self._drivers.get(plc_id)
        if not config or not driver: return

        while self._running and plc_id in self._drivers:
            try:
                tags = [PLCTag(**t) for t in config.tags]
                if tags:
                    values = await driver.read_all_tags(tags)
                    for tag_id, value in values.items():
                        self._tag_values[f"{plc_id}.{tag_id}"] = value
                await asyncio.sleep(config.scan_rate_ms / 1000.0)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Poll error {plc_id}: {e}")
                await asyncio.sleep(1.0)

    def get_tag_value(self, plc_id: str, tag_id: str) -> Any:
        return self._tag_values.get(f"{plc_id}.{tag_id}")

    def get_all_values(self) -> dict:
        return dict(self._tag_values)

    def get_status(self) -> list:
        return [
            {
                "id": plc_id,
                "name": cfg.name,
                "type": cfg.plc_type,
                "ip": cfg.ip,
                "connected": cfg.connected,
                "tag_count": len(cfg.tags),
                "last_error": cfg.last_error,
            }
            for plc_id, cfg in self._connections.items()
        ]


# Default tag templates per PLC type
DEFAULT_TAGS = {
    PLCType.SIEMENS_S7: [
        {"id": "pump_speed",  "name": "Pump Speed",      "address": "DB1.DBW0",  "tag_type": "int",  "min_value": 0, "max_value": 1000, "scale_factor": 0.1,  "unit": "%",  "mapped_param": "speed"},
        {"id": "pump_run",    "name": "Pump Run",         "address": "DB1.DBX2.0","tag_type": "bool", "min_value": 0, "max_value": 1,    "scale_factor": 1.0,  "unit": "",   "mapped_param": "run"},
        {"id": "valve_1",     "name": "Solenoid Valve 1", "address": "DB2.DBX0.0","tag_type": "bool", "min_value": 0, "max_value": 1,    "scale_factor": 1.0,  "unit": "",   "mapped_param": "open"},
        {"id": "pressure",    "name": "Water Pressure",   "address": "DB3.DBW0",  "tag_type": "int",  "min_value": 0, "max_value": 100,  "scale_factor": 0.01, "unit": "bar","mapped_param": "pressure"},
        {"id": "flow_rate",   "name": "Flow Rate",        "address": "DB3.DBW2",  "tag_type": "int",  "min_value": 0, "max_value": 1000, "scale_factor": 0.1,  "unit": "L/m","mapped_param": "flow"},
    ],
    PLCType.MODBUS_TCP: [
        {"id": "pump_speed",  "name": "Pump Speed",      "address": "%MW0",   "tag_type": "int",  "min_value": 0, "max_value": 1000, "scale_factor": 0.1,  "unit": "%",  "mapped_param": "speed"},
        {"id": "pump_run",    "name": "Pump Run/Stop",   "address": "%MW1",   "tag_type": "int",  "min_value": 0, "max_value": 1,    "scale_factor": 1.0,  "unit": "",   "mapped_param": "run"},
        {"id": "valve_bank",  "name": "Valve Bank",      "address": "%MW2",   "tag_type": "word", "min_value": 0, "max_value": 65535,"scale_factor": 1.0,  "unit": "",   "mapped_param": "pattern"},
        {"id": "pressure",    "name": "Pressure Sensor", "address": "%MW10",  "tag_type": "int",  "min_value": 0, "max_value": 1000, "scale_factor": 0.01, "unit": "bar","mapped_param": "pressure"},
    ],
}

plc_manager = PLCManager()
