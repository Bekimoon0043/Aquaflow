export const LAND_SURFACE_TYPES = [
  { key: "grass", label: "Grass", color: "#4f8a3c", roughness: 0.96 },
  { key: "paving", label: "Paving", color: "#999287", roughness: 0.82 },
  { key: "soil", label: "Planting Soil", color: "#775137", roughness: 1 },
  { key: "rock", label: "Rock / Gravel", color: "#6f747b", roughness: 0.9 },
  { key: "sand", label: "Sand", color: "#c4ad78", roughness: 1 },
];

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function normalizeSiteSurface(surface = {}, index = 0) {
  const type = LAND_SURFACE_TYPES.some((entry) => entry.key === surface.type)
    ? surface.type
    : "grass";
  const preset = LAND_SURFACE_TYPES.find((entry) => entry.key === type);
  const points = Array.isArray(surface.points)
    ? surface.points
      .map((point) => ({ x: finite(point?.x), y: finite(point?.y ?? point?.z) }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
  return {
    id: surface.id || `surface-${index + 1}`,
    label: surface.label || `${preset.label} Area ${index + 1}`,
    type,
    color: surface.color || preset.color,
    elevation: finite(surface.elevation, 0.02),
    visible: surface.visible !== false,
    points,
  };
}

export function normalizeSiteSurfaces(surfaces) {
  return Array.isArray(surfaces)
    ? surfaces.map(normalizeSiteSurface).filter((surface) => surface.points.length >= 3)
    : [];
}

export function surfaceMetrics(points = []) {
  if (!Array.isArray(points) || points.length < 3) return { area: 0, perimeter: 0 };
  let signedArea = 0;
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    signedArea += current.x * next.y - next.x * current.y;
    perimeter += Math.hypot(next.x - current.x, next.y - current.y);
  }
  return { area: Math.abs(signedArea) / 2, perimeter };
}

export function pointInSurface(point, surface) {
  const points = surface?.points || [];
  if (points.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const a = points[index];
    const b = points[previous];
    const intersects = ((a.y > point.y) !== (b.y > point.y))
      && (point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

export function moveSurface(surface, dx, dy) {
  return {
    ...surface,
    points: (surface?.points || []).map((point) => ({ x: point.x + dx, y: point.y + dy })),
  };
}

export function updateSurfaceVertex(surface, index, point) {
  return {
    ...surface,
    points: (surface?.points || []).map((current, vertexIndex) => (
      vertexIndex === index ? { x: point.x, y: point.y } : current
    )),
  };
}

export function dedupeSurfacePoints(points = [], tolerance = 0.0001) {
  const result = [];
  points.forEach((point) => {
    const previous = result[result.length - 1];
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > tolerance) {
      result.push({ x: point.x, y: point.y });
    }
  });
  if (result.length > 2) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= tolerance) result.pop();
  }
  return result;
}

export function toPreviewSiteSurfaces(surfaces = [], center = { cx: 0, cy: 0 }) {
  return normalizeSiteSurfaces(surfaces).map((surface) => ({
    ...surface,
    points: surface.points.map((point) => ({
      x: point.x - finite(center?.cx),
      z: point.y - finite(center?.cy),
    })),
  }));
}
