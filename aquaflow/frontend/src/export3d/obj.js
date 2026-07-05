/**
 * obj.js — AQ-X-016 AquaFlow 3D Export Bridge · Wavefront OBJ + MTL serializer
 *
 * Emits a classic OBJ geometry file plus a companion MTL material library. OBJ
 * is the most universally importable mesh format (opens in Blender, Cinema4D,
 * 3ds Max, Twinmotion, etc.). Vertex indices are global and 1-based per spec;
 * each node becomes an `o` group referencing a material via `usemtl`.
 */

const f6 = (v) => (+v).toFixed(6);

/** Wavefront MTL library string for the scene's materials (sRGB, as authored). */
export function toMTL(graph) {
  const lines = [`# ${graph.meta?.generator || "AquaFlow"} — material library`,
    `# ${graph.meta?.name || "Scene"}`, ""];
  const seen = new Set();
  (graph.nodes || []).forEach((node) => {
    if (!node.mesh || !node.material) return;
    const m = node.material;
    if (seen.has(m.name)) return;
    seen.add(m.name);
    const [r, g, b, a = 1] = m.baseColor;
    const [er, eg, eb] = m.emissive || [0, 0, 0];
    // Higher metallic → shinier spec highlight; roughness → lower Ns.
    const ns = Math.round((1 - (m.roughness ?? 0.8)) * 900 + 8);
    const spec = m.metallic ?? 0;
    lines.push(`newmtl ${m.name}`);
    lines.push(`Ka ${f6(r * 0.1)} ${f6(g * 0.1)} ${f6(b * 0.1)}`);
    lines.push(`Kd ${f6(r)} ${f6(g)} ${f6(b)}`);
    lines.push(`Ks ${f6(spec)} ${f6(spec)} ${f6(spec)}`);
    lines.push(`Ns ${ns}`);
    if (er || eg || eb) lines.push(`Ke ${f6(er)} ${f6(eg)} ${f6(eb)}`);
    if (a < 1) lines.push(`d ${f6(a)}`);
    lines.push(`illum 2`, "");
  });
  return lines.join("\n");
}

/** Wavefront OBJ geometry string. @param mtlFilename referenced via `mtllib`. */
export function toOBJ(graph, mtlFilename = "aquaflow_scene.mtl") {
  const lines = [`# ${graph.meta?.generator || "AquaFlow"}`,
    `# ${graph.meta?.name || "Scene"} — generated ${graph.meta?.generatedAt || ""}`,
    `mtllib ${mtlFilename}`, ""];

  let vBase = 1; // OBJ indices are 1-based and global.
  (graph.nodes || []).forEach((node) => {
    if (!node.mesh || !node.mesh.indices.length) return;
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const pos = node.mesh.positions;
    const nrm = node.mesh.normals;
    const idx = node.mesh.indices;

    lines.push(`o ${node.name}`);
    if (node.material) lines.push(`usemtl ${node.material.name}`);
    for (let i = 0; i < pos.length; i += 3) {
      lines.push(`v ${f6(pos[i] + tx)} ${f6(pos[i + 1] + ty)} ${f6(pos[i + 2] + tz)}`);
    }
    for (let i = 0; i < nrm.length; i += 3) {
      lines.push(`vn ${f6(nrm[i])} ${f6(nrm[i + 1])} ${f6(nrm[i + 2])}`);
    }
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] + vBase, b = idx[i + 1] + vBase, c = idx[i + 2] + vBase;
      lines.push(`f ${a}//${a} ${b}//${b} ${c}//${c}`);
    }
    vBase += pos.length / 3;
    lines.push("");
  });

  return lines.join("\n");
}
