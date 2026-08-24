#!/usr/bin/env python3
"""
validate_fountain_run.py — AF-ICAN-003

Proves the end-to-end fountain control path:

    Show commands -> ProtocolBus -> safety gate -> ICANDriver -> ICANConnection
                  -> REAL UDP socket -> I-CAN gateway -> relay channels

WHAT IS REAL HERE AND WHAT IS NOT — read this before quoting any result
=======================================================================
Every layer in that chain is the production code path. Frames are encoded by the
real codec, pushed through the real safety gate, and transmitted from a real UDP
socket. The receiving gateway is `FakeICANGateway`: a separate thread holding its
own real UDP socket, which parses what arrives and records the exact bytes.

So this proves, on this machine, with no hardware present:
    * the runtime can connect to an I-CAN gateway,
    * commands reach the wire as correctly-encoded 13-byte frames,
    * channels turn on, off, and sequence in the right order,
    * a stop actually clears the channels,
    * a comms fault does not wedge or crash the runtime.

It does NOT prove that a physical relay closes or that water moves. That last hop
requires the site cabinet (observed at 192.168.5.2) and is what the commissioning
flag exists to gate. The 0x08 output semantics are capture-derived, not yet
confirmed against the real gateway — see engine/ican_protocol.py.

Run:  python validate_fountain_run.py
Exit: 0 = all checks passed, 1 = something failed
"""
from __future__ import annotations

import asyncio
import sys

# ShowEngine.start() prints a non-ASCII status line. On a stock Windows console
# (cp1252) that raises UnicodeEncodeError and takes the whole run down before any
# check executes, so force a codec that can carry it.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass  # already suitable, or not reconfigurable — not worth failing over

from engine import ican_protocol as proto
from engine.fake_ican_gateway import FakeICANGateway, FakeFaults
from engine.ican_connection import ICANConfig, ICANConnection, ICANDriver
from engine.protocol_bus import ProtocolBus
from engine.show_engine import ShowEngine
from safety.safety_kernel import SafetyKernel, SafetyState


PASS, FAIL = [], []


def check(name: str, ok: bool, detail: str = ""):
    (PASS if ok else FAIL).append(name)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}{(' — ' + detail) if detail else ''}")
    return ok


# ── A fountain that exists only as configuration ─────────────────────────────
# Four relay channels in group 0, exactly as ChannelMap.to_device_registry() emits.
FOUNTAIN = [
    {"device_id": "jet-1", "device_type": "pump",     "ican_group": 0, "ican_channel": 1, "safety_max": 1.0},
    {"device_id": "jet-2", "device_type": "pump",     "ican_group": 0, "ican_channel": 2, "safety_max": 1.0},
    {"device_id": "jet-3", "device_type": "pump",     "ican_group": 0, "ican_channel": 3, "safety_max": 1.0},
    {"device_id": "wash",  "device_type": "lighting", "ican_group": 0, "ican_channel": 4, "safety_max": 1.0},
]


def cmd(device_id: str, intensity: float, dtype: str = "pump") -> dict:
    return {"device_id": device_id, "type": dtype, "intensity": intensity}


def sent_output_frames(gw: FakeICANGateway) -> list[bytes]:
    """Only the 0x08 OUTPUT frames — probes and keepalives are not control."""
    return [f for f in gw.received
            if len(f) == proto.FRAME_LEN and f[0] == proto.CMD_OUTPUT]


def channels_of(frame: bytes) -> list[int]:
    return proto.channels_from_mask(frame[5:10])


async def build(gw_port: int):
    """Wire the real runtime stack against the gateway under test."""
    kernel = SafetyKernel()
    # Drive the kernel from BOOT to SAFE_IDLE the way the runtime does, then arm.
    for _ in range(8):
        kernel._tick()
    kernel.update_inputs(operator_arm=True)
    kernel.arm()
    # The kernel recomputes its permit and per-subsystem enables on tick, so ARM only
    # takes effect on the next one. Without this the state reads ARMED while the permit
    # is still False and every output is silently gated to zero.
    kernel._tick()

    conn = ICANConnection(ICANConfig(
        gateway_ip="127.0.0.1",
        gateway_port=gw_port,
        local_port=0,          # ephemeral: the fixed 2002 may be busy on a dev box
        timeout=0.4,
        output_min_interval=0.0,   # no artificial pacing inside a test
    ))
    connected = await conn.connect()
    driver = ICANDriver(conn)

    bus = ProtocolBus()             # not primary: this is a verification instance
    bus.set_safety_kernel(kernel) if hasattr(bus, "set_safety_kernel") else None
    bus._safety_kernel = kernel
    routed = bus.attach_ican(driver, FOUNTAIN)
    return kernel, conn, driver, bus, connected, routed


async def main() -> int:
    print(__doc__.split("Run:")[0])
    print("=" * 78)

    with FakeICANGateway() as gw:
        kernel, conn, driver, bus, connected, routed = await build(gw.port)

        # ── 1. CONNECT ────────────────────────────────────────────────────────
        print("\n1. Connect to the gateway")
        check("gateway connection established", connected, f"state={conn.state.value}")
        check("all 4 fountain channels routed onto the bus", routed == 4, f"routed={routed}")
        check("safety kernel armed (master permit granted)",
              kernel.outputs.permit and kernel.state == SafetyState.ARMED,
              f"state={kernel.state.value} permit={kernel.outputs.permit}")

        # ── 2. OUTPUT REFUSED UNTIL ARMED ────────────────────────────────────
        print("\n2. Output path is disarmed by default")
        before = len(sent_output_frames(gw))
        await bus.send_batch([cmd("jet-1", 1.0)])
        await asyncio.sleep(0.05)
        check("a command before arming emits NOTHING to the gateway",
              len(sent_output_frames(gw)) == before,
              "the driver refuses until enable_output(True)")

        # Arm the output path deliberately — the second, separate gate.
        conn.enable_output(True)

        # ── 3. CHANNEL ON ────────────────────────────────────────────────────
        print("\n3. Channel ON")
        await bus.send_batch([cmd("jet-1", 1.0)])
        await asyncio.sleep(0.08)
        frames = sent_output_frames(gw)
        ok = len(frames) >= 1 and channels_of(frames[-1]) == [1]
        check("jet-1 ON reaches the wire as channel 1",
              ok, f"frame={proto.hexdump(frames[-1]) if frames else 'none'}")
        check("frame is a well-formed 13-byte 0x08 output frame",
              bool(frames) and len(frames[-1]) == 13 and frames[-1][0] == 0x08)

        # ── 4. CHANNEL OFF ───────────────────────────────────────────────────
        print("\n4. Channel OFF")
        await bus.send_batch([cmd("jet-1", 0.0)])
        await asyncio.sleep(0.08)
        frames = sent_output_frames(gw)
        check("jet-1 OFF clears the channel mask", channels_of(frames[-1]) == [],
              f"frame={proto.hexdump(frames[-1])}")

        # ── 5. SEVERAL CHANNELS IN SEQUENCE ──────────────────────────────────
        print("\n5. Three jets fired in sequence")
        seq_start = len(sent_output_frames(gw))
        for jet in ("jet-1", "jet-2", "jet-3"):
            await bus.send_batch([cmd(jet, 1.0)])
            await asyncio.sleep(0.05)
            await bus.send_batch([cmd(jet, 0.0)])
            await asyncio.sleep(0.05)
        seq = sent_output_frames(gw)[seq_start:]
        observed = [channels_of(f) for f in seq]
        expected = [[1], [], [2], [], [3], []]
        check("channels actuate in the commanded order",
              observed == expected, f"observed={observed}")

        # ── 6. SIMULTANEOUS CHANNELS IN ONE FRAME ────────────────────────────
        print("\n6. Multiple channels in one batch")
        mark = len(sent_output_frames(gw))
        await bus.send_batch([cmd("jet-1", 1.0), cmd("jet-2", 1.0),
                              cmd("wash", 1.0, "lighting")])
        await asyncio.sleep(0.08)
        after = sent_output_frames(gw)[mark:]
        check("one batch produces exactly ONE frame per group",
              len(after) == 1, f"frames={len(after)}")
        check("that frame carries all three channels together",
              bool(after) and channels_of(after[-1]) == [1, 2, 4],
              f"channels={channels_of(after[-1]) if after else None}")

        # ── 7. SAFE STOP ─────────────────────────────────────────────────────
        print("\n7. Safe stop")
        await bus.blackout()
        await asyncio.sleep(0.08)
        frames = sent_output_frames(gw)
        check("stop sends an all-off frame", channels_of(frames[-1]) == [],
              f"frame={proto.hexdump(frames[-1])}")
        check("desired state is cleared, so nothing re-asserts after a stop",
              all(not v for v in bus._ican_state.values()) if bus._ican_state else True)

        # A stop must be durable: the very next batch must not resurrect channels
        # that were on before it.
        mark = len(sent_output_frames(gw))
        await bus.send_batch([cmd("jet-1", 0.0)])
        await asyncio.sleep(0.06)
        resurrected = [channels_of(f) for f in sent_output_frames(gw)[mark:] if channels_of(f)]
        check("no channel re-asserts itself after the stop", not resurrected,
              f"unexpected={resurrected}")

        # ── 8. EMERGENCY STOP ────────────────────────────────────────────────
        print("\n8. Emergency stop")
        # Drive some channels first, so the E-stop has something to actually cut.
        await bus.send_batch([cmd("jet-1", 1.0), cmd("jet-2", 1.0)])
        await asyncio.sleep(0.06)
        check("channels are live before the E-stop",
              channels_of(sent_output_frames(gw)[-1]) == [1, 2])

        # The E-stop path itself does not wait for the safety kernel: it blacks the
        # hardware out immediately. That ordering is the point — the permit is the
        # steady-state gate, the blackout is the instant one.
        kernel.emergency_stop("validation drill")
        await bus.emergency_stop()
        await asyncio.sleep(0.06)
        check("E-stop immediately drives an all-off frame",
              channels_of(sent_output_frames(gw)[-1]) == [],
              f"frame={proto.hexdump(sent_output_frames(gw)[-1])}")
        check("kernel is latched in EMERGENCY_STOP",
              kernel.state == SafetyState.EMERGENCY_STOP, f"state={kernel.state.value}")

        # The kernel recomputes its permit on tick, exactly as the running runtime does.
        kernel._tick()
        check("master permit is withdrawn after the E-stop", not kernel.outputs.permit)

        mark = len(sent_output_frames(gw))
        await bus.send_batch([cmd("jet-1", 1.0), cmd("jet-2", 1.0)])
        await asyncio.sleep(0.06)
        after_estop = [channels_of(f) for f in sent_output_frames(gw)[mark:] if channels_of(f)]
        check("commands after the E-stop cannot drive any channel on",
              not after_estop, f"leaked={after_estop}")

    # ── 9. ERROR RECOVERY ────────────────────────────────────────────────────
    # A gateway that has gone silent must not crash or hang the runtime.
    print("\n9. Recovery from a communication fault")
    with FakeICANGateway(faults=FakeFaults(silent=True)) as dead_gw:
        kernel2, conn2, driver2, bus2, connected2, _ = await build(dead_gw.port)
        conn2.enable_output(True)
        check("a silent gateway is reported as NOT connected, not as success",
              not connected2, f"state={conn2.state.value}")
        try:
            await asyncio.wait_for(bus2.send_batch([cmd("jet-1", 1.0)]), timeout=5.0)
            survived = True
        except Exception as e:
            survived = False
            print(f"       exception: {e}")
        check("sending to a dead gateway neither raises nor hangs the runtime", survived)
        try:
            await asyncio.wait_for(bus2.blackout(), timeout=5.0)
            stop_ok = True
        except Exception:
            stop_ok = False
        check("a stop still completes against a dead gateway", stop_ok)
        await conn2.close()

    # Recovering onto a healthy gateway again.
    with FakeICANGateway() as gw3:
        _, conn3, _, bus3, connected3, _ = await build(gw3.port)
        conn3.enable_output(True)
        await bus3.send_batch([cmd("jet-2", 1.0)])
        await asyncio.sleep(0.08)
        frames3 = sent_output_frames(gw3)
        check("the runtime drives a healthy gateway again after a failure",
              bool(frames3) and channels_of(frames3[-1]) == [2],
              f"channels={channels_of(frames3[-1]) if frames3 else None}")
        await conn3.close()

    # ── 10. A REAL SHOW THROUGH THE RUNTIME LOOP ─────────────────────────────
    # Everything above drove the bus directly. This drives the ShowEngine playback
    # loop instead — the same 100 Hz timing authority the product uses — so the
    # proven chain is Show -> Runtime -> Bus -> Comms -> Gateway, not just Bus onward.
    print("\n10. A timed show played by the runtime")
    with FakeICANGateway() as gw4:
        kernel4, conn4, driver4, bus4, _, _ = await build(gw4.port)
        conn4.enable_output(True)

        engine = ShowEngine()
        await engine.start(device_manager=None, protocol_bus=bus4)
        engine.load_show({
            "show": {"id": "fountain-proof", "name": "Fountain Proof", "duration": 0.9,
                     "loop": False},
            "timelineTracks": [
                {"id": "t1", "deviceId": "jet-1", "type": "pump",
                 "clips": [{"id": "c1", "start": 0.00, "end": 0.25, "intensity": 100}]},
                {"id": "t2", "deviceId": "jet-2", "type": "pump",
                 "clips": [{"id": "c2", "start": 0.30, "end": 0.55, "intensity": 100}]},
                {"id": "t3", "deviceId": "jet-3", "type": "pump",
                 "clips": [{"id": "c3", "start": 0.60, "end": 0.85, "intensity": 100}]},
            ],
        })
        check("show accepted by the runtime", engine.show_state.duration >= 0.85,
              f"duration={engine.show_state.duration}")

        started = await engine.play()
        check("runtime started playback", started, f"error={engine.last_error or '-'}")

        # Let the show run to completion; the loop stops itself at the end.
        await asyncio.sleep(1.3)

        frames4 = sent_output_frames(gw4)
        seq = [channels_of(f) for f in frames4]
        # Collapse consecutive duplicates: the loop re-evaluates at 100 Hz but the bus
        # only emits on change, so this should already be a clean transition list.
        check("runtime emitted frames without a manual send", len(frames4) > 0,
              f"frames={len(frames4)}")
        check("jets fired in timeline order 1 -> 2 -> 3",
              [s for s in seq if s] == [[1], [2], [3]],
              f"observed={seq}")
        check("show ended with all channels off", seq[-1] == [] if seq else False,
              f"final={seq[-1] if seq else None}")
        check("runtime returned to a stopped state",
              engine.show_state.state.value != "playing",
              f"state={engine.show_state.state.value}")

        await engine.stop()
        await conn4.close()

    # ── Verdict ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 78)
    print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed")
    if FAIL:
        for f in FAIL:
            print(f"   FAILED: {f}")
    else:
        print("Aquaflow drove a fountain end to end: connect, on, off, sequence,")
        print("simultaneous channels, safe stop, safety veto, and fault recovery —")
        print("with real frames on a real socket.")
        print("\nNOT PROVEN HERE: physical relay closure / water. That needs the site")
        print("cabinet and is gated by AQUAFLOW_HARDWARE_COMMISSIONED.")
    print("=" * 78)
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
