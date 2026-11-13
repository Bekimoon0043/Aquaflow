"""
engine/fake_s7_server.py — AF-IO-008: a minimal S7comm PLC for the bench.

The same idea as engine/fake_ican_gateway.py: enough of the real protocol to
exercise AquaFlow's client code end to end with injectable faults, and nothing
more. Speaks the S7-1200 dialect AquaFlow uses: COTP connection setup, S7
communication setup, and Read Var / Write Var against non-optimized DBs with
absolute BIT addressing (the address field is byte_offset*8 + bit — the exact
encoding the old raw driver got wrong and AF-IO-005 fixes).

DB model: db_number → bytearray. Words are big-endian, as on the wire.

Halted-CPU simulation: the server keeps answering reads forever (a halted CPU
does exactly that), and the heartbeat WORD only advances when the test calls
tick_heartbeat(). Not calling it IS the halted CPU — there is no special mode,
because that is precisely what makes the failure sneaky.

Fault modes:
  None      — behave correctly
  "error"   — every Read/Write Var item answers return code 0x05 (address out of
              range) instead of data
  "short"   — answer a Read/Write Var with a truncated TPKT frame, then close
  "drop"    — close the connection on the first Read/Write Var after setup
(Faults apply to the DATA phase only — the COTP/S7 handshake always succeeds, the
way a real PLC that later fails mid-session behaves.)

Jitter injection: `write_delay` / `read_delay` (callables returning seconds) delay each
Write Var / Read Var request before it touches the DB — the PC/network jitter a show
must survive.  Requests on one connection stay in order, as on the wire.

FakeAquaFlowPlc (below) runs the generated AquaFlowSiteControl FB logic — contract v3
(10-ms OB, PLC show clock, timestamped bank ring) or v2 (100-ms OB, streamed banks) —
against this server's DB on its own thread, so tests can measure when outputs change on
the PLC's clock while the PC and network jitter.

Discovery additions (read-only identification, engine/s7_identify.py):
  expected_slot   — when set, a COTP CR whose remote TSAP names another slot is
                    refused (connection dropped, or a COTP DR with
                    handshake_mode="refuse_dr"), the way a real rack answers a
                    wrong rack/slot
  handshake_mode  — "cc_short" (truncated CC), "setup_bad_ref", "setup_truncated",
                    "setup_error", "setup_wrong_rosctr", "setup_bad_proto",
                    "setup_zero_pdu": malformed handshake replies discovery must refuse
  identity        — SZL 0x0011/0x001C content (order number, module name, ...);
                    szl_supported=False answers the userdata request with an error,
                    like a CPU that does not expose the list
"""
from __future__ import annotations

import asyncio
import logging
import struct
import threading
import time
from typing import Callable, Optional

logger = logging.getLogger("aquaflow.fake_s7")

# S7 item return codes (the per-item status byte in a Read/Write Var reply).
RET_OK = 0xFF
RET_ADDR_OUT_OF_RANGE = 0x05


class FakeS7Server:
    """A scriptable S7comm responder bound to 127.0.0.1:<ephemeral>."""

    def __init__(self, mode: Optional[str] = None, *, expected_slot: Optional[int] = None,
                 handshake_mode: Optional[str] = None, identity: Optional[dict] = None,
                 szl_supported: bool = True, szl_max_part: int = 0):
        self.mode = mode
        self.expected_slot = expected_slot
        self.handshake_mode = handshake_mode
        self.identity = identity or {
            "order_number": "6ES7 215-1AG40-0XB0", "module_name": "CPU 1215C DC/DC/DC",
            "plc_name": "AquaFlowPLC", "serial_number": "S C-FAKE00001",
            "hardware_version": (1, 0), "firmware_version": (4, 5, 2),
        }
        self.szl_supported = szl_supported
        # szl_max_part > 0 models a CPU whose SZL data does not fit one PDU: the
        # list is served in parts of at most this many data bytes, each flagged
        # 'last data unit = 1' except the final one, and the client must fetch the
        # rest with SZL-NEXT telegrams carrying the sequence number we hand out.
        # A real S7-1200 (PDU 240) does exactly this for SZL 0x001C.
        self.szl_max_part = int(szl_max_part)
        self._szl_pending: dict[int, bytes] = {}       # seq → remaining list bytes
        self._szl_seq = 0
        self.szl_reads = 0
        self.szl_next_reads = 0
        self.dbs: dict[int, bytearray] = {1: bytearray(64)}
        self.reads = 0
        self.writes = 0
        # One S7 item is consistent against the PLC cycle (FakeAquaFlowPlc holds this lock
        # for a whole OB execution, the server for one Read/Write Var item).
        self.lock = threading.RLock()
        self.write_delay: Optional[Callable[[], float]] = None
        self.read_delay: Optional[Callable[[], float]] = None
        self._server: Optional[asyncio.Server] = None
        self._conns: list[asyncio.StreamWriter] = []
        self.port: Optional[int] = None

    # ── DB helpers for tests ─────────────────────────────────────────────────
    def set_word(self, db: int, offset: int, value: int):
        buf = self.dbs.setdefault(db, bytearray(64))
        struct.pack_into(">H", buf, offset, value & 0xFFFF)

    def get_word(self, db: int, offset: int) -> int:
        return struct.unpack_from(">H", self.dbs[db], offset)[0]

    def set_bit(self, db: int, offset: int, bit: int, value: bool):
        buf = self.dbs.setdefault(db, bytearray(64))
        if value:
            buf[offset] |= 1 << bit
        else:
            buf[offset] &= ~(1 << bit)

    def tick_heartbeat(self, db: int = 1, offset: int = 0):
        """Advance the heartbeat counter — the thing a HALTED CPU stops doing
        while still answering every read."""
        self.set_word(db, offset, (self.get_word(db, offset) + 1) & 0xFFFF)

    # ── lifecycle ────────────────────────────────────────────────────────────
    async def start(self):
        self._server = await asyncio.start_server(self._handle, "127.0.0.1", 0)
        self.port = self._server.sockets[0].getsockname()[1]

    async def stop(self):
        if self._server:
            self._server.close()
            for w in self._conns:
                try:
                    w.close()
                except Exception:
                    pass
            self._conns = []
            await self._server.wait_closed()

    # ── the protocol ─────────────────────────────────────────────────────────
    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        self._conns.append(writer)
        try:
            while True:
                tpkt = await reader.readexactly(4)
                if tpkt[0] != 0x03:
                    return                                     # not TPKT — hang up
                total = struct.unpack(">H", tpkt[2:4])[0]
                frame = await reader.readexactly(total - 4)
                delay = self._data_delay(frame)
                if delay > 0:
                    await asyncio.sleep(delay)
                self._close_after_reply = False
                reply = self._reply(frame)
                if reply is None:                              # drop mode
                    writer.close()
                    return
                writer.write(reply)
                await writer.drain()
                if self._close_after_reply:                    # short mode
                    writer.close()
                    return
        except (asyncio.IncompleteReadError, ConnectionError, OSError):
            pass

    def _data_delay(self, frame: bytes) -> float:
        """Injected latency for a Read/Write Var JOB (0 for everything else)."""
        cotp_len = frame[0] + 1
        s7 = frame[cotp_len:]
        if len(s7) < 11 or s7[0] != 0x32 or s7[1] != 0x01:
            return 0.0
        source = {0x04: self.read_delay, 0x05: self.write_delay}.get(s7[10])
        return max(0.0, float(source())) if source else 0.0

    def _reply(self, frame: bytes) -> Optional[bytes]:
        with self.lock:
            return self._reply_locked(frame)

    def _reply_locked(self, frame: bytes) -> Optional[bytes]:
        # frame = COTP + payload (TPKT already consumed).
        cotp_len = frame[0] + 1
        cotp, s7 = frame[:cotp_len], frame[cotp_len:]

        # COTP connection request → connection confirm.
        if len(cotp) >= 2 and cotp[1] == 0xE0:
            if self.expected_slot is not None:
                # remote TSAP = C2 02 01 <rack*0x20+slot>; find it in the CR params
                idx = cotp.find(b"\xc2\x02")
                slot = (cotp[idx + 3] & 0x1F) if idx >= 0 and idx + 3 < len(cotp) else None
                if slot != self.expected_slot:
                    if self.handshake_mode == "refuse_dr":
                        # COTP Disconnect Request: LI 6, 0x80, dst-ref, src-ref, reason
                        return self._tpkt(bytes([0x06, 0x80]) + cotp[4:6] + cotp[2:4] + bytes([0x00]))
                    return None                            # a real rack just drops it
            if self.handshake_mode == "cc_short":
                self._close_after_reply = True
                return b"\x03\x00\x00\x06\x02\xd0"     # TPKT says 6, CC cut off
            # dst-ref = the caller's src-ref (swap the two 16-bit refs), class 0
            cc = bytes([0x11, 0xD0]) + cotp[4:6] + bytes([0x00, 0x01, 0x00]) + cotp[7:]
            return self._tpkt(cc)

        if len(s7) < 10 or s7[0] != 0x32:
            return self._tpkt(cotp)                            # echo nonsense politely

        rosctr = s7[1]
        pdu_ref = s7[4:6]

        if rosctr == 0x07:                                     # USERDATA (SZL read)
            return self._userdata(pdu_ref, s7)

        if rosctr == 0x01:                                     # JOB
            function = s7[10]
            if function == 0xF0:                               # setup communication
                param = s7[10:18]                              # echo negotiated params
                hm = self.handshake_mode
                if hm == "setup_bad_ref":
                    bad = struct.pack(">H", (struct.unpack(">H", pdu_ref)[0] + 1) & 0xFFFF)
                    return self._s7_ack(bad, param, b"")
                if hm == "setup_truncated":
                    full = self._s7_ack(pdu_ref, param, b"")
                    self._close_after_reply = True
                    return full[:-4]                           # TPKT length lies by 4
                if hm == "setup_error":
                    return self._s7_ack(pdu_ref, param, b"", error=(0x85, 0x00))
                if hm == "setup_wrong_rosctr":
                    ack = bytearray(self._s7_ack(pdu_ref, param, b""))
                    ack[8] = 0x01                              # ROSCTR job instead of ack-data
                    return bytes(ack)
                if hm == "setup_bad_proto":
                    ack = bytearray(self._s7_ack(pdu_ref, param, b""))
                    ack[7] = 0x33
                    return bytes(ack)
                if hm == "setup_zero_pdu":
                    param = param[:6] + b"\x00\x00"
                return self._s7_ack(pdu_ref, param, b"")
            if function in (0x04, 0x05):
                # Data-phase fault injection lives HERE so the handshake stays clean.
                if self.mode == "drop":
                    return None
                if self.mode == "short":
                    self._close_after_reply = True
                    return b"\x03\x00\x00\x05\x02"             # truncated TPKT
            if function == 0x04:                               # Read Var
                return self._read_var(pdu_ref, s7)
            if function == 0x05:                               # Write Var
                return self._write_var(pdu_ref, s7)
        return self._s7_ack(pdu_ref, bytes([0x00, 0x00]), b"")

    @staticmethod
    def _parse_item(item: bytes):
        """Item spec: 12 0a 10 <transport> <length:2> <db:2> <area> <addr:3>.
        The 3-byte address is in BITS: byte_offset*8 + bit — the encoding that
        matters. Returns (db, byte_offset, bit, count, transport)."""
        transport = item[3]
        count = struct.unpack(">H", item[4:6])[0]
        db = struct.unpack(">H", item[6:8])[0]
        area = item[8]
        addr = (item[9] << 16) | (item[10] << 8) | item[11]
        if area != 0x84:                                       # only DB area modelled
            return None
        return db, addr >> 3, addr & 0x07, count, transport

    def _read_var(self, pdu_ref: bytes, s7: bytes) -> bytes:
        self.reads += 1
        item = s7[12:24]
        parsed = self._parse_item(item)
        if parsed is None or self.mode == "error":
            data = bytes([RET_ADDR_OUT_OF_RANGE, 0x00, 0x00, 0x00])
            return self._s7_ack(pdu_ref, bytes([0x04, 0x01]), data)
        db, offset, bit, count, transport = parsed
        buf = self.dbs.get(db)
        if buf is None or offset + count > len(buf):
            data = bytes([RET_ADDR_OUT_OF_RANGE, 0x00, 0x00, 0x00])
            return self._s7_ack(pdu_ref, bytes([0x04, 0x01]), data)
        if transport == 0x01:                                  # BIT transport
            value = (buf[offset] >> bit) & 1
            data = bytes([RET_OK, 0x03]) + struct.pack(">H", 1) + bytes([value])
        else:                                                  # BYTE/WORD transport
            payload = bytes(buf[offset:offset + count])
            data = bytes([RET_OK, 0x04]) + struct.pack(">H", count * 8) + payload
        return self._s7_ack(pdu_ref, bytes([0x04, 0x01]), data)

    def _write_var(self, pdu_ref: bytes, s7: bytes) -> bytes:
        self.writes += 1
        item = s7[12:24]
        parsed = self._parse_item(item)
        if parsed is None or self.mode == "error":
            return self._s7_ack(pdu_ref, bytes([0x05, 0x01]),
                                bytes([RET_ADDR_OUT_OF_RANGE]))
        db, offset, bit, count, transport = parsed
        buf = self.dbs.setdefault(db, bytearray(64))
        data_part = s7[24:]                                    # retcode-less on request
        # Request data header: 00 <transport> <length_bits:2> <payload>
        payload = data_part[4:]
        if transport == 0x01:                                  # single BIT
            self.set_bit(db, offset, bit, bool(payload[0] & 1))
        else:
            if offset + count > len(buf):
                return self._s7_ack(pdu_ref, bytes([0x05, 0x01]),
                                    bytes([RET_ADDR_OUT_OF_RANGE]))
            buf[offset:offset + count] = payload[:count]
        return self._s7_ack(pdu_ref, bytes([0x05, 0x01]), bytes([RET_OK]))

    # ── SZL (system status list) — read-only identity ───────────────────────
    def _userdata(self, pdu_ref: bytes, s7: bytes) -> bytes:
        """Answer a read-SZL userdata request (0x0011 module id, 0x001C component
        id). Anything else, or szl_supported=False, gets a userdata error reply."""
        plen, dlen = struct.unpack(">HH", s7[6:10])
        param = s7[10:10 + plen]
        data = s7[10 + plen:10 + plen + dlen]
        seq = param[7] if len(param) >= 8 else 0

        # SZL-NEXT: 12-byte parameter block echoing our sequence number, empty data.
        if plen == 12 and len(data) >= 1 and data[0] == 0x0A:
            self.szl_next_reads += 1
            remaining = self._szl_pending.pop(seq, None)
            if remaining is None:
                rparam = (bytes([0x00, 0x01, 0x12, 0x08, 0x12, 0x84, 0x01, seq, 0x00, 0x00]) +
                          struct.pack(">H", 0xD402))           # unknown sequence
                return self._s7_userdata(pdu_ref, rparam, bytes([0x0A, 0x00, 0x00, 0x00]))
            return self._szl_part(pdu_ref, seq, remaining, first=False)

        self.szl_reads += 1
        szl_id = struct.unpack(">H", data[4:6])[0] if len(data) >= 8 else 0
        records: list[bytes] = []
        rec_len = 0
        if self.szl_supported and szl_id == 0x0011:
            rec_len = 28
            idn = self.identity
            hw = idn.get("hardware_version", (1, 0))
            fw = idn.get("firmware_version", (4, 5, 2))
            mlfb = idn.get("order_number", "").encode("ascii").ljust(20, b"\x00")[:20]
            # Real CPUs encode the version words as on the wire: index 1 carries the
            # hardware issue in Ausbg1; index 7 carries 'V'<<8 | major in Ausbg1 and
            # minor<<8 | patch in Ausbe (snap7 GetOrderCode reads V1/V2/V3 from the
            # last three bytes of the list — exactly these).
            records.append(struct.pack(">H", 1) + mlfb + struct.pack(">HHH", 0, (hw[0] << 8) | hw[1], 0))
            records.append(struct.pack(">H", 6) + mlfb + struct.pack(">HHH", 0, (hw[0] << 8) | hw[1], 0))
            records.append(struct.pack(">H", 7) + mlfb +
                           struct.pack(">HHH", 0, (0x56 << 8) | fw[0], (fw[1] << 8) | fw[2]))
        elif self.szl_supported and szl_id == 0x001C:
            rec_len = 34
            idn = self.identity
            for idx, key in ((1, "plc_name"), (2, "module_name"), (3, "plant_designation"),
                             (4, "copyright"), (5, "serial_number"), (7, "module_type_name")):
                text = idn.get(key, "").encode("ascii").ljust(32, b"\x00")[:32]
                records.append(struct.pack(">H", idx) + text)
        if not records:
            rparam = (bytes([0x00, 0x01, 0x12, 0x08, 0x12, 0x84, 0x01, seq, 0x00, 0x00]) +
                      struct.pack(">H", 0x8104))               # "function not supported"
            rdata = bytes([0x0A, 0x00, 0x00, 0x00])
            return self._s7_userdata(pdu_ref, rparam, rdata)
        body = struct.pack(">HHHH", szl_id, 0, rec_len, len(records)) + b"".join(records)
        return self._szl_part(pdu_ref, seq, body, first=True)

    def _szl_part(self, pdu_ref: bytes, seq: int, body: bytes, *, first: bool) -> bytes:
        """Serve `body` (the SZL list, header included on the first part) either
        whole or as the next slice of a multi-part transfer."""
        if self.szl_max_part and len(body) > self.szl_max_part:
            part, rest = body[:self.szl_max_part], body[self.szl_max_part:]
            self._szl_seq = (self._szl_seq % 0xFF) + 1
            out_seq = self._szl_seq
            self._szl_pending[out_seq] = rest
            last = 0x01                                       # more follows
        else:
            part, out_seq, last = body, seq, 0x00
        rparam = bytes([0x00, 0x01, 0x12, 0x08, 0x12, 0x84, 0x01, out_seq, 0x00, last, 0x00, 0x00])
        rdata = bytes([0xFF, 0x09]) + struct.pack(">H", len(part)) + part
        return self._s7_userdata(pdu_ref, rparam, rdata)

    def _s7_userdata(self, pdu_ref: bytes, param: bytes, data: bytes) -> bytes:
        header = (bytes([0x32, 0x07, 0x00, 0x00]) + pdu_ref +
                  struct.pack(">HH", len(param), len(data)))
        return self._tpkt(bytes([0x02, 0xF0, 0x80]) + header + param + data)

    # ── framing ──────────────────────────────────────────────────────────────
    @staticmethod
    def _tpkt(payload: bytes) -> bytes:
        return struct.pack(">BBH", 0x03, 0x00, len(payload) + 4) + payload

    def _s7_ack(self, pdu_ref: bytes, param: bytes, data: bytes,
                error: tuple = (0x00, 0x00)) -> bytes:
        header = (bytes([0x32, 0x03, 0x00, 0x00]) + pdu_ref +
                  struct.pack(">HH", len(param), len(data)) +
                  bytes(error))                                # error class/code
        cotp = bytes([0x02, 0xF0, 0x80])
        return self._tpkt(cotp + header + param + data)


class FakeAquaFlowPlc:
    """The generated AquaFlowSiteControl FB, executed on a thread against a FakeS7Server DB.

    A line-by-line model of services/siemens_tia_package.py's SCL for contract v3 (10-ms OB:
    PLC show clock, timestamped bank ring, keepalive watchdog, underrun hold/stop, ms min
    on/off) and v2 (100-ms OB, streamed banks).  Each OB execution holds `server.lock`, the
    way a real CPU serves an S7 item between OB executions, never inside one.

    Controls: `local_permit` (the healthy-high field inputs), `halted` (CPU STOP: no OB runs,
    the server still answers), `freeze_heartbeat` (OB runs but PlcHeartbeat stops),
    `accept_commits` (False: ignore new CommandSequence values).

    Measurement: `applied` lists every ring bank applied (at_ms, clock_ms, late_ms on the PLC
    clock, wall_late_ms against the thread's wall clock since RUN); `events` lists every change
    of the physical outputs with the PLC clock and wall time.
    """

    def __init__(self, server: FakeS7Server, site: dict, *, contract_version: Optional[int] = None,
                 db: Optional[int] = None):
        from engine import siemens_contract as C
        from engine.siemens_site import signature
        self.C = C
        self.server = server
        self.site = site
        self.db = int(db or site["plc"]["db"])
        self.version = int(contract_version or C.CONTRACT_VERSION)
        profile = C.PROFILES[self.version]
        self.cycle_ms = profile["cycle_ms"]
        self.buffered_capable = profile["buffered"]
        buf = bytearray(profile["db_size"])
        struct.pack_into(">HHHHII", buf, 0, C.MAGIC, self.version, C.HEADER_SIZE, 0,
                         signature(site), profile["program_version"])
        struct.pack_into(">HHHH", buf, 34, self.cycle_ms, C.PUMP_CAPACITY, C.VALVE_CAPACITY, C.LIGHT_CAPACITY)
        if self.buffered_capable:
            struct.pack_into(">H", buf, C.BUFFER_CAPACITY_OFFSET, C.BUFFER_CAPACITY)
        with server.lock:
            server.dbs[self.db] = buf
        self.local_permit = True
        self.halted = False
        self.freeze_heartbeat = False
        self.accept_commits = True
        # FB statics (non-retentive instance DB)
        self.last_seq = 0
        self.age_ms = C.WATCHDOG_MS          # = legacy MissedCycles := 10: not healthy until a commit
        self.ready = False
        self.running = False
        self.buffered = False
        self.clock = 0
        self.last_keepalive = 0
        self.stream_fault = 0
        self.late_flag = False
        self.pump = [0] * C.PUMP_CAPACITY
        self.valves = bytearray(C.VALVE_CAPACITY // 8)
        self.lights = bytearray(C.LIGHT_CAPACITY * 3)
        self.valve_open = [False] * C.VALVE_CAPACITY
        self.valve_age = [0] * C.VALVE_CAPACITY
        # measurement
        self.applied: list[dict] = []
        self.events: list[dict] = []
        self.outputs: dict = {}
        self.ticks = 0
        self.run_wall: Optional[float] = None
        self.run_start_wall: Optional[float] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()

    # ── lifecycle ────────────────────────────────────────────────────────────
    def start(self):
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="fake-aquaflow-plc", daemon=True)
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()
        if self._thread:
            self._thread.join(2)

    def _loop(self):
        period = self.cycle_ms / 1000
        due = time.perf_counter()
        while not self._stop.is_set():
            due += period
            delay = due - time.perf_counter()
            if delay > 0:
                time.sleep(delay)
            elif delay < -5 * period:          # far behind (host stalled): drop the queued events
                due = time.perf_counter()
            if not self.halted:
                self.tick()

    def tick(self):
        with self.server.lock:
            self._cycle(time.perf_counter())

    # ── DB access ────────────────────────────────────────────────────────────
    @property
    def _db(self) -> bytearray:
        return self.server.dbs[self.db]

    def _w(self, offset):
        return struct.unpack_from(">H", self._db, offset)[0]

    def _put(self, offset, value):
        struct.pack_into(">H", self._db, offset, value & 0xFFFF)

    def _d(self, offset):
        return struct.unpack_from(">I", self._db, offset)[0]

    def _putd(self, offset, value):
        struct.pack_into(">I", self._db, offset, value & 0xFFFFFFFF)

    def _adopt(self, bank: bytes):
        C = self.C
        self.pump = [struct.unpack_from(">H", bank, i * 2)[0] for i in range(C.PUMP_CAPACITY)]
        base = C.VALVE_COMMAND_OFFSET - C.PUMP_COMMAND_OFFSET
        self.valves = bytearray(bank[base:base + C.VALVE_CAPACITY // 8])
        base = C.LIGHT_COMMAND_OFFSET - C.PUMP_COMMAND_OFFSET
        self.lights = bytearray(bank[base:base + C.LIGHT_CAPACITY * 3])

    # ── one OB execution ─────────────────────────────────────────────────────
    def _cycle(self, wall: float):
        C, b = self.C, self._db
        self.ticks += 1
        if not self.freeze_heartbeat:
            self._put(16, self._w(16) + 1)
        permit = bool(self.local_permit)
        self._put(20, 0x003F if permit else 0x0000)
        was_running = self.running
        started = False
        self.age_ms = min(30000, self.age_ms + self.cycle_ms)
        seq, flags = self._w(26), self._w(28)
        if self.accept_commits and seq != self.last_seq and not flags & C.FLAG_STAGING:
            self._put(30, 0)
            candidate = bytes(b[C.PUMP_COMMAND_OFFSET:C.COMMAND_END])
            self.last_seq = seq
            self.age_ms = 0
            want_buffered = self.buffered_capable and bool(flags & C.FLAG_BUFFERED)
            if want_buffered and flags & C.FLAG_RUN and self.running and self.buffered:
                pass                                   # keepalive commit: the ring owns the outputs
            else:
                self._adopt(candidate)
                if flags & C.FLAG_RESET:
                    self.ready = self.running = False
                if not flags & C.FLAG_RUN:
                    self.running = False
                    self.ready = permit
                    self.stream_fault = 0
                elif self.running and self.buffered != want_buffered:
                    self.running = self.ready = False
                    self._put(30, 5)
                else:
                    if not self.running:
                        self.buffered = want_buffered
                    self.running = self.ready and permit
                    if not permit:
                        self._put(30, 1)
                    elif not self.ready:
                        self._put(30, 2)
                    started = self.running and self.buffered and not was_running
        if self.running and not was_running:
            self.run_start_wall = wall                 # RUN accepted: the show starts on the PLC
        if started:
            self.last_keepalive = self._w(C.STREAM_KEEPALIVE_OFFSET)
        if self.running and self.buffered and self._w(C.STREAM_KEEPALIVE_OFFSET) != self.last_keepalive:
            self.last_keepalive = self._w(C.STREAM_KEEPALIVE_OFFSET)
            self.age_ms = 0
        if not permit or self.age_ms >= C.WATCHDOG_MS:
            self.running = self.ready = False
        self._putd(44, self.age_ms)

        underrun = False
        if self.running and self.buffered:
            if started:
                self.clock = 0
                self.late_flag = False
                self._put(C.LAST_LATE_OFFSET, 0)
                self._put(C.WORST_LATE_OFFSET, 0)
                self._putd(C.APPLIED_AT_OFFSET, 0)
                self.run_wall = wall
            else:
                self.clock += self.cycle_ms
            write_index, valid_until = self._w(C.BUFFER_WRITE_OFFSET), self._d(C.VALID_UNTIL_OFFSET)
            invalid = trip = False
            for _ in range(C.BUFFER_CAPACITY):
                read_index = self._w(C.BUFFER_READ_OFFSET)
                pending = (write_index - read_index) & 0xFFFF
                if pending == 0:
                    break
                if pending > C.BUFFER_CAPACITY:
                    invalid = True
                    break
                slot = C.slot_offset(read_index)
                at = self._d(slot)
                if at > self.clock:
                    break
                if at < self._d(C.APPLIED_AT_OFFSET):
                    invalid = True
                    break
                self._adopt(bytes(b[slot + 4:slot + C.SLOT_SIZE]))
                late = min(65535, self.clock - at)
                self._put(C.LAST_LATE_OFFSET, late)
                if late > self._w(C.WORST_LATE_OFFSET):
                    self._put(C.WORST_LATE_OFFSET, late)
                if late >= self.cycle_ms:
                    self.late_flag = True
                self._putd(C.APPLIED_AT_OFFSET, at)
                self._put(C.BUFFER_READ_OFFSET, read_index + 1)
                self.applied.append({"at_ms": at, "clock_ms": self.clock, "late_ms": self.clock - at,
                                     "wall_late_ms": (wall - self.run_wall) * 1000 - at})
            if self.clock > valid_until:
                underrun = True
                trip = self.clock - valid_until >= C.UNDERRUN_LIMIT_MS
            if invalid or trip:
                self.stream_fault = 4 if invalid else 5
                self.running = self.ready = False
        if self.buffered and not self.running:
            # Leaving buffered RUN (Stop, watchdog, permit, underrun, invalid): flush the ring.
            self._put(C.BUFFER_READ_OFFSET, self._w(C.BUFFER_WRITE_OFFSET))
            self.buffered = False
            self.clock = 0
        if self.buffered_capable:
            self._putd(C.SHOW_CLOCK_OFFSET, self.clock)
            status = ((C.BUFFER_ACTIVE if self.running and self.buffered else 0) |
                      (C.BUFFER_UNDERRUN if underrun else 0) | (C.BUFFER_LATE if self.late_flag else 0))
            self._put(C.BUFFER_STATUS_OFFSET, status)
        self._outputs_and_feedback(wall)

        fault = 0
        if not permit:
            fault = 1
        elif self.age_ms >= C.WATCHDOG_MS:
            fault = 2
        elif self.stream_fault:
            fault = self.stream_fault
        self._put(22, fault)
        status = ((1 if self.running else 0) | (2 if self.ready else 0) |
                  (4 if self.age_ms < C.WATCHDOG_MS else 0) |
                  (8 if self.last_seq == self._w(26) else 0) | (16 if fault else 0))
        self._put(6, status)
        self._put(32, self.last_seq)
        self._put(24, self.last_seq)

    def _outputs_and_feedback(self, wall: float):
        C, b = self.C, self._db
        running = self.running
        channels = self.site["channels"]
        b[C.PUMP_FEEDBACK_OFFSET:C.FEEDBACK_END] = bytes(C.FEEDBACK_SIZE)
        outputs = {}
        for ch in channels:                           # every valve before any pump (as the SCL)
            if ch["kind"] != "valve":
                continue
            i = ch["index"]
            wanted = running and bool(self.valves[i // 8] & (1 << (i % 8)))
            if not running:
                self.valve_open[i] = False
                self.valve_age[i] = 0
            else:
                self.valve_age[i] = min(30000, self.valve_age[i] + self.cycle_ms)
                on_ms, off_ms = ch["min_on_ms"], ch["min_off_ms"]
                if self.cycle_ms == C.LEGACY_CYCLE_MS:    # v2 counts whole 100-ms ticks
                    on_ms = -(-on_ms // 100) * 100
                    off_ms = -(-off_ms // 100) * 100
                if wanted != self.valve_open[i] and (
                        (self.valve_open[i] and self.valve_age[i] >= on_ms) or
                        (not self.valve_open[i] and self.valve_age[i] >= off_ms)):
                    self.valve_open[i] = wanted
                    self.valve_age[i] = 0
            is_open = running and self.valve_open[i]
            if is_open:
                b[C.VALVE_FEEDBACK_OFFSET + i // 8] |= 1 << (i % 8)
            outputs[ch["id"]] = is_open
        mapped = {c["index"] for c in channels if c["kind"] == "valve" and c.get("output")}
        for ch in channels:
            if ch["kind"] != "pump":
                continue
            i = ch["index"]
            outlets = [c["index"] for c in channels if c.get("pump_id") == ch["id"] and c["index"] in mapped]
            any_open = any(self.valve_open[v] for v in outlets)
            allowed = running and any_open
            if running and self.pump[i] > 0 and not any_open:
                self._put(30, 4)
            maximum = round(ch["max_percent"] * 27648 / 100)
            target = min(self.pump[i], maximum) if allowed else 0
            struct.pack_into(">H", b, C.PUMP_FEEDBACK_OFFSET + 2 * i, target)
            if allowed and target > 0:
                b[C.PUMP_RUNNING_OFFSET + i // 8] |= 1 << (i % 8)
            outputs[ch["id"]] = round(target * 100 / 27648, 3)
        for ch in channels:
            if ch["kind"] != "light":
                continue
            i = ch["index"]
            rgb = bytes(self.lights[i * 3:i * 3 + 3]) if running else bytes(3)
            b[C.LIGHT_FEEDBACK_OFFSET + i * 3:C.LIGHT_FEEDBACK_OFFSET + i * 3 + 3] = rgb
            if any(rgb):
                b[C.LIGHT_ACTIVE_OFFSET + i // 8] |= 1 << (i % 8)
            outputs[ch["id"]] = tuple(rgb)
        if outputs != self.outputs:
            since = (wall - self.run_start_wall) * 1000 if running and self.run_start_wall else None
            self.events.append({"clock_ms": self.clock if (running and self.buffered) else None,
                                "since_run_ms": since, "wall": wall, "outputs": dict(outputs)})
            self.outputs = outputs
