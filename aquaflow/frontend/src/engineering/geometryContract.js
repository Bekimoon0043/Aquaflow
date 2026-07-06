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
