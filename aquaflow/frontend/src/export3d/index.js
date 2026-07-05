/**
 * index.js — AQ-X-016 AquaFlow 3D Export Bridge · public entry point
 *
 * One call — exportScene(design, formatId) — turns the engineering design (pool
 * geometry + fixtures) into a downloadable 3D asset in any supported format:
 * glTF, GLB, OBJ (+MTL companion), USD, FBX, and the LUXEXCHANGE envelope used to
 * import into LuxuryForm / LuxuryScape.
 *
 * The result is transport-agnostic { filename, mimeType, data, companions }, so
 * the same function serves the UI download button and the headless test harness.
 */

import { buildSceneGraph, sceneTriangleCount } from "./sceneGraph.js";
import { toGLTF, toGLB } from "./gltf.js";
import { toOBJ, toMTL } from "./obj.js";
import { toUSDA } from "./usd.js";
import { toFBXASCII } from "./fbx.js";
import { toLuxExchange } from "./luxexchange.js";

export { buildSceneGraph, sceneTriangleCount } from "./sceneGraph.js";
export { toGLTF, toGLB } from "./gltf.js";
export { toOBJ, toMTL } from "./obj.js";
export { toUSDA } from "./usd.js";
export { toFBXASCII } from "./fbx.js";
export { toLuxExchange } from "./luxexchange.js";

/** Supported export formats (drives the UI picker + validation). */
export const EXPORT_FORMATS = [
  { id: "gltf", label: "glTF 2.0 (.gltf)", ext: "gltf", mimeType: "model/gltf+json", binary: false,
    blurb: "Self-contained JSON scene — universal, opens in Blender/Twinmotion/three.js." },
  { id: "glb", label: "glTF Binary (.glb)", ext: "glb", mimeType: "model/gltf-binary", binary: true,
    blurb: "Compact single-file binary glTF for engines and web viewers." },
  { id: "obj", label: "Wavefront (.obj + .mtl)", ext: "obj", mimeType: "text/plain", binary: false,
    blurb: "Classic mesh + material library — imports almost everywhere." },
  { id: "usd", label: "Universal Scene Description (.usda)", ext: "usda", mimeType: "text/plain", binary: false,
    blurb: "Pixar USD ASCII for Omniverse / Houdini / Unreal / Maya." },
  { id: "fbx", label: "Autodesk FBX (.fbx)", ext: "fbx", mimeType: "application/octet-stream", binary: false,
    blurb: "ASCII FBX for Maya / 3ds Max / Unreal / Unity." },
  { id: "luxexchange", label: "LUXEXCHANGE (.luxexchange.json)", ext: "luxexchange.json", mimeType: "application/json", binary: false,
    blurb: "LuxuryCon bridge envelope (glTF + fixture manifest) → LuxuryForm / LuxuryScape." },
];

export function isExportFormat(id) {
  return EXPORT_FORMATS.some((f) => f.id === id);
}

function safeName(name) {
  return String(name || "aquaflow_scene")
    .trim().replace(/[^a-z0-9_\-]+/gi, "_").replace(/^_+|_+$/g, "") || "aquaflow_scene";
}

/**
 * exportScene(design, formatId, options)
 *
 * @param design    { fixtures, poolGeometry, name }
 * @param formatId  one of EXPORT_FORMATS ids
 * @returns { format, filename, mimeType, binary, data, companions:[{filename,mimeType,data}], stats }
 *          `data` is a string, or a Uint8Array for binary formats (glb).
 */
export function exportScene(design = {}, formatId = "gltf", options = {}) {
  const fmt = EXPORT_FORMATS.find((f) => f.id === formatId);
  if (!fmt) throw new Error(`Unknown 3D export format: ${formatId}`);

  const graph = options.graph || buildSceneGraph(design, options);
  const base = safeName(design.name || graph.meta?.name);

  const result = {
    format: fmt.id,
    filename: `${base}.${fmt.ext}`,
    mimeType: fmt.mimeType,
    binary: fmt.binary,
    companions: [],
    stats: {
      nodeCount: graph.nodes.length,
      fixtureCount: graph.meta?.fixtureCount ?? 0,
      lightCount: graph.meta?.lightCount ?? 0,
      triangleCount: sceneTriangleCount(graph),
    },
  };

  switch (fmt.id) {
    case "gltf":
      result.data = toGLTF(graph);
      break;
    case "glb":
      result.data = toGLB(graph);
      break;
    case "obj": {
      const mtlName = `${base}.mtl`;
      result.data = toOBJ(graph, mtlName);
      result.companions.push({ filename: mtlName, mimeType: "text/plain", data: toMTL(graph) });
      break;
    }
    case "usd":
      result.data = toUSDA(graph);
      break;
    case "fbx":
      result.data = toFBXASCII(graph);
      break;
    case "luxexchange":
      result.data = JSON.stringify(toLuxExchange(graph, options), null, 2);
      break;
    default:
      throw new Error(`Unhandled 3D export format: ${fmt.id}`);
  }

  return result;
}
