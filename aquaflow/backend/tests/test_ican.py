"""
I-CAN protocol codec, discovery, and connection-manager tests.

Covers the required scenarios: codec round-trips and capture test vectors; discovery
accepts ONLY a protocol-valid reply; discovery/connect send no output; reconnect does
not activate outputs; the output path is gated/rate-limited/audited; a subnet change
from 192.168.5.x to another private subnet still resolves; and integration against a
real fake UDP gateway including timeout/malformed/delayed/wrong-source/duplicate faults.

Follows the repo convention: sync test functions drive async code via asyncio.run().
"""
import asyncio

from engine import ican_protocol as proto
from engine import ican_discovery as disco
from engine.ican_connection import ICANConnection, ICANConfig, ConnectionState
from engine.fake_ican_gateway import FakeICANGateway, FakeFaults


# ── codec ────────────────────────────────────────────────────────────────────
def test_frame_length_and_safe_probe():
    f = proto.safe_probe_frame()
    assert len(f) == proto.FRAME_LEN == 13
    assert f[0] == proto.CMD_OUTPUT
    assert proto.channels_from_mask(f[5:10]) == []       # SAFE probe drives nothing


def test_channel_mask_roundtrip():
    chans = [1, 9, 17, 25, 40]
    assert proto.channels_from_mask(proto.mask_from_channels(chans)) == chans


def test_capture_vector_parses_as_reply():
    # GW->PC : 08 01 00 00 00 87 80 0B A5 B5 AF AD 0A
    gw = bytes.fromhex("080100000087800BA5B5AFAD0A")
    assert len(gw) == 13
    p = proto.parse_response(gw)
    assert p.command == proto.CMD_OUTPUT
    assert p.is_reply is True
    assert p.trailer == gw[10:13]                        # unknown bytes preserved


def test_validate_accepts_signature_rejects_junk():
    assert proto.validate_gateway_response(bytes.fromhex("0801000000000000000000000000")[:13]).valid
    ok07 = bytes.fromhex("0700000001000000AAAAAA00").ljust(13, b"\0")
    assert proto.validate_gateway_response(ok07).valid
    bad_len = proto.validate_gateway_response(b"\x08\x01\x02")
    assert not bad_len.valid and "length" in bad_len.reason
    bad_cmd = proto.validate_gateway_response(bytes([0x99]) + bytes(12))
    assert not bad_cmd.valid and "signature" in bad_cmd.reason


# ── discovery ────────────────────────────────────────────────────────────────
def _iface(ip):
    return disco.Interface(name="test", ip=ip, prefix=24)


def test_discovery_accepts_only_protocol_valid_reply():
    gateway_ip = "10.7.7.9"

    async def fake_prober(ip, gport, lport, timeout, frame):
        if ip == gateway_ip:
            return (True, FakeICANGateway._valid_reply(frame), 3.2, "validated", False)
        if ip == "10.7.7.50":                              # open port, wrong protocol
            return (False, b"\x99\x99", None, "not an I-CAN reply signature", False)
        return (False, None, None, "no reply (timeout)", False)

    async def run():
        return await disco.discover(
            candidate_ips=[gateway_ip, "10.7.7.50", "10.7.7.99"],
            prober=fake_prober, arp_first=False)

    report = asyncio.run(run())
    assert report.gateway and report.gateway.ip == gateway_ip
    assert report.gateway.confidence == "high"
    # SAFETY INVARIANT: the only accepted candidate is the protocol-valid gateway —
    # an open-but-wrong host is never identified as an I-CAN gateway.
    accepted = [c for c in report.candidates if c.accepted]
    assert [c.ip for c in accepted] == [gateway_ip]


def test_discovery_works_on_a_different_subnet():
    gateway_ip = "172.20.4.2"                              # moved off 192.168.5.x

    async def fake_prober(ip, gport, lport, timeout, frame):
        if ip == gateway_ip:
            return (True, FakeICANGateway._valid_reply(frame), 1.0, "ok", False)
        return (False, None, None, "timeout", False)

    async def run():
        return await disco.discover(interfaces=[_iface("172.20.4.240")],
                                    prober=fake_prober, arp_first=False, concurrency=32)

    report = asyncio.run(run())
    assert report.gateway and report.gateway.ip == gateway_ip


def test_discovery_sends_no_output_frame():
    sent = []

    async def spy_prober(ip, gport, lport, timeout, frame):
        sent.append(frame)
        return (False, None, None, "timeout", False)

    async def run():
        await disco.discover(candidate_ips=["10.0.0.2", "10.0.0.3"],
                             prober=spy_prober, arp_first=False)

    asyncio.run(run())
    assert sent
    for f in sent:
        assert f == proto.safe_probe_frame()
        assert proto.channels_from_mask(f[5:10]) == []


# ── connection manager (dry-run) ─────────────────────────────────────────────
def test_connect_is_readonly_and_reaches_connected():
    async def run():
        conn = ICANConnection(ICANConfig(gateway_ip="10.0.0.2", dry_run=True))
        ok = await conn.connect()
        return ok, conn
    ok, conn = asyncio.run(run())
    assert ok and conn.state == ConnectionState.CONNECTED
    assert conn.status()["output_enabled"] is False


def test_output_refused_until_enabled_and_confirmed():
    async def run():
        conn = ICANConnection(ICANConfig(gateway_ip="10.0.0.2", dry_run=True))
        await conn.connect()
        r1 = await conn.send_output(1, [1])                       # not enabled
        conn.enable_output(True)
        r2 = await conn.send_output(1, [1])                       # not confirmed
        r3 = await conn.send_output(1, [1], confirmed=True)       # ok
        return r1, r2, r3, conn
    r1, r2, r3, conn = asyncio.run(run())
    assert (r1, r2, r3) == (False, False, True)
    assert any(r["result"] == "dry-run OK" for r in conn.audit_log)
    assert any("REFUSED" in r["result"] for r in conn.audit_log)


def test_reconnect_does_not_activate_outputs():
    async def run():
        conn = ICANConnection(ICANConfig(gateway_ip="10.0.0.2", dry_run=True))
        await conn.connect()
        conn.enable_output(True)
        await conn.send_output(2, [3], confirmed=True)
        await conn._on_loss("gateway lost")
        state_after_loss = conn.state
        last_out = conn._last_output
        before = sum(1 for r in conn.audit_log
                     if r["action"] == "send_output" and r["result"] == "dry-run OK")
        await conn.connect()                                  # reconnect
        after = sum(1 for r in conn.audit_log
                    if r["action"] == "send_output" and r["result"] == "dry-run OK")
        return state_after_loss, last_out, before, after
    state_after_loss, last_out, before, after = asyncio.run(run())
    assert state_after_loss == ConnectionState.RECONNECTING
    assert last_out is None                                   # nothing to auto-resend
    assert after == before                                   # reconnect emitted no output


def test_output_rate_limit_and_duplicate_suppression():
    async def run():
        conn = ICANConnection(ICANConfig(gateway_ip="10.0.0.2", dry_run=True,
                                         output_min_interval=0.05))
        await conn.connect()
        conn.enable_output(True)
        a = await conn.send_output(1, [1], confirmed=True)
        b = await conn.send_output(1, [1], confirmed=True)    # identical, immediate
        return a, b, conn
    a, b, conn = asyncio.run(run())
    assert a is True and b is False
    assert any("SUPPRESSED" in r["result"] for r in conn.audit_log)


# ── integration against the real fake UDP gateway ────────────────────────────
def test_integration_real_socket_probe():
    async def run():
        with FakeICANGateway() as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.5))
            ok = await conn.connect()
            recv = list(gw.received)
            await conn.close()
            return ok, conn.state, recv
    ok, state, recv = asyncio.run(run())
    assert ok and state == ConnectionState.DISCONNECTED
    assert recv and all(len(r) == 13 for r in recv)
    assert all(proto.channels_from_mask(r[5:10]) == [] for r in recv)


def test_integration_timeout_silent_gateway():
    async def run():
        with FakeICANGateway(faults=FakeFaults(silent=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.2, retries=1))
            ok = await conn.connect()
            return ok, conn.state
    ok, state = asyncio.run(run())
    assert ok is False and state == ConnectionState.ERROR


def test_integration_malformed_reply_rejected():
    async def run():
        with FakeICANGateway(faults=FakeFaults(malformed=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.2, retries=1))
            return await conn.connect()
    assert asyncio.run(run()) is False


def test_integration_wrong_source_port_ignored():
    async def run():
        with FakeICANGateway(faults=FakeFaults(wrong_source_port=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.2, retries=1))
            return await conn.connect()
    assert asyncio.run(run()) is False


def test_integration_duplicate_reply_still_connects():
    async def run():
        with FakeICANGateway(faults=FakeFaults(duplicate=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.3))
            return await conn.connect()
    assert asyncio.run(run()) is True


def test_integration_delayed_reply_within_timeout():
    async def run():
        with FakeICANGateway(faults=FakeFaults(delay_s=0.1)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.5, retries=2))
            return await conn.connect()
    assert asyncio.run(run()) is True
