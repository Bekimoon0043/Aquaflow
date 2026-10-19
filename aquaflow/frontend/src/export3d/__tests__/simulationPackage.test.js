// The whole-simulation package: Alembic + FBX for D5 / Max / Maya / C4D / Unreal, the Blender
// scene builder (lights, pool, VDB with Cd), light merging and RGB colour on the water.
import { describe, it, expect } from "vitest";
import { exportSimulationCache, mergeLights, MAX_BLENDER_LIGHTS } from "../simulationCache";
import { createLightRig, hexToLinear } from "../sceneLights";
import { buildBlenderScript } from "../blenderScene";
import { createZipWriter } from "../../components/preview/finalRender";
import { createFullShowPreview } from "../../utils/fullShowPreview";
import { createICANPreviewPlan } from "../../utils/icanPatternPreview";

const jet = { id: "j1", type: "nozzle_straight_dn15", x: 0, y: 0, engineering: { jetHeightM: 2, flowLpm: 30, pressureBar: 1 } };
const light = { id: "L1", type: "light_rgb_underwater_18w", x: 0, y: 0.3, engineering: { wattage: 18, beamAngleDeg: 30 } };
const design = { name: "T", fixtures: [jet, light], poolGeometry: { poolType: "rectangular", params: { width: 6, length: 4, depth: 0.6 }, geometry: null } };

function memWriter() {
  const files = new Map();
  return {
    files, where: "C:\\out",
    async write(n, b) { files.set(n, b.slice()); },
    async append(n, b) { const old = files.get(n) || new Uint8Array(0); const all = new Uint8Array(old.length + b.length); all.set(old); all.set(b, old.length); files.set(n, all); },
    async patch(n, at, b) { files.get(n).set(b, at); },
  };
}

describe("RGB light on the water", () => {
  it("lights the droplets above a red fixture red", () => {
    const rig = createLightRig([{ id: "L1", x: 0, y: 0, z: 0, color: "#ff0000", intensity: 1, radius: 4 }], []);
    const particles = { count: 2, pos: new Float32Array([0, 1, 0, 30, 1, 0]) };
    const c = rig.particleColors(particles, rig.statesFrom((id) => ({ intensity: 1, color: "#ff0000" })));
    expect(c[0]).toBeGreaterThan(0.1);
    expect(c[1]).toBe(0); expect(c[2]).toBe(0);
    expect(c[3] + c[4] + c[5]).toBe(0);                 // out of reach
    expect(hexToLinear("#808080")[0]).toBeCloseTo(0.2159, 3);
  });
});

describe("export package", () => {
  it("writes the Alembic water, the FBX scene, the Blender builder and lights", async () => {
    const clips = [{ id: "c", fixtureId: "j1", type: "device_intensity", startTime: 0, duration: 2, value: 100 },
      { id: "l", fixtureId: "L1", type: "lighting_master", startTime: 0, duration: 2, value: 100, color: "#00ff00" }];
    const plan = createICANPreviewPlan(createFullShowPreview(clips, design.fixtures, "T", { skipUnsupported: true }), 1);
    const w = memWriter();
    const m = await exportSimulationCache({ fixtures: design.fixtures, plan, design, name: "Test Show", writer: w,
      options: { start: 0.5, end: 1, fps: 10, alembic: true, vdb: true, blenderScene: true } });
    const names = [...w.files.keys()];
    expect(names).toEqual(expect.arrayContaining(["Test_Show_water.abc", "Test_Show_scene.fbx", "Test_Show_scene.glb",
      "Test_Show_lights.json", "Test_Show_blender_scene.py", "Test_Show.0001.vdb", "Test_Show_manifest.json"]));
    const abc = w.files.get("Test_Show_water.abc");
    expect(new TextDecoder().decode(abc.subarray(0, 5))).toBe("Ogawa");
    expect(abc[5]).toBe(0xff);
    expect(m.stats.maxTriangles).toBeGreaterThan(20);
    const lights = JSON.parse(new TextDecoder().decode(w.files.get("Test_Show_lights.json")));
    expect(lights.lights).toHaveLength(1);
    expect(lights.lights[0].keys[0].slice(1, 4)).toEqual([0, 1, 0]);   // green, linear
    expect(lights.lights[0].dir[2]).toBeCloseTo(1);                     // aimed up in Z-up
    const py = new TextDecoder().decode(w.files.get("Test_Show_blender_scene.py"));
    expect(py).toMatch(/BASE = "Test_Show"/);
    expect(py).toMatch(/ABC_NAME = "Test_Show_water.abc"/);
    expect(m.files.grids).toEqual(["density", "Cd"]);
  });

  it("merges only fixtures that play the same track, down to Blender's light budget", () => {
    const mk = (i, track) => ({ id: `L${i}`, pos: [i, 0, 0], dir: [0, 0, 1], beamDeg: 30, wattage: 18, count: 1,
      keys: [[1, track, 0, 0, 1]] });
    const many = Array.from({ length: 150 }, (_, i) => mk(i, i < 100 ? 1 : 0.5));
    const out = mergeLights(many);
    expect(out).toHaveLength(MAX_BLENDER_LIGHTS);
    expect(out.reduce((s, l) => s + l.count, 0)).toBe(150);
    for (const l of out) expect(new Set(l.id.split("+").map((id) => Number(id.slice(1)) < 100)).size).toBe(1);
    const unique = Array.from({ length: 130 }, (_, i) => mk(i, i / 1000));
    expect(mergeLights(unique)).toHaveLength(130);       // nothing safe to merge
  });

  it("the Blender script is self-locating and switches to Cycles past EEVEE's light limit", () => {
    const py = buildBlenderScript({ base: "A", exportDir: "C:/x", fps: 24, frames: 10 });
    expect(py).toMatch(/def find_dir\(\)/);
    expect(py).toMatch(/'CYCLES'/);
    expect(py).toMatch(/save_as_mainfile/);
  });

  it("the browser ZIP writer streams an appended + patched file", async () => {
    const z = createZipWriter({ createZip: (entries) => entries, name: "x" });
    await z.write("a.abc", new Uint8Array(0));
    await z.append("a.abc", new Uint8Array([1, 2, 3]));
    await z.append("a.abc", new Uint8Array([4]));
    await z.patch("a.abc", 1, new Uint8Array([9]));
    await z.write("b.json", new Uint8Array([7]));
    const blob = await z.finish();
    expect(blob).toBeInstanceOf(Blob);
  });
});
