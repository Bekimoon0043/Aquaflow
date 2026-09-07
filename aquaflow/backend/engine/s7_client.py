"""
engine/s7_client.py — AF-IO-005: the S7comm client that addresses what it names.

The old raw path in plc/plc_engine.py encoded the DB address as
    (offset >> 5), ((offset & 0x1f) << 3), 0x00
which only coincides with reality at offset 0. S7 addresses items in BITS: the
3-byte address field is byte_offset*8 + bit, big-endian. Every read of DB1.DBW2 or
beyond silently returned the wrong location — the nastiest kind of wrong, because
DB1.DBW0 (the address everyone smoke-tests with) worked.

This client is the corrected, validated implementation, mirroring the guarantees of
engine/modbus_client.py:
  * exact framed reads — TPKT is length-prefixed and read with readexactly();
  * validation — protocol id 0x32, ack_data rosctr, pdu_ref echo, header error
    class/code, per-item return code (0xFF = ok) all checked;
  * S7ItemError for a healthy device refusing an item (wrong DB, out of range) vs
    S7FrameError for transport/framing faults (which mark the connection down);
  * one request in flight (asyncio.Lock), timeout, ensure_connected() backoff.

Addressing dialect (absolute — the DB must be NON-OPTIMIZED, see
docs/S7_DB_CONTRACT.md):
    DB1.DBX2.0  one bit        DB1.DBB3  one byte
    DB1.DBW4    16-bit word    DB1.DBD8  32-bit dword (or REAL via read_real)

snap7 remains the PREFERRED transport when importable (plc/plc_engine.py checks
first); this raw client is the always-available fallback and the one the bench
fake PLC (engine/fake_s7_server.py) exercises. Bundling note: python-snap7 needs
snap7.dll shipped inside the PyInstaller bundle — a packaging task, not a pip one.
"""
from __future__ import annotations

import asyncio
import logging
import re
import struct
import time
from typing import Optional

logger = logging.getLogger("aquaflow.s7")

RET_OK = 0xFF

# Per-item return codes (S7comm data item header).
ITEM_ERRORS = {
    0x01: "HARDWARE_FAULT",
    0x03: "ACCESS_DENIED",
    0x05: "ADDRESS_OUT_OF_RANGE",
    0x06: "DATA_TYPE_NOT_SUPPORTED",
    0x07: "DATA_TYPE_INCONSISTENT",
    0x0A: "OBJECT_DOES_NOT_EXIST",
}

_ADDR_RE = re.compile(
    r"^DB(?P<db>\d+)\.DB(?P<kind>[XBWD])(?P<offset>\d+)(?:\.(?P<bit>[0-7]))?$",
    re.IGNORECASE)

_KIND_SIZE = {"X": 1, "B": 1, "W": 2, "D": 4}


class S7Error(Exception):
    """Base class for everything this client raises."""


class S7FrameError(S7Error):
    """Transport/framing fault — the connection is marked down."""


class S7ItemError(S7Error):
    """The PLC answered, refusing the item (wrong DB/offset/permissions)."""

    def __init__(self, code: int):
        self.code = code
        self.name = ITEM_ERRORS.get(code, f"ITEM_ERROR_{code:#04x}")
        super().__init__(f"S7 item error: {self.name} (code {code:#04x})")


def parse_s7_address(address: str):
    """'DB1.DBW4' → (db=1, kind='W', offset=4, bit=None); 'DB1.DBX2.0' → bit=0.
    Raises ValueError on anything else — a malformed address must refuse, never
    silently read DB offset 0 (the old parser stripped digits and hoped)."""
    m = _ADDR_RE.match(str(address).strip())
    if not m:
        raise ValueError(f"unrecognised S7 address: {address!r} "
                         f"(expected DB<n>.DB[XBWD]<offset>[.<bit>])")
    kind = m.group("kind").upper()
    bit = m.group("bit")
    if kind == "X" and bit is None:
        raise ValueError(f"bit address needs a bit number: {address!r}")
    if kind != "X" and bit is not None:
        raise ValueError(f"only DBX takes a bit number: {address!r}")
    return int(m.group("db")), kind, int(m.group("offset")), (
        int(bit) if bit is not None else None)


class S7Client:
    """A validated raw-S7comm client for one PLC (S7-1200 dialect, TCP :102)."""

    MAX_BACKOFF = 30.0

    def __init__(self, host: str, port: int = 102, rack: int = 0, slot: int = 1, *,
                 timeout: float = 1.5, connect_timeout: float = 3.0):
        self.host = host
        self.port = int(port)
        self.rack = int(rack)
        self.slot = int(slot)
        self.timeout = float(timeout)
        self.connect_timeout = float(connect_timeout)
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._connected = False
        self._lock = asyncio.Lock()
        self._pdu_ref = 0
        self._backoff = 1.0
        self._next_retry = 0.0
        self.last_error = ""
        # AF-IO-007 — the last raw exchange, hex, for the operator UI.
        self.last_tx_hex = ""
        self.last_rx_hex = ""

    # ── connection lifecycle ─────────────────────────────────────────────────
    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> bool:
        await self.close()
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port),
                timeout=self.connect_timeout)
            # COTP connection request. Remote TSAP = (0x01, rack*0x20 + slot) —
            # connection type PG, the snap7 convention for S7-1200 rack 0 slot 1.
            remote_tsap2 = (self.rack * 0x20 + self.slot) & 0xFF
            cr = bytes([
                0x11, 0xE0, 0x00, 0x00, 0x00, 0x01, 0x00,
                0xC0, 0x01, 0x0A,                     # TPDU size 1024
                0xC1, 0x02, 0x01, 0x00,               # local TSAP
                0xC2, 0x02, 0x01, remote_tsap2,       # remote TSAP
            ])
            cc = await self._exchange_raw(self._tpkt(cr))
            if len(cc) < 6 or cc[5] != 0xD0:
                raise S7FrameError("COTP connection refused (no CC)")
            # S7 communication setup (negotiate PDU size).
            setup = (bytes([0x02, 0xF0, 0x80]) +
                     bytes([0x32, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08,
                            0x00, 0x00]) +
                     bytes([0xF0, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0xF0]))
            ack = await self._exchange_raw(self._tpkt(setup))
            if len(ack) < 8 or ack[7] != 0x32:
                raise S7FrameError("S7 setup not acknowledged")
            self._connected = True
            self._backoff = 1.0
            self._next_retry = 0.0
            self.last_error = ""
            logger.info("S7 connected → %s:%s (rack %d slot %d)",
                        self.host, self.port, self.rack, self.slot)
            return True
        except Exception as e:
            self.last_error = str(e)
            self._connected = False
            if self._writer is not None:
                try:
                    self._writer.close()
                except Exception:
                    pass
                self._writer = self._reader = None
            logger.warning("S7 connect failed %s:%s: %s", self.host, self.port, e)
            return False

    async def ensure_connected(self) -> bool:
        if self._connected:
            return True
        now = time.monotonic()
        if now < self._next_retry:
            return False
        if await self.connect():
            return True
        self._next_retry = now + self._backoff
        self._backoff = min(self._backoff * 2, self.MAX_BACKOFF)
        return False

    async def close(self):
        self._connected = False
        if self._writer is not None:
            try:
                self._writer.close()
            except Exception:
                pass
            self._writer = self._reader = None

    def _mark_down(self, why: str):
        self.last_error = why
        if self._connected:
            logger.warning("S7 %s:%s marked down: %s", self.host, self.port, why)
        self._connected = False
        if self._writer is not None:
            try:
                self._writer.close()
            except Exception:
                pass
            self._writer = self._reader = None

    # ── framing ──────────────────────────────────────────────────────────────
    @staticmethod
    def _tpkt(payload: bytes) -> bytes:
        return struct.pack(">BBH", 0x03, 0x00, len(payload) + 4) + payload

    @staticmethod
    def _item(db: int, byte_offset: int, count: int, *, bit: int = 0,
              transport: int = 0x02) -> bytes:
        # THE fix: the 3-byte address is in BITS — byte_offset*8 + bit, big-endian.
        addr = (byte_offset << 3) | bit
        return (bytes([0x12, 0x0A, 0x10, transport]) + struct.pack(">H", count) +
                struct.pack(">H", db) + bytes([0x84]) +
                bytes([(addr >> 16) & 0xFF, (addr >> 8) & 0xFF, addr & 0xFF]))

    async def _exchange_raw(self, frame: bytes) -> bytes:
        """Send one TPKT frame, return the complete TPKT reply (exact framed read)."""
        try:
            self.last_tx_hex = frame.hex()
            self._writer.write(frame)
            await self._writer.drain()
            tpkt = await asyncio.wait_for(self._reader.readexactly(4),
                                          timeout=self.timeout)
            if tpkt[0] != 0x03:
                raise S7FrameError(f"not a TPKT frame ({tpkt[0]:#04x})")
            total = struct.unpack(">H", tpkt[2:4])[0]
            if total < 7 or total > 8192:
                raise S7FrameError(f"implausible TPKT length {total}")
            rest = await asyncio.wait_for(self._reader.readexactly(total - 4),
                                          timeout=self.timeout)
            self.last_rx_hex = (tpkt + rest).hex()
            return tpkt + rest
        except S7FrameError:
            raise
        except (asyncio.IncompleteReadError, asyncio.TimeoutError,
                ConnectionError, OSError) as e:
            raise S7FrameError(f"transport error: {e!r}") from e

    async def _transact(self, param: bytes, data: bytes = b"") -> tuple[bytes, bytes]:
        """One validated S7 JOB → (reply param, reply data)."""
        async with self._lock:
            if not self._connected or self._writer is None:
                raise S7FrameError("not connected")
            self._pdu_ref = (self._pdu_ref + 1) & 0xFFFF
            header = (bytes([0x32, 0x01, 0x00, 0x00]) +
                      struct.pack(">H", self._pdu_ref) +
                      struct.pack(">HH", len(param), len(data)))
            frame = self._tpkt(bytes([0x02, 0xF0, 0x80]) + header + param + data)
            try:
                reply = await self._exchange_raw(frame)
            except S7FrameError as e:
                self._mark_down(str(e))
                raise
            s7 = reply[7:]                              # skip TPKT(4) + COTP DT(3)
            if len(s7) < 12 or s7[0] != 0x32:
                self._mark_down("not an S7 PDU")
                raise S7FrameError("not an S7 PDU")
            if s7[1] != 0x03:                           # ack_data expected
                self._mark_down(f"unexpected rosctr {s7[1]:#04x}")
                raise S7FrameError(f"unexpected rosctr {s7[1]:#04x}")
            ref = struct.unpack(">H", s7[4:6])[0]
            if ref != self._pdu_ref:
                self._mark_down(f"pdu_ref mismatch (sent {self._pdu_ref}, got {ref})")
                raise S7FrameError(f"pdu_ref mismatch (sent {self._pdu_ref}, got {ref})")
            param_len, data_len = struct.unpack(">HH", s7[6:10])
            err_cls, err_code = s7[10], s7[11]
            if err_cls or err_code:
                raise S7ItemError(err_code)
            body = s7[12:]
            if len(body) < param_len + data_len:
                self._mark_down("truncated S7 body")
                raise S7FrameError("truncated S7 body")
            return body[:param_len], body[param_len:param_len + data_len]

    # ── typed reads ──────────────────────────────────────────────────────────
    async def read_bytes(self, db: int, offset: int, size: int) -> bytes:
        param = bytes([0x04, 0x01]) + self._item(db, offset, size)
        _, data = await self._transact(param)
        if len(data) < 4:
            raise S7FrameError("read reply data too short")
        if data[0] != RET_OK:
            raise S7ItemError(data[0])
        payload = data[4:]
        if len(payload) < size:
            raise S7FrameError(
                f"read returned {len(payload)} byte(s), wanted {size}")
        return payload[:size]

    async def read_bit(self, db: int, offset: int, bit: int) -> bool:
        param = bytes([0x04, 0x01]) + self._item(db, offset, 1, bit=bit,
                                                 transport=0x01)
        _, data = await self._transact(param)
        # An item REFUSAL is exactly 4 bytes (retcode, transport 0, length 0) — check
        # the return code before demanding a payload, or a real ACCESS_DENIED on a
        # BOOL reads as a framing fault and marks the connection down.
        if len(data) < 4:
            raise S7FrameError("bit read reply too short")
        if data[0] != RET_OK:
            raise S7ItemError(data[0])
        if len(data) < 5:
            raise S7FrameError("bit read reply carries no payload")
        return bool(data[4] & 1)

    async def read_word(self, db: int, offset: int) -> int:
        return struct.unpack(">H", await self.read_bytes(db, offset, 2))[0]

    async def read_int(self, db: int, offset: int) -> int:
        return struct.unpack(">h", await self.read_bytes(db, offset, 2))[0]

    async def read_dword(self, db: int, offset: int) -> int:
        return struct.unpack(">I", await self.read_bytes(db, offset, 4))[0]

    async def read_dint(self, db: int, offset: int) -> int:
        return struct.unpack(">i", await self.read_bytes(db, offset, 4))[0]

    async def read_real(self, db: int, offset: int) -> float:
        return struct.unpack(">f", await self.read_bytes(db, offset, 4))[0]

    # ── typed writes ─────────────────────────────────────────────────────────
    async def write_bytes(self, db: int, offset: int, payload: bytes) -> bool:
        param = bytes([0x05, 0x01]) + self._item(db, offset, len(payload))
        data = (bytes([0x00, 0x04]) + struct.pack(">H", len(payload) * 8) +
                payload)
        _, rdata = await self._transact(param, data)
        if not rdata or rdata[0] != RET_OK:
            raise S7ItemError(rdata[0] if rdata else 0)
        return True

    async def write_bit(self, db: int, offset: int, bit: int, value: bool) -> bool:
        param = bytes([0x05, 0x01]) + self._item(db, offset, 1, bit=bit,
                                                 transport=0x01)
        data = (bytes([0x00, 0x03]) + struct.pack(">H", 1) +
                bytes([1 if value else 0]))
        _, rdata = await self._transact(param, data)
        if not rdata or rdata[0] != RET_OK:
            raise S7ItemError(rdata[0] if rdata else 0)
        return True

    async def write_word(self, db: int, offset: int, value: int) -> bool:
        return await self.write_bytes(db, offset,
                                      struct.pack(">H", int(value) & 0xFFFF))

    async def write_real(self, db: int, offset: int, value: float) -> bool:
        return await self.write_bytes(db, offset, struct.pack(">f", float(value)))

    # ── address-string convenience (the FieldPoint dialect) ──────────────────
    async def read_address(self, address: str, raw_type: str = "uint16"):
        """Read a 'DB<n>.DB[XBWD]<offset>[.<bit>]' address, typed by raw_type."""
        db, kind, offset, bit = parse_s7_address(address)
        if kind == "X":
            return 1 if await self.read_bit(db, offset, bit) else 0
        if kind == "B":
            return (await self.read_bytes(db, offset, 1))[0]
        if kind == "W":
            return await self.read_word(db, offset)     # evaluate() handles int16
        if raw_type == "real":
            return await self.read_real(db, offset)
        return await self.read_dword(db, offset)

    async def write_address(self, address: str, value, raw_type: str = "uint16") -> bool:
        db, kind, offset, bit = parse_s7_address(address)
        if kind == "X":
            return await self.write_bit(db, offset, bit, bool(value))
        if kind == "B":
            return await self.write_bytes(db, offset, bytes([int(value) & 0xFF]))
        if kind == "W":
            return await self.write_word(db, offset, int(value))
        if raw_type == "real":
            return await self.write_real(db, offset, float(value))
        return await self.write_bytes(db, offset,
                                      struct.pack(">I", int(value) & 0xFFFFFFFF))
