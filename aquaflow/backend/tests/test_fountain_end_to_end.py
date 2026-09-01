"""
AF-ICAN-003 — end-to-end fountain control regressions.

The full demonstration lives in validate_fountain_run.py. These are the behaviours
that must never silently regress, pinned as tests: the I-CAN route onto the output
bus, the frame that reaches the wire, the re-send after a rejected frame, and the
release that turns a device off when its clip ends.

Every check drives real code over a real UDP socket to engine.fake_ican_gateway.
"""
import asyncio

import pytest

from engine import ican_protocol as proto
from engine.fake_ican_gateway import FakeICANGateway
from engine.ican_connection import ICANConfig, ICANConnection, ICANDriver
from engine.protocol_bus import PROTOCOL_SUPPORT, ProtocolBus
from engine.show_engine import ShowEngine
from safety.safety_kernel import SafetyKernel


FOUNTAIN = [
    {"device_id": "jet-1", "ican_group": 0, "ican_channel": 1, "safety_max": 1.0},
    {"device_id": "jet-2", "ican_group": 0, "ican_channel": 2, "safety_max": 1.0},
    {"device_id": "jet-3", "ican_group": 0, "ican_channel": 3, "safety_max": 1.0},
]


def armed_kernel() -> SafetyKernel:
    k = SafetyKernel()
    for _ in range(8):
        k._tick()
    k.update_inputs(operator_arm=True)
    k.arm()
    k._tick()          # the permit is recomputed on tick, not on arm()
    return k


async def wired(gw_port: int, *, arm_output: bool = True):
    conn = ICANConnection(ICANConfig(
        gateway_ip="127.0.0.1", gateway_port=gw_port, local_port=0,
        timeout=0.4, output_min_interval=0.0,
    ))
    await conn.connect()
    if arm_output:
        conn.enable_output(True)
    bus = ProtocolBus()
    bus._safety_kernel = armed_kernel()
    bus.attach_ican(ICANDriver(conn), FOUNTAIN)
    return conn, bus


def outputs(gw) -> list[bytes]:
    return [f for f in gw.received if len(f) == proto.FRAME_LEN and f[0] == proto.CMD_OUTPUT]


def channels(frame: bytes) -> list[int]:
    return proto.channels_from_mask(frame[5:10])


def cmd(device_id, intensity, dtype="pump"):
    return {"device_id": device_id, "type": dtype, "intensity": intensity}


def test_ican_is_a_declared_protocol():
    assert PROTOCOL_SUPPORT.get("ican") == "REAL"


def test_channel_on_reaches_the_wire():
    async def run():
        with FakeICANGateway() as gw:
            conn, bus = await wired(gw.port)
            await bus.send_batch([cmd("jet-1", 1.0)])
            await asyncio.sleep(0.05)
            frames = outputs(gw)
            assert frames, "no output frame reached the gateway"
            assert len(frames[-1]) == proto.FRAME_LEN
            assert frames[-1][0] == proto.CMD_OUTPUT
            assert channels(frames[-1]) == [1]
            await conn.close()
    asyncio.run(run())


def transitions(frames):
    """The sequence of distinct output states, collapsing streamed repeats.

    The output state is streamed continuously while armed (each frame carries absolute
    state, exactly as the vendor software sends it), so the raw frame list is mostly
    repetition. What carries the information is where the state CHANGES.
    """
    out = []
    for f in frames:
        c = channels(f)
        if not out or out[-1] != c:
            out.append(c)
    return out


def test_one_frame_per_group_per_batch():
    """I-CAN carries a whole group's bitmask in one frame; emitting per device would
    make each command clear the ones before it."""
    async def run():
        with FakeICANGateway() as gw:
            conn, bus = await wired(gw.port)
            before = len(outputs(gw))
            await bus.send_batch([cmd("jet-1", 1.0), cmd("jet-2", 1.0), cmd("jet-3", 1.0)])
            await asyncio.sleep(0.05)
            produced = outputs(gw)[before:]
            assert produced, "no frame emitted for the batch"
            # Every frame carries the whole group. A per-device emission would put
            # [1] and [1, 2] on the wire on the way to [1, 2, 3], each one clearing
            # the jets before it. Repeats of the final state are the stream, and fine.
            assert {tuple(channels(f)) for f in produced} == {(1, 2, 3)}
            await conn.close()
    asyncio.run(run())


def test_rejected_frame_is_retried_not_forgotten():
    """A dropped frame must leave the group dirty. The frame is absolute state, so
    treating an unsent group as clean would desynchronise the bus from the gateway
    and leave a channel stuck until something unrelated changed it."""
    async def run():
        with FakeICANGateway() as gw:
            # Output NOT armed: the driver refuses, so the send fails.
            conn, bus = await wired(gw.port, arm_output=False)
            # connect() sends a probe, which is itself a 0x08 frame — count from after it
            # so this measures control output only.
            base = len(outputs(gw))
            await bus.send_batch([cmd("jet-1", 1.0)])
            await asyncio.sleep(0.05)
            assert len(outputs(gw)) == base, "a disarmed driver must not emit"
            assert 0 in bus._ican_dirty, "the group must stay dirty after a refused send"

            # Arm and issue the same command: it must now actually go out.
            conn.enable_output(True)
            await bus.send_batch([cmd("jet-1", 1.0)])
            await asyncio.sleep(0.05)
            frames = outputs(gw)
            assert len(frames) > base, "the retried frame never reached the gateway"
            assert channels(frames[-1]) == [1]
            await conn.close()
    asyncio.run(run())


def test_blackout_clears_state_so_nothing_re_asserts():
    async def run():
        with FakeICANGateway() as gw:
            conn, bus = await wired(gw.port)
            await bus.send_batch([cmd("jet-1", 1.0), cmd("jet-2", 1.0)])
            await asyncio.sleep(0.05)
            await bus.blackout()
            await asyncio.sleep(0.05)
            assert channels(outputs(gw)[-1]) == []
            mark = len(outputs(gw))
            await bus.send_batch([cmd("jet-1", 0.0)])
            await asyncio.sleep(0.05)
            assert not [c for f in outputs(gw)[mark:] if (c := channels(f))]
            await conn.close()
    asyncio.run(run())


def test_safety_permit_blocks_output():
    async def run():
        with FakeICANGateway() as gw:
            conn, bus = await wired(gw.port)
            bus._safety_kernel.emergency_stop("test")
            bus._safety_kernel._tick()
            mark = len(outputs(gw))
            await bus.send_batch([cmd("jet-1", 1.0)])
            await asyncio.sleep(0.05)
            assert not [c for f in outputs(gw)[mark:] if (c := channels(f))]
            await conn.close()
    asyncio.run(run())


def test_ican_channel_counts_as_a_hardware_mapping():
    """show_engine.play() blocks unmapped fixtures on commissioned hardware. A fixture
    on an I-CAN relay IS mapped; without this every relay-driven fountain would be
    refused a start on exactly the hardware it runs on."""
    bus = ProtocolBus()
    bus.attach_ican(driver=None, devices=FOUNTAIN)
    assert bus.unmapped_fixtures([{"id": "jet-1"}]) == []
    assert bus.unmapped_fixtures([{"id": "not-wired"}]) == ["not-wired"]


def test_device_is_released_when_its_clip_ends():
    """The regression that mattered most: every output protocol here is stateful, so
    'no command' means 'hold'. Without an explicit release a jet stayed on for the rest
    of the show and later clips added to it instead of replacing it."""
    async def run():
        with FakeICANGateway() as gw:
            conn, bus = await wired(gw.port)
            engine = ShowEngine()
            await engine.start(device_manager=None, protocol_bus=bus)
            engine.load_show({
                "show": {"id": "s", "name": "seq", "duration": 0.9, "loop": False},
                "timelineTracks": [
                    {"id": "t1", "deviceId": "jet-1", "type": "pump",
                     "clips": [{"id": "c1", "start": 0.00, "end": 0.25, "intensity": 100}]},
                    {"id": "t2", "deviceId": "jet-2", "type": "pump",
                     "clips": [{"id": "c2", "start": 0.30, "end": 0.55, "intensity": 100}]},
                    {"id": "t3", "deviceId": "jet-3", "type": "pump",
                     "clips": [{"id": "c3", "start": 0.60, "end": 0.85, "intensity": 100}]},
                ],
            })
            assert await engine.play()
            await asyncio.sleep(1.3)

            fired = [c for c in transitions(outputs(gw)) if c]
            assert fired == [[1], [2], [3]], f"jets did not fire one at a time: {fired}"
            assert channels(outputs(gw)[-1]) == [], "show did not end with everything off"
            await engine.stop()
            await conn.close()
    asyncio.run(run())


def test_a_new_show_owes_no_release_to_the_previous_one():
    engine = ShowEngine()
    engine._held_devices = {"jet-1": "pump"}
    engine.load_show({"show": {"id": "s2", "duration": 1.0}, "timelineTracks": []})
    assert engine._held_devices == {}


# ── The operator path, through the HTTP API ─────────────────────────────────
def test_operator_can_attach_and_arm_the_gateway_over_the_api(tmp_path, monkeypatch):
    """
    Discovery and channel mapping alone never reached the cabinet — the bus had no
    I-CAN route. This walks the operator's actual steps over the real API:
    connect -> label a channel -> attach to the output bus -> arm.
    """
    from fastapi.testclient import TestClient
    import api.routes.ican_routes as routes
    from engine.ican_mapping import ChannelMap
    from main import app

    # Keep the assignment out of the real on-disk channel map.
    monkeypatch.setattr(routes, "_channel_map", ChannelMap(path=tmp_path / "map.json"))
    monkeypatch.setattr(routes, "_conn", None)

    with FakeICANGateway() as gw:
        client = TestClient(app)

        r = client.post("/api/ican/connect",
                        json={"gateway_ip": "127.0.0.1", "gateway_port": gw.port,
                              "local_port": 0})
        assert r.status_code == 200, r.text

        # Attaching before any channel is labelled must be refused, not silently empty.
        assert client.post("/api/ican/output/attach").status_code == 409

        r = client.post("/api/ican/map/assign",
                        json={"group": 0, "channel": 1, "label": "Jet 1",
                              "device_type": "pump"})
        assert r.status_code == 200, r.text

        r = client.post("/api/ican/output/attach")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["channels_routed"] == 1
        # Attaching must never imply arming.
        assert body["output_armed"] is False

        # Arming without the confirmation phrase is refused.
        assert client.post("/api/ican/output/arm",
                           json={"enabled": True}).status_code == 400

        r = client.post("/api/ican/output/arm",
                        json={"enabled": True, "confirm": "ARM OUTPUT"})
        assert r.status_code == 200, r.text
        assert r.json()["output_armed"] is True

        # Disarming needs no confirmation — stopping is never gated.
        r = client.post("/api/ican/output/arm", json={"enabled": False})
        assert r.status_code == 200
        assert r.json()["output_armed"] is False


def test_operator_can_toggle_a_channel_and_stop_over_the_api(tmp_path, monkeypatch):
    """The panel's test buttons. Driving a channel must go through the real bus, and an
    unarmed refusal must be reported as a refusal — not as a success the UI then shows
    as a lit button."""
    from fastapi.testclient import TestClient
    import api.routes.ican_routes as routes
    from engine.ican_mapping import ChannelMap
    from main import app
    import app_state

    monkeypatch.setattr(routes, "_channel_map", ChannelMap(path=tmp_path / "m.json"))
    monkeypatch.setattr(routes, "_conn", None)
    app_state.protocol_bus._safety_kernel = armed_kernel()

    with FakeICANGateway() as gw:
        client = TestClient(app)
        client.post("/api/ican/connect",
                    json={"gateway_ip": "127.0.0.1", "gateway_port": gw.port, "local_port": 0})
        client.post("/api/ican/map/assign",
                    json={"group": 0, "channel": 1, "label": "Jet 1", "device_type": "pump"})
        client.post("/api/ican/output/attach")

        # An unknown channel is a 404, not a silent no-op.
        assert client.post("/api/ican/output/channel",
                           json={"device_id": "nope", "on": True}).status_code == 404

        # Not armed yet: the command is accepted but the channel must NOT go live.
        r = client.post("/api/ican/output/channel",
                        json={"device_id": "ican-0-1", "on": True})
        assert r.status_code == 200
        assert r.json()["live_channels"] == [], "channel went live while disarmed"

        client.post("/api/ican/output/arm", json={"enabled": True, "confirm": "ARM OUTPUT"})
        r = client.post("/api/ican/output/channel",
                        json={"device_id": "ican-0-1", "on": True})
        assert r.json()["live_channels"] == [1]

        r = client.post("/api/ican/output/channel",
                        json={"device_id": "ican-0-1", "on": False})
        assert r.json()["live_channels"] == []

        # Stop is always allowed.
        assert client.post("/api/ican/output/stop").status_code == 200
