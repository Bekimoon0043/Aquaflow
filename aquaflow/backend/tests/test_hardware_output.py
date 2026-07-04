"""
Contract tests for Hardware Output Verification (AQ-X-002, CRITICAL).

Two layers:
  * deterministic packet/timing contracts (always run) — the byte-level proof that
    the Art-Net / sACN encoders produce spec frames and the timing analyser judges
    the refresh rate correctly, and that the safety gate zeroes emitted colour bytes;
  * live UDP loopback checks against a VirtualDMXNode ("simulated hardware") that
    skip gracefully if the environment forbids loopback sockets.
"""
import asyncio

import pytest

from protocols.artnet_driver import build_artdmx, parse_artdmx, extract_artnet_dmx
from protocols.sacn_driver import build_sacn_packet, parse_sacn_packet
from services.hardware_verifier import (
    analyze_timing, verify_artnet_output, verify_artnet_high_universe,
    verify_sacn_output, verify_safety_gate_on_output, verify_output_timing,
    DMX512_MIN_FRAME_MS, ARTNET_MAX_HZ,
)
from engine.protocol_bus import ProtocolBus, ArtNetDriver as InlineArtNet
from safety.safety_kernel import SafetyKernel


# ── Deterministic: Art-Net / sACN packet round-trip ──────────────────────────

@pytest.mark.parametrize("universe", [0, 1, 255, 256, 300, 32767])
def test_artnet_packet_round_trips(universe):
    data = bytes([(i * 7 + universe) & 0xFF for i in range(48)])
    p = parse_artdmx(build_artdmx(universe, data))
    assert p["universe"] == universe          # 15-bit net/sub/low split survives
    assert p["data"][:48] == data


def test_artnet_rejects_non_artnet_packet():
    with pytest.raises(ValueError):
        parse_artdmx(b"not-artnet-at-all")


def test_sacn_packet_round_trips():
    data = bytes([(i * 3) & 0xFF for i in range(64)])
    p = parse_sacn_packet(build_sacn_packet(universe=42, data=data, sequence=9, priority=150))
    assert p["universe"] == 42
    assert p["priority"] == 150
    assert p["sequence"] == 9
    assert p["start_code"] == 0               # DMX null start code
    assert p["data"][:64] == data


# ── Deterministic: timing analysis vs the 44 Hz spec ─────────────────────────

def test_timing_within_spec_at_44hz():
    good = [i / ARTNET_MAX_HZ for i in range(20)]
    assert analyze_timing(good)["within_spec"] is True


def test_timing_rejects_too_fast():
    fast = [i / 1000.0 for i in range(50)]     # 1 kHz — far above the 44 Hz ceiling
    assert analyze_timing(fast)["within_spec"] is False


def test_timing_rejects_stalled():
    assert analyze_timing([0.0, 5.0])["within_spec"] is False
    assert analyze_timing([0.0])["within_spec"] is False   # too few frames


def test_dmx512_min_frame_time_is_physical():
    # 512 slots @ 44 µs + break/MAB ≈ 22.7 ms → the 44 Hz ceiling is spec-consistent.
    assert 22.0 <= DMX512_MIN_FRAME_MS <= 23.0
    assert (1000.0 / ARTNET_MAX_HZ) >= DMX512_MIN_FRAME_MS


# ── Deterministic: safety gate zeroes emitted colour bytes (no sockets) ──────

def _capture_gate_bytes(permit: bool) -> dict:
    """Route a lighting command through the bus gate into a recording driver."""
    captured = {}

    class _Recorder(InlineArtNet):
        async def send(self, data):
            captured["channels"] = dict(data.get("channels", {}))
            return True

    bus = ProtocolBus()
    bus._drivers["artnet"] = _Recorder()
    kernel = SafetyKernel()
    bus.set_safety_kernel(kernel)
    kernel.outputs.permit = permit
    kernel.outputs.lighting_enable = True
    bus.update_dmx_map([{"fixtureId": "L1", "universe": 0, "channel": 1}])
    asyncio.run(bus._route_command(
        {"device_id": "L1", "type": "lighting", "intensity": 1.0, "color": "#ffffff"}))
    return captured.get("channels", {})


def test_safety_gate_zeroes_all_colour_channels_without_permit():
    ch = _capture_gate_bytes(permit=False)
    # Every emitted channel — master AND R/G/B — must be zero when the permit is denied.
    assert ch and all(v == 0 for v in ch.values()), ch


def test_safety_gate_passes_full_white_with_permit():
    ch = _capture_gate_bytes(permit=True)
    assert ch[0] == 255                        # master/dimmer
    assert ch[1] == 255 and ch[2] == 255 and ch[3] == 255   # R, G, B


# ── Live UDP loopback — simulated hardware (skips if sockets unavailable) ─────

def _run_or_skip(result: dict) -> dict:
    if result.get("status") == "skipped":
        pytest.skip(result.get("reason", "loopback socket unavailable"))
    return result


def test_loopback_artnet_output():
    r = _run_or_skip(verify_artnet_output(universe=0, channels={0: 255, 1: 128, 2: 64}))
    assert r["status"] == "pass", r


def test_loopback_artnet_high_universe():
    r = _run_or_skip(verify_artnet_high_universe())
    assert r["status"] == "pass", r


def test_loopback_sacn_output():
    r = _run_or_skip(verify_sacn_output())
    assert r["status"] == "pass", r


def test_loopback_safety_gate_on_the_wire():
    r = _run_or_skip(verify_safety_gate_on_output())
    assert r["status"] == "pass", r
    assert r["no_permit_output_zeroed"] is True
    assert r["permit_output_passes"] is True


def test_loopback_output_timing_within_spec():
    r = _run_or_skip(verify_output_timing(seconds=0.3))
    assert r["status"] == "pass", r
    assert r["measured_hz"] <= ARTNET_MAX_HZ * 1.2
