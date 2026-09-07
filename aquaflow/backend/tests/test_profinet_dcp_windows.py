"""
AF-DISC — PROFINET DCP Identify through an injectable Ethernet provider (the
Windows/Npcap path and the Linux AF_PACKET path share this sender).

Nothing here touches a real NIC: the FakeEthernetProvider records what the
sender transmits and feeds constructed reply frames back. What must hold:
  * the SELECTED adapter is the one opened — never "the first NIC";
  * exactly one frame leaves: the DCP Identify-All to 01:0E:CF:00:00:00,
    EtherType 0x8892, service 0x05 type 0x00, from the adapter's MAC;
  * replies are correlated (xid + destination MAC); malformed, unrelated,
    foreign-xid and misaddressed frames are rejected and counted;
  * duplicate replies from one device collapse to one;
  * deadline and cancellation are honoured;
  * there is no DCP Set / Get / Hello / Signal anywhere in the discovery API;
  * an unavailable provider fails CLOSED with an operator hint, and no other
    subnet is scanned as a "fallback";
  * the I-CAN control implementation is not imported or referenced.
"""
import ctypes
import inspect
import struct
import time

import pytest

from engine import profinet_dcp as dcp
from engine.net_adapters import Adapter

PLC_MAC = bytes.fromhex("001b1b123456")
PC_MAC = bytes.fromhex("047c16aabbcc")
ADAPTER = Adapter(name="Ethernet", ip="192.168.5.200", prefix=22, kind="physical",
                  description="Realtek PCIe GbE Family Controller", mac="04:7c:16:aa:bb:cc")
WIFI = Adapter(name="Wi-Fi", ip="10.0.0.5", prefix=24, kind="physical", mac="34:c9:3d:00:11:22")


def _reply_for(request: bytes, *, mac=PLC_MAC, **kw) -> bytes:
    """A device's answer to OUR request: echoes its xid, addressed to our MAC."""
    xid = struct.unpack_from(">I", request, 18)[0]
    kw.setdefault("dst_mac", request[6:12])
    return dcp.build_identify_response(src_mac=mac, xid=xid, **kw)


def test_selected_adapter_is_the_one_opened_and_only_identify_is_sent():
    prov = dcp.FakeEthernetProvider(replies=[lambda req: _reply_for(req)], src_mac=PC_MAC)
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.15)
    assert prov.opened_with is ADAPTER                      # bound to the selection
    assert prov.closed
    assert len(prov.sent) == 1                               # exactly one frame ever leaves
    frame = prov.sent[0]
    assert frame[0:6] == dcp.DCP_MULTICAST                   # PROFINET DCP multicast
    assert frame[6:12] == PC_MAC                             # from the adapter's MAC
    assert struct.unpack(">H", frame[12:14])[0] == dcp.ETHERTYPE_PN
    assert struct.unpack(">H", frame[14:16])[0] == dcp.FRAME_ID_IDENTIFY_REQ
    assert frame[16] == dcp.SERVICE_IDENTIFY and frame[17] == dcp.SERVICE_TYPE_REQUEST
    assert frame[26:30] == bytes([0xFF, 0xFF, 0x00, 0x00])   # option ALL / suboption ALL
    assert res.available and res.provider == "fake" and res.src_mac == "04:7c:16:aa:bb:cc"
    assert res.sent_hex == [frame.hex()]
    assert [d.station_name for d in res.devices] == ["plc-1"]
    assert res.devices[0].adapter == "Ethernet"
    assert res.devices[0].mac == "00:1b:1b:12:34:56"


def test_evidence_fields_are_preserved():
    prov = dcp.FakeEthernetProvider(replies=[lambda req: _reply_for(
        req, station_name="fountain-cpu", vendor_name="S7-1200", ip="10.99.7.10",
        mask="255.255.255.0", gw="10.99.7.1")], src_mac=PC_MAC)
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.1)
    d = res.devices[0].to_dict()
    assert d["station_name"] == "fountain-cpu" and d["vendor"] == "Siemens"
    assert d["device_family"] == "S7-1200" and d["device_id"] == 0x010D
    assert (d["ip"], d["netmask"], d["gateway"]) == ("10.99.7.10", "255.255.255.0", "10.99.7.1")
    assert d["adapter"] == "Ethernet" and d["mac"] == "00:1b:1b:12:34:56"
    assert d["order_id"] == ""                               # DCP does not carry it


def test_device_without_ip_is_still_discovered():
    prov = dcp.FakeEthernetProvider(replies=[lambda req: _reply_for(req, ip="0.0.0.0", mask="0.0.0.0", gw="0.0.0.0")],
                                    src_mac=PC_MAC)
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.1)
    assert res.devices and res.devices[0].ip == ""
    assert any("no IP" in w for w in res.devices[0].warnings)


def test_response_correlation_is_enforced():
    def foreign_xid(req):
        return dcp.build_identify_response(src_mac=PLC_MAC, xid=0x0BADBEEF, dst_mac=req[6:12])

    def misaddressed(req):
        return _reply_for(req, mac=bytes.fromhex("001b1b000001"), dst_mac=bytes.fromhex("0000000000aa"))

    prov = dcp.FakeEthernetProvider(replies=[foreign_xid, misaddressed, lambda req: _reply_for(req)],
                                    src_mac=PC_MAC)
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.15)
    assert [d.mac for d in res.devices] == ["00:1b:1b:12:34:56"]
    reasons = [r for _, r in res.rejected]
    assert any("xid" in r for r in reasons)
    assert any("destination MAC" in r for r in reasons)


def test_malformed_and_unrelated_frames_are_rejected_not_crashing():
    arp = bytes.fromhex("ffffffffffff") + PLC_MAC + b"\x08\x06" + bytes(28)
    lldp = bytes.fromhex("0180c200000e") + PLC_MAC + b"\x88\xcc" + bytes(40)
    truncated = _reply_for(dcp.build_identify_all(PC_MAC, xid=1), )[:30]
    echo_of_our_own_request = None

    def our_echo(req):
        return req                                           # switches can loop it back

    prov = dcp.FakeEthernetProvider(replies=[arp, lldp, our_echo, b"\x00" * 10,
                                             lambda req: _reply_for(req, corrupt_length=True),
                                             lambda req: _reply_for(req)], src_mac=PC_MAC)
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.2)
    assert [d.station_name for d in res.devices] == ["plc-1"]
    kinds = " | ".join(r for _, r in res.rejected)
    assert "not PROFINET" in kinds and "too short" in kinds and "overruns" in kinds
    # our own request echoed back is silently ignored, not reported as a device
    assert not any(m == "04:7c:16:aa:bb:cc" for m, _ in res.rejected)


def test_duplicate_replies_are_deduplicated():
    prov = dcp.FakeEthernetProvider(replies=[lambda req: _reply_for(req)] * 4 +
                                            [lambda req: _reply_for(req, mac=bytes.fromhex("001b1b0000ff"), station_name="io-1")],
                                    src_mac=PC_MAC)
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.2)
    assert [d.station_name for d in res.devices] == ["plc-1", "io-1"]
    assert res.duplicates == 3


def test_deadline_and_cancellation():
    prov = dcp.FakeEthernetProvider(replies=[], src_mac=PC_MAC)
    t0 = time.monotonic()
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.25)
    assert 0.2 <= time.monotonic() - t0 < 1.5 and res.devices == [] and not res.cancelled

    calls = {"n": 0}

    def stop_after_two():
        calls["n"] += 1
        return calls["n"] > 2
    prov = dcp.FakeEthernetProvider(replies=[0.02] * 50, src_mac=PC_MAC)
    t0 = time.monotonic()
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=5.0, should_stop=stop_after_two)
    assert res.cancelled and res.reason == "cancelled"
    assert time.monotonic() - t0 < 2.0
    assert len(prov.sent) == 1                               # cancelling never sends anything


def test_unavailable_provider_fails_closed_with_a_hint():
    prov = dcp.FakeEthernetProvider(unavailable="no raw Ethernet here")
    res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.1)
    assert res.available is False and res.reason == "no raw Ethernet here"
    assert res.devices == [] and prov.sent == []
    d = res.to_dict()
    assert d["available"] is False and "install_hint" in d


def test_npcap_provider_on_this_machine_is_honest():
    """Whatever this box has, the provider must not raise and must explain."""
    prov = dcp.NpcapProvider()
    ok, why = prov.availability()
    if not ok:
        assert "Npcap" in why and dcp.NPCAP_URL in why
        res = dcp.dcp_identify_all(ADAPTER, provider=prov, listen_s=0.05)
        assert res.available is False and res.install_hint == dcp.NPCAP_HINT
        assert "Npcap" in res.reason
    else:  # Npcap installed: still no traffic in automated tests — only the device listing
        devs = dcp.npcap_devices()
        assert isinstance(devs, list)


def test_npcap_device_selection_matches_the_selected_adapter_only():
    devs = [
        {"name": r"\Device\NPF_{WIFI}", "description": "Intel(R) Wi-Fi 6 AX201 160MHz", "ips": ["10.0.0.5"]},
        {"name": r"\Device\NPF_{ETH}", "description": "Realtek PCIe GbE Family Controller", "ips": ["192.168.5.200"]},
        {"name": r"\Device\NPF_{VPN}", "description": "ProtonVPN TUN", "ips": ["10.2.0.2"]},
    ]
    eth = dcp.match_npcap_device(devs, dcp._adapter_fields(ADAPTER))
    assert eth["name"].endswith("{ETH}")
    wifi = dcp.match_npcap_device(devs, dcp._adapter_fields(WIFI))
    assert wifi["name"].endswith("{WIFI}")
    # description-only fallback when the adapter has no IP yet (static-IP cabinet before link-up)
    no_ip = dcp.match_npcap_device(devs, {"name": "Ethernet", "ip": "", "description": "Realtek PCIe GbE Family Controller"})
    assert no_ip["name"].endswith("{ETH}")
    assert dcp.match_npcap_device(devs, {"name": "Ethernet 9", "ip": "172.16.0.9", "description": "Unknown"}) is None


def test_adapter_without_mac_is_refused_by_npcap_provider(monkeypatch):
    prov = dcp.NpcapProvider()
    monkeypatch.setattr(prov, "_lib_or_raise", lambda: object())
    with pytest.raises(dcp.ProviderUnavailable, match="MAC"):
        prov.open(Adapter(name="Ethernet", ip="192.168.5.200", prefix=24, kind="physical", mac=""))
    with pytest.raises(dcp.ProviderUnavailable, match="MAC"):
        prov.open("Ethernet")                                # a bare name has no MAC either


class _FakePcapLib:
    """Small in-memory stand-in for wpcap.dll. This exercises the ctypes wrapper
    without loading Npcap or opening a real adapter."""

    def __init__(self, reply=b"reply", *, compile_rc=0, filter_rc=0):
        self.handle = 0x1234
        self.reply = bytes(reply)
        self.compile_rc = compile_rc
        self.filter_rc = filter_rc
        self.opened = None
        self.compiled = None
        self.sent = []
        self.closed = []
        self._delivered = False
        self._buffer = (ctypes.c_ubyte * len(self.reply)).from_buffer_copy(self.reply)
        self._header = dcp._PcapPktHdr(0, 0, len(self.reply), len(self.reply))

    def pcap_open_live(self, name, snaplen, promiscuous, timeout_ms, errbuf):
        self.opened = (name, snaplen, promiscuous, timeout_ms)
        return self.handle

    def pcap_compile(self, handle, program, expression, optimize, netmask):
        self.compiled = (handle, expression, optimize, netmask)
        return self.compile_rc

    def pcap_setfilter(self, handle, program):
        return self.filter_rc

    def pcap_freecode(self, program):
        pass

    def pcap_setmintocopy(self, handle, size):
        return 0

    def pcap_sendpacket(self, handle, frame, length):
        self.sent.append(bytes(frame[:length]))
        return 0

    def pcap_next_ex(self, handle, header_out, data_out):
        if self._delivered:
            return 0
        self._delivered = True
        header_slot = ctypes.cast(
            header_out, ctypes.POINTER(ctypes.POINTER(dcp._PcapPktHdr)))
        data_slot = ctypes.cast(
            data_out, ctypes.POINTER(ctypes.POINTER(ctypes.c_ubyte)))
        header_slot[0] = ctypes.pointer(self._header)
        data_slot[0] = ctypes.cast(self._buffer, ctypes.POINTER(ctypes.c_ubyte))
        return 1

    def pcap_geterr(self, handle):
        return b"fake pcap error"

    def pcap_close(self, handle):
        self.closed.append(handle)


def test_npcap_wrapper_opens_selected_device_filters_sends_and_receives(monkeypatch):
    frame = dcp.build_identify_all(PC_MAC, xid=0x12345678)
    reply = _reply_for(frame)
    lib = _FakePcapLib(reply)
    monkeypatch.setattr(dcp, "npcap_devices", lambda _lib: [{
        "name": r"\Device\NPF_{ETH}",
        "description": ADAPTER.description,
        "ips": [ADAPTER.ip],
    }])
    provider = dcp.NpcapProvider()
    provider._lib = lib
    link = provider.open(ADAPTER)
    assert lib.opened == (b"\\Device\\NPF_{ETH}", 2048, 0, 100)
    assert lib.compiled[1] == b"ether proto 0x8892"
    link.send(frame)
    assert lib.sent == [frame]
    assert link.recv(0.2) == reply
    link.close()
    link.close()                                             # native handle closes once
    assert lib.closed == [lib.handle]


@pytest.mark.parametrize("compile_rc,filter_rc", [(-1, 0), (0, -1)])
def test_npcap_wrapper_fails_closed_when_profinet_filter_cannot_apply(
        monkeypatch, compile_rc, filter_rc):
    lib = _FakePcapLib(compile_rc=compile_rc, filter_rc=filter_rc)
    monkeypatch.setattr(dcp, "npcap_devices", lambda _lib: [{
        "name": r"\Device\NPF_{ETH}",
        "description": ADAPTER.description,
        "ips": [ADAPTER.ip],
    }])
    provider = dcp.NpcapProvider()
    provider._lib = lib
    with pytest.raises(dcp.ProviderUnavailable, match="PROFINET-only capture filter"):
        provider.open(ADAPTER)
    assert lib.closed == [lib.handle]


def test_no_dcp_set_or_other_writing_service_exists():
    src = inspect.getsource(dcp)
    names = {n for n in dir(dcp)}
    for forbidden in ("SERVICE_SET", "SERVICE_GET", "SERVICE_HELLO", "build_set", "build_get",
                      "dcp_set", "assign_ip", "assign_name", "factory_reset", "signal", "flash_led"):
        assert not any(forbidden.lower() in n.lower() for n in names), forbidden
    # The only request builder packs SERVICE_IDENTIFY + REQUEST; the only other
    # DCP-header packer is the test/bench RESPONSE builder. Nothing else can put a
    # DCP header on the wire.
    assert src.count("SERVICE_IDENTIFY, SERVICE_TYPE_REQUEST") == 1
    packers = [name for name, obj in inspect.getmembers(dcp, inspect.isfunction)
               if obj.__module__ == dcp.__name__ and 'struct.pack(">BBIHH"' in inspect.getsource(obj)]
    assert sorted(packers) == ["build_identify_all", "build_identify_response"]
    # The sender transmits exactly what build_identify_all returns and nothing else.
    sender_src = inspect.getsource(dcp.dcp_identify_all)
    assert sender_src.count("link.send(") == 1 and "build_identify_all(" in sender_src


def test_dcp_module_does_not_touch_ican_or_the_fountain_control():
    src = inspect.getsource(dcp)
    for token in ("ican", "ICANClient", "ICANConnection", "set_channels", "all_off", "encode_output"):
        assert token not in src, token


def test_controllers_discovery_uses_the_selected_adapter_and_cancels_dcp():
    import asyncio
    from engine.controller_identify import discover_controllers

    seen = {}

    def scanner(adapter, should_stop=None):
        seen["adapter"] = adapter
        seen["should_stop"] = should_stop
        prov = dcp.FakeEthernetProvider(replies=[lambda req: _reply_for(req, ip="10.99.7.10")], src_mac=PC_MAC)
        return dcp.dcp_identify_all(adapter, provider=prov, listen_s=0.05, should_stop=should_stop)

    async def closed(ip, port):
        return False

    async def no_ident(ip, port, wk, unit_ids=(1,)):
        return []

    async def no_ican(**_):
        from engine import ican_discovery as disco
        return disco.DiscoveryReport(gateway=None, candidates=[])

    res = asyncio.run(discover_controllers(
        adapter="Ethernet", adapters_provider=lambda: [ADAPTER, WIFI], dcp_scanner=scanner,
        port_checker=closed, identifier=no_ident, ican_discover=no_ican, arp_provider=lambda n: {},
        subnet=None))
    assert seen["adapter"] is ADAPTER and callable(seen["should_stop"])
    assert res["subnets"] == ["192.168.4.0/22"]
    d = res["detected"][0]
    assert d["ip"] == "10.99.7.10" and d["catalog_id"] == "siemens-profinet-device"
    assert d["confidence"] == "confirmed" and d["stage"] == "identity_confirmed"
    assert d["drivable"] is False and d["configurable"] is False
    assert d["mac"] == "00:1b:1b:12:34:56" and d["adapter"] == "Ethernet"
    assert any("outside the selected subnet" in w for w in d["warnings"])
    assert any("PROFINET DCP Identify" in e for e in d["evidence"])
    # No extra subnet was swept because of the foreign IP.
    assert res["hosts_scanned"] <= 1022 and res["subnets"] == ["192.168.4.0/22"]


def test_dcp_only_siemens_remote_io_is_not_claimed_as_a_drivable_s7_plc():
    """A Siemens vendor id is shared by CPUs and PROFINET remote I/O. Without a
    strict S7comm handshake, DCP evidence must stay identify-only."""
    import asyncio
    from engine.controller_identify import discover_controllers

    def scanner(adapter, should_stop=None):
        prov = dcp.FakeEthernetProvider(replies=[lambda req: _reply_for(
            req, station_name="et200sp-1", vendor_name="ET 200SP",
            ip="192.168.5.42")], src_mac=PC_MAC)
        return dcp.dcp_identify_all(
            adapter, provider=prov, listen_s=0.05, should_stop=should_stop)

    async def closed(ip, port):
        return False

    async def no_ident(ip, port, wk, unit_ids=(1,)):
        return []

    res = asyncio.run(discover_controllers(
        adapter="Ethernet", adapters_provider=lambda: [ADAPTER],
        dcp_scanner=scanner, port_checker=closed, identifier=no_ident,
        include_ican=False, arp_provider=lambda n: {}))
    assert len(res["detected"]) == 1
    found = res["detected"][0]
    assert found["catalog_id"] == "siemens-profinet-device"
    assert found["protocol"] == "profinet_dcp"
    assert found["drivable"] is False and found["configurable"] is False
    assert found["stage"] == "identity_confirmed"
    assert "ET 200SP" in found["product"]


def test_two_dcp_devices_with_the_same_ip_are_both_reported_by_mac():
    """Duplicate IPs are a commissioning fault, not duplicate discovery rows."""
    import asyncio
    from engine.controller_identify import discover_controllers

    second_mac = bytes.fromhex("001b1b654321")

    def scanner(adapter, should_stop=None):
        prov = dcp.FakeEthernetProvider(replies=[
            lambda req: _reply_for(req, mac=PLC_MAC, station_name="cpu-a",
                                   ip="192.168.5.42"),
            lambda req: _reply_for(req, mac=second_mac, station_name="cpu-b",
                                   ip="192.168.5.42"),
        ], src_mac=PC_MAC)
        return dcp.dcp_identify_all(
            adapter, provider=prov, listen_s=0.08, should_stop=should_stop)

    async def closed(ip, port):
        return False

    async def no_ident(ip, port, wk, unit_ids=(1,)):
        return []

    res = asyncio.run(discover_controllers(
        adapter="Ethernet", adapters_provider=lambda: [ADAPTER],
        dcp_scanner=scanner, port_checker=closed, identifier=no_ident,
        include_ican=False, arp_provider=lambda n: {}))
    assert len(res["detected"]) == 2
    assert {x["mac"] for x in res["detected"]} == {
        "00:1b:1b:12:34:56", "00:1b:1b:65:43:21"}
    assert {x["ip"] for x in res["detected"]} == {"192.168.5.42"}


def test_foreign_ip_siemens_is_promoted_only_after_strict_s7_confirmation():
    import asyncio
    from engine.controller_identify import DetectedController, discover_controllers

    def scanner(adapter, should_stop=None):
        prov = dcp.FakeEthernetProvider(replies=[lambda req: _reply_for(
            req, station_name="fountain-cpu", vendor_name="S7-1200",
            ip="10.99.7.10")], src_mac=PC_MAC)
        return dcp.dcp_identify_all(
            adapter, provider=prov, listen_s=0.05, should_stop=should_stop)

    async def closed(ip, port):
        return False

    async def strict_s7(ip, port, wk, unit_ids=(1,)):
        assert (ip, port, wk) == ("10.99.7.10", 102, 102)
        return [DetectedController(
            ip=ip, port=102, catalog_id="siemens-s7-1200",
            label="Siemens SIMATIC S7 family", tier="REAL", drivable=True,
            confidence="confirmed", protocol="siemens_s7",
            stage="identity_confirmed", configurable=True,
            plc_prefill={"plc_type": "siemens_s7", "ip": ip, "port": 102})]

    res = asyncio.run(discover_controllers(
        adapter="Ethernet", adapters_provider=lambda: [ADAPTER],
        dcp_scanner=scanner, port_checker=closed, identifier=strict_s7,
        include_ican=False, arp_provider=lambda n: {}))
    assert len(res["detected"]) == 1
    found = res["detected"][0]
    assert found["catalog_id"] == "siemens-s7-1200"
    assert found["protocol"] == "siemens_s7"
    assert found["drivable"] is True and found["configurable"] is True
    assert any("direct, routed" in item for item in found["evidence"])
