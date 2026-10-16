/**
 * meshFormats.js — AquaFlow 3D Export Bridge · STL, PLY, COLLADA (.dae) and 3D DXF
 *
 * Axes: the export graph is Y-up metres (like glTF / OBJ / FBX). STL, PLY and DXF are
 * written Z-up — the convention of CAD, 3D printing and point-cloud tools — using
 * (x, y, z)_Yup → (x, −z, y)_Zup, which is also exactly how the 2D AutoCAD export maps
 * the plan (x, −y), so a 3D DXF overlays the CAD drawings. COLLADA declares Y_UP.
 */

import { srgbToLinear } from "./sceneGraph.js";

// ── world-space triangles ───────────────────────────────────────────────────

/** Node-local → world (Y-up): scale, rotate about Y (degrees), translate. */
function toWorld(node) {
  const [tx, ty, tz] = node.translation || [0, 0, 0];
  const [sx, sy, sz] = node.scale || [1, 1, 1];
  const a = ((node.rotationY || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return (x, y, z) => {
    x *= sx; y *= sy; z *= sz;
    return [x * c + z * s + tx, y + ty, -x * s + z * c + tz];
  };
}
const zUp = ([x, y, z]) => [x, -z, y];
const ascii = (s) => String(s).replace(/[^ -~]/g, "_");

/** Every mesh triangle in world space: [{ a, b, c, node }] (Y-up). */
export function worldTriangles(graph) {
  const out = [];
  for (const node of graph.nodes || []) {
    const m = node.mesh;
    if (!m || !m.indices.length) continue;
    const w = toWorld(node);
    const P = (i) => w(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]);
    for (let i = 0; i < m.indices.length; i += 3) out.push({ a: P(m.indices[i]), b: P(m.indices[i + 1]), c: P(m.indices[i + 2]), node });
  }
  return out;
}

const normalOf = (a, b, c) => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], l = Math.hypot(...n) || 1;
  return n.map((v) => v / l);
};

// ── STL (binary) ─────────────────────────────────────────────────────────────

/** Binary STL, Z-up metres. One solid; colour is not part of STL. */
export function toSTL(graph) {
  const tris = worldTriangles(graph);
  const buf = new ArrayBuffer(84 + tris.length * 50);
  const v = new DataView(buf);
  const head = new TextEncoder().encode(`AquaFlow Studio STL - ${ascii(graph.meta?.name || "scene")} - metres, Z up`.slice(0, 80));
  new Uint8Array(buf).set(head, 0);
  v.setUint32(80, tris.length, true);
  let o = 84;
  for (const t of tris) {
    const a = zUp(t.a), b = zUp(t.b), c = zUp(t.c);
    for (const x of [...normalOf(a, b, c), ...a, ...b, ...c]) { v.setFloat32(o, x, true); o += 4; }
    v.setUint16(o, 0, true); o += 2;
  }
  return new Uint8Array(buf);
}

// ── PLY (binary little-endian, with vertex colours) ─────────────────────────

export function toPLY(graph) {
  const tris = worldTriangles(graph);
  const header = [
    "ply", "format binary_little_endian 1.0", `comment AquaFlow Studio - ${ascii(graph.meta?.name || "scene")} - metres, Z up`,
    `element vertex ${tris.length * 3}`, "property float x", "property float y", "property float z",
    "property uchar red", "property uchar green", "property uchar blue",
    `element face ${tris.length}`, "property list uchar int vertex_indices", "end_header", "",
  ].join("\n");
  const head = new TextEncoder().encode(header);
  const buf = new Uint8Array(head.length + tris.length * 3 * 15 + tris.length * 13);
  buf.set(head, 0);
  const v = new DataView(buf.buffer);
  let o = head.length;
  for (const t of tris) {
    const [r, g, b] = (t.node.material?.baseColor || [0.8, 0.8, 0.8]).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255));
    for (const p of [t.a, t.b, t.c]) {
      for (const x of zUp(p)) { v.setFloat32(o, x, true); o += 4; }
      v.setUint8(o++, r); v.setUint8(o++, g); v.setUint8(o++, b);
    }
  }
  for (let i = 0; i < tris.length; i++) {
    v.setUint8(o++, 3); v.setInt32(o, i * 3, true); v.setInt32(o + 4, i * 3 + 1, true); v.setInt32(o + 8, i * 3 + 2, true); o += 12;
  }
  return buf;
}

// ── COLLADA 1.4.1 (.dae) ─────────────────────────────────────────────────────

const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (x) => (Math.abs(x) < 1e-9 ? "0" : (+x).toFixed(5).replace(/\.?0+$/, ""));

/** COLLADA 1.4.1 (SketchUp, Lumion, 3ds Max, Cinema 4D, Rhino, Unity). Y up, metres. */
export function toDAE(graph) {
  const meshNodes = (graph.nodes || []).filter((n) => n.mesh && n.mesh.indices.length);
  const mats = new Map();
  for (const n of meshNodes) if (n.material && !mats.has(n.material.name)) mats.set(n.material.name, n.material);
  const id = (s) => String(s).replace(/[^A-Za-z0-9_\-]/g, "_");
  const effects = [...mats.values()].map((m) => {
    const [r, g, b, a = 1] = m.baseColor || [0.8, 0.8, 0.8, 1];
    const [er, eg, eb] = m.emissive || [0, 0, 0];
    return `    <effect id="${id(m.name)}-fx"><profile_COMMON><technique sid="common"><phong>
      <emission><color>${num(er)} ${num(eg)} ${num(eb)} 1</color></emission>
      <diffuse><color>${num(r)} ${num(g)} ${num(b)} 1</color></diffuse>
      <specular><color>0.25 0.25 0.25 1</color></specular>
      <shininess><float>${num((1 - (m.roughness ?? 0.8)) * 64 + 2)}</float></shininess>
      <transparent opaque="A_ONE"><color>1 1 1 ${num(a)}</color></transparent>
      <transparency><float>1</float></transparency>
    </phong></technique></profile_COMMON></effect>`;
  }).join("\n");
  const materials = [...mats.values()].map((m) => `    <material id="${id(m.name)}" name="${xml(m.name)}"><instance_effect url="#${id(m.name)}-fx"/></material>`).join("\n");
  const geometries = meshNodes.map((n, k) => {
    const g = `geom-${k}`, pos = n.mesh.positions, nrm = n.mesh.normals, idx = n.mesh.indices;
    const p = [];
    for (const i of idx) p.push(i, i);
    return `    <geometry id="${g}" name="${xml(n.name)}"><mesh>
      <source id="${g}-pos"><float_array id="${g}-pos-a" count="${pos.length}">${Array.from(pos, num).join(" ")}</float_array>
        <technique_common><accessor source="#${g}-pos-a" count="${pos.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
      <source id="${g}-nrm"><float_array id="${g}-nrm-a" count="${nrm.length}">${Array.from(nrm, num).join(" ")}</float_array>
        <technique_common><accessor source="#${g}-nrm-a" count="${nrm.length / 3}" stride="3"><param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>
      <vertices id="${g}-vtx"><input semantic="POSITION" source="#${g}-pos"/></vertices>
      <triangles material="mat" count="${idx.length / 3}"><input semantic="VERTEX" source="#${g}-vtx" offset="0"/><input semantic="NORMAL" source="#${g}-nrm" offset="1"/><p>${p.join(" ")}</p></triangles>
    </mesh></geometry>`;
  }).join("\n");
  const nodes = meshNodes.map((n, k) => {
    const [tx, ty, tz] = n.translation || [0, 0, 0], [sx, sy, sz] = n.scale || [1, 1, 1];
    const bind = n.material ? `<bind_material><technique_common><instance_material symbol="mat" target="#${id(n.material.name)}"/></technique_common></bind_material>` : "";
    return `      <node id="node-${k}" name="${xml(n.name)}"><translate sid="location">${num(tx)} ${num(ty)} ${num(tz)}</translate><rotate sid="rotationY">0 1 0 ${num(n.rotationY || 0)}</rotate><scale sid="scale">${num(sx)} ${num(sy)} ${num(sz)}</scale>
        <instance_geometry url="#geom-${k}">${bind}</instance_geometry></node>`;
  }).join("\n");
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  return `<?xml version="1.0" encoding="utf-8"?>
<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">
  <asset><contributor><authoring_tool>${xml(graph.meta?.generator || "AquaFlow Studio")}</authoring_tool></contributor>
    <created>${now}</created><modified>${now}</modified><unit name="meter" meter="1"/><up_axis>Y_UP</up_axis></asset>
  <library_effects>
${effects}
  </library_effects>
  <library_materials>
${materials}
  </library_materials>
  <library_geometries>
${geometries}
  </library_geometries>
  <library_visual_scenes>
    <visual_scene id="scene" name="${xml(graph.meta?.name || "AquaFlow scene")}">
${nodes}
    </visual_scene>
  </library_visual_scenes>
  <scene><instance_visual_scene url="#scene"/></scene>
</COLLADA>
`;
}

// ── 3D DXF (3DFACE entities, AutoCAD R12 ASCII) ─────────────────────────────

const ACI = [[1, [1, 0, 0]], [2, [1, 1, 0]], [3, [0, 1, 0]], [4, [0, 1, 1]], [5, [0, 0, 1]], [6, [1, 0, 1]], [7, [1, 1, 1]],
  [8, [0.5, 0.5, 0.5]], [9, [0.75, 0.75, 0.75]], [30, [1, 0.5, 0]], [34, [0.5, 0.25, 0]], [94, [0.2, 0.5, 0.2]], [150, [0.2, 0.45, 0.8]]];
/** Nearest AutoCAD colour index for an sRGB colour. */
export function nearestACI([r, g, b]) {
  let best = 7, d = Infinity;
  for (const [i, [cr, cg, cb]] of ACI) { const e = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2; if (e < d) { d = e; best = i; } }
  return best;
}
const LAYER = { pool: "AQF_POOL", water: "AQF_WATER", site: "AQF_SITE", nozzle: "AQF_NOZZLES", light: "AQF_LIGHTS", equipment: "AQF_EQUIPMENT", effect: "AQF_EFFECTS", jet: "AQF_WATER_JETS" };

/** AutoCAD-compatible 3D DXF (R12 ASCII, 3DFACE per triangle, Z up, metres). */
export function toDXF3D(graph) {
  const tris = worldTriangles(graph);
  const layers = new Map();
  for (const t of tris) {
    const layer = LAYER[t.node.kind] || "AQF_OTHER";
    if (!layers.has(layer)) layers.set(layer, nearestACI(t.node.material?.baseColor || [1, 1, 1]));
  }
  const L = [];
  const g = (code, value) => { L.push(String(code), typeof value === "number" ? num(value) : String(value)); };
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$INSUNITS"); g(70, 6);
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LAYER"); g(70, layers.size + 1);
  g(0, "LAYER"); g(2, "0"); g(70, 0); g(62, 7); g(6, "CONTINUOUS");
  for (const [name, color] of layers) { g(0, "LAYER"); g(2, name); g(70, 0); g(62, color); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  for (const t of tris) {
    const layer = LAYER[t.node.kind] || "AQF_OTHER";
    const a = zUp(t.a), b = zUp(t.b), c = zUp(t.c);
    g(0, "3DFACE"); g(8, layer);
    g(10, a[0]); g(20, a[1]); g(30, a[2]);
    g(11, b[0]); g(21, b[1]); g(31, b[2]);
    g(12, c[0]); g(22, c[1]); g(32, c[2]);
    g(13, c[0]); g(23, c[1]); g(33, c[2]);
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return L.join("\r\n") + "\r\n";
}

export { srgbToLinear };
