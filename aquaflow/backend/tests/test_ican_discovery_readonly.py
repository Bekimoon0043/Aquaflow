"""
AF-DISC — read-only I-CAN discovery and its aggregation into the Controllers
result. The I-CAN CONTROL path (engine/ican_connection.py, the reference
client, output frames, arming, blackout, streaming) is not exercised for
changes here — these tests only prove discovery cannot touch it:

  * 253 timeouts + 1 protocol-valid reply → exactly ONE detected gateway;
  * all timeouts → zero gateways (timeouts never become controllers);
  * the only frame discovery ever sends is the read-only 0x03 probe, never 0x08;
  * an ACTIVE fountain-control connection is never interrupted by a scan.
"""
import asyncio
import inspect

import pytest

from engine import ican_discovery as disco
from engine import ican_protocol as proto
from engine.controller_identify import discover_controllers, ican_controllers_from_report
from engine.fake_ican_gateway import FakeICANGateway, FakeFaults
from engine.ican_connection import ConnectionState, ICANConfig, ICANConnection
from engine.net_adapters import Adapter


def _cand(ip, accepted, reason, **kw):
    base = dict(interface="Ethernet", ip=ip, gateway_port=200, local_port=2002,
                accepted=accepted, reason=reason)
    base.update(kw)
    return disco.Candidate(**base)


def _report(cands, gateway=None):
    return disco.DiscoveryReport(gateway=gateway, candidates=cands, scanned=len(cands),
                                 note="", local_port_used=2002)


# ── aggregation regression tests ──────────────────────────────────────────────
def test_253_timeouts_plus_one_valid_reply_is_exactly_one_gateway():
    cands = [_cand(f"192.168.5.{i}", False, "no reply (timeout)") for i in range(1, 255) if i != 2]
    assert len(cands) == 253
    good = _cand("192.168.5.2", True, "validated I-CAN reply", latency_ms=1.7, signature="07 00",
                 mac="00:11:22:33:44:55", confidence="high")
    cands.insert(100, good)
    found, diag = ican_controllers_from_report(_report(cands, good), adapter="Ethernet",
                                               subnet="192.168.5.0/24")
    assert len(found) == 1
    d = found[0]
    assert d.ip == "192.168.5.2" and d.port == 200 and d.catalog_id == "ican-music-fountain"
    assert d.confidence == "confirmed" and d.stage == "protocol_confirmed"
    assert d.mac == "00:11:22:33:44:55" and d.adapter == "Ethernet" and d.subnet == "192.168.5.0/24"
    assert d.identity["latency_ms"] == 1.7 and d.identity["signature"] == "07 00"
    assert d.identity["local_port"] == 2002 and d.identity["gateway_port"] == 200
    assert d.identity["interface"] == "Ethernet" and d.identity["reason"] == "validated I-CAN reply"
    assert d.drivable is True and d.tier == "REAL"           # validated → the catalog's real tier
    assert d.suggested_config["gateway_ip"] == "192.168.5.2"
    assert d.suggested_config["group"] == 0 and d.suggested_config["refresh_hz"] == 10   # untouched
    assert diag["rejected_count"] == 253 and diag["accepted"] == ["192.168.5.2"]


def test_all_timeouts_produce_zero_gateways():
    cands = [_cand(f"192.168.5.{i}", False, "no reply (timeout)") for i in range(1, 255)]
    found, diag = ican_controllers_from_report(_report(cands))
    assert found == [] and diag["found"] is False and diag["rejected_count"] == 254


def test_invalid_replies_never_become_controllers():
    cands = [
        _cand("10.0.0.2", False, "wrong length 2 (expected 13)"),
        _cand("10.0.0.3", False, "command 0x99 not an I-CAN reply signature"),
        _cand("10.0.0.4", False, "socket error: [Errno 10054]"),
        _cand("10.0.0.5", False, "no reply (timeout)"),
        _cand("10.0.0.6", False, "unrelated datagram", confidence="low"),
    ]
    found, diag = ican_controllers_from_report(_report(cands))
    assert found == []
    assert {r["ip"] for r in diag["rejected_sample"]} == {c.ip for c in cands}


def test_duplicate_replies_from_the_same_gateway_collapse_to_one():
    good = _cand("10.0.0.9", True, "validated I-CAN reply", confidence="high")
    found, _ = ican_controllers_from_report(_report([good, good, good], good))
    assert [d.ip for d in found] == ["10.0.0.9"]


def test_unverified_candidate_is_not_drivable_because_it_is_not_listed():
    """The old code listed every candidate (confidence 'probable'), so a timed-out
    host inherited the catalog's REAL tier. Now an unverified candidate is simply
    absent from the controller list."""
    cands = [_cand("10.0.0.7", False, "no reply (timeout)", confidence="none")]
    found, _ = ican_controllers_from_report(_report(cands))
    assert not any(d.drivable for d in found) and found == []


def test_control_status_candidate_is_marked_as_such():
    good = _cand("192.168.5.2", True, "reported by the active control connection", source="control_status",
                 interface="control-connection")
    found, diag = ican_controllers_from_report(disco.DiscoveryReport(
        gateway=good, candidates=[good], control_owns_port=True, note="control owns 2002"))
    assert len(found) == 1 and any("Fountain Control connection" in e for e in found[0].evidence)
    assert diag["control_owns_port"] is True


# ── discover_controllers wiring ───────────────────────────────────────────────
def test_controllers_discovery_passes_only_the_selected_subnet_to_ican():
    seen = {}

    async def fake_ican(**kw):
        seen.update(kw)
        cands = [_cand("10.5.0.4", True, "validated I-CAN reply", confidence="high")]
        return disco.DiscoveryReport(gateway=cands[0], candidates=cands)

    async def closed(ip, port):
        return False

    res = asyncio.run(discover_controllers(
        subnet="10.5.0.0/29",
        adapters_provider=lambda: [Adapter("Ethernet", "10.5.0.1", 24, "physical")],
        port_checker=closed, ican_discover=fake_ican, dcp_scanner=False,
        arp_provider=lambda n: {}))
    assert [i.network.prefixlen for i in seen["interfaces"]] == [29]
    assert seen["interfaces"][0].ip == "10.5.0.1" and seen["bind_ip"] == "10.5.0.1"
    assert seen["control_status_provider"] is not None
    assert [d["ip"] for d in res["detected"]] == ["10.5.0.4"]
    assert res["diagnostics"]["ican"][0]["subnet"] == "10.5.0.0/29"


# ── the wire: only the safe probe, never 0x08 ─────────────────────────────────
def test_discovery_sends_only_the_existing_safe_probe():
    sent = []

    async def spy(ip, gport, lport, timeout, frame):
        sent.append(bytes(frame))
        return (False, None, None, "no reply (timeout)", False)

    asyncio.run(disco.discover(candidate_ips=[f"10.0.0.{i}" for i in range(2, 30)],
                               prober=spy, arp_first=False))
    assert len(sent) == 28
    assert set(sent) == {proto.safe_probe_frame()}
    assert all(f[0] == proto.CMD_CHANNEL and f[0] != proto.CMD_OUTPUT for f in sent)
    assert proto.safe_probe_frame() == bytes.fromhex("03000000010000000000000000")


def _code_tokens(module):
    """NAME/NUMBER/STRING tokens of a module's CODE — docstrings and comments excluded."""
    import io
    import tokenize
    src = inspect.getsource(module)
    out = []
    prev_significant = None
    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        if tok.type == tokenize.COMMENT:
            continue
        if tok.type == tokenize.STRING and prev_significant in (None, "NEWLINE", "INDENT", "DEDENT"):
            prev_significant = "NEWLINE"          # a bare string statement = docstring
            continue
        if tok.type in (tokenize.NAME, tokenize.NUMBER, tokenize.STRING):
            out.append(tok.string)
        if tok.type not in (tokenize.NL, tokenize.COMMENT):
            prev_significant = tokenize.tok_name[tok.type]
    return out


def test_discovery_module_cannot_emit_the_output_opcode():
    toks = _code_tokens(disco)
    assert "encode_output" not in toks and "all_off" not in toks and "CMD_OUTPUT" not in toks
    assert "encode_all_off" not in toks and "captured_probe_frame" not in toks
    assert not any(t.lower() in ("0x08", "0x8", "8") for t in toks if t.startswith("0x"))
    assert not any("\x08" in t or "" in t for t in toks if t.startswith(("b", "'", '"')))
    from engine import controller_identify
    toks2 = _code_tokens(controller_identify)
    assert "encode_output" not in toks2 and "send_output" not in toks2 and "ICANClient" not in toks2
    # The only frame builder discovery names is the read-only probe.
    assert "safe_probe_frame" in toks and proto.safe_probe_frame()[0] == proto.CMD_CHANNEL


def test_real_socket_sweep_accepts_only_the_valid_gateway():
    async def run():
        with FakeICANGateway() as gw, FakeICANGateway(faults=FakeFaults(malformed=True)) as junk:
            rep = await disco.discover(candidate_ips=["127.0.0.3", "127.0.0.1", "127.0.0.2"],
                                       gateway_port=gw.port, local_port=0, timeout=0.5, arp_first=False)
            junk_rep = await disco.discover(candidate_ips=["127.0.0.1"], gateway_port=junk.port,
                                            local_port=0, timeout=0.4, arp_first=False)
            return rep, junk_rep, list(gw.received)
    rep, junk_rep, received = asyncio.run(run())
    assert rep.gateway is not None and rep.gateway.ip == "127.0.0.1"
    assert [c.ip for c in rep.candidates if c.accepted] == ["127.0.0.1"]
    assert rep.local_port_fallback is False
    assert junk_rep.gateway is None and "wrong length" in junk_rep.candidates[0].reason
    assert all(f[0] == proto.CMD_CHANNEL for f in received)


def test_busy_local_port_is_reported_not_squatted():
    import socket
    squatter = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    squatter.bind(("", 0))
    busy = squatter.getsockname()[1]
    try:
        async def run():
            with FakeICANGateway() as gw:
                return await disco.discover(candidate_ips=["127.0.0.1"], gateway_port=gw.port,
                                            local_port=busy, timeout=0.4, arp_first=False)
        rep = asyncio.run(run())
    finally:
        squatter.close()
    assert rep.local_port_fallback is True and rep.local_port_used != busy
    assert "busy" in rep.note
    # No SO_REUSEADDR anywhere in discovery — that is what made a busy port look free.
    assert "setsockopt" not in inspect.getsource(disco.open_probe_socket)
    assert "setsockopt" not in inspect.getsource(disco.SharedProber)
    assert "setsockopt" not in inspect.getsource(disco._udp_probe)


# ── an active fountain-control connection is never interrupted ────────────────
def test_active_control_connection_is_never_interrupted_by_a_scan():
    async def run():
        with FakeICANGateway() as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1", gateway_port=gw.port,
                                             local_port=0, timeout=0.5))
            assert await conn.connect() and conn.state == ConnectionState.CONNECTED
            before = len(gw.received)
            bound = conn.cfg.local_port                    # the port control OWNS

            rep = await disco.discover(candidate_ips=["127.0.0.1", "127.0.0.9"],
                                       gateway_port=gw.port, local_port=bound, timeout=0.3,
                                       arp_first=False, control_status_provider=conn.status)
            during = len(gw.received)
            still_ok = await conn.probe()                  # the control link still works
            status = conn.status()
            await conn.close()
            return rep, before, during, still_ok, status
    rep, before, during, still_ok, status = asyncio.run(run())
    assert rep.control_owns_port is True
    assert during == before, "discovery must not send while control owns the port"
    assert rep.gateway is not None and rep.gateway.ip == "127.0.0.1"
    assert rep.gateway.source == "control_status" and rep.gateway.accepted is True
    assert still_ok is True and status["verified"] is True
    assert status["state"] == "connected"
    found, diag = ican_controllers_from_report(rep)
    assert [d.ip for d in found] == ["127.0.0.1"] and diag["control_owns_port"]


def test_unverified_control_connection_reports_no_gateway():
    rep = asyncio.run(disco.discover(
        candidate_ips=["10.0.0.2"], local_port=2002,
        control_status_provider=lambda: {"state": "connected", "local_port": 2002,
                                         "gateway_ip": "10.0.0.2", "gateway_port": 200,
                                         "verified": False}))
    assert rep.control_owns_port and rep.gateway is None
    assert rep.candidates[0].accepted is False
    assert ican_controllers_from_report(rep)[0] == []


def test_default_control_status_reads_the_fountain_control_manager_without_touching_it():
    from engine.controller_identify import _default_control_status
    from api.routes import ican_routes
    assert _default_control_status() is None or isinstance(_default_control_status(), dict)
    # ican_routes still exposes exactly the manager the Fountain Control panel uses.
    assert hasattr(ican_routes, "_manager") and hasattr(ican_routes, "_conn")


def test_discovery_and_control_paths_are_not_shared_code():
    """Discovery must not import or call the proven transport."""
    import re
    src = inspect.getsource(disco)
    imports = re.findall(r"^\s*(?:from|import)\s+([\w.]+)", src, re.M)
    assert not any("ican_reference_client" in m or "ican_connection" in m for m in imports), imports
    assert "ICANClient" not in _code_tokens(disco) and "ICANConnection" not in _code_tokens(disco)
