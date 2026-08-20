"""
I-CAN channel map — the bridge between raw protocol channels and real fountain devices.

A capture tells us WHICH (group, channel) pairs the controller drives. This module
records WHAT each one physically is (pool lights, a jet ring, a pump, ...), plus its
device type and a per-channel safety ceiling. That mapping is what lets AquaFlow later
send a named-device command instead of a raw frame.

Pure data + JSON persistence — no sockets, no hardware. Safe to edit any time.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger("ican.mapping")

# Device types AquaFlow understands. 'unknown' = detected but not yet identified.
DEVICE_TYPES = (
    "lighting", "jet", "pump", "valve", "flame", "fog",
    "water_curtain", "laser", "aux", "unknown",
)

# Types that are inherently hazardous — a channel of these types must never be driven
# by a lights-only mapping/verification pass.
HAZARDOUS_TYPES = frozenset({"pump", "valve", "flame", "laser"})

DEFAULT_MAP_PATH = Path(__file__).resolve().parent.parent / "data" / "ican_channel_map.json"


@dataclass
class ChannelAssignment:
    group: int
    channel: int
    label: str = ""                    # human name, e.g. "Pool ring lights"
    device_type: str = "unknown"
    safety_max: float = 1.0            # per-channel intensity ceiling 0..1
    detected: bool = True              # seen in a capture
    notes: str = ""

    def key(self) -> str:
        return f"{self.group}:{self.channel}"

    def to_dict(self) -> dict:
        return asdict(self)


class ChannelMap:
    def __init__(self, path: Path = DEFAULT_MAP_PATH):
        self._path = Path(path)
        self._items: dict[str, ChannelAssignment] = {}

    # ── editing ───────────────────────────────────────────────────────────────
    def assign(self, group: int, channel: int, *, label: str = None,
               device_type: str = None, safety_max: float = None,
               notes: str = None, detected: bool = None) -> ChannelAssignment:
        """Create or update one channel's mapping. Only the fields passed are changed."""
        if device_type is not None and device_type not in DEVICE_TYPES:
            raise ValueError(f"device_type must be one of {DEVICE_TYPES}")
        key = f"{int(group)}:{int(channel)}"
        cur = self._items.get(key) or ChannelAssignment(int(group), int(channel))
        if label is not None:
            cur.label = label
        if device_type is not None:
            cur.device_type = device_type
        if safety_max is not None:
            cur.safety_max = max(0.0, min(1.0, float(safety_max)))
        if notes is not None:
            cur.notes = notes
        if detected is not None:
            cur.detected = bool(detected)
        self._items[key] = cur
        return cur

    def import_detections(self, detections) -> int:
        """Seed the map from a decoded capture. `detections` is an iterable of
        {"group": int, "channels": [int, ...]}. New channels are added as 'unknown'
        and marked detected; existing labels are preserved. Returns count added."""
        added = 0
        for det in detections or []:
            group = int(det.get("group", 0))
            for ch in det.get("channels", []):
                key = f"{group}:{int(ch)}"
                if key not in self._items:
                    self._items[key] = ChannelAssignment(group, int(ch), detected=True)
                    added += 1
                else:
                    self._items[key].detected = True
        logger.info("imported %d new detected channels", added)
        return added

    def remove(self, group: int, channel: int) -> bool:
        return self._items.pop(f"{int(group)}:{int(channel)}", None) is not None

    # ── queries ───────────────────────────────────────────────────────────────
    def get(self, group: int, channel: int) -> Optional[ChannelAssignment]:
        return self._items.get(f"{int(group)}:{int(channel)}")

    def all(self) -> list[ChannelAssignment]:
        return sorted(self._items.values(), key=lambda a: (a.group, a.channel))

    def unlabelled(self) -> list[ChannelAssignment]:
        return [a for a in self.all() if not a.label or a.device_type == "unknown"]

    def summary(self) -> dict:
        items = self.all()
        by_type: dict[str, int] = {}
        for a in items:
            by_type[a.device_type] = by_type.get(a.device_type, 0) + 1
        return {
            "total": len(items),
            "labelled": sum(1 for a in items if a.label and a.device_type != "unknown"),
            "unlabelled": len(self.unlabelled()),
            "by_type": by_type,
        }

    def lighting_only_channels(self) -> list[ChannelAssignment]:
        """Channels safe for a lights-only verification pass (never hazardous types)."""
        return [a for a in self.all()
                if a.device_type == "lighting" and a.device_type not in HAZARDOUS_TYPES]

    # ── device-registry bridge ────────────────────────────────────────────────
    def to_device_registry(self) -> list[dict]:
        """Produce AquaFlow device-registry-shaped entries from labelled channels."""
        out = []
        for a in self.all():
            if not a.label:
                continue
            out.append({
                "device_id": f"ican-{a.group}-{a.channel}",
                "device_type": a.device_type,
                "label": a.label,
                "protocol": "ican",
                "ican_group": a.group,
                "ican_channel": a.channel,
                "safety_max": a.safety_max,
            })
        return out

    # ── persistence ───────────────────────────────────────────────────────────
    def load(self) -> "ChannelMap":
        if self._path.exists():
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            for d in raw.get("channels", []):
                a = ChannelAssignment(**{k: v for k, v in d.items()
                                         if k in ChannelAssignment.__dataclass_fields__})
                self._items[a.key()] = a
        return self

    def save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": "1.0", "channels": [a.to_dict() for a in self.all()]}
        self._path.write_text(json.dumps(payload, indent=2, ensure_ascii=False),
                              encoding="utf-8")

    def to_dict(self) -> dict:
        return {"channels": [a.to_dict() for a in self.all()], "summary": self.summary()}
