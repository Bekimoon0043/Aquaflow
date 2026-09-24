"""
engine/s7_identify.py — read-only Siemens S7 identification with a STRICT
COTP + S7comm handshake and an optional SZL identity read.

Why a second handshake next to engine/s7_client.py: the runtime client checks
just enough of the reply to start reading DBs (`cc[5] == 0xD0`, `ack[7] == 0x32`).
For DISCOVERY that is not enough — an S7 claim is a claim that a real PLC sits
at that address, and the evidence must be a reply that is right in every field:

  TPKT     version 3, reserved 0, declared length == bytes received
  COTP CC  LI ≥ 6, PDU type 0xD0, dst-ref == our src-ref, class 0
  S7 setup protocol id 0x32, ROSCTR 0x03 (ack-data), pdu_ref echoed,
           param length 8, data length 0, error class/code 0, function 0xF0,
           negotiated PDU size within 240..8192, AMQ counts non-zero
  SZL      ROSCTR 0x07 (userdata), pdu_ref echoed, param head + method 0x12,
           type/group 0x84, subfunction 0x01, error 0, data return code 0xFF,
           transport 0x09, declared length == payload, SZL-ID echoed,
           record length × count == bytes present

A truncated, mis-referenced or error-flagged reply is REJECTED with a reason
that names the field, never "accepted with a warning".

Stages reported (each strictly stronger than the last):
  tcp_open           — TCP 102 accepted the connection (proves nothing)
  cotp_connected     — COTP CC received (a device speaking ISO-on-TCP)
  s7_confirmed       — S7 communication setup acknowledged (an S7comm server)
  identity_confirmed — SZL 0x0011 / 0x001C answered: order number, module,
                       firmware, station name (what TIA shows on the device)

Connection profiles: S7-1200/1500 use rack 0 slot 1; S7-300/400 use rack 0
slot 2. Discovery tries them in that order and reports which one succeeded —
it does NOT infer a CPU model from a bare handshake; only the order number in
SZL 0x0011 says which CPU it is.

Nothing here writes. There is no Write Var, no PLC control, no DCP Set.
"""
from __future__ import annotations

import asyncio
import struct
from dataclasses import dataclass, field, asdict
from typing import Optional

S7_PORT = 102
CONNECTION_PROFILES = (
    {"id": "s7-1200-1500", "label": "S7-1200/1500", "rack": 0, "slot": 1},
    {"id": "s7-300-400", "label": "S7-300/400", "rack": 0, "slot": 2},
)

STAGE_ORDER = ("none", "tcp_open", "cotp_connected", "s7_confirmed", "identity_confirmed")


class S7IdentifyError(Exception):
    def __init__(self, stage: str, reason: str):
        self.stage = stage
        self.reason = reason
        super().__init__(f"{stage}: {reason}")


@dataclass
class S7IdentifyResult:
    ip: str
    port: int
    stage: str = "none"
    reason: str = ""
    rack: Optional[int] = None
    slot: Optional[int] = None
    profile: str = ""
    pdu_size: Optional[int] = None
    amq_caller: Optional[int] = None
    amq_callee: Optional[int] = None
    identity: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)
    evidence: list = field(default_factory=list)
    tx_hex: str = ""
    rx_hex: str = ""
    szl_frames: dict = field(default_factory=dict)   # "0x0011" → [reply hex, ...] (diagnostics)

    @property
    def s7_confirmed(self) -> bool:
        return STAGE_ORDER.index(self.stage) >= STAGE_ORDER.index("s7_confirmed")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["s7_confirmed"] = self.s7_confirmed
        return d


# ── frame builders (pure) ────────────────────────────────────────────────────
def tpkt(payload: bytes) -> bytes:
    return struct.pack(">BBH", 0x03, 0x00, len(payload) + 4) + payload


def cotp_connect_request(rack: int, slot: int, *, src_ref: int = 1, tpdu_size: int = 0x0A) -> bytes:
    remote_tsap = bytes([0x01, (rack * 0x20 + slot) & 0xFF])    # PG connection, snap7 convention
    body = (bytes([0xE0]) + struct.pack(">H", 0) + struct.pack(">H", src_ref) + bytes([0x00]) +
            bytes([0xC0, 0x01, tpdu_size]) +
            bytes([0xC1, 0x02, 0x01, 0x00]) +
            bytes([0xC2, 0x02]) + remote_tsap)
    return bytes([len(body)]) + body


def s7_setup_request(pdu_ref: int, *, pdu_size: int = 0x01E0, amq: int = 1) -> bytes:
    header = bytes([0x32, 0x01, 0x00, 0x00]) + struct.pack(">H", pdu_ref) + struct.pack(">HH", 8, 0)
    param = bytes([0xF0, 0x00]) + struct.pack(">HHH", amq, amq, pdu_size)
    return bytes([0x02, 0xF0, 0x80]) + header + param


def s7_szl_request(pdu_ref: int, szl_id: int, index: int = 0, seq: int = 0) -> bytes:
    """Userdata read-SZL (function group 4 "CPU functions", subfunction 1). Read-only."""
    param = bytes([0x00, 0x01, 0x12, 0x04, 0x11, 0x44, 0x01, seq & 0xFF])
    data = bytes([0xFF, 0x09]) + struct.pack(">H", 4) + struct.pack(">HH", szl_id, index)
    header = (bytes([0x32, 0x07, 0x00, 0x00]) + struct.pack(">H", pdu_ref) +
              struct.pack(">HH", len(param), len(data)))
    return bytes([0x02, 0xF0, 0x80]) + header + param + data


def s7_szl_next_request(pdu_ref: int, seq: int) -> bytes:
    """Continuation of a multi-part SZL read (the snap7 `S7_SZL_NEXT` telegram).

    A CPU whose SZL does not fit one PDU answers the first request with
    'last data unit = 1' and a sequence number; the client must echo that
    sequence in a 12-byte parameter block with an empty data part
    (return code 0x0A "object does not exist", length 0) until the CPU sets
    'last data unit = 0'. A real S7-1200 negotiates a 240-byte PDU, so its
    0x001C component list (≈10 × 34 bytes) ALWAYS arrives this way; a client
    that only reads the first part sees a record count that does not match
    the bytes present and wrongly concludes the reply is malformed."""
    param = bytes([0x00, 0x01, 0x12, 0x08, 0x12, 0x44, 0x01, seq & 0xFF, 0x00, 0x00, 0x00, 0x00])
    data = bytes([0x0A, 0x00, 0x00, 0x00])
    header = (bytes([0x32, 0x07, 0x00, 0x00]) + struct.pack(">H", pdu_ref) +
              struct.pack(">HH", len(param), len(data)))
    return bytes([0x02, 0xF0, 0x80]) + header + param + data


MAX_SZL_PARTS = 16          # bound on continuation round-trips (a CPU list is a few PDUs at most)


# ── validators (pure) ────────────────────────────────────────────────────────
def validate_tpkt(frame: bytes) -> bytes:
    if len(frame) < 4:
        raise S7IdentifyError("tcp_open", f"TPKT header truncated ({len(frame)} bytes)")
    if frame[0] != 0x03 or frame[1] != 0x00:
        raise S7IdentifyError("tcp_open", f"not a TPKT frame (version {frame[0]}, reserved {frame[1]})")
    declared = struct.unpack(">H", frame[2:4])[0]
    if declared != len(frame):
        raise S7IdentifyError("tcp_open", f"TPKT length {declared} != {len(frame)} bytes received")
    return frame[4:]


def validate_cotp_cc(payload: bytes, *, src_ref: int = 1) -> dict:
    if len(payload) < 7:
        raise S7IdentifyError("tcp_open", f"COTP reply truncated ({len(payload)} bytes)")
    li, pdu_type = payload[0], payload[1]
    if pdu_type == 0x80:
        raise S7IdentifyError("tcp_open", "COTP disconnect request — connection refused (wrong rack/slot?)")
    if pdu_type != 0xD0:
        raise S7IdentifyError("tcp_open", f"COTP PDU type 0x{pdu_type:02X} is not Connection Confirm")
    if li < 6 or li + 1 > len(payload):
        raise S7IdentifyError("tcp_open", f"COTP length indicator {li} inconsistent with {len(payload)} bytes")
    dst_ref = struct.unpack(">H", payload[2:4])[0]
    if dst_ref != src_ref:
        raise S7IdentifyError("tcp_open", f"COTP dst-ref {dst_ref} != our src-ref {src_ref}")
    if payload[6] & 0xF0 != 0:
        raise S7IdentifyError("tcp_open", f"COTP class 0x{payload[6]:02X} is not class 0")
    info = {"tpdu_size": None}
    pos = 7
    while pos + 2 <= li + 1:
        code, plen = payload[pos], payload[pos + 1]
        val = payload[pos + 2:pos + 2 + plen]
        if code == 0xC0 and plen == 1:
            info["tpdu_size"] = 1 << val[0]
        pos += 2 + plen
    return info


def validate_s7_setup_ack(payload: bytes, *, pdu_ref: int) -> dict:
    if len(payload) < 3 or payload[0] != 0x02 or payload[1] != 0xF0:
        raise S7IdentifyError("cotp_connected", "reply is not a COTP data TPDU")
    s7 = payload[3:]
    if len(s7) < 12:
        raise S7IdentifyError("cotp_connected", f"S7 header truncated ({len(s7)} bytes)")
    if s7[0] != 0x32:
        raise S7IdentifyError("cotp_connected", f"protocol id 0x{s7[0]:02X} is not S7comm")
    if s7[1] != 0x03:
        raise S7IdentifyError("cotp_connected", f"ROSCTR 0x{s7[1]:02X} is not ack-data")
    ref = struct.unpack(">H", s7[4:6])[0]
    if ref != pdu_ref:
        raise S7IdentifyError("cotp_connected", f"pdu_ref {ref} != {pdu_ref} sent")
    plen, dlen = struct.unpack(">HH", s7[6:10])
    err_cls, err_code = s7[10], s7[11]
    if err_cls or err_code:
        raise S7IdentifyError("cotp_connected", f"setup refused: error class 0x{err_cls:02X} code 0x{err_code:02X}")
    if plen != 8 or dlen != 0:
        raise S7IdentifyError("cotp_connected", f"setup ack param/data length {plen}/{dlen} (expected 8/0)")
    body = s7[12:]
    if len(body) < plen:
        raise S7IdentifyError("cotp_connected", f"setup ack truncated ({len(body)} of {plen} param bytes)")
    if body[0] != 0xF0:
        raise S7IdentifyError("cotp_connected", f"function 0x{body[0]:02X} is not Setup Communication")
    amq_caller, amq_callee, pdu_size = struct.unpack(">HHH", body[2:8])
    if not 240 <= pdu_size <= 8192:
        raise S7IdentifyError("cotp_connected", f"negotiated PDU size {pdu_size} is implausible")
    if amq_caller == 0 or amq_callee == 0:
        raise S7IdentifyError("cotp_connected", "negotiated AMQ count is zero")
    return {"pdu_size": pdu_size, "amq_caller": amq_caller, "amq_callee": amq_callee}


@dataclass
class SzlPart:
    """One userdata reply of a (possibly multi-part) SZL read."""
    seq: int                 # sequence number the CPU wants echoed in the NEXT request
    more: bool               # 'last data unit' == 0x01 → further parts follow
    payload: bytes           # list bytes carried by this part (header stripped on the first)
    index: int = 0           # first part only: SZL index echoed by the CPU
    rec_len: int = 0         # first part only: bytes per record
    count: int = 0           # first part only: records in the WHOLE list


def validate_szl_part(payload: bytes, *, pdu_ref: int, szl_id: Optional[int] = None,
                      first: bool = True) -> SzlPart:
    """Strictly validate one SZL userdata reply. `first=True` expects the 8-byte
    list header (SZL-ID, index, record length, count) and checks the SZL-ID
    echo; `first=False` validates a continuation part, whose data is just the
    next slice of list bytes. Raises on any inconsistency, including a PLC that
    answers the request with an error (SZL unsupported)."""
    if len(payload) < 3 or payload[0] != 0x02 or payload[1] != 0xF0:
        raise S7IdentifyError("s7_confirmed", "SZL reply is not a COTP data TPDU")
    s7 = payload[3:]
    if len(s7) < 10 or s7[0] != 0x32:
        raise S7IdentifyError("s7_confirmed", "SZL reply is not an S7 PDU")
    if s7[1] != 0x07:
        raise S7IdentifyError("s7_confirmed", f"ROSCTR 0x{s7[1]:02X} is not userdata")
    ref = struct.unpack(">H", s7[4:6])[0]
    if ref != pdu_ref:
        raise S7IdentifyError("s7_confirmed", f"SZL pdu_ref {ref} != {pdu_ref}")
    plen, dlen = struct.unpack(">HH", s7[6:10])
    param = s7[10:10 + plen]
    data = s7[10 + plen:10 + plen + dlen]
    if len(param) < plen or len(data) < dlen:
        raise S7IdentifyError("s7_confirmed", "SZL reply truncated")
    if plen < 12 or param[0:3] != b"\x00\x01\x12" or param[4] != 0x12:
        raise S7IdentifyError("s7_confirmed", "SZL parameter head/method malformed")
    if param[5] != 0x84 or param[6] != 0x01:
        raise S7IdentifyError("s7_confirmed", f"SZL type/subfunction 0x{param[5]:02X}/0x{param[6]:02X} unexpected")
    err = struct.unpack(">H", param[10:12])[0]
    if err:
        raise S7IdentifyError("s7_confirmed", f"SZL read refused (error 0x{err:04X}) — CPU does not expose this list")
    seq, more = param[7], param[9] != 0x00           # param[9]: last data unit (0x00 yes / 0x01 no)
    if len(data) < 4:
        raise S7IdentifyError("s7_confirmed", "SZL data head truncated")
    if data[0] != 0xFF:
        raise S7IdentifyError("s7_confirmed", f"SZL data return code 0x{data[0]:02X}")
    if data[1] != 0x09:
        raise S7IdentifyError("s7_confirmed", f"SZL transport size 0x{data[1]:02X} (expected octet string)")
    length = struct.unpack(">H", data[2:4])[0]
    body = data[4:]
    if len(body) != length:
        raise S7IdentifyError("s7_confirmed", f"SZL declared {length} data bytes, {len(body)} present")
    if not first:
        return SzlPart(seq=seq, more=more, payload=body)
    if length < 8:
        raise S7IdentifyError("s7_confirmed", "SZL body too short for its header")
    r_id, index, rec_len, count = struct.unpack(">HHHH", body[:8])
    if szl_id is not None and r_id != szl_id:
        raise S7IdentifyError("s7_confirmed", f"SZL-ID 0x{r_id:04X} echoed instead of 0x{szl_id:04X}")
    if rec_len == 0:
        raise S7IdentifyError("s7_confirmed", "SZL record length 0")
    return SzlPart(seq=seq, more=more, payload=body[8:], index=index, rec_len=rec_len, count=count)


def split_szl_records(rec_len: int, count: int, data: bytes) -> list[bytes]:
    """The whole list must be exactly `count` records of `rec_len` bytes."""
    if rec_len == 0 or rec_len * count != len(data):
        raise S7IdentifyError("s7_confirmed", f"SZL record length {rec_len} × {count} != {len(data)} bytes")
    return [data[i * rec_len:(i + 1) * rec_len] for i in range(count)]


def validate_szl_response(payload: bytes, *, pdu_ref: int, szl_id: int) -> tuple[int, list[bytes]]:
    """Single-frame SZL reply → (index, records). A reply flagged 'more data
    follows' is refused here; the exchange path (`_read_szl_list`) handles
    continuation."""
    part = validate_szl_part(payload, pdu_ref=pdu_ref, szl_id=szl_id, first=True)
    if part.more:
        raise S7IdentifyError("s7_confirmed", "SZL reply is multi-part (last data unit = 0) — continuation required")
    return part.index, split_szl_records(part.rec_len, part.count, part.payload)


def _clean(raw: bytes) -> str:
    return raw.decode("ascii", errors="replace").replace("\x00", " ").strip()


def parse_szl_0011(records: list[bytes]) -> dict:
    """Module identification: index 1 = order number, 6 = basic hardware, 7 = firmware.

    Record = index(2) MlfB(20) BGTyp(2) Ausbg1(2) Ausbe(2). On the wire the
    firmware record carries Ausbg1 = 'V' (0x56) << 8 | major and
    Ausbe = minor << 8 | patch — the three bytes snap7's GetOrderCode returns
    as V1/V2/V3 from the tail of the list. (An earlier reading of this field
    printed 'V86.4.2' for V4.5.2.) The hardware issue in index 1 is an
    opaque issue number; it is reported as the CPU sends it."""
    out: dict = {}
    for rec in records:
        if len(rec) < 28:
            continue
        idx = struct.unpack(">H", rec[:2])[0]
        mlfb = _clean(rec[2:22])
        bgtyp, ausbg1, ausbe = struct.unpack(">HHH", rec[22:28])
        if idx == 0x0001:
            out["order_number"] = mlfb
            out["hardware_version"] = str(ausbg1) if ausbg1 < 0x100 else f"{ausbg1 >> 8}.{ausbg1 & 0xFF}"
        elif idx == 0x0006:
            out["basic_hardware"] = mlfb
        elif idx == 0x0007:
            major, minor, patch = ausbg1 & 0xFF, ausbe >> 8, ausbe & 0xFF
            out["firmware_version"] = f"V{major}.{minor}.{patch}"
            if (ausbg1 >> 8) not in (0x56, 0x00):          # neither 'V' nor blank: say so
                out["firmware_version_raw"] = f"0x{ausbg1:04X} 0x{ausbe:04X}"
            out.setdefault("basic_firmware", mlfb)
    return out


def parse_szl_001c(records: list[bytes]) -> dict:
    """Component identification: 1 = PLC name, 2 = module name, 3 = plant
    designation, 4 = copyright, 5 = module serial, 7 = module type name."""
    names = {1: "plc_name", 2: "module_name", 3: "plant_designation", 4: "copyright",
             5: "serial_number", 7: "module_type_name", 8: "memory_card_serial",
             9: "manufacturer_profile", 0xA: "oem_id", 0xB: "location"}
    out: dict = {}
    for rec in records:
        if len(rec) < 4:
            continue
        idx = struct.unpack(">H", rec[:2])[0]
        key = names.get(idx)
        if key:
            out[key] = _clean(rec[2:])
    return out


# ── the exchange ─────────────────────────────────────────────────────────────
async def _read_tpkt(reader: asyncio.StreamReader, timeout: float) -> bytes:
    try:
        head = await asyncio.wait_for(reader.readexactly(4), timeout=timeout)
    except asyncio.IncompleteReadError as e:
        raise S7IdentifyError("tcp_open", f"connection closed after {len(e.partial)} byte(s)")
    except asyncio.TimeoutError:
        raise S7IdentifyError("tcp_open", "no reply (timeout)")
    if head[0] != 0x03:
        raise S7IdentifyError("tcp_open", f"not a TPKT frame (version {head[0]})")
    total = struct.unpack(">H", head[2:4])[0]
    if total < 7 or total > 8192:
        raise S7IdentifyError("tcp_open", f"implausible TPKT length {total}")
    try:
        rest = await asyncio.wait_for(reader.readexactly(total - 4), timeout=timeout)
    except asyncio.IncompleteReadError as e:
        raise S7IdentifyError("tcp_open", f"TPKT truncated ({4 + len(e.partial)} of {total} bytes)")
    except asyncio.TimeoutError:
        raise S7IdentifyError("tcp_open", "TPKT body timed out")
    return head + rest


def _reply_note(frames: list[str], limit: int = 200) -> str:
    """Short hex excerpt of the last reply for the operator-facing warning."""
    if not frames:
        return " [no reply frame]"
    h = frames[-1]
    return f" [reply {h[:limit]}{'…' if len(h) > limit else ''}]"


async def _read_szl_list(reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                         pdu_ref: int, szl_id: int, timeout: float,
                         frames: list[str]) -> tuple[list[bytes], int, int]:
    """Read one complete SZL list, following 'more data follows' parts with
    SZL-NEXT telegrams (bounded by MAX_SZL_PARTS). Returns (records, last
    pdu_ref used, number of parts). Appends every reply frame's hex to
    `frames`. Read-only: the CPU is asked for lists, nothing is written."""
    pdu_ref += 1
    writer.write(tpkt(s7_szl_request(pdu_ref, szl_id)))
    await writer.drain()
    reply = await _read_tpkt(reader, timeout)
    frames.append(reply.hex())
    first = validate_szl_part(validate_tpkt(reply), pdu_ref=pdu_ref, szl_id=szl_id, first=True)
    buf = bytearray(first.payload)
    seq, more, parts = first.seq, first.more, 1
    while more:
        if parts >= MAX_SZL_PARTS:
            raise S7IdentifyError("s7_confirmed", f"more than {MAX_SZL_PARTS} SZL parts — giving up")
        pdu_ref += 1
        writer.write(tpkt(s7_szl_next_request(pdu_ref, seq)))
        await writer.drain()
        reply = await _read_tpkt(reader, timeout)
        frames.append(reply.hex())
        nxt = validate_szl_part(validate_tpkt(reply), pdu_ref=pdu_ref, first=False)
        buf += nxt.payload
        seq, more, parts = nxt.seq, nxt.more, parts + 1
    return split_szl_records(first.rec_len, first.count, bytes(buf)), pdu_ref, parts


async def s7_handshake(ip: str, port: int = S7_PORT, rack: int = 0, slot: int = 1, *,
                       connect_timeout: float = 1.0, timeout: float = 1.5,
                       read_identity: bool = True) -> S7IdentifyResult:
    """One strictly validated COTP + S7 setup (+ optional SZL identity) against
    ip:port with the given rack/slot. Never raises; the result says how far it
    got and exactly why it stopped. Never writes."""
    res = S7IdentifyResult(ip=ip, port=port, rack=rack, slot=slot)
    reader = writer = None
    try:
        try:
            reader, writer = await asyncio.wait_for(asyncio.open_connection(ip, port),
                                                    timeout=connect_timeout)
        except Exception as e:
            res.reason = f"tcp connect failed: {e.__class__.__name__}"
            return res
        res.stage = "tcp_open"
        res.evidence.append(f"TCP {port} open")

        # COTP CR → CC
        cr = tpkt(cotp_connect_request(rack, slot))
        res.tx_hex = cr.hex()
        writer.write(cr)
        await writer.drain()
        cc = await _read_tpkt(reader, timeout)
        res.rx_hex = cc.hex()
        cotp = validate_cotp_cc(validate_tpkt(cc))
        res.stage = "cotp_connected"
        res.evidence.append(f"COTP CC for rack {rack} slot {slot}"
                            + (f", TPDU {cotp['tpdu_size']}" if cotp.get("tpdu_size") else ""))

        # S7 setup communication
        pdu_ref = 0x0100
        setup = tpkt(s7_setup_request(pdu_ref))
        res.tx_hex = setup.hex()
        writer.write(setup)
        await writer.drain()
        ack = await _read_tpkt(reader, timeout)
        res.rx_hex = ack.hex()
        neg = validate_s7_setup_ack(validate_tpkt(ack), pdu_ref=pdu_ref)
        res.stage = "s7_confirmed"
        res.pdu_size = neg["pdu_size"]
        res.amq_caller, res.amq_callee = neg["amq_caller"], neg["amq_callee"]
        res.reason = "COTP + S7 setup acknowledged"
        res.evidence.append(f"S7 setup ack: PDU {neg['pdu_size']}, AMQ {neg['amq_caller']}/{neg['amq_callee']}")
        if not read_identity:
            return res

        # SZL identity (read-only). A refusal here leaves stage at s7_confirmed.
        # Every reply frame is kept (hex) so an operator can show us exactly what
        # the CPU or simulator answered when the identity comes back empty.
        identity: dict = {}
        for szl_id, parser in ((0x0011, parse_szl_0011), (0x001C, parse_szl_001c)):
            frames: list[str] = []
            try:
                records, pdu_ref, parts = await _read_szl_list(reader, writer, pdu_ref, szl_id,
                                                               timeout, frames)
                res.szl_frames[f"0x{szl_id:04X}"] = frames
                if frames:
                    res.rx_hex = frames[-1]
                parsed = parser(records)
                if parsed:
                    identity.update(parsed)
                    res.evidence.append(f"SZL 0x{szl_id:04X}: {len(records)} record(s)"
                                        + (f" in {parts} parts" if parts > 1 else ""))
                else:
                    res.warnings.append(f"SZL 0x{szl_id:04X}: {len(records)} record(s) but none of the "
                                        f"known indexes present")
            except S7IdentifyError as e:
                res.szl_frames[f"0x{szl_id:04X}"] = frames
                if frames:
                    res.rx_hex = frames[-1]
                res.warnings.append(f"SZL 0x{szl_id:04X}: {e.reason}" + _reply_note(frames))
                if "closed" in e.reason or "timeout" in e.reason:
                    break
        if identity.get("order_number") or identity.get("module_name") or identity.get("plc_name"):
            res.identity = identity
            res.stage = "identity_confirmed"
            res.reason = "S7 identity read from SZL"
        else:
            res.reason = "S7 setup acknowledged; identity list not exposed"
        return res
    except S7IdentifyError as e:
        res.reason = e.reason
        return res
    except Exception as e:
        res.reason = f"unexpected {e.__class__.__name__}: {e}"
        return res
    finally:
        if writer is not None:
            try:
                writer.close()
            except Exception:
                pass


async def s7_identify(ip: str, port: int = S7_PORT, *, profiles=CONNECTION_PROFILES,
                      connect_timeout: float = 1.0, timeout: float = 1.5) -> S7IdentifyResult:
    """Try each connection profile in order; the first that reaches
    s7_confirmed wins and is named in the result. When none does, the
    strongest partial result is returned so the operator sees how far the
    device got (e.g. 'COTP refused' on both = wrong device or wrong TSAP)."""
    best: Optional[S7IdentifyResult] = None
    for prof in profiles:
        r = await s7_handshake(ip, port, prof["rack"], prof["slot"], connect_timeout=connect_timeout,
                               timeout=timeout)
        r.profile = prof["id"]
        if r.s7_confirmed:
            return r
        if best is None or STAGE_ORDER.index(r.stage) > STAGE_ORDER.index(best.stage):
            best = r
        if r.stage == "none":
            break                             # not even TCP — trying another slot is pointless
    return best if best is not None else S7IdentifyResult(ip=ip, port=port, reason="no profiles")
