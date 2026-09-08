"""
AF-DISC — controller discovery: adapters, subnet selection, scan limits,
cancellation, evidence-based results, PLC prefill, and the job registry.

No physical network is touched: adapters come from captured OS output, port
checks and identifiers are injected, and the I-CAN probe is a fake report.
"""
import asyncio
import time

import pytest

from engine import ican_discovery as disco
from engine.controller_identify import (
    DetectedController,
    discover_controllers,
    identify_service,
    confidence_label,
)
from engine.discovery_jobs import DiscoveryJobRegistry, JobAlreadyRunning, set_progress
from engine.net_adapters import (
    Adapter,
    ScanRangeError,
    classify,
    list_adapters,
    parse_ifconfig,
    parse_ip_addr,
    parse_ipconfig,
    resolve_scan_targets,
    validate_cidr,
)

IPCONFIG = """
Windows IP Configuration

   Host Name . . . . . . . . . . . . : CONTROL-PC

Ethernet adapter Ethernet:

   Connection-specific DNS Suffix  . :
   Description . . . . . . . . . . . : Realtek PCIe GbE Family Controller
   Physical Address. . . . . . . . . : 04-7C-16-AA-BB-CC
   DHCP Enabled. . . . . . . . . . . : No
   IPv4 Address. . . . . . . . . . . : 192.168.5.200(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.252.0
   Default Gateway . . . . . . . . . : 192.168.4.1

Ethernet adapter vEthernet (WSL):

   Description . . . . . . . . . . . : Hyper-V Virtual Ethernet Adapter
   Physical Address. . . . . . . . . : 00-15-5D-11-22-33
   IPv4 Address. . . . . . . . . . . : 172.20.0.1(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.240.0

Unknown adapter ProtonVPN:

   Description . . . . . . . . . . . : ProtonVPN TUN
   IPv4 Address. . . . . . . . . . . : 10.2.0.2(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.255.255

Wireless LAN adapter Wi-Fi:

   Description . . . . . . . . . . . : Intel(R) Wi-Fi 6 AX201 160MHz
   Physical Address. . . . . . . . . : 34-C9-3D-00-11-22
   Media State . . . . . . . . . . . : Media disconnected

Ethernet adapter Ethernet 2:

   Description . . . . . . . . . . . : Intel(R) I210 Gigabit
   Physical Address. . . . . . . . . : 00-1B-21-44-55-66
   IPv4 Address. . . . . . . . . . . : 10.10.0.7(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.0.0
"""

IP_ADDR = """1: lo    inet 127.0.0.1/8 scope host lo\\       valid_lft forever preferred_lft forever
2: eth0    inet 192.168.5.200/24 brd 192.168.5.255 scope global eth0\\       valid_lft forever preferred_lft forever
4: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever
5: wg0    inet 10.66.0.2/32 scope global wg0\\       valid_lft forever preferred_lft forever
"""

IFCONFIG = """lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384
\tinet 127.0.0.1 netmask 0xff000000
en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500
\tinet 192.168.5.200 netmask 0xffffff00 broadcast 192.168.5.255
utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1400
\tinet 10.8.0.5 netmask 0xffffffff
"""


# ── adapter parsing + classification ───────────────────────────────────────────
def test_ipconfig_parsing_reads_real_masks_and_kinds():
    ads = {a.name: a for a in parse_ipconfig(IPCONFIG)}
    assert "Wi-Fi" not in ads                        # media disconnected → not scannable
    eth = ads["Ethernet"]
    assert eth.ip == "192.168.5.200" and eth.prefix == 22      # the REAL mask, not /24
    assert eth.subnet == "192.168.4.0/22"
    assert eth.mac == "04:7c:16:aa:bb:cc"
    assert eth.kind == "physical" and eth.eligible
    assert ads["vEthernet (WSL)"].kind == "virtual" and not ads["vEthernet (WSL)"].eligible
    assert ads["ProtonVPN"].kind == "vpn" and not ads["ProtonVPN"].eligible
    d = eth.to_dict()
    assert d["netmask"] == "255.255.252.0" and d["host_count"] == 1022


def test_ipconfig_keeps_usb_adapter_with_autoconfiguration_ipv4_for_dcp():
    text = """Ethernet adapter Ethernet:

   Description . . . . . . . . . . . : USB2.0 Ethernet Adapter
   Physical Address. . . . . . . . . : C8-17-F5-DD-4E-52
   Autoconfiguration IPv4 Address. . : 169.254.201.86(Preferred)
   Subnet Mask . . . . . . . . . . . : 255.255.0.0
"""
    ads = parse_ipconfig(text)
    assert len(ads) == 1
    assert ads[0].name == "Ethernet" and ads[0].ip == "169.254.201.86"
    assert ads[0].prefix == 16 and ads[0].kind == "link_local"
    assert ads[0].mac == "c8:17:f5:dd:4e:52"


def test_linux_and_bsd_parsers():
    lin = {a.name: a for a in parse_ip_addr(IP_ADDR)}
    assert lin["lo"].kind == "loopback"
    assert lin["eth0"].prefix == 24 and lin["eth0"].eligible
    assert lin["docker0"].kind == "virtual"
    assert lin["wg0"].kind == "vpn"
    bsd = {a.name: a for a in parse_ifconfig(IFCONFIG)}
    assert bsd["en0"].prefix == 24 and bsd["en0"].kind == "physical"
    assert bsd["utun3"].kind == "vpn"
    assert bsd["lo0"].kind == "loopback"


def test_classify_is_address_first_then_name():
    assert classify("Ethernet", "", "127.0.0.1") == "loopback"
    assert classify("Ethernet", "", "169.254.10.1") == "link_local"
    assert classify("Ethernet 3", "TAP-Windows Adapter V9", "10.0.0.2") == "vpn"
    assert classify("Ethernet 3", "Some Adapter", "10.0.0.2") == "physical"
    assert classify("weird0", "", "10.0.0.2") == "unknown"     # unknown stays eligible


def test_list_adapters_uses_injected_runner_and_falls_back():
    ads = list_adapters(runner=lambda cmd: IPCONFIG, system="Windows")
    assert [a.name for a in ads][:2] == ["Ethernet 2", "Ethernet"] or ads[0].eligible
    fallback = list_adapters(runner=lambda cmd: "", system="Windows")
    assert fallback                                      # hostname/default-route fallback
    assert all(a.prefix == 24 for a in fallback)


# ── scan-target selection ──────────────────────────────────────────────────────
def _adapters():
    return [
        Adapter(name="Ethernet", ip="192.168.5.200", prefix=22, kind="physical"),
        Adapter(name="Ethernet 2", ip="10.10.0.7", prefix=16, kind="physical"),
        Adapter(name="vEthernet (WSL)", ip="172.20.0.1", prefix=20, kind="virtual"),
        Adapter(name="ProtonVPN", ip="10.2.0.2", prefix=32, kind="vpn"),
        Adapter(name="Loopback", ip="127.0.0.1", prefix=8, kind="loopback"),
    ]


def test_default_targets_exclude_virtual_vpn_loopback_and_oversized():
    targets = resolve_scan_targets(_adapters())
    assert [t.subnet for t in targets] == ["192.168.4.0/22"]     # /16 skipped, not clamped
    assert targets[0].adapter == "Ethernet" and targets[0].source == "auto"
    with_virtual = resolve_scan_targets(_adapters(), include_virtual=True)
    assert "172.20.0.0/20" not in [t.subnet for t in with_virtual]   # /20 too big even opted in
    assert any(t.kind == "vpn" for t in with_virtual)


def test_explicit_cidr_scans_only_that_range():
    targets = resolve_scan_targets(_adapters(), cidr="192.168.5.0/24")
    assert len(targets) == 1
    assert targets[0].subnet == "192.168.5.0/24"
    assert targets[0].source == "manual_cidr"
    assert targets[0].adapter == "Ethernet"              # attributed to the owning adapter
    off_net = resolve_scan_targets(_adapters(), cidr="10.99.0.0/24")
    assert off_net[0].adapter is None and off_net[0].subnet == "10.99.0.0/24"


def test_explicit_adapter_uses_its_real_subnet_only():
    targets = resolve_scan_targets(_adapters(), adapter_name="Ethernet")
    assert [t.subnet for t in targets] == ["192.168.4.0/22"]
    with pytest.raises(ScanRangeError):
        resolve_scan_targets(_adapters(), adapter_name="Ethernet 2")   # /16 refused
    with pytest.raises(ScanRangeError):
        resolve_scan_targets(_adapters(), adapter_name="nope")


def test_explicit_link_local_adapter_becomes_layer2_only_target():
    apipa = Adapter(name="USB Ethernet", ip="169.254.201.86", prefix=16,
                    kind="link_local", description="USB2.0 Ethernet Adapter",
                    mac="c8:17:f5:dd:4e:52")
    targets = resolve_scan_targets([apipa], adapter_name="USB Ethernet")
    assert len(targets) == 1
    assert targets[0].subnet == "169.254.201.86/32"
    assert targets[0].adapter == "USB Ethernet"
    assert targets[0].source == "adapter_layer2"


def test_unreasonable_ranges_are_refused_not_clamped():
    for bad in ("10.0.0.0/8", "192.168.0.0/16", "0.0.0.0/0", "fe80::/64", "not-a-cidr", "", "224.0.0.0/24"):
        with pytest.raises(ScanRangeError):
            validate_cidr(bad)
    assert str(validate_cidr("192.168.5.7")) == "192.168.5.7/32"
    assert str(validate_cidr("192.168.4.0/22")) == "192.168.4.0/22"


# ── the sweep (injected network) ───────────────────────────────────────────────
class _Net:
    """A fake network: {ip: {well_known_port: DetectedController-or-None}}."""

    def __init__(self, hosts: dict, delay: float = 0.0):
        self.hosts = hosts
        self.delay = delay
        self.checked: list[tuple[str, int]] = []

    async def port_open(self, ip, port):
        self.checked.append((ip, port))
        if self.delay:
            await asyncio.sleep(self.delay)
        return port in self.hosts.get(ip, {})

    async def identify(self, ip, port, well_known, unit_ids=(1,)):
        det = self.hosts.get(ip, {}).get(well_known)
        return [det] if det else []


def _det(ip, port, catalog_id="siemens-s7-1200", confidence="confirmed", stage="protocol_confirmed",
         tier="REAL"):
    from engine.controller_catalog import get_entry
    from engine.controller_identify import _from_entry
    return _from_entry(get_entry(catalog_id), ip, port, confidence, stage=stage)


def _run(**kw):
    kw.setdefault("adapters_provider", _adapters)
    kw.setdefault("dcp_scanner", False)
    kw.setdefault("arp_provider", lambda net: {})

    async def no_ican(**_):
        return disco.DiscoveryReport(gateway=None, candidates=[], scanned=0)
    kw.setdefault("ican_discover", no_ican)
    return asyncio.run(discover_controllers(**kw))


def test_explicit_subnet_isolation_scans_nothing_else():
    net = _Net({"10.99.0.5": {102: _det("10.99.0.5", 102)}})
    res = _run(subnet="10.99.0.0/29", port_checker=net.port_open, identifier=net.identify)
    assert res["subnets"] == ["10.99.0.0/29"]
    scanned_ips = {ip for ip, _ in net.checked}
    assert scanned_ips == {f"10.99.0.{i}" for i in range(1, 7)}    # only that range, not 192.168.4/22
    assert [d["ip"] for d in res["detected"]] == ["10.99.0.5"]
    assert res["detected"][0]["subnet"] == "10.99.0.0/29"


def test_scan_size_limit_is_a_400_class_error():
    with pytest.raises(ScanRangeError):
        _run(subnet="10.0.0.0/8", port_checker=_Net({}).port_open, identifier=_Net({}).identify)


def test_cancellation_stops_early_and_concurrency_is_bounded():
    net = _Net({}, delay=0.02)
    ev = asyncio.Event()
    progress = []

    async def run():
        async def cancel_soon():
            await asyncio.sleep(0.15)
            ev.set()
        asyncio.create_task(cancel_soon())
        return await discover_controllers(subnet="10.50.0.0/22", cancel=ev,
                                          progress=lambda f, m: progress.append((f, m)),
                                          adapters_provider=_adapters, dcp_scanner=False,
                                          port_checker=net.port_open, identifier=net.identify,
                                          arp_provider=lambda n: {}, include_ican=False)
    t0 = time.monotonic()
    res = asyncio.run(run())
    assert res["cancelled"] is True
    assert res["hosts_scanned"] < 1022
    assert time.monotonic() - t0 < 5.0
    assert any("cancelled" in w for w in res["warnings"])
    assert progress and progress[-1][0] == 1.0


def test_time_budget_is_honoured():
    net = _Net({}, delay=0.05)
    res = _run(subnet="10.50.0.0/23", max_seconds=0.3, port_checker=net.port_open,
               identifier=net.identify, include_ican=False)
    assert res["deadline_hit"] is True and res["hosts_scanned"] < 510


def test_open_port_never_becomes_a_confirmed_protocol():
    """A listener on 5007 (MELSEC port hint) and a listener on 102 that does not
    speak S7 both stay 'port match only' / absent — never protocol confirmed."""
    net = _Net({"192.168.5.9": {5007: _det("192.168.5.9", 5007, "mitsubishi-melsec", "port_only", "port_open"),
                                102: None}})
    res = _run(subnet="192.168.5.8/30", port_checker=net.port_open, identifier=net.identify)
    assert len(res["detected"]) == 1
    d = res["detected"][0]
    assert d["confidence"] == "port_only" and d["stage"] == "port_open"
    assert d["confidence_label"].startswith("port match only")
    assert d["drivable"] is False and d["configurable"] is False and d["plc_prefill"] == {}


def test_unsupported_controllers_stay_identify_only_and_nothing_gets_fake_health():
    net = _Net({"192.168.5.20": {44818: _det("192.168.5.20", 44818, "allen-bradley-logix", "confirmed", "identity_confirmed")},
                "192.168.5.10": {102: _det("192.168.5.10", 102)}})
    res = _run(subnet="192.168.5.0/27", port_checker=net.port_open, identifier=net.identify)
    by_id = {d["catalog_id"]: d for d in res["detected"]}
    ab = by_id["allen-bradley-logix"]
    assert ab["tier"] == "UNSUPPORTED" and ab["drivable"] is False and ab["configurable"] is False
    assert ab["confidence"] == "confirmed"                 # identified, honestly, but not drivable
    for d in res["detected"]:
        assert d["status"] == "unverified"
        assert d["health"] is None
        assert d["stage"] not in ("configured", "commissioned", "data_access_verified")
        assert d["discovery_id"] and d["last_verified"] > 0


def test_plc_configuration_prefill_for_siemens_and_modbus():
    net = _Net({"192.168.5.10": {102: _det("192.168.5.10", 102)},
                "192.168.5.30": {502: _det("192.168.5.30", 502, "advantech-adam-6000", "confirmed", "identity_confirmed")}})
    res = _run(subnet="192.168.5.0/26", port_checker=net.port_open, identifier=net.identify)
    by_ip = {d["ip"]: d for d in res["detected"]}
    s7 = by_ip["192.168.5.10"]
    assert s7["configurable"] is True
    assert s7["plc_prefill"]["plc_type"] == "siemens_s7"
    assert s7["plc_prefill"]["ip"] == "192.168.5.10" and s7["plc_prefill"]["port"] == 102
    assert s7["plc_prefill"]["rack"] == 0 and s7["plc_prefill"]["slot"] == 1
    assert s7["plc_prefill"]["vendor"] == "Siemens"
    mb = by_ip["192.168.5.30"]
    assert mb["plc_prefill"]["plc_type"] == "modbus_tcp" and mb["plc_prefill"]["unit_id"] == 1
    assert mb["plc_prefill"]["port"] == 502 and mb["plc_prefill"]["vendor"] == "Advantech"
    assert s7["adapter"] == "Ethernet"                    # attributed to the adapter


def test_mac_addresses_are_filled_from_the_arp_table():
    net = _Net({"192.168.5.10": {102: _det("192.168.5.10", 102)}})
    res = _run(subnet="192.168.5.8/29", port_checker=net.port_open, identifier=net.identify,
               arp_provider=lambda n: {"192.168.5.10": "00:1c:06:aa:bb:cc"})
    assert res["detected"][0]["mac"] == "00:1c:06:aa:bb:cc"


def test_no_eligible_adapter_returns_a_warning_not_a_scan():
    res = _run(adapters_provider=lambda: [Adapter("Loopback", "127.0.0.1", 8, "loopback")],
               port_checker=_Net({}).port_open, identifier=_Net({}).identify)
    assert res["detected"] == [] and res["subnets"] == []
    assert any("adapter" in w for w in res["warnings"])


def test_confidence_labels():
    assert confidence_label("port_only") == "port match only (unverified service)"
    assert confidence_label("confirmed", "protocol_confirmed") == "protocol confirmed"
    assert confidence_label("confirmed", "identity_confirmed") == "identity confirmed"


# ── the job registry ───────────────────────────────────────────────────────────
def test_job_registry_progress_cancel_and_single_runner():
    async def run():
        reg = DiscoveryJobRegistry()
        seen = []

        async def runner(job):
            cb = set_progress(job)
            for i in range(50):
                if job.cancel.is_set():
                    return {"cancelled": True, "i": i}
                cb(i / 50, f"step {i}")
                seen.append(job.progress)
                await asyncio.sleep(0.01)
            return {"cancelled": False}

        job = reg.start(runner, {"subnet": "x"})
        with pytest.raises(JobAlreadyRunning):
            reg.start(runner, {})
        await asyncio.sleep(0.08)
        snap = reg.get(job.id).to_dict(include_result=False)
        assert snap["status"] == "running" and 0 < snap["progress"] < 1
        reg.cancel(job.id)
        await job.task
        return reg.get(job.id).to_dict(), reg.list()
    final, listing = asyncio.run(run())
    assert final["status"] == "cancelled" and final["result"]["cancelled"] is True
    assert listing[0]["job_id"] == final["job_id"]


# ── routes ─────────────────────────────────────────────────────────────────────
def test_routes_reject_bad_ranges_and_expose_adapters():
    from fastapi import HTTPException
    from api.routes.controllers import DiscoverRequest, adapters, discover, discover_start

    async def run():
        ads = await adapters()
        try:
            await discover(DiscoverRequest(subnet="10.0.0.0/8"))
            bad = None
        except HTTPException as e:
            bad = e.status_code
        try:
            await discover_start(DiscoverRequest(subnet="10.0.0.0/8"))
            bad2 = None
        except HTTPException as e:
            bad2 = e.status_code
        return ads, bad, bad2
    ads, bad, bad2 = asyncio.run(run())
    assert "adapters" in ads and "default_targets" in ads
    assert bad == 400 and bad2 == 400


def test_job_routes_start_poll_cancel(monkeypatch):
    from api.routes import controllers as routes
    from engine import discovery_jobs

    async def slow_discover(**kw):
        cancel = kw.get("cancel")
        progress = kw.get("progress")
        for i in range(100):
            if cancel is not None and cancel.is_set():
                return {"detected": [], "cancelled": True}
            if progress:
                progress(i / 100, "working")
            await asyncio.sleep(0.01)
        return {"detected": [], "cancelled": False}

    monkeypatch.setattr(routes, "discover_controllers", slow_discover)
    monkeypatch.setattr(routes, "registry", discovery_jobs.DiscoveryJobRegistry())
    monkeypatch.setattr(routes, "resolve_scan_targets", lambda *a, **k: [])
    monkeypatch.setattr(routes, "list_adapters", lambda: [])

    async def run():
        started = await routes.discover_start(routes.DiscoverRequest(subnet="192.168.5.0/24"))
        await asyncio.sleep(0.05)
        mid = await routes.discover_job(started["job_id"])
        cancelled = await routes.discover_cancel(started["job_id"])
        await routes.registry.get(started["job_id"]).task
        final = await routes.discover_job(started["job_id"])
        return started, mid, cancelled, final
    started, mid, cancelled, final = asyncio.run(run())
    assert started["status"] == "running"
    assert mid["status"] == "running" and "result" not in mid
    assert final["status"] == "cancelled" and final["result"]["cancelled"] is True
