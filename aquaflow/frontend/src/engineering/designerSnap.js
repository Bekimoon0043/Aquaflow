/**
 * designerSnap.js — pure point-acquisition helpers for the 2D Engineering Designer.
 *
 * AF-CAD-002: dragging a fixture used to quantise to 0.1 m even with SNAP off
 * (Math.round(world.x*10)/10 applied after the grid snap). The rule now is:
 *   - SNAP off → full precision (the status bar shows mm),
 *   - SNAP on  → snapped exactly ONCE to gridStep, no second rounding.
 * Optional `underlaySnap(pt)` (from cadUnderlay's spatial index) wins over the grid
 * when it finds a CAD vertex inside the pick aperture.
 */

const num = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** Snap a plan point to the grid when enabled; otherwise return it unchanged (full precision). */
export function snapPlanPoint(point, { enabled = false, step = 0.5, underlaySnap = null } = {}) {
  const pt = { x: num(point?.x), y: num(point?.y) };
  if (!enabled) return pt;
  if (typeof underlaySnap === "function") {
    const hit = underlaySnap(pt);
    if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y)) return { x: hit.x, y: hit.y };
  }
  const s = num(step, 0.5) > 0 ? num(step, 0.5) : 0.5;
  // Snap once; normalise -0 and binary noise (0.1 * 3 = 0.30000000000000004) to the step's decimals.
  const decimals = Math.min(9, Math.max(0, (String(s).split(".")[1] || "").length + 1));
  const snap = (v) => { const r = Number((Math.round(v / s) * s).toFixed(decimals)); return r === 0 ? 0 : r; };
  return { x: snap(pt.x), y: snap(pt.y) };
}

/** New position of a fixture being dragged in the select tool (AF-CAD-002). */
export function fixtureDragPosition(rawWorld, { snapToGrid = false, gridStep = 0.5, underlaySnap = null } = {}) {
  return snapPlanPoint(rawWorld, { enabled: snapToGrid, step: gridStep, underlaySnap });
}
