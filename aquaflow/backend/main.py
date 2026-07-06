"""
AquaFlow Studio Backend
FastAPI server with WebSocket real-time communication
Phase 6 wired: safety kernel, runtime transport, phase6 routes
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import os
import sys
import uvicorn
from contextlib import asynccontextmanager

# AF-HUB-000B — Force UTF-8 console output at process entry.
#   Several startup/log lines contain non-ASCII characters (e.g. the "⚙" the show
#   engine prints on init). On a Windows console the default cp1252 codec raises
#   UnicodeEncodeError on those, which aborts the FastAPI lifespan and kills the
#   server on startup. A control platform must never die because of a log character,
#   so we reconfigure stdout/stderr to UTF-8 with a non-fatal fallback. Guarded in a
#   try/except because under pytest sys.stdout is a capture object without
#   reconfigure(); there it is simply a no-op.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass

from api.routes import shows, devices, ai_engine, protocols, audio, plc, scheduler as scheduler_routes, runtime
from api.routes.ai_learning_routes import router as ai_learning_router
from api.routes.phase6_routes import phase6_router
from api.routes.phase7_routes import phase7_router
from api.routes.phase9_routes import phase9_router
from api.routes.pattern_routes import router as pattern_router
from api.routes.hydraulics_routes import router as hydraulics_router
from api.routes.nozzles_routes import router as nozzles_router
from api.routes.pid_routes import router as pid_router
from api.routes.bom_routes import router as bom_router
from api.routes.energy_routes import router as energy_router
from api.routes.ai_show_routes import router as ai_show_router
from api.routes.choreography_routes import router as choreography_router
from api.routes.weather_routes import router as weather_router
from api.routes.mobile_routes import router as mobile_router
from api.routes.collab_routes import router as collab_router
from api.routes.dmx_routes import router as dmx_router
from api.routes.hardware_routes import router as hardware_router
from api.routes.deploy_routes import router as deploy_router
from api.routes.cue_routes import router as cue_router
from api.routes.fault_routes import router as fault_router
from api.routes.pump_routes import router as pump_router
from api.routes.valve_routes import router as valve_router
from api.routes.dependency_routes import router as dependency_router
from api.routes.cad_routes import router as cad_router
from api.routes.engineering_routes import router as engineering_router
from api.routes.wind_routes import router as wind_router
from api.routes.beat_routes import router as beat_router
from api.routes.installer_routes import router as installer_router
from api.routes.crash_routes import router as crash_router
from api.routes.analytics_routes import router as analytics_router
from api.routes.portal_routes import router as portal_router
from api.routes.academy_routes import router as academy_router
from api.routes.twin_routes import router as twin_router
from api.routes.optimize_routes import router as optimize_router
from api.routes.adaptation_routes import router as adaptation_router
from api.routes.fleet_routes import router as fleet_router
from api.routes.cloud_routes import router as cloud_router
from api.routes.generative_routes import router as generative_router
from services.show_programmer_service import show_programmer_router
from services.diagnostics import get_diagnostics
from app_state import show_engine, device_manager, protocol_bus, load_saved_show, apply_show_payload
from engine.network_scanner import hardware_output
from plc.plc_engine import plc_manager
from scheduler.scheduler_engine import scheduler_engine
from safety.safety_kernel import get_safety_kernel
from engine.runtime_transport import get_transport
from license.license_routes import router as license_router

APP_VERSION = "0.1.0"
DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://localhost:3003",
    "http://localhost:4173",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    "http://127.0.0.1:3003",
    "http://127.0.0.1:4173",
    "http://127.0.0.1:5173",
]


def get_allowed_origins() -> list[str]:
    origins = set(DEFAULT_CORS_ORIGINS)
    extra = os.getenv("AQUAFLOW_CORS_ORIGINS", "")
    for item in extra.split(","):
        item = item.strip()
        if item:
            origins.add(item)
    return sorted(origins)

def _get_ws_manager():
    """Late-binding access to ws_manager to avoid forward-reference issues."""
    global ws_manager
    return ws_manager

async def scheduler_start_show(slot_id: str, show_id: str):
    payload = load_saved_show(show_id)
    if not payload:
        if _get_ws_manager().active:
            await _get_ws_manager().broadcast({
                "type": "log",
                "level": "error",
                "message": f"Scheduled show '{show_id}' not found for slot {slot_id}",
            })
        return
    apply_show_payload(payload)
    await show_engine.seek(0)
    started = await show_engine.play()
    if not started:
        # Scheduled show blocked by a hardware address conflict — do not run it.
        if _get_ws_manager().active:
            await broadcast_playback_state()
            await _get_ws_manager().broadcast({
                "type": "log",
                "level": "error",
                "message": f"Scheduled show '{show_id}' blocked — {show_engine.last_error or 'hardware address conflict'}",
            })
        return
    if _get_ws_manager().active:
        await broadcast_show_snapshot()
        await broadcast_playback_state()
        await _get_ws_manager().broadcast({
            "type": "log",
            "level": "info",
            "message": f"Scheduler started show '{show_id}' for slot {slot_id}",
        })


async def scheduler_stop_show(slot_id: str):
    await show_engine.stop_playback()
    if _get_ws_manager().active:
        await broadcast_playback_state()
        await _get_ws_manager().broadcast({
            "type": "log",
            "level": "info",
            "message": f"Scheduler stopped slot {slot_id}",
        })


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("LuxuryCon Fountain Studio starting...")
    scheduler_engine.set_callbacks(scheduler_start_show, scheduler_stop_show)
    await device_manager.start()
    await protocol_bus.start()

    # Load saved Pattern Designer DMX map into protocol bus on startup.
    try:
        from api.routes.pattern_routes import get_dmx_map
        saved_dmx = get_dmx_map()
        if isinstance(saved_dmx, dict) and hasattr(protocol_bus, "update_dmx_map"):
            protocol_bus.update_dmx_map(saved_dmx.get("map", []))
    except Exception as exc:
        print(f"[startup] DMX map preload skipped: {exc}")

    await hardware_output.start()
    await plc_manager.start()
    await show_engine.start(device_manager, protocol_bus)
    await scheduler_engine.start()

    # ── Phase 6: Safety kernel ────────────────────────────────────────────────
    safety = get_safety_kernel()
    def _on_safety_change(old, new):
        try:
            asyncio.create_task(ws_manager.broadcast({
                "type": "safety_state",
                "old": str(old),
                "new": str(new),
            }))
        except Exception:
            pass
    safety.on_state_change(_on_safety_change)
    await safety.start()

    # Wire the safety kernel into the protocol bus so its master permit and
    # per-subsystem enables gate every hardware emit (Stage 1, Priority 7).
    if hasattr(protocol_bus, "set_safety_kernel"):
        protocol_bus.set_safety_kernel(safety)

    # AF-HUB-006B — register the live safety kernel + hardware output with the single
    # runtime authority so every E-stop path halts the complete set (idempotent).
    from engine.runtime_authority import runtime_authority
    runtime_authority.register(safety=safety, hardware_output=hardware_output)

    # ── Phase 7: Wire diagnostics to safety kernel ────────────────────────────
    diag = get_diagnostics()
    def _on_safety_change_diag(old, new):
        try:
            diag.record("info", "safety", "safety_kernel", f"State: {old} → {new}")
        except Exception:
            pass
    safety.on_state_change(_on_safety_change_diag)
    diag.record("info", "system", "startup", "AquaFlow Studio started — Phase 7 active")

    # ── Phase 6: Runtime transport ────────────────────────────────────────────
    transport = get_transport()
    def _on_transport_change(old, new):
        try:
            asyncio.create_task(ws_manager.broadcast({
                "type": "transport_state",
                "old": str(old),
                "new": str(new),
            }))
        except Exception:
            pass
    transport.on_state_change(_on_transport_change)
    await transport.start()

    telem_task = asyncio.create_task(telemetry_broadcast_loop())
    print("LuxuryCon Fountain Studio ready -- safety kernel + transport LIVE")
    yield

    print("LuxuryCon Fountain Studio shutting down...")
    telem_task.cancel()
    await safety.stop()
    await transport.stop_loop()
    await show_engine.stop()
    await scheduler_engine.stop()
    await hardware_output.stop()
    await protocol_bus.stop()
    await device_manager.stop()


async def broadcast_playback_state(target: WebSocket | None = None):
    payload = {"type": "playback_state", "state": show_engine.get_state()}
    if target:
        await target.send_json(payload)
    elif ws_manager.active:
        await ws_manager.broadcast(payload)


async def broadcast_show_snapshot(target: WebSocket | None = None):
    payload = {"type": "show_snapshot", "snapshot": show_engine.get_snapshot()}
    if target:
        await target.send_json(payload)
    elif ws_manager.active:
        await ws_manager.broadcast(payload)


DEV_MODE = os.environ.get("AQUAFLOW_ENV", "production").lower() == "dev"
SAFETY_BYPASS = DEV_MODE and os.environ.get("AQUAFLOW_UNSAFE_DEV", "false").lower() == "true"

if SAFETY_BYPASS:
    print("=" * 60)
    print("DEVELOPMENT SAFETY BYPASS IS ACTIVE")
    print("This should NEVER be enabled in production!")
    print("=" * 60)

def _telemetry_state_changed(current: dict) -> bool:
    """Check if playback state has meaningfully changed."""
    global _last_telemetry_state

    keys = ["state", "playhead", "bpm", "duration", "current_show"]

    for key in keys:
        if _last_telemetry_state.get(key) != current.get(key):
            _last_telemetry_state = {k: current.get(k) for k in keys}
            return True

    return False

async def telemetry_broadcast_loop():
    tick = 0

    while True:
        try:
            await asyncio.sleep(0.25)

            try:
                safety = get_safety_kernel()
                safety.kick_watchdog()

                if SAFETY_BYPASS:
                    safety.update_plc_heartbeat()

                    if "WATCHDOG_MISSED" in safety.latched_faults:
                        safety.latched_faults.remove("WATCHDOG_MISSED")

                    if "PLC_COMM_LOSS" in safety.latched_faults:
                        safety.latched_faults.remove("PLC_COMM_LOSS")

                    if safety.state in ("FAULT", "BOOT", "RECOVERY"):
                        safety.reset_faults()
            except Exception:
                pass

            if not ws_manager.active:
                continue

            current_state = show_engine.get_state()
            if _telemetry_state_changed(current_state):
                await broadcast_playback_state()
            tick += 1

            if tick % 8 == 0:
                await ws_manager.broadcast({
                    "type": "device_update",
                    "devices": device_manager.get_all_devices(),
                })

                try:
                    await ws_manager.broadcast({
                        "type": "safety_telemetry",
                        "safety": get_safety_kernel().get_status(),
                        "transport": get_transport().get_status(),
                    })
                except Exception:
                    pass

        except asyncio.CancelledError:
            break
        except Exception:
            pass


app = FastAPI(
    title="AquaFlow Studio API",
    version=APP_VERSION,
    lifespan=lifespan,
)

ALLOWED_ORIGINS = get_allowed_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(shows.router,            prefix="/api/shows",     tags=["Shows"])
app.include_router(devices.router,          prefix="/api/devices",   tags=["Devices"])
app.include_router(ai_engine.router,        prefix="/api/ai",        tags=["AI"])
app.include_router(ai_learning_router,      prefix="/api/ai",        tags=["AI-Learning"])
app.include_router(protocols.router,        prefix="/api/protocols", tags=["Protocols"])
app.include_router(audio.router,            prefix="/api/audio",     tags=["Audio"])
app.include_router(plc.router,              prefix="/api/plc",       tags=["PLC"])
app.include_router(scheduler_routes.router, prefix="/api/scheduler", tags=["Scheduler"])
app.include_router(runtime.router,          prefix="/api/runtime",   tags=["Runtime"])
app.include_router(phase6_router,           prefix="/api",           tags=["Phase6"])
app.include_router(phase7_router,           prefix="/api",           tags=["Phase7"])
app.include_router(phase9_router,           prefix="/api",           tags=["Phase9"])
app.include_router(pattern_router,                                tags=["Patterns"])
app.include_router(hydraulics_router,       prefix="/api/hydraulics", tags=["Hydraulics"])
app.include_router(nozzles_router,          prefix="/api/nozzles",    tags=["Nozzles"])
app.include_router(pid_router,              prefix="/api/pid",        tags=["P&ID"])
app.include_router(bom_router,              prefix="/api/bom",        tags=["BOM"])
app.include_router(energy_router,           prefix="/api/energy",     tags=["Energy"])
app.include_router(ai_show_router,          prefix="/api/ai-show",    tags=["AI-Show"])
app.include_router(choreography_router,     prefix="/api/choreography", tags=["Choreography"])
app.include_router(weather_router,          prefix="/api/weather",    tags=["Weather"])
app.include_router(mobile_router,           prefix="/api/mobile",     tags=["Mobile"])
app.include_router(collab_router,           prefix="/api/collab",     tags=["Collaboration"])
app.include_router(dmx_router,              prefix="/api/dmx",        tags=["DMX"])
app.include_router(hardware_router,         prefix="/api/hardware",   tags=["Hardware"])
app.include_router(deploy_router,           prefix="/api/deploy",     tags=["Deploy"])
app.include_router(cue_router,              prefix="/api/cues",       tags=["Cues"])
app.include_router(fault_router,            prefix="/api/faults",     tags=["Faults"])
app.include_router(pump_router,             prefix="/api/pumps",      tags=["Pumps"])
app.include_router(valve_router,            prefix="/api/valves",     tags=["Valves"])
app.include_router(dependency_router,       prefix="/api/dependencies", tags=["Dependencies"])
app.include_router(cad_router,              prefix="/api/cad",        tags=["CAD"])
app.include_router(engineering_router,      prefix="/api/engineering", tags=["Engineering"])
app.include_router(wind_router,             prefix="/api/wind",       tags=["Wind"])
app.include_router(beat_router,             prefix="/api/beat",       tags=["Beat"])
app.include_router(installer_router,        prefix="/api/installer",  tags=["Installer"])
app.include_router(crash_router,            prefix="/api/crash",      tags=["Crash"])
app.include_router(analytics_router,        prefix="/api/analytics",  tags=["Analytics"])
app.include_router(portal_router,           prefix="/api/portal",     tags=["License-Portal"])
app.include_router(academy_router,          prefix="/api/academy",    tags=["Academy"])
app.include_router(twin_router,             prefix="/api/twin",       tags=["Digital-Twin"])
app.include_router(optimize_router,         prefix="/api/optimize",   tags=["Optimization"])
app.include_router(adaptation_router,       prefix="/api/adaptation", tags=["Adaptation"])
app.include_router(fleet_router,            prefix="/api/fleet",      tags=["Fleet"])
app.include_router(cloud_router,            prefix="/api/cloud",      tags=["Cloud"])
app.include_router(generative_router,       prefix="/api/generative", tags=["Generative"])
app.include_router(show_programmer_router,    prefix="/api/show-programmer", tags=["Show-Programmer"])  
app.include_router(license_router, tags=["License"])

class ConnectionManager:
    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        for ws in self.active:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


ws_manager = ConnectionManager()
_last_telemetry_state = {}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    await websocket.send_json({
        "type": "init",
        "devices": device_manager.get_all_devices(),
        "playback": show_engine.get_state(),
        "show_snapshot": show_engine.get_snapshot(),
    })
    try:
        while True:
            data = await websocket.receive_json()
            await handle_ws_message(data, websocket)
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)


async def handle_ws_message(data: dict, ws: WebSocket):
    if not isinstance(data, dict):
        await ws.send_json({"type": "error", "message": "Invalid WebSocket message"})
        return

    msg_type = data.get("type")

    if not msg_type:
        await ws.send_json({"type": "error", "message": "Missing WebSocket message type"})
        return

    allowed_types = {
        "playback",
        "set_bpm",
        "device_command",
        "update_node_param",
        "sync_show",
        "request_show_snapshot",
        "save_show",
        "emergency_stop",
        "scan_devices",
    }

    if msg_type not in allowed_types:
        await ws.send_json({
            "type": "error",
            "message": f"Unsupported WebSocket message type: {msg_type}",
        })
        return

    if msg_type == "playback":
        action = data.get("action")
        if action == "play":
            started = await show_engine.play()
            if not started and getattr(show_engine, "last_error", ""):
                # Hardware conflict blocked the show — surface a clear error to the operator.
                await ws_manager.broadcast({
                    "type": "log",
                    "level": "error",
                    "message": show_engine.last_error,
                })
                await ws_manager.broadcast({
                    "type": "hardware_conflict",
                    "message": show_engine.last_error,
                    "conflicts": show_engine.get_hardware_conflicts(),
                })
        elif action == "stop":
            await show_engine.stop_playback()
        elif action == "pause":
            await show_engine.pause()
        elif action == "record":
            await show_engine.start_recording()
        elif action == "seek":
            await show_engine.seek(data.get("position", 0))
        await broadcast_playback_state()

    elif msg_type == "set_bpm":
        show_engine.set_bpm(float(data.get("bpm", 128)))
        await broadcast_playback_state()
        await broadcast_show_snapshot()

    elif msg_type == "device_command":
        device_id = data.get("device_id")
        command = data.get("command") or {}
        show_engine.record_device_command(device_id, command)
        result = await device_manager.send_command(device_id, command)
        await ws.send_json({"type": "device_response", "result": result})

    elif msg_type == "update_node_param":
        node_id = data.get("node_id")
        key = data.get("key")
        value = data.get("value")
        show_engine.update_node_param(node_id, key, value)
        await ws_manager.broadcast({
            "type": "node_updated",
            "node_id": node_id,
            "key": key,
            "value": value,
        })
        await broadcast_show_snapshot()

    elif msg_type == "sync_show":
        payload = data.get("payload") or {}
        apply_show_payload(payload)
        # ── FIX: Safely extract revision — key may not exist
        try:
            state = show_engine.get_state()
            revision = int(data.get("revision", state.get("revision", 0)))
        except (ValueError, TypeError, AttributeError):
            revision = 0
        await ws.send_json({"type": "sync_ack", "revision": revision})
        await broadcast_show_snapshot()

    elif msg_type == "request_show_snapshot":
        await broadcast_show_snapshot(target=ws)
        await broadcast_playback_state(target=ws)

    elif msg_type == "save_show":
        payload = data.get("payload") or {}
        apply_show_payload(payload)
        await broadcast_show_snapshot()

    elif msg_type == "emergency_stop":
        # AF-HUB-006B — one authority halts every output subsystem (safety kernel,
        # show engine, protocol bus, hardware output, device manager) in one call,
        # fault-tolerantly. Replaces the old partial + AttributeError-prone sequence.
        from engine.runtime_authority import runtime_authority
        await runtime_authority.emergency_stop(source="websocket-operator")
        await ws_manager.broadcast({
            "type": "emergency_stop",
            "state": show_engine.get_state(),
        })
        await ws_manager.broadcast({
            "type": "log",
            "level": "error",
            "message": "EMERGENCY STOP executed",
        })
        await broadcast_playback_state()

    elif msg_type == "scan_devices":
        discovered = await device_manager.scan_network()
        await ws.send_json({"type": "device_update", "devices": discovered})


@app.get("/api/health")
async def health():
    safety_status = {}
    transport_status = {}
    try:
        safety_status = get_safety_kernel().get_status()
        transport_status = get_transport().get_status()
    except Exception:
        pass
    return {
        "status": "ok",
        "version": APP_VERSION,
        "engine": show_engine.get_state(),
        "devices": device_manager.get_summary(),
        "protocols": protocol_bus.get_status(),
        "safety": safety_status,
        "transport": transport_status,
        "config": {
            "cors": ALLOWED_ORIGINS,
            "ws_path": "/ws",
            "api_base": "/api",
        },
    }


if __name__ == "__main__":
    import os

    # AF-HUB-000B — Production startup mode.
    #
    # Production default: NO reload, NO dev file watchers. uvicorn's reload=True spawns
    # a file-watching supervisor that can restart the process mid-show — unacceptable
    # for a live fountain-control platform (it would drop output and re-init hardware).
    # Auto-reload is therefore OPT-IN for development only, behind an explicit flag.
    #
    #   Production (default):   python main.py
    #   Development (opt-in):    AQUAFLOW_DEV=1 python main.py   (auto-reload + watchers)
    #
    # Host/port are overridable via AQUAFLOW_HOST / AQUAFLOW_PORT.
    _truthy = ("1", "true", "yes", "on")
    dev_mode = os.getenv("AQUAFLOW_DEV", "").strip().lower() in _truthy
    host = os.getenv("AQUAFLOW_HOST", "0.0.0.0")
    port = int(os.getenv("AQUAFLOW_PORT", "8000"))

    if dev_mode:
        # Developer convenience ONLY — file watchers + auto-reload. Never use this in a
        # packaged/production deployment. Reload needs the import-string form of the app.
        print("[startup] DEV MODE — auto-reload + file watchers ENABLED (AQUAFLOW_DEV set). "
              "Do NOT use this in production.")
        uvicorn.run("main:app", host=host, port=port, reload=True)
    else:
        # Production: single process, no reload, no watchers. Pass the app object directly
        # (the import-string form is only needed for reload/workers).
        print(f"[startup] PRODUCTION MODE — no reload, no dev watchers "
              f"(set AQUAFLOW_DEV=1 for development). Serving on {host}:{port}.")
        uvicorn.run(app, host=host, port=port, reload=False)
