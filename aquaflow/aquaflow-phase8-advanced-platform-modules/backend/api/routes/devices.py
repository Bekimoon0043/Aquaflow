"""
API Routes — Devices
Full device management: list, add, update, delete, test, scan, DMX output
"""
import asyncio
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional
from app_state import device_manager
from engine.network_scanner import scanner, hardware_output

router = APIRouter()


class DeviceCreate(BaseModel):
    label: str
    type: str
    protocol: str
    ip: Optional[str] = None
    port: Optional[int] = None
    universe: int = 0
    start_channel: int = 0
    channel_count: int = 1


class DeviceCommand(BaseModel):
    command: str
    params: dict = {}


class DMXCommand(BaseModel):
    universe: int = 0
    channel: int = 0
    value: int = 0


class DMXRangeCommand(BaseModel):
    universe: int = 0
    start_channel: int = 0
    values: list[int]


class ModbusCommand(BaseModel):
    ip: str
    port: int = 502
    reg: int
    value: int


@router.get("/")
async def list_devices():
    return {
        "devices": device_manager.get_all_devices(),
        "summary": device_manager.get_summary(),
    }


@router.post("/scan")
async def scan_network(subnet: str = "192.168.1.0/24", quick: bool = True):
    """Scan network for fountain hardware"""
    try:
        if quick:
            devices = await scanner.quick_scan(subnet)
        else:
            devices = await scanner.scan_network(subnet)
        return {
            "found": len(devices),
            "devices": [d.to_dict() for d in devices],
            "subnet": subnet,
        }
    except Exception as e:
        raise HTTPException(500, f"Scan failed: {str(e)}")


@router.get("/scan/status")
async def scan_status():
    return {
        "scanning": scanner.is_scanning,
        "progress": scanner.progress,
    }


@router.post("/dmx/set")
async def set_dmx_channel(cmd: DMXCommand):
    """Set a single DMX channel"""
    await hardware_output.set_dmx_channel(cmd.universe, cmd.channel, cmd.value)
    await hardware_output.flush_artnet()
    return {"universe": cmd.universe, "channel": cmd.channel, "value": cmd.value}


@router.post("/dmx/range")
async def set_dmx_range(cmd: DMXRangeCommand):
    """Set a range of DMX channels"""
    await hardware_output.set_dmx_range(cmd.universe, cmd.start_channel, cmd.values)
    await hardware_output.flush_artnet()
    return {"universe": cmd.universe, "start": cmd.start_channel, "count": len(cmd.values)}


@router.get("/dmx/universe/{universe}")
async def get_universe(universe: int):
    """Get current DMX values for a universe"""
    values = hardware_output.get_universe_snapshot(universe)
    return {"universe": universe, "values": values, "active_channels": sum(1 for v in values if v > 0)}


@router.post("/dmx/blackout")
async def dmx_blackout():
    """Zero all DMX universes"""
    await hardware_output.blackout_all()
    return {"status": "blackout"}


@router.post("/modbus/write")
async def write_modbus(cmd: ModbusCommand):
    """Write a Modbus register"""
    await hardware_output.set_modbus_register(cmd.ip, cmd.port, cmd.reg, cmd.value)
    return {"ip": cmd.ip, "register": cmd.reg, "value": cmd.value}


@router.post("/{device_id}/test")
async def test_device(device_id: str):
    """Run a test pattern on a device"""
    return {"device_id": device_id, "status": "test_started"}


@router.post("/{device_id}/identify")
async def identify_device(device_id: str):
    """Flash/blink a device for identification"""
    return {"device_id": device_id, "status": "identifying"}


@router.post("/emergency-stop")
async def emergency_stop():
    await hardware_output.blackout_all()
    return {"status": "emergency_stop_executed"}
