"""
LuxuryCon Fountain Studio — Operating Hours Scheduler
Full operational scheduling:
- Multiple time slots per day (morning/lunch/evening/night sessions)
- Each slot has start time, stop time, show assignment
- Day-of-week configuration per slot
- Annual calendar: specific date overrides, blackout dates, special events
- Sunrise/sunset relative scheduling (+/- offset)
- Weather-based auto-cancellation
- Automatic show start AND stop commands
"""
import asyncio
import json
import logging
import math
from datetime import datetime, date, time, timedelta
from dataclasses import dataclass, field, asdict
from typing import Optional, Callable
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
SCHEDULE_FILE  = DATA_DIR / "schedule.json"
CALENDAR_FILE  = DATA_DIR / "calendar.json"


# ── Time Slot ──────────────────────────────────────────────────────────────────
@dataclass
class TimeSlot:
    """A single operating session — start time to stop time on selected days"""
    id: str
    name: str                        # e.g. "Morning Session", "Evening Show"
    show_id: str                     # which show to play
    show_name: str
    start_time: str                  # "HH:MM" 24h
    stop_time: str                   # "HH:MM" 24h
    days: list                       # [0=Mon,1=Tue,...,6=Sun] empty = every day
    active: bool = True
    loop: bool = True                # loop show until stop_time
    fade_in: float = 3.0             # seconds
    fade_out: float = 5.0            # seconds
    color: str = "#c9a227"
    notes: str = ""
    # Sunrise/sunset relative (overrides start_time if set)
    relative_to: str = ""            # "" | "sunrise" | "sunset"
    relative_offset_min: int = 0     # +/- minutes from sunrise/sunset
    # Stats
    run_count: int = 0
    last_run: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    def get_days_label(self) -> str:
        if not self.days:
            return "Every day"
        names = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
        return ", ".join(names[d] for d in sorted(self.days))

    def is_active_today(self, weekday: int) -> bool:
        """weekday: 0=Mon..6=Sun"""
        if not self.days:
            return True
        return weekday in self.days

    def get_start_datetime(self, for_date: date, lat: float = 9.0, lon: float = 38.7) -> Optional[datetime]:
        if self.relative_to in ("sunrise", "sunset"):
            sunrise, sunset = SunCalculator.calculate(lat, lon, datetime.combine(for_date, time()))
            base = sunrise if self.relative_to == "sunrise" else sunset
            base_dt = datetime.combine(for_date, base)
            return base_dt + timedelta(minutes=self.relative_offset_min)
        try:
            h, m = map(int, self.start_time.split(":"))
            return datetime.combine(for_date, time(h, m))
        except:
            return None

    def get_stop_datetime(self, for_date: date, lat: float = 9.0, lon: float = 38.7) -> Optional[datetime]:
        try:
            h, m = map(int, self.stop_time.split(":"))
            stop = datetime.combine(for_date, time(h, m))
            # Handle overnight slots (e.g. 23:00 - 01:00)
            start = self.get_start_datetime(for_date, lat, lon)
            if start and stop <= start:
                stop += timedelta(days=1)
            return stop
        except:
            return None


# ── Calendar Day Override ──────────────────────────────────────────────────────
@dataclass
class CalendarDay:
    """Override for a specific date"""
    date: str                        # "YYYY-MM-DD"
    type: str                        # "blackout" | "special" | "holiday" | "custom"
    label: str                       # e.g. "Ethiopian Christmas", "Maintenance Day"
    custom_slots: list = field(default_factory=list)  # slot IDs to run (empty = none if blackout)
    notes: str = ""
    color: str = "#ef4444"

    def to_dict(self) -> dict:
        return asdict(self)


# ── Sun Calculator ─────────────────────────────────────────────────────────────
class SunCalculator:
    @staticmethod
    def calculate(lat: float, lon: float, dt: datetime) -> tuple:
        n = dt.timetuple().tm_yday
        L = (280.460 + 0.9856474 * n) % 360
        g = math.radians((357.528 + 0.9856003 * n) % 360)
        lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2*g))
        eps = math.radians(23.439 - 0.0000004 * n)
        decl = math.asin(math.sin(eps) * math.sin(lam))
        lat_r = math.radians(lat)
        cos_ha = (math.cos(math.radians(90.833)) - math.sin(lat_r) * math.sin(decl)) / (math.cos(lat_r) * math.cos(decl))
        cos_ha = max(-1, min(1, cos_ha))
        ha = math.degrees(math.acos(cos_ha))
        B = math.radians(360/365 * (n - 81))
        EoT = 9.87*math.sin(2*B) - 7.53*math.cos(B) - 1.5*math.sin(B)
        lstm = 15 * round(lon / 15)
        noon = 12 - (lon - lstm)/15 - EoT/60
        def h2t(h):
            h = max(0, min(23.99, h))
            return time(int(h), int((h - int(h)) * 60))
        return h2t(noon - ha/15), h2t(noon + ha/15)


# ── Scheduler Engine ───────────────────────────────────────────────────────────
class SchedulerEngine:
    CHECK_INTERVAL = 20  # seconds

    def __init__(self):
        self._slots: dict[str, TimeSlot] = {}
        self._calendar: dict[str, CalendarDay] = {}  # date_str -> CalendarDay
        self._active_slot: Optional[str] = None      # currently running slot id
        self._running = False
        self._task = None
        self._on_start: Optional[Callable] = None    # cb(slot_id, show_id)
        self._on_stop:  Optional[Callable] = None    # cb(slot_id)
        self.location_lat: float = 9.0
        self.location_lon: float = 38.7
        self._load()

    def set_callbacks(self, on_start: Callable, on_stop: Callable):
        self._on_start = on_start
        self._on_stop  = on_stop

    # ── Public API ─────────────────────────────────────────────────────────────

    def add_slot(self, slot: TimeSlot) -> TimeSlot:
        self._slots[slot.id] = slot
        self._save()
        logger.info(f"Slot added: {slot.name} {slot.start_time}-{slot.stop_time} on {slot.get_days_label()}")
        return slot

    def update_slot(self, slot_id: str, updates: dict) -> Optional[TimeSlot]:
        slot = self._slots.get(slot_id)
        if not slot: return None
        for k, v in updates.items():
            if hasattr(slot, k): setattr(slot, k, v)
        self._save()
        return slot

    def delete_slot(self, slot_id: str) -> bool:
        if slot_id in self._slots:
            del self._slots[slot_id]
            self._save()
            return True
        return False

    def get_slot(self, slot_id: str) -> Optional[TimeSlot]:
        return self._slots.get(slot_id)

    def list_slots(self) -> list:
        return [s.to_dict() for s in sorted(self._slots.values(), key=lambda x: x.start_time)]

    def add_calendar_day(self, cal: CalendarDay) -> CalendarDay:
        self._calendar[cal.date] = cal
        self._save()
        return cal

    def delete_calendar_day(self, date_str: str) -> bool:
        if date_str in self._calendar:
            del self._calendar[date_str]
            self._save()
            return True
        return False

    def get_calendar_month(self, year: int, month: int) -> list:
        """Get all calendar overrides for a given month"""
        prefix = f"{year:04d}-{month:02d}"
        return [v.to_dict() for k, v in self._calendar.items() if k.startswith(prefix)]

    def get_schedule_for_date(self, for_date: date) -> dict:
        """Get the full schedule for a specific date"""
        date_str = for_date.strftime("%Y-%m-%d")
        weekday = for_date.weekday()
        cal_override = self._calendar.get(date_str)

        if cal_override and cal_override.type == "blackout":
            return {"date": date_str, "blackout": True, "label": cal_override.label, "slots": []}

        active_slots = []
        for slot in self._slots.values():
            if not slot.active: continue
            if cal_override and cal_override.custom_slots:
                if slot.id not in cal_override.custom_slots: continue
            elif not slot.is_active_today(weekday):
                continue
            start_dt = slot.get_start_datetime(for_date, self.location_lat, self.location_lon)
            stop_dt  = slot.get_stop_datetime(for_date, self.location_lat, self.location_lon)
            active_slots.append({
                **slot.to_dict(),
                "start_datetime": start_dt.isoformat() if start_dt else None,
                "stop_datetime":  stop_dt.isoformat()  if stop_dt  else None,
            })

        active_slots.sort(key=lambda x: x.get("start_datetime") or "")
        return {
            "date": date_str,
            "weekday": ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][weekday],
            "blackout": False,
            "special": cal_override.label if cal_override else None,
            "slots": active_slots,
        }

    def get_upcoming_slots(self, hours: int = 24) -> list:
        now = datetime.now()
        cutoff = now + timedelta(hours=hours)
        result = []
        current = now.date()
        while datetime.combine(current, time()) <= cutoff:
            day_sched = self.get_schedule_for_date(current)
            if not day_sched.get("blackout"):
                for slot in day_sched["slots"]:
                    start = slot.get("start_datetime")
                    stop  = slot.get("stop_datetime")
                    if start:
                        start_dt = datetime.fromisoformat(start)
                        if now <= start_dt <= cutoff:
                            mins = int((start_dt - now).total_seconds() / 60)
                            result.append({**slot, "minutes_until": mins, "date": current.isoformat()})
            current += timedelta(days=1)
        return sorted(result, key=lambda x: x.get("start_datetime",""))

    def get_sun_times(self, lat: float = None, lon: float = None) -> dict:
        lat = lat or self.location_lat
        lon = lon or self.location_lon
        now = datetime.now()
        sunrise, sunset = SunCalculator.calculate(lat, lon, now)
        return {
            "sunrise": sunrise.strftime("%H:%M"),
            "sunset": sunset.strftime("%H:%M"),
            "lat": lat, "lon": lon,
            "date": now.strftime("%Y-%m-%d"),
        }

    # ── Runtime ────────────────────────────────────────────────────────────────

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("Operating hours scheduler started")

    async def stop(self):
        self._running = False
        if self._task: self._task.cancel()

    async def _loop(self):
        while self._running:
            try:
                await self._tick()
                await asyncio.sleep(self.CHECK_INTERVAL)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Scheduler tick error: {e}")
                await asyncio.sleep(5)

    async def _tick(self):
        now = datetime.now()
        today = now.date()
        day_sched = self.get_schedule_for_date(today)

        if day_sched.get("blackout"):
            if self._active_slot:
                await self._stop_current()
            return

        # Find which slot should be running right now
        current_slot = None
        for slot_data in day_sched["slots"]:
            start = slot_data.get("start_datetime")
            stop  = slot_data.get("stop_datetime")
            if start and stop:
                start_dt = datetime.fromisoformat(start)
                stop_dt  = datetime.fromisoformat(stop)
                if start_dt <= now < stop_dt:
                    current_slot = slot_data
                    break

        if current_slot:
            if self._active_slot != current_slot["id"]:
                # Stop previous, start new
                if self._active_slot:
                    await self._stop_current()
                await self._start_slot(current_slot)
        else:
            if self._active_slot:
                await self._stop_current()

    async def _start_slot(self, slot_data: dict):
        slot_id = slot_data["id"]
        show_id = slot_data["show_id"]
        logger.info(f"Starting slot: {slot_data['name']} → show: {show_id}")
        self._active_slot = slot_id
        slot = self._slots.get(slot_id)
        if slot:
            slot.run_count += 1
            slot.last_run = datetime.now().isoformat()
        if self._on_start:
            await self._on_start(slot_id, show_id)
        self._save()

    async def _stop_current(self):
        logger.info(f"Stopping slot: {self._active_slot}")
        if self._on_stop:
            await self._on_stop(self._active_slot)
        self._active_slot = None

    def get_status(self) -> dict:
        now = datetime.now()
        today_sched = self.get_schedule_for_date(now.date())
        return {
            "running": self._running,
            "active_slot": self._active_slot,
            "location": {"lat": self.location_lat, "lon": self.location_lon},
            "total_slots": len(self._slots),
            "active_slots": sum(1 for s in self._slots.values() if s.active),
            "today_slots": len(today_sched["slots"]),
            "today_blackout": today_sched.get("blackout", False),
            "upcoming_24h": len(self.get_upcoming_slots(24)),
            "sun_times": self.get_sun_times(),
        }

    # ── Persistence ────────────────────────────────────────────────────────────

    def _save(self):
        try:
            SCHEDULE_FILE.write_text(json.dumps({
                "slots": [s.to_dict() for s in self._slots.values()],
                "location": {"lat": self.location_lat, "lon": self.location_lon},
            }, indent=2))
            CALENDAR_FILE.write_text(json.dumps({
                "days": [v.to_dict() for v in self._calendar.values()]
            }, indent=2))
        except Exception as e:
            logger.debug(f"Save error: {e}")

    def _load(self):
        try:
            if SCHEDULE_FILE.exists():
                data = json.loads(SCHEDULE_FILE.read_text())
                for s in data.get("slots", []):
                    fields = {k: v for k, v in s.items() if k in TimeSlot.__dataclass_fields__}
                    self._slots[s["id"]] = TimeSlot(**fields)
                loc = data.get("location", {})
                self.location_lat = loc.get("lat", 9.0)
                self.location_lon = loc.get("lon", 38.7)
            if CALENDAR_FILE.exists():
                data = json.loads(CALENDAR_FILE.read_text())
                for d in data.get("days", []):
                    self._calendar[d["date"]] = CalendarDay(**{k: v for k, v in d.items() if k in CalendarDay.__dataclass_fields__})
            logger.info(f"Loaded {len(self._slots)} slots, {len(self._calendar)} calendar overrides")
        except Exception as e:
            logger.debug(f"Load error: {e}")


scheduler_engine = SchedulerEngine()
