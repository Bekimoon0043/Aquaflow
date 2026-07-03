"""
validate_safety_output_limits.py — AquaFlow Stage 1, Priority 7 (AQ-S1-007)

Proves the three acceptance criteria for safety limits in the output path:
  1. Per-fixture intensity is clamped before emit.
  2. Flame duration is enforced at the hardware level (independent cutoff).
  3. The safety kernel is active during all output (permit + per-subsystem enables
     gate every emit).

Runs in-process against the real ProtocolBus output path with a capturing fake
driver — no server, no hardware. Exit code 0 = all checks pass.

Run:  python validate_safety_output_limits.py
"""
import asyncio
import sys
import time

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from engine.protocol_bus import ProtocolBus
from safety.safety_kernel import SafetyKernel, SafetyState

PASS, FAIL = "PASS", "FAIL"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, PASS if ok else FAIL, detail))


class FakeModbusDriver:
    """Captures the values the bus tries to emit to hardware."""
    name = "modbus"
    is_connected = True
    def __init__(self):
        self.sent: list[dict] = []
    async def connect(self): return True
    async def disconnect(self): pass
    async def blackout(self): pass
    async def send(self, data: dict) -> bool:
        self.sent.append(dict(data))
        return True


def make_bus_with_flame(device_id="flame-1", register=0x0010):
    """A ProtocolBus wired so `device_id` routes to a capturing modbus driver."""
    bus = ProtocolBus()
    fake = FakeModbusDriver()
    host = "10.0.0.5"
    bus._drivers[f"modbus:{host}"] = fake
    # Pre-seed the fixture-register map so no real connection is attempted.
    bus._fixture_registers[device_id] = {"host": host, "port": 502, "unit": 1, "register": register}
    # Short-circuit driver creation to the fake.
    async def _ensure(h, p=502):
        return fake
    bus._ensure_modbus_driver = _ensure
    return bus, fake


# ── Criterion 1: per-fixture intensity clamped before emit ─────────────────────
async def test_fixture_clamp() -> None:
    bus, fake = make_bus_with_flame(device_id="pump-1", register=0x0001)
    bus.set_fixture_limit("pump-1", 0.5)   # this fixture may never exceed 50%

    # Command full intensity — must be clamped to the fixture ceiling before emit.
    await bus._route_command({"device_id": "pump-1", "type": "pump", "intensity": 1.0})
    emitted = fake.sent[-1]["value"] if fake.sent else None
    # Modbus scale is intensity * 10000.
    check("Per-fixture ceiling clamps emitted value",
          emitted == int(0.5 * 10000), f"emitted={emitted} (expected 5000)")

    # A command below the ceiling passes through untouched.
    await bus._route_command({"device_id": "pump-1", "type": "pump", "intensity": 0.3})
    check("Below-ceiling command passes unchanged",
          fake.sent[-1]["value"] == int(0.3 * 10000), f"emitted={fake.sent[-1]['value']}")

    # Global cap stacks on top of the per-fixture ceiling.
    bus.set_global_intensity_cap(0.2)
    await bus._route_command({"device_id": "pump-1", "type": "pump", "intensity": 1.0})
    check("Global intensity cap also applied",
          fake.sent[-1]["value"] == int(0.2 * 10000), f"emitted={fake.sent[-1]['value']}")

    # Direct gate: out-of-range input is clamped into [0,1] (fresh cap).
    bus.set_global_intensity_cap(1.0)
    check("Intensity clamped into [0,1] range",
          bus._safety_gate("x", "lighting", 5.0) == 1.0 and bus._safety_gate("x", "lighting", -3.0) == 0.0,
          "over/under range not clamped")


# ── Criterion 2: flame duration enforced at hardware level ─────────────────────
async def test_flame_duration() -> None:
    bus, fake = make_bus_with_flame(device_id="flame-1")
    bus.configure_flame_limit(3.0)   # 3s hard limit
    # No safety kernel attached — proves the cutoff is independent of the kernel.

    # First flame-on frame starts the burst and passes.
    e1 = bus._safety_gate("flame-1", "flame", 1.0)
    check("Flame initially allowed on", e1 == 1.0, f"eff={e1}")

    # Simulate 3.1s of continuous on-time by backdating the burst start.
    bus._flame_on_since["flame-1"] = time.monotonic() - 3.1
    e2 = bus._safety_gate("flame-1", "flame", 1.0)
    check("Flame cut off after exceeding hardware duration limit", e2 == 0.0, f"eff={e2}")
    check("Flame latched off after cutoff", "flame-1" in bus._flame_lockout,
          f"lockout={bus._flame_lockout}")

    # Still latched while continuously commanded on.
    e3 = bus._safety_gate("flame-1", "flame", 1.0)
    check("Flame stays latched off during the same burst", e3 == 0.0, f"eff={e3}")

    # End-to-end through the emit path: a cut-off flame writes 0 to the register.
    await bus._route_command({"device_id": "flame-1", "type": "flame", "intensity": 1.0})
    check("Cut-off flame emits zero to hardware register",
          fake.sent[-1]["value"] == 0, f"emitted={fake.sent[-1]['value']}")

    # A command gap ends the burst; a fresh ignition is allowed again.
    bus._flame_last_cmd["flame-1"] = time.monotonic() - (bus.FLAME_GAP_RESET + 0.2)
    e4 = bus._safety_gate("flame-1", "flame", 1.0)
    check("Flame re-ignites after a command gap resets the burst", e4 == 1.0, f"eff={e4}")


# ── Criterion 3: safety kernel active during all output ────────────────────────
async def test_kernel_gate() -> None:
    bus, fake = make_bus_with_flame(device_id="pump-2", register=0x0002)
    kernel = SafetyKernel()
    bus.set_safety_kernel(kernel)

    # No permit → every risky output is forced to zero.
    kernel.outputs.permit = False
    kernel.outputs.pump_enable = False
    await bus._route_command({"device_id": "pump-2", "type": "pump", "intensity": 1.0})
    check("No master permit → pump emit forced to zero",
          fake.sent[-1]["value"] == 0, f"emitted={fake.sent[-1]['value']}")
    check("No master permit → lighting also gated",
          bus._safety_gate("l1", "lighting", 1.0) == 0.0, "lighting not gated")

    # Permit granted, but this subsystem is not enabled → still zero.
    kernel.outputs.permit = True
    kernel.outputs.flame_enable = False
    check("Permit but flame disabled → flame gated to zero",
          bus._safety_gate("flame-9", "flame", 1.0) == 0.0, "flame not gated")

    # Permit granted and subsystem enabled → output flows.
    kernel.outputs.permit = True
    kernel.outputs.pump_enable = True
    await bus._route_command({"device_id": "pump-2", "type": "pump", "intensity": 0.6})
    check("Permit + enable → output flows through",
          fake.sent[-1]["value"] == int(0.6 * 10000), f"emitted={fake.sent[-1]['value']}")

    # Lighting enabled by default when permitted.
    kernel.outputs.lighting_enable = True
    check("Permit + lighting enabled → lighting passes",
          bus._safety_gate("l2", "lighting", 0.8) == 0.8, "lighting blocked unexpectedly")


def main() -> int:
    asyncio.run(test_fixture_clamp())
    asyncio.run(test_flame_duration())
    asyncio.run(test_kernel_gate())

    print("\n" + "=" * 70)
    print("AQ-S1-007 Safety Limits in Output Path — Verification")
    print("=" * 70)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    total = len(results)
    print("-" * 70)
    print(f"{passed}/{total} checks passed")
    print("=" * 70)
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
