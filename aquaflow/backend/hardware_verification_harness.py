"""
hardware_verification_harness.py — AF-HUB-010 (Stage 6 Hardware, code-prep).

A runnable harness the ON-SITE commissioning team uses to verify AquaFlow's output on a
REAL DMX/Art-Net/sACN node during AF-HUB-011 bench commissioning. This is *prep only* —
it produces evidence for a human to sign off; it does NOT and CANNOT certify hardware by
itself, and it never sets the commissioning flag.

Honesty contract (mirrors AF-HUB-000C / 007):
  * Loopback self-test (default, no target) proves this host's output path works — but
    that is SIMULATED evidence, never "hardware verified".
  * Real-target mode confirms frames were TRANSMITTED from this host to the node IP. It
    canNOT confirm the physical fixture responded — that requires human visual
    confirmation, recorded in HARDWARE_COMMISSIONING_CHECKLIST.md.
  * `deployment_ready` / `real_hardware_verified` are only ever True once the separate
    commissioning flag is set (AF-HUB-011), which a signed checklist authorizes.

Usage:
    python hardware_verification_harness.py                       # loopback self-test
    python hardware_verification_harness.py --target 192.168.1.50 --universe 0 --protocol artnet
    python hardware_verification_harness.py --target 192.168.1.50 --out result.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from typing import Optional


HARNESS_VERSION = "1.0"
DEFAULT_CHANNELS = {0: 255, 1: 128, 2: 64}


def parse_args(argv):
    p = argparse.ArgumentParser(
        prog="hardware_verification_harness",
        description="On-site hardware output verification harness (AF-HUB-010 prep).",
    )
    p.add_argument("--target", default=None,
                   help="Real node IP. Omit to run the loopback SELF-TEST (simulated).")
    p.add_argument("--protocol", default="artnet", choices=["artnet", "sacn"],
                   help="Protocol to drive in real-target mode (default: artnet).")
    p.add_argument("--universe", type=int, default=0, help="Universe number (default: 0).")
    p.add_argument("--port", type=int, default=None, help="Override the node UDP port.")
    p.add_argument("--seconds", type=float, default=0.3, help="Emit duration (default: 0.3s).")
    p.add_argument("--out", default=None, help="Write the JSON result to this file.")
    return p.parse_args(argv)


async def _emit_real_artnet(host: str, port: int, universe: int, channels: dict, seconds: float) -> int:
    """Drive the production Art-Net driver at a REAL node. Returns frames the driver sent."""
    from protocols.artnet_driver import ArtNetDriver, UniverseTarget
    drv = ArtNetDriver()
    drv.configure_universe(universe, [UniverseTarget(host=host, port=port)])
    for ch, val in channels.items():
        drv.set_channel(universe, ch, val)
    await drv.start()
    await asyncio.sleep(seconds)
    await drv.stop()
    # frames actually transmitted (driver tracks per-universe sequence)
    state = getattr(drv, "_universes", {}).get(universe) if hasattr(drv, "_universes") else None
    return int(getattr(state, "sequence", 1)) if state else 1


async def _emit_real_sacn(host: str, universe: int, channels: dict, seconds: float) -> int:
    from protocols.sacn_driver import SACNDriver
    drv = SACNDriver()
    drv.configure_universe(universe, use_multicast=False, unicast_targets=[host])
    for ch, val in channels.items():
        drv.set_channel(universe, ch, val)
    await drv.start()
    await asyncio.sleep(seconds)
    await drv.stop()
    return 1


def emit_to_real_target(host: str, protocol: str, universe: int, channels: dict,
                        seconds: float = 0.3, port: Optional[int] = None) -> dict:
    """Transmit a test frame to a real node. Reports what left THIS host — not whether the
    fixture responded (that is the operator's visual check)."""
    from protocols.artnet_driver import ARTNET_PORT
    try:
        if protocol == "sacn":
            frames = asyncio.run(_emit_real_sacn(host, universe, channels, seconds))
            used_port = port or 5568
        else:
            used_port = port or ARTNET_PORT
            frames = asyncio.run(_emit_real_artnet(host, used_port, universe, channels, seconds))
        return {"transmitted": True, "protocol": protocol, "target": host, "port": used_port,
                "universe": universe, "channels": channels, "frames_sent": frames,
                "operator_must_confirm": "Visually confirm the physical fixture responded, "
                                         "then record the result in HARDWARE_COMMISSIONING_CHECKLIST.md."}
    except Exception as exc:
        return {"transmitted": False, "protocol": protocol, "target": host,
                "error": str(exc)}


def run_loopback_selftest() -> dict:
    """Run the existing loopback verification suite — SIMULATED output-path evidence."""
    from services.hardware_verifier import run_full_verification
    return run_full_verification()


def build_harness_report(mode: str, result: dict) -> dict:
    """Assemble the honest harness report. Never self-certifies: real-hardware verification
    and deployment readiness always defer to the commissioning flag (AF-HUB-011)."""
    from services.commissioning import is_hardware_commissioned, SIMULATED_LABEL
    commissioned = is_hardware_commissioned()
    report = {
        "harness": "AF-HUB-010 hardware verification harness",
        "harness_version": HARNESS_VERSION,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "mode": mode,  # "loopback_selftest" | "real_target"
        "hardware_commissioned": commissioned,
        # Honest gating — identical rule to hardware_verifier.run_full_verification.
        "verification_mode": "REAL_HARDWARE" if commissioned else "SIMULATED",
        "label": None if commissioned else SIMULATED_LABEL,
        "real_hardware_verified": False,   # only a signed AF-HUB-011 bench run sets this
        "deployment_ready": False,         # never True from the harness alone
        "result": result,
        "note": ("This harness confirms transmission and the loopback output path. It does "
                 "NOT certify hardware. Physical fixture response must be visually confirmed "
                 "and signed off in HARDWARE_COMMISSIONING_CHECKLIST.md before the "
                 "commissioning flag (AQUAFLOW_HARDWARE_COMMISSIONED) is set in AF-HUB-011."),
    }
    return report


def main(argv=None) -> int:
    args = parse_args(argv if argv is not None else sys.argv[1:])
    if args.target:
        result = emit_to_real_target(args.target, args.protocol, args.universe,
                                     DEFAULT_CHANNELS, args.seconds, args.port)
        report = build_harness_report("real_target", result)
    else:
        result = run_loopback_selftest()
        report = build_harness_report("loopback_selftest", result)

    text = json.dumps(report, indent=2)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    print(text)

    # Exit code reflects whether the run's own checks succeeded — NOT hardware readiness.
    if report["mode"] == "loopback_selftest":
        ok = bool(result.get("loopback_checks_passed"))
    else:
        ok = bool(result.get("transmitted"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
