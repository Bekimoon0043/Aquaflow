import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  createBasinMask, basinMaskForPool, basinsFromEngineering, basinsFromPool,
  circleToPolygon, pointInRing, clipGeometryToMask as clipGeometryToMaskSync,
} from "../basinMask";
import { centeredPoolPoints, poolPolygonBounds } from "../basinGeometry";
import { insidePool } from "../splashMap";
import { WaterHeightField } from "../waterHeightField";
import { applyPoolUniforms } from "../particlesGPU";

// An L: a 10 x 10 square with its +x/+z quadrant (5..10, 5..10) removed, centred.
const L_RAW = [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }, { x: 0, y: 10 },
];
const L_CENTRED = centeredPoolPoints(L_RAW);            // spans -5..5 in both axes
const lMask = () => basinMaskForPool({ type: "freeform", points: L_CENTRED });

describe("basinMask — polygon basins (AF-3D-017)", () => {
  it("rejects points in the notch of an L that the bounding rectangle would accept", () => {
    const mask = lMask();
    expect(mask.kind).toBe("polygon");
    expect(mask.contains(-2.5, -2.5)).toBe(true);     // in the long leg
    expect(mask.contains(2.5, -2.5)).toBe(true);
    expect(mask.contains(-2.5, 2.5)).toBe(true);
    expect(mask.contains(2.5, 2.5)).toBe(false);      // the notch — deck, not water
    expect(mask.contains(4.9, 4.9)).toBe(false);
    expect(mask.contains(6, 0)).toBe(false);          // outside everything
    // The old rectangle test would have called the notch water.
    expect(insidePool(2.5, 2.5, { type: "rect", width: 10, length: 10 })).toBe(true);
  });

  it("zero simulated impacts in the notch count as contained", () => {
    const pool = { type: "polygon", mask: lMask(), width: 10, length: 10 };
    let contained = 0;
    for (let i = 0; i < 2000; i++) {
      // Deterministic scatter across the notch only.
      const x = 0.05 + ((i * 0.6180339) % 1) * 4.9, z = 0.05 + ((i * 0.7548776) % 1) * 4.9;
      if (insidePool(x, z, pool)) contained++;
    }
    expect(contained).toBe(0);
  });

  it("rejects an island hole", () => {
    const mask = createBasinMask([{
      outer: [[-5, -5], [5, -5], [5, 5], [-5, 5]],
      holes: [[[-1, -1], [1, -1], [1, 1], [-1, 1]]],
    }]);
    expect(mask.contains(0, 0)).toBe(false);
    expect(mask.contains(0.9, -0.9)).toBe(false);
    expect(mask.contains(3, 3)).toBe(true);
    expect(mask.sample(0, 0)).toBe(0);
    expect(mask.sample(3, 3)).toBe(1);
  });

  it("supports several basins at once", () => {
    const mask = createBasinMask([
      { outer: [[-10, -1], [-6, -1], [-6, 1], [-10, 1]] },
      { outer: [[6, -1], [10, -1], [10, 1], [6, 1]] },
    ]);
    expect(mask.contains(-8, 0)).toBe(true);
    expect(mask.contains(8, 0)).toBe(true);
    expect(mask.contains(0, 0)).toBe(false);
    expect(mask.bounds.width).toBeCloseTo(20, 9);
  });

  it("raster texels agree with the exact test at their centres", () => {
    const mask = lMask();
    let mismatches = 0;
    for (let j = 0; j < mask.height; j++) {
      for (let i = 0; i < mask.width; i++) {
        const x = mask.origin[0] + (i + 0.5) * mask.cell;
        const z = mask.origin[1] + (j + 0.5) * mask.cell;
        if ((mask.sample(x, z) > 0.5) !== mask.contains(x, z)) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
    expect(mask.insideTexels).toBeGreaterThan(0);
  });

  it("uses exactly the centring of centeredPoolPoints (offset 0)", () => {
    const raw = L_RAW.map(p => ({ x: p.x + 37.25, y: p.y - 12.5 }));   // off-origin CAD coords
    const basins = basinsFromEngineering([{ outer: raw }]);
    const expected = centeredPoolPoints(raw);
    expect(basins[0].outer.length).toBe(expected.length);
    basins[0].outer.forEach(([x, z], i) => {
      expect(x - expected[i].x).toBe(0);
      expect(z - expected[i].y).toBe(0);
    });
    const mask = createBasinMask(basins);
    const b = poolPolygonBounds(expected);
    expect(mask.bounds.minX - b.minX).toBe(0);
    expect(mask.bounds.maxX - b.maxX).toBe(0);
    expect(mask.bounds.minZ - b.minY).toBe(0);
    expect(mask.bounds.maxZ - b.maxY).toBe(0);
    // And the scene's own path (already-centred points) builds the same mask.
    const scenePath = basinMaskForPool({ type: "freeform", points: expected });
    expect(Array.from(scenePath.data)).toEqual(Array.from(mask.data));
  });

  it("holes shift with the same centring offset as the outer ring", () => {
    const basins = basinsFromEngineering([{
      outer: [[100, 100], [110, 100], [110, 110], [100, 110]],
      holes: [[[104, 104], [106, 104], [106, 106], [104, 106]]],
    }]);
    expect(basins[0].holes[0][0]).toEqual([-1, -1]);
  });
});

describe("basinMask — circular / rectangular fast paths are unchanged", () => {
  const oldInside = (x, z, pool) => {
    if (pool.type === "circular") { const r = pool.radius || 0; return x * x + z * z <= r * r; }
    return Math.abs(x) <= (pool.width || 0) / 2 && Math.abs(z) <= (pool.length || 0) / 2;
  };

  it("circle containment is identical to the pre-mask test", () => {
    const mask = basinMaskForPool({ type: "circular", radius: 6 });
    expect(mask.kind).toBe("circular");
    for (let x = -7; x <= 7; x += 0.173) {
      for (let z = -7; z <= 7; z += 0.191) {
        expect(mask.contains(x, z)).toBe(oldInside(x, z, { type: "circular", radius: 6 }));
      }
    }
  });

  it("rectangle containment is identical to the pre-mask test", () => {
    const mask = basinMaskForPool({ type: "rect", width: 12, length: 8 });
    expect(mask.kind).toBe("rect");
    for (let x = -7; x <= 7; x += 0.173) {
      for (let z = -5; z <= 5; z += 0.191) {
        expect(mask.contains(x, z)).toBe(oldInside(x, z, { type: "rect", width: 12, length: 8 }));
      }
    }
  });

  it("splashMap.insidePool keeps its circle/rect answers", () => {
    expect(insidePool(4, 4, { type: "circular", radius: 5 })).toBe(false);
    expect(insidePool(4.9, 2.9, { type: "rect", width: 10, length: 6 })).toBe(true);
  });

  it("circular and rectangular pools convert to polygons for the generic view", () => {
    expect(basinsFromPool({ type: "circular", radius: 2 })[0].outer.length).toBe(64);
    expect(basinsFromPool({ type: "rectangular", width: 4, length: 2 })[0].outer)
      .toEqual([[-2, -1], [2, -1], [2, 1], [-2, 1]]);
    const ring = circleToPolygon(3, 32);
    expect(pointInRing(0, 0, ring)).toBe(true);
    expect(pointInRing(3.1, 0, ring)).toBe(false);
  });
});

describe("basinMask consumers", () => {
  it("the heightfield masks out the notch, so ripple energy there stays 0", () => {
    const hf = new WaterHeightField({ extent: 16, resolution: 64 });
    hf.setPool({ type: "polygon", mask: lMask(), width: 10, length: 10 });
    expect(hf.disturb(2.5, 2.5, 0.06, 0.2)).toBe(false);
    expect(hf.energy()).toBe(0);
    expect(hf.disturb(-2.5, -2.5, 0.06, 0.2)).toBe(true);
    for (let i = 0; i < 120; i++) hf.advance(1 / 60);
    // Waves propagate inside the polygon but never into the notch cells.
    const g = hf._grid(2.5, 2.5);
    expect(hf.height[Math.round(g.z) * hf.resolution + Math.round(g.x)]).toBe(0);
  });

  it("GPU uniforms: circle/rect fast paths, polygon switches to the mask", () => {
    const u = {
      uPool: { value: new THREE.Vector4() },
      uPoolMask: { value: null },
      uPoolMaskBounds: { value: new THREE.Vector4() },
    };
    applyPoolUniforms(u, { type: "circular", radius: 6 }, THREE);
    expect(u.uPool.value.toArray()).toEqual([1, 6, 12, 8]);
    applyPoolUniforms(u, { type: "rect", width: 14, length: 9 }, THREE);
    expect(u.uPool.value.toArray()).toEqual([0, 6, 14, 9]);
    const mask = lMask();
    applyPoolUniforms(u, { type: "polygon", mask, width: 10, length: 10 }, THREE);
    expect(u.uPool.value.x).toBe(2);
    expect(u.uPoolMask.value.isDataTexture).toBe(true);
    const [ox, oz, ix, iz] = u.uPoolMaskBounds.value.toArray();
    // The shader's uv for a world point must land on the texel the CPU samples.
    const uvx = (2.5 - ox) * ix, uvz = (2.5 - oz) * iz;
    const ti = Math.floor(uvx * mask.width), tj = Math.floor(uvz * mask.height);
    expect(mask.data[(tj * mask.width + ti) * 4]).toBe(0);
    const uvx2 = (-2.5 - ox) * ix, uvz2 = (-2.5 - oz) * iz;
    const ti2 = Math.floor(uvx2 * mask.width), tj2 = Math.floor(uvz2 * mask.height);
    expect(mask.data[(tj2 * mask.width + ti2) * 4]).toBe(255);
  });
});

describe("islands from engineering geometry (AF-CAD-013 holes)", () => {
  // Imported lazily so the module graph stays the scene's own.
  it("centredPoolHoles + basinMaskForPool reject the island; water mesh is cut there", async () => {
    const { centeredPoolHoles, polygonWaterGeometry } = await import("../basinGeometry");
    const { clipGeometryToMask } = await import("../basinMask");
    const outerRaw = [{ x: 100, y: 100 }, { x: 110, y: 100 }, { x: 110, y: 110 }, { x: 100, y: 110 }];
    const holesRaw = [[{ x: 104, y: 104 }, { x: 106, y: 104 }, { x: 106, y: 106 }, { x: 104, y: 106 }]];
    const outer = centeredPoolPoints(outerRaw);
    const holes = centeredPoolHoles(outerRaw, holesRaw);
    const mask = basinMaskForPool({ type: "freeform", points: outer, holes });
    expect(mask.contains(0, 0)).toBe(false);          // island
    expect(mask.contains(3, 3)).toBe(true);           // water
    expect(insidePool(0, 0, { type: "polygon", mask })).toBe(false);

    const geo = polygonWaterGeometry(THREE, outer, 40);
    const before = geo.index.count;
    clipGeometryToMask(geo, mask);
    expect(geo.index.count).toBeLessThan(before);
    // No remaining triangle centroid lies on the island.
    const pos = geo.attributes.position, idx = geo.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const x = (pos.getX(idx[t]) + pos.getX(idx[t + 1]) + pos.getX(idx[t + 2])) / 3;
      const z = -(pos.getY(idx[t]) + pos.getY(idx[t + 1]) + pos.getY(idx[t + 2])) / 3;
      expect(mask.contains(x, z)).toBe(true);
    }
  });

  it("a mask without holes leaves the water mesh untouched", () => {
    const mask = lMask();
    const geo = { index: { array: [0, 1, 2] }, setIndex() { throw new Error("should not clip"); } };
    expect(clipGeometryToMaskSync(geo, mask)).toBe(geo);
  });

  it("basin levels default to the historical heights and honour floorLevel/wallHeight", async () => {
    const { basinLevels } = await import("../sceneBasin");
    expect(basinLevels({})).toMatchObject({ floorY: -0.45, wallHeight: 0.9, wallCenterY: 0, copingY: 0.46 });
    const deep = basinLevels({ floorLevel: -1.2, wallHeight: 1.5 });
    expect(deep.floorY).toBe(-1.2);
    expect(deep.wallCenterY).toBeCloseTo(-0.45, 9);
    expect(deep.copingY).toBeCloseTo(0.31, 9);
    expect(basinLevels({ floorLevel: 0.5 }).floorY).toBe(-0.45);   // above the water: ignored
  });
});
