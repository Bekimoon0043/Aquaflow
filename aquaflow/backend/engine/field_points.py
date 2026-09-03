"""
engine/field_points.py — AF-IO-002: the field point model, AquaFlow's INPUT side.

The output side of the platform has honest routing (AF-HUB-015 fail-closed, the
protocol support matrix). The input side never existed: the safety kernel models
every sensor a fountain needs and nothing has ever written those inputs. This module
is the data layer that changes that — a declared inventory of the physical points on
the field-I/O rack (the S7-1215C and/or Modbus remote I/O), and readings that carry
QUALITY, not just a number.

Fail-closed for inputs means: **a reading you don't have is not a permit.** So every
reading is `{value, quality, ts}` and quality is explicit:

  GOOD    — fresh, plausible, from a live device
  STALE   — the device stopped answering; this is the LAST value, not the current one
  FAULT   — the sensor itself is provably broken (4-20 mA under-range: a cut wire
            reads ~0 mA while a genuine zero reads 4 mA — that distinction IS the
            broken-wire detection, and it is why 4-20 mA is specified over 0-10 V)
  UNKNOWN — never read, or unreadable (bad address, no driver)

A 0-10 V input genuinely cannot distinguish "0 V because zero" from "0 V because the
wire fell off". We model that honestly: signal="0-10V" performs NO under-range fault
detection rather than pretending to a diagnostic the physics doesn't provide. The
1215C's two onboard AI are 0-10 V; the recommended SM 1231 provides 4-20 mA.

Scaling contract: `value = raw * scale + offset` — the same convention PLCTag uses.
`signal` + `raw_min`/`raw_max` are used ONLY for plausibility/fault checks, never for
scaling, so the two systems cannot fight.

Pure data + JSON persistence, mirroring engine/ican_mapping.py — no sockets, no
hardware. The poll loop that produces readings is AF-IO-003 (FieldIOManager); the
safety binding that consumes `binds_to`/`required` is AF-IO-004.
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path
from typing import Optional, Union

logger = logging.getLogger("aquaflow.field_io")

DEFAULT_POINTS_PATH = Path(__file__).resolve().parent.parent / "data" / "field_points.json"


class PointKind(str, Enum):
    AI = "AI"    # analog input  (level, pressure, flow, VFD speed feedback)
    DI = "DI"    # digital input (E-stop chain, floats, door switches, VFD fault relay)
    AO = "AO"    # analog output (the 1215C's 2 AO — ZONCEN speed reference, AF-IO-009)
    DO = "DO"    # digital output


class Quality(str, Enum):
    GOOD = "GOOD"
    STALE = "STALE"
    FAULT = "FAULT"
    UNKNOWN = "UNKNOWN"


# Signal kinds with distinct fault physics. Anything else (or "") = no signal-level
# diagnostics — the point is what it reads.
SIGNAL_4_20MA = "4-20mA"
SIGNAL_0_10V = "0-10V"
SIGNALS = ("", SIGNAL_4_20MA, SIGNAL_0_10V)

# A healthy 4-20 mA loop never reads below 4 mA; transmitters clamp at ~3.8 mA for
# genuine under-range. Below 3.5 mA there is no defensible reading — the loop is
# broken (cut wire, dead transmitter, blown fuse). NAMUR NE43 draws the same line.
CURRENT_LOOP_FAULT_MA = 3.5

# The safety-kernel input names a point may bind to (consumed by AF-IO-004). Kept
# here so a typo in a config file is rejected at load/assign time, not silently
# ignored at evaluation time.
BINDABLE_INPUTS = (
    "", "water_level_ok", "pressure_ok", "pump_running", "pump_flow_ok",
    "valve_positions_ok", "vfd_ok", "plc_heartbeat_ok", "thermal_ok",
    "estop_chain_closed", "heartbeat",
)


@dataclass
class Reading:
    """One observation of one point. The quality is part of the datum — a consumer
    that looks at .value without .quality is doing it wrong."""
    value: Optional[Union[float, bool]]
    quality: Quality
    ts: float                       # time.time() of the observation (0.0 = never)
    raw: Optional[int] = None       # the wire-level value, for the operator UI

    def to_dict(self) -> dict:
        return {"value": self.value, "quality": self.quality.value,
                "ts": self.ts, "raw": self.raw}

    def aged(self, now: Optional[float] = None, max_age: float = 5.0) -> "Reading":
        """Return this reading demoted to STALE if it is older than max_age.
        The last value is retained — an operator wants to see what the level WAS —
        but the quality says it is history, not the present."""
        now = time.time() if now is None else now
        if self.quality == Quality.GOOD and (now - self.ts) > max_age:
            return Reading(self.value, Quality.STALE, self.ts, self.raw)
        return self


UNKNOWN_READING = Reading(None, Quality.UNKNOWN, 0.0, None)


@dataclass
class FieldPoint:
    """One physical I/O point on the field rack."""
    id: str                          # e.g. "pressure_main", unique
    source: str                      # driver key: "modbus:192.168.5.20" / "s7:192.168.5.10"
    address: str                     # source dialect: "30001", "%MW3", "DB1.DBW4", "DB1.DBX0.1"
    kind: PointKind = PointKind.AI
    raw_type: str = "uint16"         # uint16 | int16 | bool | real
    scale: float = 1.0               # value = raw * scale + offset
    offset: float = 0.0
    unit: str = ""                   # "bar", "L/min", "%", ...
    deadband: float = 0.0            # publish suppression threshold (AF-IO-003/007)
    signal: str = ""                 # "", "4-20mA", "0-10V" — fault physics only
    raw_min: int = 0                 # raw counts at the signal's low end  (4 mA / 0 V)
    raw_max: int = 27648             # raw counts at the signal's high end (20 mA / 10 V)
                                     # 27648 = Siemens nominal span; ADAM uses 65535
    required: bool = False           # AF-IO-004: an un-GOOD required point withdraws permit
    binds_to: str = ""               # safety-kernel input name (BINDABLE_INPUTS)
    invert: bool = False             # DI sense: True = closed contact means False
    label: str = ""
    notes: str = ""

    def __post_init__(self):
        self.kind = PointKind(self.kind)
        if self.signal not in SIGNALS:
            raise ValueError(f"signal must be one of {SIGNALS}, got {self.signal!r}")
        if self.binds_to not in BINDABLE_INPUTS:
            raise ValueError(
                f"binds_to must be one of {BINDABLE_INPUTS}, got {self.binds_to!r}")
        if self.signal and self.raw_max <= self.raw_min:
            raise ValueError(
                f"raw_max ({self.raw_max}) must exceed raw_min ({self.raw_min}) "
                f"when a signal type is set")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["kind"] = self.kind.value
        return d

    # ── the quality judgment ─────────────────────────────────────────────────
    def milliamps(self, raw: int) -> Optional[float]:
        """Raw counts → loop current, defined only for 4-20 mA points."""
        if self.signal != SIGNAL_4_20MA:
            return None
        span = self.raw_max - self.raw_min
        return 4.0 + 16.0 * (raw - self.raw_min) / span

    def evaluate(self, raw, ts: Optional[float] = None) -> Reading:
        """Turn one raw sample into a quality-tagged Reading.

        raw=None (the driver could not produce a sample) is UNKNOWN — never a zero.
        A 4-20 mA sample below the 3.5 mA line is FAULT with value None — a broken
        loop has no reading, and reporting 0.0 would tell the safety kernel the
        tank is empty rather than that it is blind.
        """
        ts = time.time() if ts is None else ts
        if raw is None:
            return Reading(None, Quality.UNKNOWN, ts, None)

        if self.kind in (PointKind.DI, PointKind.DO) or self.raw_type == "bool":
            state = bool(raw)
            if self.invert:
                state = not state
            return Reading(state, Quality.GOOD, ts, int(bool(raw)))

        raw_i = int(raw)
        if self.raw_type == "int16" and raw_i >= 0x8000:
            raw_i -= 0x10000          # registers arrive as uint16 off the wire

        ma = self.milliamps(raw_i)
        if ma is not None and ma < CURRENT_LOOP_FAULT_MA:
            return Reading(None, Quality.FAULT, ts, raw_i)

        return Reading(raw_i * self.scale + self.offset, Quality.GOOD, ts, raw_i)


class FieldPointStore:
    """The persisted inventory of field points. Mirrors ChannelMap's shape:
    in-memory dict, explicit load()/save(), JSON on disk beside the channel map."""

    def __init__(self, path: Path = DEFAULT_POINTS_PATH):
        self._path = Path(path)
        self._points: dict[str, FieldPoint] = {}

    # ── editing ──────────────────────────────────────────────────────────────
    def upsert(self, **kwargs) -> FieldPoint:
        """Create or replace one point. Validation lives in FieldPoint.__post_init__,
        so a malformed definition is rejected here — at the form — not at poll time."""
        pid = str(kwargs.get("id") or "").strip()
        if not pid:
            raise ValueError("field point needs a non-empty id")
        kwargs["id"] = pid
        known = FieldPoint.__dataclass_fields__
        point = FieldPoint(**{k: v for k, v in kwargs.items() if k in known})
        self._points[pid] = point
        return point

    def remove(self, point_id: str) -> bool:
        return self._points.pop(str(point_id), None) is not None

    # ── queries ──────────────────────────────────────────────────────────────
    def get(self, point_id: str) -> Optional[FieldPoint]:
        return self._points.get(str(point_id))

    def all(self) -> list[FieldPoint]:
        return sorted(self._points.values(), key=lambda p: p.id)

    def by_source(self) -> dict[str, list[FieldPoint]]:
        """Points grouped by driver key — the poll loop's work list."""
        out: dict[str, list[FieldPoint]] = {}
        for p in self.all():
            out.setdefault(p.source, []).append(p)
        return out

    def required_points(self) -> list[FieldPoint]:
        return [p for p in self.all() if p.required]

    def bound_points(self) -> list[FieldPoint]:
        return [p for p in self.all() if p.binds_to]

    def summary(self) -> dict:
        pts = self.all()
        by_kind: dict[str, int] = {}
        for p in pts:
            by_kind[p.kind.value] = by_kind.get(p.kind.value, 0) + 1
        return {
            "total": len(pts),
            "required": sum(1 for p in pts if p.required),
            "bound": sum(1 for p in pts if p.binds_to),
            "by_kind": by_kind,
            "sources": sorted({p.source for p in pts}),
        }

    # ── persistence ──────────────────────────────────────────────────────────
    def load(self) -> "FieldPointStore":
        if self._path.exists():
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            for d in raw.get("points", []):
                try:
                    known = FieldPoint.__dataclass_fields__
                    p = FieldPoint(**{k: v for k, v in d.items() if k in known})
                    self._points[p.id] = p
                except (TypeError, ValueError) as e:
                    # A corrupt entry must not take the whole inventory down, but it
                    # must be LOUD — a silently dropped required point is exactly the
                    # blind spot this module exists to remove.
                    logger.error("field point entry rejected on load: %s (%r)", e, d)
        return self

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": "1.0", "points": [p.to_dict() for p in self.all()]}
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False),
                              encoding="utf-8")

    def to_dict(self) -> dict:
        return {"points": [p.to_dict() for p in self.all()], "summary": self.summary()}
