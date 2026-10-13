"""
cad_export.py — AquaFlow AF-CAD-020 / AF-CAD-003

The single ezdxf-based DXF writer for AquaFlow designs.

Writes an AutoCAD 2013 (AC1027) DXF that every current DWG application opens, with
the same layer set and the same AQUAFLOW XDATA encoding as the designer's browser
exporter (``frontend/src/engineering/cadExchange.js`` → ``exportCadDxf``), so a file
from either writer re-imports through either importer:

  * layers — ``AQF_LAYERS`` below (POOL_OUTLINE, NOZZLES, LIGHTS, EQUIPMENT, PIPEWORK,
    DEPTH_ZONES, MEASUREMENTS, ANNOTATIONS … plus LANDSCAPE, POOL_ISLANDS and
    DIMENSIONS, which the browser importer maps to the "ignore" role), and every
    user layer of the project (``project.layers`` entries that are not AquaFlow's own);
  * one block definition per component type and model, ``AQF_<TYPE>_<MODEL>``
    (e.g. ``AQF_NOZZLE_JET25``), with ATTDEFs ``ID``, ``MODEL``, ``HEIGHT`` and
    ``CHANNEL``; every fixture is an INSERT carrying ATTRIBs with its values;
  * XDATA appid ``AQUAFLOW`` on every AquaFlow-owned entity: the UTF-8 JSON metadata
    (``{"kind": "fixture", "id": …, "type": …}``) hex-encoded and split into group-1000
    strings of at most 240 characters — byte-for-byte the browser writer's format;
  * basin outline(s) (CIRCLE / ELLIPSE / closed LWPOLYLINE) with island holes on
    POOL_ISLANDS, pipes as LWPOLYLINEs, depth zones, measurements, land surfaces as
    pattern HATCHes and overall linear DIMENSIONs; ``$INSUNITS`` = 6 (metres).

Coordinate frame
----------------
AquaFlow's engineering *plan* frame (``geometryContract.js``) is a top-down plane in
metres whose ``y`` axis is the depth axis and grows *down the screen* (the SVG
convention; 3D world ``z`` == plan ``y``). The CAD frame is the conventional
**+Y-up** WCS in metres. The conversion is a mirror about the X axis::

    cad_x = plan_x
    cad_y = -plan_y
    cad_rotation_deg = -plan_rotation_deg       (mirroring reverses the turn sense)
    cad_z = plan elevation (fixture ``z``), unchanged

which is exactly what ``exportCadDxf`` does (it writes ``-y``) and what the browser
importer undoes (``flipY``, on by default). The backend import contract
(``docs/CAD-IMPORT-CONTRACT.md``) reports CAD-frame coordinates, so re-reading a file
written here yields ``(x, -y)`` of the design — the frontend's single CAD→plan
transform flips it back. Nothing here centres the design.
"""
from __future__ import annotations

import io
import json
import math
import re
from typing import Iterable, Optional

import ezdxf
from ezdxf import units as dxf_units

from services.basin_model import is_model_basins, normalize_basins

DXF_VERSION = "AC1027"          # AutoCAD 2013 — ezdxf "R2013"
INSUNITS_METERS = 6
XDATA_APPID = "AQUAFLOW"
XDATA_CHUNK = 240               # chars per group-1000 string (frontend uses 240)

# The AquaFlow drawing layer set → AutoCAD Colour Index. Shared by this writer and
# the legacy R12 writer (``services.cad_layout``) so both agree. The first eight are
# the historic R12 layers; the rest are the layers the browser writer adds
# (DEPTH_ZONES) and the ones this writer needs for land, islands and dimensions.
AQF_LAYERS: list[tuple[str, int]] = [
    ("POOL_OUTLINE", 5),    # blue
    ("WATER_SURFACE", 141), # light blue
    ("NOZZLES", 4),         # cyan
    ("LIGHTS", 2),          # yellow
    ("PIPEWORK", 30),       # orange
    ("EQUIPMENT", 8),       # grey
    ("MEASUREMENTS", 2),    # yellow
    ("ANNOTATIONS", 7),     # white/black
    ("DEPTH_ZONES", 150),   # mid blue
    ("POOL_ISLANDS", 5),    # blue (holes / islands inside a basin)
    ("LANDSCAPE", 82),      # green
    ("DIMENSIONS", 1),      # red
]
AQF_LAYER_NAMES = {name for name, _ in AQF_LAYERS}

# Frontend layer keys (PoolGeometryDesigner / engineeringStore DEFAULT_LAYERS) that map
# onto an AquaFlow layer rather than being "user layers".
_BUILTIN_LAYER_KEYS = {
    "pool_outline", "water_surface", "landscape", "nozzles", "lights", "equipment",
    "measurements", "annotations", "pipework", "depth_zones", "pool_islands", "dimensions",
}

_LIGHT_TOKENS = ("light", "rgb", "led", "spot", "par", "beam", "wash", "underwater")
_NOZZLE_TOKENS = ("nozzle", "jet", "geyser", "spray", "fan", "arch", "laminar",
                  "foam", "running", "mist", "crown")

# Land surface type → (ezdxf ISO hatch pattern, pattern scale).
LAND_PATTERNS = {
    "grass": ("GRASS", 0.02), "paving": ("AR-HBONE", 0.002), "soil": ("EARTH", 0.02),
    "rock": ("GRAVEL", 0.02), "sand": ("AR-SAND", 0.002),
}

_BLOCK_RADIUS = {"NOZZLE": 0.15, "LIGHT": 0.12, "LASER": 0.12}
_DEFAULT_BLOCK_RADIUS = 0.2


# ── Classification ────────────────────────────────────────────────────────────

def fixture_layer(fixture_type: str) -> str:
    """Drawing layer for a fixture type (browser-writer rules first, then tokens)."""
    t = str(fixture_type or "").strip().lower()
    if re.match(r"^(light|laser)", t):
        return "LIGHTS"
    if t.startswith("nozzle"):
        return "NOZZLES"
    if any(tok in t for tok in _LIGHT_TOKENS):
        return "LIGHTS"
    if any(tok in t for tok in _NOZZLE_TOKENS):
        return "NOZZLES"
    return "EQUIPMENT"


def component_category(fixture_type: str) -> str:
    """Component TYPE token used in block names: NOZZLE, LIGHT, PUMP, VALVE, …"""
    t = str(fixture_type or "").strip().lower()
    if "pump" in t:
        return "PUMP"
    if "valve" in t:
        return "VALVE"
    if "laser" in t:
        return "LASER"
    if "flame" in t or "fire" in t:
        return "FIRE"
    if "mist" in t or "fog" in t:
        return "MIST"
    layer = fixture_layer(t)
    if layer == "LIGHTS":
        return "LIGHT"
    if layer == "NOZZLES":
        return "NOZZLE"
    return "EQUIPMENT"


def _sanitize_name(s: str, limit: int = 64) -> str:
    out = re.sub(r"[^A-Z0-9_-]+", "_", str(s or "").upper()).strip("_")
    return out[:limit] or "GENERIC"


def fixture_model(fx: dict) -> str:
    eng = fx.get("engineering") if isinstance(fx.get("engineering"), dict) else {}
    for v in (fx.get("model"), eng.get("model"), eng.get("partNumber"), fx.get("partNumber")):
        if v not in (None, ""):
            return str(v)
    return ""


def block_name_for(fx: dict) -> str:
    """``AQF_<TYPE>_<MODEL>``; MODEL falls back to the fixture type minus its category."""
    ftype = str(fx.get("type") or fx.get("fixtureType") or "equipment")
    cat = component_category(ftype)
    model = fixture_model(fx)
    if not model:
        model = re.sub(rf"^{cat.lower()}[_\- ]*", "", ftype.lower()) or "generic"
    return f"AQF_{cat}_{_sanitize_name(model, 48)}"


# ── XDATA (identical to cadExchange.js encodeMetadata / readMetadata) ─────────

def encode_metadata(data: dict) -> list[tuple[int, str]]:
    """JSON → UTF-8 → lowercase hex → group-1000 chunks (appid tag added by ezdxf)."""
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    hx = raw.hex()
    return [(1000, hx[i:i + XDATA_CHUNK]) for i in range(0, len(hx), XDATA_CHUNK)] or [(1000, "")]


def decode_metadata(chunks: Iterable[str]) -> Optional[dict]:
    """Inverse of :func:`encode_metadata`. Returns None for anything not ours/damaged."""
    hx = "".join(str(c).strip() for c in chunks)
    if not hx or len(hx) > 32768 or len(hx) % 2 or not re.fullmatch(r"[0-9a-fA-F]+", hx):
        return None
    try:
        obj = json.loads(bytes.fromhex(hx).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    return obj if isinstance(obj, dict) else None


def read_entity_metadata(entity) -> Optional[dict]:
    """Decode the AQUAFLOW XDATA of an ezdxf entity, or None."""
    try:
        if not entity.has_xdata(XDATA_APPID):
            return None
        tags = entity.get_xdata(XDATA_APPID)
    except Exception:
        return None
    return decode_metadata(t.value for t in tags if t.code == 1000)


# ── Plan-frame input normalisation ────────────────────────────────────────────

def _num(v, default: float = 0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _plan_pt(p) -> Optional[tuple[float, float]]:
    """Accept {x, y}, {x, z} or [x, y] → plan (x, y)."""
    if isinstance(p, dict):
        if p.get("x") is None:
            return None
        return _num(p.get("x")), _num(p.get("y", p.get("z")))
    if isinstance(p, (list, tuple)) and len(p) >= 2:
        return _num(p[0]), _num(p[1])
    return None


def to_cad(p: tuple[float, float]) -> tuple[float, float]:
    """Plan (x, y-down) → CAD WCS (x, y-up). See the module docstring."""
    return (p[0], -p[1] + 0.0)  # + 0.0 turns -0.0 into 0.0


def _plan_pts(seq) -> list[tuple[float, float]]:
    return [q for q in (_plan_pt(p) for p in (seq or [])) if q is not None]


def pool_geometry(design: dict) -> dict:
    """The basin in plan coords: {type: circle|ellipse|polygon, …}.

    Accepts the browser project shape (``geometry: {type, center: {x,y}, points: [{x,y}]}``,
    ``pool_type``) and the backend design shape (``poolType``, ``geometry.points`` as
    ``[[x, y]]``, ``geometry.center`` as ``[x, y]``). With no geometry it mirrors
    ``poolGeometry.geometryForPoolType``.
    """
    geom = design.get("geometry") or {}
    params = design.get("params") or {}
    ptype = str(design.get("pool_type") or design.get("poolType") or "rectangular").lower()
    w = _num(params.get("width"), 12.0) or 12.0
    length = _num(params.get("length"), 8.0) or 8.0
    radius = _num(params.get("radius"), 6.0) or 6.0
    holes = [h for h in (_plan_pts(h.get("points") if isinstance(h, dict) else h)
                         for h in (geom.get("holes") or geom.get("islands")
                                   or design.get("islands") or [])) if len(h) >= 3]

    pts = _plan_pts(geom.get("points"))
    gtype = str(geom.get("type") or "").lower()
    center = _plan_pt(geom.get("center")) if geom.get("center") is not None else None
    if gtype == "circle" or (not pts and not gtype and ptype in ("circular", "circle")):
        return {"type": "circle", "center": center or (0.0, 0.0),
                "radius": _num(geom.get("radius"), radius) or radius, "holes": holes}
    if gtype == "ellipse" or (not pts and not gtype and ptype in ("elliptical", "ellipse")):
        return {"type": "ellipse", "center": center or (0.0, 0.0), "rx": _num(geom.get("rx"), w / 2.0) or w / 2.0,
                "ry": _num(geom.get("ry"), length / 2.0) or length / 2.0, "holes": holes}
    if len(pts) >= 3:
        return {"type": "polygon", "points": pts, "closed": geom.get("closed") is not False,
                "holes": holes}
    if ptype == "lshape":
        pts = [(0, 0), (w, 0), (w, length / 2), (w / 2, length / 2), (w / 2, length), (0, length)]
    else:
        pts = [(0.0, 0.0), (w, 0.0), (w, length), (0.0, length)]
    return {"type": "polygon", "points": [(float(x), float(y)) for x, y in pts],
            "closed": True, "holes": holes}


def _extra_basins(design: dict) -> list[dict]:
    """Pre-AF-NEXT-010 extension: ``basins: [{points, holes}]`` EXTRA to ``geometry``."""
    out = []
    for i, b in enumerate(design.get("basins") or []):
        if not isinstance(b, dict):
            continue
        pts = _plan_pts(b.get("points"))
        if len(pts) < 3:
            continue
        holes = [h for h in (_plan_pts(h.get("points") if isinstance(h, dict) else h)
                             for h in (b.get("holes") or [])) if len(h) >= 3]
        out.append({"id": b.get("id") or f"basin-{i + 1}", "points": pts, "holes": holes,
                    "depth": b.get("depth")})
    return out


def _fixture_height(fx: dict):
    eng = fx.get("engineering") if isinstance(fx.get("engineering"), dict) else {}
    for v in (fx.get("height"), fx.get("height_m"), fx.get("jetHeightM"),
              eng.get("jetHeightM"), eng.get("maxHeightM"), eng.get("height")):
        if v not in (None, ""):
            return v
    return ""


def _fixture_channel(fx: dict):
    eng = fx.get("engineering") if isinstance(fx.get("engineering"), dict) else {}
    for v in (fx.get("channel"), fx.get("dmxAddress"), fx.get("dmx_address"),
              fx.get("valveChannel"), eng.get("dmxAddress"), eng.get("channel")):
        if v not in (None, ""):
            return v
    return ""


def _fmt_attr(v) -> str:
    if isinstance(v, float):
        return f"{v:g}"
    return str(v).replace("\n", " ").replace("\r", " ")


def _hex_to_rgb(color) -> Optional[tuple[int, int, int]]:
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(color or ""))
    if not m:
        return None
    h = m.group(1)
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


# ── Document builder ──────────────────────────────────────────────────────────

class _Bounds:
    def __init__(self):
        self.minx = self.miny = math.inf
        self.maxx = self.maxy = -math.inf

    def add(self, x: float, y: float, r: float = 0.0):
        self.minx = min(self.minx, x - r); self.maxx = max(self.maxx, x + r)
        self.miny = min(self.miny, y - r); self.maxy = max(self.maxy, y + r)

    @property
    def valid(self) -> bool:
        return self.minx <= self.maxx and self.miny <= self.maxy


def _ensure_block(doc, name: str, category: str):
    if name in doc.blocks:
        return
    blk = doc.blocks.new(name=name)
    r = _BLOCK_RADIUS.get(category, _DEFAULT_BLOCK_RADIUS)
    byblock = {"layer": "0", "color": 0}
    blk.add_circle((0, 0), r, dxfattribs=byblock)
    blk.add_line((0, 0), (r, 0), dxfattribs=byblock)      # orientation tick
    blk.add_point((0, 0), dxfattribs=byblock)
    if category == "PUMP":
        blk.add_line((-r * 0.7, -r * 0.7), (r * 0.7, r * 0.7), dxfattribs=byblock)
    elif category == "VALVE":
        blk.add_lwpolyline([(-r, -r * 0.6), (r, r * 0.6), (r, -r * 0.6), (-r, r * 0.6)],
                           close=True, dxfattribs=byblock)
    th = 0.18
    blk.add_attdef("ID", (r + 0.05, -th / 2), dxfattribs={"height": th, "layer": "0"})
    for i, tag in enumerate(("MODEL", "HEIGHT", "CHANNEL"), start=1):
        blk.add_attdef(tag, (r + 0.05, -th / 2 - i * th * 1.4),
                       dxfattribs={"height": th * 0.8, "layer": "0", "flags": 1})  # invisible


def _set_meta(entity, meta: Optional[dict]):
    if meta:
        entity.set_xdata(XDATA_APPID, encode_metadata(meta))


def build_document(design: dict, *, dimensions: bool = True):
    """Build the ezdxf Drawing for a design (plan frame in, CAD +Y-up out)."""
    design = design or {}
    doc = ezdxf.new("R2013", setup=True)
    doc.units = dxf_units.M
    doc.header["$INSUNITS"] = INSUNITS_METERS
    doc.header["$MEASUREMENT"] = 1
    if XDATA_APPID not in doc.appids:
        doc.appids.add(XDATA_APPID)
    for name, aci in AQF_LAYERS:
        if name not in doc.layers:
            doc.layers.add(name, color=aci)

    # User layers (anything in project.layers that is not one of AquaFlow's own).
    user_layers = []
    for lay in design.get("layers") or []:
        if not isinstance(lay, dict):
            continue
        key = str(lay.get("key") or "").lower()
        if key in _BUILTIN_LAYER_KEYS:
            continue
        lname = _sanitize_name(lay.get("name") or lay.get("label") or key, 200)
        if lname in AQF_LAYER_NAMES or lname in doc.layers:
            continue
        layer = doc.layers.add(lname, color=7)
        rgb = _hex_to_rgb(lay.get("color"))
        if rgb:
            layer.rgb = rgb
        if lay.get("visible") is False:
            layer.off()
        if lay.get("locked"):
            layer.lock()
        user_layers.append(lname)

    msp = doc.modelspace()
    bounds = _Bounds()

    # ── Basin(s) ─────────────────────────────────────────────────────────────
    depth = _num((design.get("params") or {}).get("depth"), 0.8) or 0.8

    def write_shape(g, meta):
        if g["type"] == "circle":
            cx, cy = to_cad(g["center"])
            ent = msp.add_circle((cx, cy), g["radius"], dxfattribs={"layer": "POOL_OUTLINE"})
            bounds.add(cx, cy, g["radius"])
        elif g["type"] == "ellipse":
            cx, cy = to_cad(g["center"])
            rx, ry = g["rx"], g["ry"]
            major = (0.0, -ry) if ry > rx else (rx, 0.0)   # same choice as exportCadDxf
            ent = msp.add_ellipse((cx, cy), major_axis=major, ratio=min(rx, ry) / max(rx, ry),
                                  dxfattribs={"layer": "POOL_OUTLINE"})
            bounds.add(cx - rx, cy - ry); bounds.add(cx + rx, cy + ry)
        else:
            cad = [to_cad(p) for p in g["points"]]
            ent = msp.add_lwpolyline(cad, close=g.get("closed", True), dxfattribs={"layer": "POOL_OUTLINE"})
            for x, y in cad:
                bounds.add(x, y)
        _set_meta(ent, meta)

    def write_island(hole, meta):
        h = msp.add_lwpolyline([to_cad(p) for p in hole], close=True, dxfattribs={"layer": "POOL_ISLANDS"})
        _set_meta(h, meta)

    if is_model_basins(design):
        # AF-NEXT-010: every basin, each with its own id/name/levels and its islands.
        for b in normalize_basins(design):
            meta = {"kind": "pool", "id": b["id"], "name": b["name"], "depth": b["depth"] or depth}
            for k in ("floorLevel", "wallHeight"):
                if b.get(k) is not None:
                    meta[k] = b[k]
            write_shape(b, meta)
            for j, hole in enumerate(b["holes"]):
                write_island(hole, {"kind": "island", "id": f"{b['id']}-island-{j + 1}", "basinId": b["id"]})
    else:
        g = pool_geometry(design)
        write_shape(g, {"kind": "pool", "depth": depth})
        for i, hole in enumerate(g.get("holes") or []):
            write_island(hole, {"kind": "island", "id": f"island-{i + 1}"})
        for b in _extra_basins(design):
            cad = [to_cad(p) for p in b["points"]]
            e = msp.add_lwpolyline(cad, close=True, dxfattribs={"layer": "POOL_OUTLINE"})
            _set_meta(e, {"kind": "pool", "id": str(b["id"]),
                          "depth": _num(b.get("depth"), depth) or depth})
            for x, y in cad:
                bounds.add(x, y)
            for j, hole in enumerate(b["holes"]):
                write_island(hole, {"kind": "island", "id": f"{b['id']}-island-{j + 1}"})

    # ── Fixtures → block INSERTs ─────────────────────────────────────────────
    fx_cad: dict[str, tuple[float, float]] = {}
    seen: set[str] = set()
    for i, fx in enumerate(design.get("fixtures") or []):
        if not isinstance(fx, dict):
            continue
        fid = fx.get("id") if fx.get("id") is not None else fx.get("fixtureId")
        p = _plan_pt(fx)
        if fid is None or p is None or fx.get("y", fx.get("z")) is None:
            continue
        fid = str(fid)
        if fid in seen:
            raise ValueError(f"Duplicate fixture id '{fid}' — every exported fixture needs a unique AquaFlow ID.")
        seen.add(fid)
        ftype = str(fx.get("type") or fx.get("fixtureType") or "equipment")
        cat = component_category(ftype)
        bname = block_name_for(fx)
        _ensure_block(doc, bname, cat)
        x, y = to_cad(p)
        z = _num(fx.get("z") if "y" in fx else fx.get("elevation"), 0.0)
        rot_plan = _num(fx.get("rotation"), 0.0)
        label = str(fx.get("label") or fid)
        ref = msp.add_blockref(bname, (x, y, z), dxfattribs={
            "layer": fixture_layer(ftype), "rotation": -rot_plan + 0.0})
        ref.add_auto_attribs({
            "ID": _fmt_attr(fx.get("tag") or label),
            "MODEL": _fmt_attr(fixture_model(fx) or ftype),
            "HEIGHT": _fmt_attr(_fixture_height(fx)),
            "CHANNEL": _fmt_attr(_fixture_channel(fx)),
        })
        meta = {"kind": "fixture", "id": fid, "type": ftype, "label": label, "rotation": rot_plan}
        model = fixture_model(fx)
        if model:
            meta["model"] = model
        _set_meta(ref, meta)
        fx_cad[fid] = (x, y)
        bounds.add(x, y, _BLOCK_RADIUS.get(cat, _DEFAULT_BLOCK_RADIUS))

    # ── Pipes ────────────────────────────────────────────────────────────────
    manual = design.get("manualPipes") or design.get("manual_pipes") or []
    pipes = manual if manual else (design.get("pipes") or design.get("connections") or [])
    for i, pp in enumerate(pipes):
        if not isinstance(pp, dict):
            continue
        pts = _plan_pts(pp.get("points"))
        if len(pts) >= 2:
            cad = [to_cad(q) for q in pts]
        else:
            a = str(pp.get("from") or pp.get("from_node") or "")
            b = str(pp.get("to") or pp.get("to_node") or "")
            if a not in fx_cad or b not in fx_cad:
                continue
            cad = [fx_cad[a], fx_cad[b]]
        meta = {"kind": "pipe", "id": str(pp.get("id") or f"pipe-{i}")}
        for k_src, k_dst in (("label", "label"), ("pipeType", "pipeType")):
            if pp.get(k_src) not in (None, ""):
                meta[k_dst] = str(pp[k_src])
        dmm = pp.get("diameterMm", pp.get("dn"))
        if dmm not in (None, ""):
            meta["diameterMm"] = _num(dmm)
        for k in ("from", "to", "material"):
            if pp.get(k) not in (None, ""):
                meta[k] = str(pp[k])
        e = msp.add_lwpolyline(cad, close=False, dxfattribs={"layer": "PIPEWORK"})
        _set_meta(e, meta)
        for x, y in cad:
            bounds.add(x, y)

    # ── Depth zones, measurements ────────────────────────────────────────────
    for z in design.get("depth_zones") or design.get("depthZones") or []:
        if not isinstance(z, dict):
            continue
        pts = _plan_pts(z.get("points"))
        if len(pts) < 3:
            continue
        e = msp.add_lwpolyline([to_cad(q) for q in pts], close=True,
                               dxfattribs={"layer": "DEPTH_ZONES"})
        meta = {"kind": "depth"}
        for k in ("id", "zone", "label"):
            if z.get(k) not in (None, ""):
                meta[k] = str(z[k])
        if z.get("depth") is not None:
            meta["depth"] = _num(z.get("depth"))
        _set_meta(e, meta)
    for m in design.get("measurements") or []:
        if not isinstance(m, dict) or m.get("x1") is None or m.get("x2") is None:
            continue
        a = to_cad((_num(m.get("x1")), _num(m.get("y1"))))
        b = to_cad((_num(m.get("x2")), _num(m.get("y2"))))
        msp.add_line(a, b, dxfattribs={"layer": "MEASUREMENTS"})

    # ── Land surfaces → HATCH ────────────────────────────────────────────────
    for i, s in enumerate(design.get("site_surfaces") or design.get("siteSurfaces") or []):
        if not isinstance(s, dict):
            continue
        pts = _plan_pts(s.get("points"))
        if len(pts) < 3:
            continue
        stype = str(s.get("type") or "grass").lower()
        pattern, scale = LAND_PATTERNS.get(stype, LAND_PATTERNS["grass"])
        hatch = msp.add_hatch(color=256, dxfattribs={"layer": "LANDSCAPE"})
        hatch.paths.add_polyline_path([to_cad(q) for q in pts], is_closed=True)
        try:
            hatch.set_pattern_fill(pattern, scale=scale)
        except Exception:                                  # unknown pattern → solid
            hatch.set_solid_fill(color=256)
        _set_meta(hatch, {"kind": "land", "id": str(s.get("id") or f"surface-{i + 1}"),
                          "type": stype, "label": str(s.get("label") or stype)})
        for q in pts:
            bounds.add(*to_cad(q))

    # ── Title + overall dimensions ───────────────────────────────────────────
    if not bounds.valid:
        bounds.add(0.0, 0.0)
    title = str(design.get("name") or design.get("projectName") or "AquaFlow fountain design")
    msp.add_text(title.replace("\n", " "), height=0.3,
                 dxfattribs={"layer": "ANNOTATIONS", "insert": (bounds.minx, bounds.maxy + 0.6)})
    if dimensions:
        span_x = bounds.maxx - bounds.minx
        span_y = bounds.maxy - bounds.miny
        ov = {"dimtxt": 0.25, "dimasz": 0.2, "dimexe": 0.1, "dimexo": 0.1, "dimdec": 2,
              "dimgap": 0.08}
        if span_x > 1e-6:
            msp.add_linear_dim(base=(bounds.minx, bounds.miny - 0.8),
                               p1=(bounds.minx, bounds.miny), p2=(bounds.maxx, bounds.miny),
                               dimstyle="EZDXF", override=ov,
                               dxfattribs={"layer": "DIMENSIONS"}).render()
        if span_y > 1e-6:
            msp.add_linear_dim(base=(bounds.maxx + 0.8, bounds.miny),
                               p1=(bounds.maxx, bounds.miny), p2=(bounds.maxx, bounds.maxy),
                               angle=90, dimstyle="EZDXF", override=ov,
                               dxfattribs={"layer": "DIMENSIONS"}).render()

    doc.header["$EXTMIN"] = (bounds.minx, bounds.miny, 0)
    doc.header["$EXTMAX"] = (bounds.maxx, bounds.maxy, 0)
    doc._aqf_user_layers = user_layers               # for export_layout stats
    return doc


def export_dxf(design: dict, *, dimensions: bool = True) -> str:
    """Return the DXF text (AC1027, metres, CAD +Y-up) for a design."""
    doc = build_document(design, dimensions=dimensions)
    buf = io.StringIO()
    doc.write(buf)
    return buf.getvalue()


def export_layout(design: dict) -> dict:
    """DXF text plus the metadata the layout/route payloads report."""
    doc = build_document(design)
    buf = io.StringIO()
    doc.write(buf)
    text = buf.getvalue()
    msp = doc.modelspace()
    blocks = sorted(b.name for b in doc.blocks if b.name.startswith("AQF_"))
    return {
        "dxf": text,
        "dxf_version": doc.dxfversion,
        "layers": [name for name, _ in AQF_LAYERS] + list(getattr(doc, "_aqf_user_layers", [])),
        "blocks": blocks,
        "entity_count": len(msp),
        "insert_count": len(msp.query("INSERT")),
    }
