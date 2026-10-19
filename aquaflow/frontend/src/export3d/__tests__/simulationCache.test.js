// Simulation cache: the preview's emitters + physics, replayed deterministically from the show.
import { describe, it, expect } from "vitest";
import {
  prepareSimulation, simulateFrames, voxelizeFrame, densityReference, encodeParticlePLY, exportSimulationCache, frameName, safeBaseName,
} from "../simulationCache";
import { createFullShowPreview } from "../../utils/fullShowPreview";
import { createICANPreviewPlan } from "../../utils/icanPatternPreview";

const jet = { id: "j1", type: "nozzle_straight_dn15", x: 4, y: -2, engineering: { jetHeightM: 3, flowLpm: 30, pressureBar: 1 } };

function maxHeight(prepared, opts) {
  let h = 0, xs = [], zs = [];
  for (const s of simulateFrames(prepared, opts)) {
    const { pos, count } = s.particles;
    for (let i = 0; i < count; i++) { h = Math.max(h, pos[i * 3 + 1]); xs.push(pos[i * 3]); zs.push(pos[i * 3 + 2]); }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
  return { h, x: mean(xs), z: mean(zs), n: xs.length };
}

describe("simulation cache", () => {
  it("draws a jet at its design height, at the fixture's plan position", () => {
    const r = maxHeight(prepareSimulation({ fixtures: [jet] }), { start: 0, end: 3, fps: 10 });
    // Nominal apex = design height; the preview's ±3 % speed jitter lifts the top droplets a little.
    expect(r.h).toBeGreaterThan(2.85);
    expect(r.h).toBeLessThan(3 * 1.15);
    expect(r.x).toBeCloseTo(4, 0);
    expect(r.z).toBeCloseTo(-2, 0);
  });

  it("follows the show: no water before the clip, water once it plays", () => {
    const clips = [{ id: "c", fixtureId: "j1", type: "device_intensity", startTime: 2, duration: 3, value: 100 }];
    const plan = createICANPreviewPlan(createFullShowPreview(clips, [jet]), 1);
    const counts = [...simulateFrames(prepareSimulation({ fixtures: [jet], plan }), { start: 0, end: 4, fps: 2 })]
      .map((s) => s.particles.count);
    expect(counts[0] + counts[1] + counts[2] + counts[3]).toBe(0);  // t = 0, 0.5, 1, 1.5
    expect(counts[8]).toBeGreaterThan(50);                          // t = 4
  });

  it("is deterministic for a seed", async () => {
    const run = async () => {
      const files = [];
      await exportSimulationCache({ fixtures: [jet], name: "Det", options: { start: 0, end: 1, fps: 5, ply: true },
        writer: { async write(n, b) { files.push([n, b]); } } });
      return files;
    };
    const [a, b] = [await run(), await run()];
    expect(a.map(([n]) => n)).toEqual(b.map(([n]) => n));
    a.filter(([n]) => !n.endsWith(".json")).forEach(([, bytes], i) => {
      // Skip the UUID (seeded too, but only the voxel payload matters here).
      expect(Buffer.from(bytes.subarray(60)).equals(Buffer.from(b[i][1].subarray(60)))).toBe(true);
    });
  });

  it("voxelises volume-conserving density and maps axes for Z-up tools", () => {
    const particles = { count: 2, pos: new Float32Array([0.01, 1, 0.02, 0.33, 2, -0.5]), vel: new Float32Array([0, 1, 0, 0, -1, 0]),
      vol: new Float32Array([1e-6, 2e-6]), cls: new Uint8Array(2) };
    const { grids } = voxelizeFrame(particles, { voxelSize: 0.1 });
    let sum = 0;
    for (const leaf of grids[0].leaves.values()) for (let n = 0; n < 512; n++) sum += leaf.values[n];
    expect(sum * 0.1 ** 3 * densityReference(0.1)).toBeCloseTo(3e-6, 12);
    // Z-up: the 2 m high particle lands at index z ≈ 20, depth -0.5 → y = +5.
    const z = voxelizeFrame(particles, { voxelSize: 0.1, axes: "zup_m" }).grids[0];
    expect(z.get(3, 5, 20)).toBeGreaterThan(0);
    const ue = voxelizeFrame(particles, { voxelSize: 0.1, axes: "unreal" });
    expect(ue.voxelSize).toBeCloseTo(10);           // centimetres
  });

  it("writes a PLY with one vertex per droplet, velocity and a VDB/PLY/JSON frame sequence", async () => {
    const particles = { count: 3, pos: new Float32Array(9), vel: new Float32Array(9), vol: new Float32Array(3), cls: new Uint8Array(3) };
    const head = new TextDecoder().decode(encodeParticlePLY(particles).subarray(0, 300));
    expect(head).toMatch(/element vertex 3/);
    expect(head).toMatch(/property float vx/);
    const names = [];
    const manifest = await exportSimulationCache({ fixtures: [jet], name: "Lebu Fountain · v2", options: { start: 0, end: 0.5, fps: 4, ply: true, velocity: true },
      writer: { async write(n) { names.push(n); } } });
    expect(names).toContain("Lebu_Fountain_v2.0001.vdb");
    expect(names).toContain("Lebu_Fountain_v2_particles.0003.ply");
    expect(names.at(-1)).toBe("Lebu_Fountain_v2_manifest.json");
    expect(manifest.frames).toBe(3);
    expect(manifest.files.grids).toEqual(["density", "vel"]);
    for (const n of names) expect(n).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}\.(vdb|ply|json)$/);
  });

  it("names frames for sequence detection", () => {
    expect(frameName("a", 7, "vdb")).toBe("a.0007.vdb");
    expect(safeBaseName("..//x")).toMatch(/^[A-Za-z0-9]/);
  });

  it("refuses an empty design", async () => {
    await expect(exportSimulationCache({ fixtures: [], name: "x", writer: { write() {} } })).rejects.toThrow(/no water nozzles/);
  });

  it("scales density so a jet's core reads about 1 at any voxel size", () => {
    expect(densityReference(0.05)).toBeCloseTo(Math.PI * 0.005 ** 2 / 0.0025, 9);
    expect(densityReference(0.005)).toBe(1);
    const r = maxDensity(prepareSimulation({ fixtures: [jet] }), 0.05);
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThanOrEqual(1);
  });
});

function maxDensity(prepared, voxelSize) {
  let m = 0;
  for (const s of simulateFrames(prepared, { start: 0, end: 2, fps: 2 })) {
    const g = voxelizeFrame(s.particles, { voxelSize }).grids[0];
    for (const leaf of g.leaves.values()) for (const v of leaf.values) m = Math.max(m, v);
  }
  return m;
}
