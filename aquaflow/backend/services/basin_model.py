"""
basin_model.py — AF-CAD-013 / AF-NEXT-010 multi-basin data model (backend side).

Mirror of ``frontend/src/engineering/basins.js``. An engineering project carries

    basins: [{id, name, outer: [{x, y}], holes: [[{x, y}]], floorLevel?, wallHeight?,
              depthZones: [...], type?, center?, radius?, rx?, ry?, poolType?, params?}]

in the plan frame (metres, y grows down the screen). The legacy single ``geometry``
(+ holes, floorLevel, wallHeight) is always ``basins[0]`` in the old shape, so code that
is not multi-basin aware keeps reading the primary basin.

Both shapes are accepted everywhere:
  * a legacy project (``geometry`` only) migrates losslessly to ``basins = [geometry]``;
  * a project with ``basins`` and no ``geometry`` gets ``geometry`` derived from basins[0];
  * the pre-AF-NEXT-010 backend extension ``basins: [{points, holes}]`` (EXTRA basins next
    to ``geometry``, never including it) is still read as extra basins.
"""
from __future__ import annotations

import copy
import math
from typing import Optional

PRIMITIVES = ("circle", "ellipse")
_OWN_KEYS = ("id", "name", "outer", "holes", "depthZones", "poolType", "params")


def _num(v, default=None):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    return f if math.isfinite(f) else default


def _pt(p) -> Optional[tuple[float, float]]:
    if isinstance(p, dict):
        x, y = _num(p.get("x")), _num(p.get("y", p.get("z")))
    elif isinstance(p, (list, tuple)) and len(p) >= 2:
        x, y = _num(p[0]), _num(p[1])
    else:
        return None
    return None if x is None or y is None else (x, y)


def ring(seq) -> list[tuple[float, float]]:
    if isinstance(seq, dict):
        seq = seq.get("points")
    return [q for q in (_pt(p) for p in (seq or [])) if q is not None]


def tessellate(shape: dict, segments: int = 64) -> list[tuple[float, float]]:
    t = str(shape.get("type") or "").lower()
    if t in PRIMITIVES:
        c = _pt(shape.get("center")) or (0.0, 0.0)
        rx = _num(shape.get("radius") if t == "circle" else shape.get("rx"), 0.0)
        ry = _num(shape.get("radius") if t == "circle" else shape.get("ry"), 0.0)
        return [(c[0] + math.cos(2 * math.pi * i / segments) * rx,
                 c[1] + math.sin(2 * math.pi * i / segments) * ry) for i in range(segments)]
    return ring(shape.get("points"))


def is_model_basins(project: dict) -> bool:
    """True when ``project.basins`` is the AF-NEXT-010 list (it includes the primary basin)."""
    basins = project.get("basins") if isinstance(project, dict) else None
    return isinstance(basins, list) and any(isinstance(b, dict) and "outer" in b for b in basins)


def geometry_to_basin(geometry: dict, *, id: str = "basin-1", name: str = "Basin 1",
                      pool_type: Optional[str] = None, params: Optional[dict] = None,
                      depth_zones: Optional[list] = None) -> Optional[dict]:
    if not isinstance(geometry, dict):
        return None
    rest = copy.deepcopy(geometry)
    points = rest.pop("points", None)
    holes = rest.pop("holes", None)
    for k in _OWN_KEYS:
        rest.pop(k, None)
    outer = points if isinstance(points, list) and points else \
        [{"x": x, "y": y} for x, y in tessellate(geometry)]
    basin = {**rest, "id": str(id), "name": str(name or id), "outer": outer,
             "holes": holes if isinstance(holes, list) else [], "depthZones": copy.deepcopy(depth_zones or [])}
    if pool_type:
        basin["poolType"] = pool_type
    if params:
        basin["params"] = copy.deepcopy(params)
    return basin


def basin_to_geometry(basin: dict) -> Optional[dict]:
    if not isinstance(basin, dict):
        return None
    g = copy.deepcopy(basin)
    for k in _OWN_KEYS:
        g.pop(k, None)
    if str(g.get("type") or "").lower() not in PRIMITIVES:
        g["points"] = copy.deepcopy(basin.get("outer") or [])
    if basin.get("holes"):
        g["holes"] = copy.deepcopy(basin["holes"])
    return g


def migrate_project(project: dict) -> dict:
    """Return a copy of ``project`` carrying both ``basins`` (model) and legacy ``geometry``.

    Lossless: the legacy ``geometry`` object is kept byte-for-byte; basins[0] is rebuilt
    from it (geometry wins for the primary basin, exactly like the frontend), other
    model basins are kept. A project with only basins gets geometry = basins[0].
    """
    out = copy.deepcopy(project or {})
    geom = out.get("geometry") if isinstance(out.get("geometry"), dict) else None
    model = [b for b in (out.get("basins") or []) if isinstance(b, dict)] if is_model_basins(out) else []
    legacy_extra = [] if model else [b for b in (out.get("basins") or []) if isinstance(b, dict)]
    pool_type = out.get("pool_type") or out.get("poolType")
    if geom is not None:
        head = model[0] if model else {}
        primary = geometry_to_basin(geom, id=head.get("id") or "basin-1", name=head.get("name") or "Basin 1",
                                    pool_type=pool_type, params=out.get("params"),
                                    depth_zones=head.get("depthZones"))
        extras = model[1:] if model else [
            {"id": b.get("id") or f"basin-{i + 2}", "name": b.get("name") or f"Basin {i + 2}",
             "outer": b.get("points") or [], "holes": b.get("holes") or [], "depthZones": [],
             **({"depth": b["depth"]} if b.get("depth") is not None else {})}
            for i, b in enumerate(legacy_extra)]
        out["basins"] = [primary] + [b for b in extras if len(ring(b.get("outer"))) >= 3]
    elif model:
        out["geometry"] = basin_to_geometry(model[0])
        out["basins"] = model
    else:
        out["basins"] = []
    return out


def normalize_basins(project: dict) -> list[dict]:
    """Every basin in plan coordinates, ready for geometry work.

    Returns ``[{id, name, type, points: [(x, y)], center?, radius?, rx?, ry?, holes: [[(x, y)]],
    floorLevel, wallHeight, depth}]`` (``points`` tessellated for circles/ellipses).
    Empty when the project has neither geometry nor basins.
    """
    migrated = migrate_project(project)
    depth = _num((migrated.get("params") or {}).get("depth"), 0.8) or 0.8
    out = []
    for i, b in enumerate(migrated.get("basins") or []):
        t = str(b.get("type") or "").lower()
        pts = ring(b.get("outer"))
        if len(pts) < 3 and t in PRIMITIVES:
            pts = tessellate(b)
        if len(pts) < 3:
            continue
        rec = {"id": str(b.get("id") or f"basin-{i + 1}"), "name": str(b.get("name") or f"Basin {i + 1}"),
               "type": "circle" if t == "circle" else "ellipse" if t == "ellipse" else "polygon",
               "points": pts, "closed": b.get("closed") is not False,
               "holes": [h for h in (ring(h) for h in (b.get("holes") or [])) if len(h) >= 3],
               "floorLevel": _num(b.get("floorLevel")), "wallHeight": _num(b.get("wallHeight")),
               "depth": _num(b.get("depth"), _num((b.get("params") or {}).get("depth"), depth)),
               "primary": i == 0}
        if t == "circle":
            rec["center"] = _pt(b.get("center")) or (0.0, 0.0)
            rec["radius"] = _num(b.get("radius"), 0.0)
        elif t == "ellipse":
            rec["center"] = _pt(b.get("center")) or (0.0, 0.0)
            rec["rx"], rec["ry"] = _num(b.get("rx"), 0.0), _num(b.get("ry"), 0.0)
        out.append(rec)
    return out


def _point_in_ring(x: float, y: float, pts: list) -> bool:
    inside = False
    j = len(pts) - 1
    for i in range(len(pts)):
        ax, ay = pts[i]
        bx, by = pts[j]
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / ((by - ay) or 1e-12) + ax:
            inside = not inside
        j = i
    return inside


def _dist_to_ring(x: float, y: float, pts: list) -> float:
    best = math.inf
    for i in range(len(pts)):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % len(pts)]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / l2)) if l2 else 0.0
        best = min(best, math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
    return best


def point_in_basin(x: float, y: float, basin: dict, tol: float = 1e-9) -> bool:
    pts = basin["points"]
    if not (_point_in_ring(x, y, pts) or _dist_to_ring(x, y, pts) <= tol):
        return False
    return not any(_point_in_ring(x, y, h) and _dist_to_ring(x, y, h) > tol for h in basin.get("holes") or [])


def basin_for_point(basins: list, x: float, y: float) -> tuple[Optional[dict], bool]:
    """(basin, contained). Falls back to the nearest outline (contained=False)."""
    for b in basins:
        if point_in_basin(x, y, b):
            return b, True
    if not basins:
        return None, False
    return min(basins, key=lambda b: _dist_to_ring(x, y, b["points"])), False


def polygon_area(pts: list) -> float:
    if len(pts) < 3:
        return 0.0
    s = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2.0


def basin_area(basin: dict) -> float:
    """Water surface (outline minus islands), m²."""
    if basin.get("type") == "circle":
        outer = math.pi * (basin.get("radius") or 0.0) ** 2
    elif basin.get("type") == "ellipse":
        outer = math.pi * (basin.get("rx") or 0.0) * (basin.get("ry") or 0.0)
    else:
        outer = polygon_area(basin["points"])
    return max(0.0, outer - sum(polygon_area(h) for h in basin.get("holes") or []))
