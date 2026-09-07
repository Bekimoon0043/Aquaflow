"""
AF-DISC — PROFINET DCP Identify codec (engine/profinet_dcp.py). Pure parsing
against constructed frames; the raw-socket sender is only checked for honest
unavailability on platforms without AF_PACKET.
"""
import struct

import pytest

from engine import profinet_dcp as dcp

SRC = bytes.fromhex("001b1b123456")
PC = bytes.fromhex("047c16aabbcc")


def test_identify_all_request_is_read_only_and_well_formed():
    frame = dcp.build_identify_all(PC, xid=0x11223344)
    assert frame[:6] == dcp.DCP_MULTICAST and frame[6:12] == PC
    assert struct.unpack(">H", frame[12:14])[0] == dcp.ETHERTYPE_PN
    assert struct.unpack(">H", frame[14:16])[0] == dcp.FRAME_ID_IDENTIFY_REQ
    service, stype, xid = struct.unpack(">BBI", frame[16:22])
    assert service == dcp.SERVICE_IDENTIFY and stype == dcp.SERVICE_TYPE_REQUEST
    assert xid == 0x11223344
    assert frame[26:30] == bytes([0xFF, 0xFF, 0x00, 0x00])    # option all / suboption all
    assert len(frame) >= 60
    # No Set (0x04), Get (0x03) or Hello (0x06) service anywhere in the module's builders.
    src = open(dcp.__file__, encoding="utf-8").read()
    assert "SERVICE_SET" not in src and "def build_set" not in src


def test_parse_identify_response_extracts_every_field():
    frame = dcp.build_identify_response(src_mac=SRC, xid=7, station_name="plc-fountain",
                                        vendor_name="S7-1200", vendor_id=0x002A, device_id=0x010D,
                                        role=0x02, ip="192.168.5.10", mask="255.255.252.0",
                                        gw="192.168.4.1")
    dev = dcp.parse_identify_response(frame, expected_xid=7)
    assert dev.mac == "00:1b:1b:12:34:56"
    assert dev.station_name == "plc-fountain"
    assert dev.vendor == "Siemens" and dev.vendor_id == 0x002A and dev.device_id == 0x010D
    assert dev.vendor_name == "S7-1200" and dev.device_family == "S7-1200"
    assert dev.role == "IO-Controller"
    assert (dev.ip, dev.netmask, dev.gateway) == ("192.168.5.10", "255.255.252.0", "192.168.4.1")
    assert dev.order_id == ""                       # DCP does not carry it; SZL does
    d = dev.to_dict()
    assert d["raw_blocks"] and not d["warnings"]


def test_vlan_tagged_response_is_parsed():
    frame = dcp.build_identify_response(src_mac=SRC, xid=1)
    tagged = frame[:12] + b"\x81\x00\x00\x05" + frame[12:]
    assert dcp.parse_identify_response(tagged).station_name == "plc-1"


@pytest.mark.parametrize("mutate,needle", [
    (lambda f: f[:20], "too short"),
    (lambda f: f[:12] + b"\x08\x00" + f[14:], "not PROFINET"),
    (lambda f: f[:14] + b"\xfe\xfe" + f[16:], "not Identify response"),
    (lambda f: f[:16] + b"\x04" + f[17:], "not Identify"),
    (lambda f: f[:17] + b"\x05" + f[18:], "not supported"),
    (lambda f: f[:18] + b"\xde\xad\xbe\xef" + f[22:], "xid"),
])
def test_malformed_responses_are_rejected(mutate, needle):
    frame = dcp.build_identify_response(src_mac=SRC, xid=0x01000001)
    with pytest.raises(dcp.DcpParseError, match=needle):
        dcp.parse_identify_response(mutate(frame), expected_xid=0x01000001)


def test_overrunning_dcp_length_and_block_length_are_rejected():
    with pytest.raises(dcp.DcpParseError, match="overruns"):
        dcp.parse_identify_response(dcp.build_identify_response(src_mac=SRC, corrupt_length=True))
    frame = bytearray(dcp.build_identify_response(src_mac=SRC))
    # first block header sits at offset 26; lie about its length
    frame[28:30] = struct.pack(">H", 0x0FFF)
    with pytest.raises(dcp.DcpParseError, match="overruns"):
        dcp.parse_identify_response(bytes(frame))


def test_response_without_identity_blocks_is_rejected():
    hdr = bytes(6) + SRC + struct.pack(">H", dcp.ETHERTYPE_PN) + struct.pack(">H", dcp.FRAME_ID_IDENTIFY_RSP)
    body = struct.pack(">BBIHH", dcp.SERVICE_IDENTIFY, dcp.SERVICE_TYPE_RESPONSE, 1, 0, 0)
    with pytest.raises(dcp.DcpParseError, match="no identity"):
        dcp.parse_identify_response(hdr + body)


def test_sender_reports_unavailability_honestly():
    ok, why = dcp.raw_ethernet_available()
    res = dcp.dcp_identify_all("Ethernet", listen_s=0.01) if not ok else None
    if not ok:
        assert res.available is False and res.reason == why and res.devices == []
        assert "raw" in why.lower() or "npcap" in why.lower()
