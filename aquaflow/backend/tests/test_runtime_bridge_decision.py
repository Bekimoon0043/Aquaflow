"""
AF-HUB-020 — Runtime bridge architectural decision (Option B: retire from the supported
production surface).

runtime_bridge dispatches through a bus interface only VirtualProtocolBus implements, so it
is test-only. These tests lock that decision: it is marked non-production, the live path is
documented, and no production module imports it.
"""
import pathlib

from services import runtime_bridge


def test_runtime_bridge_is_marked_non_production():
    assert runtime_bridge.IS_PRODUCTION_PATH is False
    assert "_route_command" in runtime_bridge.LIVE_OUTPUT_PATH
    assert "INTERNAL / TEST-ONLY" in (runtime_bridge.__doc__ or "")


def test_real_protocol_bus_has_no_runtime_bridge_transport():
    # The reason runtime_bridge is test-only: the REAL bus lacks the transport methods the
    # ProtocolRouter calls (send_artnet/send_modbus/send_relay). Confirm that's still true —
    # if it changes, this is Option A and the docs must be revisited.
    from engine.protocol_bus import ProtocolBus
    for m in ("send_artnet", "send_modbus", "send_relay"):
        assert not hasattr(ProtocolBus, m), f"real ProtocolBus unexpectedly has {m}"


def test_no_production_module_imports_runtime_bridge():
    """Grep the production tree (backend, excluding tests) — nothing may import
    services.runtime_bridge as a live dispatch path."""
    backend = pathlib.Path(runtime_bridge.__file__).parents[1]  # aquaflow/backend
    offenders = []
    for py in backend.rglob("*.py"):
        parts = set(py.parts)
        if "tests" in parts or ".venv" in parts or py.name == "runtime_bridge.py":
            continue
        text = py.read_text(encoding="utf-8", errors="ignore")
        if "from services.runtime_bridge import" in text or "import services.runtime_bridge" in text:
            offenders.append(str(py))
    assert offenders == [], f"production code imports the test-only runtime_bridge: {offenders}"
