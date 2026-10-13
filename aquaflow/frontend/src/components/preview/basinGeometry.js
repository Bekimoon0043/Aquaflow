const finitePoint = point => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y));

/** Convert an engineering polygon into the world-centred plan used by the 3D scene. */
export function centeredPoolPoints(points = []) {
  const valid = points.filter(finitePoint).map(point => ({ x: Number(point.x), y: Number(point.y) }));
  if (valid.length < 3) return [];
  const xs = valid.map(point => point.x), ys = valid.map(point => point.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return valid.map(point => ({ x: point.x - cx, y: point.y - cy }));
}

export function poolPolygonBounds(points = []) {
  if (points.length < 3) return null;
  const xs = points.map(point => point.x), ys = points.map(point => point.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    length: Math.max(...ys) - Math.min(...ys),
  };
}

export function poolPerimeterSegments(points = []) {
  if (points.length < 3) return [];
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next.x - point.x, dz = next.y - point.y;
    return {
      x: (point.x + next.x) / 2,
      z: (point.y + next.y) / 2,
      length: Math.hypot(dx, dz),
      rotation: Math.atan2(dz, dx),
    };
  }).filter(segment => segment.length > 0.001);
}

/**
 * AF-CAD-014: islands (geometry.holes) shifted by the SAME bounding-box centre as the
 * outer outline from centeredPoolPoints(), so holes and the basin share one 3D frame.
 */
export function centeredPoolHoles(outerPoints = [], holes = []) {
  const valid = outerPoints.filter(finitePoint).map(point => ({ x: Number(point.x), y: Number(point.y) }));
  if (valid.length < 3 || !Array.isArray(holes)) return [];
  const xs = valid.map(point => point.x), ys = valid.map(point => point.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return holes
    .map(hole => (Array.isArray(hole) ? hole : hole?.points || []).filter(finitePoint)
      .map(point => ({ x: Number(point.x) - cx, y: Number(point.y) - cy })))
    .filter(hole => hole.length >= 3);
}

// Flat meshes use rotation.x = -PI/2 (local y → world -z); walls and fixtures put plan y at world +z.
const toShapePlane = points => points.map(point => ({ x: point.x, y: -point.y }));

/** Basin floor/surface shape. `holes` (optional, already centred) cut islands out of it. */
export function poolShapeGeometry(T, planPoints = [], holes = []) {
  if (planPoints.length < 3) return null;
  const points = toShapePlane(planPoints);
  const shape = new T.Shape();
  shape.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach(point => shape.lineTo(point.x, point.y));
  shape.closePath();
  (holes || []).filter(hole => hole?.length >= 3).forEach(hole => {
    const outline = toShapePlane(hole);
    const path = new T.Path();
    path.moveTo(outline[0].x, outline[0].y);
    outline.slice(1).forEach(point => path.lineTo(point.x, point.y));
    path.closePath();
    shape.holes.push(path);
  });
  return new T.ShapeGeometry(shape, 24);
}

const pointInPolygon = (x, y, points) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i], b = points[j];
    if (((a.y > y) !== (b.y > y)) && (x < ((b.x - a.x) * (y - a.y)) / ((b.y - a.y) || 1e-9) + a.x)) {
      inside = !inside;
    }
  }
  return inside;
};

/** Tessellated freeform water plane. Cells are clipped to the supplied basin polygon. */
export function polygonWaterGeometry(T, planPoints = [], resolution = 96) {
  const points = toShapePlane(planPoints);
  const bounds = poolPolygonBounds(points);
  if (!bounds || bounds.width <= 0 || bounds.length <= 0) return null;
  const nx = Math.max(12, Math.round(resolution * bounds.width / Math.max(bounds.width, bounds.length)));
  const ny = Math.max(12, Math.round(resolution * bounds.length / Math.max(bounds.width, bounds.length)));
  const positions = [], uvs = [], indices = [];
  for (let iy = 0; iy <= ny; iy += 1) {
    const y = bounds.minY + bounds.length * iy / ny;
    for (let ix = 0; ix <= nx; ix += 1) {
      const x = bounds.minX + bounds.width * ix / nx;
      positions.push(x, y, 0);
      uvs.push(ix / nx, iy / ny);
    }
  }
  const row = nx + 1;
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const x = bounds.minX + bounds.width * (ix + 0.5) / nx;
      const y = bounds.minY + bounds.length * (iy + 0.5) / ny;
      if (!pointInPolygon(x, y, points)) continue;
      const a = iy * row + ix, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, b, d, a, d, c);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A real opening in the paving: no opaque surface underneath animated water. */
export function basinOpening(T, { poolType = 'circular', radius = 6, width = 12, length = 8, points = [] } = {}) {
  const hole = new T.Path();
  if (poolType === 'circular') hole.absarc(0, 0, radius, 0, Math.PI * 2, true);
  else if (poolType === 'freeform' && points.length >= 3) {
    const outline = toShapePlane(points);
    hole.moveTo(outline[0].x, outline[0].y);
    outline.slice(1).forEach(point => hole.lineTo(point.x, point.y));
    hole.closePath();
  }
  else {
    hole.moveTo(-width / 2, -length / 2);
    hole.lineTo(-width / 2, length / 2);
    hole.lineTo(width / 2, length / 2);
    hole.lineTo(width / 2, -length / 2);
    hole.closePath();
  }
  return hole;
}

export function deckWithOpening(T, pool, extent = 80) {
  const s = extent / 2, shape = new T.Shape();
  shape.moveTo(-s, -s); shape.lineTo(s, -s); shape.lineTo(s, s); shape.lineTo(-s, s); shape.closePath();
  shape.holes.push(basinOpening(T, pool));
  const geometry = new T.ShapeGeometry(shape, 96);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / extent + 0.5, uv.getY(i) / extent + 0.5);
  return geometry;
}
