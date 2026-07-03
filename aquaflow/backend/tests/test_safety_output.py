"""
Contract tests for the output-path safety gate (AQ-S1-009, covering AQ-S1-007).
The gate is the single choke point before every hardware emit, so its behaviour is
a hard contract: intensity clamping, flame duration cutoff, and safety-kernel gating.
"""
import time

from engine.protocol_bus import ProtocolBus
from safety.safety_kernel import SafetyKernel


def test_per_fixture_intensity_is_clamped():
    bus = ProtocolBus()
    bus.set_fixture_limit("pump-1", 0.5)
    assert bus._safety_gate("pump-1", "pump", 1.0) == 0.5
    assert bus._safety_gate("pump-1", "pump", 0.3) == 0.3


def test_global_cap_stacks_on_fixture_limit():
    bus = ProtocolBus()
    bus.set_fixture_limit("pump-1", 0.8)
    bus.set_global_intensity_cap(0.4)
    assert bus._safety_gate("pump-1", "pump", 1.0) == 0.4


def test_intensity_clamped_to_unit_range():
    bus = ProtocolBus()
    assert bus._safety_gate("x", "lighting", 5.0) == 1.0
    assert bus._safety_gate("x", "lighting", -2.0) == 0.0


def test_flame_duration_cutoff_and_relatch():
    bus = ProtocolBus()
    bus.configure_flame_limit(3.0)
    assert bus._safety_gate("flame-1", "flame", 1.0) == 1.0
    # Backdate the burst start beyond the hard limit.
    bus._flame_on_since["flame-1"] = time.monotonic() - 3.1
    assert bus._safety_gate("flame-1", "flame", 1.0) == 0.0
    assert "flame-1" in bus._flame_lockout
    # A command gap ends the burst → re-ignition allowed.
    bus._flame_last_cmd["flame-1"] = time.monotonic() - (bus.FLAME_GAP_RESET + 0.2)
    assert bus._safety_gate("flame-1", "flame", 1.0) == 1.0


def test_no_permit_zeroes_all_output():
    bus = ProtocolBus()
    kernel = SafetyKernel()
    bus.set_safety_kernel(kernel)
    kernel.outputs.permit = False
    assert bus._safety_gate("pump-1", "pump", 1.0) == 0.0
    assert bus._safety_gate("l1", "lighting", 1.0) == 0.0


def test_permit_with_subsystem_enable_allows_output():
    bus = ProtocolBus()
    kernel = SafetyKernel()
    bus.set_safety_kernel(kernel)
    kernel.outputs.permit = True
    kernel.outputs.pump_enable = True
    kernel.outputs.flame_enable = False
    assert bus._safety_gate("pump-1", "pump", 0.6) == 0.6
    # Flame subsystem disabled → gated to zero even with permit.
    assert bus._safety_gate("flame-1", "flame", 1.0) == 0.0
