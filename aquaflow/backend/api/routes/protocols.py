"""API Routes — Protocol Management"""
from fastapi import APIRouter
from app_state import protocol_bus

router = APIRouter()


@router.get("/")
async def protocol_root():
    return {"protocols": protocol_bus.get_status()}


@router.get("/status")
async def protocol_status():
    return {"protocols": protocol_bus.get_status()}

@router.post("/test/{protocol}")
async def test_protocol(protocol: str):
    return {"protocol": protocol, "status": "tested"}
