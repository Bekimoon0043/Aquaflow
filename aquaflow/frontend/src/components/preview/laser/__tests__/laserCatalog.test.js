import { describe, it, expect } from "vitest";
import { LASER_PRODUCTS, nohdEstimateM, laserClassFor } from "../../../../data/laserLibrary";
import { FIXTURE_LIBRARY } from "../../../../data/fixtureLibrary";
import { fixtureMatchesTool, filterFixtureLibrary } from "../../../panels/FixtureLibraryBrowser";
import { fixtureLayerKey, toolLayerKey } from "../../../../engineering/drafting/entities";
import { PLACEMENT_TOOLS, TOOLS, DEFAULT_LAYERS, getEngineeringSymbol } from "../../../../engineering/drafting/designerCatalog";
import { generateAutoTracks } from "../../../../runtime/autoTrackGenerator";
import { graphicsOutline, laserFrame, laserState, patternLevel, patternOf, projectionPlane } from "../laserRig";
import { screenFor, laserConfigs } from "../laserSite";
import { LASER_LOOKS, compileLaserRecipe } from "../laserLooks";
import { aviationNotes } from "../laserPreflight";

const lasers = FIXTURE_LIBRARY.filter((f) => f.category === "Laser");
const byKey = (key) => FIXTURE_LIBRARY.find((f) => f.key === key);

describe("laser catalogue", () => {
  it("covers every family used in fountain shows", () => {
    const families = new Set(lasers.map((f) => f.family));
    for (const family of ["RGB show / beam lasers", "Single-colour beam lasers", "Water-screen graphics lasers", "Fan / sheet & liquid-sky lasers",
      "Sky / searchlight lasers", "Firefly / star-field lasers", "Moving-head lasers", "Architectural / mapping lasers"]) expect(families).toContain(family);
    for (const w of [1, 3, 5, 10, 20, 30, 60]) expect(lasers.some((f) => f.engineering.opticalPowerW === w && f.family === "RGB show / beam lasers")).toBe(true);
    expect(lasers.filter((f) => f.engineering.ipRating === "IP65").length).toBeGreaterThan(10);
  });

  it("every catalogue laser states class, optical power, control, NOHD and its 3D look", () => {
    for (const f of LASER_PRODUCTS) {
      const e = byKey(f.key).engineering;
      expect(["3B", "4"]).toContain(e.laserClass);
      expect(e.opticalPowerW).toBeGreaterThan(0);
      expect(e.controlProtocol).toMatch(/ILDA|DMX/);
      expect(e.nohdM).toBeGreaterThan(0);
      expect(e.laserKind).toBeTruthy();
      expect(f.key.startsWith("laser_")).toBe(true);
    }
    // The long-standing keys joined the catalogue without changing key.
    expect(byKey("laser_rgb_5w").family).toBe("RGB show / beam lasers");
    expect(byKey("laser_rgb_20w").engineering.ipRating).toBe("IP65");
    expect(new Set(FIXTURE_LIBRARY.map((f) => f.key)).size).toBe(FIXTURE_LIBRARY.length);
  });

  it("estimates NOHD and class from power", () => {
    // √(4·5/(π·25.4)) = 0.5006 m; (0.5006 − 0.005) / 0.0012 ≈ 413 m.
    expect(nohdEstimateM(5, 5, 1.2)).toBe(413);
    expect(laserClassFor(0.3)).toBe("3B");
    expect(laserClassFor(2)).toBe("4");
  });

  it("every laser gets the laser channels", () => {
    const types = generateAutoTracks({ fixtures: LASER_PRODUCTS.map((f, i) => ({ id: `L${i}`, type: f.key })) }).tracks;
    for (const [i] of LASER_PRODUCTS.entries()) expect(types.some((t) => t.fixtureId === `L${i}` && t.type === "laser_intensity")).toBe(true);
  });
});

describe("Laser and Fireworks tools", () => {
  it("are placement tools with their own layers", () => {
    expect(TOOLS.map((t) => t.key)).toEqual(expect.arrayContaining(["laser", "fireworks"]));
    expect(PLACEMENT_TOOLS).toEqual(expect.arrayContaining(["nozzle", "light", "laser", "fireworks", "equipment"]));
    expect(DEFAULT_LAYERS.map((l) => l.key)).toEqual(expect.arrayContaining(["lasers", "fireworks"]));
    expect(toolLayerKey("laser")).toBe("lasers");
    expect(toolLayerKey("fireworks")).toBe("fireworks");
    expect(fixtureLayerKey("laser_sky_green_10w")).toBe("lasers");
    expect(fixtureLayerKey("pyro_shell_75_peony")).toBe("fireworks");
    expect(fixtureLayerKey("nozzle_laser_laminar")).toBe("nozzles");
    expect(getEngineeringSymbol("laser_fan_sheet_green_5w").shape).toBe("laser");
    expect(getEngineeringSymbol("laser_rgb_3w").shape).toBe("laser");
    expect(fixtureLayerKey("sfx_cold_spark_3m")).toBe("fireworks");
    expect(getEngineeringSymbol("sfx_flame_burst_10m").type).toBe("flame");
    expect(getEngineeringSymbol("sfx_co2_jet_8m").type).toBe("co2");
    expect(getEngineeringSymbol("sfx_confetti_cannon").type).toBe("confetti");
    expect(getEngineeringSymbol("sfx_haze_machine").type).toBe("smoke");
    expect(getEngineeringSymbol("sfx_cold_spark_waterfall").type).toBe("spark");
  });

  it("each tool lists only its own products", () => {
    const of = (tool) => filterFixtureLibrary(FIXTURE_LIBRARY, { tool });
    expect(of("laser").length).toBeGreaterThanOrEqual(LASER_PRODUCTS.length);
    expect(of("laser").every((f) => f.category === "Laser")).toBe(true);
    expect(of("fireworks").length).toBeGreaterThan(0);
    expect(of("fireworks").every((f) => String(f.category).startsWith("Pyro") || f.key.startsWith("pyro_"))).toBe(true);
    // Special effects sit with the fireworks; the older effect_flame_* items stay under Equipment (no double entries).
    expect(of("fireworks").some((f) => f.key.startsWith("sfx_"))).toBe(true);
    expect(of("fireworks").some((f) => f.key.startsWith("effect_flame"))).toBe(false);
    for (const tool of ["light", "equipment", "nozzle"]) {
      expect(of(tool).some((f) => f.category === "Laser" || f.key.startsWith("pyro_"))).toBe(false);
    }
    expect(fixtureMatchesTool(byKey("nozzle_laser_laminar"), "nozzle")).toBe(true);
    // Browsing by family inside the laser catalogue.
    expect(filterFixtureLibrary(FIXTURE_LIBRARY, { tool: "laser", category: "Sky / searchlight lasers" }).every((f) => f.family === "Sky / searchlight lasers")).toBe(true);
  });
});

describe("new laser looks in 3D", () => {
  const rig = (key, extra = {}) => ({ id: "L", type: key, x: 0, z: 0, y: 1, rotation: 0, engineering: byKey(key).engineering, ...extra });
  const rec = (pattern) => ({ channels: { laser_intensity: 1, laser_pattern: patternLevel(pattern), laser_size: 0.6, laser_speed: 0.2 } });

  it("keeps the original pattern levels and adds the new ones", () => {
    expect(["beam", "fan", "cone", "sheet", "scan"].map((p) => patternOf([0, 0.25, 0.5, 0.75, 1][["beam", "fan", "cone", "sheet", "scan"].indexOf(p)]))).toEqual(["beam", "fan", "cone", "sheet", "scan"]);
    for (const p of ["graphics", "firefly", "liquidsky", "searchlight"]) expect(patternOf(patternLevel(p))).toBe(p);
    // A projector with no pattern clip shows its own kind.
    expect(laserState({ channels: { laser_intensity: 1 } }, rig("laser_sky_green_10w")).pattern).toBe("searchlight");
    expect(laserState({ channels: { laser_intensity: 1 } }, rig("laser_firefly_gr_300mw")).pattern).toBe("firefly");
  });

  it("graphics draw the artwork on the projection plane", () => {
    const fx = rig("laser_mapping_rgb_30w");
    const plane = projectionPlane(fx);
    expect(plane.center.x).toBeCloseTo(45, 6);
    const segs = graphicsOutline(fx, { size: 1 });
    expect(segs.length).toBeGreaterThan(20);
    for (const s of segs) expect(Math.abs(s.a.x - 45)).toBeLessThan(1e-9);
    const f = laserFrame(fx, laserState(rec("graphics"), fx), 1, {});
    expect(f.outline.length).toBe(segs.length);
    expect(f.faint).toBe(true);
    // On a 5 m tower outside the basin it still draws; at 0.5 m in audience space it is blanked.
    const basin = [[-5, -5], [5, -5], [5, 5], [-5, 5]];
    expect(laserFrame({ ...fx, x: 0, z: 20, y: 5 }, laserState(rec("graphics"), fx), 1, { basin }).outline.length).toBe(segs.length);
    const low = { ...fx, x: 0, z: 20, y: 0.5 };
    expect(laserFrame(low, laserState(rec("graphics"), low), 1, { basin }).outline).toHaveLength(0);
  });

  it("graphics lasers draw on the nearest water screen", () => {
    const screen = screenFor({ x: 0, z: 0 }, [{ id: "S", x: 0, z: 20, engineering: { jetHeightM: 12 } }]);
    expect(screen.center).toEqual({ x: 0, y: 6, z: 20 });
    expect(screen.width).toBeCloseTo(19.2, 6);
    const [cfg] = laserConfigs([{ id: "G", type: "laser_graphics_waterscreen_10w", x: 0, y: 0, engineering: byKey("laser_graphics_waterscreen_10w").engineering }],
      null, [{ id: "S", type: "nozzle_water_screen", x: 0, y: 20, engineering: { jetHeightM: 12 } }]);
    expect(cfg.screen.screenId).toBe("S");
  });

  it("firefly, searchlight and liquid sky have their own geometry", () => {
    const ff = laserFrame(rig("laser_starfield_rgb_2w"), laserState(rec("firefly"), rig("laser_starfield_rgb_2w")), 2, {});
    expect(ff.beams.length).toBe(64);
    expect(ff.beams.every((b) => b.glint > 0 && b.glint <= 1)).toBe(true);
    const sky = laserFrame(rig("laser_sky_rgb_30w"), laserState(rec("searchlight"), rig("laser_sky_rgb_30w")), 0, {});
    expect(sky.beams).toHaveLength(1);
    expect(sky.heavy).toBe(true);
    expect(sky.beams[0].length).toBeGreaterThan(1000);
    const liq = rig("laser_liquid_sky_rgb_10w", { y: 4 });
    const ls = laserFrame(liq, { ...laserState(rec("liquidsky"), liq), tilt: 90 }, 1, {});
    expect(ls.sheet).toBe(true);
    expect(ls.beams.every((b) => Math.abs(b.dir.y) < 0.05)).toBe(true);
  });

  it("every new look compiles to laser channels", () => {
    const item = { id: "L1", label: "L1", engineering: { panRangeDeg: 540, tiltRangeDeg: 270 },
      tracks: ["laser_intensity", "laser_pattern", "laser_pan", "laser_tilt", "laser_size", "laser_speed", "lighting_red", "lighting_green", "lighting_blue"].map((type) => ({ id: `L1:${type}`, type })) };
    for (const look of LASER_LOOKS) {
      const clips = compileLaserRecipe({ id: "r", name: look.label, start: 0, duration: 6, cycles: 1, spread: 1, intensity: 80, color: "#33d6ff", laser: { look: look.id } }, [item]);
      expect(clips.some((c) => c.type === "laser_intensity" && Array.isArray(c.keys))).toBe(true);
      expect(clips.find((c) => c.type === "laser_pattern")).toBeTruthy();
    }
    const graphics = compileLaserRecipe({ id: "g", name: "g", start: 0, duration: 6, cycles: 1, spread: 1, intensity: 80, color: "#33d6ff", laser: { look: "water-screen-graphics" } }, [item]);
    expect(patternOf(graphics.find((c) => c.type === "laser_pattern").value / 100)).toBe("graphics");
    expect(Array.isArray(graphics.find((c) => c.type === "laser_size").keys)).toBe(true);
  });

  it("sky lasers carry an aviation note", () => {
    const notes = aviationNotes([{ id: "S", label: "Sky 1", engineering: byKey("laser_sky_green_10w").engineering }, { id: "B", engineering: byKey("laser_rgb_3w").engineering }]);
    expect(notes).toHaveLength(1);
    expect(notes[0].message).toMatch(/aviation/);
  });
});
