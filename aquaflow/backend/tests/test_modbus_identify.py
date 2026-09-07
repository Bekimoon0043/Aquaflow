"""
AF-DISC — Modbus TCP identification: the fully validated FC43/14 parser
(conformity, continuation, object lengths), generic-exception handling, and
the operator-configurable unit-id list. Scripted server, no real devices.
"""
import asyncio
import struct

import pytest

from engine.controller_identify import identify_service
from engine.modbus_client import ModbusTCPClient, ModbusFrameError, ModbusException
from tests.test_modbus_client import ScriptedModbusServer


class FC43Server(ScriptedModbusServer):
    """FC43 replies scripted per request: `replies` is a list of raw PDU bodies
    (after the MBAP), consumed in order; `unit_filter` answers only that unit."""

    def __init__(self, replies, unit_filter=None):
        super().__init__()
        self.replies = list(replies)
        self.unit_filter = unit_filter
        self.requests = []

    def _reply(self, txid, unit, pdu):
        if pdu[0] == 0x2B:
            self.requests.append((unit, bytes(pdu)))
            if self.unit_filter is not None and unit != self.unit_filter:
                body = bytes([0xAB, 0x0B])                  # GATEWAY_TARGET_FAILED_TO_RESPOND
            else:
                body = self.replies.pop(0) if self.replies else bytes([0xAB, 0x01])
            return struct.pack(">HHHB", txid, 0, len(body) + 1, unit) + body
        return super()._reply(txid, unit, pdu)


def fc43(objects, *, read_code=1, conformity=0x81, more=0x00, next_id=0x00, count=None):
    body = bytes([0x2B, 0x0E, read_code, conformity, more, next_id,
                  len(objects) if count is None else count])
    for oid, text in objects:
        raw = text.encode("ascii")
        body += bytes([oid, len(raw)]) + raw
    return body


async def _ident(server, unit=1, full=True):
    c = ModbusTCPClient("127.0.0.1", server.port, unit)
    assert await c.connect()
    try:
        return await (c.read_device_identification_full() if full else c.read_device_identification())
    finally:
        await c.close()


def _run(server, coro):
    async def go():
        await server.start()
        try:
            return await coro(server)
        finally:
            await server.stop()
    return asyncio.run(go())


def test_valid_fc43_parses_every_field():
    srv = FC43Server([fc43([(0, "Advantech"), (1, "ADAM-6017"), (2, "A1.02")])])
    ident = _run(srv, lambda s: _ident(s))
    assert ident["vendor"] == "Advantech" and ident["product"] == "ADAM-6017" and ident["revision"] == "A1.02"
    assert ident["conformity"] == 0x81 and "basic" in ident["conformity_name"]
    assert ident["more_follows"] is False and ident["next_object_id"] == 0
    assert ident["object_lengths"] == {0: 9, 1: 9, 2: 5} and ident["frames"] == 1


def test_continued_fc43_is_followed_with_the_next_object_id():
    srv = FC43Server([
        fc43([(0, "Moxa"), (1, "ioLogik E1240")], more=0xFF, next_id=0x02),
        fc43([(2, "2.1"), (3, "https://moxa.com")], conformity=0x82),
    ])
    ident = _run(srv, lambda s: _ident(s))
    assert ident["frames"] == 2
    assert ident["revision"] == "2.1" and ident["vendor_url"] == "https://moxa.com"
    assert srv.requests[1][1][3] == 0x02             # second request asks for object 2
    assert ident["more_follows"] is False


@pytest.mark.parametrize("body,needle", [
    (bytes([0x2B, 0x0E, 0x01]), "too short"),
    (bytes([0x2B, 0x0D, 0x01, 0x81, 0, 0, 0]), "MEI type"),
    (bytes([0x2B, 0x0E, 0x02, 0x81, 0, 0, 0]), "not echoed"),
    (bytes([0x2B, 0x0E, 0x01, 0x07, 0, 0, 0]), "conformity"),
    (bytes([0x2B, 0x0E, 0x01, 0x81, 0x55, 0, 0]), "more follows"),
    (fc43([(0, "Advantech")], count=2), "overruns"),
    (bytes([0x2B, 0x0E, 0x01, 0x81, 0, 0, 1, 0x00, 0x20, 0x41]), "declares 32 bytes"),
    (fc43([(0, "X")]) + b"\x00", "trailing"),
])
def test_malformed_fc43_is_refused(body, needle):
    srv = FC43Server([body])

    async def go(s):
        with pytest.raises(ModbusFrameError, match=needle):
            await _ident(s)
        return True
    assert _run(srv, go)


def test_continuation_loop_is_refused():
    srv = FC43Server([fc43([(0, "A")], more=0xFF, next_id=0x00)] * 3)

    async def go(s):
        with pytest.raises(ModbusFrameError, match="loops"):
            await _ident(s)
        return True
    assert _run(srv, go)


def test_basic_method_keeps_its_shape():
    srv = FC43Server([fc43([(0, "Moxa"), (1, "ioLogik E1240"), (2, "2.1")])])
    assert _run(srv, lambda s: _ident(s, full=False)) == {
        "vendor": "Moxa", "product": "ioLogik E1240", "revision": "2.1"}


def test_generic_exception_proves_modbus_but_not_a_vendor():
    srv = ScriptedModbusServer()                       # FC43 → ILLEGAL_FUNCTION
    found = _run(srv, lambda s: identify_service("127.0.0.1", s.port, 502))
    assert len(found) == 1
    d = found[0]
    assert d.catalog_id == "modbus-generic" and d.confidence == "confirmed"
    assert d.stage == "protocol_confirmed" and d.vendor == "(any)"
    assert d.identity["exception"] == "ILLEGAL_FUNCTION"
    assert any("NOT identified" in w for w in d.warnings)
    assert d.plc_prefill["unit_id"] == 1


def test_unit_id_list_is_tried_in_order_and_bounded():
    srv = FC43Server([fc43([(0, "WAGO"), (1, "750-352"), (2, "1")])], unit_filter=3)
    found = _run(srv, lambda s: identify_service("127.0.0.1", s.port, 502, unit_ids=(1, 3)))
    assert found[0].catalog_id == "wago-750" and found[0].plc_prefill["unit_id"] == 3
    assert [u for u, _ in srv.requests] == [1, 3]
    assert found[0].stage == "identity_confirmed"


def test_identification_never_writes():
    srv = FC43Server([fc43([(0, "Delta"), (1, "DVP-12SE"), (2, "1.0")])])

    async def go(s):
        found = await identify_service("127.0.0.1", s.port, 502)
        return found, list(s.writes), list(s.requests)
    found, writes, requests = _run(srv, go)
    assert writes == []
    assert all(pdu[0] == 0x2B for _, pdu in requests)          # FC43 only, never FC03 guesses
    assert found[0].catalog_id == "delta-dvp"
