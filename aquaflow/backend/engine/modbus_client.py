"""
engine/modbus_client.py — AF-IO-001: the ONE Modbus TCP client.

Before this module the codebase carried two hand-rolled Modbus implementations
(engine/protocol_bus.ModbusTCPDriver and plc/plc_engine.ModbusTCPPLCDriver), both
with the same read defect: `reader.read(256)` and unpack at a fixed offset with no
check of transaction id, protocol id, declared length, function code or the
exception bit — a short frame, an exception response or an out-of-order reply was
parsed as data. Both now delegate here.

What this client guarantees:
  * Exact framed reads — the 7-byte MBAP header is read with readexactly(), then
    exactly the remainder the header declares. Never a speculative read(256).
  * Full MBAP validation — protocol id must be 0, the transaction id must match the
    request, the unit id must match, and the length field must be coherent.
  * Exception decoding — a reply with the 0x80 bit set raises ModbusException with
    the standard exception name instead of being unpacked as register data.
  * One request in flight per connection — an asyncio.Lock serialises transactions,
    so replies can never be attributed to the wrong request on a shared socket.
  * Reconnect with backoff — ensure_connected() retries a dead connection with
    exponential backoff (capped) so poll loops can call it every cycle cheaply.
  * Honest address parsing — parse_register_address() no longer turns a bare "45"
    into register -39956 (the old `startswith("4")` rule); malformed addresses raise
    ValueError so callers refuse instead of silently touching register 0.

Function codes implemented (exactly the set the AF-IO plan needs — the ADAM/Moxa
remote-I/O class of device plus the existing VFD write path):
  FC02 read discrete inputs   FC03 read holding registers   FC04 read input registers
  FC05 write single coil      FC06 write single register
"""
from __future__ import annotations

import asyncio
import logging
import struct
import time
from typing import Optional

logger = logging.getLogger(__name__)

# Standard Modbus exception code names (Modbus Application Protocol v1.1b3 §7).
EXCEPTION_NAMES = {
    0x01: "ILLEGAL_FUNCTION",
    0x02: "ILLEGAL_DATA_ADDRESS",
    0x03: "ILLEGAL_DATA_VALUE",
    0x04: "SERVER_DEVICE_FAILURE",
    0x05: "ACKNOWLEDGE",
    0x06: "SERVER_DEVICE_BUSY",
    0x08: "MEMORY_PARITY_ERROR",
    0x0A: "GATEWAY_PATH_UNAVAILABLE",
    0x0B: "GATEWAY_TARGET_FAILED_TO_RESPOND",
}


class ModbusError(Exception):
    """Base class for everything this client raises."""


class ModbusFrameError(ModbusError):
    """Transport/framing fault: short frame, header mismatch, wrong txid/unit,
    timeout, or a dead socket. The connection is marked down when this is raised."""


class ModbusException(ModbusError):
    """The device answered with a Modbus exception response (function | 0x80)."""

    def __init__(self, function: int, code: int):
        self.function = function
        self.code = code
        self.name = EXCEPTION_NAMES.get(code, f"EXCEPTION_{code:#04x}")
        super().__init__(f"Modbus exception on FC{function:02d}: {self.name} (code {code})")


def parse_register_address(address) -> int:
    """
    Parse the register-address notations used across AquaFlow configs into a 0-based
    register offset. Raises ValueError on anything ambiguous or malformed — a bad
    address must make the caller refuse, never silently become register 0.

      "%MW100"          → 100
      "HR100"           → 100
      "40001".."49999"  → n - 40001   (classic 5-digit holding-register notation)
      "400001"..        → n - 400001  (6-digit notation)
      "30001".."39999"  → n - 30001   (5-digit input-register notation)
      "300001"..        → n - 300001  (6-digit notation)
      "0".."9999"       → n           (a bare offset, incl. "4", "45", "400", "4000" —
                                       the old code turned these into negative registers)
      int               → itself (must be 0..65535)
    """
    if isinstance(address, int):
        if 0 <= address <= 0xFFFF:
            return address
        raise ValueError(f"register offset out of range: {address}")

    addr = str(address).upper().strip()
    if not addr:
        raise ValueError("empty Modbus address")
    if addr.startswith("%MW"):
        return parse_register_address(int(addr[3:]))
    if addr.startswith("HR"):
        return parse_register_address(int(addr[2:]))
    if not addr.isdigit():
        raise ValueError(f"unrecognised Modbus address: {address!r}")

    n = int(addr)
    # Only the traditional 5/6-digit table notations imply an offset conversion.
    # A shorter number that merely STARTS with 4 or 3 is a plain offset.
    if len(addr) == 5 and addr[0] == "4":
        return n - 40001
    if len(addr) == 6 and addr[0] == "4":
        return n - 400001
    if len(addr) == 5 and addr[0] == "3":
        return n - 30001
    if len(addr) == 6 and addr[0] == "3":
        return n - 300001
    if n > 0xFFFF:
        raise ValueError(f"register offset out of range: {address!r}")
    return n


class ModbusTCPClient:
    """A validated, serialised Modbus TCP master for one device."""

    MAX_BACKOFF = 30.0

    def __init__(self, host: str, port: int = 502, unit_id: int = 1, *,
                 timeout: float = 1.0, connect_timeout: float = 3.0):
        self.host = host
        self.port = int(port)
        self.unit_id = int(unit_id)
        self.timeout = float(timeout)
        self.connect_timeout = float(connect_timeout)
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._connected = False
        self._lock = asyncio.Lock()
        self._txid = 0
        self._backoff = 1.0
        self._next_retry = 0.0  # monotonic deadline before the next reconnect attempt
        self.last_error = ""
        # AF-IO-007 — the last raw exchange, for the operator UI. The AF-ICAN-006
        # lesson: "what did you send" must be readable at the cabinet without a
        # packet capture.
        self.last_tx_hex = ""
        self.last_rx_hex = ""

    # ── connection lifecycle ─────────────────────────────────────────────────
    @property
    def is_connected(self) -> bool:
        return self._connected

    async def connect(self) -> bool:
        """Open the connection. Resets the reconnect backoff on success."""
        await self.close()
        try:
            self._reader, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self.host, self.port),
                timeout=self.connect_timeout,
            )
            self._connected = True
            self._backoff = 1.0
            self._next_retry = 0.0
            self.last_error = ""
            logger.info("Modbus TCP connected → %s:%s", self.host, self.port)
            return True
        except Exception as e:
            self.last_error = str(e)
            self._connected = False
            logger.warning("Modbus connect failed %s:%s: %s", self.host, self.port, e)
            return False

    async def ensure_connected(self) -> bool:
        """Cheap per-cycle reconnect guard: True when usable now. A failed attempt
        arms an exponential backoff window during which this returns False at once."""
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
            self._writer = None
            self._reader = None

    def _mark_down(self, why: str):
        self.last_error = why
        if self._connected:
            logger.warning("Modbus %s:%s marked down: %s", self.host, self.port, why)
        self._connected = False
        if self._writer is not None:
            try:
                self._writer.close()
            except Exception:
                pass
            self._writer = None
            self._reader = None

    # ── the single validated transaction path ───────────────────────────────
    async def _transact(self, pdu: bytes) -> bytes:
        """Send one request PDU and return the validated reply PDU.

        Raises ModbusException for a device exception reply and ModbusFrameError for
        any transport/validation failure (which also marks the connection down)."""
        async with self._lock:
            if not self._connected or self._writer is None or self._reader is None:
                raise ModbusFrameError("not connected")
            self._txid = (self._txid + 1) & 0xFFFF
            txid = self._txid
            mbap = struct.pack(">HHHB", txid, 0, len(pdu) + 1, self.unit_id)
            self.last_tx_hex = (mbap + pdu).hex()
            try:
                self._writer.write(mbap + pdu)
                await self._writer.drain()
                header = await asyncio.wait_for(
                    self._reader.readexactly(7), timeout=self.timeout)
                r_txid, r_proto, r_len, r_unit = struct.unpack(">HHHB", header)
                if r_len < 2 or r_len > 254:
                    raise ModbusFrameError(f"implausible MBAP length {r_len}")
                body = await asyncio.wait_for(
                    self._reader.readexactly(r_len - 1), timeout=self.timeout)
                self.last_rx_hex = (header + body).hex()
            except ModbusFrameError as e:
                self._mark_down(str(e))
                raise
            except (asyncio.IncompleteReadError, asyncio.TimeoutError,
                    ConnectionError, OSError) as e:
                self._mark_down(f"transport error: {e!r}")
                raise ModbusFrameError(f"transport error: {e!r}") from e

            # Validation happens OUTSIDE the read path so the errors are precise.
            if r_proto != 0:
                self._mark_down(f"bad protocol id {r_proto}")
                raise ModbusFrameError(f"bad protocol id {r_proto}")
            if r_txid != txid:
                # A mismatched txid means request/reply pairing is broken (stray or
                # late reply). The stream can no longer be trusted — resync by
                # reconnecting rather than guessing which reply belongs to whom.
                self._mark_down(f"transaction id mismatch (sent {txid}, got {r_txid})")
                raise ModbusFrameError(f"transaction id mismatch (sent {txid}, got {r_txid})")
            if r_unit != self.unit_id:
                self._mark_down(f"unit id mismatch (sent {self.unit_id}, got {r_unit})")
                raise ModbusFrameError(f"unit id mismatch (sent {self.unit_id}, got {r_unit})")

            fc = body[0]
            if fc & 0x80:
                code = body[1] if len(body) > 1 else 0
                # An exception reply is a healthy, well-formed conversation — the
                # device is up and talking. Do NOT mark the connection down.
                raise ModbusException(fc & 0x7F, code)
            if fc != pdu[0]:
                self._mark_down(f"function code mismatch (sent {pdu[0]:#04x}, got {fc:#04x})")
                raise ModbusFrameError(f"function code mismatch (sent {pdu[0]:#04x}, got {fc:#04x})")
            return body

    # ── reads ────────────────────────────────────────────────────────────────
    async def _read_bits(self, fc: int, address: int, count: int) -> list[bool]:
        if not 1 <= count <= 2000:
            raise ValueError(f"bit count out of range: {count}")
        body = await self._transact(struct.pack(">BHH", fc, address, count))
        expected_bytes = (count + 7) // 8
        if len(body) < 2 or body[1] != expected_bytes or len(body) != 2 + expected_bytes:
            raise ModbusFrameError(
                f"FC{fc:02d} byte count mismatch (declared "
                f"{body[1] if len(body) > 1 else '?'}, expected {expected_bytes}, "
                f"body {len(body)})")
        bits = []
        for i in range(count):
            bits.append(bool(body[2 + i // 8] >> (i % 8) & 1))
        return bits

    async def read_discrete_inputs(self, address: int, count: int = 1) -> list[bool]:
        """FC02 — the ADAM-6050 / Moxa E1212 DI class."""
        return await self._read_bits(0x02, address, count)

    async def _read_words(self, fc: int, address: int, count: int) -> list[int]:
        if not 1 <= count <= 125:
            raise ValueError(f"register count out of range: {count}")
        body = await self._transact(struct.pack(">BHH", fc, address, count))
        if len(body) < 2 or body[1] != 2 * count or len(body) != 2 + 2 * count:
            raise ModbusFrameError(
                f"FC{fc:02d} byte count mismatch (declared "
                f"{body[1] if len(body) > 1 else '?'}, expected {2 * count}, "
                f"body {len(body)})")
        return [struct.unpack_from(">H", body, 2 + 2 * i)[0] for i in range(count)]

    async def read_holding_registers(self, address: int, count: int = 1) -> list[int]:
        """FC03 — holding registers (ADAM-6017 AI, VFD registers)."""
        return await self._read_words(0x03, address, count)

    async def read_input_registers(self, address: int, count: int = 1) -> list[int]:
        """FC04 — input registers (the Moxa ioLogik AI class)."""
        return await self._read_words(0x04, address, count)

    # ── writes ───────────────────────────────────────────────────────────────
    async def write_coil(self, address: int, value: bool) -> bool:
        """FC05 — write single coil (remote-I/O DO). Echo is validated."""
        raw = 0xFF00 if value else 0x0000
        body = await self._transact(struct.pack(">BHH", 0x05, address, raw))
        if len(body) != 5 or struct.unpack(">BHH", body) != (0x05, address, raw):
            raise ModbusFrameError("FC05 echo mismatch")
        return True

    async def write_register(self, address: int, value: int) -> bool:
        """FC06 — write single holding register. Echo is validated."""
        value = max(0, min(0xFFFF, int(value)))
        body = await self._transact(struct.pack(">BHH", 0x06, address, value))
        if len(body) != 5 or struct.unpack(">BHH", body) != (0x06, address, value):
            raise ModbusFrameError("FC06 echo mismatch")
        return True
