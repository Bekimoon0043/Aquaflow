/**
 * drafting/snap.js — AF-CAD-032 unified object-snap engine.
 *
 * One engine drives every point acquisition in AquaFlow: the 2D designer's drawing and
 * dragging, manual pipe drawing (usePipeDrawing) and the 3D scene editor's ground-plane
 * moves (editorSnapping). It replaces three divergent rules (designerSnap grid+underlay,
 * the pipe hook's fixture-centre-or-grid, and the 3D 10 cm grid).
 *
 * Running modes (AutoCAD OSNAP vocabulary, research_notes … autocad_internals_and_cad_ux.md):
 *   Endpoint · Port · Intersection · Midpoint · Center · Insertion · Perpendicular · Nearest
 * with the grid as the lowest-priority fallback.
 *
 * Aperture: a SCREEN radius (default 10 px) converted to world units with the current
 * world-per-pixel, so snapping feels identical at every zoom.
 *
 * Priority (lower wins; distance breaks ties inside a priority):
 *   Endpoint = Port (0) > Intersection (1) > Midpoint (2) > Center = Insertion (3)
 *   > Perpendicular (4) > Nearest (5) > Grid (6)
 * Insertion is not in the plan's priority list; it shares Center's rank because both are
 * an object's defining point (and a nozzle's Port coincides with its insertion anyway).
 *
 * Live entities are indexed in a small uniform-grid spatial index (RBush-like API:
 * insert / search by bbox) — no new dependency. The CAD underlay keeps its own static grid
 * index (cadUnderlay.buildUnderlayIndex — the "Flatbush" role) and is consulted through the
 * `underlay` hook as Endpoint/Center/Insertion candidates.
 *
 * Pure — no React, no DOM, no three.js.
 */
import { fixturePorts } from "./entities";
import { basinOuterPoints } from "../basins";

export const SNAP_MODES = Object.freeze({
  ENDPOINT: "endpoint",
  PORT: "port",
  INTERSECTION: "intersection",
  MIDPOINT: "midpoint",
  CENTER: "center",
  INSERTION: "insertion",
  PERPENDICULAR: "perpendicular",
  NEAREST: "nearest",
  GRID: "grid",
  POLAR: "polar",
});

export const SNAP_PRIORITY = Object.freeze({
  endpoint: 0, port: 0, intersection: 1, midpoint: 2, center: 3, insertion: 3,
  perpendicular: 4, nearest: 5, grid: 6, polar: 6,
});

/** Distinct glyph + tooltip per mode (AutoCAD-style markers, drawn by drawSnapGlyph). */
export const SNAP_GLYPHS = Object.freeze({
  endpoint: { glyph: "square", label: "Endpoint", color: "#ffcc00" },
  port: { glyph: "port", label: "Port", color: "#00ffcc" },
  intersection: { glyph: "x", label: "Intersection", color: "#ffcc00" },
  midpoint: { glyph: "triangle", label: "Midpoint", color: "#ffcc00" },
  center: { glyph: "circle", label: "Center", color: "#ffcc00" },
  insertion: { glyph: "insertion", label: "Insertion", color: "#ffcc00" },
  perpendicular: { glyph: "perpendicular", label: "Perpendicular", color: "#ffcc00" },
  nearest: { glyph: "hourglass", label: "Nearest", color: "#ffcc00" },
  grid: { glyph: "plus", label: "Grid", color: "#7a8a99" },
  polar: { glyph: "plus", label: "Polar", color: "#66ccff" },
});

export const DEFAULT_APERTURE_PX = 10;
export const ALL_OBJECT_MODES = Object.freeze(["endpoint", "port", "intersection", "midpoint", "center", "insertion", "perpendicular", "nearest"]);

// ── grid ────────────────────────────────────────────────────────────────────

/** Round one value to a grid step, normalising -0 and binary noise to the step's decimals. */
export function snapGridValue(value, step) {
  if (!Number.isFinite(value)) return value;
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return value;
  const decimals = Math.min(9, Math.max(0, (String(s).split(".")[1] || "").length + 1));
  const r = Number((Math.round(value / s) * s).toFixed(decimals));
  return r === 0 ? 0 : r;
}

export const snapGridPoint = (pt, step) => ({ x: snapGridValue(pt.x, step), y: snapGridValue(pt.y, step) });

// ── spatial index ───────────────────────────────────────────────────────────

/** A small dynamic uniform-grid index with an RBush-like surface (insert / search / all). */
export class SnapIndex {
  constructor(cellSize = 2) {
    this.cell = Math.max(1e-3, Number(cellSize) || 2);
    this.cells = new Map();
    this.items = [];
  }

  _key(ix, iy) { return `${ix},${iy}`; }

  insert(item) {
    const c = this.cell;
    const x0 = Math.floor(item.minX / c), x1 = Math.floor(item.maxX / c);
    const y0 = Math.floor(item.minY / c), y1 = Math.floor(item.maxY / c);
    const idx = this.items.length;
    this.items.push(item);
    // Very long items (a 200 m pipe) are kept in an overflow list instead of 10k cells.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 4096) { (this.big || (this.big = [])).push(idx); return; }
    for (let ix = x0; ix <= x1; ix += 1) for (let iy = y0; iy <= y1; iy += 1) {
      const k = this._key(ix, iy);
      let list = this.cells.get(k);
      if (!list) { list = []; this.cells.set(k, list); }
      list.push(idx);
    }
  }

  search({ minX, minY, maxX, maxY }) {
    const c = this.cell;
    const seen = new Set();
    const out = [];
    const take = (idx) => {
      if (seen.has(idx)) return;
      seen.add(idx);
      const it = this.items[idx];
      if (it.minX <= maxX && it.maxX >= minX && it.minY <= maxY && it.maxY >= minY) out.push(it);
    };
    const x0 = Math.floor(minX / c), x1 = Math.floor(maxX / c);
    const y0 = Math.floor(minY / c), y1 = Math.floor(maxY / c);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 65536) { this.items.forEach((_, i) => take(i)); return out; }
    for (let ix = x0; ix <= x1; ix += 1) for (let iy = y0; iy <= y1; iy += 1) {
      const list = this.cells.get(this._key(ix, iy));
      if (list) for (const idx of list) take(idx);
    }
    for (const idx of this.big || []) take(idx);
    return out;
  }

  all() { return [...this.items]; }
  get size() { return this.items.length; }
}

// ── snap scene ──────────────────────────────────────────────────────────────

const pointItem = (x, y, mode, extra = {}) => ({ kind: "point", x, y, mode, minX: x, maxX: x, minY: y, maxY: y, ...extra });
const segmentItem = (a, b, extra = {}) => ({
  kind: "segment", a, b,
  minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y), ...extra,
});
const circleItem = (c, r, extra = {}) => ({ kind: "circle", c, r, minX: c.x - r, maxX: c.x + r, minY: c.y - r, maxY: c.y + r, ...extra });

function addPolyline(index, points, { closed = false, entityId = null, source = "outline" } = {}) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if (pts.length < 2) return;
  pts.forEach((p) => index.insert(pointItem(p.x, p.y, "endpoint", { entityId, source })));
  const segs = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segs; i += 1) index.insert(segmentItem(pts[i], pts[(i + 1) % pts.length], { entityId, source }));
}

function addGeometry(index, geometry, entityId) {
  if (!geometry) return;
  if (geometry.type === "circle" && geometry.center) {
    const c = { x: Number(geometry.center.x) || 0, y: Number(geometry.center.y) || 0 };
    index.insert(pointItem(c.x, c.y, "center", { entityId, source: "pool" }));
    index.insert(circleItem(c, Number(geometry.radius) || 0, { entityId, source: "pool" }));
    return;
  }
  if (geometry.type === "ellipse" && geometry.center) {
    const c = { x: Number(geometry.center.x) || 0, y: Number(geometry.center.y) || 0 };
    index.insert(pointItem(c.x, c.y, "center", { entityId, source: "pool" }));
    // Ellipse edge: tessellated (nearest/perpendicular on a 64-gon is within 0.1 % here).
    addPolyline(index, basinOuterPoints(geometry), { closed: true, entityId, source: "pool-edge" });
    return;
  }
  if (geometry.points?.length) addPolyline(index, geometry.points, { closed: geometry.closed !== false, entityId, source: "pool" });
}

/**
 * Build the snap scene for the current design.
 * @param {object} design { fixtures, pipes, geometry, basins, siteSurfaces, measurements }
 * @param {object} opts   { exclude: Set|Array of entity ids/uuids to ignore (the thing being dragged) }
 */
export function buildSnapScene(design = {}, { exclude = null } = {}) {
  const skip = exclude ? new Set([...exclude].map(String)) : null;
  const skipped = (e) => skip && (skip.has(String(e?.id)) || skip.has(String(e?.uuid)));
  const index = new SnapIndex(2);

  for (const f of design.fixtures || []) {
    if (skipped(f) || f?.visible === false) continue;
    const x = Number(f.x), y = Number(f.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    index.insert(pointItem(x, y, "insertion", { entityId: f.id, label: f.label }));
    for (const port of fixturePorts(f)) {
      index.insert(pointItem(port.x, port.y, "port", { entityId: f.id, port, label: `${port.key} DN${port.dn}` }));
    }
  }
  for (const pipe of design.pipes || []) {
    if (skipped(pipe)) continue;
    addPolyline(index, pipe.points, { closed: false, entityId: pipe.id, source: "pipe" });
  }
  const basins = Array.isArray(design.basins) && design.basins.length ? design.basins : null;
  if (basins) {
    basins.forEach((b, i) => {
      if (i === 0 && design.geometry) addGeometry(index, design.geometry, b.id);
      else if (b.type === "circle" || b.type === "ellipse") addGeometry(index, b, b.id);
      else addPolyline(index, basinOuterPoints(b), { closed: true, entityId: b.id, source: "basin" });
      (b.holes || []).forEach((hole) => addPolyline(index, hole, { closed: true, entityId: b.id, source: "island" }));
    });
  } else if (design.geometry) addGeometry(index, design.geometry, "pool");
  for (const s of design.siteSurfaces || []) {
    if (skipped(s) || s?.visible === false) continue;
    addPolyline(index, s.points, { closed: true, entityId: s.id, source: "surface" });
  }
  for (const m of design.measurements || []) {
    addPolyline(index, [{ x: m.x1, y: m.y1 }, { x: m.x2, y: m.y2 }], { entityId: null, source: "measurement" });
  }
  return { index };
}

// ── geometry helpers ────────────────────────────────────────────────────────

function projectOnSegment(p, a, b, clamp = true) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { x: a.x, y: a.y, t: 0 };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  if (clamp) t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy, t };
}

function segmentIntersection(s1, s2) {
  const { a: p, b: p2 } = s1; const { a: q, b: q2 } = s2;
  const r = { x: p2.x - p.x, y: p2.y - p.y };
  const s = { x: q2.x - q.x, y: q2.y - q.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
  const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: p.x + t * r.x, y: p.y + t * r.y };
}

const describe = (mode, extra = {}) => ({ mode, ...SNAP_GLYPHS[mode], ...extra });

/**
 * Find the best snap for `cursor` (world/plan metres).
 *
 * @param {object} cursor     {x, y}
 * @param {object} scene      from buildSnapScene (may be null → grid/raw only)
 * @param {object} opts
 *   worldPerPx  metres per screen pixel (1 / zoom in the 2D designer)
 *   aperturePx  screen aperture radius (default 10)
 *   modes       iterable of enabled object modes (default: all)
 *   osnap       false disables object snaps entirely (grid still applies)
 *   grid        { enabled, step }
 *   from        the previous point of the current command (enables Perpendicular)
 *   underlay    (pt, radiusWorld) → {x, y, kind} | null — CAD underlay vertices
 * @returns {{x, y, mode, glyph, label, color, entityId?, port?, distance}}
 *          mode null when nothing snapped (the raw cursor is returned).
 */
export function findSnap(cursor, scene, {
  worldPerPx = 1 / 30, aperturePx = DEFAULT_APERTURE_PX, modes = ALL_OBJECT_MODES, osnap = true,
  grid = { enabled: false, step: 0.5 }, from = null, underlay = null,
} = {}) {
  const pt = { x: Number(cursor?.x) || 0, y: Number(cursor?.y) || 0 };
  const r = Math.max(1e-9, aperturePx * worldPerPx);
  const enabled = new Set(modes || ALL_OBJECT_MODES);
  let best = null;
  const offer = (x, y, mode, extra = {}) => {
    if (!enabled.has(mode)) return;
    const d = Math.hypot(x - pt.x, y - pt.y);
    if (d > r + 1e-12) return;
    const pr = SNAP_PRIORITY[mode];
    if (!best || pr < best.priority || (pr === best.priority && d < best.distance)) {
      best = { x, y, mode, priority: pr, distance: d, ...extra };
    }
  };

  if (osnap !== false && scene?.index) {
    const items = scene.index.search({ minX: pt.x - r, minY: pt.y - r, maxX: pt.x + r, maxY: pt.y + r });
    const segments = [];
    for (const it of items) {
      if (it.kind === "point") offer(it.x, it.y, it.mode, { entityId: it.entityId, port: it.port, source: it.source, itemLabel: it.label });
      else if (it.kind === "segment") {
        segments.push(it);
        offer((it.a.x + it.b.x) / 2, (it.a.y + it.b.y) / 2, "midpoint", { entityId: it.entityId, source: it.source });
        const near = projectOnSegment(pt, it.a, it.b);
        offer(near.x, near.y, "nearest", { entityId: it.entityId, source: it.source });
        if (from) {
          const foot = projectOnSegment(from, it.a, it.b, false);
          if (foot.t >= -1e-9 && foot.t <= 1 + 1e-9 && Math.hypot(foot.x - from.x, foot.y - from.y) > 1e-9) {
            offer(foot.x, foot.y, "perpendicular", { entityId: it.entityId, source: it.source });
          }
        }
      } else if (it.kind === "circle") {
        const dx = pt.x - it.c.x, dy = pt.y - it.c.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-9) offer(it.c.x + (dx / len) * it.r, it.c.y + (dy / len) * it.r, "nearest", { entityId: it.entityId, source: it.source });
        if (from) {
          const fx = from.x - it.c.x, fy = from.y - it.c.y, fl = Math.hypot(fx, fy);
          if (fl > 1e-9) offer(it.c.x + (fx / fl) * it.r, it.c.y + (fy / fl) * it.r, "perpendicular", { entityId: it.entityId, source: it.source });
        }
      }
    }
    if (enabled.has("intersection") && segments.length > 1 && segments.length < 400) {
      for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
        if (segments[i].entityId !== null && segments[i].entityId === segments[j].entityId && sharesEnd(segments[i], segments[j])) continue;
        const hit = segmentIntersection(segments[i], segments[j]);
        if (hit) offer(hit.x, hit.y, "intersection", { entityId: segments[i].entityId });
      }
    }
    if (typeof underlay === "function" && (!best || best.priority > 0)) {
      const u = underlay(pt, r);
      if (u && Number.isFinite(u.x) && Number.isFinite(u.y)) {
        const mode = u.kind === "center" ? "center" : u.kind === "insertion" ? "insertion" : "endpoint";
        offer(u.x, u.y, mode, { source: "underlay" });
      }
    }
  }

  if (best) {
    const { priority, ...rest } = best;
    const label = rest.mode === "port" && rest.port ? `Port · ${rest.port.key} DN${rest.port.dn}` : SNAP_GLYPHS[rest.mode].label;
    return { ...describe(rest.mode), ...rest, label };
  }
  if (grid?.enabled) {
    const g = snapGridPoint(pt, Number(grid.step) > 0 ? Number(grid.step) : 0.5);
    return { ...describe("grid"), ...g, distance: Math.hypot(g.x - pt.x, g.y - pt.y) };
  }
  return { x: pt.x, y: pt.y, mode: null, glyph: null, label: null, color: null, distance: 0 };
}

function sharesEnd(s1, s2) {
  const eq = (p, q) => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
  return eq(s1.a, s2.a) || eq(s1.a, s2.b) || eq(s1.b, s2.a) || eq(s1.b, s2.b);
}

/** Convenience: snap a point against a design in one call (builds a throw-away scene). */
export function snapDesignPoint(cursor, design, opts = {}) {
  return findSnap(cursor, buildSnapScene(design, { exclude: opts.exclude }), opts);
}

// ── rendering (canvas 2D) ───────────────────────────────────────────────────

/** Draw the snap marker for a snap result at screen (sx, sy). */
export function drawSnapGlyph(ctx, snap, sx, sy, { size = 7, showLabel = true } = {}) {
  if (!snap?.mode) return;
  const g = SNAP_GLYPHS[snap.mode];
  if (!g) return;
  const s = size;
  ctx.save();
  ctx.strokeStyle = g.color;
  ctx.fillStyle = g.color;
  ctx.lineWidth = 2;
  ctx.setLineDash?.([]);
  ctx.beginPath();
  switch (g.glyph) {
    case "square": ctx.rect(sx - s, sy - s, s * 2, s * 2); break;
    case "port":
      ctx.arc(sx, sy, s, 0, Math.PI * 2);
      ctx.moveTo(sx - s - 3, sy); ctx.lineTo(sx + s + 3, sy);
      ctx.moveTo(sx, sy - s - 3); ctx.lineTo(sx, sy + s + 3);
      break;
    case "x": ctx.moveTo(sx - s, sy - s); ctx.lineTo(sx + s, sy + s); ctx.moveTo(sx + s, sy - s); ctx.lineTo(sx - s, sy + s); break;
    case "triangle": ctx.moveTo(sx, sy - s); ctx.lineTo(sx + s, sy + s); ctx.lineTo(sx - s, sy + s); ctx.closePath(); break;
    case "circle": ctx.arc(sx, sy, s, 0, Math.PI * 2); break;
    case "insertion":
      ctx.rect(sx - s, sy - s, s, s); ctx.rect(sx, sy, s, s);
      break;
    case "perpendicular":
      ctx.moveTo(sx - s, sy + s); ctx.lineTo(sx + s, sy + s);
      ctx.moveTo(sx - s, sy + s); ctx.lineTo(sx - s, sy - s);
      ctx.moveTo(sx - s, sy); ctx.lineTo(sx, sy); ctx.lineTo(sx, sy + s);
      break;
    case "hourglass": ctx.moveTo(sx - s, sy - s); ctx.lineTo(sx + s, sy - s); ctx.lineTo(sx - s, sy + s); ctx.lineTo(sx + s, sy + s); ctx.closePath(); break;
    default: ctx.moveTo(sx - s, sy); ctx.lineTo(sx + s, sy); ctx.moveTo(sx, sy - s); ctx.lineTo(sx, sy + s);
  }
  ctx.stroke();
  if (showLabel && snap.label) {
    ctx.font = "10px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(2,8,16,0.85)";
    const text = snap.label;
    const w = (ctx.measureText?.(text)?.width || text.length * 6) + 8;
    ctx.fillRect(sx + s + 6, sy - s - 16, w, 14);
    ctx.fillStyle = g.color;
    ctx.fillText(text, sx + s + 10, sy - s - 4);
  }
  ctx.restore();
}
