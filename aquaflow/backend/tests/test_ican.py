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
    # The probe must NOT be the output opcode. It used to be a 0x08 frame relying on an
    # empty mask to be harmless, which meant a subnet scan sprayed the relay-driving
    # opcode at every host. 0x03 is a channel-address poll and carries no mask at all.
    assert f[0] == proto.CMD_CHANNEL
    assert f[0] != proto.CMD_OUTPUT
    assert proto.channels_from_mask(f[5:10]) == []       # SAFE probe drives nothing
    # Byte-for-byte the PC->GW probe seen in the site capture.
    assert f == bytes.fromhex("03000000010000000000000000")


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
        assert f[0] == proto.CMD_CHANNEL                 # never the relay-driving opcode
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


def test_every_command_is_transmitted_none_are_suppressed():
    """The reference client has no rate limit and no duplicate suppression: it transmits
    every command immediately, and the vendor software does the same — the capture shows
    the identical frame repeated back to back. A controller that drops "redundant" frames
    is one that can silently skip the frame that mattered."""
    async def run():
        conn = ICANConnection(ICANConfig(gateway_ip="10.0.0.2", dry_run=True,
                                         output_min_interval=0.05))
        await conn.connect()
        conn.enable_output(True)
        a = await conn.send_output(1, [1], confirmed=True)
        b = await conn.send_output(1, [1], confirmed=True)    # identical, immediate
        return a, b, conn
    a, b, conn = asyncio.run(run())
    assert a is True and b is True
    assert not any("SUPPRESSED" in r["result"] for r in conn.audit_log)
    assert sum(1 for r in conn.audit_log if r["result"] == "dry-run OK") == 2


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


def test_silent_gateway_connects_unverified_and_can_still_drive_output():
    """THE REGRESSION TEST FOR THE REAL FOUNTAIN.

    The site gateway does not acknowledge 0x08 output frames — control is
    fire-and-forget UDP, which is exactly how the proven working client drives it.
    connect() used to demand a reply, drop to ERROR and close the socket, after which
    every send_output was refused with "REFUSED: state error". The hardware could never
    open that gate, so AquaFlow could not run the fountain while a 40-line script could.

    Silence must therefore mean UNVERIFIED, not unusable.
    """
    async def run():
        with FakeICANGateway(faults=FakeFaults(silent=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.2, retries=1))
            ok = await conn.connect()
            conn.enable_output(True)
            sent = await conn.send_output(1, [9, 13], confirmed=True)
            await asyncio.sleep(0.05)
            received = [r for r in gw.received if r[0] == proto.CMD_OUTPUT]
            status = conn.status()
            await conn.close()
            return ok, sent, received, status
    ok, sent, received, status = asyncio.run(run())
    assert ok is True, "a silent gateway must not block connecting"
    assert status["verified"] is False, "and must be reported as unverified"
    assert sent is True, "output must reach the wire without an acknowledgement"
    # The exact bytes the working client puts on the wire for group 1, channels 9 and 13.
    # There may be more than one: the state is STREAMED while armed, so a repeat of the
    # identical frame is correct — every frame carries absolute state.
    assert received, "no output frame reached the wire"
    assert set(received) == {bytes.fromhex("08000000010011000000000000")}


def test_malformed_reply_leaves_the_link_unverified():
    """Junk must never be *called* a validated gateway. That claim now lives in
    `verified` rather than in connect(), so a wrong device is visible to the operator
    instead of silently blocking a link that fire-and-forget control does not need."""
    async def run():
        with FakeICANGateway(faults=FakeFaults(malformed=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.2, retries=1))
            ok = await conn.connect()
            return ok, conn.verified
    ok, verified = asyncio.run(run())
    assert ok is True and verified is False


def test_reply_from_another_source_port_is_accepted():
    """A UDP device that answers from an ephemeral port rather than its command port is
    ordinary. The old filter required source port == 200 and threw away every such reply,
    reporting a perfectly reachable gateway as unverified. The reference client does not
    filter by port at all; neither do we now."""
    async def run():
        with FakeICANGateway(faults=FakeFaults(wrong_source_port=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1",
                                             gateway_port=gw.port, local_port=0,
                                             timeout=0.3, retries=1))
            ok = await conn.connect()
            return ok, conn.verified
    ok, verified = asyncio.run(run())
    assert ok is True and verified is True


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


# ── byte-for-byte parity with the proven working client ──────────────────────
# The reference is ican_client.py, run against the site gateway (192.168.5.2:200 from
# 192.168.5.200:2002) on 31 Aug 2026, where it drove the real fountain. Every frame
# AquaFlow emits must be identical to what that client emits, or "it works from the
# terminal but not from the app" comes straight back.

def test_group_is_big_endian_uint32_like_the_working_client():
    # ican_client.encode_frame: group.to_bytes(4, "big") at bytes[1..4].
    for group in (0, 1, 9, 255, 256, 70000):
        f = proto.encode_output(group, [])
        assert f[1:5] == group.to_bytes(4, "big")
        assert proto.group_from_bytes(f[1:5]) == group
    # The old code wrote `group & 0xFF` into byte[4] alone. Identical below 256, which
    # is why it survived, but group 256 silently drove group 0's relays.
    assert proto.encode_output(256, [1])[1:5] != proto.encode_output(0, [1])[1:5]


def test_frames_match_the_captured_wire_bytes():
    # PC->GW capture vector: group 9, channels 10 and 39.
    assert proto.encode_output(9, [10, 39]) == bytes.fromhex("08000000090002000040000000")
    # ican_client --group 1 --on 9,13  ->  mask byte 1 = 0x11
    assert proto.encode_output(1, [9, 13]) == bytes.fromhex("08000000010011000000000000")
    # all-off for a group is the same frame with an empty mask
    assert proto.encode_all_off(1) == bytes.fromhex("08000000010000000000000000")


def test_channel_mask_matches_the_client_bit_order():
    # ican_client.channels_to_mask: bit i of byte b = channel b*8 + i + 1
    for ch in range(1, 41):
        mask = proto.mask_from_channels([ch])
        byte_i, bit_i = divmod(ch - 1, 8)
        assert mask[byte_i] == (1 << bit_i)
        assert proto.channels_from_mask(mask) == [ch]


def test_out_of_range_channel_is_refused_not_dropped():
    # The client raises; silently dropping would mean a mapped jet that never fires and
    # never errors.
    for bad in (0, 41, 100):
        try:
            proto.mask_from_channels([bad])
        except ValueError:
            continue
        raise AssertionError(f"channel {bad} was accepted")


def test_blackout_turns_off_every_group_driven_not_just_group_zero():
    """The 0x08 frame carries absolute state for ONE group. A blackout that only sent
    group 0 left jets on groups 1 and 9 running — an E-stop that stopped nothing."""
    async def run():
        conn = ICANConnection(ICANConfig(gateway_ip="10.0.0.2", dry_run=True))
        await conn.connect()
        conn.enable_output(True)
        await conn.send_output(1, [1], confirmed=True)
        await conn.send_output(9, [10], confirmed=True)
        await conn.blackout()
        return conn
    conn = asyncio.run(run())
    blacked = [r for r in conn.audit_log if r["action"] == "blackout"]
    groups = {proto.group_from_bytes(bytes.fromhex(r["frame_hex"].replace(" ", ""))[1:5])
              for r in blacked}
    assert {0, 1, 9} <= groups
    for r in blacked:
        frame = bytes.fromhex(r["frame_hex"].replace(" ", ""))
        assert proto.channels_from_mask(frame[5:10]) == []      # every one is all-off


# ── differential test against the hardware-proven client ─────────────────────
# engine/ican_reference_client.py is the script that actually drove the site fountain,
# and it is now the LIVE TRANSPORT — ICANConnection instantiates its ICANClient and calls
# set_channels()/all_off()/poll(). ican_protocol.py still has its own codec (used for
# discovery, parsing and the audit trail), so these tests keep the two honest: if they
# ever diverge, the bytes in the audit log would stop matching the bytes on the wire.

def _reference_client():
    from engine import ican_reference_client as ref
    return ref


def test_aquaflow_frames_are_identical_to_the_reference_client():
    ref = _reference_client()
    assert (proto.CMD_OUTPUT, proto.CMD_CHANNEL, proto.CMD_STATUS_REPLY) == (
        ref.CMD_OUTPUT, ref.CMD_CHANNEL_ADDRESS, ref.CMD_STATUS_REPLY)
    assert proto.FRAME_LEN == 13
    assert proto.MAX_CHANNEL == ref.MASK_BYTES * 8

    cases = [
        (0, []), (0, [1]), (1, []), (1, [9, 13]), (1, [9, 13, 17, 21]),
        (9, [10, 39]), (9, list(range(1, 41))), (255, [40]), (256, [1]),
        (1000, [1, 8, 9, 16, 17, 24, 25, 32, 33, 40]),
    ]
    for group, channels in cases:
        mine = proto.encode_output(group, channels)
        theirs = ref.encode_frame(ref.CMD_OUTPUT, group, ref.channels_to_mask(channels))
        assert mine == theirs, (
            f"group={group} channels={channels}\n"
            f"  aquaflow : {proto.hexdump(mine)}\n"
            f"  reference: {proto.hexdump(theirs)}")

    # the read-only poll
    for group in (0, 1, 9, 17, 25):
        assert proto.encode_channel_address(group) == ref.encode_frame(
            ref.CMD_CHANNEL_ADDRESS, group, bytes(ref.MASK_BYTES))

    # decoding agrees in both directions
    for group, channels in cases:
        frame = proto.encode_output(group, channels)
        decoded = ref.decode_frame(frame)
        assert decoded["cmd"] == proto.CMD_OUTPUT
        assert decoded["group"] == group
        assert decoded["channels"] == sorted(channels)
        assert proto.channels_from_mask(frame[5:10]) == sorted(channels)
        assert proto.group_from_bytes(frame[1:5]) == group


def test_reference_client_rejects_what_aquaflow_rejects():
    ref = _reference_client()
    for bad in (0, 41, 100):
        for fn in (lambda: ref.channels_to_mask([bad]),
                   lambda: proto.mask_from_channels([bad])):
            try:
                fn()
            except ValueError:
                continue
            raise AssertionError(f"channel {bad} accepted")


def test_busy_local_port_fails_loudly_instead_of_pretending():
    """The trap that cost a site visit.

    AquaFlow set SO_REUSEADDR and, if port 2002 was busy, silently bound an ephemeral
    port instead. On Windows SO_REUSEADDR let the bind SUCCEED while the vendor I-CAN
    software still owned 2002 — so AquaFlow showed a healthy connection, logged every
    frame as sent, and the fountain did not move, with no warning anywhere because from
    AquaFlow's side nothing had failed.

    The reference client refuses to start in that situation. So do we now.
    """
    import socket as _socket
    squatter = _socket.socket(_socket.AF_INET, _socket.SOCK_DGRAM)
    squatter.bind(("", 0))
    busy_port = squatter.getsockname()[1]
    try:
        async def run():
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1", gateway_port=9,
                                             local_port=busy_port, timeout=0.1))
            ok = await conn.connect()
            return ok, conn.last_error, conn.state
        ok, err, state = asyncio.run(run())
    finally:
        squatter.close()
    assert ok is False, "a busy local port must not report a successful connection"
    assert state == ConnectionState.ERROR
    assert str(busy_port) in err and "I-CAN app" in err, err


def test_the_live_transport_is_the_reference_client():
    """ICANConnection must not grow its own socket again. If someone replaces the
    delegation with a hand-rolled sendto, this fails."""
    import inspect
    from engine import ican_connection as mod
    from engine.ican_reference_client import ICANClient
    assert mod.ICANClient is ICANClient
    src = inspect.getsource(mod.ICANConnection)
    assert "self._client.set_channels(" in src, "output must go through the client"
    assert "self._client.all_off(" in src, "blackout must go through the client"
    # Check the CALLS, not the prose — the docstrings explain why SO_REUSEADDR is gone.
    assert "setsockopt(" not in src, "SO_REUSEADDR is what made a busy port look free"
    assert "_sock.sendto(" not in src, "no hand-rolled sends alongside the client"


def test_output_state_is_streamed_continuously_while_armed():
    """The original software does not send one frame and stop — it STREAMS the output
    state (19,152 OUTPUT frames in the site capture, ~250 ms apart). A relay controller
    with an output watchdog drops its relays when that stream stops, which looks exactly
    like "AquaFlow said it sent the frame and nothing happened".

    Art-Net in this same codebase already re-sends on a keepalive. I-CAN did not.
    """
    async def run():
        with FakeICANGateway(faults=FakeFaults(silent=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1", gateway_port=gw.port,
                                             local_port=0, timeout=0.1,
                                             refresh_interval=0.02))
            await conn.connect()
            conn.enable_output(True)
            await conn.send_output(0, [9], confirmed=True)
            await asyncio.sleep(0.25)                 # ~12 refreshes at 50 Hz
            armed = list(gw.received)
            status = conn.status()
            conn.enable_output(False)
            await asyncio.sleep(0.1)
            after_disarm = len(gw.received)
            await asyncio.sleep(0.15)                 # stream must stay stopped
            await conn.close()
            return armed, status, after_disarm, len(gw.received)

    armed, status, after_disarm, final = asyncio.run(run())
    outputs = [f for f in armed if f[0] == proto.CMD_OUTPUT]
    assert len(outputs) > 3, f"state was not streamed — only {len(outputs)} frame(s)"
    # Every streamed frame is the same absolute state, exactly as the vendor streams it.
    assert set(outputs) == {bytes.fromhex("08000000000001000000000000")}
    assert status["streaming"] is True
    assert status["frames_streamed"] > 0
    # Disarming stops the stream and it stays stopped.
    assert final == after_disarm, "stream kept running after disarm"


def test_blackout_streams_off_rather_than_going_silent():
    """Silence is not an off command. If the controller latches its last state, simply
    stopping would leave the relays closed — the stream has to keep saying 'off'."""
    async def run():
        with FakeICANGateway(faults=FakeFaults(silent=True)) as gw:
            conn = ICANConnection(ICANConfig(gateway_ip="127.0.0.1", gateway_port=gw.port,
                                             local_port=0, timeout=0.1,
                                             refresh_interval=0.02))
            await conn.connect()
            conn.enable_output(True)
            await conn.send_output(0, [9], confirmed=True)
            await asyncio.sleep(0.1)
            await conn.blackout()
            gw.received.clear()
            await asyncio.sleep(0.15)
            tail = [f for f in gw.received if f[0] == proto.CMD_OUTPUT]
            await conn.close()
            return tail
    tail = asyncio.run(run())
    assert tail, "nothing streamed after blackout"
    for f in tail:
        assert proto.channels_from_mask(f[5:10]) == [], "blackout must keep streaming OFF"
