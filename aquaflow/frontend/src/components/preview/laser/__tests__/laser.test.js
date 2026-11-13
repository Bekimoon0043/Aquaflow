import { describe, expect, it } from "vitest";
import {
  aimDirection, audienceIntervals, beamDirections, beamEnd, hazeVisibility, isLaserFixture, laserFrame, laserState, patternLevel, patternOf, safeBeam,
} from "../laserRig";
import { compileLaserRecipe, LASER_LOOKS } from "../laserLooks";
import { laserConfigs, laserSafetyArea } from "../laserSite";
import { laserDiagnostics } from "../laserPreflight";
import { evaluateShowFrameAt } from "../../../../show/evaluateShowFrame";
import { generateAutoTracks } from "../../../../runtime/autoTrackGenerator";
import { compileStudio, inventory, newRecipe, readStudio } from "../../../programmer/studio/showModel";
import { createFullShowPreview } from "../../../../utils/fullShowPreview";

const len = (v) => Math.hypot(v.x, v.y, v.z);
const deg = (a, b) => (Math.acos(Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)) * 180) / Math.PI;
const square = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

describe("laser rig geometry", () => {
  it("recognises laser fixtures but not the laser-lit laminar nozzle", () => {
    expect(isLaserFixture("laser_rgb_5w")).toBe(true);
    expect(isLaserFixture("nozzle_laser_laminar")).toBe(false);
  });
  it("maps the pattern channel to looks and back", () => {
    for (const p of ["beam", "fan", "cone", "sheet", "scan"]) expect(patternOf(patternLevel(p))).toBe(p);
  });
  it("aims straight up at tilt 0 and toward the facing at tilt 90", () => {
    expect(aimDirection(0, 0, 0)).toEqual({ x: 0, y: 1, z: 0 });
    const d = aimDirection(90, 0, 90);
    expect(d.z).toBeCloseTo(1, 9); expect(d.y).toBeCloseTo(0, 9);
  });
  it("spreads a fan of 9 beams across its size", () => {
    const { dirs } = beamDirections({ pattern: "fan", pan: 0, tilt: 0, size: 60, speed: 0 }, 0, 0);
    expect(dirs).toHaveLength(9);
    dirs.forEach((d) => expect(len(d)).toBeCloseTo(1, 9));
    expect(deg(dirs[0], dirs[8])).toBeCloseTo(60, 6);
  });
  it("keeps every cone beam at half the cone angle from the axis, and rotates it over time", () => {
    const st = { pattern: "cone", pan: 0, tilt: 30, size: 20, speed: 1 };
    const axis = aimDirection(0, 0, 30);
    const a = beamDirections(st, 0, 0).dirs, b = beamDirections(st, 0, 0.1).dirs;
    a.forEach((d) => expect(deg(d, axis)).toBeCloseTo(10, 6));
    expect(deg(a[0], b[0])).toBeGreaterThan(1);
  });
  it("ends a downward beam on the water plane", () => {
    const end = beamEnd({ x: 0, y: 2, z: 0 }, { x: Math.SQRT1_2, y: -Math.SQRT1_2, z: 0 });
    expect(end.hit).toBe(true); expect(end.point.x).toBeCloseTo(2, 9); expect(end.point.y).toBeCloseTo(0, 9);
  });
  it("only shows beams in haze in real-world mode", () => {
    expect(hazeVisibility(0)).toBeLessThan(0.1);
    expect(hazeVisibility(1)).toBe(1);
    expect(hazeVisibility(0, false)).toBe(0.6);
  });
});

describe("channels from the show frame", () => {
  it("reads intensity, pattern, aim, size, speed and RGB colour", () => {
    const fixture = { id: "L1", type: "laser_rgb_5w", engineering: { panRangeDeg: 180, tiltRangeDeg: 180 } };
    const clip = (type, value) => ({ id: type, fixtureId: "L1", type, startTime: 0, duration: 10, value });
    const project = { fixtures: [fixture], clips: [clip("laser_intensity", 80), clip("laser_pattern", 50), clip("laser_pan", 75), clip("laser_tilt", 25),
      clip("laser_size", 50), clip("laser_speed", 25), clip("lighting_red", 0), clip("lighting_green", 100), clip("lighting_blue", 0)] };
    const s = laserState(evaluateShowFrameAt(project, 1).fixtures.L1, fixture);
    expect(s.intensity).toBeCloseTo(0.8, 9);
    expect(s.pattern).toBe("cone");
    expect(s.pan).toBeCloseTo(45, 9);
    expect(s.tilt).toBeCloseTo(-45, 9);
    expect(s.size).toBeCloseTo(46, 9);
    expect(s.speed).toBeCloseTo(0.5, 9);
    expect(s.color).toEqual({ r: 0, g: 1, b: 0 });
  });
  it("gives each laser its own programmable channels", () => {
    const types = generateAutoTracks({ fixtures: [{ id: "L1", type: "laser_rgb_5w" }] }).tracks.map((t) => t.type);
    for (const t of ["laser_intensity", "laser_pattern", "laser_pan", "laser_tilt", "laser_size", "laser_speed", "lighting_red", "lighting_green", "lighting_blue"]) expect(types).toContain(t);
  });
});

describe("audience safety", () => {
  const zone = square(10, -5, 30, 5);
  it("raises a low beam just enough to clear 3 m over the whole audience area", () => {
    const origin = { x: 0, y: 0.5, z: 0 };
    const res = safeBeam(origin, { x: 1, y: 0, z: 0 }, { zones: [zone], minBeamHeightM: 3 });
    expect(res.clamped).toBe(true);
    const slope = res.dir.y / Math.hypot(res.dir.x, res.dir.z);
    expect(0.5 + slope * 10).toBeCloseTo(3, 9);   // at the near edge of the audience
    expect(0.5 + slope * 30).toBeGreaterThan(3);  // and higher further in
  });
  it("leaves a beam alone when it already clears the audience or misses it", () => {
    expect(safeBeam({ x: 0, y: 0.5, z: 0 }, aimDirection(0, 0, 45), { zones: [zone] }).clamped).toBe(false);
    expect(safeBeam({ x: 0, y: 0.5, z: 0 }, { x: -1, y: 0, z: 0 }, { zones: [zone] }).clamped).toBe(false);
  });
  it("blanks a projector standing in the audience below the safe height", () => {
    expect(safeBeam({ x: 20, y: 1, z: 0 }, aimDirection(0, 0, 10), { zones: [zone] }).blanked).toBe(true);
    expect(safeBeam({ x: 20, y: 5, z: 0 }, aimDirection(0, 0, 10), { zones: [zone] }).blanked).toBe(false);
  });
  it("treats everything outside the basin as audience when no zones are drawn", () => {
    const basin = square(-6, -4, 6, 4);
    expect(audienceIntervals({ x: 0, y: 0, z: 0 }, 1, 0, { basin, range: 50 })).toEqual([[6, 50]]);
    const res = safeBeam({ x: 0, y: 0.5, z: 0 }, { x: 1, y: 0.05, z: 0 }, { basin });
    expect(res.clamped).toBe(true);
  });
  it("reports the clamp in the per-frame rig output", () => {
    const f = laserFrame({ id: "L", x: 0, z: 0, y: 0.5, rotation: 0, engineering: {} },
      { intensity: 1, color: { r: 0, g: 1, b: 0 }, pattern: "fan", pan: 0, tilt: 88, size: 20, speed: 0 }, 0, { zones: [zone] });
    expect(f.clamped).toBeGreaterThan(0);
    expect(f.beams.every((b) => b.end.y >= 0)).toBe(true);
  });
});

describe("site helpers", () => {
  it("moves lasers and audience areas into the centred world frame", () => {
    const center = { cx: 10, cy: 5 };
    const [cfg] = laserConfigs([{ id: "L", type: "laser_rgb_5w", x: 12, y: 8, engineering: { mountHeightM: 2 } }, { id: "J", type: "nozzle_geyser", x: 0, y: 0 }], center);
    expect(cfg).toMatchObject({ id: "L", x: 2, z: 3, y: 2 });
    const area = laserSafetyArea({ siteSurfaces: [{ type: "audience", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }] }, { type: "grass", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
      geometry: { type: "polygon", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }] } }, center);
    expect(area.zones).toEqual([[[-10, -5], [-6, -5], [-6, -1]]]);
    expect(area.basin[1]).toEqual([10, -5]);
  });
});

describe("Show Studio laser looks", () => {
  const fixtures = [0, 1, 2].map((i) => ({ id: `L${i}`, type: "laser_rgb_5w", label: `Laser ${i}`, x: i * 3, y: 0, engineering: { panRangeDeg: 180, tiltRangeDeg: 180 } }));
  it("compiles every look to keyed laser channel clips", () => {
    const items = inventory(fixtures);
    for (const look of LASER_LOOKS) {
      const clips = compileLaserRecipe({ id: "r", name: look.label, start: 2, duration: 6, cycles: 2, intensity: 90, spread: 1, color: "#00ff40", laser: { look: look.id } }, items);
      expect(clips.length).toBe(3 * 9);
      expect(clips.filter((c) => c.type === "laser_intensity").every((c) => Array.isArray(c.keys) && c.startTime === 2)).toBe(true);
    }
  });
  it("is a Show Studio recipe whose clips play in the 3D preview and evaluate to a lit fan", () => {
    const items = inventory(fixtures);
    const group = { id: "g", name: "Lasers", memberFixtureIds: fixtures.map((f) => f.id), orderMode: "engineering" };
    const recipe = { ...newRecipe("g", 0), effect: "laser", duration: 8, intensity: 100, color: "#22ff55", laser: { look: "fan-sweep" } };
    const { clips, issues } = compileStudio({ ...readStudio({}), groups: [group], recipes: [recipe] }, items);
    expect(issues).toEqual([]);
    const plan = createFullShowPreview(clips, fixtures);
    expect(plan.visualClips.length).toBe(clips.length);
    const s = laserState(evaluateShowFrameAt({ fixtures, clips }, 4).fixtures.L0, fixtures[0]);
    expect(s.pattern).toBe("fan"); expect(s.intensity).toBeGreaterThan(0.9); expect(s.color.g).toBeCloseTo(1, 2);
  });
  it("preflight warns when a look would send beams into an audience area", () => {
    const fx = [{ id: "L0", type: "laser_rgb_5w", label: "Laser 0", x: 0, y: 0, rotation: 0, engineering: { panRangeDeg: 180, tiltRangeDeg: 180, mountHeightM: 0.5 } }];
    const low = (type, value) => ({ id: type, fixtureId: "L0", type, startTime: 0, duration: 4, value });
    const project = { fixtures: fx, clips: [low("laser_intensity", 100), low("laser_tilt", 99)], siteSurfaces: [{ type: "audience", points: [{ x: 10, y: -5 }, { x: 30, y: -5 }, { x: 30, y: 5 }, { x: 10, y: 5 }] }] };
    const d = laserDiagnostics(project);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ code: "laser-audience-raised", fixtureId: "L0", timeMs: 0 });
    expect(laserDiagnostics({ ...project, clips: [low("laser_intensity", 100)] })).toEqual([]);
  });
});
