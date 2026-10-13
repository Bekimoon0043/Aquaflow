/**
 * drafting/viewport.js — AF-CAD-030 plan viewport maths for the 2D designer.
 * view = { pan: {x, y} (px), zoom (px per metre) }. Plan y runs down the screen.
 */
export const DEFAULT_VIEW = Object.freeze({ zoom: 30, pan: Object.freeze({ x: 60, y: 60 }) });
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 140;

export const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Canvas-local pixel → plan metres. */
export const screenToWorld = (cx, cy, { pan, zoom }) => ({ x: (cx - pan.x) / zoom, y: (cy - pan.y) / zoom });

/** Plan metres → canvas-local pixel. */
export const worldToScreen = (p, { pan, zoom }) => ({ x: pan.x + p.x * zoom, y: pan.y + p.y * zoom });

/** Metres per screen pixel (the snap aperture conversion). */
export const worldPerPixel = ({ zoom }) => 1 / (Number(zoom) || 1);

/** Wheel zoom about the cursor: the world point under the cursor stays put. */
export function zoomAbout({ pan, zoom }, cx, cy, deltaY) {
  const before = screenToWorld(cx, cy, { pan, zoom });
  const nextZoom = clampZoom(zoom * (deltaY < 0 ? 1.15 : 0.87));
  return { zoom: nextZoom, pan: { x: cx - before.x * nextZoom, y: cy - before.y * nextZoom } };
}

/** Plan bounds of the pool geometry plus land surfaces (null when empty). */
export function designBounds(geometry, siteSurfaces = []) {
  const points = (siteSurfaces || []).flatMap((surface) => surface.points || []);
  if (geometry?.type === "circle") {
    points.push(
      { x: geometry.center.x - geometry.radius, y: geometry.center.y - geometry.radius },
      { x: geometry.center.x + geometry.radius, y: geometry.center.y + geometry.radius },
    );
  } else if (geometry?.type === "ellipse") {
    points.push(
      { x: geometry.center.x - geometry.rx, y: geometry.center.y - geometry.ry },
      { x: geometry.center.x + geometry.rx, y: geometry.center.y + geometry.ry },
    );
  } else if (geometry?.points?.length) {
    points.push(...geometry.points);
  }
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** View that fits `bounds` into a width×height canvas with `padding` px (null bounds → default). */
export function fitViewTo(bounds, width, height, padding = 80) {
  if (!bounds) return { zoom: DEFAULT_VIEW.zoom, pan: { ...DEFAULT_VIEW.pan } };
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const zoom = clampZoom(Math.min((width - padding * 2) / bw, (height - padding * 2) / bh));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { zoom, pan: { x: width / 2 - cx * zoom, y: height / 2 - cy * zoom } };
}
