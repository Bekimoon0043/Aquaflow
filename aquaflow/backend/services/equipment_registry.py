"""
equipment_registry.py — AF-NEXT-012 (Fixture data trust)

The "verified" equipment set: manufacturer-datasheet and user-measured models of
nozzles, pumps, valves and lights, each carrying a provenance block
(services/equipment_provenance.py).

Two JSON locations are read, in this order (a later entry with the same id wins):

  1. bundled  — backend/data/equipment_models/{kind}.json   (ships with the app;
                read-only in the packaged build; deliberately EMPTY — AquaFlow does
                not ship manufacturer data it has no licence/permission to publish)
  2. user     — $AQUAFLOW_DATA_DIR/equipment_models/{kind}.json   (default
                ~/.aquaflow) — where models entered in the UI are saved.

Files named ``*.example.json`` are documentation only and are never loaded.

Record shape:
    {"id", "kind", "label", "fixture_key"?, "provenance": {...}, "data": {...}}

Kind-specific ``data``:
    nozzle: {"nozzle_type", "orifice_mm"?, "k_factor"?,
             "pressure_flow_points": [{"pressure" bar, "flow" L/min, "jet_height"? m}]}
    pump:   {"flows": [m3/s], "heads": [m], "efficiency"?: {"flows": [...], "values": [...]}}
    valve:  {"kv" m3/h/sqrt(bar), "characteristic"?, "rangeability"?, "size"?}
    light:  {"power_w", "voltage_v"?, "dmx_channels", "beam_angle_deg"?, "luminous_flux_lm"?}

A new record is VALIDATED (provenance + data) and refused when it does not meet
the trust rules — a measured model without a date, or a "datasheet" without a
document/revision/licence note, is never stored as such.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Optional

from services.equipment_provenance import (
    SOURCE_GENERIC, SOURCE_MEASURED, UNITS, normalize_provenance, validate_provenance,
)

KINDS = ("nozzle", "pump", "valve", "light")
FILE_SCHEMA = "aquaflow.equipment-models/1"
BUNDLED_DIR = Path(__file__).parent.parent / "data" / "equipment_models"


def user_dir() -> Path:
    root = Path(os.getenv("AQUAFLOW_DATA_DIR", Path.home() / ".aquaflow"))
    return root / "equipment_models"


def _read(path: Path) -> list[dict]:
    if not path.exists() or path.name.endswith(".example.json"):
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    models = data.get("models", []) if isinstance(data, dict) else data
    return [m for m in models or [] if isinstance(m, dict)]


def _num(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None   # NaN guard


def validate_model(record: dict) -> list[str]:
    """Problems with a submitted model record (empty list = acceptable)."""
    if not isinstance(record, dict):
        return ["model must be an object"]
    errors: list[str] = []
    kind = str(record.get("kind", ""))
    if kind not in KINDS:
        errors.append(f"kind must be one of {', '.join(KINDS)}")
        return errors
    if not str(record.get("label") or record.get("id") or "").strip():
        errors.append("label is required")
    prov = record.get("provenance")
    if not isinstance(prov, dict):
        errors.append("provenance is required")
    else:
        if prov.get("source") == SOURCE_GENERIC:
            errors.append("the verified set only accepts manufacturer_datasheet or user_measured "
                          "models — generic estimates stay in the generic library")
        errors += validate_provenance(prov)
    data = record.get("data") if isinstance(record.get("data"), dict) else {}
    if kind == "nozzle":
        pts = [p for p in data.get("pressure_flow_points", []) if isinstance(p, dict)]
        good = [p for p in pts if (_num(p.get("pressure")) or 0) > 0 and (_num(p.get("flow")) or -1) >= 0]
        if len(good) != len(pts):
            errors.append("every nozzle point needs pressure > 0 bar and flow >= 0 L/min")
        if (_num(data.get("k_factor")) or 0) <= 0 and len(good) < 2:
            errors.append("nozzle needs a k_factor or at least 2 measured pressure/flow points")
    elif kind == "pump":
        flows, heads = data.get("flows") or [], data.get("heads") or []
        if len(flows) < 3 or len(flows) != len(heads):
            errors.append("pump curve needs >= 3 flow/head points of equal length")
        elif any(_num(x) is None for x in list(flows) + list(heads)):
            errors.append("pump curve points must be numbers")
        elif any(float(q) < 0 for q in flows) or any(float(h) < 0 for h in heads):
            errors.append("pump curve flow/head must be >= 0")
    elif kind == "valve":
        if (_num(data.get("kv")) or 0) <= 0:
            errors.append("valve needs kv > 0 (m3/h/sqrt(bar))")
    elif kind == "light":
        ch = _num(data.get("dmx_channels"))
        if ch is None or ch < 0 or int(ch) != ch:
            errors.append("light needs an integer dmx_channels >= 0")
        if (_num(data.get("power_w")) or -1) < 0:
            errors.append("light needs power_w >= 0")
    return errors


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", str(text)).strip("-")[:80] or "model"


def normalize_model(record: dict, origin: str = "user") -> dict:
    kind = str(record.get("kind"))
    prov = normalize_provenance(record.get("provenance"), kind=kind,
                                model=str(record.get("label") or ""))
    rid = _slug(record.get("id") or f"{kind}-{prov.get('manufacturer') or 'measured'}-{record.get('label')}")
    return {
        "id": rid,
        "kind": kind,
        "label": str(record.get("label") or rid),
        "fixture_key": str(record.get("fixture_key") or ""),
        "provenance": prov,
        "data": dict(record.get("data") or {}),
        "origin": origin,
        "example": bool(record.get("example", False)),
    }


class EquipmentRegistry:
    def __init__(self, bundled_dir: Optional[Path] = None, user_root: Optional[Path] = None):
        self.bundled_dir = Path(bundled_dir) if bundled_dir else BUNDLED_DIR
        self._user_root = Path(user_root) if user_root else None

    @property
    def user_dir(self) -> Path:
        return self._user_root if self._user_root else user_dir()

    # ── Read ───────────────────────────────────────────────────────────────────
    def list(self, kind: Optional[str] = None) -> list[dict]:
        kinds = [kind] if kind else list(KINDS)
        out: dict[tuple, dict] = {}
        for k in kinds:
            if k not in KINDS:
                raise ValueError(f"unknown equipment kind '{k}'")
            for origin, base in (("bundled", self.bundled_dir), ("user", self.user_dir)):
                for raw in _read(base / f"{k}.json"):
                    raw = {**raw, "kind": k}
                    if validate_model(raw):
                        continue          # invalid records are never served as verified
                    m = normalize_model(raw, origin=origin)
                    out[(k, m["id"])] = m
        return sorted(out.values(), key=lambda m: (m["kind"], m["id"]))

    def get(self, kind: str, model_id: str) -> Optional[dict]:
        return next((m for m in self.list(kind) if m["id"] == model_id), None)

    # ── Write (user dir only) ──────────────────────────────────────────────────
    def add(self, record: dict, replace: bool = False) -> dict:
        errors = validate_model(record)
        if errors:
            raise ValueError("; ".join(errors))
        model = normalize_model(record, origin="user")
        path = self.user_dir / f"{model['kind']}.json"
        models = _read(path)
        existing = [i for i, m in enumerate(models) if _slug(m.get("id", "")) == model["id"]]
        if existing and not replace:
            raise ValueError(f"model id '{model['id']}' already exists (pass replace=true to update)")
        stored = {k: model[k] for k in ("id", "kind", "label", "fixture_key", "provenance", "data")}
        if existing:
            models[existing[0]] = stored
        else:
            models.append(stored)
        self._write(path, model["kind"], models)
        return model

    def delete(self, kind: str, model_id: str) -> bool:
        path = self.user_dir / f"{kind}.json"
        models = _read(path)
        keep = [m for m in models if _slug(m.get("id", "")) != model_id]
        if len(keep) == len(models):
            return False
        self._write(path, kind, keep)
        return True

    @staticmethod
    def _write(path: Path, kind: str, models: list[dict]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"schema": FILE_SCHEMA, "kind": kind, "models": models}
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, indent=2, ensure_ascii=False)
        os.replace(tmp, path)


def schema_description() -> dict:
    """Machine-readable schema for the UI form."""
    return {
        "kinds": list(KINDS),
        "sources": ["manufacturer_datasheet", SOURCE_MEASURED],
        "confidence": ["high", "medium", "low"],
        "units": {k: UNITS[k] for k in KINDS},
        "required": {
            "manufacturer_datasheet": ["manufacturer", "model", "document", "revision", "licence"],
            "user_measured": ["model", "date"],
        },
    }


_registry: Optional[EquipmentRegistry] = None


def get_equipment_registry() -> EquipmentRegistry:
    global _registry
    if _registry is None:
        _registry = EquipmentRegistry()
    return _registry
