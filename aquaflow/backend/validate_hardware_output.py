"""
validate_hardware_output.py — AQ-X-002 (CRITICAL) verification

Stands up a real UDP loopback DMX node ("simulated hardware") and proves the full
output path end-to-end:
  1. DMX/Art-Net output — commanded channels arrive intact and decode to spec,
  2. Art-Net 15-bit universe (> 255) survives the net/sub/low split,
  3. sACN (E1.31) output round-trips on the wire,
  4. the output-path safety gate zeroes real emitted bytes without a permit and
     passes them with one, and
  5. transmit timing stays within the DMX512 / Art-Net 44 Hz spec.

Plus pure packet/timing contract checks that always run.

Run:  python backend/validate_hardware_output.py   (from the aquaflow/ dir)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:                                    # ASCII-safe on Windows cp1252 consoles
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from protocols.artnet_driver import build_artdmx, parse_artdmx, extract_artnet_dmx
from protocols.sacn_driver import build_sacn_packet, parse_sacn_packet
from services.hardware_verifier import (
    analyze_timing, run_full_verification, DMX512_MIN_FRAME_MS, ARTNET_MAX_HZ,
)

_passed = 0
_failed = 0
_skipped = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


print("== 1. Art-Net packet round-trip (build -> parse) ==")
for uni in (0, 1, 255, 256, 300, 32767):
    data = bytes([(i * 7 + uni) & 0xFF for i in range(24)])
    p = parse_artdmx(build_artdmx(uni, data))
    check(f"universe {uni} round-trips", p["universe"] == uni and p["data"][:24] == data,
          f'got u{p["universe"]}')

print("== 2. sACN packet round-trip (build -> parse) ==")
sdata = bytes([(i * 3) & 0xFF for i in range(32)])
sp = parse_sacn_packet(build_sacn_packet(universe=42, data=sdata, sequence=9, priority=150))
check("sACN universe round-trips", sp["universe"] == 42, f'got {sp["universe"]}')
check("sACN priority round-trips", sp["priority"] == 150, f'got {sp["priority"]}')
check("sACN sequence round-trips", sp["sequence"] == 9, f'got {sp["sequence"]}')
check("sACN start code is 0 (DMX)", sp["start_code"] == 0)
check("sACN DMX data round-trips", sp["data"][:32] == sdata)

print("== 3. timing analysis (pure) ==")
good = [i / ARTNET_MAX_HZ for i in range(20)]                 # exactly 44 Hz
fast = [i / 1000.0 for i in range(50)]                        # 1000 Hz — too fast
stalled = [0.0, 3.0]                                          # ~0.3 Hz — stalled
check("44 Hz cadence is within spec", analyze_timing(good)["within_spec"] is True)
check("1000 Hz cadence flagged out of spec", analyze_timing(fast)["within_spec"] is False)
check("stalled cadence flagged out of spec", analyze_timing(stalled)["within_spec"] is False)
check("DMX512 min frame ~22.7 ms", 22.0 <= DMX512_MIN_FRAME_MS <= 23.0,
      f"{DMX512_MIN_FRAME_MS:.3f} ms")

def _detail(c):
    keys = ("universe", "expected_universe", "mismatches", "measured_hz", "within_spec",
            "no_permit_output_zeroed", "permit_output_passes", "frames", "reason")
    return ", ".join(f"{k}={c[k]}" for k in keys if k in c)


print("== 4. live loopback — full hardware-output verification ==")
report = run_full_verification()
for c in report["checks"]:
    status = c["status"]
    if status == "skipped":
        _skipped += 1
        print(f"  [SKIP] {c['name']} - {c.get('reason', '')}")
    else:
        check(c["name"], status == "pass", _detail(c))

print(f"\n== RESULT: {_passed} passed, {_failed} failed, {_skipped} skipped ==")
print(f"== deployment_ready: {report['deployment_ready']} "
      f"(passed {report['summary']['passed']}/{report['summary']['total']}, "
      f"{report['summary']['skipped']} skipped) ==")
sys.exit(1 if _failed else 0)
