/** Lightweight site context for the fountain preview. All repeated forms are instanced. */
import { basinOpenings } from './basinGeometry';

const noise = (n, salt = 0) => {
  const v = Math.sin(n * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

export function venueLayout({ poolType = "circular", radius = 6, width = 12, length = 8 } = {}) {
  const finite = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0
    ? Number(value) : fallback;
  const half = poolType === "circular" ? finite(radius, 6)
    : Math.hypot(finite(width, 12), finite(length, 8)) / 2;
  const stage = Math.max(11.8, half + 2.2);
  return { stage, audience: stage + 5.2, landscape: stage + 10.5,
    buildings: Math.max(44, stage + 30) };
}

export function buildVenue(T, { quality = "medium", environment = "night", ...pool } = {}) {
  const group = new T.Group();
  group.name = "Preview venue";
  const layout = venueLayout(pool);
  const day = environment === "day";
  const dusk = environment === "dusk";
  const low = quality === "low" || quality === "eco";   // eco (AF-NEXT-013) is lighter still
  const dummy = new T.Object3D();
  const color = new T.Color();
  // The fountain owns the scene lighting. Keep distant context legible at night
  // without placing bright lamps that would wash out the colored water.
  const material = (hex, roughness = 0.82, emissive = 0x000000) => day || dusk
    ? new T.MeshStandardMaterial({ color: hex, roughness, metalness: 0.03, emissive })
    : new T.MeshBasicMaterial({ color: hex });
  const instance = (geometry, mat, count, name) => {
    const mesh = new T.InstancedMesh(geometry, mat, count);
    mesh.name = name;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };
  const place = (mesh, index, x, y, z, sx = 1, sy = 1, sz = 1, rotation = 0, tint = null) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotation, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    if (tint !== null) mesh.setColorAt(index, color.set(tint));
  };

  // A dry, slightly raised promenade keeps the crowd off the wet basin edge.
  const promenadeShape = new T.Shape();
  promenadeShape.absarc(0, 0, layout.stage, 0, Math.PI * 2, false);
  promenadeShape.holes.push(...basinOpenings(T, pool));   // every basin (AF-NEXT-010)
  const promenade = new T.Mesh(
    new T.ShapeGeometry(promenadeShape, 96),
    material(day ? 0x777a72 : 0x252b31, 0.88),
  );
  promenade.rotation.x = -Math.PI / 2;
  promenade.position.y = -0.06;
  promenade.receiveShadow = true;
  group.add(promenade);
  const edge = new T.Mesh(
    new T.TorusGeometry(layout.stage + 0.45, 0.05, 6, 96),
    material(day ? 0xa6a9a0 : 0x485665, 0.45),
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.y = -0.045;
  group.add(edge);

  // Grass is confined to the outer verge; it never covers engineering fixtures.
  const grassBase = new T.Mesh(new T.RingGeometry(layout.stage + 0.85, layout.landscape + 3.0, 96),
    material(day ? 0x496b3f : dusk ? 0x233e32 : 0x1b302e, 1));
  grassBase.rotation.x = -Math.PI / 2;
  grassBase.position.y = -0.012;
  group.add(grassBase);
  const bladeCount = low ? 380 : 1400;
  const blades = instance(new T.ConeGeometry(0.045, 0.25, 3),
    material(0xffffff, 1), bladeCount, "Grass tufts");
  const grasses = day ? [0x55783f, 0x698c4b, 0x3e683d] : [0x25483b, 0x315a48, 0x1d3937];
  for (let i = 0; i < bladeCount; i++) {
    const a = noise(i, 1) * Math.PI * 2;
    const r = layout.stage + 1.1 + noise(i, 2) * (layout.landscape - layout.stage + 1.5);
    const h = 0.65 + noise(i, 3) * 0.9;
    place(blades, i, Math.cos(a) * r, 0.08 * h, Math.sin(a) * r,
      0.7 + noise(i, 4), h, 0.7 + noise(i, 5), a, grasses[i % grasses.length]);
  }

  // People, trees and buildings are real GLB assets in ModelLayer. Keeping them in
  // the scene graph makes every instance selectable, movable and replaceable.
  return group;
}

export function disposeVenue(group) {
  if (!group) return;
  group.parent?.remove(group);
  const geometries = new Set(), materials = new Set();
  group.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    if (Array.isArray(object.material)) object.material.forEach(m => materials.add(m));
    else if (object.material) materials.add(object.material);
  });
  geometries.forEach(g => g.dispose());
  materials.forEach(m => m.dispose());
}
