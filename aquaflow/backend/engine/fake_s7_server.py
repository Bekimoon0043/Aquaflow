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
from typing import Optional

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

    def _reply(self, frame: bytes) -> Optional[bytes]:
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
