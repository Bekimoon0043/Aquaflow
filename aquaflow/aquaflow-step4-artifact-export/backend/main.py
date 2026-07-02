"""
AquaFlow Studio Backend
FastAPI server with WebSocket real-time communication
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import os
import uvicorn
from contextlib import asynccontextmanager

from api.routes import shows, devices, ai_engine, protocols, audio, plc, scheduler as scheduler_routes, runtime
from app_state import show_engine, device_manager, protocol_bus, load_saved_show, apply_show_payload
from engine.network_scanner import hardware_output
from plc.plc_engine import plc_manager
from scheduler.scheduler_engine import scheduler_engine

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


async def scheduler_start_show(slot_id: str, show_id: str):
    payload = load_saved_show(show_id)
    if not payload:
        if ws_manager.active:
            await ws_manager.broadcast({
                "type": "log",
                "level": "error",
                "message": f"Scheduled show '{show_id}' not found for slot {slot_id}",
            })
        return

    apply_show_payload(payload)
    await show_engine.seek(0)
    await show_engine.play()
    if ws_manager.active:
        await broadcast_show_snapshot()
        await broadcast_playback_state()
        await ws_manager.broadcast({
            "type": "log",
            "level": "info",
            "message": f"Scheduler started show '{show_id}' for slot {slot_id}",
        })


async def scheduler_stop_show(slot_id: str):
    await show_engine.stop_playback()
    if ws_manager.active:
        await broadcast_playback_state()
        await ws_manager.broadcast({
            "type": "log",
            "level": "info",
            "message": f"Scheduler stopped slot {slot_id}",
        })


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🌊 LuxuryCon Fountain Studio starting...")
    scheduler_engine.set_callbacks(scheduler_start_show, scheduler_stop_show)
    await device_manager.start()
    await protocol_bus.start()
    await hardware_output.start()
    await plc_manager.start()
    await show_engine.start(device_manager, protocol_bus)
    await scheduler_engine.start()
    telem_task = asyncio.create_task(telemetry_broadcast_loop())
    print("✅ LuxuryCon Fountain Studio ready")
    yield
    print("🛑 LuxuryCon Fountain Studio shutting down...")
    telem_task.cancel()
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


async def telemetry_broadcast_loop():
    """Push playback frequently and device status periodically."""
    tick = 0
    while True:
        try:
            await asyncio.sleep(0.25)
            if not ws_manager.active:
                continue
            await broadcast_playback_state()
            tick += 1
            if tick % 8 == 0:
                await ws_manager.broadcast({
                    "type": "device_update",
                    "devices": device_manager.get_all_devices(),
                })
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
    allow_origin_regex=r"https?://(localhost|127\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(shows.router,            prefix="/api/shows",     tags=["Shows"])
app.include_router(devices.router,          prefix="/api/devices",   tags=["Devices"])
app.include_router(ai_engine.router,        prefix="/api/ai",        tags=["AI"])
app.include_router(protocols.router,        prefix="/api/protocols", tags=["Protocols"])
app.include_router(audio.router,            prefix="/api/audio",     tags=["Audio"])
app.include_router(plc.router,              prefix="/api/plc",       tags=["PLC"])
app.include_router(scheduler_routes.router, prefix="/api/scheduler", tags=["Scheduler"])
app.include_router(runtime.router,          prefix="/api/runtime",   tags=["Runtime"])


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
    msg_type = data.get("type")

    if msg_type == "playback":
        action = data.get("action")
        if action == "play":
            await show_engine.play()
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
        show_engine.apply_snapshot(data.get("payload") or {})
        revision = int(data.get("revision", show_engine.get_state().get("revision", 0)))
        show_engine.state.revision = revision
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
        await show_engine.stop_playback()
        await device_manager.emergency_stop()
        await ws_manager.broadcast({
            "type": "emergency_stop",
            "state": show_engine.get_state(),
        })
        await ws_manager.broadcast({
            "type": "log",
            "level": "error",
            "message": "🚨 EMERGENCY STOP executed",
        })
        await broadcast_playback_state()

    elif msg_type == "scan_devices":
        discovered = await device_manager.scan_network()
        await ws.send_json({"type": "device_update", "devices": discovered})


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "version": APP_VERSION,
        "engine": show_engine.get_state(),
        "devices": device_manager.get_summary(),
        "protocols": protocol_bus.get_status(),
        "config": {
            "cors": ALLOWED_ORIGINS,
            "ws_path": "/ws",
            "api_base": "/api",
        },
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
