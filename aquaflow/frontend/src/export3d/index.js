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
import { toFBX } from "./fbx.js";
import { toSTL, toPLY, toDAE, toDXF3D } from "./meshFormats.js";
import { createZip } from "../utils/zipStore.js";
import { toLuxExchange } from "./luxexchange.js";

export { buildSceneGraph, sceneTriangleCount } from "./sceneGraph.js";
export { toGLTF, toGLB } from "./gltf.js";
export { toOBJ, toMTL } from "./obj.js";
export { toUSDA } from "./usd.js";
export { toFBX, toFBXASCII } from "./fbx.js";
export { toSTL, toPLY, toDAE, toDXF3D, worldTriangles } from "./meshFormats.js";
export { toLuxExchange } from "./luxexchange.js";

/** Supported export formats (drives the UI picker + validation). */
export const EXPORT_FORMATS = [
  { id: "fbx", label: "Autodesk FBX (.fbx)", ext: "fbx", mimeType: "application/octet-stream", binary: true,
    blurb: "Binary FBX 7.4 — 3ds Max, Maya, Blender, Unity, Unreal, SketchUp, Twinmotion, Lumion, Cinema 4D." },
  { id: "glb", label: "glTF Binary (.glb)", ext: "glb", mimeType: "model/gltf-binary", binary: true,
    blurb: "One file with materials and lights — Blender, Twinmotion, Unreal, Unity, web viewers, Windows 3D Viewer." },
  { id: "gltf", label: "glTF 2.0 (.gltf)", ext: "gltf", mimeType: "model/gltf+json", binary: false,
    blurb: "Text glTF with embedded data — the same scene as .glb." },
  { id: "obj", label: "Wavefront OBJ (.obj + .mtl)", ext: "obj", mimeType: "text/plain", binary: false,
    blurb: "Mesh + material library — imports almost everywhere (Rhino, SketchUp, 3ds Max, Revit, Lumion)." },
  { id: "dae", label: "COLLADA (.dae)", ext: "dae", mimeType: "model/vnd.collada+xml", binary: false,
    blurb: "SketchUp, Lumion, 3ds Max, Cinema 4D, Rhino." },
  { id: "dxf3d", label: "AutoCAD 3D DXF (.dxf)", ext: "dxf", mimeType: "application/dxf", binary: false,
    blurb: "3D faces on layers, Z up, metres — AutoCAD, Revit, SketchUp, Rhino; overlays the 2D CAD export." },
  { id: "stl", label: "STL (.stl)", ext: "stl", mimeType: "model/stl", binary: true,
    blurb: "Binary STL, Z up, metres — 3D printing, CAD, MeshLab (geometry only)." },
  { id: "ply", label: "PLY (.ply)", ext: "ply", mimeType: "application/octet-stream", binary: true,
    blurb: "Binary PLY with colours, Z up — MeshLab, CloudCompare, Blender." },
  { id: "usd", label: "Universal Scene Description (.usda)", ext: "usda", mimeType: "text/plain", binary: false,
    blurb: "Pixar USD — NVIDIA Omniverse, Houdini, Unreal, Maya, Blender." },
  { id: "luxexchange", label: "LUXEXCHANGE (.luxexchange.json)", ext: "luxexchange.json", mimeType: "application/json", binary: false,
    blurb: "LuxuryCon bridge envelope (glTF + fixture manifest) → LuxuryForm / LuxuryScape." },
  { id: "all", label: "All formats (.zip)", ext: "zip", mimeType: "application/zip", binary: true,
    blurb: "Every format above in one zip, ready to hand to any studio." },
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
      result.data = toFBX(graph);
      break;
    case "dae":
      result.data = toDAE(graph);
      break;
    case "dxf3d":
      result.data = toDXF3D(graph);
      break;
    case "stl":
      result.data = toSTL(graph);
      break;
    case "ply":
      result.data = toPLY(graph);
      break;
    case "all": {
      const enc = new TextEncoder();
      const entries = [];
      for (const f of EXPORT_FORMATS.filter((x) => x.id !== "all")) {
        const one = exportScene(design, f.id, { ...options, graph });
        for (const file of [one, ...one.companions]) {
          entries.push({ name: `${base}/${file.filename}`, data: typeof file.data === "string" ? enc.encode(file.data) : file.data });
        }
      }
      result.data = createZip(entries);
      break;
    }
    case "luxexchange":
      result.data = JSON.stringify(toLuxExchange(graph, options), null, 2);
      break;
    default:
      throw new Error(`Unhandled 3D export format: ${fmt.id}`);
  }

  return result;
}
