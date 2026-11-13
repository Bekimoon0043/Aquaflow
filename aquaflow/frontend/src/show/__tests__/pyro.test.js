import { describe, expect, it } from "vitest";
import { PYRO_PRODUCTS, PYRO_BY_KEY } from "../../data/pyroLibrary";
import { FIXTURE_LIBRARY } from "../../data/fixtureLibrary";
import {
  burstTimeFor, compilePyroRecipe, firingScriptCsv, firingScriptRows, ignitionTime, pyroCuesFromClips, pyroProduct,
  pyroSafetyDiagnostics, smpte, validatePyroCues, distanceToOutline,
} from "../pyro";
import { compileForSite, compileStudio, inventory, newRecipe, readStudio } from "../../components/programmer/studio/showModel";
import { classifyFixtureType } from "../../hooks/fixtureTypeMap";

const pos = (id, type, x, y = 20) => ({ id, type, label: id, x, y, engineering: {} });
const shell75 = "pyro_shell_75_peony";

describe("pyro catalogue", () => {
  it("is in the fixture library under Pyro with sane estimates", () => {
    expect(FIXTURE_LIBRARY.filter((f) => f.category === "Pyro").length).toBe(PYRO_PRODUCTS.length);
    for (const p of PYRO_PRODUCTS) {
      const e = p.engineering.pyro;
      expect(p.key.startsWith("pyro_")).toBe(true);
      expect(e.dataSource).toMatch(/Estimate/);
      expect(e.safetyDistanceM).toBeGreaterThan(0);
      expect(e.burstHeightM).toBeGreaterThan(0);
      expect(e.durationS).toBeGreaterThan(0);
      expect(e.liftTimeS).toBeGreaterThanOrEqual(0);
      if (e.kind === "shell") {
        expect(e.liftTimeS).toBeGreaterThanOrEqual(1.5);
        expect(e.liftTimeS).toBeLessThanOrEqual(3.5);
        expect(e.safetyDistanceM).toBeCloseTo(e.calibreMm * 0.84, 0);   // NFPA 1123 70 ft / inch
      }
    }
    const s = PYRO_BY_KEY.get(shell75).engineering.pyro;
    expect(s.safetyDistanceM).toBe(63);
    expect(s.burstHeightM).toBe(90);
    expect(PYRO_BY_KEY.get("pyro_shell_125_willow").engineering.pyro.liftTimeS).toBeGreaterThan(s.liftTimeS);
  });
  it("is classified as equipment (never a water jet) and gets one pyro_fire channel", () => {
    expect(classifyFixtureType(shell75)).toBe("equipment");
    const [item] = inventory([pos("P1", shell75, 0)]);
    expect(item.tracks.map((t) => t.type)).toEqual(["pyro_fire"]);
    expect(item.status).toBe("Programmable");
  });
});

describe("pre-fire maths", () => {
  it("ignition = burst − lift, and SMPTE time code", () => {
    const p = pyroProduct({ type: shell75 });
    expect(ignitionTime(10, p)).toBeCloseTo(7.6, 6);
    expect(smpte(7.6, 30)).toBe("00:00:07:18");
    expect(smpte(3725.48, 25)).toBe("01:02:05:12");
  });
  it("burst times per mode", () => {
    const r = { start: 10, duration: 4, pyro: { mode: "sweep" } };
    expect([0, 1, 2].map((i) => burstTimeFor(r, i, 3))).toEqual([10, 12, 14]);
    expect(burstTimeFor({ start: 5, pyro: { mode: "chase", intervalS: 0.25 } }, 4, 8)).toBe(6);
    expect(burstTimeFor({ start: 5, pyro: { mode: "single" } }, 3, 8)).toBe(5);
    const b = burstTimeFor({ start: 5, duration: 3, pyro: { mode: "barrage" }, seed: 1 }, 2, 8);
    expect(b).toBeGreaterThanOrEqual(5); expect(b).toBeLessThanOrEqual(8);
  });
});

describe("Show Studio pyro patterns", () => {
  const fixtures = [pos("A", shell75, -6), pos("B", shell75, 0), pos("C", shell75, 6), pos("J1", "nozzle_geyser", 0, 0)];
  const items = inventory(fixtures);
  const group = { id: "g", name: "Pyro", memberFixtureIds: ["A", "B", "C"], orderMode: "engineering" };
  const all = { id: "all", name: "All", memberFixtureIds: fixtures.map((f) => f.id), orderMode: "engineering" };
  const studio = (recipes, groups = [group]) => ({ ...readStudio({}), groups, recipes });

  it("compiles a sweep left to right with pre-fire cues", () => {
    const r = { ...newRecipe("g", 10), name: "Sweep", effect: "pyro", duration: 2, order: "left-to-right", pyro: { mode: "sweep" } };
    const { clips, issues } = compileStudio(studio([r]), items);
    expect(issues).toEqual([]);
    expect(clips.map((c) => [c.fixtureId, c.pyro.burstTime, c.startTime])).toEqual([["A", 10, 7.6], ["B", 11, 8.6], ["C", 12, 9.6]]);
    expect(clips.every((c) => c.type === "pyro_fire" && c.trackId.endsWith("-fire"))).toBe(true);
  });
  it("refuses ignition before the show starts", () => {
    const r = { ...newRecipe("g", 1), name: "Too early", effect: "pyro", duration: 1, pyro: { mode: "single" } };
    const { clips, issues } = compileStudio(studio([r]), items);
    expect(clips).toHaveLength(0);
    expect(issues.join(" ")).toMatch(/before the show starts/);
  });
  it("flags a mortar fired twice", () => {
    const a = { ...newRecipe("g", 10), name: "One", effect: "pyro", duration: 1, pyro: { mode: "single" } };
    const b = { ...newRecipe("g", 20), name: "Two", effect: "pyro", duration: 1, pyro: { mode: "single" } };
    const { issues } = compileStudio(studio([a, b]), items);
    expect(issues.filter((m) => /fired twice/.test(m))).toHaveLength(3);
  });
  it("water patterns pass over pyro positions without complaints", () => {
    const r = { ...newRecipe("all", 0), name: "Wave", effect: "wave", duration: 4 };
    const { clips, issues } = compileStudio(studio([r], [all]), items);
    expect(issues).toEqual([]);
    expect(clips.every((c) => c.fixtureId === "J1")).toBe(true);
  });
  it("never sends pyro to site hardware", () => {
    const r = { ...newRecipe("g", 10), name: "Fan", effect: "pyro", duration: 1, pyro: { mode: "sweep" } };
    const s = studio([r]);
    const { clips } = compileStudio(s, items);
    expect(clips.length).toBe(3);
    expect(compileForSite(s, items, clips).clips.some((c) => c.type === "pyro_fire")).toBe(false);
  });
  it("compilePyroRecipe reports groups without positions", () => {
    expect(compilePyroRecipe({ id: "r", name: "Empty", start: 5, duration: 1 }, items.filter((i) => i.id === "J1")).issues[0]).toMatch(/no pyro/);
  });
});

describe("validation, scene cues and the firing script", () => {
  const fixtures = [pos("A", shell75, -6), pos("K", "pyro_cake_25_30mm", 4)];
  const clip = (id, fixtureId, startTime, burstTime) => ({ id, fixtureId, type: "pyro_fire", startTime, duration: 4, value: 100, pyro: { burstTime }, name: `Cue · ${fixtureId}` });
  it("a cake may repeat, a shell may not; negative ignition is caught", () => {
    const issues = validatePyroCues([clip("1", "A", 2, 4.4), clip("2", "A", 5, 7.4), clip("3", "K", 1, 2.4), clip("4", "K", 6, 7.4), clip("5", "A", -1, 1.4)], fixtures);
    expect(issues.filter((i) => i.code === "pyro-position-reused")).toHaveLength(2);
    expect(issues.filter((i) => i.code === "pyro-ignition-before-start")).toHaveLength(1);
  });
  it("scene cues use the world frame (plan minus centre)", () => {
    const [c] = pyroCuesFromClips([clip("1", "A", 2, 4.4)], fixtures, { cx: 1, cy: 5 });
    expect(c).toMatchObject({ x: -7, z: 15, ignition: 2 });
    expect(c.product.effect).toBe("peony");
  });
  it("exports a firing-system CSV in ignition order", () => {
    const csv = firingScriptCsv([clip("2", "K", 6, 7.4), clip("1", "A", 2.5, 4.9)], fixtures);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Cue,Ignition (s),Ignition SMPTE (HH:MM:SS:FF),Burst (s),Lift (s),Position,Module,Pin,Product,Effect,Calibre (mm),Shots,Safety distance (m),Notes");
    expect(lines[1].startsWith("1,2.50,00:00:02:15,4.90,2.4,A,1,1,75 mm Peony shell,peony,75,1,63,")).toBe(true);
    expect(lines[2].startsWith("2,6.00,00:00:06:00,")).toBe(true);
    expect(lines[2]).toContain(",K,1,2,25-shot cake (30 mm),peony,30,25,");
    expect(firingScriptRows([clip("1", "A", 2.5, 4.9)], [{ ...fixtures[0], engineering: { firingModule: 7, firingPin: 3 } }])[0]).toMatchObject({ module: 7, pin: 3 });
  });
});

describe("safety distances", () => {
  const square = (cx, cy, h) => [{ x: cx - h, y: cy - h }, { x: cx + h, y: cy - h }, { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h }];
  it("distance to an outline is 0 inside and the edge distance outside", () => {
    expect(distanceToOutline({ x: 0, y: 0 }, square(0, 0, 5))).toBe(0);
    expect(distanceToOutline({ x: 10, y: 0 }, square(0, 0, 5))).toBeCloseTo(5, 9);
  });
  it("warns for spectators, buildings, the basin edge and wind; lists the script", () => {
    const fixtures = [pos("A", shell75, 0, 100)];
    const clips = [{ id: "c", fixtureId: "A", type: "pyro_fire", startTime: 1, duration: 4, pyro: { burstTime: 3.4 } }];
    const d = pyroSafetyDiagnostics({
      fixtures, clips,
      siteSurfaces: [{ type: "paving", label: "Plaza", points: square(0, 50, 5) }, { type: "grass", label: "Lawn", points: square(0, 60, 5) }],
      siteModels: [{ name: "Hotel building", transform: { position: { x: 0, z: 80 } } }],
      basins: [{ name: "Basin 1", outer: square(0, 0, 10) }], center: { cx: 0, cy: 0 }, wind: { x: 8, z: 6 },
    });
    const codes = d.map((x) => x.code);
    expect(codes).toContain("pyro-safety-audience");
    expect(codes).toContain("pyro-safety-building");
    expect(codes).toContain("pyro-wind");
    expect(codes).toContain("pyro-firing-script");
    expect(codes).not.toContain("pyro-safety-basin-edge");     // 90 m away, outside 63 m
    const near = pyroSafetyDiagnostics({ fixtures: [pos("B", shell75, 0, 40)], basins: [{ name: "Basin 1", outer: square(0, 0, 10) }] });
    expect(near.map((x) => x.code)).toEqual(expect.arrayContaining(["pyro-safety-basin-edge", "pyro-position-unused"]));
    expect(d.find((x) => x.code === "pyro-safety-audience").message).toMatch(/inside the 63 m safety distance/);
  });
});
