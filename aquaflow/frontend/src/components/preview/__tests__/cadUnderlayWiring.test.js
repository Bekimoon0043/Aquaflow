import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { setCadUnderlay } from "../sceneBasin";

const underlay = (items) => ({ visible: true, layers: [{ name: "A-SITE", visible: true }], items });
const line = (layer, color, pts) => ({ kind: "polyline", layer, color, points: pts, closed: false });

describe("CAD underlay wiring (AF-CAD-011 → scene)", () => {
  it("adds, keeps on visibility-only change, rebuilds on items/centre change, clears on null", () => {
    const scene = { scene: new THREE.Scene() };
    const toWorld = p => ({ x: p.x - 10, z: p.y - 5 });
    const items = [line("A-SITE", "#ff0000", [10, 5, 12, 5]), line("B", "#00ff00", [0, 0, 1, 1])];
    const u = underlay(items);
    const g1 = setCadUnderlay(scene, u, { toWorld, centerKey: "10,5" });
    expect(g1.parent).toBe(scene.scene);
    expect(g1.children.length).toBe(2);              // one batch per layer/colour
    // Plan point (10,5) lands at world origin through the supplied transform.
    const pos = g1.children[0].geometry.attributes.position;
    expect([pos.getX(0), pos.getZ(0)]).toEqual([0, 0]);

    const g2 = setCadUnderlay(scene, { ...u, visible: false }, { toWorld, centerKey: "10,5" });
    expect(g2).toBe(g1);
    expect(g1.visible).toBe(false);

    const g3 = setCadUnderlay(scene, u, { toWorld, centerKey: "0,0" });
    expect(g3).not.toBe(g1);
    expect(g1.parent).toBeNull();

    expect(setCadUnderlay(scene, null)).toBeNull();
    expect(g3.parent).toBeNull();
    expect(scene._cadUnderlay).toBeNull();
  });
});
