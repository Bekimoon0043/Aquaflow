"""
cad_import.py — AquaFlow AF-CAD-010 (+ AF-CAD-016 schedules, AF-CAD-017 diff)

Backend ezdxf normalisation service. Reads an ASCII or binary DXF (model space
only) and returns the JSON described in `docs/CAD-IMPORT-CONTRACT.md`:

  * units from $INSUNITS (unitless drawings get a suggested unit from extents),
  * every coordinate in metres, CAD WCS, +Y up — never centred or flipped,
  * nested INSERTs expanded with full composed matrices (OCS extrusion, mirrored
    and non-uniformly scaled blocks, MINSERT arrays), entities from blocks carry
    the INSERT handle chain in `block_path`,
  * dynamic-block effective names (XDICTIONARY → AcDbBlockRepresentation →
    AcDbRepData, then the anonymous block record's AcDbBlockRepBTag XDATA),
  * ATTRIBs, AQUAFLOW XDATA, layer-0 / BYBLOCK inheritance, source handles,
  * ARC / ELLIPSE / SPLINE / bulges flattened to polylines at `flatten_tol`,
  * HATCH boundary loops, TEXT / MTEXT / MLEADER plain text, POINTs,
  * closed outlines with area and hole (contained-outline) detection,
  * ACAD_TABLE and reconstructed text-grid schedules (AF-CAD-016),
  * XREF listing, warnings, stats and a configurable size cap (default 100 MB).

Safety: this module only reads geometry. It never talks to hardware and never
invents hardware addresses — values are passed through verbatim.

ezdxf is MIT-licensed (https://github.com/mozman/ezdxf/blob/master/LICENSE).
"""
from __future__ import annotations

import binascii
import json
import math
import os
import re
import tempfile
import time
from collections import Counter
from typing import Any, Iterable, Optional

import ezdxf
from ezdxf import recover
from ezdxf.lldxf.const import DXFError, DXFStructureError
from ezdxf.math import Matrix44, Vec3, OCS
from ezdxf.tools.text import plain_mtext

CONTRACT_VERSION = 1
DEFAULT_MAX_MB = 100.0
DEFAULT_FLATTEN_TOL_M = 0.01
DEFAULT_MAX_ENTITIES = 500_000
MAX_BLOCK_DEPTH = 16
MAX_OUTLINES_FOR_HOLES = 3000
BINARY_DXF_SENTINEL = b"AutoCAD Binary DXF\r\n\x1a\x00"

# $INSUNITS → (name, metres per unit). Exact factors for the common units; anything
# else falls back to ezdxf.units.conversion_factor.
UNIT_TABLE = {
    1: ("in", 0.0254), 2: ("ft", 0.3048), 3: ("mi", 1609.344), 4: ("mm", 0.001),
    5: ("cm", 0.01), 6: ("m", 1.0), 7: ("km", 1000.0), 8: ("uin", 0.0254e-6),
    9: ("mil", 0.0254e-3), 10: ("yd", 0.9144), 11: ("A", 1e-10), 12: ("nm", 1e-9),
    13: ("um", 1e-6), 14: ("dm", 0.1), 15: ("dam", 10.0), 16: ("hm", 100.0),
    21: ("us_ft", 1200.0 / 3937.0),
}
UNIT_OVERRIDES = {"mm": 4, "cm": 5, "m": 6, "in": 1, "ft": 2}
# Heuristic for unitless drawings: typical fountain basins/sites span 2–200 m.
SUGGEST_ORDER = ("m", "mm", "cm", "ft", "in")
SUGGEST_RANGE_M = (2.0, 200.0)

SKIP_TYPES = {"DIMENSION", "ARC_DIMENSION", "LEADER", "VIEWPORT", "IMAGE", "WIPEOUT",
              "REGION", "3DSOLID", "BODY", "SURFACE", "MESH", "RAY", "XLINE", "OLE2FRAME",
              "ATTDEF", "TOLERANCE", "UNDERLAY", "PDFUNDERLAY", "DWFUNDERLAY",
              "DGNUNDERLAY", "SHAPE", "ACAD_PROXY_ENTITY", "LIGHT", "SECTION"}
PATH_TYPES = {"LINE", "LWPOLYLINE", "POLYLINE", "ARC", "ELLIPSE", "SPLINE", "SOLID",
              "TRACE", "3DFACE", "HELIX"}


class CadImportError(ValueError):
    """Raised for files that cannot be imported. `status` is the HTTP status to use."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


# ─────────────────────────────────────────────────────────────── helpers ──
def _r(v: float) -> float:
    return round(float(v), 6)


def _xy(v) -> list:
    return [_r(v[0]), _r(v[1])]


def _shoelace(points: list) -> float:
    a = 0.0
    n = len(points)
    for i in range(n):
        x1, y1 = points[i]
        x2, y2 = points[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def polygon_area(points: list) -> float:
    return abs(_shoelace(points))


def point_in_polygon(pt, poly: list) -> bool:
    x, y = pt[0], pt[1]
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            xc = (xj - xi) * (y - yi) / ((yj - yi) or 1e-300) + xi
            if x < xc:
                inside = not inside
        j = i
    return inside


def _bbox(points: list):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def decode_xdata(tags: Iterable) -> dict:
    """Decode one XDATA application block into a dict.

    Supports the frontend `cadExchange.js` format (hex-encoded UTF-8 JSON split
    over 1000 strings), plain JSON in 1000 strings, and `key=value` strings.
    Other group codes are kept under `values`.
    """
    strings, values = [], []
    for tag in tags:
        code, value = tag[0], tag[1]
        if code == 1001:
            continue
        if code == 1000:
            strings.append(str(value))
        elif code in (1002,):
            continue
        else:
            values.append(value if isinstance(value, (int, float, str)) else str(value))
    joined = "".join(s.strip() for s in strings)
    result: dict = {}
    if joined and re.fullmatch(r"(?:[0-9a-fA-F]{2})+", joined) and len(joined) <= 65536:
        try:
            decoded = json.loads(binascii.unhexlify(joined).decode("utf-8"))
            if isinstance(decoded, dict):
                result = decoded
        except (ValueError, UnicodeDecodeError):
            result = {}
    if not result and joined:
        try:
            decoded = json.loads("".join(strings))
            if isinstance(decoded, dict):
                result = decoded
        except ValueError:
            pass
    if not result:
        for s in strings:
            if "=" in s:
                k, _, v = s.partition("=")
                result[k.strip()] = v.strip()
            elif ":" in s and not s.startswith("{"):
                k, _, v = s.partition(":")
                result[k.strip()] = v.strip()
            elif s.strip():
                result.setdefault("strings", []).append(s)
    if values:
        result.setdefault("values", values)
    return result


def _entity_xdata(entity) -> Optional[dict]:
    try:
        if entity.has_xdata("AQUAFLOW"):
            return {"AQUAFLOW": decode_xdata(entity.get_xdata("AQUAFLOW"))}
    except (DXFError, AttributeError, ValueError):
        pass
    return None


def _linked_handles(tags) -> list:
    out = []
    for tag in tags:
        if tag.code in (340, 360, 330, 1005):
            out.append(str(tag.value))
    return out


def effective_block_name(insert, doc) -> str:
    """Resolve the effective (original) name of a dynamic block reference."""
    name = insert.dxf.get("name", "")
    if not name.startswith("*"):
        return name
    db = doc.entitydb
    # 1) INSERT → ACAD_XDICTIONARY → AcDbBlockRepresentation → AcDbRepData → BLOCK_RECORD
    try:
        if insert.has_extension_dict:
            xdict = insert.get_extension_dict()
            rep = xdict.get("AcDbBlockRepresentation")
            if rep is not None and rep.dxftype() == "DICTIONARY":
                data = rep.get("AcDbRepData")
                candidates = []
                if data is not None:
                    candidates.append(data)
                else:
                    candidates.extend(e for _, e in rep.items())
                for obj in candidates:
                    tags = getattr(obj, "tags", None)
                    if tags is None and hasattr(obj, "xtags"):
                        tags = [t for sub in obj.xtags.subclasses for t in sub]
                    for h in _linked_handles(tags or []):
                        rec = db.get(h)
                        if rec is not None and rec.dxftype() == "BLOCK_RECORD":
                            rname = rec.dxf.get("name", "")
                            if rname and not rname.startswith("*"):
                                return rname
    except (DXFError, AttributeError, KeyError, TypeError):
        pass
    # 2) anonymous BLOCK_RECORD XDATA AcDbBlockRepBTag → 1005 handle of the original record
    try:
        rec = doc.block_records.get(name)
        if rec is not None and rec.has_xdata("AcDbBlockRepBTag"):
            for tag in rec.get_xdata("AcDbBlockRepBTag"):
                if tag.code == 1005:
                    orig = db.get(str(tag.value))
                    if orig is not None and orig.dxftype() == "BLOCK_RECORD":
                        rname = orig.dxf.get("name", "")
                        if rname:
                            return rname
    except (DXFError, AttributeError, KeyError):
        pass
    return name


# ─────────────────────────────────────────────────────────────── reader ──
def read_document(data: bytes, filename: str = "drawing.dxf"):
    """Load DXF bytes (ASCII or binary). Falls back to ezdxf.recover for damaged files."""
    warnings: list = []
    head = data[:32]
    if head.startswith(b"AC10") or head.startswith(b"AC1."):
        raise CadImportError("This is a DWG file. Convert it to DXF (AutoCAD SAVEAS DXF or the "
                             "desktop DWG bridge) before importing.", status=415)
    fd, path = tempfile.mkstemp(suffix=".dxf", prefix="aqf_cad_")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        try:
            doc = ezdxf.readfile(path)
        except (DXFStructureError, DXFError, UnicodeDecodeError, ValueError, IndexError) as exc:
            try:
                doc, auditor = recover.readfile(path)
            except (DXFStructureError, DXFError, OSError, ValueError, IndexError) as exc2:
                raise CadImportError(f"Not a readable DXF file: {exc2 or exc}") from exc2
            warnings.append(f"File was damaged and opened in recover mode ({exc}).")
            fixes = len(getattr(auditor, "fixes", []) or [])
            errs = len(getattr(auditor, "errors", []) or [])
            if fixes or errs:
                warnings.append(f"Recover mode applied {fixes} fixes; {errs} unrecoverable errors.")
    except OSError as exc:
        raise CadImportError(f"Could not read DXF: {exc}") from exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    return doc, warnings


# ────────────────────────────────────────────────────────────── importer ──
class _Importer:
    def __init__(self, doc, to_m: float, flatten_tol_m: float, max_entities: int):
        self.doc = doc
        self.to_m = to_m
        self.tol_du = max(flatten_tol_m, 1e-6) / to_m      # tolerance in drawing units
        self.max_entities = max_entities
        self.scale = Matrix44.scale(to_m, to_m, to_m)
        self.entities: list = []
        self.inserts: list = []
        self.tables: list = []
        self.texts_internal: list = []   # for text-grid reconstruction
        self.warnings: list = []
        self.skipped: Counter = Counter()
        self.truncated = False
        self._stack: list = []
        self.tol_m = max(flatten_tol_m, 1e-6)
        self.layer_colors = {}
        for layer in doc.layers:
            try:
                self.layer_colors[layer.dxf.name] = abs(int(layer.dxf.get("color", 7)))
            except (TypeError, ValueError):
                self.layer_colors[layer.dxf.name] = 7
        self.xref_blocks = set()
        for blk in doc.blocks:
            try:
                if blk.block is not None and (blk.block.dxf.get("flags", 0) & 4):
                    self.xref_blocks.add(blk.name)
            except AttributeError:
                pass

    # -- context helpers ---------------------------------------------------
    def _layer(self, entity, parent_layer: Optional[str]) -> str:
        layer = entity.dxf.get("layer", "0") or "0"
        if parent_layer is not None and layer == "0":
            return parent_layer
        return layer

    def _color(self, entity, layer: str, parent_color: Optional[int]) -> int:
        color = entity.dxf.get("color", 256)
        if color == 0:                       # BYBLOCK
            return parent_color if parent_color is not None else 7
        if color == 256 or color is None:    # BYLAYER
            return self.layer_colors.get(layer, 7)
        return int(color)

    def _full(self) -> bool:
        if len(self.entities) + len(self.inserts) >= self.max_entities:
            if not self.truncated:
                self.truncated = True
                self.warnings.append(
                    f"Entity limit {self.max_entities} reached — the rest of the drawing was skipped.")
            return True
        return False

    def _matrix(self, m: Optional[Matrix44]) -> Matrix44:
        # drawing-units WCS → metres WCS
        return (m * self.scale) if m is not None else self.scale

    # -- traversal -----------------------------------------------------------
    def walk(self, entities, m: Optional[Matrix44], parent_layer, parent_color,
             block_path: list, depth: int, parent_handle: Optional[str],
             handle_override: Optional[str] = None, source_tag: Optional[str] = None):
        for e in entities:
            if self._full():
                return
            try:
                self._entity(e, m, parent_layer, parent_color, block_path, depth,
                             parent_handle, handle_override, source_tag)
            except (DXFError, ValueError, TypeError, ZeroDivisionError, AttributeError,
                    ArithmeticError) as exc:
                t = e.dxftype()
                self.skipped[t] += 1
                if self.skipped[t] <= 3:
                    self.warnings.append(f"Could not convert {t} {e.dxf.get('handle', '?')}: {exc}")

    def _entity(self, e, m, parent_layer, parent_color, block_path, depth, parent_handle,
                handle_override, source_tag):
        t = e.dxftype()
        handle = handle_override or e.dxf.get("handle")
        layer = self._layer(e, parent_layer)
        color = self._color(e, layer, parent_color)
        mm = self._matrix(m)
        if t == "INSERT":
            self._insert(e, m, layer, color, block_path, depth, parent_handle, handle,
                         parent_layer=parent_layer, parent_color=parent_color)
        elif t in ("TEXT", "ATTRIB"):
            self._text(e, mm, layer, color, block_path, handle, source_tag or t)
        elif t == "MTEXT":
            self._mtext(e, mm, layer, color, block_path, handle, source_tag or t)
        elif t == "CIRCLE":
            self._circle(e, mm, layer, color, block_path, handle)
        elif t == "POINT":
            p = mm.transform(Vec3(e.dxf.location))
            self._add({"handle": handle, "layer": layer, "kind": "point", "position": _xy(p),
                       "z": _r(p.z), "color": color, "block_path": list(block_path)}, e)
        elif t == "HATCH" or t == "MPOLYGON":
            self._hatch(e, mm, layer, color, block_path, handle)
        elif t in PATH_TYPES:
            if t == "POLYLINE" and (e.is_poly_face_mesh or e.is_polygon_mesh):
                self.skipped[t] += 1
                return
            self._path_entity(e, mm, layer, color, block_path, handle, t)
        elif t == "MULTILEADER" or t == "MLEADER":
            self.walk(e.virtual_entities(), m, layer, color, block_path, depth, parent_handle,
                      handle_override=handle, source_tag="MLEADER")
        elif t == "ACAD_TABLE":
            self._acad_table(e, m, mm, layer, color, block_path, depth, parent_handle, handle)
        else:
            self.skipped[t] += 1

    def _add(self, record: dict, e=None):
        if e is not None:
            xd = _entity_xdata(e)
            if xd:
                record["xdata"] = xd
        self.entities.append(record)

    def _insert(self, e, m, layer, color, block_path, depth, parent_handle, handle,
                parent_layer=None, parent_color=None, effective=None):
        if getattr(e, "mcount", 1) > 1:
            eff = effective_block_name(e, self.doc)
            for sub in e.multi_insert():
                self._insert(sub, m, layer, color, block_path, depth, parent_handle, handle,
                             parent_layer, parent_color, eff)
            return
        name = e.dxf.get("name", "")
        mm = self._matrix(m)
        ocs = e.ocs()
        local_ins = ocs.to_wcs(Vec3(e.dxf.get("insert", (0, 0, 0))))
        pos = mm.transform(local_ins)
        try:
            child = e.matrix44()
        except (DXFError, ZeroDivisionError, ValueError) as exc:
            self.warnings.append(f"INSERT {handle} ({name}) has an invalid transform: {exc}")
            return
        world = child * m if m is not None else child
        ux = world.transform_direction(Vec3(1, 0, 0))
        uy = world.transform_direction(Vec3(0, 1, 0))
        uz = world.transform_direction(Vec3(0, 0, 1))
        det2 = ux.x * uy.y - ux.y * uy.x
        mirrored = det2 < 0
        sx = ux.magnitude * (-1 if mirrored else 1)
        # decompose as R(rotation) · S(sx, sy): a mirrored block reports sx < 0
        rx, ry = (-ux.x, -ux.y) if mirrored else (ux.x, ux.y)
        rotation = math.degrees(math.atan2(ry, rx)) if (rx or ry) else 0.0
        attribs = {}
        for att in getattr(e, "attribs", []) or []:
            tag = att.dxf.get("tag", "")
            if tag:
                attribs[tag] = plain_mtext(att.dxf.get("text", "")) if "\\" in att.dxf.get("text", "") \
                    else att.dxf.get("text", "")
        xd = _entity_xdata(e)
        effective = effective or effective_block_name(e, self.doc)
        instance = "/".join([str(h) for h in block_path] + [str(handle)])
        rec = {
            "handle": handle, "instance_id": instance, "block": name, "effective_name": effective, "layer": layer,
            "position": [_r(pos.x), _r(pos.y), _r(pos.z)], "rotation_deg": _r(rotation % 360.0),
            "scale": [_r(sx), _r(uy.magnitude), _r(uz.magnitude)], "mirrored": mirrored,
            "attribs": attribs, "xdata": xd or {}, "depth": depth,
            "parent_handle": parent_handle, "block_path": list(block_path), "color": color,
        }
        if name in self.xref_blocks:
            rec["xref"] = True
        self.inserts.append(rec)
        # ATTRIBs are visible text in the parent frame
        for att in getattr(e, "attribs", []) or []:
            if att.is_invisible:
                continue
            # ATTRIBs live in the INSERT's container: layer 0 inherits the container's
            # layer (nested blocks); BYBLOCK takes the INSERT's colour.
            alayer = self._layer(att, parent_layer)
            self._text(att, mm, alayer, self._color(att, alayer, color), block_path,
                       att.dxf.get("handle") or handle, "ATTRIB", owner=handle)
        if name in self.xref_blocks:
            return
        if depth + 1 > MAX_BLOCK_DEPTH:
            self.warnings.append(f"Block nesting deeper than {MAX_BLOCK_DEPTH} at {handle}; truncated.")
            return
        if name in self._stack:
            self.warnings.append(f"Recursive block reference {name} at {handle}; skipped.")
            return
        block = self.doc.blocks.get(name)
        if block is None:
            self.warnings.append(f"INSERT {handle} references missing block {name}.")
            return
        self._stack.append(name)
        try:
            self.walk(block, world, layer, color, block_path + [handle], depth + 1, handle)
        finally:
            self._stack.pop()

    def _text(self, e, mm, layer, color, block_path, handle, source, owner=None):
        raw = e.dxf.get("text", "")
        text = plain_mtext(raw) if ("\\" in raw or "%%" in raw) else raw
        text = text.replace("%%c", "Ø").replace("%%C", "Ø").replace("%%d", "°").replace("%%p", "±")
        text = text.strip()
        if not text:
            return
        ocs = e.ocs()
        halign = e.dxf.get("halign", 0)
        valign = e.dxf.get("valign", 0)
        if (halign or valign) and e.dxf.hasattr("align_point"):
            local = e.dxf.align_point
        else:
            local = e.dxf.get("insert", (0, 0, 0))
        p = mm.transform(ocs.to_wcs(Vec3(local)))
        rot = e.dxf.get("rotation", 0.0)
        d = mm.transform_direction(ocs.to_wcs(Vec3.from_deg_angle(rot)))
        up = mm.transform_direction(ocs.to_wcs(Vec3.from_deg_angle(rot + 90)))
        height = e.dxf.get("height", 2.5) * (up.magnitude or 1.0)
        rotation = math.degrees(math.atan2(d.y, d.x)) % 360.0 if (d.x or d.y) else 0.0
        rec = {"handle": handle, "layer": layer, "kind": "text", "position": _xy(p), "z": _r(p.z),
               "text": text, "height": _r(height), "rotation_deg": _r(rotation), "color": color,
               "source": source, "block_path": list(block_path)}
        if source == "ATTRIB":
            rec["tag"] = e.dxf.get("tag", "")
            rec["owner_handle"] = owner
        self._add(rec, e)
        # horizontal alignment → left edge estimate for grid reconstruction
        width = 0.6 * height * len(text)
        if halign in (1, 4):
            left = p.x - width / 2
        elif halign == 2:
            left = p.x - width
        else:
            left = p.x
        self.texts_internal.append({"text": text, "x0": left, "x1": left + width, "y": p.y,
                                    "h": height, "layer": layer, "handle": handle,
                                    "source": source, "multiline": False})

    def _mtext(self, e, mm, layer, color, block_path, handle, source):
        try:
            text = e.plain_text(split=False)
        except (DXFError, ValueError, TypeError):
            text = plain_mtext(e.text)
        text = text.strip()
        if not text:
            return
        ucs = e.ucs()
        p = mm.transform(Vec3(e.dxf.get("insert", (0, 0, 0))))
        d = mm.transform_direction(ucs.ux)
        up = mm.transform_direction(ucs.uy)
        height = e.dxf.get("char_height", 2.5) * (up.magnitude or 1.0)
        rotation = math.degrees(math.atan2(d.y, d.x)) % 360.0 if (d.x or d.y) else 0.0
        self._add({"handle": handle, "layer": layer, "kind": "text", "position": _xy(p),
                   "z": _r(p.z), "text": text, "height": _r(height), "rotation_deg": _r(rotation),
                   "color": color, "source": source, "block_path": list(block_path)}, e)
        lines = text.splitlines()
        width = 0.6 * height * max(len(s) for s in lines)
        ap = e.dxf.get("attachment_point", 1)
        col = (ap - 1) % 3
        left = p.x - (width / 2 if col == 1 else width if col == 2 else 0)
        row = (ap - 1) // 3   # 0 top, 1 middle, 2 bottom → approximate baseline of first line
        y = p.y - height if row == 0 else (p.y - height / 2 if row == 1 else p.y)
        self.texts_internal.append({"text": text, "x0": left, "x1": left + width, "y": y,
                                    "h": height, "layer": layer, "handle": handle,
                                    "source": source, "multiline": len(lines) > 1})

    def _circle(self, e, mm, layer, color, block_path, handle):
        ocs = e.ocs()
        center = mm.transform(ocs.to_wcs(Vec3(e.dxf.center)))
        r = e.dxf.radius
        tu = mm.transform_direction(ocs.to_wcs(Vec3(1, 0, 0)) - ocs.to_wcs(Vec3(0, 0, 0)))
        tv = mm.transform_direction(ocs.to_wcs(Vec3(0, 1, 0)) - ocs.to_wcs(Vec3(0, 0, 0)))
        planar = abs(tu.z) < 1e-9 and abs(tv.z) < 1e-9
        if planar and abs(tu.magnitude - tv.magnitude) <= 1e-9 * max(1.0, tu.magnitude) \
                and abs(tu.dot(tv)) <= 1e-9 * max(1.0, tu.magnitude ** 2):
            self._add({"handle": handle, "layer": layer, "kind": "circle", "center": _xy(center),
                       "radius": _r(r * tu.magnitude), "z": _r(center.z), "color": color,
                       "block_path": list(block_path)}, e)
        else:
            self._path_entity(e, mm, layer, color, block_path, handle, "CIRCLE")

    def _flatten(self, path, mm) -> list:
        return list(path.transform(mm).flattening(distance=self.tol_m, segments=4))

    def _path_entity(self, e, mm, layer, color, block_path, handle, t):
        from ezdxf import path as ezpath
        path = ezpath.make_path(e)
        subpaths = list(path.sub_paths()) if path.has_sub_paths else [path]
        for sp in subpaths:
            pts = self._flatten(sp, mm)
            if len(pts) < 2:
                continue
            closed = bool(getattr(e, "closed", False)) or bool(getattr(e, "is_closed", False)) \
                or t in ("CIRCLE", "SOLID", "TRACE", "3DFACE") \
                or (t == "ELLIPSE" and abs(abs(e.dxf.end_param - e.dxf.start_param) - math.tau) < 1e-9) \
                or (len(pts) > 2 and pts[0].isclose(pts[-1], abs_tol=1e-9))
            if closed and len(pts) > 2 and pts[0].isclose(pts[-1], abs_tol=1e-9):
                pts = pts[:-1]
            zs = [v.z for v in pts]
            self._add({"handle": handle, "layer": layer, "kind": "polyline",
                       "points": [_xy(v) for v in pts], "closed": closed,
                       "z": _r(sum(zs) / len(zs)), "color": color, "source": t,
                       "block_path": list(block_path)}, e)

    def _hatch(self, e, mm, layer, color, block_path, handle):
        from ezdxf import path as ezpath
        loops = []
        for p in ezpath.from_hatch(e):
            pts = self._flatten(p, mm)
            if len(pts) > 2 and pts[0].isclose(pts[-1], abs_tol=1e-9):
                pts = pts[:-1]
            if len(pts) >= 3:
                loops.append([_xy(v) for v in pts])
        if not loops:
            self.skipped["HATCH(empty)"] += 1
            return
        solid = bool(e.dxf.get("solid_fill", 0))
        pattern = e.dxf.get("pattern_name", "") or ("SOLID" if solid else "")
        self._add({"handle": handle, "layer": layer, "kind": "hatch", "pattern": pattern,
                   "solid": solid, "loops": loops, "color": color, "source": e.dxftype(),
                   "block_path": list(block_path)}, e)

    def _acad_table(self, e, m, mm, layer, color, block_path, depth, parent_handle, handle):
        from ezdxf.entities.acad_table import read_acad_table_content
        if not e.dxf.hasattr("layer"):
            # ezdxf 1.4 does not load AcDbEntity attribs for ACAD_TABLE — read the raw tags
            try:
                raw_layer = e.xtags.get_subclass("AcDbEntity").get_first_value(8, "0")
                layer = parent_layer_or(raw_layer, layer)
                raw_color = e.xtags.get_subclass("AcDbEntity").get_first_value(62, 256)
                color = self.layer_colors.get(layer, 7) if raw_color == 256 else                     (color if raw_color == 0 else abs(int(raw_color)))
            except (DXFError, AttributeError, ValueError, TypeError):
                pass
        rows = []
        try:
            rows = [[plain_mtext(c).strip() if "\\" in c or "{" in c else c.strip() for c in row]
                    for row in read_acad_table_content(e)]
        except (DXFError, AttributeError, ValueError, TypeError) as exc:
            self.warnings.append(f"ACAD_TABLE {handle} content could not be read: {exc}")
        ins = mm.transform(Vec3(e.dxf.get("insert", (0, 0, 0))))
        if rows:
            self.tables.append({"handle": handle, "layer": layer, "source": "acad_table",
                                "rows": rows, "position": _xy(ins)})
        try:
            virtual = list(e.__virtual_entities__())
        except (DXFError, AttributeError, TypeError, ValueError):
            virtual = []
        self.walk(virtual, m, layer, color, block_path, depth, parent_handle,
                  handle_override=handle, source_tag="ACAD_TABLE")


def parent_layer_or(raw_layer: str, inherited: str) -> str:
    """Layer-0 inheritance for entities whose layer was read from raw tags."""
    return inherited if (raw_layer or "0") == "0" else raw_layer


# ──────────────────────────────────────────────────────── text grid (016) ──
def reconstruct_text_grids(texts: list, min_rows: int = 3, min_cols: int = 2) -> list:
    """Rebuild schedules from aligned single-line TEXT/MTEXT (AF-CAD-016).

    Rows: texts whose baselines agree within half a text height, split at
    horizontal gaps above 40 text heights. Tables: runs of consecutive rows with similar text height and
    row pitch ≤ 3 heights. Columns: overlapping x-extents across the run.
    """
    items = [t for t in texts if t["source"] not in ("ATTRIB", "ACAD_TABLE")
             and not t["multiline"] and t["h"] > 0]
    if len(items) < min_rows * min_cols:
        return []
    items.sort(key=lambda t: (-t["y"], t["x0"]))
    # 1. rows by baseline
    rows: list = []
    for t in items:
        placed = False
        for row in reversed(rows[-8:]):
            ref = row["y"]
            if abs(t["y"] - ref) <= 0.5 * min(t["h"], row["h"]) and 0.5 <= t["h"] / row["h"] <= 2.0:
                row["cells"].append(t)
                placed = True
                break
        if not placed:
            rows.append({"y": t["y"], "h": t["h"], "cells": [t]})
    # split rows at big gaps
    split_rows = []
    for row in rows:
        cells = sorted(row["cells"], key=lambda c: c["x0"])
        cur = [cells[0]]
        for c in cells[1:]:
            if c["x0"] - max(p["x1"] for p in cur) > 40 * row["h"]:
                split_rows.append({"y": row["y"], "h": row["h"], "cells": cur})
                cur = [c]
            else:
                cur.append(c)
        split_rows.append({"y": row["y"], "h": row["h"], "cells": cur})
    multi = [r for r in split_rows if len(r["cells"]) >= min_cols]
    multi.sort(key=lambda r: -r["y"])
    used = set()
    tables = []
    for i, start in enumerate(multi):
        if i in used:
            continue
        run = [i]
        x0 = min(c["x0"] for c in start["cells"])
        x1 = max(c["x1"] for c in start["cells"])
        last = start
        for j in range(i + 1, len(multi)):
            if j in used:
                continue
            r = multi[j]
            gap = last["y"] - r["y"]
            h = max(last["h"], r["h"])
            if gap > 3.0 * h:
                break
            rx0 = min(c["x0"] for c in r["cells"])
            rx1 = max(c["x1"] for c in r["cells"])
            if rx1 < x0 or rx0 > x1 or not (0.5 <= r["h"] / start["h"] <= 2.0):
                continue
            run.append(j)
            x0, x1 = min(x0, rx0), max(x1, rx1)
            last = r
        if len(run) < min_rows:
            continue
        run_rows = [multi[k] for k in run]
        # 2. columns: merge overlapping x intervals
        intervals = sorted((c["x0"], c["x1"]) for r in run_rows for c in r["cells"])
        cols = []
        for a, b in intervals:
            if cols and a <= cols[-1][1]:
                cols[-1][1] = max(cols[-1][1], b)
            else:
                cols.append([a, b])
        if len(cols) < min_cols:
            continue
        grid = []
        for r in run_rows:
            out = [""] * len(cols)
            for c in sorted(r["cells"], key=lambda c: c["x0"]):
                mid = (c["x0"] + c["x1"]) / 2
                k = min(range(len(cols)), key=lambda q: 0 if cols[q][0] <= mid <= cols[q][1]
                        else min(abs(mid - cols[q][0]), abs(mid - cols[q][1])))
                out[k] = (out[k] + " " + c["text"]).strip() if out[k] else c["text"]
            grid.append(out)
        filled = sum(1 for row in grid[1:] if sum(1 for v in row if v) >= min_cols)
        if filled < max(2, 0.5 * (len(grid) - 1)):
            continue
        used.update(run)
        layers = Counter(c["layer"] for r in run_rows for c in r["cells"])
        tables.append({"handle": run_rows[0]["cells"][0]["handle"],
                       "layer": layers.most_common(1)[0][0], "source": "text_grid",
                       "rows": grid,
                       "position": [_r(x0), _r(run_rows[0]["y"])],
                       "bbox": [_r(x0), _r(run_rows[-1]["y"] - run_rows[-1]["h"]),
                                _r(x1), _r(run_rows[0]["y"] + run_rows[0]["h"])]})
    return tables


# ──────────────────────────────────────────────────────────────── outlines ──
# Outlines on these layers are annotation / zoning, never basin walls or islands.
# Tokens are matched on upper-cased, accent-free layer-name tokens (prefix match ≥ 4).
NON_STRUCTURAL_LAYER_TOKENS = (
    "DEPTH", "ZONE", "ZONES", "DIM", "DIMS", "DIMENSION", "DIMENSIONS", "MEASURE",
    "MEASUREMENT", "MEASUREMENTS", "ANNO", "ANNOTATION", "ANNOTATIONS", "TEXT", "TITLE",
    "BORDER", "VIEWPORT", "GRID", "HATCH", "PIPE", "PIPEWORK", "LANDSCAPE",
    "PROFUNDIDAD", "COTA", "COTAS", "TIEFE", "BEMASSUNG", "MASSE", "PROFONDEUR",
    "COTATION", "PROFONDITA", "QUOTA", "QUOTE", "PROFUNDIDADE",
)
# AQUAFLOW XDATA kinds that are basin structure; any other kind is excluded.
STRUCTURAL_XDATA_KINDS = {"pool", "island", "basin"}


def outline_exclusion(layer: str, xdata: Optional[dict]) -> Optional[str]:
    """Why a closed outline must not act as a basin or a hole, or None.

    AQUAFLOW XDATA wins (kind pool/island/basin is structural, anything else — depth,
    pipe, land, fixture, label — is not); otherwise depth-zone, dimension,
    measurement and annotation layers are excluded by name.
    """
    aq = (xdata or {}).get("AQUAFLOW") or {}
    kind = str(aq.get("kind") or "").lower()
    if kind:
        return None if kind in STRUCTURAL_XDATA_KINDS else f"AQUAFLOW XDATA kind={kind}"
    import unicodedata
    folded = "".join(ch for ch in unicodedata.normalize("NFKD", str(layer or ""))
                     if not unicodedata.combining(ch)).upper()
    tokens = [t for t in re.split(r"[^A-Z]+", folded) if t]
    for tok in tokens:
        for kw in NON_STRUCTURAL_LAYER_TOKENS:
            if tok == kw or (len(kw) >= 4 and tok.startswith(kw)):
                return f"layer {layer} is {kw.lower()} (not structural)"
    return None


def closed_outlines(entities: list, min_area_m2: float = 1e-4,
                    min_circle_radius_m: float = 0.5, min_block_area_m2: float = 1.0,
                    min_hole_area_m2: float = 0.25) -> list:
    """Closed polylines (and large circles) with area and contained-outline holes.

    Outlines from block expansion are kept only when ≥ `min_block_area_m2` (symbol
    geometry is noise); only outlines ≥ `min_hole_area_m2` count as holes of the
    smallest outline that contains them (so nozzle symbols never punch islands).
    Outlines flagged by `outline_exclusion` (depth zones, dimensions, measurements,
    non-pool AQUAFLOW XDATA …) are listed with `excluded` set but never become holes
    or containers.
    """
    out = []
    for e in entities:
        if e["kind"] == "polyline" and e.get("closed") and len(e["points"]) >= 3:
            pts = e["points"]
        elif e["kind"] == "circle" and e["radius"] >= min_circle_radius_m and not e.get("block_path"):
            cx, cy = e["center"]
            r = e["radius"]
            n = max(24, min(256, int(2 * math.pi * r / 0.1)))
            pts = [[_r(cx + r * math.cos(2 * math.pi * k / n)),
                    _r(cy + r * math.sin(2 * math.pi * k / n))] for k in range(n)]
        else:
            continue
        area = polygon_area(pts)
        if area < min_area_m2 or (e.get("block_path") and area < min_block_area_m2):
            continue
        rec = {"handle": e["handle"], "layer": e["layer"], "points": pts,
               "area_m2": _r(area), "holes": [], "hole_handles": [], "parent_handle": None,
               "block_path": e.get("block_path", []), "source": e.get("source", e["kind"].upper())}
        if e.get("xdata"):
            rec["xdata"] = e["xdata"]
        rec["excluded"] = outline_exclusion(e["layer"], e.get("xdata"))
        out.append(rec)
    if len(out) > MAX_OUTLINES_FOR_HOLES:
        return out
    boxes = [_bbox(o["points"]) for o in out]
    order = sorted(range(len(out)), key=lambda i: out[i]["area_m2"])
    for i in order:
        if out[i]["area_m2"] < min_hole_area_m2 or out[i]["excluded"]:
            continue
        best = None
        bi = boxes[i]
        for j in order:
            if j == i or out[j]["area_m2"] <= out[i]["area_m2"] or out[j]["excluded"]:
                continue
            bj = boxes[j]
            if bi[0] < bj[0] or bi[1] < bj[1] or bi[2] > bj[2] or bi[3] > bj[3]:
                continue
            poly = out[j]["points"]
            if all(point_in_polygon(p, poly) for p in out[i]["points"][:: max(1, len(out[i]["points"]) // 32)]):
                best = j
                break   # ascending area → smallest container first
        if best is not None:
            out[i]["parent_handle"] = out[best]["handle"]
            out[best]["holes"].append(out[i]["points"])
            out[best]["hole_handles"].append(out[i]["handle"])
    return out


# ────────────────────────────────────────────────────────────────── units ──
def suggest_unit(span: float) -> Optional[str]:
    """Pick the unit that puts a unitless drawing's extent in the 2–200 m band."""
    if span <= 0:
        return None
    best, best_score = None, None
    for i, name in enumerate(SUGGEST_ORDER):
        f = UNIT_TABLE[UNIT_OVERRIDES[name]][1]
        size = span * f
        if SUGGEST_RANGE_M[0] <= size <= SUGGEST_RANGE_M[1]:
            score = abs(math.log10(size / 20.0)) + 0.15 * i   # prefer m, then mm …
            if best_score is None or score < best_score:
                best, best_score = name, score
    return best


def _raw_span(doc) -> float:
    """Rough model-space extent in drawing units (for the unitless heuristic)."""
    xs, ys = [], []
    try:
        from ezdxf import bbox as ezbbox
        box = ezbbox.extents(doc.modelspace(), fast=True)
        if box.has_data:
            return max(box.size.x, box.size.y)
    except Exception:  # noqa: BLE001 — bbox is best-effort for the heuristic only
        pass
    return max((max(xs) - min(xs)) if xs else 0, (max(ys) - min(ys)) if ys else 0)


def resolve_units(doc, override: Optional[str], warnings: list) -> dict:
    insunits = int(doc.header.get("$INSUNITS", 0) or 0)
    if override:
        key = override.strip().lower()
        if key not in UNIT_OVERRIDES:
            raise CadImportError(f"Unknown units override '{override}' (use mm|cm|m|in|ft).")
        code = UNIT_OVERRIDES[key]
        return {"insunits": insunits, "name": key, "to_m": UNIT_TABLE[code][1],
                "unitless": insunits == 0, "suggested": None, "override": key}
    if insunits == 0:
        span = _raw_span(doc)
        sug = suggest_unit(span)
        name = sug or "m"
        warnings.append(
            f"Drawing is unitless ($INSUNITS=0); assumed '{name}' from its extents "
            f"({span:.4g} drawing units). Confirm or re-import with units=mm|cm|m|in|ft.")
        return {"insunits": 0, "name": name, "to_m": UNIT_TABLE[UNIT_OVERRIDES[name]][1],
                "unitless": True, "suggested": sug, "override": None}
    if insunits in UNIT_TABLE:
        name, f = UNIT_TABLE[insunits]
    else:
        try:
            f = ezdxf.units.conversion_factor(insunits, 6)
            name = ezdxf.units.decode(insunits) or f"insunits_{insunits}"
        except (TypeError, ValueError, KeyError):
            warnings.append(f"Unsupported $INSUNITS={insunits}; treating drawing units as metres.")
            name, f = "m", 1.0
    return {"insunits": insunits, "name": name, "to_m": f, "unitless": False,
            "suggested": None, "override": None}


# ──────────────────────────────────────────────────────────────── public ──
def import_dxf_bytes(data: bytes, filename: str = "drawing.dxf", *, units: Optional[str] = None,
                     max_mb: float = DEFAULT_MAX_MB, flatten_tol: float = DEFAULT_FLATTEN_TOL_M,
                     recognize: bool = True, template: Optional[dict] = None,
                     max_entities: int = DEFAULT_MAX_ENTITIES) -> dict:
    """Parse DXF bytes into the AF-CAD import contract (metres, CAD WCS, +Y up)."""
    t0 = time.perf_counter()
    if max_mb is None or max_mb <= 0:
        max_mb = DEFAULT_MAX_MB
    if len(data) > max_mb * 1024 * 1024:
        raise CadImportError(f"File is {len(data) / 1048576:.1f} MB — above the {max_mb:g} MB import cap.",
                             status=413)
    if not data:
        raise CadImportError("Empty file.")
    if flatten_tol is None or not (flatten_tol > 0):
        flatten_tol = DEFAULT_FLATTEN_TOL_M
    doc, warnings = read_document(data, filename)
    unit_info = resolve_units(doc, units, warnings)
    to_m = unit_info.pop("to_m")
    override = unit_info.pop("override")
    unit_info = {"insunits": unit_info["insunits"], "name": unit_info["name"], "to_m": to_m,
                 "unitless": unit_info["unitless"], "suggested": unit_info["suggested"]}
    if override:
        unit_info["override"] = override

    imp = _Importer(doc, to_m, flatten_tol, max_entities)
    imp.warnings[:0] = warnings
    imp.walk(doc.modelspace(), None, None, None, [], 0, None)

    tables = imp.tables + reconstruct_text_grids(imp.texts_internal)
    outlines = closed_outlines(imp.entities)

    # extents over output geometry (metres)
    xs, ys = [], []
    for e in imp.entities:
        k = e["kind"]
        if k == "polyline":
            for p in e["points"]:
                xs.append(p[0]); ys.append(p[1])
        elif k == "circle":
            xs += [e["center"][0] - e["radius"], e["center"][0] + e["radius"]]
            ys += [e["center"][1] - e["radius"], e["center"][1] + e["radius"]]
        elif k in ("text", "point"):
            xs.append(e["position"][0]); ys.append(e["position"][1])
        elif k == "hatch":
            for loop in e["loops"]:
                for p in loop:
                    xs.append(p[0]); ys.append(p[1])
    for ins in imp.inserts:
        xs.append(ins["position"][0]); ys.append(ins["position"][1])
    extents = {"min": [_r(min(xs)), _r(min(ys))], "max": [_r(max(xs)), _r(max(ys))]} if xs else \
        {"min": [0.0, 0.0], "max": [0.0, 0.0]}

    # layers
    counts = Counter(e["layer"] for e in imp.entities)
    counts.update(i["layer"] for i in imp.inserts)
    layers = []
    seen = set()
    for layer in doc.layers:
        name = layer.dxf.name
        seen.add(name)
        layers.append({"name": name, "color": imp.layer_colors.get(name, 7),
                       "entity_count": counts.get(name, 0), "off": bool(layer.is_off()),
                       "frozen": bool(layer.is_frozen())})
    for name, n in counts.items():
        if name not in seen:
            layers.append({"name": name, "color": 7, "entity_count": n, "off": False, "frozen": False})

    xrefs = sorted(imp.xref_blocks)
    if xrefs:
        imp.warnings.append("Unresolved external references (not loaded): " + ", ".join(xrefs))

    result = {
        "version": CONTRACT_VERSION,
        "filename": filename,
        "dxf_version": doc.dxfversion,
        "units": unit_info,
        "extents": extents,
        "layers": layers,
        "entities": imp.entities,
        "inserts": imp.inserts,
        "closed_outlines": outlines,
        "tables": tables,
        "xrefs": xrefs,
        "warnings": imp.warnings,
        "stats": {"entities": len(imp.entities), "inserts": len(imp.inserts),
                  "skipped": dict(imp.skipped), "truncated": imp.truncated,
                  "parse_ms": 0},
    }
    if recognize:
        from services.cad_recognition import recognize as _recognize
        result["recognition"] = _recognize(result, template)
    result["stats"]["parse_ms"] = int((time.perf_counter() - t0) * 1000)
    return result


def import_dxf_file(path: str, **kwargs) -> dict:
    with open(path, "rb") as fh:
        data = fh.read()
    return import_dxf_bytes(data, os.path.basename(path), **kwargs)


# ──────────────────────────────────────────────────────── re-import diff ──
def diff_import(previous: list, candidates: list, proximity_m: float = 0.05,
                move_tolerance_m: float = 0.001) -> dict:
    """AF-CAD-017 — compare a previous design's devices with fresh candidates.

    Match order: `aquaflow_id` (XDATA) → `source_handle` → nearest same-type
    within `proximity_m`. Duplicate AQUAFLOW ids in the new import are refused
    as identity keys (they fall through to handle/proximity matching).
    """
    previous = [p for p in (previous or []) if isinstance(p, dict)]
    candidates = [c for c in (candidates or []) if isinstance(c, dict)]
    warnings = []

    def pos(item):
        p = item.get("position") or [0, 0]
        return [float(p[0]), float(p[1])]

    def cid(c, i):
        return c.get("id") or c.get("source_handle") or f"cand_{i}"

    def aid(item):
        a = item.get("aquaflow_id")
        if a is None and isinstance(item.get("xdata"), dict):
            a = (item["xdata"].get("AQUAFLOW") or {}).get("id")
        return str(a) if a not in (None, "") else None

    id_counts = Counter(aid(c) for c in candidates if aid(c))
    dup_ids = sorted(a for a, n in id_counts.items() if n > 1)
    if dup_ids:
        warnings.append("Duplicate AQUAFLOW ids in the drawing were not used for matching: "
                        + ", ".join(dup_ids))
    by_aid = {aid(c): i for i, c in enumerate(candidates) if aid(c) and aid(c) not in dup_ids}
    by_handle = {}
    for i, c in enumerate(candidates):
        h = c.get("source_handle")
        if h is not None:
            by_handle.setdefault(str(h), i)

    taken: set = set()
    matches = []   # (prev, cand_index, how)
    unmatched_prev = []
    for p in previous:
        a = aid(p)
        if a and a in by_aid and by_aid[a] not in taken:
            taken.add(by_aid[a]); matches.append((p, by_aid[a], "aquaflow_id")); continue
        unmatched_prev.append(p)
    rest = []
    for p in unmatched_prev:
        h = p.get("source_handle")
        if h is not None and str(h) in by_handle and by_handle[str(h)] not in taken:
            i = by_handle[str(h)]
            taken.add(i); matches.append((p, i, "source_handle")); continue
        rest.append(p)
    removed = []
    pairs = []
    for pi, p in enumerate(rest):
        pp = pos(p)
        for i, c in enumerate(candidates):
            if i in taken or (p.get("type") and c.get("type") and p["type"] != c["type"]):
                continue
            cp = pos(c)
            d = math.hypot(cp[0] - pp[0], cp[1] - pp[1])
            if d <= proximity_m:
                pairs.append((d, pi, i))
    pairs.sort()
    used_prev = set()
    for d, pi, i in pairs:
        if pi in used_prev or i in taken:
            continue
        used_prev.add(pi); taken.add(i)
        matches.append((rest[pi], i, "proximity"))
    for pi, p in enumerate(rest):
        if pi not in used_prev:
            removed.append(p)

    moved, unchanged = [], []
    for p, i, how in matches:
        c = candidates[i]
        a, b = pos(p), pos(c)
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        entry = {"id": p.get("id"), "candidate_id": cid(c, i), "match": how,
                 "source_handle": c.get("source_handle"), "aquaflow_id": aid(c) or aid(p)}
        if p.get("type") and c.get("type") and p["type"] != c["type"]:
            entry["type_changed"] = {"from": p["type"], "to": c["type"]}
        if d > move_tolerance_m:
            entry.update({"from": [_r(a[0]), _r(a[1])], "to": [_r(b[0]), _r(b[1])],
                          "distance_m": _r(d)})
            moved.append(entry)
        else:
            unchanged.append(entry)
    added = [c for i, c in enumerate(candidates) if i not in taken]
    return {"added": added, "moved": moved, "removed": removed, "unchanged": unchanged,
            "warnings": warnings}
