"""
AF-DISC — EtherNet/IP ListIdentity: a valid reply identifies an Allen-Bradley
class device (identify-only); every error/malformed variant is refused, and an
open port 44818 alone is never a confirmed PLC.
"""
import asyncio
import struct

import pytest

from engine.controller_identify import identify_service
from engine.enip_identify import (
    EnipParseError,
    build_list_identity_reply,
    list_identity,
    list_identity_request,
    parse_list_identity,
)


def test_request_is_the_standard_24_byte_list_identity():
    req = list_identity_request()
    assert len(req) == 24 and struct.unpack("<H", req[:2])[0] == 0x0063
    assert req[2:] == bytes(22)


def test_valid_reply_parses_every_identity_field():
    ident = parse_list_identity(build_list_identity_reply())
    assert ident.vendor_id == 1 and "Allen-Bradley" in ident.vendor
    assert ident.device_type == 0x0E and ident.device_type_name == "Programmable Logic Controller"
    assert ident.product_code == 0x5D and ident.revision == "33.011"
    assert ident.status == 0x0060 and ident.serial == "00C0FFEE"
    assert ident.product_name == "1769-L33ER/A LOGIX5333ER" and ident.state == 3
    assert ident.ip_from_item == "192.168.5.20" and ident.warnings == []


@pytest.mark.parametrize("kw,needle", [
    (dict(encap_status=0x0001), "status"),
    (dict(truncate=10), "declared payload length"),
    (dict(lie_length=4), "declared payload length"),
    (dict(item_count=0), "zero items"),
    (dict(item_type=0x0000), "no Identity item"),
    (dict(lie_name_len=200), "overruns"),
])
def test_error_and_malformed_replies_are_refused(kw, needle):
    with pytest.raises(EnipParseError, match=needle):
        parse_list_identity(build_list_identity_reply(**kw))


def test_short_and_wrong_command_replies_are_refused():
    with pytest.raises(EnipParseError, match="truncated"):
        parse_list_identity(b"\x63\x00\x00\x00")
    frame = bytearray(build_list_identity_reply())
    frame[0:2] = struct.pack("<H", 0x0065)
    with pytest.raises(EnipParseError, match="not ListIdentity"):
        parse_list_identity(bytes(frame))
    with pytest.raises(EnipParseError, match="empty"):
        parse_list_identity(struct.pack("<HHIIQI", 0x0063, 0, 0, 0, 0, 0))
    short_item = build_list_identity_reply()[:24] + struct.pack("<H", 1) + struct.pack("<HH", 0x000C, 4) + bytes(4)
    short_item = struct.pack("<HHIIQI", 0x0063, len(short_item) - 24, 0, 0, 0, 0) + short_item[24:]
    with pytest.raises(EnipParseError, match="too short"):
        parse_list_identity(short_item)


async def _server(reply, hold=False):
    async def handle(r, w):
        try:
            await r.readexactly(24)
            if not hold:
                w.write(reply)
                await w.drain()
            else:
                await asyncio.sleep(3)
        except Exception:
            pass
        finally:
            w.close()
    srv = await asyncio.start_server(handle, "127.0.0.1", 0)
    return srv, srv.sockets[0].getsockname()[1]


def test_live_probe_accepts_only_a_valid_payload():
    async def run():
        good, gp = await _server(build_list_identity_reply(name="CompactLogix 5380"))
        bad, bp = await _server(b"HTTP/1.0 200 OK\r\nContent-Length: 30\r\n\r\n<html>not a plc at all</html>")
        silent, sp = await _server(b"", hold=True)
        trunc, tp = await _server(build_list_identity_reply(truncate=12))
        out = {
            "good": await list_identity("127.0.0.1", gp, timeout=0.5),
            "bad": await list_identity("127.0.0.1", bp, timeout=0.5),
            "silent": await list_identity("127.0.0.1", sp, timeout=0.3),
            "trunc": await list_identity("127.0.0.1", tp, timeout=0.5),
            "det_good": await identify_service("127.0.0.1", gp, 44818),
            "det_bad": await identify_service("127.0.0.1", bp, 44818),
        }
        for s in (good, bad, silent, trunc):
            s.close()
        return out
    out = asyncio.run(run())
    assert out["good"][0].product_name == "CompactLogix 5380"
    assert out["bad"][0] is None and out["bad"][1]        # rejected, with a reason
    assert out["silent"][0] is None and "timeout" in out["silent"][1]
    assert out["trunc"][0] is None and "truncated" in out["trunc"][1]
    # An open 44818 with junk behind it is NOT an Allen-Bradley PLC.
    assert out["det_bad"] == []
    det = out["det_good"][0]
    assert det.catalog_id == "allen-bradley-logix" and det.confidence == "confirmed"
    assert det.stage == "identity_confirmed" and det.drivable is False and det.configurable is False
    assert det.product == "CompactLogix 5380" and det.revision == "33.011"
    assert any("identify-only" in w for w in det.warnings)
