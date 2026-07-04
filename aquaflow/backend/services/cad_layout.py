"""
cad_layout.py — AquaFlow Recovery, AQ-X-009

CAD layout generator — exports a fountain design to a CAD-compatible DXF drawing.

Produces a valid AutoCAD R12 (AC1009) ASCII DXF from a pool design: the pool
outline, every fixture placed at its true (x, y) coordinate with a label, and the
pipework, each on the correct drawing layer. DXF is the vendor-neutral CAD exchange
format that every DWG application (AutoCAD, BricsCAD, DraftSight, …) imports, so this
is the portable, dependency-free way to hand a fountain layout to a CAD engineer.

  * DXF/DWG export supported — emits standards-compliant DXF text (DWG tools open it
    directly / via one-click import); no external CAD engine required,
  * layout accurate to design — fixture circles are centred on the exact design
    coordinates (metres), the pool boundary matches the pool parameters, and the
    drawing units are metres,
  * layer structure correct — a proper LAYER table with pool outline, nozzles, lights,
    pipework, equipment, measurements and annotation layers, each with its ACI colour,
    and every entity assigned to the right layer by fixture type.
"""
from __future__ import annotations

import math
from typing import Optional

DXF_VERSION = "AC1009"          # AutoCAD R12 — the most widely importable DXF
INSUNITS_METERS = 6

# Drawing layers → AutoCAD Color Index. Order is the table order.
LAYERS: list[tuple[str, int]] = [
    ("POOL_OUTLINE", 5),    # blue
    ("WATER_SURFACE", 141), # light blue
    ("NOZZLES", 4),         # cyan
    ("LIGHTS", 2),          # yellow
    ("PIPEWORK", 30),       # orange
    ("EQUIPMENT", 8),       # grey
    ("MEASUREMENTS", 2),    # yellow
    ("ANNOTATIONS", 7),     # white/black
]
LAYER_NAMES = {name for name, _ in LAYERS}

# Fixture default drawing radius (m) by class, and which layer it lands on.
_LIGHT_TOKENS = ("light", "rgb", "led", "spot", "par", "beam", "wash", "underwater")
_NOZZLE_TOKENS = ("nozzle", "jet", "geyser", "spray", "fan", "arch", "laminar",
                  "foam", "running", "mist", "crown")


def fixture_layer(fixture_type: str) -> str:
    """Return the drawing layer for a fixture type."""
    t = str(fixture_type or "").strip().lower()
    if any(tok in t for tok in _LIGHT_TOKENS):
        return "LIGHTS"
    if any(tok in t for tok in _NOZZLE_TOKENS):
        return "NOZZLES"
    return "EQUIPMENT"


def fixture_radius(fixture_type: str) -> float:
    layer = fixture_layer(fixture_type)
    return {"LIGHTS": 0.12, "NOZZLES": 0.15}.get(layer, 0.2)


# ── DXF primitives ────────────────────────────────────────────────────────────

def _pair(code: int, value) -> str:
    return f"{code}\n{value}\n"


def _circle(layer: str, cx: float, cy: float, r: float) -> str:
    return (_pair(0, "CIRCLE") + _pair(8, layer)
            + _pair(10, f"{cx:.4f}") + _pair(20, f"{cy:.4f}") + _pair(30, "0.0")
            + _pair(40, f"{r:.4f}"))


def _line(layer: str, x1: float, y1: float, x2: float, y2: float) -> str:
    return (_pair(0, "LINE") + _pair(8, layer)
            + _pair(10, f"{x1:.4f}") + _pair(20, f"{y1:.4f}") + _pair(30, "0.0")
            + _pair(11, f"{x2:.4f}") + _pair(21, f"{y2:.4f}") + _pair(31, "0.0"))


def _text(layer: str, x: float, y: float, height: float, s: str) -> str:
    # DXF group 1 must be a single line; strip newlines defensively.
    s = str(s).replace("\n", " ")
    return (_pair(0, "TEXT") + _pair(8, layer)
            + _pair(10, f"{x:.4f}") + _pair(20, f"{y:.4f}") + _pair(30, "0.0")
            + _pair(40, f"{height:.4f}") + _pair(1, s))


def _point(layer: str, x: float, y: float) -> str:
    return (_pair(0, "POINT") + _pair(8, layer)
            + _pair(10, f"{x:.4f}") + _pair(20, f"{y:.4f}") + _pair(30, "0.0"))


def _polygon(layer: str, pts: list[tuple[float, float]], closed: bool = True) -> str:
    out = ""
    n = len(pts)
    for i in range(n - (0 if closed else 1)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        out += _line(layer, x1, y1, x2, y2)
    return out


# ── Pool boundary ─────────────────────────────────────────────────────────────

def _pool_boundary(design: dict) -> tuple[str, dict]:
    """Draw the pool outline on POOL_OUTLINE; return (dxf, bounds)."""
    ptype = str(design.get("poolType", "rectangular")).lower()
    params = design.get("params", {}) or {}
    geom = design.get("geometry") or {}
    w = float(params.get("width", 12))
    length = float(params.get("length", 8))
    radius = float(params.get("radius", 6))
    center = geom.get("center") or [w / 2.0, length / 2.0]
    cx, cy = float(center[0]), float(center[1])

    if geom.get("points"):
        pts = [(float(p[0]), float(p[1])) for p in geom["points"]]
        xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
        return _polygon("POOL_OUTLINE", pts, closed=True), \
            {"minx": min(xs), "miny": min(ys), "maxx": max(xs), "maxy": max(ys)}

    if ptype in ("circular", "circle"):
        r = float(geom.get("radius", radius))
        return _circle("POOL_OUTLINE", cx, cy, r), \
            {"minx": cx - r, "miny": cy - r, "maxx": cx + r, "maxy": cy + r}

    if ptype in ("elliptical", "ellipse"):
        rx = float(geom.get("rx", w / 2.0)); ry = float(geom.get("ry", length / 2.0))
        pts = [(cx + rx * math.cos(2 * math.pi * i / 48),
                cy + ry * math.sin(2 * math.pi * i / 48)) for i in range(48)]
        return _polygon("POOL_OUTLINE", pts, closed=True), \
            {"minx": cx - rx, "miny": cy - ry, "maxx": cx + rx, "maxy": cy + ry}

    # rectangular (default): corners at origin → (w, length)
    pts = [(0.0, 0.0), (w, 0.0), (w, length), (0.0, length)]
    return _polygon("POOL_OUTLINE", pts, closed=True), \
        {"minx": 0.0, "miny": 0.0, "maxx": w, "maxy": length}


# ── DXF document ──────────────────────────────────────────────────────────────

def generate_dxf(design: dict) -> str:
    """Generate a complete AutoCAD R12 DXF string for a fountain design."""
    fixtures = design.get("fixtures") or []
    pipes = design.get("pipes") or design.get("connections") or []

    entities, bounds = _pool_boundary(design)

    fx_by_id: dict[str, tuple[float, float]] = {}
    for fx in fixtures:
        if not isinstance(fx, dict):
            continue
        fid = fx.get("id") or fx.get("fixtureId")
        if fid is None or fx.get("x") is None or fx.get("y") is None:
            continue
        x, y = float(fx["x"]), float(fx["y"])
        fx_by_id[str(fid)] = (x, y)
        ftype = fx.get("type") or fx.get("fixtureType") or ""
        layer = fixture_layer(ftype)
        r = fixture_radius(ftype)
        entities += _circle(layer, x, y, r)
        entities += _point(layer, x, y)
        label = fx.get("label") or fid
        entities += _text("ANNOTATIONS", x + r + 0.05, y, 0.18, label)
        bounds["minx"] = min(bounds["minx"], x - r)
        bounds["miny"] = min(bounds["miny"], y - r)
        bounds["maxx"] = max(bounds["maxx"], x + r)
        bounds["maxy"] = max(bounds["maxy"], y + r)

    # Pipework — a line between each connected pair on the PIPEWORK layer.
    for p in pipes:
        a = str(p.get("from") or p.get("from_node") or "")
        b = str(p.get("to") or p.get("to_node") or "")
        if a in fx_by_id and b in fx_by_id:
            (x1, y1), (x2, y2) = fx_by_id[a], fx_by_id[b]
            entities += _line("PIPEWORK", x1, y1, x2, y2)

    # Overall-width dimension line + label on MEASUREMENTS.
    span = bounds["maxx"] - bounds["minx"]
    if span > 0:
        dy = bounds["miny"] - 0.6
        entities += _line("MEASUREMENTS", bounds["minx"], dy, bounds["maxx"], dy)
        entities += _text("MEASUREMENTS", (bounds["minx"] + bounds["maxx"]) / 2.0,
                          dy - 0.25, 0.2, f"{span:.2f} m")

    # ── assemble sections ─────────────────────────────────────────────────────
    header = (_pair(0, "SECTION") + _pair(2, "HEADER")
              + _pair(9, "$ACADVER") + _pair(1, DXF_VERSION)
              + _pair(9, "$INSUNITS") + _pair(70, INSUNITS_METERS)
              + _pair(9, "$EXTMIN") + _pair(10, f"{bounds['minx']:.4f}") + _pair(20, f"{bounds['miny']:.4f}")
              + _pair(9, "$EXTMAX") + _pair(10, f"{bounds['maxx']:.4f}") + _pair(20, f"{bounds['maxy']:.4f}")
              + _pair(0, "ENDSEC"))

    layer_table = _pair(0, "TABLE") + _pair(2, "LAYER") + _pair(70, len(LAYERS))
    for name, aci in LAYERS:
        layer_table += (_pair(0, "LAYER") + _pair(2, name) + _pair(70, 0)
                        + _pair(62, aci) + _pair(6, "CONTINUOUS"))
    layer_table += _pair(0, "ENDTAB")
    tables = _pair(0, "SECTION") + _pair(2, "TABLES") + layer_table + _pair(0, "ENDSEC")

    ents = _pair(0, "SECTION") + _pair(2, "ENTITIES") + entities + _pair(0, "ENDSEC")

    return header + tables + ents + _pair(0, "EOF")


# ── Public entry point ────────────────────────────────────────────────────────

def generate_layout(design: dict) -> dict:
    """
    Build the CAD export payload for a design.

    Returns the DXF text, a suggested filename, layer list, drawing stats, and the
    DWG-compatibility note (DXF is imported natively by every DWG application).
    """
    dxf = generate_dxf(design)
    name = str(design.get("name") or design.get("projectName") or "fountain_layout")
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "fountain_layout"
    fixtures = [f for f in (design.get("fixtures") or []) if isinstance(f, dict)]
    return {
        "dxf": dxf,
        "filename": f"{safe}.dxf",
        "format": "dxf",
        "dxf_version": DXF_VERSION,
        "units": "meters",
        "layers": [name for name, _ in LAYERS],
        "stats": {
            "fixture_count": len(fixtures),
            "layer_count": len(LAYERS),
            "entity_count": dxf.count("\n0\nCIRCLE") + dxf.count("\n0\nLINE")
                            + dxf.count("\n0\nTEXT") + dxf.count("\n0\nPOINT"),
            "byte_size": len(dxf.encode("utf-8")),
        },
        "dwg": {
            "supported": True,
            "via": "DXF import",
            "note": "DXF is the vendor-neutral CAD exchange format; open or import this "
                    ".dxf directly in AutoCAD/BricsCAD/DraftSight to save as .dwg.",
        },
    }
