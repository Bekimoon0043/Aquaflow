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


# ── AF-IO-006 — honest PLC support tiers (mirrors AF-HUB-014 / protocol_bus) ─────
# The old _create_driver silently substituted a Modbus TCP driver for anything it
# didn't recognise — so "Beckhoff TwinCAT" opened a Modbus connection to port 4840
# and reported whatever that produced. Nothing may claim support it does not have.
PLC_SUPPORT = {
    "siemens_s7": "REAL",         # python-snap7 (bundled, pure Python since 3.x) preferred
                                  #   + validated raw S7comm fallback (AF-IO-005)
    "modbus_tcp": "REAL",         # engine/modbus_client.py (AF-IO-001)
    "opc_ua":     "REAL",         # OPCUADriver on asyncua (bundled); typed read/write
                                  #   proven against an asyncua server in tests
    "delta":      "GATED",        # many units speak Modbus TCP — connect those
    "mitsubishi": "GATED",        #   EXPLICITLY as modbus_tcp; the family-specific
    "omron":      "GATED",        #   protocols (MC, FINS) are not implemented
    "allen_bradley": "REAL",      # AllenBradleyDriver on pycomm3 (bundled): EtherNet/IP
                                  #   + CIP Read/Write Tag; connect/identity/reads proven
                                  #   against the cpppo Logix simulator, writes unit-tested
    "beckhoff":   "UNSUPPORTED",     # was the silent Modbus-on-port-4840 case
}
REAL_PLC_TYPES = [t for t, tier in PLC_SUPPORT.items() if tier == "REAL"]

PLC_TIER_MEANING = {
    "REAL": "implemented + tested driver (field verification gated by commissioning)",
    "GATED": "code exists or a workaround exists, but it is explicitly disabled — "
             "not selectable",
    "UNSUPPORTED": "not implemented",
}


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
        self._raw_client = None      # AF-IO-005: engine/s7_client.S7Client fallback
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
            port = int(self.config.port or self.S7COMM_PORT)
            await loop.run_in_executor(
                None,
                lambda: client.connect(self.config.ip, self.config.rack, self.config.slot,
                                       tcp_port=port)
            )
            self._snap7 = client
            self._connected = True
            logger.info(f"Siemens S7 connected via snap7: {self.config.ip}:{port}")
            return True
        except Exception as e:
            self.config.last_error = str(e)
            logger.warning(f"snap7 connect failed: {e}")
            return False

    async def _connect_raw(self) -> bool:
        """Raw S7comm connection — AF-IO-005: delegated to engine/s7_client.S7Client
        (validated framing; the old inline handshake read fixed byte counts and
        never checked what came back)."""
        from engine.s7_client import S7Client
        if self._raw_client is None:
            self._raw_client = S7Client(self.config.ip, self.S7COMM_PORT,
                                        self.config.rack, self.config.slot)
        ok = await self._raw_client.connect()
        self._connected = ok
        if ok:
            logger.info(f"Siemens S7 connected (raw): {self.config.ip}")
        else:
            self.config.last_error = self._raw_client.last_error
        return ok

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
            # AF-IO-005 — a REAL tag must come back as a float, not its raw dword
            # bit pattern (get_dword on a REAL produced meaningless huge ints).
            if tag.tag_type == TagType.REAL:
                return util.get_real(data, 0)
            return util.get_dword(data, 0)
        elif "DBX" in area:
            # "DB1.DBX8.3" splits on '.' into ["DB1", "DBX8", "3"] — the bit is parts[2].
            # (The old code re-split parts[1] and raised IndexError on every bit read.)
            offset, bit = int(parts[1][3:]), int(parts[2])
            data = await loop.run_in_executor(None, lambda: self._snap7.db_read(db_num, offset, 1))
            return util.get_bool(data, 0, bit)
        elif "DBB" in area:
            offset = int(parts[1][3:])
            data = await loop.run_in_executor(None, lambda: self._snap7.db_read(db_num, offset, 1))
            return int(data[0])
        return None

    async def _read_raw_db(self, tag: PLCTag) -> Any:
        """Read a DB address via the validated raw client (AF-IO-005). The old
        inline request encoded the address as (offset>>5, (offset&0x1f)<<3) —
        correct ONLY at offset 0; S7 addresses in bits (offset*8)."""
        if self._raw_client is None or not self._raw_client.is_connected:
            return None
        try:
            raw_type = "real" if tag.tag_type == TagType.REAL else "uint16"
            return await self._raw_client.read_address(tag.address.upper(), raw_type)
        except Exception as e:
            logger.debug(f"Raw DB read error {tag.address}: {e}")
            self._connected = self._raw_client.is_connected
        return None

    async def write_tag(self, tag: PLCTag, value: Any) -> bool:
        if not self._connected:
            return False
        try:
            if self._has_snap7 and self._snap7:
                import snap7, snap7.util as util
                loop = asyncio.get_event_loop()
                parts = tag.address.upper().split(".")
                db_num = int(parts[0].replace("DB", ""))
                area = parts[1][:3]
                if area == "DBX":
                    # bit write = read-modify-write of the containing byte
                    offset, bit = int(parts[1][3:]), int(parts[2])
                    cur = await loop.run_in_executor(None, lambda: self._snap7.db_read(db_num, offset, 1))
                    data = bytearray(cur)
                    util.set_bool(data, 0, bit, bool(value))
                elif area == "DBD":
                    offset = int(parts[1][3:])
                    data = bytearray(4)
                    if tag.tag_type == TagType.REAL:
                        util.set_real(data, 0, float(value))
                    else:
                        util.set_dword(data, 0, int(value) & 0xFFFFFFFF)
                elif area == "DBB":
                    offset = int(parts[1][3:])
                    data = bytearray([int(value) & 0xFF])
                else:                                        # DBW
                    offset = int(parts[1][3:])
                    data = bytearray(2)
                    util.set_int(data, 0, int(value))
                await loop.run_in_executor(None, lambda: self._snap7.db_write(db_num, offset, data))
                return True
            # AF-IO-005 — the raw path can now WRITE too (DBX/DBB/DBW/DBD; the old
            # code returned False without snap7, so BOOL tags like DB1.DBX2.0 were
            # silently unwritable).
            if self._raw_client is not None and self._raw_client.is_connected:
                raw_type = "real" if tag.tag_type == TagType.REAL else "uint16"
                if tag.tag_type == TagType.BOOL:
                    return await self._raw_client.write_address(
                        tag.address.upper(), bool(value), raw_type)
                return await self._raw_client.write_address(
                    tag.address.upper(),
                    value if tag.tag_type == TagType.REAL else int(value), raw_type)
        except Exception as e:
            logger.debug(f"S7 write error: {e}")
            if self._raw_client is not None:
                self._connected = self._raw_client.is_connected
        return False

    async def disconnect(self):
        self._connected = False
        if self._snap7:
            try: self._snap7.disconnect()
            except: pass
        if self._raw_client is not None:
            await self._raw_client.close()

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
    """OPC UA client driver (asyncua) — Siemens S7-1500 OPC UA server, Beckhoff,
    any OPC UA server.

    Tag address = the NodeId string exactly as the server publishes it
    (`ns=3;s="DB_Fountain"."Pump1_Speed"` on an S7-1500, `ns=2;i=1002`, ...).
    Reads return the server's value with its real type: booleans stay booleans,
    numbers are scaled by the tag's scale/offset. Writes are typed from the
    node's own DataType (Boolean / Int16..UInt64 / Float / Double / String), so a
    REAL node never receives a Double variant it would reject. Path is
    `opc.tcp://ip:port` (default 4840); the `slot` field is unused."""

    CONNECT_TIMEOUT = 5.0

    def __init__(self, config: PLCConnection):
        super().__init__(config)
        self._client = None
        self._has_opcua = self._check_opcua()
        self._vt_cache: dict[str, Any] = {}

    def _check_opcua(self) -> bool:
        try:
            import asyncua  # noqa: F401
            return True
        except ImportError:
            return False

    @property
    def url(self) -> str:
        # The operator may paste the server's full endpoint (with its path, e.g.
        # opc.tcp://192.168.5.30:4840/OPCUA/SimulationServer) into the IP field.
        ip = (self.config.ip or "").strip()
        if ip.lower().startswith("opc.tcp://"):
            return ip
        return f"opc.tcp://{ip}:{self.config.port or 4840}"

    async def connect(self) -> bool:
        if not self._has_opcua:
            self.config.last_error = "asyncua is not available in this build"
            logger.warning("OPC UA library not installed. Run: pip install asyncua")
            return False
        try:
            from asyncua import Client
            self._client = Client(url=self.url, timeout=self.CONNECT_TIMEOUT)
            await asyncio.wait_for(self._client.connect(), timeout=self.CONNECT_TIMEOUT)
            self._connected = True
            self._vt_cache.clear()
            logger.info(f"OPC UA connected: {self.url}")
            return True
        except Exception as e:
            self.config.last_error = f"{e.__class__.__name__}: {e}"
            logger.warning(f"OPC UA connect failed: {self.config.last_error}")
            self._client = None
            return False

    def _scaled(self, tag: PLCTag, value: Any) -> Any:
        if isinstance(value, bool):
            return value
        if isinstance(value, (int, float)):
            return float(value) * tag.scale_factor + tag.offset
        return value

    async def read_tag(self, tag: PLCTag) -> Any:
        if not self._connected or not self._client:
            return None
        try:
            node = self._client.get_node(tag.address)
            dv = await node.read_data_value()
            if dv.StatusCode is not None and not dv.StatusCode.is_good():
                logger.debug(f"OPC UA {tag.address}: status {dv.StatusCode.name}")
                return None
            return self._scaled(tag, dv.Value.Value)
        except Exception as e:
            logger.debug(f"OPC UA read error {tag.address}: {e}")
            return None

    async def _variant_type(self, node):
        key = node.nodeid.to_string()
        vt = self._vt_cache.get(key)
        if vt is None:
            vt = await node.read_data_type_as_variant_type()
            self._vt_cache[key] = vt
        return vt

    async def write_tag(self, tag: PLCTag, value: Any) -> bool:
        if not self._connected or not self._client:
            return False
        try:
            from asyncua import ua
            node = self._client.get_node(tag.address)
            vt = await self._variant_type(node)
            name = vt.name
            if name == "Boolean":
                typed = bool(value)
            elif name in ("SByte", "Byte", "Int16", "UInt16", "Int32", "UInt32", "Int64", "UInt64"):
                typed = int(round((float(value) - tag.offset) / (tag.scale_factor or 1.0)))
            elif name in ("Float", "Double"):
                typed = (float(value) - tag.offset) / (tag.scale_factor or 1.0)
            elif name == "String":
                typed = str(value)
            else:
                logger.debug(f"OPC UA write: unsupported variant {name} at {tag.address}")
                return False
            await node.write_value(ua.DataValue(ua.Variant(typed, vt)))
            return True
        except Exception as e:
            logger.debug(f"OPC UA write error {tag.address}: {e}")
            return False

    async def disconnect(self):
        self._connected = False
        if self._client:
            try:
                await self._client.disconnect()
            except Exception:
                pass
            self._client = None

    async def read_all_tags(self, tags: list) -> dict:
        results = {}
        for tag in tags:
            val = await self.read_tag(tag)
            if val is not None:
                results[tag.id] = val
        return results


class AllenBradleyDriver(PLCDriver):
    """Allen-Bradley Logix driver (ControlLogix / CompactLogix / Micro800) on
    pycomm3 — EtherNet/IP encapsulation + CIP Read Tag / Write Tag services.

    Tag address = the controller tag name exactly as in Studio 5000:
    `Pump1_Speed`, `Speeds[2]`, `Program:MainProgram.Valve1`. Path is the
    controller IP (`ip:port` when not 44818) plus `/slot` for a ControlLogix
    CPU in a rack slot other than 0.

    Types: when the controller serves its tag list (every real Logix does)
    pycomm3's uploaded definitions are used. When it does not (simulators,
    locked controllers) the operator's declared `tag_type` is injected as the
    definition — BOOL / INT / DINT / REAL (WORD→INT, DWORD→DINT); STRING and
    UDT members need the controller's own definitions. pycomm3 is synchronous:
    every call runs in the default executor behind one lock, one tag per
    request, so nothing here blocks the event loop and no multi-service
    packet is ever needed."""

    DEFAULT_PORT = 44818
    TYPE_MAP = {TagType.BOOL: "BOOL", TagType.INT: "INT", TagType.DINT: "DINT",
                TagType.REAL: "REAL", TagType.WORD: "INT", TagType.DWORD: "DINT"}

    def __init__(self, config: PLCConnection):
        super().__init__(config)
        self._plc = None
        self._lock = asyncio.Lock()
        self.identity: dict = {}
        self.tag_list_available = False
        self._has_pycomm3 = self._check_pycomm3()

    def _check_pycomm3(self) -> bool:
        try:
            import pycomm3  # noqa: F401
            return True
        except ImportError:
            return False

    @property
    def path(self) -> str:
        port = int(self.config.port or self.DEFAULT_PORT)
        base = self.config.ip if port == self.DEFAULT_PORT else f"{self.config.ip}:{port}"
        return f"{base}/{self.config.slot}" if self.config.slot else base

    async def _call(self, fn):
        async with self._lock:
            return await asyncio.get_event_loop().run_in_executor(None, fn)

    async def connect(self) -> bool:
        if not self._has_pycomm3:
            self.config.last_error = "pycomm3 is not available in this build"
            logger.warning("pycomm3 not installed. Run: pip install pycomm3")
            return False
        from pycomm3 import LogixDriver

        def open_with_tags():
            plc = LogixDriver(self.path, init_tags=True, init_program_tags=True)
            plc.open()
            return plc, True

        def open_without_tags():
            plc = LogixDriver(self.path, init_tags=False, init_program_tags=False)
            plc.open()
            return plc, False

        try:
            try:
                self._plc, self.tag_list_available = await self._call(open_with_tags)
            except Exception as first:
                logger.info("Logix %s: tag list not served (%s) — using declared tag types",
                            self.path, first)
                self._plc, self.tag_list_available = await self._call(open_without_tags)
            info = dict(self._plc.info or {})
            self.identity = {k: info.get(k) for k in ("vendor", "product_type", "product_name",
                                                       "revision", "serial", "name", "keyswitch")}
            self._connected = True
            logger.info("Allen-Bradley connected via pycomm3: %s (%s, tag list %s)", self.path,
                        self.identity.get("product_name"), "served" if self.tag_list_available else "declared")
            return True
        except Exception as e:
            self.config.last_error = f"{e.__class__.__name__}: {e}"
            logger.warning(f"pycomm3 connect failed: {self.config.last_error}")
            self._plc = None
            return False

    @staticmethod
    def _base_and_index(address: str) -> tuple[str, Optional[int]]:
        name = address.strip()
        idx = None
        if name.endswith("]") and "[" in name:
            name, _, rest = name.rpartition("[")
            try:
                idx = int(rest[:-1].split(",")[0])
            except ValueError:
                idx = None
        return name, idx

    def _declare(self, tag: PLCTag) -> Optional[str]:
        """Inject the operator's declared type as pycomm3's tag definition when the
        controller did not serve one. Returns an error string, or None."""
        if self._plc is None:
            return "not connected"
        base, idx = self._base_and_index(tag.address)
        if base in self._plc.tags:
            return None                                  # controller definition wins
        if "." in base and not base.startswith("Program:"):
            return f"{tag.address}: structure members need the controller's tag list"
        dt = self.TYPE_MAP.get(tag.tag_type)
        if dt is None:
            return f"{tag.address}: {tag.tag_type.value} needs the controller's tag list"
        from pycomm3.cip import DataTypes, Array
        type_class = DataTypes.get(dt)
        dim, dims = 0, [0, 0, 0]
        if idx is not None:
            dim, dims = 1, [idx + 1, 0, 0]
            type_class = Array(length_=idx + 1, element_type_=type_class)
        self._plc._tags[base] = {
            "tag_name": base, "dim": dim, "dimensions": dims, "instance_id": 0,
            "symbol_address": 0, "symbol_object_address": 0, "software_control": 0,
            "alias": False, "external_access": "Read/Write", "tag_type": "atomic",
            "data_type": dt, "data_type_name": dt, "type_class": type_class,
        }
        return None

    def _scaled(self, tag: PLCTag, value: Any) -> Any:
        if isinstance(value, bool) or tag.tag_type == TagType.BOOL:
            return bool(value)
        if isinstance(value, (int, float)):
            return float(value) * tag.scale_factor + tag.offset
        return value

    async def read_tag(self, tag: PLCTag) -> Any:
        if not self._connected or self._plc is None:
            return None
        try:
            err = self._declare(tag)
            if err:
                logger.debug(f"Logix read refused: {err}")
                return None
            result = await self._call(lambda: self._plc.read(tag.address))
            if result.error:
                logger.debug(f"Logix read error {tag.address}: {result.error}")
                return None
            return self._scaled(tag, result.value)
        except Exception as e:
            logger.debug(f"Logix read exception {tag.address}: {e}")
            self._connected = bool(self._plc and self._plc.connected)
            return None

    def _typed(self, tag: PLCTag, value: Any) -> Any:
        if tag.tag_type == TagType.BOOL:
            return bool(value)
        raw = (float(value) - tag.offset) / (tag.scale_factor or 1.0)
        if tag.tag_type == TagType.REAL:
            return float(raw)
        return int(round(raw))

    async def write_tag(self, tag: PLCTag, value: Any) -> bool:
        if not self._connected or self._plc is None:
            return False
        try:
            err = self._declare(tag)
            if err:
                logger.debug(f"Logix write refused: {err}")
                return False
            typed = self._typed(tag, value)
            result = await self._call(lambda: self._plc.write((tag.address, typed)))
            if result.error:
                logger.debug(f"Logix write error {tag.address}: {result.error}")
                return False
            return True
        except Exception as e:
            logger.debug(f"Logix write exception {tag.address}: {e}")
            self._connected = bool(self._plc and self._plc.connected)
            return False

    async def disconnect(self):
        self._connected = False
        if self._plc is not None:
            plc, self._plc = self._plc, None
            try:
                await self._call(plc.close)
            except Exception:
                pass

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
        """AF-IO-006 — only REAL types get a driver. No silent substitution: the old
        fallback handed a Modbus driver to anything unknown, so 'Beckhoff TwinCAT'
        quietly opened Modbus to port 4840."""
        tier = PLC_SUPPORT.get(config.plc_type.value, "UNSUPPORTED")
        if tier != "REAL":
            hint = (" — if this unit speaks Modbus TCP, add it explicitly as "
                    "modbus_tcp" if config.plc_type in (
                        PLCType.DELTA, PLCType.MITSUBISHI, PLCType.OMRON) else "")
            raise ValueError(
                f"PLC type {config.plc_type.value!r} is {tier} "
                f"({PLC_TIER_MEANING.get(tier, '')}){hint}. "
                f"Usable types: {', '.join(REAL_PLC_TYPES)}")
        if config.plc_type == PLCType.SIEMENS_S7:
            return SiemensS7Driver(config)
        if config.plc_type == PLCType.OPC_UA:
            return OPCUADriver(config)
        if config.plc_type == PLCType.ALLEN_BRADLEY:
            return AllenBradleyDriver(config)
        return ModbusTCPPLCDriver(config)

    async def add_plc(self, config: PLCConnection) -> dict:
        """Add and connect a PLC. A non-REAL type is refused before anything is
        stored — no connection entry, no driver, no socket opened."""
        try:
            driver = self._create_driver(config)
        except ValueError as e:
            logger.warning("add_plc refused: %s", e)
            return {"connected": False, "error": str(e), "refused": True}
        self._connections[config.id] = config
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


# Default tag templates per PLC type.
#
# SIEMENS: deliberately EMPTY. The old default table put "pump speed" at DB1.DBW0
# and "pump run" at DB1.DBX2.0 — the very addresses docs/S7_DB_CONTRACT.md defines
# as HEARTBEAT and ESTOP_OK. A default that writes a speed into the heartbeat word
# is worse than no default. Siemens tags now come from an explicitly selected,
# versioned profile (plc/s7_profiles.py, e.g. "aquaflow-s7-1215c-v1"), confirmed by
# the operator — never assigned silently to every S7 that answers.
DEFAULT_TAGS = {
    PLCType.SIEMENS_S7: [],
    PLCType.MODBUS_TCP: [
        {"id": "pump_speed",  "name": "Pump Speed",      "address": "%MW0",   "tag_type": "int",  "min_value": 0, "max_value": 1000, "scale_factor": 0.1,  "unit": "%",  "mapped_param": "speed"},
        {"id": "pump_run",    "name": "Pump Run/Stop",   "address": "%MW1",   "tag_type": "int",  "min_value": 0, "max_value": 1,    "scale_factor": 1.0,  "unit": "",   "mapped_param": "run"},
        {"id": "valve_bank",  "name": "Valve Bank",      "address": "%MW2",   "tag_type": "word", "min_value": 0, "max_value": 65535,"scale_factor": 1.0,  "unit": "",   "mapped_param": "pattern"},
        {"id": "pressure",    "name": "Pressure Sensor", "address": "%MW10",  "tag_type": "int",  "min_value": 0, "max_value": 1000, "scale_factor": 0.01, "unit": "bar","mapped_param": "pressure"},
    ],
}

plc_manager = PLCManager()
