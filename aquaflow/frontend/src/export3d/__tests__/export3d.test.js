/**
 * export3d.test.js — AQ-X-016 AquaFlow 3D Export Bridge tests
 *
 * Verifies the acceptance criteria headlessly (vitest env = node, no DOM):
 *   1. Export the scene to glTF/GLB, FBX, OBJ/MTL, USD.
 *   2. Fixture positions + basic materials are preserved in every format.
 *   3. The LUXEXCHANGE + glTF import path round-trips (fixtures survive parse-back).
 */

import { describe, it, expect } from "vitest";
import {
  buildSceneGraph, sceneTriangleCount, exportScene, EXPORT_FORMATS,
  toGLTF, toGLB, toOBJ, toMTL, toUSDA, toFBXASCII, toLuxExchange,
} from "../index.js";

// A representative design: circular pool + a nozzle, a light, a pump, a flame.
const DESIGN = {
  name: "Test Fountain",
  poolGeometry: { poolType: "circular", params: { radius: 6, depth: 0.8 }, geometry: null },
  fixtures: [
    { id: "nz1", type: "geyser", x: 1.5, y: -2.0, label: "Center Geyser" },
    { id: "nz2", type: "arch_jet", x: -3.0, y: 2.5, label: "Arch A" },
    { id: "lt1", type: "light_uw_rgb_36w", x: 2.0, y: 2.0, label: "UW Light" },
    { id: "pmp1", type: "pump", x: -5.0, y: -5.0, label: "Pump 1" },
    { id: "fl1", type: "flame", x: 0.0, y: 0.0, label: "Flame" },
  ],
};

function findFixtureNode(graph, id) {
  return graph.nodes.find((n) => n.fixtureId === id);
}

describe("scene graph", () => {
  const graph = buildSceneGraph(DESIGN);

  it("builds pool + a node per fixture", () => {
    // 2 pool nodes (basin + water) + 5 fixtures.
    expect(graph.nodes.length).toBe(7);
    expect(graph.meta.fixtureCount).toBe(5);
    expect(sceneTriangleCount(graph)).toBeGreaterThan(0);
  });

  it("preserves fixture plan positions (plan y → world z)", () => {
    const nz1 = findFixtureNode(graph, "nz1");
    expect(nz1.translation[0]).toBeCloseTo(1.5, 6);
    expect(nz1.translation[2]).toBeCloseTo(-2.0, 6);
    const pmp = findFixtureNode(graph, "pmp1");
    expect(pmp.translation[0]).toBeCloseTo(-5.0, 6);
    expect(pmp.translation[2]).toBeCloseTo(-5.0, 6);
  });

  it("classifies fixtures into kinds with materials", () => {
    expect(findFixtureNode(graph, "nz1").kind).toBe("nozzle");
    expect(findFixtureNode(graph, "lt1").kind).toBe("light");
    expect(findFixtureNode(graph, "lt1").light).toBeTruthy();
    expect(findFixtureNode(graph, "pmp1").kind).toBe("equipment");
    expect(findFixtureNode(graph, "fl1").kind).toBe("effect");
    graph.nodes.forEach((n) => { if (n.mesh) expect(n.material).toBeTruthy(); });
  });
});

describe("glTF", () => {
  const graph = buildSceneGraph(DESIGN);

  it("emits valid glTF 2.0 JSON with an embedded buffer", () => {
    const doc = JSON.parse(toGLTF(graph));
    expect(doc.asset.version).toBe("2.0");
    expect(doc.buffers[0].uri.startsWith("data:application/octet-stream;base64,")).toBe(true);
    expect(doc.meshes.length).toBe(7);
    expect(doc.materials.length).toBeGreaterThan(0);
    // Every accessor references a valid bufferView.
    doc.accessors.forEach((a) => expect(doc.bufferViews[a.bufferView]).toBeTruthy());
    // POSITION accessors carry required min/max.
    const posAcc = doc.accessors.find((a) => a.type === "VEC3" && a.min);
    expect(posAcc.min.length).toBe(3);
  });

  it("preserves fixture node translations", () => {
    const doc = JSON.parse(toGLTF(graph));
    const node = doc.nodes.find((n) => n.name.startsWith("Center_Geyser") || n.name === "Center_Geyser");
    expect(node.translation[0]).toBeCloseTo(1.5, 4);
    expect(node.translation[2]).toBeCloseTo(-2.0, 4);
  });

  it("exports punctual lights via KHR_lights_punctual", () => {
    const doc = JSON.parse(toGLTF(graph));
    expect(doc.extensionsUsed).toContain("KHR_lights_punctual");
    expect(doc.extensions.KHR_lights_punctual.lights.length).toBe(1);
  });
});

describe("GLB", () => {
  it("emits a valid binary container (magic, version, chunks)", () => {
    const glb = toGLB(buildSceneGraph(DESIGN));
    expect(glb).toBeInstanceOf(Uint8Array);
    const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(dv.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(dv.getUint32(4, true)).toBe(2);          // version 2
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
    // First chunk is JSON and parses back.
    const jsonLen = dv.getUint32(12, true);
    expect(dv.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
    const jsonBytes = glb.subarray(20, 20 + jsonLen);
    const doc = JSON.parse(new TextDecoder().decode(jsonBytes));
    expect(doc.asset.version).toBe("2.0");
    // GLB buffer has no uri (references the BIN chunk).
    expect(doc.buffers[0].uri).toBeUndefined();
    // Length is 4-byte aligned.
    expect(glb.byteLength % 4).toBe(0);
  });
});

describe("OBJ + MTL", () => {
  const graph = buildSceneGraph(DESIGN);

  it("emits geometry referencing an MTL library", () => {
    const obj = toOBJ(graph, "test.mtl");
    expect(obj).toContain("mtllib test.mtl");
    expect((obj.match(/^o /gm) || []).length).toBe(7);
    expect((obj.match(/^v /gm) || []).length).toBeGreaterThan(0);
    expect((obj.match(/^f /gm) || []).length).toBeGreaterThan(0);
  });

  it("every usemtl exists in the MTL library", () => {
    const obj = toOBJ(graph);
    const mtl = toMTL(graph);
    const used = [...obj.matchAll(/^usemtl (.+)$/gm)].map((m) => m[1]);
    const defined = new Set([...mtl.matchAll(/^newmtl (.+)$/gm)].map((m) => m[1]));
    expect(used.length).toBeGreaterThan(0);
    used.forEach((name) => expect(defined.has(name)).toBe(true));
  });

  it("bakes fixture translation into OBJ world vertices", () => {
    // The pump glyph is a cylinder around (-5,0.16,-5); its vertices must be near there.
    const obj = toOBJ(graph);
    const verts = [...obj.matchAll(/^v (\S+) (\S+) (\S+)$/gm)].map((m) => m.slice(1).map(Number));
    const nearPump = verts.filter((v) => Math.abs(v[0] + 5) < 0.5 && Math.abs(v[2] + 5) < 0.5);
    expect(nearPump.length).toBeGreaterThan(0);
  });
});

describe("USD", () => {
  it("emits USDA meshes + materials with translate ops", () => {
    const usd = toUSDA(buildSceneGraph(DESIGN));
    expect(usd.startsWith("#usda 1.0")).toBe(true);
    expect((usd.match(/def Mesh /g) || []).length).toBe(7);
    expect(usd).toContain('uniform token info:id = "UsdPreviewSurface"');
    expect(usd).toContain("xformOp:translate");
    // The geyser translate carries its plan position.
    expect(usd).toMatch(/xformOp:translate = \(1\.5000\d*, 0\.0000\d*, -2\.0000\d*\)/);
  });
});

describe("FBX", () => {
  it("emits ASCII FBX with objects + connections", () => {
    const fbx = toFBXASCII(buildSceneGraph(DESIGN));
    expect(fbx).toContain("FBXVersion: 7300");
    expect(fbx).toContain("Objects:  {");
    expect(fbx).toContain("Connections:  {");
    expect((fbx.match(/Geometry: \d+, "Geometry::/g) || []).length).toBe(7);
    expect((fbx.match(/Model: \d+, "Model::/g) || []).length).toBe(7);
    expect(fbx).toContain('P: "Lcl Translation"');
  });
});

describe("LUXEXCHANGE bridge", () => {
  it("wraps glTF + fixture manifest in a v1 envelope", () => {
    const env = toLuxExchange(buildSceneGraph(DESIGN));
    expect(env.platform).toBe("AquaFlow");
    expect(env.version).toBe("1.0");
    expect(env.payload_type).toBe("scene3d");
    expect(env.payload.gltf.asset.version).toBe("2.0");
    expect(env.payload.fixtures.length).toBe(5);
  });

  it("round-trips fixture positions + materials through parse-back (import path)", () => {
    const json = JSON.stringify(toLuxExchange(buildSceneGraph(DESIGN)));
    const env = JSON.parse(json);
    const byId = Object.fromEntries(env.payload.fixtures.map((f) => [f.id, f]));
    // Positions preserved exactly.
    expect(byId.nz1.position.x).toBeCloseTo(1.5, 6);
    expect(byId.nz1.position.z).toBeCloseTo(-2.0, 6);
    expect(byId.pmp1.position).toEqual({ x: -5, y: 0.16, z: -5 });
    // Materials preserved.
    expect(byId.nz1.material.baseColor.length).toBe(4);
    expect(byId.lt1.light).toBeTruthy();
    expect(byId.lt1.light.type).toBe("point");
  });
});

describe("exportScene orchestrator", () => {
  it("produces a downloadable payload for every advertised format", () => {
    EXPORT_FORMATS.forEach((fmt) => {
      const out = exportScene(DESIGN, fmt.id);
      expect(out.filename.endsWith(fmt.ext)).toBe(true);
      expect(out.stats.fixtureCount).toBe(5);
      if (fmt.binary) expect(out.data).toBeInstanceOf(Uint8Array);
      else expect(typeof out.data).toBe("string");
    });
  });

  it("emits an MTL companion alongside OBJ", () => {
    const out = exportScene(DESIGN, "obj");
    expect(out.companions.length).toBe(1);
    expect(out.companions[0].filename.endsWith(".mtl")).toBe(true);
  });

  it("throws on an unknown format", () => {
    expect(() => exportScene(DESIGN, "nope")).toThrow();
  });

  it("handles an empty design without throwing", () => {
    const out = exportScene({ fixtures: [] }, "gltf");
    const doc = JSON.parse(out.data);
    expect(doc.asset.version).toBe("2.0");
  });
});

// Transforms + engineering metadata + input hardening (folded in from the
// backend parallel implementation).
const RICH = {
  name: "Rich Fountain",
  poolGeometry: { poolType: "rectangular", params: { width: 10, length: 8, depth: 0.8 } },
  fixtures: [
    { id: "arch1", type: "arch_jet", x: 2, y: 1, rotation: 90, scale: 1.5, label: "Arch",
      protocol: "artnet", dmx: { universe: 3, channel: 12, channels: 4 },
      engineering: { flowLpm: 60, pressureBar: 2.5, powerKw: 1.1 }, groupId: "arch_jets" },
    { id: "bad1", type: "jet_3d", x: NaN, y: Infinity, label: "Bad Coords" },
  ],
};

describe("node transforms", () => {
  const graph = buildSceneGraph(RICH);
  const arch = graph.nodes.find((n) => n.fixtureId === "arch1");

  it("carries rotationY, scale and extras on the fixture node", () => {
    expect(arch.rotationY).toBe(90);
    expect(arch.scale).toEqual([1.5, 1.5, 1.5]);
    expect(arch.extras.dmx.universe).toBe(3);
    expect(arch.extras.engineering.flowLpm).toBe(60);
    expect(arch.extras.groupId).toBe("arch_jets");
  });

  it("hardens NaN/Infinity coordinates to 0", () => {
    const bad = graph.nodes.find((n) => n.fixtureId === "bad1");
    expect(bad.translation.every((v) => Number.isFinite(v))).toBe(true);
    expect(bad.translation[0]).toBe(0);
    expect(bad.translation[2]).toBe(0);
  });

  it("glTF emits a Y-rotation quaternion, scale and extras.aquaflow", () => {
    const doc = JSON.parse(toGLTF(graph));
    const node = doc.nodes.find((n) => n.name.startsWith("Arch"));
    // 90° about Y → quaternion (0, sin45, 0, cos45).
    expect(node.rotation[1]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(node.rotation[3]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(node.scale).toEqual([1.5, 1.5, 1.5]);
    expect(node.extras.aquaflow.dmx.channel).toBe(12);
    // No non-finite numbers anywhere in the document.
    expect(JSON.stringify(doc)).not.toMatch(/null,null|NaN|Infinity/);
  });

  it("USD lists rotateY + scale in the xformOpOrder", () => {
    const usd = toUSDA(graph);
    expect(usd).toMatch(/xformOp:rotateY = 90/);
    expect(usd).toContain('"xformOp:rotateY"');
    expect(usd).toContain('"xformOp:scale"');
    expect(usd).toContain('aquaflow:groupId = "arch_jets"');
  });

  it("FBX emits Lcl Rotation + Lcl Scaling", () => {
    const fbx = toFBXASCII(graph);
    expect(fbx).toContain('P: "Lcl Rotation", "Lcl Rotation", "", "A",0,90.000000,0');
    expect(fbx).toMatch(/P: "Lcl Scaling".*1\.500000,1\.500000,1\.500000/);
  });

  it("OBJ bakes rotation into world vertices (90° swaps X/Z extent)", () => {
    const obj = toOBJ(graph);
    // Arch glyph is a cone ~0.28 tall, radius ~0.09*1.5. After 90° about Y and
    // translate to (2,·,1), vertices cluster around x≈2, z≈1 and stay finite.
    const verts = [...obj.matchAll(/^v (\S+) (\S+) (\S+)$/gm)].map((m) => m.slice(1).map(Number));
    expect(verts.every((v) => v.every(Number.isFinite))).toBe(true);
    const nearArch = verts.filter((v) => Math.abs(v[0] - 2) < 0.5 && Math.abs(v[2] - 1) < 0.5);
    expect(nearArch.length).toBeGreaterThan(0);
  });

  it("LUXEXCHANGE manifest carries engineering identity + transforms", () => {
    const env = JSON.parse(JSON.stringify(toLuxExchange(graph)));
    const arch1 = env.payload.fixtures.find((f) => f.id === "arch1");
    expect(arch1.rotation.y).toBe(90);
    expect(arch1.scale.x).toBe(1.5);
    expect(arch1.engineering.dmx.universe).toBe(3);
    expect(arch1.engineering.engineering.pressureBar).toBe(2.5);
    expect(arch1.engineering.protocol).toBe("artnet");
  });
});
