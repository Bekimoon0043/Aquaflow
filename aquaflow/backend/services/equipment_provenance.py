"""
equipment_provenance.py — AF-NEXT-012 (Fixture data trust)

One provenance schema shared by every piece of equipment data AquaFlow computes
with: nozzles, pumps (curve sets), valves, lights and the frontend fixture library.
The same contract is documented in docs/FIXTURE-DATA-PROVENANCE.md and mirrored in
frontend/src/data/fixtureProvenance.js.

    {
      "source":     "manufacturer_datasheet" | "user_measured" | "generic_estimate",
      "manufacturer": str, "model": str,
      "document":   {"title": str, "url": str, "file": str},
      "revision":   str,           # datasheet revision / measurement-run id
      "date":       "YYYY-MM-DD",  # datasheet issue date / measurement date
      "units":      {quantity: unit},
      "confidence": "high" | "medium" | "low",
      "licence":    str,           # licence / permission note for using the data
      "notes":      str,
    }

Trust rules (enforced by ``normalize_provenance``):

  * ``generic_estimate`` is ALWAYS confidence "low" and is never presented as a
    manufacturer specification — its display label is fixed to
    GENERIC_LABEL ("Generic estimate — verify with supplier datasheet").
  * ``manufacturer_datasheet`` requires manufacturer, model, a document (title, URL
    or file), a revision and a licence/permission note. A record that claims the
    source without them is DOWNGRADED to ``generic_estimate`` (with the reason kept
    in ``downgraded_from`` / ``downgrade_reason``) — never silently trusted.
  * ``user_measured`` requires a model and a measurement date.

``validate_provenance`` returns the list of problems instead of downgrading; it is
used when a user submits a new verified model, so the submission is refused rather
than stored as something it is not.
"""
from __future__ import annotations

from typing import Optional

SCHEMA_VERSION = "aquaflow.provenance/1"

SOURCE_MANUFACTURER = "manufacturer_datasheet"
SOURCE_MEASURED = "user_measured"
SOURCE_GENERIC = "generic_estimate"
SOURCES = (SOURCE_MANUFACTURER, SOURCE_MEASURED, SOURCE_GENERIC)
CONFIDENCE_LEVELS = ("high", "medium", "low")

GENERIC_LABEL = "Generic estimate — verify with supplier datasheet"
SOURCE_LABELS = {
    SOURCE_MANUFACTURER: "Manufacturer datasheet",
    SOURCE_MEASURED: "User measured",
    SOURCE_GENERIC: GENERIC_LABEL,
}

# Revision stamped on AquaFlow's own built-in generic templates. Bump it when the
# generic numbers change so old calculation reports remain traceable.
GENERIC_REVISION = "aquaflow-generic-2026.10"

# Default unit sets per equipment kind (what the numbers in the record mean).
UNITS = {
    "nozzle": {"pressure": "bar", "flow": "L/min", "jet_height": "m",
               "k_factor": "L/min/sqrt(bar)", "orifice": "mm"},
    "pump": {"flow": "m3/s", "head": "m", "efficiency": "fraction 0..1", "power": "W"},
    "valve": {"kv": "m3/h/sqrt(bar)", "flow": "m3/h", "pressure_drop": "bar"},
    "light": {"power": "W", "voltage": "V", "dmx_channels": "channels",
              "beam_angle": "deg", "luminous_flux": "lm"},
    "pipe": {"diameter": "m", "flow": "m3/s", "velocity": "m/s", "length": "m"},
    "equipment": {},
}


def _s(v) -> str:
    return "" if v is None else str(v).strip()


def _document(raw) -> dict:
    if isinstance(raw, str):
        raw = {"title": raw} if not raw.startswith(("http://", "https://")) else {"url": raw}
    raw = raw if isinstance(raw, dict) else {}
    return {"title": _s(raw.get("title")), "url": _s(raw.get("url")), "file": _s(raw.get("file"))}


def _has_document(doc: dict) -> bool:
    return any(doc.get(k) for k in ("title", "url", "file"))


def generic_provenance(kind: str = "equipment", model: str = "", manufacturer: str = "",
                       notes: str = "", units: Optional[dict] = None) -> dict:
    """The provenance block for an AquaFlow generic template / placeholder value."""
    return {
        "schema": SCHEMA_VERSION,
        "source": SOURCE_GENERIC,
        "manufacturer": _s(manufacturer),
        "model": _s(model),
        "document": {"title": "AquaFlow generic template", "url": "", "file": ""},
        "revision": GENERIC_REVISION,
        "date": "",
        "units": dict(units if units is not None else UNITS.get(kind, {})),
        "confidence": "low",
        "licence": "AquaFlow internal estimate — not supplier data",
        "notes": _s(notes) or GENERIC_LABEL,
        "label": GENERIC_LABEL,
    }


def validate_provenance(raw: dict) -> list[str]:
    """Problems that stop `raw` from being trusted as the source it claims."""
    if not isinstance(raw, dict):
        return ["provenance must be an object"]
    errors: list[str] = []
    source = _s(raw.get("source"))
    if source not in SOURCES:
        errors.append(f"source must be one of {', '.join(SOURCES)}")
        return errors
    conf = _s(raw.get("confidence"))
    if conf and conf not in CONFIDENCE_LEVELS:
        errors.append(f"confidence must be one of {', '.join(CONFIDENCE_LEVELS)}")
    doc = _document(raw.get("document"))
    if source == SOURCE_MANUFACTURER:
        for key in ("manufacturer", "model", "revision", "licence"):
            if not _s(raw.get(key)):
                errors.append(f"manufacturer_datasheet requires '{key}'")
        if not _has_document(doc):
            errors.append("manufacturer_datasheet requires a document title, URL or file")
    elif source == SOURCE_MEASURED:
        for key in ("model", "date"):
            if not _s(raw.get(key)):
                errors.append(f"user_measured requires '{key}'")
    elif conf and conf != "low":
        errors.append("generic_estimate confidence is always 'low'")
    return errors


def normalize_provenance(raw: Optional[dict], kind: str = "equipment",
                         model: str = "", manufacturer: str = "") -> dict:
    """Return a complete provenance block. Missing/invalid trust claims downgrade to
    generic_estimate — data is never upgraded by default."""
    if not isinstance(raw, dict) or not raw:
        return generic_provenance(kind, model=model, manufacturer=manufacturer)
    source = _s(raw.get("source"))
    problems = validate_provenance(raw)
    units = raw.get("units") if isinstance(raw.get("units"), dict) else UNITS.get(kind, {})
    if source != SOURCE_GENERIC and problems:
        out = generic_provenance(kind, model=_s(raw.get("model")) or model,
                                 manufacturer=_s(raw.get("manufacturer")) or manufacturer,
                                 notes=_s(raw.get("notes")), units=units)
        out["downgraded_from"] = source or "unspecified"
        out["downgrade_reason"] = "; ".join(problems)
        return out
    if source == SOURCE_GENERIC:
        out = generic_provenance(kind, model=_s(raw.get("model")) or model,
                                 manufacturer=_s(raw.get("manufacturer")) or manufacturer,
                                 notes=_s(raw.get("notes")), units=units)
        if _s(raw.get("revision")):
            out["revision"] = _s(raw.get("revision"))
        return out
    conf = _s(raw.get("confidence")) or ("high" if source == SOURCE_MANUFACTURER else "medium")
    return {
        "schema": SCHEMA_VERSION,
        "source": source,
        "manufacturer": _s(raw.get("manufacturer")) or manufacturer,
        "model": _s(raw.get("model")) or model,
        "document": _document(raw.get("document")),
        "revision": _s(raw.get("revision")),
        "date": _s(raw.get("date")),
        "units": dict(units),
        "confidence": conf,
        "licence": _s(raw.get("licence") or raw.get("license")),
        "notes": _s(raw.get("notes")),
        "label": SOURCE_LABELS[source],
    }


def is_verified(prov: Optional[dict]) -> bool:
    return bool(prov) and prov.get("source") in (SOURCE_MANUFACTURER, SOURCE_MEASURED)


def source_label(prov: Optional[dict]) -> str:
    if not prov:
        return GENERIC_LABEL
    return SOURCE_LABELS.get(prov.get("source"), GENERIC_LABEL)


def cite(prov: Optional[dict], equipment_model: str = "", kind: str = "equipment",
         units: Optional[dict] = None) -> dict:
    """Compact citation attached to every calculation result / BOM line:
    which equipment model, which data source, which units, which revision."""
    p = prov if isinstance(prov, dict) and prov.get("source") in SOURCES \
        else generic_provenance(kind, model=equipment_model)
    doc = p.get("document") or {}
    return {
        "equipment_model": _s(equipment_model) or _s(p.get("model")) or "unspecified",
        "manufacturer": _s(p.get("manufacturer")),
        "data_source": p.get("source", SOURCE_GENERIC),
        "source_label": source_label(p),
        "confidence": p.get("confidence", "low"),
        "units": dict(units if units is not None else (p.get("units") or UNITS.get(kind, {}))),
        "revision": _s(p.get("revision")) or "unrevisioned",
        "document": _s(doc.get("title") or doc.get("url") or doc.get("file")),
    }


def units_text(units: Optional[dict]) -> str:
    """'flow=L/min; pressure=bar' — compact for CSV/XLSX columns."""
    if not units:
        return ""
    return "; ".join(f"{k}={v}" for k, v in units.items())


def summarize(citations: list[dict]) -> dict:
    """Roll-up for a whole calculation: how much of it rests on generic estimates."""
    counts = {s: 0 for s in SOURCES}
    for c in citations:
        counts[c.get("data_source", SOURCE_GENERIC)] = counts.get(c.get("data_source", SOURCE_GENERIC), 0) + 1
    generic = counts.get(SOURCE_GENERIC, 0)
    return {
        "items": len(citations),
        "by_source": counts,
        "generic_items": generic,
        "all_verified": bool(citations) and generic == 0,
        "warning": (f"{generic} of {len(citations)} item(s) use generic estimates — "
                    "verify with supplier datasheets before procurement or commissioning.")
                   if generic else "",
    }
