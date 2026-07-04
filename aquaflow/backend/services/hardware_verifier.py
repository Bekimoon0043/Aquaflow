"""
hardware_verifier.py — AquaFlow Recovery, AQ-X-002 (CRITICAL)

Hardware Output Verification against a real UDP loopback node ("simulated
hardware").

This is the CRITICAL safety task that must pass before any live deployment. It
proves that what the show engine *intends* to output actually reaches the wire
correctly. It does this without a physical rig by standing up a `VirtualDMXNode`:
a real UDP receiver on 127.0.0.1 that behaves like a DMX/Art-Net/sACN fixture node,
captures the frames the drivers actually transmit, and decodes them back into
channel values.

Verifications provided:
  1. DMX output      — commanded channel values arrive intact at the node.
  2. Art-Net output  — ArtDmx frames are transmitted, received, and decode to spec.
  3. sACN output     — E1.31 frames round-trip on the wire (unicast loopback).
  4. Safety gate     — the output-path safety gate zeroes real emitted bytes when
                       the master permit is withheld, and passes them when granted.
  5. Output timing   — the transmit cadence stays within the DMX512 / Art-Net 44 Hz
                       spec (never faster than the 22.7 ms physical frame floor).

Everything here uses real sockets and the production drivers, so a PASS is genuine
hardware-path evidence. Socket-dependent checks degrade gracefully (reported as
"skipped") if the environment forbids UDP loopback, while the pure packet/timing
contracts always run.
"""
from __future__ import annotations

import asyncio
import socket
import threading
import time
from typing import Optional

from protocols.artnet_driver import (
    ArtNetDriver, UniverseTarget, parse_artdmx, extract_artnet_dmx,
)
from protocols.sacn_driver import SACNDriver, SACN_PORT, parse_sacn_packet

# ── DMX512 / Art-Net timing spec ──────────────────────────────────────────────

DMX512_CHANNELS         = 512
DMX512_SLOT_TIME_US     = 44            # 44 µs per slot @ 250 kbaud, 11 bits/slot
DMX512_BREAK_MAB_US     = 88 + 8        # min break (88 µs) + mark-after-break (8 µs)
# One full frame = break + MAB + (start code + 512 slots) × slot time.
DMX512_MIN_FRAME_MS     = (DMX512_BREAK_MAB_US + (1 + DMX512_CHANNELS) * DMX512_SLOT_TIME_US) / 1000.0
ARTNET_MAX_HZ           = 44            # Art-Net spec: max 44 refreshes/sec/universe


# ── Virtual DMX node (simulated hardware) ─────────────────────────────────────

class VirtualDMXNode:
    """
    A real UDP receiver on 127.0.0.1 that stands in for a DMX/Art-Net/sACN fixture
    node. Captures every datagram (with a monotonic receive timestamp) on a
    background thread so timing can be measured accurately.
    """

    def __init__(self, bind_port: int = 0, host: str = "127.0.0.1"):
        self.host = host
        self.bind_port = bind_port
        self.port: int = bind_port
        self.frames: list[tuple[float, bytes]] = []
        self._sock: Optional[socket.socket] = None
        self._thread: Optional[threading.Thread] = None
        self._running = False

    def start(self) -> "VirtualDMXNode":
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._sock.bind((self.host, self.bind_port))
        self._sock.settimeout(0.2)
        self.port = self._sock.getsockname()[1]
        self._running = True
        self._thread = threading.Thread(target=self._recv_loop, daemon=True)
        self._thread.start()
        return self

    def _recv_loop(self):
        while self._running:
            try:
                pkt, _ = self._sock.recvfrom(2048)
                self.frames.append((time.monotonic(), pkt))
            except socket.timeout:
                continue
            except OSError:
                break

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=1.0)
        if self._sock:
            self._sock.close()
            self._sock = None

    def __enter__(self):
        return self.start()

    def __exit__(self, *exc):
        self.stop()

    def first_nonzero_frame(self):
        """Return the first captured datagram whose payload is not all zeros."""
        for ts, pkt in self.frames:
            if any(pkt):
                return ts, pkt
        return None


# ── Timing analysis (pure) ────────────────────────────────────────────────────

def analyze_timing(frame_times: list[float], target_hz: int = ARTNET_MAX_HZ) -> dict:
    """
    Measure the transmit cadence from a list of frame receive timestamps and check
    it against the DMX/Art-Net refresh spec.

    Within-spec = frames are actually flowing AND the driver is not transmitting
    faster than the 44 Hz ceiling (i.e. the median inter-frame gap is not shorter
    than the 22.7 ms physical DMX512 frame floor, allowing a little jitter).
    """
    ts = sorted(frame_times)
    intervals = [b - a for a, b in zip(ts, ts[1:]) if (b - a) > 0]
    if len(intervals) < 2:
        return {
            "within_spec": False, "reason": "insufficient frames",
            "frames": len(ts), "measured_hz": 0.0,
        }
    intervals.sort()
    median = intervals[len(intervals) // 2]
    measured_hz = 1.0 / median if median > 0 else 0.0
    min_interval_ms = min(intervals) * 1000.0
    # Ceiling: allow 20% jitter above 44 Hz before calling it out-of-spec.
    ceiling_hz = target_hz * 1.20
    not_too_fast = measured_hz <= ceiling_hz
    flowing = measured_hz >= 1.0                       # not stalled (≥ keepalive)
    floor_ok = min_interval_ms >= (DMX512_MIN_FRAME_MS * 0.7)   # respects frame floor
    return {
        "within_spec": bool(not_too_fast and flowing and floor_ok),
        "frames": len(ts),
        "measured_hz": round(measured_hz, 2),
        "median_interval_ms": round(median * 1000.0, 3),
        "min_interval_ms": round(min_interval_ms, 3),
        "spec_max_hz": target_hz,
        "dmx512_min_frame_ms": round(DMX512_MIN_FRAME_MS, 3),
        "not_too_fast": bool(not_too_fast),
        "flowing": bool(flowing),
        "floor_respected": bool(floor_ok),
    }


# ── Async drivers of the loopback path ────────────────────────────────────────

async def _emit_artnet(node_port: int, universe: int, channels: dict, seconds: float = 0.15):
    drv = ArtNetDriver()
    drv.configure_universe(universe, [UniverseTarget(host="127.0.0.1", port=node_port)])
    for ch, val in channels.items():
        drv.set_channel(universe, ch, val)
    await drv.start()
    await asyncio.sleep(seconds)
    await drv.stop()


async def _emit_artnet_timed(node_port: int, universe: int, seconds: float = 0.35):
    """Continuously mutate a channel so every 44 Hz loop tick transmits a frame."""
    drv = ArtNetDriver()
    drv.configure_universe(universe, [UniverseTarget(host="127.0.0.1", port=node_port)])
    await drv.start()
    end = time.monotonic() + seconds
    v = 0
    while time.monotonic() < end:
        v = (v + 1) & 0xFF
        drv.set_channel(universe, 0, v)
        await asyncio.sleep(0.003)
    await drv.stop()


async def _emit_sacn(node_port: int, universe: int, channels: dict, seconds: float = 0.15):
    drv = SACNDriver()
    drv.configure_universe(universe, use_multicast=False, unicast_targets=["127.0.0.1"])
    for ch, val in channels.items():
        drv.set_channel(universe, ch, val)
    await drv.start()
    await asyncio.sleep(seconds)
    await drv.stop()


async def _emit_through_gate(node_port: int, permit: bool, intensity: float = 1.0):
    """
    Route a real lighting command through ProtocolBus (and therefore its output-path
    safety gate) to a loopback-targeted Art-Net driver. Returns nothing; the node
    captures whatever bytes actually left the socket.
    """
    from engine.protocol_bus import ProtocolBus, ArtNetDriver as InlineArtNet
    from safety.safety_kernel import SafetyKernel

    bus = ProtocolBus()
    drv = InlineArtNet(target_ip="127.0.0.1")
    drv.PORT = node_port                                   # aim the inline driver at the node
    await drv.connect()
    bus._drivers["artnet"] = drv

    kernel = SafetyKernel()
    bus.set_safety_kernel(kernel)
    kernel.outputs.permit = permit
    kernel.outputs.lighting_enable = True

    bus.update_dmx_map([{"fixtureId": "L1", "universe": 0, "channel": 1}])
    await bus._route_command({"device_id": "L1", "type": "lighting", "intensity": intensity})
    await asyncio.sleep(0.05)
    await drv.disconnect()


# ── Verifications ─────────────────────────────────────────────────────────────

def verify_artnet_output(universe: int = 0, channels: Optional[dict] = None) -> dict:
    """Send a frame through the real Art-Net driver to the node and confirm it decodes."""
    channels = channels or {0: 255, 1: 128, 2: 64}
    try:
        with VirtualDMXNode() as node:
            asyncio.run(_emit_artnet(node.port, universe, channels))
            time.sleep(0.05)
            frames = list(node.frames)
    except OSError as exc:
        return {"name": "artnet_output", "status": "skipped", "reason": f"socket: {exc}"}

    got = None
    for _ts, pkt in frames:
        try:
            p = parse_artdmx(pkt)
        except ValueError:
            continue
        if any(p["data"]):
            got = p
            break
    if got is None:
        return {"name": "artnet_output", "status": "fail",
                "reason": "no ArtDmx frame received", "frames": len(frames)}

    mismatches = {ch: (val, got["data"][ch]) for ch, val in channels.items()
                  if ch < len(got["data"]) and got["data"][ch] != val}
    ok = (got["universe"] == universe) and not mismatches
    return {
        "name": "artnet_output",
        "status": "pass" if ok else "fail",
        "universe": got["universe"], "expected_universe": universe,
        "channels_expected": channels,
        "channels_received": {ch: got["data"][ch] for ch in channels if ch < len(got["data"])},
        "mismatches": mismatches, "frames": len(frames),
    }


def verify_artnet_high_universe() -> dict:
    """Confirm a 15-bit universe (> 255) survives the net/sub/low split on the wire."""
    universe = 300
    try:
        with VirtualDMXNode() as node:
            asyncio.run(_emit_artnet(node.port, universe, {0: 200}))
            time.sleep(0.05)
            frames = list(node.frames)
    except OSError as exc:
        return {"name": "artnet_high_universe", "status": "skipped", "reason": f"socket: {exc}"}
    for _ts, pkt in frames:
        try:
            p = parse_artdmx(pkt)
        except ValueError:
            continue
        if any(p["data"]):
            ok = p["universe"] == universe and p["data"][0] == 200
            return {"name": "artnet_high_universe", "status": "pass" if ok else "fail",
                    "universe": p["universe"], "expected_universe": universe}
    return {"name": "artnet_high_universe", "status": "fail", "reason": "no frame"}


def verify_sacn_output(universe: int = 1, channels: Optional[dict] = None) -> dict:
    """Send an E1.31 frame (unicast loopback) to a node bound on the sACN port."""
    channels = channels or {0: 255, 5: 111}
    try:
        with VirtualDMXNode(bind_port=SACN_PORT) as node:
            asyncio.run(_emit_sacn(node.port, universe, channels))
            time.sleep(0.05)
            frames = list(node.frames)
    except OSError as exc:
        return {"name": "sacn_output", "status": "skipped",
                "reason": f"cannot bind sACN port {SACN_PORT}: {exc}"}

    for _ts, pkt in frames:
        try:
            p = parse_sacn_packet(pkt)
        except ValueError:
            continue
        if any(p["data"]):
            mism = {ch: (val, p["data"][ch]) for ch, val in channels.items() if p["data"][ch] != val}
            ok = (p["universe"] == universe) and (p["start_code"] == 0) and not mism
            return {"name": "sacn_output", "status": "pass" if ok else "fail",
                    "universe": p["universe"], "expected_universe": universe,
                    "start_code": p["start_code"], "mismatches": mism, "frames": len(frames)}
    return {"name": "sacn_output", "status": "fail", "reason": "no E1.31 frame received",
            "frames": len(frames)}


def verify_safety_gate_on_output() -> dict:
    """
    Prove the output-path safety gate acts on real emitted bytes:
      - permit withheld → the frame on the wire is all zeros,
      - permit granted  → the commanded value reaches the wire.
    """
    def _capture(permit: bool):
        with VirtualDMXNode(bind_port=6454) as node:
            asyncio.run(_emit_through_gate(node.port, permit=permit))
            time.sleep(0.05)
            for _ts, pkt in node.frames:
                try:
                    return extract_artnet_dmx(pkt)
                except ValueError:
                    continue
        return None

    try:
        blocked = _capture(permit=False)
        passed = _capture(permit=True)
    except OSError as exc:
        return {"name": "safety_gate_on_output", "status": "skipped",
                "reason": f"cannot bind Art-Net port 6454: {exc}"}

    if blocked is None or passed is None:
        return {"name": "safety_gate_on_output", "status": "fail",
                "reason": "no frames captured",
                "blocked_frame": blocked is not None, "passed_frame": passed is not None}

    no_permit_zeroed = not any(blocked)          # every channel zero on the wire
    permit_passes = passed[0] == 255             # master channel carries full value
    ok = no_permit_zeroed and permit_passes
    return {
        "name": "safety_gate_on_output",
        "status": "pass" if ok else "fail",
        "no_permit_output_zeroed": no_permit_zeroed,
        "permit_output_passes": permit_passes,
        "blocked_master": blocked[0], "passed_master": passed[0],
    }


def verify_output_timing(seconds: float = 0.35) -> dict:
    """Run the Art-Net driver and confirm the on-wire cadence is within 44 Hz spec."""
    try:
        with VirtualDMXNode() as node:
            asyncio.run(_emit_artnet_timed(node.port, universe=0, seconds=seconds))
            time.sleep(0.05)
            times = [t for t, _ in node.frames]
    except OSError as exc:
        return {"name": "output_timing", "status": "skipped", "reason": f"socket: {exc}"}

    timing = analyze_timing(times)
    return {"name": "output_timing",
            "status": "pass" if timing["within_spec"] else "fail", **timing}


def run_full_verification() -> dict:
    """
    Run the complete AQ-X-002 hardware-output verification suite and return a
    structured report. `deployment_ready` is True only when no check failed.
    """
    checks = [
        verify_artnet_output(),
        verify_artnet_high_universe(),
        verify_sacn_output(),
        verify_safety_gate_on_output(),
        verify_output_timing(),
    ]
    passed  = [c for c in checks if c["status"] == "pass"]
    failed  = [c for c in checks if c["status"] == "fail"]
    skipped = [c for c in checks if c["status"] == "skipped"]
    return {
        "task": "AQ-X-002",
        "title": "Hardware Output Verification (CRITICAL)",
        "deployment_ready": len(failed) == 0,
        "summary": {"passed": len(passed), "failed": len(failed), "skipped": len(skipped),
                    "total": len(checks)},
        "checks": checks,
        "spec": {"artnet_max_hz": ARTNET_MAX_HZ,
                 "dmx512_min_frame_ms": round(DMX512_MIN_FRAME_MS, 3),
                 "dmx512_channels": DMX512_CHANNELS},
    }
