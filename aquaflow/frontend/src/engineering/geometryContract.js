/**
 * geometryContract.js — AF-HUB-003 canonical geometry / axis contract.
 *
 * ONE place that defines how AquaFlow's pool geometry and coordinates map between the
 * Engineering Designer and the 3D preview. Before this, the axis flip lived in
 * fixtureTypeMap.fixturePlanCoords, the pool-center lived in engineeringStore.getPoolBounds
 * (with per-shape branches), and the centering shift was inlined in useEngineeringSync —
 * three scattered pieces of one contract that could drift, and rectangle vs circle were
 * centered by different ad-hoc code. This module is the single source of truth.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────────
 *   Engineering / plan space : (x, y)          — a top-down design plane; y is the
 *                                                 depth axis. This is the STORED truth;
 *                                                 it is never mutated for rendering.
 *   3D / world space         : (x, height, z)  — z is the depth axis, and z === the
 *                                                 engineering y. +Y is up.
 *   Pool placement           : the 3D scene ALWAYS renders the pool centered on the
 *                                                 world origin (0,0,0), sized from
 *                                                 params (radius / width×length).
 *   Therefore a fixture maps: worldX = engX - poolCenterX,
 *                             worldZ = engY - poolCenterY,
 *                             where poolCenter is the shape's geometric center in
 *                             engineering coords (SAME rule for every shape).
 *
 * Every consumer (3D preview sync, pool bounds, export) derives coordinates through
 * these functions so the designer and the 3D preview can never disagree, and a
 * rectangular and a circular pool behave identically.
 */

import { fixturePlanCoords } from "../hooks/fixtureTypeMap.js";

export { fixturePlanCoords };

/** Human-readable statement of the contract (for docs / debugging). */
export const AXIS_CONTRACT = Object.freeze({
  engineering: "(x, y) — plan space, y is depth",
  world: "(x, height, z) — z is depth, z === engineering y, +Y up",
  poolPlacement: "pool centered on world origin; fixtures shifted by pool center",
});

/**
 * poolCenter(geometry, params, poolType) → { cx, cy }
 *
 * The shape's geometric center in ENGINEERING coordinates — the single value used to
 * shift fixtures so the pool sits on the world origin. One rule for every shape:
 *   - circle / ellipse : the stored geometry.center,
 *   - polygon (rect / L-shape / freeform / lake / river) : bounding-box center of points,
 *   - no geometry yet  : derived from params by pool type (matching how the scene sizes it).
 */
export function poolCenter(geometry, params = {}, poolType) {
  if (geometry && (geometry.type === "circle" || geometry.type === "ellipse")) {
    return { cx: Number(geometry.center?.x) || 0, cy: Number(geometry.center?.y) || 0 };
  }
  if (geometry && Array.isArray(geometry.points) && geometry.points.length) {
    const xs = geometry.points.map((p) => Number(p.x) || 0);
    const ys = geometry.points.map((p) => Number(p.y) || 0);
    return { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2 };
  }
  // No geometry: derive from params exactly how the 3D scene sizes the pool.
  const t = String(poolType || "").toLowerCase();
  if (t.includes("circ") || t.includes("ellip")) return { cx: 0, cy: 0 };
  const w = Number(params.width) || 12;
  const l = Number(params.length) || 8;
  return { cx: w / 2, cy: l / 2 };
}

/**
 * poolBounds(geometry, params, poolType) → { minX, maxX, minY, maxY, cx, cy, radius? }
 *
 * The pool's extent + center in engineering coordinates, all derived from the single
 * poolCenter() rule. Used by engineeringStore.getPoolBounds so bounds and the 3D
 * centering shift can never diverge.
 */
export function poolBounds(geometry, params = {}, poolType) {
  const { cx, cy } = poolCenter(geometry, params, poolType);
  if (geometry && geometry.type === "circle") {
    const r = Number(geometry.radius) || Number(params.radius) || 6;
    return { minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r, cx, cy, radius: r };
  }
  if (geometry && geometry.type === "ellipse") {
    const rx = Number(geometry.rx) || (Number(params.width) || 12) / 2;
    const ry = Number(geometry.ry) || (Number(params.length) || 8) / 2;
    return { minX: cx - rx, maxX: cx + rx, minY: cy - ry, maxY: cy + ry, cx, cy };
  }
  if (geometry && Array.isArray(geometry.points) && geometry.points.length) {
    const xs = geometry.points.map((p) => Number(p.x) || 0);
    const ys = geometry.points.map((p) => Number(p.y) || 0);
    return {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys), cx, cy,
    };
  }
  const w = Number(params.width) || 12;
  const l = Number(params.length) || 8;
  return { minX: cx - w / 2, maxX: cx + w / 2, minY: cy - l / 2, maxY: cy + l / 2, cx, cy };
}

/**
 * engineeringToWorld(fixture, center) → { x, z }
 *
 * The single engineering→3D conversion: apply the canonical axis flip (fixturePlanCoords:
 * engineering y → world z) then shift by the pool center so the pool is at the origin.
 * `center` is a { cx, cy } from poolCenter(); omit it to skip centering (raw plan coords).
 */
export function engineeringToWorld(fixture, center = { cx: 0, cy: 0 }) {
  const { x, z } = fixturePlanCoords(fixture);
  return { x: x - (Number(center.cx) || 0), z: z - (Number(center.cy) || 0) };
}

/** Shift an already-projected { x, z } point (e.g. a nozzle/light config) by the pool center. */
export function centerToWorld(point, center = { cx: 0, cy: 0 }) {
  return {
    ...point,
    x: (Number(point.x) || 0) - (Number(center.cx) || 0),
    z: (Number(point.z) || 0) - (Number(center.cy) || 0),
  };
}

/**
 * worldToEngineering(point, center) → { x, y, z }
 *
 * Exact inverse of engineeringToWorld for editable viewport objects. `point.y` is
 * height in 3D; the returned `y` is the engineering plan-depth coordinate and the
 * returned `z` is fixture elevation. Keeping the inverse beside the forward mapping
 * prevents viewport edits from accumulating a pool-centre offset on every save.
 */
export function worldToEngineering(point, center = { cx: 0, cy: 0 }) {
  return {
    x: (Number(point?.x) || 0) + (Number(center.cx) || 0),
    y: (Number(point?.z) || 0) + (Number(center.cy) || 0),
    z: Number(point?.y) || 0,
  };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * AF-CAD-001 — ONE transform chain: CAD WCS → plan → three.js
 * ══════════════════════════════════════════════════════════════════════════════
 *
 *   1. CAD WCS   (X, Y[, Z])  metres, +Y up (north), +Z toward the viewer. This is the
 *                frame the backend importer (POST /api/cad/import) returns after unit
 *                conversion and block-matrix composition; the backend never centres or
 *                flips (docs/CAD-IMPORT-CONTRACT.md).
 *   2. Placement p' = R(rotationDeg) · (p − origin)
 *                origin = the user's pick-point origin (CAD coordinates), rotationDeg is
 *                counter-clockwise in the CAD frame (edge-align sets it so a chosen edge
 *                runs along +X).
 *   3. Plan      plan = (p'.x, flipY ? −p'.y : p'.y)
 *                The designer canvas draws plan +y DOWNWARD, so the default flipY keeps
 *                CAD north at the top of the screen. exportCadDxf uses the exact inverse
 *                (planToCad with the default frame), so export → import is lossless.
 *   4. World     engineeringToWorld(plan, poolCenter(geometry)) → (x, z):
 *                worldX = plan.x − cx, worldZ = plan.y − cy, height = +Y (= CAD Z).
 *                Flat meshes use basinGeometry.toShapePlane (x, −y) with rotation.x = −π/2,
 *                which lands back on worldZ = plan.y; centeredPoolPoints() applies the same
 *                bounding-box centre as poolCenter(), so outline and fixtures share a frame.
 *
 *   Net (default frame): CAD (X, Y, Z) → world (X − cx, Z, −Y − cy). The 3×3 part
 *   [[1,0,0],[0,0,1],[0,−1,0]] has determinant +1: a proper rotation, never a mirror.
 */

export const CAD_FRAME_DEFAULTS = Object.freeze({ origin: Object.freeze({ x: 0, y: 0 }), rotationDeg: 0, flipY: true });

const xyOf = (p) => (Array.isArray(p)
  ? { x: Number(p[0]) || 0, y: Number(p[1]) || 0 }
  : { x: Number(p?.x) || 0, y: Number(p?.y) || 0 });

/** Normalise user placement options ({origin:{x,y}|[x,y], rotationDeg, flipY}) into a frame. */
export function cadFrame(options = {}) {
  const origin = options.origin == null ? CAD_FRAME_DEFAULTS.origin : xyOf(options.origin);
  const rotationDeg = Number(options.rotationDeg) || 0;
  return { origin, rotationDeg, flipY: options.flipY !== false };
}

/** CAD WCS point (metres) → engineering plan point. */
export function cadToPlan(point, frame = CAD_FRAME_DEFAULTS) {
  const f = cadFrame(frame), p = xyOf(point);
  const a = f.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const dx = p.x - f.origin.x, dy = p.y - f.origin.y;
  const x = c * dx - s * dy, y = s * dx + c * dy;
  return { x: x === 0 ? 0 : x, y: f.flipY ? (y === 0 ? 0 : -y) : y };
}

/** Exact inverse of cadToPlan: engineering plan point → CAD WCS point (metres). */
export function planToCad(point, frame = CAD_FRAME_DEFAULTS) {
  const f = cadFrame(frame), p = xyOf(point);
  const y0 = f.flipY ? -p.y : p.y;
  const a = -f.rotationDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const x = c * p.x - s * y0 + f.origin.x, y = s * p.x + c * y0 + f.origin.y;
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

/** A CAD symbol rotation (degrees, CCW in CAD) expressed in the plan frame. */
export function cadRotationToPlan(rotationDeg, frame = CAD_FRAME_DEFAULTS) {
  const f = cadFrame(frame);
  const r = (Number(rotationDeg) || 0) + f.rotationDeg;
  return f.flipY ? (r === 0 ? 0 : -r) : r;
}

/** CAD WCS point → three.js world {x, z} for a pool centred with poolCenter(). */
export function cadToWorld(point, frame = CAD_FRAME_DEFAULTS, center = { cx: 0, cy: 0 }) {
  return engineeringToWorld(cadToPlan(point, frame), center);
}

/** Rotation (deg) that makes the CAD edge a→b run along +X in the plan (edge-align). */
export function edgeAlignRotation(a, b) {
  const p = xyOf(a), q = xyOf(b);
  const deg = -Math.atan2(q.y - p.y, q.x - p.x) * 180 / Math.PI;
  return deg === 0 ? 0 : deg;
}
