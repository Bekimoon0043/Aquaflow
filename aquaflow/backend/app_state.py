"""
Shared backend singletons and show-loading helpers.
Keeps the API routes, scheduler, and websocket runtime aligned.
"""
import json
from pathlib import Path

from engine.show_engine import ShowEngine
from engine.device_manager import DeviceManager
from engine.protocol_bus import ProtocolBus
from engine.runtime_authority import runtime_authority
from services.fixture_registry_bridge import build_registry_from_fixtures

BASE_DIR = Path(__file__).parent
SHOWS_DIR = BASE_DIR / "shows"
SHOWS_DIR.mkdir(exist_ok=True)

show_engine = ShowEngine()
device_manager = DeviceManager()
# AF-HUB-016 — the ONE runtime output bus (primary). A second primary is refused, and
# get_protocol_bus() returns this instance rather than lazily creating another.
protocol_bus = ProtocolBus(primary=True)

# AF-HUB-006B — the ONE runtime output authority. Register the core output actors here
# so every E-stop / blackout entry point halts the SAME complete set of subsystems.
# The safety kernel and the network hardware-output manager are registered too (guarded
# against import issues); the lifespan re-registers them (idempotent).
runtime_authority.register(
    show_engine=show_engine,
    protocol_bus=protocol_bus,
    device_manager=device_manager,
)
try:
    from engine.network_scanner import hardware_output as _hardware_output
    runtime_authority.register(hardware_output=_hardware_output)
except Exception:  # pragma: no cover - defensive wiring
    pass
try:
    from safety.safety_kernel import get_safety_kernel as _get_safety_kernel
    runtime_authority.register(safety=_get_safety_kernel())
except Exception:  # pragma: no cover - defensive wiring
    pass

# AF-HUB-007B — the runtime health monitor aggregates every subsystem's health into a
# single verdict. Register the core actors here; the lifespan adds the safety kernel.
from services.runtime_health import runtime_health
runtime_health.register(
    show_engine=show_engine,
    protocol_bus=protocol_bus,
    device_manager=device_manager,
    runtime_authority=runtime_authority,
)
try:
    from safety.safety_kernel import get_safety_kernel as _get_safety_kernel_h
    runtime_health.register(safety=_get_safety_kernel_h())
except Exception:  # pragma: no cover - defensive wiring
    pass


def sanitize_show_id(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in str(name)).strip()
    return safe or "untitled"


def get_show_path(show_id: str) -> Path:
    return SHOWS_DIR / f"{sanitize_show_id(show_id)}.aqua"


def load_saved_show(show_id: str) -> dict | None:
    path = get_show_path(show_id)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def apply_show_payload(payload: dict) -> dict:
    show_engine.load_show(payload)

    # Fixture-aware routing: derive a hardware address registry from the designed
    # fixtures and configure the protocol bus so playback drives the real designed
    # devices (not just the seed devices). Wrapped defensively so a malformed
    # fixture payload can never block show loading.
    try:
        registry, warnings = build_registry_from_fixtures(
            show_engine.fixtures, show_engine.groups
        )
        summary = registry.to_dict()
        summary["warnings"] = warnings
        show_engine.device_registry_summary = summary
        if hasattr(protocol_bus, "configure_from_fixtures"):
            protocol_bus.configure_from_fixtures(registry)

        # Safety limits in the output path (Stage 1, Priority 7): carry any
        # per-fixture max intensity ceiling from the designed fixtures into the
        # protocol bus so it is clamped on every emit.
        if hasattr(protocol_bus, "set_fixture_limits"):
            limits = {}
            for fx in (show_engine.fixtures or []):
                if not isinstance(fx, dict):
                    continue
                fid = fx.get("id") or fx.get("fixtureId")
                if not fid:
                    continue
                eng = fx.get("engineering") or {}
                cap = fx.get("maxIntensity", fx.get("max_intensity", eng.get("maxIntensity")))
                if cap is None:
                    continue
                try:
                    cap = float(cap)
                except (TypeError, ValueError):
                    continue
                # Accept either a 0..1 fraction or a 0..100 percentage.
                if cap > 1.0:
                    cap = cap / 100.0
                limits[str(fid)] = max(0.0, min(1.0, cap))
            if limits:
                protocol_bus.set_fixture_limits(limits)
    except Exception as exc:  # pragma: no cover - defensive
        show_engine.device_registry_summary = {"error": str(exc), "device_count": 0}

    return show_engine.get_state()
