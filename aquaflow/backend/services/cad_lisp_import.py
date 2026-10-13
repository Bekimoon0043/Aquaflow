"""
cad_lisp_import.py — AquaFlow AF-CAD-019

Ingest the JSON written by the AutoCAD-side ``AQFEXPORT`` command
(``tools/autocad/aquaflow_export.lsp``) — the zero-licence DWG path: the user's own
AutoCAD reads the DWG, the LISP walks model-space block references and writes their
handle, effective (dynamic-block) name, layer, WCS insertion point, rotation, scale,
attributes and AQUAFLOW XDATA, plus ``$INSUNITS``.

:func:`import_aqf_json` returns the import-response shape of
``docs/CAD-IMPORT-CONTRACT.md`` (``POST /api/cad/import``): CAD WCS metres, +Y up,
``inserts[]`` with ``xdata.AQUAFLOW`` decoded exactly as from a DXF, so recognition
and re-import diff treat both paths identically. Only block references are carried
(the LISP does not export loose geometry), so ``entities`` is empty.
"""
from __future__ import annotations

import json
import math
from typing import Any

from services.cad_export import decode_metadata

FORMAT_ID = "AQFEXPORT"

# $INSUNITS code → (name, metres per unit). 0 = unitless.
INSUNITS = {
    0: ("unitless", 1.0), 1: ("in", 0.0254), 2: ("ft", 0.3048), 3: ("mi", 1609.344),
    4: ("mm", 0.001), 5: ("cm", 0.01), 6: ("m", 1.0), 7: ("km", 1000.0),
    8: ("uin", 2.54e-8), 9: ("mil", 2.54e-5), 10: ("yd", 0.9144), 11: ("A", 1e-10),
    12: ("nm", 1e-9), 13: ("um", 1e-6), 14: ("dm", 0.1), 15: ("dam", 10.0),
    16: ("hm", 100.0), 17: ("Gm", 1e9), 18: ("AU", 1.495978707e11),
    19: ("ly", 9.46073e15), 20: ("pc", 3.08567758e16),
}
_UNIT_OVERRIDE = {"mm": 4, "cm": 5, "m": 6, "in": 1, "ft": 2}

MAX_INSERTS = 200_000


def _f(v, default=0.0) -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    return x if math.isfinite(x) else default


def _vec(v, n: int, default: float) -> list[float]:
    vals = list(v) if isinstance(v, (list, tuple)) else []
    return [_f(vals[i], default) if i < len(vals) else default for i in range(n)]


def import_aqf_json(data: Any, *, units: str | None = None, filename: str | None = None) -> dict:
    """Convert AQFEXPORT JSON (dict, str or bytes) into the contract import response.

    ``units`` overrides ``$INSUNITS`` (``mm|cm|m|in|ft``), like the DXF import option.
    Raises ``ValueError`` for anything that is not an AQFEXPORT document.
    """
    if isinstance(data, (bytes, bytearray)):
        data = data.decode("utf-8-sig")
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError as exc:
            raise ValueError(f"not valid JSON: {exc}") from exc
    if not isinstance(data, dict) or str(data.get("format", "")).upper() != FORMAT_ID:
        raise ValueError("not an AQFEXPORT document (missing \"format\": \"AQFEXPORT\")")
    raw_inserts = data.get("inserts")
    if not isinstance(raw_inserts, list):
        raise ValueError("AQFEXPORT document has no \"inserts\" list")
    if len(raw_inserts) > MAX_INSERTS:
        raise ValueError(f"too many block references ({len(raw_inserts)} > {MAX_INSERTS})")

    warnings: list[str] = []
    try:
        insunits = int(data.get("insunits", 0))
    except (TypeError, ValueError):
        insunits = 0
    if units:
        if units not in _UNIT_OVERRIDE:
            raise ValueError(f"unsupported units override '{units}'")
        code = _UNIT_OVERRIDE[units]
    else:
        code = insunits
    name, to_m = INSUNITS.get(code, ("unitless", 1.0))
    unitless = code == 0 or code not in INSUNITS
    if unitless:
        warnings.append("Drawing is unitless ($INSUNITS=0); coordinates taken as metres — "
                        "choose the real units before placing fixtures.")

    inserts, layers = [], {}
    skipped = 0
    minx = miny = math.inf
    maxx = maxy = -math.inf
    for i, ins in enumerate(raw_inserts):
        if not isinstance(ins, dict):
            skipped += 1
            continue
        pos = _vec(ins.get("insertion", ins.get("position")), 3, 0.0)
        pos = [round(c * to_m, 9) for c in pos]
        if "rotation_deg" in ins:
            rot = _f(ins.get("rotation_deg"))
        else:                                   # radians, AutoCAD's native unit
            rot = math.degrees(_f(ins.get("rotation")))
        scale = _vec(ins.get("scale"), 3, 1.0)
        attribs = ins.get("attribs") if isinstance(ins.get("attribs"), dict) else {}
        attribs = {str(k).upper(): str(v) for k, v in attribs.items()}
        xdata = {}
        chunks = ins.get("xdata_aquaflow")
        if isinstance(chunks, str):
            chunks = [chunks]
        if isinstance(chunks, list) and chunks:
            meta = decode_metadata(chunks)
            if meta is not None:
                xdata["AQUAFLOW"] = meta
            else:
                warnings.append(f"Block {ins.get('handle') or i}: unreadable AQUAFLOW XDATA ignored.")
        block = str(ins.get("name") or ins.get("block") or "")
        eff = str(ins.get("effective_name") or block)
        layer = str(ins.get("layer") or "0")
        layers[layer] = layers.get(layer, 0) + 1
        inserts.append({
            "handle": str(ins.get("handle") or f"AQF{i}"),
            "block": block, "effective_name": eff, "layer": layer,
            "position": pos, "rotation_deg": round(rot, 9), "scale": scale,
            "attribs": attribs, "xdata": xdata, "depth": 0, "parent_handle": None,
        })
        minx, maxx = min(minx, pos[0]), max(maxx, pos[0])
        miny, maxy = min(miny, pos[1]), max(maxy, pos[1])
        if any(abs(e) > 1e-9 for e in _vec(ins.get("extrusion"), 3, 0.0)[:2]):
            warnings.append(f"Block {inserts[-1]['handle']} is not in the XY plane (extrusion "
                            "is tilted); its position is WCS but its rotation may be misleading.")
    if skipped:
        warnings.append(f"{skipped} malformed insert record(s) skipped.")

    return {
        "version": 1,
        "source": "autolisp",
        "filename": filename or str(data.get("drawing") or "aqfexport.json"),
        "dxf_version": None,
        "acad_version": data.get("acadver"),
        "units": {"insunits": insunits, "name": name, "to_m": to_m,
                  "unitless": unitless, "suggested": None},
        "extents": ({"min": [minx, miny], "max": [maxx, maxy]} if inserts else None),
        "layers": [{"name": n, "color": None, "entity_count": c, "off": False, "frozen": False}
                   for n, c in sorted(layers.items())],
        "entities": [],
        "inserts": inserts,
        "closed_outlines": [],
        "tables": [],
        "xrefs": [],
        "warnings": warnings,
        "stats": {"entities": len(inserts), "inserts": len(inserts), "skipped": {"malformed": skipped}},
    }
