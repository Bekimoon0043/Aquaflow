/**
 * camera/cameraLaneModel.js — pure helpers behind the Camera lane: capturing a view as a key,
 * the "Rail along a guide line" move, saved view slots (Ctrl+1..9) and a small undo history.
 */
import { addCameraKey, cameraKeyAt, normalizeCameraTrack } from "./cameraTrack";
import { siteBounds as navSiteBounds } from "./navMath";

/**
 * Site bounds (3D world) straight from the engineering design, for when no 3D view is open.
 * `center` = poolCenter(...) of the design (plan metres).
 */
export function designBounds({ poolType, params = {}, fixtures = [], center = { cx: 0, cy: 0 } } = {}) {
  const pts = (fixtures || []).map((f) => ({
    x: (Number(f.x) || 0) - center.cx, z: (Number(f.y) || 0) - center.cy,
    h: Number(f.engineering?.jetHeightM) || undefined,
  }));
  const b = navSiteBounds({ poolType: String(poolType || "").includes("circ") ? "circular" : poolType, width: params.width, length: params.length, radius: params.radius }, pts);
  return { ...b, size: { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z } };
}

const finite = (v) => Number.isFinite(Number(v));

/** A key for the camera `view` ({position, target, fov}) at time t; replaces a key already there. */
export function keyFromView(track, view, t, { label } = {}) {
  if (!view?.position || !view?.target) return normalizeCameraTrack(track);
  const here = cameraKeyAt(track, t);
  const n = normalizeCameraTrack(track).keys.length;
  return addCameraKey(track, {
    ...(here ? { id: here.id } : {}),
    t: Math.max(0, Number(t) || 0),
    position: { ...view.position },
    target: { ...view.target },
    fov: finite(view.fov) ? Number(view.fov) : here?.fov,
    roll: 0,
    ease: here?.ease || "smooth",
    label: label || here?.label || `Camera ${here ? n : n + 1}`,
  });
}

/** Insert keys (from buildCameraMove or the rail) into the track; later keys win at equal times. */
export const addKeys = (track, keys = []) => keys.reduce((acc, k) => addCameraKey(acc, k), normalizeCameraTrack(track));

/** Plan (engineering x/y metres) → 3D world (x, z), the pool centred on the origin. */
export const planToWorld = (p, center = { cx: 0, cy: 0 }, y = 0) => ({ x: (Number(p.x) || 0) - center.cx, y, z: (Number(p.y) || 0) - center.cy });

/** `n` points evenly spaced by length along a polyline (closed paths include the closing edge). */
export function resamplePath(points = [], n = 12, closed = false) {
  const pts = points.filter((p) => finite(p?.x) && finite(p?.y));
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const path = closed ? [...pts, pts[0]] : pts;
  const seg = [];
  let total = 0;
  for (let i = 1; i < path.length; i += 1) { const l = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); seg.push(l); total += l; }
  if (total <= 1e-9) return [{ ...pts[0] }];
  const count = Math.max(2, Math.round(n));
  const step = closed ? total / count : total / (count - 1);
  const out = [];
  for (let k = 0; k < count + (closed ? 1 : 0); k += 1) {
    let s = Math.min(total, k * step), i = 0;
    while (i < seg.length - 1 && s > seg[i]) { s -= seg[i]; i += 1; }
    const u = seg[i] > 0 ? Math.min(1, s / seg[i]) : 0;
    out.push({ x: path[i].x + (path[i + 1].x - path[i].x) * u, y: path[i].y + (path[i + 1].y - path[i].y) * u });
  }
  return out;
}

/**
 * Keys that move the camera along a designer guide line at eye height, always looking at the
 * site centre. Closed guides go once round and end where they started.
 */
export function railKeys(guide, { start = 0, duration = 10, eyeHeight = 1.6, center = { cx: 0, cy: 0 }, target = { x: 0, y: 1.5, z: 0 }, fov = 50, samples } = {}) {
  const pts = guide?.points || [];
  if (pts.length < 2) return [];
  const closed = !!guide.closed;
  const n = samples || Math.min(24, Math.max(4, pts.length * 2));
  const stations = resamplePath(pts, n, closed);
  const T = Math.max(0.1, Number(duration) || 10), t0 = Math.max(0, Number(start) || 0);
  const last = stations.length - 1;
  return stations.map((p, i) => ({
    t: Number((t0 + (last ? (i / last) * T : 0)).toFixed(4)),
    position: planToWorld(p, center, eyeHeight),
    target: { ...target },
    fov,
    roll: 0,
    ease: "smooth",
    ...(i === 0 ? { label: `Rail · ${guide.label || "guide line"}` } : {}),
  }));
}

/** Store the view in saved-view slot n (1..9) of render.cameraViews. */
export function saveViewSlot(views = [], slot, view) {
  if (!view?.position || !view?.target) return views;
  const id = `slot-${slot}`;
  const entry = { id, name: `View ${slot}`, position: { ...view.position }, target: { ...view.target }, ...(finite(view.fov) ? { fov: Math.min(90, Math.max(8, Number(view.fov))) } : {}) };
  const rest = (views || []).filter((v) => v?.id !== id);
  return [...rest, entry];
}

export const viewInSlot = (views = [], slot) => (views || []).find((v) => v?.id === `slot-${slot}`) || null;

/** Undo/redo stack of whole tracks (the camera lane's own history). */
export function createTrackHistory(limit = 50) {
  const past = [], future = [];
  return {
    push(track) { past.push(normalizeCameraTrack(track)); if (past.length > limit) past.shift(); future.length = 0; },
    undo(current) { if (!past.length) return null; future.push(normalizeCameraTrack(current)); return past.pop(); },
    redo(current) { if (!future.length) return null; past.push(normalizeCameraTrack(current)); return future.pop(); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}
