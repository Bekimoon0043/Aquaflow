/**
 * Elevated, aimed nozzles and steel frames (elevatedNozzles.js + nozzleEmitters.js).
 * Headless: the descriptors are what the GPU field uploads and the CPU field samples.
 */
import { describe, it, expect } from "vitest";
import {
  aimDirection, aimOf, fanAxis, mountHeightOf, catchHeightOf, solveReachSpeed, flyAlongAim,
  reachTime, SAG_FRACTION, sphereDirection, sphereRadiusOf, sphereCoverageCos, parseFrameTubes,
  tubeSegments, autoSupportSegments, isSteelFrameType, aimDegOfVector,
} from "../elevatedNozzles";
import {
  describeNozzleEmitters, sampleEmitterParticle, spawnDesignNozzle, EMIT_MODE, EMIT_CLASS,
} from "../nozzleEmitters";
import { RENDER_PHYSICS, speedForApex, simulateFlight, fallTime, SOLVER_DT } from "../designTrajectory";
import { fixturesToNozzleConfigs, classifyFixtureType, resolveFixtureType } from "../../../hooks/fixtureTypeMap";
import { jetLanding, testLanding } from "../../../engineering/splashEnvelope";
import { footprint, travelTime, riseTime } from "../waterPhysics";
import { getFixtureInfo } from "../../../utils/fixtureTypeResolver";
import { generateAutoTracks } from "../../../runtime/autoTrackGenerator";

const W = RENDER_PHYSICS.water;
const WIND = { x: 0, z: 0 };
const TINT = { r: 0.55, g: 0.8, b: 1.0 };
const emit = (cfg, ix = 1) => describeNozzleEmitters(cfg, ix, 0, WIND, TINT, null);
const near = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(tol);
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };

describe("aim math", () => {
  it("0 up, 90 horizontal along the azimuth, 135 down-outward, 180 straight down", () => {
    const up = aimDirection(0, 0), hz = aimDirection(90, 0), d135 = aimDirection(135, 0), down = aimDirection(180, 0);
    near(up[1], 1); near(up[0], 0);
    near(hz[0], 1); near(hz[1], 0, 1e-12);
    near(d135[0], Math.SQRT1_2); near(d135[1], -Math.SQRT1_2);
    near(down[1], -1); near(Math.hypot(down[0], down[2]), 0, 1e-12);
  });
  it("azimuth: 0 = +x, 90 = +plan y (world +z), 180 = -x", () => {
    near(aimDirection(90, 90)[2], 1);
    near(aimDirection(135, 180)[0], -Math.SQRT1_2);
    near(aimDirection(135, 180)[1], -Math.SQRT1_2);
  });
  it("reads engineering fields first, then the fixture; absent aim → null", () => {
    expect(aimOf({ type: "jet_3d" })).toBeNull();
    const a = aimOf({ engineering: { aimDeg: 135, aimAzimuthDeg: 180 } });
    expect(a.aimDeg).toBe(135); expect(a.azimuthDeg).toBe(180);
    expect(aimOf({ aimDeg: 90, rotation: 90 }).azimuthDeg).toBe(90);
    expect(aimDegOfVector([0, -1, 0])).toBeCloseTo(180, 9);
  });
  it("mount and catch heights", () => {
    expect(mountHeightOf({})).toBe(0);
    expect(mountHeightOf({ engineering: { mountHeightM: 6.3 } })).toBe(6.3);
    expect(catchHeightOf({ engineering: { mountHeightM: 3.9, catchAtM: 2.9 } })).toBe(2.9);
    expect(catchHeightOf({ engineering: { mountHeightM: 2, catchAtM: 2.9 } })).toBeNull();   // above the mount
  });
});

describe("reach along the aim, under gravity", () => {
  it("aim 0: the reach is the drawn apex (identical to the design-height rule)", () => {
    const v = solveReachSpeed(4, 0, W);
    expect(Math.abs(v / speedForApex(4, Math.PI / 2, W) - 1)).toBeLessThan(0.01);
  });
  it("aim 90: reaches R horizontally with at most SAG_FRACTION·R of drop", () => {
    const R = 3, v = solveReachSpeed(R, 90, W);
    const r = flyAlongAim(v, Math.PI / 2, R, W);
    expect(r.reached).toBe(true);
    expect(r.sag).toBeLessThanOrEqual(SAG_FRACTION * R + 1e-6);
    // ...and only just: 10 % slower and it sags past the limit.
    expect(flyAlongAim(v * 0.9, Math.PI / 2, R, W).sag).toBeGreaterThan(SAG_FRACTION * R);
  });
  it("aim 180: gravity helps — the floor speed keeps the column coherent", () => {
    const v = solveReachSpeed(2, 180, W);
    near(v, 0.5 * Math.sqrt(2 * W.gravity * 2), 1e-9);
    expect(reachTime(v, 180, 2, W)).toBeLessThan(2 / v);   // accelerating
  });
  it("speed ordering: up ≥ horizontal-ish ≥ down", () => {
    const up = solveReachSpeed(3, 0, W), h = solveReachSpeed(3, 90, W), dn = solveReachSpeed(3, 180, W);
    expect(dn).toBeLessThan(h);
    expect(dn).toBeLessThan(up);
  });
});

describe("fall time from height", () => {
  it("simulateFlight with a drop lands below the launch point", () => {
    const f0 = simulateFlight(0, 5, W), f6 = simulateFlight(0, 5, W, SOLVER_DT, 6);
    expect(f6.tLand).toBeGreaterThan(f0.tLand);
    near(f6.apex, f0.apex, 1e-9);
    // Dropped from rest: the same as fallTime.
    expect(Math.abs(simulateFlight(0, 0, W, SOLVER_DT, 5).tLand - fallTime(5, 0, W))).toBeLessThan(0.03);
  });
  it("no drop = exactly the old flight", () => {
    expect(simulateFlight(1, 6, W, SOLVER_DT, 0)).toEqual(simulateFlight(1, 6, W));
  });
});

describe("descriptors start at the mount", () => {
  for (const type of ["jet_3d", "fan_jet", "mist", "ring", "screen", "geyser", "laminar", "sphere"]) {
    it(`${type}: every emitter origin is lifted by mountHeightM`, () => {
      const flat = emit({ type, x: 1, z: 2 });
      const up = emit({ type, x: 1, z: 2, engineering: { mountHeightM: 6.3 } });
      expect(up.length).toBe(flat.length);
      up.forEach((e, i) => near(e.oy, flat[i].oy + 6.3, 1e-9));
    });
  }
  it("lives grow by the extra fall (cones) and the shader's extraLife (legacy fan)", () => {
    const [jet] = emit({ type: "jet_1d", engineering: { mountHeightM: 6 } });
    const [jet0] = emit({ type: "jet_1d" });
    expect(jet.life).toBeGreaterThan(jet0.life + 0.5);
    const [fan] = emit({ type: "fan_jet", engineering: { mountHeightM: 6 } });
    expect(fan.mode).toBe(EMIT_MODE.FAN);
    expect(fan.extraLife).toBeGreaterThan(0.5);
  });
  it("an elevated cascade is released at the lip and falls the mount height", () => {
    const [c] = emit({ type: "cascade", designHeightM: 2, engineering: { jetHeightM: 2, mountHeightM: 4 } });
    near(c.oy, 4.08, 1e-9);
    expect(c.life).toBeGreaterThan(fallTime(4, c.speed * 0.6, W));
  });
  it("CPU samples start at the mount", () => {
    const [e] = emit({ type: "jet_3d", engineering: { mountHeightM: 5 } });
    const p = sampleEmitterParticle(e, seq([0.5]));
    near(p.y, 5.08, 1e-9);
  });
});

describe("aimed jets and fans", () => {
  it("a jet aimed 90° fires horizontally along the azimuth at the reach speed", () => {
    const cfg = { type: "jet_1d", x: 0, z: 0, engineering: { aimDeg: 90, aimAzimuthDeg: 0, reachM: 2, mountHeightM: 3 } };
    const [e] = emit(cfg);
    near(e.dx, 1, 1e-9); near(e.dy, 0, 1e-9);
    expect(Math.abs(e.speed / solveReachSpeed(2, 90, W) - 1)).toBeLessThan(1e-9);
  });
  it("aim wins over tiltX/tiltZ", () => {
    const [e] = emit({ type: "jet_2d", tiltX: 30, engineering: { aimDeg: 180 } });
    near(e.dy, -1, 1e-9);
  });
  it("a fan aimed 135° sweeps a downward-outward triangle around its aim in the aim's plane", () => {
    const cfg = { type: "fan_jet", x: 0, z: 0, engineering: { aimDeg: 135, aimAzimuthDeg: 0, fanAngleDeg: 30, reachM: 1.5, mountHeightM: 6 } };
    const [sheet, drops] = emit(cfg);
    expect(sheet.mode).toBe(EMIT_MODE.AIM_FAN);
    near(sheet.p2 - sheet.p1, 30 * Math.PI / 180, 1e-9);
    // Sample both edges and the centre: all in the x–height plane, all heading out and down.
    for (const r of [0, 0.5, 0.999]) {
      const p = sampleEmitterParticle({ ...sheet, spread: 0, speedJitter: 0 }, seq([r, 0.5, 0.5, 0.5, 0.5, 0.5]));
      near(p.vz, 0, 1e-9);
      expect(p.vx).toBeGreaterThan(0);
      expect(p.vy).toBeLessThan(0);
      const ang = aimDegOfVector([p.vx, p.vy, p.vz]);
      expect(ang).toBeGreaterThan(135 - 15 - 1e-6);
      expect(ang).toBeLessThan(135 + 15 + 1e-6);
    }
    // The sheet breaks up at the reach; the droplet layer flies on to the water.
    expect(drops.mode).toBe(EMIT_MODE.AIM_FAN);
    expect(drops.life).toBeGreaterThan(sheet.life);
  });
  it("a fan aimed 180° in the 'aim' plane opens a downward triangle; 'cross' opens across", () => {
    const u = fanAxis(180, 0, "aim");
    near(u[0], -1, 1e-9); near(u[1], 0, 1e-9);
    const c = fanAxis(90, 0, "cross");
    near(c[2], 1, 1e-9); near(c[1], 0, 1e-9);
    const [s] = emit({ type: "fan_jet", engineering: { aimDeg: 90, fanPlane: "cross", fanAngleDeg: 60 } });
    near(s.uy, 0, 1e-9);
  });
});

describe("crystal ball / dandelion", () => {
  it("dandelion products render as spheres", () => {
    expect(resolveFixtureType("nozzle_dandelion_2in_longxin").nozzleType).toBe("sphere");
    const cfg = fixturesToNozzleConfigs([{ id: "d", type: "nozzle_dandelion_2in_longxin", x: 0, y: 0,
      engineering: { jetHeightM: 1.8 } }]).nozzleConfigs[0];
    expect(cfg.type).toBe("sphere");
    const [streams, rim] = emit(cfg);
    expect(streams.mode).toBe(EMIT_MODE.SPHERE);
    expect(rim.mode).toBe(EMIT_MODE.SPHERE);
    expect(rim.aux).toBe(1);
    near(streams.p2, 0.9, 1e-9);   // radius = height / 2 at full level
  });
  it("radius from sphereRadiusM, default coverage 300° leaves the stem open", () => {
    expect(sphereRadiusOf({ engineering: { sphereRadiusM: 0.7 } })).toBe(0.7);
    near(sphereCoverageCos({}), Math.cos(150 * Math.PI / 180), 1e-12);
  });
  it("directions cover the cap, never the stem cone, and streams end at the radius", () => {
    const cov = sphereCoverageCos({});
    let minY = 1, maxY = -1;
    for (let i = 0; i < 400; i++) {
      const d = sphereDirection((i % 20) / 20, Math.floor(i / 20) / 20, cov);
      near(Math.hypot(...d), 1, 1e-9);
      minY = Math.min(minY, d[1]); maxY = Math.max(maxY, d[1]);
    }
    expect(minY).toBeGreaterThanOrEqual(cov - 1e-9);
    expect(maxY).toBeCloseTo(1, 6);
    const [s, rim] = emit({ type: "sphere", engineering: { sphereRadiusM: 0.6, mountHeightM: 5 } });
    near(s.life * s.speed, 0.6, 1e-6);   // the stream reaches the rim, then ends
    const p = sampleEmitterParticle(rim, seq([0.5, 0.25, 0.5, 0.5, 0.5, 0.5]));
    near(Math.hypot(p.x - rim.ox, p.y - rim.oy, p.z - rim.oz), 0.6, 1e-9);   // released at the rim
    expect(rim.life).toBeGreaterThan(fallTime(5, 0, W));   // falls to the water
  });
});

describe("catch tray", () => {
  it("lives end at the tray and the foam goes to the tray, not the basin", () => {
    const cfg = { type: "fan_jet", x: 0, z: 0, engineering: { aimDeg: 180, mountHeightM: 3.9, catchAtM: 2.9, fanAngleDeg: 40 } };
    const descs = emit(cfg);
    for (const e of descs) expect(e.catchY).toBe(2.9);
    const free = emit({ ...cfg, engineering: { ...cfg.engineering, catchAtM: undefined } });
    expect(descs[0].life).toBeLessThan(free[0].life);
    let foamY = null;
    const nz = { config: cfg, intensity: 1, _launchSpeed: (d, f) => f, waterSys: null, spraySys: null,
      _spawnImpactFoam: (x, z, ix, y) => { foamY = y; } };
    const r = Math.random; Math.random = () => 0;
    try { expect(spawnDesignNozzle(nz, 1 / 60, 0, WIND, TINT)).toBe(true); } finally { Math.random = r; }
    near(foamY, 2.93, 1e-9);
  });
  it("splash envelope: a caught nozzle never lands outside; an elevated one throws further", () => {
    const water = { empty: false, contains: () => false, edgeDistance: () => 1 };
    const caught = jetLanding({ x: 0, y: 0, heightM: 2, mountHeightM: 3.9, catchAtM: 2.9 }, null);
    expect(testLanding(caught, water).outside).toBe(false);
    const low = jetLanding({ x: 0, y: 0, heightM: 2, tiltX: 20 }, null, { nozzleUncertainty: 0 });
    const high = jetLanding({ x: 0, y: 0, heightM: 2, tiltX: 20, mountHeightM: 6 }, null, { nozzleUncertainty: 0 });
    expect(high.throwM).toBeGreaterThan(low.throwM);
    const aimed = jetLanding({ x: 0, y: 0, heightM: 2, aimDeg: 90, aimAzimuthDeg: 180, mountHeightM: 6 }, null, { nozzleUncertainty: 0 });
    expect(aimed.center.x).toBeLessThan(-2);
    expect(footprint({ x: 0, y: 0, heightM: 2, mountHeightM: 3.9, catchAtM: 2.9 })).toEqual([]);
  });
  it("site-sync travel time: upright = rise time; aimed down is quicker than up", () => {
    expect(travelTime(5)).toBe(riseTime(5));
    expect(travelTime(5, { aimDeg: 180 })).toBeLessThan(travelTime(5, { aimDeg: 0 }));
  });
});

describe("steel frames", () => {
  it("parse + validate tubes (plan x, plan y, height)", () => {
    const { tubes, errors } = parseFrameTubes({ type: "steel_frame", engineering: { tubes: [
      { points: [[0, 0, 0], [0, 0, 12]], diameterMm: 114 },
      { points: [[6, 0, 6.3], [0, 0, 12.3], [-6, 0, 6.3], [0, 0, 0.3]], closed: true },
      { points: [[1, 1]] },
      { points: [[0, "x", 1], [1, 1, 1], [2, 2, 2]] },
    ] } });
    expect(tubes.length).toBe(3);
    expect(tubes[0].diameterMm).toBe(114);
    expect(tubes[1].closed).toBe(true);
    expect(tubes[1].diameterMm).toBe(60);
    expect(errors.length).toBe(2);
    const segs = tubeSegments(tubes, { cx: 0, cy: 0 });
    expect(segs.length).toBe(1 + 4 + 1);
    expect(segs[0].b).toEqual([0, 12, 0]);   // world: height is y
    near(segs[0].radius, 0.057, 1e-12);
    expect(parseFrameTubes({ engineering: { tubes: 5 } }).errors.length).toBe(1);
  });
  it("auto support: an elevated nozzle off-frame gets a pipe; on-frame or support:'none' does not", () => {
    const frame = tubeSegments(parseFrameTubes({ engineering: { tubes: [{ points: [[-5, 0, 6], [5, 0, 6]] }] } }).tubes);
    const segs = autoSupportSegments([
      { x: 0, z: 0, engineering: { mountHeightM: 6 } },             // on the frame
      { x: 0, z: 3, engineering: { mountHeightM: 4 } },             // free-standing
      { x: 1, z: 3, engineering: { mountHeightM: 4, support: "none" } },
      { x: 2, z: 3 },                                                 // at the water
    ], frame);
    expect(segs.length).toBe(1);
    expect(segs[0].a).toEqual([0, 0, 3]);
    near(segs[0].b[1], 3.94, 1e-9);
  });
  it("frames are scenery: no nozzle, no light, no track, scenery category", () => {
    expect(isSteelFrameType("steel_frame")).toBe(true);
    expect(classifyFixtureType("steel_frame")).toBe("equipment");
    const f = { id: "frame1", type: "steel_frame", x: 0, y: 0, engineering: { tubes: [] } };
    const { nozzleConfigs, lightConfigs } = fixturesToNozzleConfigs([f]);
    expect(nozzleConfigs.length + lightConfigs.length).toBe(0);
    expect(getFixtureInfo("steel_frame").category).toBe("scenery");
    expect(generateAutoTracks({ fixtures: [f] }).tracks.length).toBe(0);
  });
});

describe("elevated / aimed lights", () => {
  it("light configs carry the mount and aim", () => {
    const { lightConfigs } = fixturesToNozzleConfigs([{ id: "L", type: "light_uw_rgb_18w", x: 0, y: 0,
      engineering: { mountHeightM: 6, aimDeg: 180 } }]);
    expect(lightConfigs[0].mountHeightM).toBe(6);
    near(lightConfigs[0].aimDir[1], -1, 1e-9);
  });
});

describe("spray class untouched", () => {
  it("mist stays spray when elevated", () => {
    expect(emit({ type: "mist", engineering: { mountHeightM: 8 } })[0].cls).toBe(EMIT_CLASS.SPRAY);
  });
});
