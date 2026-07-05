/**
 * sceneGraph.js — AQ-X-016 AquaFlow 3D Export Bridge
 *
 * Builds a serializer-agnostic intermediate representation (IR) of the AquaFlow
 * 3D preview scene from the engineering design (pool geometry + fixtures). Every
 * serializer (glTF/GLB, OBJ/MTL, USD, FBX, LUXEXCHANGE) consumes this same IR so
 * fixture positions and basic materials stay identical across formats.
 *
 * It reuses the app's canonical transforms (fixtureTypeMap.js) — the exact same
 * functions the live 3D preview uses — so an export always matches what the user
 * sees on screen.
 *
 * IR shape:
 *   {
 *     meta:  { name, generator, generatedAt, upAxis:"Y", unit:"meter", ... },
 *     nodes: [ {
 *       name, kind, translation:[x,y,z],
 *       mesh: { positions:number[], normals:number[], indices:number[] } | null,
 *       material: { name, baseColor:[r,g,b,a], metallic, roughness, emissive:[r,g,b] },
 *       light: { type:"point"|"spot", color:[r,g,b], intensity } | null,
 *       fixtureId, fixtureType,
 *     } ],
 *   }
 *
 * Colors in the IR are sRGB 0..1 (what the designer sees). Serializers that
 * require linear color (glTF, USD) convert via srgbToLinear().
 */

import {
  fixturesToNozzleConfigs,
  geometryToPoolConfig,
  classifyFixtureType,
  resolveFixtureType,
  fixturePlanCoords,
} from "../hooks/fixtureTypeMap.js";
import { box, cylinder, cone, disc, plane, prism, sphere } from "./primitives.js";

export const EXPORT_GENERATOR = "AquaFlow Studio · AQ-X-016 3D Export Bridge";

// ── color helpers ────────────────────────────────────────────────────────────

/** "#rrggbb" (or "#rgb") → [r,g,b] in sRGB 0..1. Falls back to mid-grey. */
export function hexToRgb(hex) {
  const s = String(hex || "").trim().replace(/^#/, "");
  let r = 128, g = 128, b = 128;
  if (/^[0-9a-f]{6}$/i.test(s)) {
    r = parseInt(s.slice(0, 2), 16);
    g = parseInt(s.slice(2, 4), 16);
    b = parseInt(s.slice(4, 6), 16);
  } else if (/^[0-9a-f]{3}$/i.test(s)) {
    r = parseInt(s[0] + s[0], 16);
    g = parseInt(s[1] + s[1], 16);
    b = parseInt(s[2] + s[2], 16);
  }
  return [r / 255, g / 255, b / 255];
}

/** sRGB channel 0..1 → linear 0..1 (glTF/USD baseColor is linear). */
export function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// ── material palette ─────────────────────────────────────────────────────────

const MATERIALS = {
  basin:     { name: "PoolBasin",    baseColor: [0.62, 0.60, 0.55, 1], metallic: 0.05, roughness: 0.85, emissive: [0, 0, 0] },
  water:     { name: "WaterSurface", baseColor: [0.18, 0.46, 0.72, 0.62], metallic: 0.0, roughness: 0.06, emissive: [0, 0, 0] },
  nozzle:    { name: "NozzleSteel",  baseColor: [0.72, 0.74, 0.77, 1], metallic: 0.9, roughness: 0.28, emissive: [0, 0, 0] },
  equipment: { name: "Equipment",    baseColor: [0.28, 0.31, 0.34, 1], metallic: 0.8, roughness: 0.42, emissive: [0, 0, 0] },
};

function nozzleMaterial(colorHex) {
  const [r, g, b] = hexToRgb(colorHex || "#88ccff");
  // Slightly tinted stainless so nozzle families stay distinguishable.
  return {
    name: "Nozzle_" + rgbSlug(r, g, b),
    baseColor: [0.55 + r * 0.25, 0.6 + g * 0.2, 0.68 + b * 0.2, 1].map((v) => Math.min(1, v)),
    metallic: 0.85,
    roughness: 0.3,
    emissive: [0, 0, 0],
  };
}

function lightMaterial(colorHex) {
  const [r, g, b] = hexToRgb(colorHex || "#ffffff");
  return { name: "Light_" + rgbSlug(r, g, b), baseColor: [r, g, b, 1], metallic: 0, roughness: 0.4, emissive: [r, g, b] };
}

function effectMaterial(colorHex) {
  const [r, g, b] = hexToRgb(colorHex || "#ff6622");
  return { name: "Effect_" + rgbSlug(r, g, b), baseColor: [r, g, b, 1], metallic: 0, roughness: 0.5, emissive: [r * 0.9, g * 0.6, b * 0.4] };
}

function rgbSlug(r, g, b) {
  const h = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return h(r) + h(g) + h(b);
}

// ── name sanitising (shared safe identifier for USD/FBX prim names) ───────────

let _nameCounter = 0;
function sanitizeName(raw, fallback) {
  let s = String(raw || fallback || "node").replace(/[^A-Za-z0-9_]/g, "_");
  if (!s || /^[0-9]/.test(s)) s = "n_" + s;
  return s;
}

// ── pool ─────────────────────────────────────────────────────────────────────

function buildPoolNodes(poolConfig, center) {
  const nodes = [];
  if (!poolConfig) return nodes;
  const params = poolConfig.params || {};
  const type = String(poolConfig.poolType || "rectangular").toLowerCase();
  const depth = Math.max(0.1, Number(params.depth) || 0.8);
  const [cx, , cz] = center;
  const footprint = poolConfig.geometry && Array.isArray(poolConfig.geometry.points)
    ? poolConfig.geometry.points
    : null;

  let basinMesh, waterMesh;
  if (footprint && footprint.length >= 3) {
    // Freeform / L-shape / lake: extrude the real plan outline.
    basinMesh = prism(footprint, depth);
    waterMesh = prism(footprint, depth * 0.98);
  } else if (type.includes("circ") || type.includes("ellip") || type.includes("lake")) {
    const radius = Math.max(0.5, Number(params.radius) || (Number(params.width) || 10) / 2);
    basinMesh = cylinder(radius, radius, depth, 48);
    waterMesh = disc(radius * 0.98, 48);
  } else {
    const w = Math.max(0.5, Number(params.width) || 10);
    const l = Math.max(0.5, Number(params.length) || 10);
    basinMesh = box(w, depth, l);
    waterMesh = plane(w * 0.98, l * 0.98);
  }

  const isBoxBasin = !footprint && !(type.includes("circ") || type.includes("ellip") || type.includes("lake"));
  nodes.push({
    name: "PoolBasin",
    kind: "pool",
    // Box basin is centred on its own origin, so drop it by depth/2; cylinder/prism
    // bases already sit at y=0, so drop them by depth.
    translation: [cx, isBoxBasin ? -depth / 2 : -depth, cz],
    mesh: basinMesh,
    material: MATERIALS.basin,
    light: null,
    fixtureId: null,
    fixtureType: "pool",
  });
  nodes.push({
    name: "WaterSurface",
    kind: "water",
    translation: [cx, 0, cz],
    mesh: waterMesh,
    material: MATERIALS.water,
    light: null,
    fixtureId: null,
    fixtureType: "water",
  });
  return nodes;
}

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Small upward-pointing marker glyphs, sized so exports stay lightweight. */
function nozzleGlyph(scale = 1) {
  return cone(0.09 * scale, 0.28 * scale, 12);
}
function lightGlyph() {
  return sphere(0.11, 12, 8);
}
function equipmentGlyph() {
  return cylinder(0.18, 0.18, 0.32, 14);
}

/**
 * Build fixture nodes from the engineering fixture list. Each fixture is
 * classified by its ORIGINAL type (classifyFixtureType) — not the resolved 3D
 * nozzle type, which is lossy for equipment — and positioned via the canonical
 * fixturePlanCoords() transform (plan x → world x, plan y → world z), so exported
 * coordinates match the live preview exactly.
 */
function buildFixtureNodes(fixtures) {
  const nodes = [];

  (fixtures || []).forEach((f, i) => {
    const category = classifyFixtureType(f.type);
    const map = resolveFixtureType(f.type);
    const { x, z } = fixturePlanCoords(f);
    const id = f.id ?? null;
    const color = f.color || f.params?.color || map.color;

    if (category === "light") {
      const [r, g, b] = hexToRgb(color || "#ffffff");
      const intensity = f.engineering?.wattage ? f.engineering.wattage / 18.0 : (map.intensity || 4);
      nodes.push({
        name: sanitizeName(f.label || id, "Light_" + i),
        kind: "light",
        translation: [x, 0.05, z],
        mesh: lightGlyph(),
        material: lightMaterial(color),
        light: { type: map.lightType === "spot" ? "spot" : "point", color: [r, g, b], intensity },
        fixtureId: id,
        fixtureType: f.type,
      });
    } else if (category === "equipment") {
      nodes.push({
        name: sanitizeName(f.label || id, "Equipment_" + i),
        kind: "equipment",
        translation: [x, 0.16, z],
        mesh: equipmentGlyph(),
        material: MATERIALS.equipment,
        light: null,
        fixtureId: id,
        fixtureType: f.type,
      });
    } else if (category === "effect") {
      nodes.push({
        name: sanitizeName(f.label || id, "Effect_" + i),
        kind: "effect",
        translation: [x, 0, z],
        mesh: nozzleGlyph(map.heightMult || 1),
        material: effectMaterial(color),
        light: null,
        fixtureId: id,
        fixtureType: f.type,
      });
    } else {
      nodes.push({
        name: sanitizeName(f.label || id, "Nozzle_" + i),
        kind: "nozzle",
        translation: [x, 0, z],
        mesh: nozzleGlyph(map.heightMult || 1),
        material: nozzleMaterial(color),
        light: null,
        fixtureId: id,
        fixtureType: f.type,
      });
    }
  });

  return nodes;
}

// ── centroid ─────────────────────────────────────────────────────────────────

function fixtureCentroid(fixtures) {
  const { nozzleConfigs, lightConfigs } = fixturesToNozzleConfigs(fixtures || []);
  const all = [...nozzleConfigs, ...lightConfigs];
  if (!all.length) return [0, 0, 0];
  let sx = 0, sz = 0;
  all.forEach((f) => { sx += Number(f.x) || 0; sz += Number(f.z) || 0; });
  return [sx / all.length, 0, sz / all.length];
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * buildSceneGraph(design, options) → IR
 *
 * @param {object} design
 *   - fixtures:      engineering fixture array (from showStore.engineeringFixtures
 *                    or engineeringStore.fixtures)
 *   - poolGeometry:  { poolType, params, geometry } OR the raw engineering
 *                    { geometry, params, poolType } — both are accepted.
 *   - name:          scene / show name
 * @param {object} options - { includePool?:boolean (default true) }
 */
export function buildSceneGraph(design = {}, options = {}) {
  const includePool = options.includePool !== false;
  const fixtures = Array.isArray(design.fixtures) ? design.fixtures : [];

  // Accept either an already-built poolConfig or the raw engineering triple.
  let poolConfig = null;
  const pg = design.poolGeometry || null;
  if (pg && (pg.params || pg.geometry || pg.poolType)) {
    poolConfig = pg.params && pg.poolType && "geometry" in pg
      ? pg
      : geometryToPoolConfig(pg.geometry, pg.params, pg.poolType);
  }

  const nodes = [];
  if (includePool && poolConfig) {
    nodes.push(...buildPoolNodes(poolConfig, fixtureCentroid(fixtures)));
  }
  nodes.push(...buildFixtureNodes(fixtures));

  // Guarantee unique node names (USD/FBX prim paths must be unique among siblings).
  const seen = new Map();
  nodes.forEach((n) => {
    const c = seen.get(n.name) || 0;
    seen.set(n.name, c + 1);
    if (c > 0) n.name = `${n.name}_${c}`;
  });

  _nameCounter = 0;
  return {
    meta: {
      name: String(design.name || "AquaFlow Scene"),
      generator: EXPORT_GENERATOR,
      generatedAt: new Date().toISOString(),
      upAxis: "Y",
      unit: "meter",
      nodeCount: nodes.length,
      fixtureCount: fixtures.length,
      lightCount: nodes.filter((n) => n.light).length,
    },
    nodes,
  };
}

/** Count triangles across every mesh node (for UI stats + tests). */
export function sceneTriangleCount(graph) {
  return (graph.nodes || []).reduce(
    (sum, n) => sum + (n.mesh ? n.mesh.indices.length / 3 : 0), 0);
}
