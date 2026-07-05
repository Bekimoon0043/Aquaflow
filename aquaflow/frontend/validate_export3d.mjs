/**
 * validate_export3d.mjs — AQ-X-016 AquaFlow 3D Export Bridge validation harness
 *
 * Hand-checked, dependency-free scenario harness (run: `node validate_export3d.mjs`).
 * Builds a realistic fountain design, exports every format, parses each back, and
 * cross-checks the acceptance criteria (positions + materials preserved; glTF/GLB
 * well-formed; LUXEXCHANGE import path round-trips). Also writes the real files to
 * ./export3d_out/ so they can be opened in Blender / Twinmotion / Omniverse.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import {
  buildSceneGraph, sceneTriangleCount, exportScene, EXPORT_FORMATS,
  toGLTF, toGLB, toOBJ, toMTL, toUSDA, toFBXASCII, toLuxExchange,
} from "./src/export3d/index.js";

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
};

// ── A realistic ring-of-fixtures fountain around a circular pool ──────────────
const fixtures = [{ id: "center", type: "geyser", x: 0, y: 0, label: "Center Geyser" }];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  fixtures.push({ id: `ring_${i}`, type: "straight_jet_dn25", x: +(Math.cos(a) * 4).toFixed(3), y: +(Math.sin(a) * 4).toFixed(3), label: `Ring ${i}` });
}
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2;
  fixtures.push({ id: `light_${i}`, type: "light_uw_rgb_36w", x: +(Math.cos(a) * 2).toFixed(3), y: +(Math.sin(a) * 2).toFixed(3), label: `Light ${i}` });
}
fixtures.push({ id: "pump_1", type: "pump", x: -7, y: -7, label: "Pump" });
fixtures.push({ id: "flame_1", type: "flame", x: 0, y: 5, label: "Flame" });

const design = {
  name: "Validation Fountain",
  poolGeometry: { poolType: "circular", params: { radius: 6, depth: 0.8 }, geometry: null },
  fixtures,
};

const graph = buildSceneGraph(design);
console.log(`\nScene graph: ${graph.nodes.length} nodes, ${sceneTriangleCount(graph)} triangles, ${graph.meta.lightCount} lights\n`);

console.log("Scene graph");
check("pool basin + water + 17 fixtures = 19 nodes", graph.nodes.length === 19);
check("fixtureCount = 17", graph.meta.fixtureCount === 17);
check("lightCount = 6", graph.meta.lightCount === 6);
const center = graph.nodes.find((n) => n.fixtureId === "center");
check("center geyser at world (0,0,0)", center.translation[0] === 0 && center.translation[2] === 0);
const ring0 = graph.nodes.find((n) => n.fixtureId === "ring_0");
check("ring_0 x preserved (plan x → world x)", Math.abs(ring0.translation[0] - 4) < 1e-6);
const pump = graph.nodes.find((n) => n.fixtureId === "pump_1");
check("pump classified as equipment", pump.kind === "equipment");
check("pump position preserved (-7,-7)", pump.translation[0] === -7 && pump.translation[2] === -7);

console.log("\nglTF 2.0");
const gltfDoc = JSON.parse(toGLTF(graph));
check("asset.version == 2.0", gltfDoc.asset.version === "2.0");
check("one mesh per mesh-node", gltfDoc.meshes.length === graph.nodes.length);
check("embedded base64 buffer", gltfDoc.buffers[0].uri.startsWith("data:application/octet-stream;base64,"));
check("materials present", gltfDoc.materials.length > 0);
check("KHR_lights_punctual used", (gltfDoc.extensionsUsed || []).includes("KHR_lights_punctual"));
check("6 punctual lights", gltfDoc.extensions.KHR_lights_punctual.lights.length === 6);
check("every accessor → valid bufferView", gltfDoc.accessors.every((a) => gltfDoc.bufferViews[a.bufferView]));
check("POSITION accessors have min/max", gltfDoc.accessors.some((a) => a.min && a.max));

console.log("\nGLB binary");
const glb = toGLB(graph);
const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
check("magic 'glTF'", dv.getUint32(0, true) === 0x46546c67);
check("version 2", dv.getUint32(4, true) === 2);
check("declared length == byteLength", dv.getUint32(8, true) === glb.byteLength);
check("length 4-byte aligned", glb.byteLength % 4 === 0);
const jsonLen = dv.getUint32(12, true);
check("first chunk is JSON", dv.getUint32(16, true) === 0x4e4f534a);
const glbDoc = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)));
check("GLB JSON parses to glTF 2.0", glbDoc.asset.version === "2.0");
check("GLB buffer has no uri", glbDoc.buffers[0].uri === undefined);
check("GLB buffer length matches BIN chunk", (() => {
  const binChunkLen = dv.getUint32(20 + jsonLen, true);
  return binChunkLen >= glbDoc.buffers[0].byteLength;
})());

console.log("\nOBJ + MTL");
const obj = toOBJ(graph, "scene.mtl");
const mtl = toMTL(graph);
check("OBJ references mtllib", obj.includes("mtllib scene.mtl"));
check("one 'o' group per node", (obj.match(/^o /gm) || []).length === graph.nodes.length);
const used = new Set([...obj.matchAll(/^usemtl (.+)$/gm)].map((m) => m[1]));
const defined = new Set([...mtl.matchAll(/^newmtl (.+)$/gm)].map((m) => m[1]));
check("every usemtl defined in MTL", [...used].every((n) => defined.has(n)));
const objVerts = [...obj.matchAll(/^v (\S+) (\S+) (\S+)$/gm)].map((m) => m.slice(1).map(Number));
check("pump glyph vertices baked near (-7,-7)", objVerts.some((v) => Math.abs(v[0] + 7) < 0.5 && Math.abs(v[2] + 7) < 0.5));

console.log("\nUSD (USDA)");
const usd = toUSDA(graph);
check("starts with #usda 1.0", usd.startsWith("#usda 1.0"));
check("one def Mesh per node", (usd.match(/def Mesh /g) || []).length === graph.nodes.length);
check("uses UsdPreviewSurface", usd.includes('uniform token info:id = "UsdPreviewSurface"'));
check("upAxis Y", usd.includes('upAxis = "Y"'));

console.log("\nFBX (ASCII)");
const fbx = toFBXASCII(graph);
check("FBXVersion 7300", fbx.includes("FBXVersion: 7300"));
check("has Objects block", fbx.includes("Objects:  {"));
check("has Connections block", fbx.includes("Connections:  {"));
check("one Geometry per node", (fbx.match(/Geometry: \d+, "Geometry::/g) || []).length === graph.nodes.length);
check("Lcl Translation present", fbx.includes('P: "Lcl Translation"'));

console.log("\nLUXEXCHANGE bridge (import path)");
const env = JSON.parse(JSON.stringify(toLuxExchange(graph)));
check("envelope shape {platform,version,payload_type,payload}", env.platform === "AquaFlow" && env.version === "1.0" && env.payload_type === "scene3d" && !!env.payload);
check("payload embeds glTF 2.0", env.payload.gltf.asset.version === "2.0");
check("fixture manifest = 17 fixtures", env.payload.fixtures.length === 17);
const manifestCenter = env.payload.fixtures.find((f) => f.id === "center");
check("manifest preserves position", manifestCenter.position.x === 0 && manifestCenter.position.z === 0);
check("manifest preserves material baseColor", Array.isArray(manifestCenter.material.baseColor));
const manifestLight = env.payload.fixtures.find((f) => f.id === "light_0");
check("manifest preserves light record", manifestLight.light && manifestLight.light.type === "point");

console.log("\nOrchestrator (exportScene)");
for (const fmt of EXPORT_FORMATS) {
  const out = exportScene(design, fmt.id);
  check(`${fmt.id}: filename + non-empty payload`, out.filename.endsWith(fmt.ext) && (fmt.binary ? out.data.byteLength > 0 : out.data.length > 0));
}

// ── write real files for hand inspection ─────────────────────────────────────
const outDir = new URL("./export3d_out/", import.meta.url);
try {
  mkdirSync(outDir, { recursive: true });
  for (const fmt of EXPORT_FORMATS) {
    const out = exportScene(design, fmt.id);
    const p = new URL(out.filename, outDir);
    writeFileSync(p, fmt.binary ? out.data : out.data);
    for (const c of out.companions) writeFileSync(new URL(c.filename, outDir), c.data);
  }
  console.log(`\nWrote sample exports to ${outDir.pathname}`);
} catch (e) {
  console.log(`\n(could not write sample files: ${e.message})`);
}

console.log(`\n${pass}/${pass + fail} checks passed${fail ? `, ${fail} FAILED` : ""}`);
process.exit(fail ? 1 : 0);
