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
 *       name, kind, translation:[x,y,z], rotationY:degrees, scale:[x,y,z],
 *       mesh: { positions:number[], normals:number[], indices:number[] } | null,
 *       material: { name, baseColor:[r,g,b,a], metallic, roughness, emissive:[r,g,b] },
 *       light: { type:"point"|"spot", color:[r,g,b], intensity } | null,
 *       fixtureId, fixtureType,
 *       extras: { fixtureId, fixtureType, category, label, groupId, dmx, protocol,
 *                 engineering:{flowLpm,pressureBar,powerKw}, sourceModule } | null,
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
  resolveFixtureGroup,
} from "../hooks/fixtureTypeMap.js";
import { cylinder, cone, sphere, planCap, planSlab, poolShell, circleOutline, rectOutline } from "./primitives.js";

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

/** Coerce to a finite number; NaN/Infinity/garbage → fallback. Guards exports
 *  against a stray coordinate blowing up a whole file (borrowed from the backend). */
export function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// ── material palette ─────────────────────────────────────────────────────────

const MATERIALS = {
  basin:     { name: "PoolBasin",    baseColor: [0.62, 0.60, 0.55, 1], metallic: 0.05, roughness: 0.85, emissive: [0, 0, 0] },
  water:     { name: "WaterSurface", baseColor: [0.18, 0.46, 0.72, 0.62], metallic: 0.0, roughness: 0.06, emissive: [0, 0, 0] },
  nozzle:    { name: "NozzleSteel",  baseColor: [0.72, 0.74, 0.77, 1], metallic: 0.9, roughness: 0.28, emissive: [0, 0, 0] },
  equipment: { name: "Equipment",    baseColor: [0.28, 0.31, 0.34, 1], metallic: 0.8, roughness: 0.42, emissive: [0, 0, 0] },
  jet:       { name: "WaterJet",     baseColor: [0.80, 0.90, 1.00, 0.45], metallic: 0.0, roughness: 0.05, emissive: [0, 0, 0] },
};

function surfaceMaterial(s) {
  const [r, g, b] = hexToRgb(s.color || "#9a958c");
  const kind = String(s.type || "surface").toLowerCase();
  return { name: "Site_" + sanitizeName(kind, "surface") + "_" + rgbSlug(r, g, b), baseColor: [r, g, b, 1], metallic: 0,
    roughness: kind.includes("water") ? 0.1 : 0.9, emissive: [0, 0, 0] };
}

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

/**
 * Pool as an open shell (floor + walls) with the water surface just below the rim.
 * Every shape is built from its plan outline in absolute plan coordinates, so the pool
 * lines up with the fixtures exactly as in the designer and the 3D preview.
 */
function buildPoolNodes(poolConfig, center) {
  const nodes = [];
  if (!poolConfig) return nodes;
  const params = poolConfig.params || {};
  const type = String(poolConfig.poolType || "rectangular").toLowerCase();
  const depth = Math.max(0.1, Number(params.depth) || 0.8);
  const [cx, , cz] = center;
  const g = poolConfig.geometry || null;
  let outline = g && Array.isArray(g.points) && g.points.length >= 3 ? g.points : null;
  if (!outline && g?.type === "circle" && g.center) outline = circleOutline(safeNum(g.center.x), safeNum(g.center.y), Math.max(0.5, safeNum(g.radius, 5)));
  if (!outline && (type.includes("circ") || type.includes("ellip") || type.includes("lake"))) {
    outline = circleOutline(cx, cz, Math.max(0.5, Number(params.radius) || (Number(params.width) || 10) / 2));
  }
  if (!outline) outline = rectOutline(cx, cz, Math.max(0.5, Number(params.width) || 10), Math.max(0.5, Number(params.length) || 10));

  const base = { rotationY: 0, scale: [1, 1, 1], light: null, fixtureId: null };
  nodes.push({ ...base, name: "PoolBasin", kind: "pool", translation: [0, 0, 0], mesh: poolShell(outline, depth),
    material: MATERIALS.basin, fixtureType: "pool", extras: { kind: "pool", poolType: type, depthM: depth } });
  nodes.push({ ...base, name: "WaterSurface", kind: "water", translation: [0, 0, 0], mesh: planCap(outline, -0.05),
    material: MATERIALS.water, fixtureType: "water", extras: { kind: "water_surface", poolType: type } });
  return nodes;
}

/** Site surfaces (paving, lawn, planters, islands) as thin slabs at their elevation. */
function buildSiteNodes(surfaces) {
  return (surfaces || []).filter((s) => s && s.visible !== false && Array.isArray(s.points) && s.points.length >= 3).map((s, i) => {
    const top = Math.max(0.01, safeNum(s.elevation, 0.02));
    return { name: sanitizeName(s.label || s.id, "Surface_" + i), kind: "site", translation: [0, 0, 0], rotationY: 0, scale: [1, 1, 1],
      mesh: planSlab(s.points, 0, top), material: surfaceMaterial(s), light: null, fixtureId: null, fixtureType: "site_surface",
      extras: { kind: "site_surface", surfaceType: s.type || "", label: s.label || "", elevationM: top } };
  });
}

/** A water column per nozzle at its design height (a still frame of the jets at 100 %). */
function buildJetNodes(fixtures) {
  const out = [];
  (fixtures || []).forEach((f, i) => {
    if (classifyFixtureType(f.type) === "light" || classifyFixtureType(f.type) === "equipment") return;
    const h = safeNum(f.engineering?.jetHeightM, 0);
    if (!(h > 0)) return;
    const { x, z } = fixturePlanCoords(f);
    const r = Math.max(0.015, Math.min(0.08, safeNum(f.engineering?.nozzleDiaMm, 20) / 2000 * 2.5));
    out.push({ name: sanitizeName((f.label || f.id) + "_water", "Jet_" + i), kind: "jet", translation: [safeNum(x), 0, safeNum(z)],
      rotationY: 0, scale: [1, 1, 1], mesh: cylinder(r, r * 0.35, h, 10), material: MATERIALS.jet, light: null,
      fixtureId: f.id ?? null, fixtureType: "water_jet", extras: { kind: "water_jet", fixtureId: f.id ?? null, jetHeightM: h } });
  });
  return out;
}

// ── engineering metadata ─────────────────────────────────────────────────────

/**
 * Distil a fixture's engineering identity into a compact, serializer-friendly
 * extras record (fixture id, DMX patch, protocol, hydraulics, group). Carried on
 * glTF node.extras.aquaflow and in the LUXEXCHANGE manifest so LuxuryForm /
 * LuxuryScape can re-import by matching fixture_id. Reads defensively — designs
 * from different modules spell these fields a few different ways.
 */
function buildExtras(f, category) {
  const eng = f.engineering || {};
  const spec = f.spec || {};
  const dmx = f.dmx || {};
  return {
    fixtureId: f.id ?? null,
    fixtureType: f.type,
    category,
    label: f.label || String(f.id ?? ""),
    groupId: f.groupId || f.group_id || resolveFixtureGroup(f.type) || "",
    zone: f.zone || "",
    dmx: {
      universe: Math.round(safeNum(dmx.universe ?? eng.universe, 0)),
      channel: Math.round(safeNum(dmx.channel ?? eng.channel, 0)),
      channels: Math.round(safeNum(dmx.channels ?? eng.channels, 1)) || 1,
    },
    protocol: f.protocol || dmx.protocol || "",
    engineering: {
      flowLpm: safeNum(spec.flow_lpm ?? eng.flowLpm ?? eng.flow_lpm, 0),
      pressureBar: safeNum(spec.pressure_bar ?? eng.pressureBar ?? eng.pressure_bar, 0),
      powerKw: safeNum(spec.power_kw ?? eng.powerKw ?? eng.power_kw, 0),
    },
    sourceModule: f.source_module || "EngineeringDesigner",
  };
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
    const raw = fixturePlanCoords(f);
    const x = safeNum(raw.x);
    const z = safeNum(raw.z);
    const id = f.id ?? null;
    const color = f.color || f.params?.color || map.color;
    const rotationY = safeNum(f.rotation, 0);
    const s = safeNum(f.scale, 1) || 1;
    const scale = [s, s, s];
    const extras = buildExtras(f, category);

    if (category === "light") {
      const [r, g, b] = hexToRgb(color || "#ffffff");
      const intensity = f.engineering?.wattage ? f.engineering.wattage / 18.0 : (map.intensity || 4);
      nodes.push({
        name: sanitizeName(f.label || id, "Light_" + i),
        kind: "light",
        translation: [x, 0.05, z], rotationY, scale,
        mesh: lightGlyph(),
        material: lightMaterial(color),
        light: { type: map.lightType === "spot" ? "spot" : "point", color: [r, g, b], intensity },
        fixtureId: id,
        fixtureType: f.type,
        extras,
      });
    } else if (category === "equipment") {
      nodes.push({
        name: sanitizeName(f.label || id, "Equipment_" + i),
        kind: "equipment",
        translation: [x, 0.16, z], rotationY, scale,
        mesh: equipmentGlyph(),
        material: MATERIALS.equipment,
        light: null,
        fixtureId: id,
        fixtureType: f.type,
        extras,
      });
    } else if (category === "effect") {
      nodes.push({
        name: sanitizeName(f.label || id, "Effect_" + i),
        kind: "effect",
        translation: [x, 0, z], rotationY, scale,
        mesh: nozzleGlyph(map.heightMult || 1),
        material: effectMaterial(color),
        light: null,
        fixtureId: id,
        fixtureType: f.type,
        extras,
      });
    } else {
      nodes.push({
        name: sanitizeName(f.label || id, "Nozzle_" + i),
        kind: "nozzle",
        translation: [x, 0, z], rotationY, scale,
        mesh: nozzleGlyph(map.heightMult || 1),
        material: nozzleMaterial(color),
        light: null,
        fixtureId: id,
        fixtureType: f.type,
        extras,
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
  all.forEach((f) => { sx += safeNum(f.x); sz += safeNum(f.z); });
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
 *   - siteSurfaces:  engineering site_surfaces (paving, lawn, islands) — optional
 * @param {object} options - { includePool?, includeSite?, includeWater? (all default true) }
 */
export function buildSceneGraph(design = {}, options = {}) {
  const includePool = options.includePool !== false;
  const includeSite = options.includeSite !== false;
  const includeWater = options.includeWater !== false;
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
  if (includeSite) nodes.push(...buildSiteNodes(design.siteSurfaces));
  nodes.push(...buildFixtureNodes(fixtures));
  if (includeWater) nodes.push(...buildJetNodes(fixtures));

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
