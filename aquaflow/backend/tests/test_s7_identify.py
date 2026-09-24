"""
AF-DISC — strict S7comm identification (engine/s7_identify.py) against the
fake PLC. A valid handshake reaches s7_confirmed / identity_confirmed; every
malformed or truncated reply is REFUSED with a reason naming the field; the
rack/slot profiles are tried in order and the winning one is reported.
"""
import asyncio
import struct

import pytest

from engine.fake_s7_server import FakeS7Server
from engine.s7_identify import (
    CONNECTION_PROFILES,
    S7IdentifyError,
    cotp_connect_request,
    parse_szl_0011,
    s7_handshake,
    s7_identify,
    s7_setup_request,
    s7_szl_next_request,
    s7_szl_request,
    tpkt,
    validate_cotp_cc,
    validate_s7_setup_ack,
    validate_szl_part,
    validate_szl_response,
    validate_tpkt,
)


def _with_server(coro_factory, **server_kw):
    async def run():
        server = FakeS7Server(**server_kw)
        await server.start()
        try:
            return await coro_factory(server)
        finally:
            await server.stop()
    return asyncio.run(run())


def test_valid_handshake_reaches_identity_confirmed():
    r = _with_server(lambda s: s7_identify("127.0.0.1", s.port, timeout=0.5))
    assert r.s7_confirmed and r.stage == "identity_confirmed"
    assert r.profile == "s7-1200-1500" and (r.rack, r.slot) == (0, 1)
    assert r.pdu_size == 480 and r.amq_caller == 1
    assert r.identity["order_number"] == "6ES7 215-1AG40-0XB0"
    assert r.identity["module_name"] == "CPU 1215C DC/DC/DC"
    assert r.identity["firmware_version"] == "V4.5.2"
    assert any("SZL 0x0011" in e for e in r.evidence)
    assert r.tx_hex and r.rx_hex


def test_s7_confirmed_without_identity_does_not_claim_a_model():
    r = _with_server(lambda s: s7_identify("127.0.0.1", s.port, timeout=0.5), szl_supported=False)
    assert r.s7_confirmed and r.stage == "s7_confirmed"
    assert r.identity == {}
    assert any("does not expose" in w for w in r.warnings)


def test_rack_slot_profiles_are_tried_in_order():
    # A 300-series rack answers only slot 2: profile 1 (slot 1) is refused, profile 2 wins.
    r = _with_server(lambda s: s7_identify("127.0.0.1", s.port, timeout=0.5), expected_slot=2)
    assert r.s7_confirmed and r.profile == "s7-300-400" and r.slot == 2
    # With a COTP DR instead of a silent drop, same outcome.
    r = _with_server(lambda s: s7_identify("127.0.0.1", s.port, timeout=0.5),
                     expected_slot=2, handshake_mode="refuse_dr")
    assert r.s7_confirmed and r.slot == 2
    # A single wrong-slot handshake reports the refusal, not a success.
    r = _with_server(lambda s: s7_handshake("127.0.0.1", s.port, 0, 1, timeout=0.5),
                     expected_slot=2, handshake_mode="refuse_dr")
    assert not r.s7_confirmed and r.stage == "tcp_open" and "disconnect" in r.reason


@pytest.mark.parametrize("mode,stage,needle", [
    ("cc_short", "tcp_open", "TPKT"),
    ("setup_bad_ref", "cotp_connected", "pdu_ref"),
    ("setup_truncated", "cotp_connected", "truncated"),
    ("setup_error", "cotp_connected", "error class"),
    ("setup_wrong_rosctr", "cotp_connected", "ack-data"),
    ("setup_bad_proto", "cotp_connected", "S7comm"),
    ("setup_zero_pdu", "cotp_connected", "PDU size"),
])
def test_malformed_and_truncated_handshakes_are_rejected(mode, stage, needle):
    r = _with_server(lambda s: s7_identify("127.0.0.1", s.port, timeout=0.5), handshake_mode=mode)
    assert not r.s7_confirmed, mode
    assert r.stage == stage, (mode, r.stage, r.reason)
    assert needle.lower() in r.reason.lower(), (mode, r.reason)


def test_dead_port_and_non_s7_listener():
    async def run():
        probe = await asyncio.start_server(lambda r, w: None, "127.0.0.1", 0)
        dead = probe.sockets[0].getsockname()[1]
        probe.close()
        await probe.wait_closed()
        unreachable = await s7_identify("127.0.0.1", dead, connect_timeout=0.5, timeout=0.5)

        async def http(reader, writer):
            await reader.read(64)
            writer.write(b"HTTP/1.1 400 Bad Request\r\n\r\n")
            await writer.drain()
            writer.close()
        srv = await asyncio.start_server(http, "127.0.0.1", 0)
        port = srv.sockets[0].getsockname()[1]
        wrong = await s7_identify("127.0.0.1", port, connect_timeout=0.5, timeout=0.5)
        srv.close()
        await srv.wait_closed()
        return unreachable, wrong
    unreachable, wrong = asyncio.run(run())
    assert unreachable.stage == "none" and "connect failed" in unreachable.reason
    assert wrong.stage == "tcp_open" and not wrong.s7_confirmed
    assert "TPKT" in wrong.reason


def test_discovery_handshake_never_writes():
    def count(server):
        async def go(s):
            await s7_identify("127.0.0.1", s.port, timeout=0.5)
            return s.writes, s.reads, s.szl_reads
        return go(server)
    writes, reads, szl = _with_server(count)
    assert writes == 0 and reads == 0 and szl == 2      # identity is read via SZL only


# ── pure validators ──────────────────────────────────────────────────────────
def test_request_builders_are_the_known_bytes():
    cr = cotp_connect_request(0, 1)
    assert cr[1] == 0xE0 and cr[-1] == 0x01           # remote TSAP slot 1
    assert cotp_connect_request(0, 2)[-1] == 0x02
    setup = s7_setup_request(0x0100)
    assert setup[3] == 0x32 and setup[4] == 0x01 and setup[13] == 0xF0
    szl = s7_szl_request(1, 0x0011)
    assert szl[4] == 0x07 and szl[-4:] == b"\x00\x11\x00\x00"
    assert tpkt(b"abc")[:4] == b"\x03\x00\x00\x07"


def test_validators_reject_each_field():
    with pytest.raises(S7IdentifyError, match="TPKT length"):
        validate_tpkt(b"\x03\x00\x00\x09\x00")
    with pytest.raises(S7IdentifyError, match="not a TPKT"):
        validate_tpkt(b"\x02\x00\x00\x04")
    with pytest.raises(S7IdentifyError, match="Connection Confirm"):
        validate_cotp_cc(bytes([0x06, 0xE0, 0, 1, 0, 0, 0]))
    with pytest.raises(S7IdentifyError, match="dst-ref"):
        validate_cotp_cc(bytes([0x06, 0xD0, 0, 9, 0, 1, 0]))
    ok = validate_cotp_cc(bytes([0x09, 0xD0, 0, 1, 0, 1, 0, 0xC0, 0x01, 0x0A]))
    assert ok["tpdu_size"] == 1024
    good = bytes([0x02, 0xF0, 0x80, 0x32, 0x03, 0, 0, 0x01, 0x00, 0, 8, 0, 0, 0, 0,
                  0xF0, 0, 0, 1, 0, 1, 0x01, 0xE0])
    assert validate_s7_setup_ack(good, pdu_ref=0x0100)["pdu_size"] == 480
    with pytest.raises(S7IdentifyError, match="param/data length"):
        bad = bytearray(good); bad[9] = 0x09
        validate_s7_setup_ack(bytes(bad), pdu_ref=0x0100)
    with pytest.raises(S7IdentifyError, match="Setup Communication"):
        bad = bytearray(good); bad[15] = 0x04
        validate_s7_setup_ack(bytes(bad), pdu_ref=0x0100)


def test_szl_validation_and_parsing():
    rec = struct.pack(">H", 1) + b"6ES7 215-1AG40-0XB0 " + struct.pack(">HHH", 0, 0x0100, 0)
    body = struct.pack(">HHHH", 0x0011, 0, 28, 1) + rec
    param = bytes([0, 1, 0x12, 8, 0x12, 0x84, 1, 0, 0, 0, 0, 0])
    data = bytes([0xFF, 0x09]) + struct.pack(">H", len(body)) + body
    s7 = bytes([0x32, 0x07, 0, 0, 0, 5]) + struct.pack(">HH", len(param), len(data)) + param + data
    payload = bytes([0x02, 0xF0, 0x80]) + s7
    idx, records = validate_szl_response(payload, pdu_ref=5, szl_id=0x0011)
    assert parse_szl_0011(records)["order_number"] == "6ES7 215-1AG40-0XB0"
    with pytest.raises(S7IdentifyError, match="pdu_ref"):
        validate_szl_response(payload, pdu_ref=6, szl_id=0x0011)
    with pytest.raises(S7IdentifyError, match="SZL-ID"):
        validate_szl_response(payload, pdu_ref=5, szl_id=0x001C)
    # A record count that does not match the bytes present is refused ...
    lying = struct.pack(">HHHH", 0x0011, 0, 28, 2) + rec
    data2 = bytes([0xFF, 0x09]) + struct.pack(">H", len(lying)) + lying
    s7b = bytes([0x32, 0x07, 0, 0, 0, 5]) + struct.pack(">HH", len(param), len(data2)) + param + data2
    with pytest.raises(S7IdentifyError, match="record length"):
        validate_szl_response(bytes([0x02, 0xF0, 0x80]) + s7b, pdu_ref=5, szl_id=0x0011)
    # ... and so is a data length that overstates the payload (truncated frame).
    s7c = bytes([0x32, 0x07, 0, 0, 0, 5]) + struct.pack(">HH", len(param), len(data) - 4) + param + data[:-4]
    with pytest.raises(S7IdentifyError, match="declared"):
        validate_szl_response(bytes([0x02, 0xF0, 0x80]) + s7c, pdu_ref=5, szl_id=0x0011)


def test_profiles_are_the_documented_rack_slots():
    assert [(p["rack"], p["slot"]) for p in CONNECTION_PROFILES] == [(0, 1), (0, 2)]


def test_iso_endpoint_that_refuses_s7_setup_is_listed_unverified_with_the_reason():
    """A TIA Portal PC's S7ONLINE service holds port 102 and speaks COTP but is
    not a CPU. Discovery must show the address as 'port match only' WITH the
    refusal reason and the PLCSIM hint — not silently drop it, and never claim
    a controller."""
    from engine.controller_identify import identify_service

    async def run(server):
        return await identify_service("127.0.0.1", server.port, 102)
    found = _with_server(run, handshake_mode="setup_error")
    assert len(found) == 1
    d = found[0]
    assert d.confidence == "port_only" and d.stage == "port_open"
    assert d.configurable is False and d.plc_prefill == {}
    assert any("setup was refused" in w for w in d.warnings), d.warnings
    assert any("NetToPLCsim" in w for w in d.warnings), d.warnings
    # Junk / silence on 102 is still nothing at all.
    found = _with_server(run, handshake_mode="cc_short")
    assert found == []


def test_s7_without_identity_tells_the_operator_identity_is_optional():
    from engine.controller_identify import identify_service

    async def run(server):
        return await identify_service("127.0.0.1", server.port, 102)
    found = _with_server(run, szl_supported=False)
    assert len(found) == 1 and found[0].confidence == "confirmed"
    assert any("does not need the identity" in w for w in found[0].warnings), found[0].warnings
    assert "0x0011" in found[0].identity["szl_frames"]


# ── multi-part SZL (the real S7-1200 case: PDU 240, 0x001C ≈ 10 × 34 bytes) ─
def test_multipart_szl_is_followed_with_next_telegrams():
    """A CPU that serves the component list in several 'more data follows'
    parts must still yield the module name — and the exchange must use the
    SZL-NEXT telegram with the CPU's sequence number, not a fresh request."""
    def go(s):
        async def run(server):
            r = await s7_identify("127.0.0.1", server.port, timeout=0.5)
            return r, server.szl_reads, server.szl_next_reads
        return run(s)
    r, first_reads, next_reads = _with_server(go, szl_max_part=60)
    assert r.stage == "identity_confirmed", (r.reason, r.warnings)
    assert r.identity["order_number"] == "6ES7 215-1AG40-0XB0"
    assert r.identity["module_name"] == "CPU 1215C DC/DC/DC"
    assert r.identity["plc_name"] == "AquaFlowPLC"
    assert first_reads == 2 and next_reads >= 4, (first_reads, next_reads)
    assert any("SZL 0x001C" in e and "parts" in e for e in r.evidence), r.evidence
    assert not r.warnings, r.warnings
    # every reply frame is kept for diagnostics
    assert len(r.szl_frames["0x001C"]) == 1 + next_reads - (len(r.szl_frames["0x0011"]) - 1)


def test_szl_next_request_is_the_known_bytes():
    nxt = s7_szl_next_request(0x0102, 0x2B)
    assert nxt[3] == 0x32 and nxt[4] == 0x07                  # S7 userdata
    assert nxt[9:13] == b"\x00\x0c\x00\x04"                   # param 12, data 4
    assert nxt[13:25] == bytes([0, 1, 0x12, 8, 0x12, 0x44, 1, 0x2B, 0, 0, 0, 0])
    assert nxt[25:29] == b"\x0a\x00\x00\x00"


def test_single_frame_validator_refuses_a_more_follows_part():
    rec = struct.pack(">H", 1) + b"6ES7 215-1AG40-0XB0 " + struct.pack(">HHH", 0, 1, 0)
    body = struct.pack(">HHHH", 0x0011, 0, 28, 2) + rec        # says 2 records, carries 1
    param = bytes([0, 1, 0x12, 8, 0x12, 0x84, 1, 7, 0, 1, 0, 0])   # seq 7, last data unit = NO
    data = bytes([0xFF, 0x09]) + struct.pack(">H", len(body)) + body
    s7 = bytes([0x32, 0x07, 0, 0, 0, 5]) + struct.pack(">HH", len(param), len(data)) + param + data
    payload = bytes([0x02, 0xF0, 0x80]) + s7
    part = validate_szl_part(payload, pdu_ref=5, szl_id=0x0011, first=True)
    assert part.more and part.seq == 7 and part.count == 2 and part.rec_len == 28
    with pytest.raises(S7IdentifyError, match="multi-part"):
        validate_szl_response(payload, pdu_ref=5, szl_id=0x0011)


def test_firmware_version_decodes_the_wire_encoding():
    """Index 7: Ausbg1 = 'V'<<8 | major, Ausbe = minor<<8 | patch (snap7 V1/V2/V3)."""
    def rec(idx, ausbg1, ausbe):
        return struct.pack(">H", idx) + b"6ES7 215-1AG40-0XB0 " + struct.pack(">HHH", 0, ausbg1, ausbe)
    out = parse_szl_0011([rec(1, 0x0001, 0), rec(6, 0x0001, 0), rec(7, 0x5604, 0x0502)])
    assert out["firmware_version"] == "V4.5.2"
    assert out["hardware_version"] == "1"
    assert "firmware_version_raw" not in out
    # S7-1500 style V2.9.4
    assert parse_szl_0011([rec(7, 0x5602, 0x0904)])["firmware_version"] == "V2.9.4"
