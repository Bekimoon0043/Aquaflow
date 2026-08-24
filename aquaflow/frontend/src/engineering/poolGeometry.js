import { poolCenter } from "./geometryContract.js";

const EPS = 1e-9;

export const BUILT_IN_POOL_TYPES = new Set([
  "rectangular", "circular", "elliptical", "lshape", "false_lake", "false_river",
]);

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizePoolParams(params = {}) {
  return {
    ...params,
    width: Math.max(0.1, finite(params.width, 12)),
    length: Math.max(0.1, finite(params.length, 8)),
    radius: Math.max(0.1, finite(params.radius, 6)),
    depth: Math.max(0.05, finite(params.depth, 0.8)),
  };
}

function centered(points, center) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return points.map((p) => ({ x: p.x - cx + center.x, y: p.y - cy + center.y }));
}

export function geometryForPoolType(type, rawParams = {}, center = null) {
  const params = normalizePoolParams(rawParams);
  const { width, length, radius } = params;
  const c = center || (type === "circular" || type === "elliptical"
    ? { x: 0, y: 0 }
    : { x: width / 2, y: length / 2 });

  if (type === "circular") {
    return { type: "circle", center: { ...c }, radius };
  }
  if (type === "elliptical") {
    return { type: "ellipse", center: { ...c }, rx: width / 2, ry: length / 2 };
  }

  let points;
  if (type === "lshape") {
    points = [
      { x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: length / 2 },
      { x: width / 2, y: length / 2 }, { x: width / 2, y: length }, { x: 0, y: length },
    ];
  } else if (type === "false_lake") {
    points = Array.from({ length: 32 }, (_, i) => {
      const t = (i / 32) * Math.PI * 2;
      const jitter = 0.84 + Math.sin(t * 3.7) * 0.12 + Math.cos(t * 2.1) * 0.08;
      return { x: Math.cos(t) * radius * jitter * 1.5, y: Math.sin(t) * radius * jitter };
    });
  } else if (type === "false_river") {
    const steps = 32;
    const half = width / 2;
    const left = Array.from({ length: steps + 1 }, (_, i) => {
      const t = i / steps;
      return { x: Math.sin(t * Math.PI * 3) * width * 0.28 - half / 2, y: t * length };
    });
    const right = Array.from({ length: steps + 1 }, (_, n) => {
      const i = steps - n;
      const t = i / steps;
      return { x: Math.sin(t * Math.PI * 3) * width * 0.28 + half / 2, y: t * length };
    });
    points = [...left, ...right];
  } else {
    points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: length }, { x: 0, y: length }];
  }
  return { type: type === "rectangular" ? "rectangle" : type, points: centered(points, c), closed: true };
}

export function synchronizePoolGeometry({ geometry, previousType, poolType, params }) {
  const normalized = normalizePoolParams(params);
  if (!geometry) return geometryForPoolType(poolType, normalized);
  // Entering freeform means "keep this outline and let me edit it". Replacing it
  // with a rectangle here made the pool-type control destructive and surprising.
  if (poolType === "freeform") return { ...geometry, closed: true };

  const center = poolCenter(geometry, normalized, previousType);
  return geometryForPoolType(poolType, normalized, { x: center.cx, y: center.cy });
}

export function polygonArea(points = []) {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(points = [], closed = true) {
  if (points.length < 2) return 0;
  const count = closed ? points.length : points.length - 1;
  let total = 0;
  for (let i = 0; i < count; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    total += Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
  }
  return total;
}

export function geometryMetrics(geometry, rawParams = {}, depthZones = []) {
  const params = normalizePoolParams(rawParams);
  let area = 0;
  let perimeter = 0;
  if (geometry?.type === "circle") {
    area = Math.PI * geometry.radius ** 2;
    perimeter = 2 * Math.PI * geometry.radius;
  } else if (geometry?.type === "ellipse") {
    const a = Number(geometry.rx) || params.width / 2;
    const b = Number(geometry.ry) || params.length / 2;
    area = Math.PI * a * b;
    // Ramanujan II; accurate enough for engineering summaries.
    const h = ((a - b) ** 2) / ((a + b) ** 2 || 1);
    perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  } else if (geometry?.points?.length) {
    area = polygonArea(geometry.points);
    perimeter = polygonPerimeter(geometry.points, geometry.closed !== false);
  }

  const drawnZones = (depthZones || []).filter((zone) => zone.points?.length >= 3);
  const zoneArea = drawnZones.reduce((sum, zone) => sum + polygonArea(zone.points), 0);
  const zoneVolume = drawnZones.reduce((sum, zone) => sum + polygonArea(zone.points) * finite(zone.depth, params.depth), 0);
  const uncoveredArea = Math.max(0, area - Math.min(area, zoneArea));
  const volume = zoneVolume + uncoveredArea * params.depth;
  return { area, perimeter, volume, capacityLitres: volume * 1000, zonedArea: Math.min(area, zoneArea) };
}

export function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === "circle") {
    return Math.hypot(point.x - geometry.center.x, point.y - geometry.center.y) <= geometry.radius + EPS;
  }
  if (geometry.type === "ellipse") {
    const dx = (point.x - geometry.center.x) / geometry.rx;
    const dy = (point.y - geometry.center.y) / geometry.ry;
    return dx * dx + dy * dy <= 1 + EPS;
  }
  const points = geometry.points || [];
  // Treat the pool outline as inside. This is important for depth zones and
  // fixtures intentionally snapped to walls/edges.
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
    if (Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= EPS) return true;
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]; const b = points[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || EPS) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function orientation(a, b, c) {
  return Math.sign((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y));
}

function segmentsIntersect(a, b, c, d) {
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
}

function pointInPolygonStrict(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]; const b = points[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || EPS) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function depthZonesOverlap(a = [], b = []) {
  if (a.length < 3 || b.length < 3) return false;
  if (a.some((point) => pointInPolygonStrict(point, b))) return true;
  if (b.some((point) => pointInPolygonStrict(point, a))) return true;
  return a.some((point, i) => b.some((other, j) => segmentsIntersect(
    point, a[(i + 1) % a.length], other, b[(j + 1) % b.length]
  )));
}

export function validateDepthZone(points = [], geometry, existingZones = []) {
  const errors = [];
  if (points.length < 3) errors.push("A depth zone needs at least three points.");
  if (points.some((point) => !pointInGeometry(point, geometry))) errors.push("Every depth-zone point must be inside the pool.");
  // Checking vertices alone is insufficient for concave pools: an edge can leave
  // the water and re-enter it. Sample each edge so invalid zones are rejected.
  const edgeLeavesPool = points.some((point, index) => {
    const next = points[(index + 1) % points.length];
    return [0.25, 0.5, 0.75].some((t) => !pointInGeometry({
      x: point.x + (next.x - point.x) * t,
      y: point.y + (next.y - point.y) * t,
    }, geometry));
  });
  if (points.length >= 3 && edgeLeavesPool) errors.push("Every depth-zone edge must remain inside the pool.");
  if (existingZones.some((zone) => depthZonesOverlap(points, zone.points || []))) {
    errors.push("Depth zones cannot overlap.");
  }
  if (polygonArea(points) < 0.01) errors.push("The depth zone area is too small.");
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      if (segmentsIntersect(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) {
        errors.push("Depth-zone edges cannot cross.");
        return { valid: false, errors };
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
