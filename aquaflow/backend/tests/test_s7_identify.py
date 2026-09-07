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
    s7_szl_request,
    tpkt,
    validate_cotp_cc,
    validate_s7_setup_ack,
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
