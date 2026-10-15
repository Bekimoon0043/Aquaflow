/**
 * drafting/arrays.js — AF-CAD-030: fixture array and auto-place generation, moved out of
 * PoolGeometryDesigner.jsx (applyFixtureArray / autoPlaceNozzles). Pure: returns the new
 * fixture records; the caller commits them as ONE transaction (AF-CAD-031).
 * (Associative, editable arrays are AF-CAD-037.)
 */
import { pointInGeometry } from "../poolGeometry";
import { createFixtureEntity, OWNER_MODEL } from "./entities";

/** Bounds of the outline an array is laid out in. */
export function arrayBounds(geometry) {
  if (!geometry) return null;
  if (geometry.type === "circle") {
    const { center: c, radius: r } = geometry;
    return { kind: "circle", cx: c.x, cy: c.y, radius: r, minX: c.x - r, maxX: c.x + r, minY: c.y - r, maxY: c.y + r };
  }
  if (geometry.type === "ellipse") {
    const { center: c, rx, ry } = geometry;
    return { kind: "ellipse", cx: c.x, cy: c.y, rx, ry, minX: c.x - rx, maxX: c.x + rx, minY: c.y - ry, maxY: c.y + ry };
  }
  if (geometry.points?.length) {
    const xs = geometry.points.map((p) => p.x), ys = geometry.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { kind: "polygon", cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, minX, maxX, minY, maxY, width: maxX - minX, length: maxY - minY };
  }
  return null;
}

/**
 * Centerline / ring / grid / edge array of `fixtureType` inside `geometry`.
 * @returns {Array} new fixtures (only those inside the outline)
 */
export function buildFixtureArray({ geometry, fixtureType, typeLabel, existing = [], mode = "centerline", count = 8, rows = 3, cols = 5, inset = 1, zone = "medium", owner = OWNER_MODEL }) {
  const b = arrayBounds(geometry);
  if (!b) return [];
  const n = Math.max(1, Number(count || 1));
  const nr = Math.max(1, Number(rows || 1));
  const nc = Math.max(1, Number(cols || 1));
  const ins = Math.max(0, Number(inset || 0));
  const already = existing.filter((f) => f.type === fixtureType).length;
  const make = (i, x, y, rotation = 0) => createFixtureEntity({
    type: fixtureType, x: Number(x.toFixed(3)), y: Number(y.toFixed(3)), rotation,
    label: `${typeLabel} ${already + i + 1}`, zone, owner,
  });
  const made = [];
  if (mode === "centerline") {
    const x1 = b.minX + ins, x2 = b.maxX - ins, span = Math.max(0.1, x2 - x1);
    for (let i = 0; i < n; i += 1) made.push(make(i, x1 + span * (n === 1 ? 0.5 : i / (n - 1)), b.cy));
  }
  if (mode === "ring") {
    const radius = b.kind === "circle" ? Math.max(0.1, b.radius - ins) : Math.max(0.1, Math.min(b.maxX - b.minX, b.maxY - b.minY) / 2 - ins);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      made.push(make(i, b.cx + Math.cos(a) * radius, b.cy + Math.sin(a) * radius, Number((a * 180 / Math.PI).toFixed(1))));
    }
  }
  if (mode === "grid") {
    const x1 = b.minX + ins, x2 = b.maxX - ins, y1 = b.minY + ins, y2 = b.maxY - ins;
    let k = 0;
    for (let r = 0; r < nr; r += 1) for (let c = 0; c < nc; c += 1) {
      const tx = nc === 1 ? 0.5 : c / (nc - 1), ty = nr === 1 ? 0.5 : r / (nr - 1);
      made.push(make(k, x1 + (x2 - x1) * tx, y1 + (y2 - y1) * ty));
      k += 1;
    }
  }
  if (mode === "edge") {
    // Evenly spaced along the outline, set in from the edge by `inset`, facing inward.
    for (const [i, p] of edgePoints(geometry, n, ins).entries()) made.push(make(i, p.x, p.y, p.rotation));
  }
  return made.filter((fixture) => pointInGeometry(fixture, geometry));
}

/**
 * `n` points spaced by equal arc length around a pool outline, each moved `inset` metres
 * inward along the edge normal. Rotation (degrees) points into the pool.
 */
export function edgePoints(geometry, n, inset = 0) {
  if (!geometry || n < 1) return [];
  if (geometry.type === "circle" || geometry.type === "ellipse") {
    const c = geometry.center, rx = geometry.type === "circle" ? geometry.radius : geometry.rx, ry = geometry.type === "circle" ? geometry.radius : geometry.ry;
    const ax = Math.max(0.05, rx - inset), ay = Math.max(0.05, ry - inset);
    // Equal arc length on an ellipse: sample densely, then walk the cumulative length.
    const steps = 2048, pts = [], len = [0];
    for (let k = 0; k <= steps; k++) { const a = (k / steps) * Math.PI * 2; pts.push({ x: c.x + Math.cos(a) * ax, y: c.y + Math.sin(a) * ay, a }); if (k) len.push(len[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y)); }
    const total = len[steps];
    const out = [];
    for (let i = 0, k = 0; i < n; i++) {
      const target = (i / n) * total;
      while (k < steps && len[k + 1] < target) k++;
      const p = pts[k];
      out.push({ x: p.x, y: p.y, rotation: Number(((p.a * 180 / Math.PI + 180) % 360).toFixed(1)) });
    }
    return out;
  }
  const pts = (geometry.points || []).filter((p, i, list) => i === 0 || Math.hypot(p.x - list[i - 1].x, p.y - list[i - 1].y) > 1e-9);
  if (pts.length > 2 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < 1e-9) pts.pop();
  if (pts.length < 3) return [];
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
  const sign = area > 0 ? 1 : -1; // inward normal side depends on winding
  const edges = pts.map((a, i) => { const b = pts[(i + 1) % pts.length]; const L = Math.hypot(b.x - a.x, b.y - a.y); return { a, b, L, nx: sign * -(b.y - a.y) / L, ny: sign * (b.x - a.x) / L }; });
  const total = edges.reduce((s, e) => s + e.L, 0);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    let d = ((i + 0.5) / n) * total, e = edges[0];
    for (const edge of edges) { e = edge; if (d <= edge.L) break; d -= edge.L; }
    const t = Math.min(1, d / e.L);
    let x = e.a.x + (e.b.x - e.a.x) * t + e.nx * inset, y = e.a.y + (e.b.y - e.a.y) * t + e.ny * inset;
    // Near a sharp corner the offset can cross the neighbouring edge: step toward the centroid.
    for (let k = 0; k < 40 && !pointInGeometry({ x, y }, { ...geometry, points: pts }); k++) { x += (cx - x) * 0.05; y += (cy - y) * 0.05; }
    out.push({ x, y, rotation: Number(((Math.atan2(e.ny, e.nx) * 180 / Math.PI + 360) % 360).toFixed(1)) });
  }
  return out;
}

/** The AUTO-PLACE NOZZLES layout (centre geyser + arch ring + fan ring for circles). */
export function autoPlaceFixtures(geometry, params = {}, { owner = OWNER_MODEL } = {}) {
  if (!geometry) return [];
  const at = (x, y, type, label, zone) => createFixtureEntity({ type, x, y, label, zone, owner });
  const out = [];
  if (geometry.type === "circle") {
    const { center: c, radius: r } = geometry;
    out.push(at(c.x, c.y, "nozzle_geyser", "Center Geyser", "deep"));
    for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2; out.push(at(c.x + Math.cos(a) * r * 0.5, c.y + Math.sin(a) * r * 0.5, "nozzle_arch", `Arch ${i + 1}`, "medium")); }
    for (let i = 0; i < 8; i += 1) { const a = (i / 8) * Math.PI * 2; out.push(at(c.x + Math.cos(a) * r * 0.8, c.y + Math.sin(a) * r * 0.8, "nozzle_fan", `Fan ${i + 1}`, "shallow")); }
  } else if (geometry.points) {
    const xs = geometry.points.map((p) => p.x), ys = geometry.points.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    out.push(at(cx, cy, "nozzle_geyser", "Center Geyser", "deep"));
    const r = Math.min(params.width, params.length) * 0.25;
    for (let i = 0; i < 6; i += 1) { const a = (i / 6) * Math.PI * 2; out.push(at(cx + Math.cos(a) * r, cy + Math.sin(a) * r, "nozzle_arch", `Arch ${i + 1}`, "medium")); }
  }
  return out;
}
