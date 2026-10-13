/**
 * drafting/geometryEdit.js — AF-CAD-030: pool-outline editing rules moved out of
 * PoolGeometryDesigner.jsx (grips, stretch, move, typed properties). Pure: every function
 * returns the next { geometry, params } instead of calling React setters.
 */

/** Grip handles of a circle/ellipse (E, W, S, N). */
export function radialHandles(geometry) {
  if (geometry?.type === "circle") {
    const { center: c, radius: r } = geometry;
    return [{ x: c.x + r, y: c.y }, { x: c.x - r, y: c.y }, { x: c.x, y: c.y + r }, { x: c.x, y: c.y - r }];
  }
  if (geometry?.type === "ellipse") {
    const { center: c, rx, ry } = geometry;
    return [{ x: c.x + rx, y: c.y }, { x: c.x - rx, y: c.y }, { x: c.x, y: c.y + ry }, { x: c.x, y: c.y - ry }];
  }
  return [];
}

/** The grip under `pt` (plan metres), with an 8 px / 0.15 m pick radius. */
export function hitGrip(geometry, pt, zoom) {
  const threshold = Math.max(0.15, 8 / zoom);
  if (geometry?.type === "circle" || geometry?.type === "ellipse") {
    const index = radialHandles(geometry).findIndex((h) => Math.hypot(h.x - pt.x, h.y - pt.y) <= threshold);
    if (index < 0) return null;
    if (geometry.type === "circle") return { type: "radius", index };
    return { type: index < 2 ? "ellipse-x" : "ellipse-y", index };
  }
  if (!geometry?.points?.length) return null;
  for (let i = 0; i < geometry.points.length; i += 1) {
    const p = geometry.points[i];
    if (Math.hypot(p.x - pt.x, p.y - pt.y) <= threshold) return { type: "vertex", index: i };
  }
  return null;
}

/** Index of the vertex of `surface` under `pt`, or null. */
export function hitSurfaceVertex(surface, pt, zoom) {
  if (!surface) return null;
  const threshold = Math.max(0.15, 8 / zoom);
  for (let index = 0; index < surface.points.length; index += 1) {
    const point = surface.points[index];
    if (Math.hypot(point.x - pt.x, point.y - pt.y) <= threshold) return index;
  }
  return null;
}

/** Stretch the outline by dragging `grip` to the (already snapped) point. */
export function stretchFromGrip({ geometry, params, poolType }, grip, snapped) {
  if (geometry?.type === "circle" && grip?.type === "radius") {
    const radius = Math.max(0.1, Math.hypot(snapped.x - geometry.center.x, snapped.y - geometry.center.y));
    return { geometry: { ...geometry, radius }, params: { ...params, radius: Number(radius.toFixed(3)) } };
  }
  if (geometry?.type === "ellipse" && (grip?.type === "ellipse-x" || grip?.type === "ellipse-y")) {
    if (grip.type === "ellipse-x") {
      const rx = Math.max(0.1, Math.abs(snapped.x - geometry.center.x));
      return { geometry: { ...geometry, rx }, params: { ...params, width: Number((rx * 2).toFixed(3)) } };
    }
    const ry = Math.max(0.1, Math.abs(snapped.y - geometry.center.y));
    return { geometry: { ...geometry, ry }, params: { ...params, length: Number((ry * 2).toFixed(3)) } };
  }
  if (!geometry?.points?.length || grip?.type !== "vertex") return null;
  const pts = geometry.points;
  if (poolType !== "rectangular" || pts.length !== 4) {
    const nextPoints = pts.map((point, index) => (index === grip.index ? snapped : point));
    const xs = nextPoints.map((point) => point.x);
    const ys = nextPoints.map((point) => point.y);
    return {
      geometry: { ...geometry, points: nextPoints },
      params: {
        ...params,
        width: Number(Math.max(0.1, Math.max(...xs) - Math.min(...xs)).toFixed(3)),
        length: Number(Math.max(0.1, Math.max(...ys) - Math.min(...ys)).toFixed(3)),
      },
    };
  }
  const opposite = pts[(grip.index + 2) % 4];
  const minX = Math.min(opposite.x, snapped.x), maxX = Math.max(opposite.x, snapped.x);
  const minY = Math.min(opposite.y, snapped.y), maxY = Math.max(opposite.y, snapped.y);
  return {
    geometry: { ...geometry, points: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }] },
    params: { ...params, width: Number(Math.max(1, maxX - minX).toFixed(3)), length: Number(Math.max(1, maxY - minY).toFixed(3)) },
  };
}

/** Point-in-outline test used for picking the pool (circle, ellipse or polygon). */
export function pointInsideOutline(geometry, pt) {
  if (!geometry) return false;
  if (geometry.type === "circle") return Math.hypot(pt.x - geometry.center.x, pt.y - geometry.center.y) <= geometry.radius;
  if (geometry.type === "ellipse") {
    const dx = (pt.x - geometry.center.x) / geometry.rx;
    const dy = (pt.y - geometry.center.y) / geometry.ry;
    return (dx * dx + dy * dy) <= 1;
  }
  if (geometry.points?.length) {
    let inside = false;
    const pts = geometry.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      const intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 0.000001) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  return false;
}

/** Translate an outline by (dx, dy). */
export function translateGeometry(geometry, dx, dy) {
  if (!geometry) return geometry;
  if (geometry.type === "circle" || geometry.type === "ellipse") return { ...geometry, center: { x: geometry.center.x + dx, y: geometry.center.y + dy } };
  if (geometry.points?.length) return { ...geometry, points: geometry.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  return geometry;
}

/** Origin / size summary used by the "selected pool" properties. */
export function geometryMeta(geometry) {
  if (!geometry) return null;
  if (geometry.type === "circle") {
    return { kind: "circle", x: geometry.center.x, y: geometry.center.y, radius: geometry.radius, width: geometry.radius * 2, length: geometry.radius * 2 };
  }
  if (geometry.type === "ellipse") {
    return { kind: "ellipse", x: geometry.center.x, y: geometry.center.y, width: geometry.rx * 2, length: geometry.ry * 2 };
  }
  if (geometry.points?.length) {
    const xs = geometry.points.map((p) => p.x);
    const ys = geometry.points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return { kind: geometry.type || "polygon", x: minX, y: minY, width: maxX - minX, length: maxY - minY };
  }
  return null;
}

/** Typed edit of a pool property (x, y, radius, width, length, depth). Null when invalid. */
export function editGeometryProperty({ geometry, params }, key, rawValue) {
  const value = Number(rawValue);
  if (Number.isNaN(value) || !geometry) return null;
  const meta = geometryMeta(geometry);
  if (!meta) return null;
  const depth = (p) => ({ ...p, depth: Math.max(0.1, Math.min(20, value)) });
  if (geometry.type === "circle") {
    if (key === "x" || key === "y") return { geometry: { ...geometry, center: { ...geometry.center, [key]: value } }, params };
    if (key === "radius") {
      const r = Math.max(0.1, value);
      return { geometry: { ...geometry, radius: r }, params: { ...params, radius: Number(r.toFixed(3)) } };
    }
    if (key === "depth") return { geometry, params: depth(params) };
    return null;
  }
  if (geometry.type === "ellipse") {
    if (key === "x" || key === "y") return { geometry: { ...geometry, center: { ...geometry.center, [key]: value } }, params };
    if (key === "width") { const w = Math.max(0.1, value); return { geometry: { ...geometry, rx: w / 2 }, params: { ...params, width: Number(w.toFixed(3)) } }; }
    if (key === "length") { const l = Math.max(0.1, value); return { geometry: { ...geometry, ry: l / 2 }, params: { ...params, length: Number(l.toFixed(3)) } }; }
    if (key === "depth") return { geometry, params: depth(params) };
    return null;
  }
  if (!geometry.points?.length) return null;
  if (key === "depth") return { geometry, params: depth(params) };
  const oldW = Math.max(0.001, meta.width), oldL = Math.max(0.001, meta.length);
  let nextX = meta.x, nextY = meta.y, nextW = oldW, nextL = oldL;
  if (key === "x") nextX = value;
  if (key === "y") nextY = value;
  if (key === "width") nextW = Math.max(0.1, value);
  if (key === "length") nextL = Math.max(0.1, value);
  const scaled = geometry.points.map((p) => ({
    x: nextX + ((p.x - meta.x) / oldW) * nextW,
    y: nextY + ((p.y - meta.y) / oldL) * nextL,
  }));
  return { geometry: { ...geometry, points: scaled }, params: { ...params, width: Number(nextW.toFixed(3)), length: Number(nextL.toFixed(3)) } };
}
