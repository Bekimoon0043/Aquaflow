/**
 * gltf.js — AQ-X-016 AquaFlow 3D Export Bridge · glTF 2.0 / GLB serializer
 *
 * Dependency-free glTF 2.0 writer. Produces either:
 *   - toGLTF(graph): a self-contained .gltf JSON string with the binary buffer
 *     embedded as a base64 data URI (no sidecar .bin — a single portable file).
 *   - toGLB(graph):  a binary .glb (Uint8Array) — header + JSON chunk + BIN chunk.
 *
 * Materials are exported as PBR metallic-roughness (baseColor/metallic/roughness/
 * emissive), colors converted sRGB→linear per the glTF spec. Punctual lights use
 * the ratified KHR_lights_punctual extension. Runs in Node and the browser.
 */

import { srgbToLinear } from "./sceneGraph.js";

// ── base64 (pure, node + browser) ─────────────────────────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function encodeBase64(bytes) {
  let out = "";
  const n = bytes.length;
  for (let i = 0; i < n; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < n ? bytes[i + 1] : 0;
    const b2 = i + 2 < n ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < n ? B64[b2 & 63] : "=";
  }
  return out;
}

// ── binary buffer builder ─────────────────────────────────────────────────────

/**
 * Pack every mesh node's positions/normals/indices into one binary buffer and
 * emit the accessor/bufferView tables. All components are 4 bytes (float32 for
 * attributes, uint32 for indices) so byte offsets stay naturally 4-aligned.
 */
function buildBuffers(nodes) {
  const chunks = [];       // Uint8Array pieces
  let byteLength = 0;
  const bufferViews = [];
  const accessors = [];

  const addView = (u8, target) => {
    const byteOffset = byteLength;
    chunks.push(u8);
    byteLength += u8.byteLength;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: u8.byteLength, target });
    return bufferViews.length - 1;
  };

  const meshRefs = []; // per node: { position, normal, indices } accessor indices or null
  nodes.forEach((node) => {
    if (!node.mesh || !node.mesh.indices.length) { meshRefs.push(null); return; }
    const pos = Float32Array.from(node.mesh.positions);
    const nrm = Float32Array.from(node.mesh.normals);
    const idx = Uint32Array.from(node.mesh.indices);

    // POSITION accessor (with required min/max).
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]);   maxX = Math.max(maxX, pos[i]);
      minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
      minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
    }
    const posView = addView(new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength), 34962);
    accessors.push({ bufferView: posView, componentType: 5126, count: pos.length / 3, type: "VEC3",
      min: [minX, minY, minZ], max: [maxX, maxY, maxZ] });
    const positionAcc = accessors.length - 1;

    const nrmView = addView(new Uint8Array(nrm.buffer, nrm.byteOffset, nrm.byteLength), 34962);
    accessors.push({ bufferView: nrmView, componentType: 5126, count: nrm.length / 3, type: "VEC3" });
    const normalAcc = accessors.length - 1;

    const idxView = addView(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), 34963);
    accessors.push({ bufferView: idxView, componentType: 5125, count: idx.length, type: "SCALAR" });
    const indexAcc = accessors.length - 1;

    meshRefs.push({ position: positionAcc, normal: normalAcc, indices: indexAcc });
  });

  // Concatenate chunks into one buffer.
  const bin = new Uint8Array(byteLength);
  let off = 0;
  for (const c of chunks) { bin.set(c, off); off += c.byteLength; }

  return { bin, bufferViews, accessors, meshRefs };
}

// ── material table ─────────────────────────────────────────────────────────────

function buildMaterials(nodes) {
  const materials = [];
  const byName = new Map();
  const nodeMaterial = new Map(); // node → material index

  nodes.forEach((node) => {
    if (!node.mesh || !node.material) return;
    const m = node.material;
    if (byName.has(m.name)) { nodeMaterial.set(node, byName.get(m.name)); return; }
    const [r, g, b, a = 1] = m.baseColor;
    const gltfMat = {
      name: m.name,
      pbrMetallicRoughness: {
        baseColorFactor: [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a],
        metallicFactor: m.metallic ?? 0.0,
        roughnessFactor: m.roughness ?? 0.8,
      },
    };
    const [er, eg, eb] = m.emissive || [0, 0, 0];
    if (er || eg || eb) gltfMat.emissiveFactor = [srgbToLinear(er), srgbToLinear(eg), srgbToLinear(eb)];
    if (a < 1) { gltfMat.alphaMode = "BLEND"; gltfMat.doubleSided = true; }
    materials.push(gltfMat);
    byName.set(m.name, materials.length - 1);
    nodeMaterial.set(node, materials.length - 1);
  });

  return { materials, nodeMaterial };
}

// ── core assembler ─────────────────────────────────────────────────────────────

function assemble(graph, { embedBuffer }) {
  const nodes = graph.nodes || [];
  const { bin, bufferViews, accessors, meshRefs } = buildBuffers(nodes);
  const { materials, nodeMaterial } = buildMaterials(nodes);

  const meshes = [];
  const gltfNodes = [];
  const sceneNodeIndices = [];
  const lights = [];

  nodes.forEach((node, i) => {
    const gnode = { name: node.name };
    if (node.translation && node.translation.some((v) => v !== 0)) {
      gnode.translation = node.translation.map((v) => +v.toFixed(6));
    }
    const ref = meshRefs[i];
    if (ref) {
      const primitive = { attributes: { POSITION: ref.position, NORMAL: ref.normal }, indices: ref.indices };
      const matIdx = nodeMaterial.get(node);
      if (matIdx !== undefined) primitive.material = matIdx;
      meshes.push({ name: node.name + "_mesh", primitives: [primitive] });
      gnode.mesh = meshes.length - 1;
    }
    if (node.light) {
      const [lr, lg, lb] = node.light.color;
      lights.push({
        type: node.light.type,
        color: [srgbToLinear(lr), srgbToLinear(lg), srgbToLinear(lb)],
        intensity: node.light.intensity,
        ...(node.light.type === "spot" ? { spot: { outerConeAngle: 0.9 } } : {}),
      });
      gnode.extensions = { KHR_lights_punctual: { light: lights.length - 1 } };
    }
    gltfNodes.push(gnode);
    sceneNodeIndices.push(i);
  });

  const buffer = { byteLength: bin.byteLength };
  if (embedBuffer) buffer.uri = "data:application/octet-stream;base64," + encodeBase64(bin);

  const gltf = {
    asset: { version: "2.0", generator: graph.meta?.generator || "AquaFlow" },
    scene: 0,
    scenes: [{ name: graph.meta?.name || "Scene", nodes: sceneNodeIndices }],
    nodes: gltfNodes,
    meshes,
    accessors,
    bufferViews,
    buffers: [buffer],
    materials,
    extras: { aquaflow: { ...graph.meta } },
  };
  if (lights.length) {
    gltf.extensionsUsed = ["KHR_lights_punctual"];
    gltf.extensions = { KHR_lights_punctual: { lights } };
  }
  // Drop empty top-level arrays to keep the document clean/valid.
  if (!materials.length) delete gltf.materials;

  return { gltf, bin };
}

// ── public API ───────────────────────────────────────────────────────────────

/** glTF 2.0 as a self-contained JSON string (binary embedded as a data URI). */
export function toGLTF(graph) {
  const { gltf } = assemble(graph, { embedBuffer: true });
  return JSON.stringify(gltf, null, 2);
}

/** Binary GLB container (Uint8Array): 12-byte header + JSON chunk + BIN chunk. */
export function toGLB(graph) {
  const { gltf, bin } = assemble(graph, { embedBuffer: false });
  const enc = new TextEncoder();
  let jsonBytes = enc.encode(JSON.stringify(gltf));

  // Pad JSON chunk to a 4-byte boundary with spaces.
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length);
    jsonBytes = padded;
  }
  // Pad BIN chunk to a 4-byte boundary with zeros.
  const binPad = (4 - (bin.length % 4)) % 4;
  let binBytes = bin;
  if (binPad) {
    const padded = new Uint8Array(bin.length + binPad);
    padded.set(bin);
    binBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.length + 8 + binBytes.length;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setUint32(o, 0x46546c67, true); o += 4; // magic "glTF"
  dv.setUint32(o, 2, true); o += 4;          // version 2
  dv.setUint32(o, total, true); o += 4;      // total length
  // JSON chunk
  dv.setUint32(o, jsonBytes.length, true); o += 4;
  dv.setUint32(o, 0x4e4f534a, true); o += 4; // "JSON"
  out.set(jsonBytes, o); o += jsonBytes.length;
  // BIN chunk
  dv.setUint32(o, binBytes.length, true); o += 4;
  dv.setUint32(o, 0x004e4942, true); o += 4; // "BIN\0"
  out.set(binBytes, o); o += binBytes.length;

  return out;
}
