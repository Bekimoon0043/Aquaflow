"""API Routes — Operating Hours Scheduler"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import uuid
from scheduler.scheduler_engine import scheduler_engine, TimeSlot, CalendarDay

router = APIRouter()


class SlotCreate(BaseModel):
    name: str
    show_id: str = "show-001"
    show_name: str = "Main Show"
    start_time: str = "20:00"
    stop_time: str = "22:00"
    days: list = []
    active: bool = True
    loop: bool = True
    fade_in: float = 3.0
    fade_out: float = 5.0
    color: str = "#c9a227"
    notes: str = ""
    relative_to: str = ""
    relative_offset_min: int = 0


class SlotUpdate(BaseModel):
    name: Optional[str] = None
    start_time: Optional[str] = None
    stop_time: Optional[str] = None
    days: Optional[list] = None
    active: Optional[bool] = None
    loop: Optional[bool] = None
    notes: Optional[str] = None
    color: Optional[str] = None
    relative_to: Optional[str] = None
    relative_offset_min: Optional[int] = None


class CalendarDayCreate(BaseModel):
    date: str
    type: str = "blackout"
    label: str = ""
    custom_slots: list = []
    notes: str = ""
    color: str = "#ef4444"


class LocationUpdate(BaseModel):
    lat: float
    lon: float


# ── Slots ──────────────────────────────────────────────────────────────────────

@router.get("/slots")
async def list_slots():
    return {"slots": scheduler_engine.list_slots()}


@router.post("/slots")
async def create_slot(req: SlotCreate):
    slot = TimeSlot(id=f"slot-{str(uuid.uuid4())[:8]}", **req.dict())
    return scheduler_engine.add_slot(slot).to_dict()


@router.get("/slots/{slot_id}")
async def get_slot(slot_id: str):
    s = scheduler_engine.get_slot(slot_id)
    if not s: raise HTTPException(404, "Slot not found")
    return s.to_dict()


@router.patch("/slots/{slot_id}")
async def update_slot(slot_id: str, req: SlotUpdate):
    updates = {k: v for k, v in req.dict().items() if v is not None}
    result = scheduler_engine.update_slot(slot_id, updates)
    if not result: raise HTTPException(404, "Slot not found")
    return result.to_dict()


@router.delete("/slots/{slot_id}")
async def delete_slot(slot_id: str):
    if not scheduler_engine.delete_slot(slot_id):
        raise HTTPException(404, "Slot not found")
    return {"deleted": slot_id}


@router.post("/slots/{slot_id}/toggle")
async def toggle_slot(slot_id: str):
    s = scheduler_engine.get_slot(slot_id)
    if not s: raise HTTPException(404, "Slot not found")
    result = scheduler_engine.update_slot(slot_id, {"active": not s.active})
    return {"active": result.active}


# ── Calendar ───────────────────────────────────────────────────────────────────

@router.get("/calendar/{year}/{month}")
async def get_calendar_month(year: int, month: int):
    days = scheduler_engine.get_calendar_month(year, month)
    return {"year": year, "month": month, "days": days}


@router.post("/calendar")
async def add_calendar_day(req: CalendarDayCreate):
    cal = CalendarDay(**req.dict())
    return scheduler_engine.add_calendar_day(cal).to_dict()


@router.delete("/calendar/{date_str}")
async def delete_calendar_day(date_str: str):
    if not scheduler_engine.delete_calendar_day(date_str):
        raise HTTPException(404, "Calendar entry not found")
    return {"deleted": date_str}


# ── Schedule Queries ───────────────────────────────────────────────────────────

@router.get("/today")
async def get_today():
    from datetime import date
    return scheduler_engine.get_schedule_for_date(date.today())


@router.get("/date/{date_str}")
async def get_date_schedule(date_str: str):
    from datetime import date as date_type
    try:
        d = date_type.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(400, "Invalid date format. Use YYYY-MM-DD")
    return scheduler_engine.get_schedule_for_date(d)


@router.get("/upcoming")
async def get_upcoming(hours: int = 24):
    return {"upcoming": scheduler_engine.get_upcoming_slots(hours)}


@router.get("/status")
async def get_status():
    return scheduler_engine.get_status()


@router.get("/sun-times")
async def get_sun_times(lat: float = 9.0, lon: float = 38.7):
    return scheduler_engine.get_sun_times(lat, lon)


@router.post("/location")
async def set_location(req: LocationUpdate):
    scheduler_engine.location_lat = req.lat
    scheduler_engine.location_lon = req.lon
    scheduler_engine._save()
    return {"lat": req.lat, "lon": req.lon, "sun_times": scheduler_engine.get_sun_times(req.lat, req.lon)}


@router.get("/week")
async def get_week_schedule():
    """Get schedule for the next 7 days"""
    from datetime import date, timedelta
    result = []
    today = date.today()
    for i in range(7):
        d = today + timedelta(days=i)
        result.append(scheduler_engine.get_schedule_for_date(d))
    return {"week": result}
