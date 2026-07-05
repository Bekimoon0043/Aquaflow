/**
 * usd.js — AQ-X-016 AquaFlow 3D Export Bridge · USD (USDA ASCII) serializer
 *
 * Emits a Pixar USD ASCII (.usda) crate: one `def Mesh` prim per node with real
 * points/faceVertexIndices/normals, a `def Material` per material using the
 * standard UsdPreviewSurface shader, and material bindings. Imports into Omniverse,
 * Houdini, Maya (USD), Unreal, Twinmotion. Colors are converted sRGB→linear.
 */

import { srgbToLinear } from "./sceneGraph.js";

const n6 = (v) => (+v).toFixed(6);
const vec3 = (a, b, c) => `(${n6(a)}, ${n6(b)}, ${n6(c)})`;

function pointsList(pos) {
  const out = [];
  for (let i = 0; i < pos.length; i += 3) out.push(vec3(pos[i], pos[i + 1], pos[i + 2]));
  return out.join(", ");
}
function normalsList(nrm) {
  const out = [];
  for (let i = 0; i < nrm.length; i += 3) out.push(vec3(nrm[i], nrm[i + 1], nrm[i + 2]));
  return out.join(", ");
}

export function toUSDA(graph) {
  const rootName = "AquaFlowScene";
  const meshNodes = (graph.nodes || []).filter((n) => n.mesh && n.mesh.indices.length);

  // Deduplicate materials.
  const matByName = new Map();
  meshNodes.forEach((n) => { if (n.material) matByName.set(n.material.name, n.material); });

  const lines = [];
  lines.push("#usda 1.0");
  lines.push("(");
  lines.push(`    defaultPrim = "${rootName}"`);
  lines.push(`    doc = "${graph.meta?.generator || "AquaFlow"} — ${graph.meta?.name || "Scene"}"`);
  lines.push("    metersPerUnit = 1");
  lines.push('    upAxis = "Y"');
  lines.push(")");
  lines.push("");
  lines.push(`def Xform "${rootName}"`);
  lines.push("{");

  // Meshes.
  meshNodes.forEach((node) => {
    const pos = node.mesh.positions;
    const nrm = node.mesh.normals;
    const triCount = node.mesh.indices.length / 3;
    const vertCount = pos.length / 3;
    const faceVertexCounts = Array(triCount).fill(3).join(", ");
    // Vertices are unshared, so faceVertexIndices are simply sequential.
    const faceVertexIndices = node.mesh.indices.join(", ");
    const [tx, ty, tz] = node.translation || [0, 0, 0];

    // Local extent.
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      mnx = Math.min(mnx, pos[i]); mxx = Math.max(mxx, pos[i]);
      mny = Math.min(mny, pos[i + 1]); mxy = Math.max(mxy, pos[i + 1]);
      mnz = Math.min(mnz, pos[i + 2]); mxz = Math.max(mxz, pos[i + 2]);
    }

    lines.push(`    def Mesh "${node.name}"`);
    lines.push("    {");
    lines.push(`        float3[] extent = [${vec3(mnx, mny, mnz)}, ${vec3(mxx, mxy, mxz)}]`);
    lines.push(`        int[] faceVertexCounts = [${faceVertexCounts}]`);
    lines.push(`        int[] faceVertexIndices = [${faceVertexIndices}]`);
    lines.push(`        point3f[] points = [${pointsList(pos)}]`);
    lines.push(`        normal3f[] normals = [${normalsList(nrm)}] (interpolation = "vertex")`);
    if (node.material) {
      lines.push(`        rel material:binding = </${rootName}/Materials/${node.material.name}>`);
    }
    lines.push(`        uniform token subdivisionScheme = "none"`);
    lines.push(`        double3 xformOp:translate = ${vec3(tx, ty, tz)}`);
    lines.push(`        uniform token[] xformOpOrder = ["xformOp:translate"]`);
    lines.push(`        custom string aquaflow:fixtureType = "${node.fixtureType || ""}"`);
    lines.push("    }");
    // Silence unused var without changing output.
    void vertCount;
  });

  // Materials scope.
  lines.push(`    def Scope "Materials"`);
  lines.push("    {");
  for (const m of matByName.values()) {
    const [r, g, b, a = 1] = m.baseColor;
    const [er, eg, eb] = m.emissive || [0, 0, 0];
    const path = `</${rootName}/Materials/${m.name}`;
    lines.push(`        def Material "${m.name}"`);
    lines.push("        {");
    lines.push(`            token outputs:surface.connect = ${path}/PreviewSurface.outputs:surface>`);
    lines.push(`            def Shader "PreviewSurface"`);
    lines.push("            {");
    lines.push(`                uniform token info:id = "UsdPreviewSurface"`);
    lines.push(`                color3f inputs:diffuseColor = ${vec3(srgbToLinear(r), srgbToLinear(g), srgbToLinear(b))}`);
    lines.push(`                float inputs:metallic = ${n6(m.metallic ?? 0)}`);
    lines.push(`                float inputs:roughness = ${n6(m.roughness ?? 0.8)}`);
    if (er || eg || eb) {
      lines.push(`                color3f inputs:emissiveColor = ${vec3(srgbToLinear(er), srgbToLinear(eg), srgbToLinear(eb))}`);
    }
    if (a < 1) lines.push(`                float inputs:opacity = ${n6(a)}`);
    lines.push(`                token outputs:surface`);
    lines.push("            }");
    lines.push("        }");
  }
  lines.push("    }");

  lines.push("}");
  lines.push("");
  return lines.join("\n");
}
