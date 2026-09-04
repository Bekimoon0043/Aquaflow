"""
API Routes — PLC Integration
Connect PLCs, browse tags, map to fountain devices, read/write values.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Any
from plc.plc_engine import (
    plc_manager, PLCConnection, PLCType, PLCTag, TagType, DEFAULT_TAGS,
    PLC_SUPPORT, PLC_TIER_MEANING, REAL_PLC_TYPES,
)

router = APIRouter()


class PLCConnectRequest(BaseModel):
    id: str
    name: str
    plc_type: str
    ip: str
    port: int = 102
    rack: int = 0
    slot: int = 1
    unit_id: int = 1
    scan_rate_ms: int = 100
    tags: list = []


class TagWriteRequest(BaseModel):
    value: Any


class TagMapRequest(BaseModel):
    tag_id: str
    device_id: str
    param: str


@router.get("/")
async def list_plcs():
    """List all configured PLCs and their status"""
    return {"plcs": plc_manager.get_status()}


@router.post("/connect")
async def connect_plc(req: PLCConnectRequest):
    """Add and connect a PLC"""
    try:
        plc_type = PLCType(req.plc_type)
    except ValueError:
        raise HTTPException(400, f"Unknown PLC type: {req.plc_type}")

    # Apply default tags if none provided
    if not req.tags and plc_type in DEFAULT_TAGS:
        default_tags = [dict(t, id=t["id"], description=t.get("description",""),
                            unit=t.get("unit",""), offset=0.0, mapped_device="",
                            current_value=None, last_updated=0.0)
                       for t in DEFAULT_TAGS[plc_type]]
    else:
        default_tags = req.tags

    config = PLCConnection(
        id=req.id, name=req.name, plc_type=plc_type,
        ip=req.ip, port=req.port, rack=req.rack, slot=req.slot,
        unit_id=req.unit_id, tags=default_tags, scan_rate_ms=req.scan_rate_ms,
    )
    result = await plc_manager.add_plc(config)
    # AF-IO-006 — a refused (non-REAL) type is a client error, loudly, not a stored
    # PLC that quietly never works.
    if result.get("refused"):
        raise HTTPException(400, result.get("error", "PLC type not supported"))
    return {
        "plc_id": req.id,
        "name": req.name,
        "connected": result["connected"],
        "error": result.get("error", ""),
        "tag_count": len(default_tags),
    }


@router.delete("/{plc_id}")
async def disconnect_plc(plc_id: str):
    """Disconnect and remove a PLC"""
    await plc_manager.remove_plc(plc_id)
    return {"removed": plc_id}


@router.get("/{plc_id}/tags")
async def get_tags(plc_id: str):
    """Get all tags for a PLC with current values"""
    status = plc_manager.get_status()
    plc = next((p for p in status if p["id"] == plc_id), None)
    if not plc:
        raise HTTPException(404, f"PLC '{plc_id}' not found")

    values = plc_manager.get_all_values()
    tags_with_values = []
    config = plc_manager._connections.get(plc_id)
    if config:
        for tag in config.tags:
            tag_copy = dict(tag)
            tag_copy["current_value"] = values.get(f"{plc_id}.{tag['id']}")
            tags_with_values.append(tag_copy)

    return {"plc_id": plc_id, "tags": tags_with_values}


@router.post("/{plc_id}/tags/{tag_id}/write")
async def write_tag(plc_id: str, tag_id: str, req: TagWriteRequest):
    """Write a value to a PLC tag"""
    success = await plc_manager.write_tag(plc_id, tag_id, req.value)
    return {"plc_id": plc_id, "tag_id": tag_id, "value": req.value, "success": success}


@router.get("/{plc_id}/values")
async def get_all_values(plc_id: str):
    """Get all current tag values for a PLC"""
    all_values = plc_manager.get_all_values()
    plc_values = {
        k.replace(f"{plc_id}.", ""): v
        for k, v in all_values.items()
        if k.startswith(f"{plc_id}.")
    }
    return {"plc_id": plc_id, "values": plc_values}


@router.post("/{plc_id}/map-tag")
async def map_tag(plc_id: str, req: TagMapRequest):
    """Map a PLC tag to a fountain device parameter"""
    config = plc_manager._connections.get(plc_id)
    if not config:
        raise HTTPException(404, "PLC not found")

    for tag in config.tags:
        if tag["id"] == req.tag_id:
            tag["mapped_device"] = req.device_id
            tag["mapped_param"] = req.param
            return {"mapped": True, "tag_id": req.tag_id, "device_id": req.device_id, "param": req.param}

    raise HTTPException(404, f"Tag '{req.tag_id}' not found")


@router.get("/types")
async def get_plc_types():
    """AF-IO-006 + operator request: list ALL PLC families, each honestly tiered.
    `connect_as` names the wire protocol actually used (Delta/Mitsubishi/Omron
    connect through their Modbus TCP interface, said out loud); entries with
    connectable=False have no driver at all — the UI disables Connect for them
    instead of the old silent wrong-driver connection."""
    return {
        "types": [
            {"id": "siemens_s7", "label": "Siemens S7 (S7-1200/1500, raw + snap7)",
             "port": 102, "tier": "REAL", "connect_as": "siemens_s7", "connectable": True},
            {"id": "modbus_tcp", "label": "Modbus TCP (Universal)",
             "port": 502, "tier": "REAL", "connect_as": "modbus_tcp", "connectable": True},
            {"id": "delta", "label": "Delta DVP/AS (via Modbus TCP)",
             "port": 502, "tier": "GATED", "connect_as": "modbus_tcp", "connectable": True},
            {"id": "mitsubishi", "label": "Mitsubishi MELSEC (via Modbus TCP)",
             "port": 502, "tier": "GATED", "connect_as": "modbus_tcp", "connectable": True},
            {"id": "omron", "label": "Omron CJ/CS/NX (via Modbus TCP)",
             "port": 502, "tier": "GATED", "connect_as": "modbus_tcp", "connectable": True},
            {"id": "opc_ua", "label": "OPC UA (driver gated — untested)",
             "port": 4840, "tier": "GATED", "connect_as": None, "connectable": False},
            {"id": "allen_bradley", "label": "Allen Bradley (identify-only)",
             "port": 44818, "tier": "UNSUPPORTED", "connect_as": None, "connectable": False},
            {"id": "beckhoff", "label": "Beckhoff TwinCAT (identify-only)",
             "port": 4840, "tier": "UNSUPPORTED", "connect_as": None, "connectable": False},
        ],
        "support": {
            "tiers": dict(PLC_TIER_MEANING),
            "plc_types": dict(PLC_SUPPORT),
            "usable": list(REAL_PLC_TYPES),
        },
    }


@router.get("/default-tags/{plc_type}")
async def get_default_tags(plc_type: str):
    """Get default tag templates for a PLC type"""
    try:
        ptype = PLCType(plc_type)
    except ValueError:
        raise HTTPException(400, f"Unknown PLC type: {plc_type}")

    tags = DEFAULT_TAGS.get(ptype, [])
    return {"plc_type": plc_type, "tags": tags}


@router.post("/test-connection")
async def test_connection(ip: str, plc_type: str = "modbus_tcp", port: int = 502):
    """Test if a PLC is reachable"""
    import asyncio
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(ip, port), timeout=2.0
        )
        writer.close()
        return {"reachable": True, "ip": ip, "port": port}
    except Exception as e:
        return {"reachable": False, "ip": ip, "port": port, "error": str(e)}
