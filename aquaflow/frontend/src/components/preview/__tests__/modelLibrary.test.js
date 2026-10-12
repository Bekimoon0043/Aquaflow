import { describe, expect, it } from "vitest";
import { BUILTIN_MODELS, defaultVenueModels, validateGlb } from "../modelLibrary";
import { venueLayout } from "../venueModels";

function glb(json) {
  const bytes = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(bytes.length / 4) * 4;
  const buffer = new ArrayBuffer(20 + padded);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buffer, 20).fill(0x20);
  new Uint8Array(buffer, 20).set(bytes);
  return buffer;
}

describe("3D venue model library", () => {
  it("ships placeable people, buildings and textured landscaping with stable asset IDs", () => {
    expect(BUILTIN_MODELS.some(model => model.category === "People")).toBe(true);
    expect(BUILTIN_MODELS.some(model => model.category === "Buildings")).toBe(true);
    expect(BUILTIN_MODELS.filter(model => model.category === "Landscaping")).toHaveLength(3);
    expect(new Set(BUILTIN_MODELS.map(model => model.id)).size).toBe(BUILTIN_MODELS.length);
  });

  it("places default models beyond the pool and gives each an editable node", () => {
    const pool = { poolType: "circular", radius: 7 };
    const nodes = defaultVenueModels(pool, "medium");
    const layout = venueLayout(pool);
    expect(nodes.length).toBeGreaterThan(15);
    expect(nodes.filter(node => node.id.startsWith("venue-tree-"))).toHaveLength(20);
    expect(new Set(nodes.map(node => node.id)).size).toBe(nodes.length);
    for (const node of nodes) {
      expect(Math.hypot(node.position.x, node.position.z)).toBeGreaterThan(layout.stage);
      expect(node.props.assetId).toBeTruthy();
      expect(node.type).toBe("model");
    }
  });

  it("accepts a self-contained glTF 2.0 GLB and rejects external dependencies", () => {
    expect(validateGlb(glb({ asset: { version: "2.0" }, buffers: [{}], images: [{ bufferView: 0 }] })).asset.version).toBe("2.0");
    expect(() => validateGlb(glb({ asset: { version: "2.0" }, images: [{ uri: "textures/albedo.png" }] })))
      .toThrow(/self-contained/i);
    expect(() => validateGlb(new ArrayBuffer(32))).toThrow(/valid glTF/i);
  });
});
