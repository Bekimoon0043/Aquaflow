"""
Shared backend singletons and show-loading helpers.
Keeps the API routes, scheduler, and websocket runtime aligned.
"""
import json
from pathlib import Path

from engine.show_engine import ShowEngine
from engine.device_manager import DeviceManager
from engine.protocol_bus import ProtocolBus
from services.fixture_registry_bridge import build_registry_from_fixtures

BASE_DIR = Path(__file__).parent
SHOWS_DIR = BASE_DIR / "shows"
SHOWS_DIR.mkdir(exist_ok=True)

show_engine = ShowEngine()
device_manager = DeviceManager()
protocol_bus = ProtocolBus()


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
    except Exception as exc:  # pragma: no cover - defensive
        show_engine.device_registry_summary = {"error": str(exc), "device_count": 0}

    return show_engine.get_state()
