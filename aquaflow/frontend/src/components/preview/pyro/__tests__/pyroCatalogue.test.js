import { describe, expect, it } from "vitest";
import { FIREWORKS_CATALOGUE, PYRO_PRODUCTS, SFX_PRODUCTS } from "../../../../data/pyroLibrary";
import { FIXTURE_LIBRARY } from "../../../../data/fixtureLibrary";
import { fillPyroParticles, PYRO_EFFECT_LOOKS } from "../pyroParticles";
import { firingScriptRows, pyroCuesFromClips, pyroProduct, sfxLevel } from "../../../../show/pyro";
import { compileForSite, inventory } from "../../../programmer/studio/showModel";
import { classifyFixtureType } from "../../../../hooks/fixtureTypeMap";

const out = (n = 30000) => ({ pos: new Float32Array(n * 3), col: new Float32Array(n * 3), size: new Float32Array(n) });
const fixture = (type, id = "F1", x = 0, y = 0) => ({ id, type, label: id, x, y, rotation: 0, engineering: {} });

describe("fireworks catalogue", () => {
  it("lists every family a fountain designer needs, all under the Pyro category", () => {
    const families = new Set(FIREWORKS_CATALOGUE.map((p) => p.family));
    for (const f of ["Aerial shells 50 mm", "Aerial shells 75 mm", "Aerial shells 100 mm", "Aerial shells 125 mm", "Aerial shells 150 mm", "Cakes",
      "Comets & candles", "Mines", "Gerbs & ground effects", "Close-proximity & stage", "Water-surface pyro",
      "Cold spark machines", "Flame projectors", "CO2 / cryo jets", "Confetti & streamers", "Smoke & haze"]) expect(families).toContain(f);
    expect(FIXTURE_LIBRARY.filter((f) => f.category === "Pyro").length).toBe(FIREWORKS_CATALOGUE.length);
    expect(new Set(FIREWORKS_CATALOGUE.map((p) => p.key)).size).toBe(FIREWORKS_CATALOGUE.length);
  });
  it("has every shell effect in every calibre", () => {
    for (const mm of [50, 75, 100, 125, 150]) for (const fx of ["peony", "chrysanthemum", "dahlia", "willow", "kamuro", "palm", "crossette", "strobe", "ring",
      "heart", "star", "smiley", "horsetail", "crackling", "salute", "multibreak", "colorchange", "comettail"]) {
      expect(PYRO_PRODUCTS.some((p) => p.key === `pyro_shell_${mm}_${fx}`)).toBe(true);
    }
  });
  it("real pyro carries timing and a safety distance, and is export-only", () => {
    for (const p of PYRO_PRODUCTS) {
      const e = p.engineering.pyro;
      expect(p.pyro).toBe(true);
      expect(p.key.startsWith("pyro_")).toBe(true);
      expect(e.safetyDistanceM).toBeGreaterThan(0);
      expect(e.durationS).toBeGreaterThan(0);
      expect(e.liftTimeS).toBeGreaterThanOrEqual(0);
      expect(e.dataSource).toMatch(/Estimate/);
      expect(e.hazardClass).toMatch(/^1\.[34][GS]$/);
      expect(typeof e.closeProximity).toBe("boolean");
      expect(PYRO_EFFECT_LOOKS).toContain(e.effect);
      expect(classifyFixtureType(p.key)).toBe("equipment");
    }
    const [item] = inventory([fixture("pyro_waterfall_10m")]);
    expect(item.tracks.map((t) => t.type)).toEqual(["pyro_fire"]);
  });
  it("special effects are not pyro: their own DMX channel, no firing cue", () => {
    for (const p of SFX_PRODUCTS) {
      expect(p.pyro).toBe(false);
      expect(p.category).toBe("Pyro");
      expect(p.key.startsWith("sfx_")).toBe(true);
      expect(PYRO_EFFECT_LOOKS).toContain(p.engineering.sfx.effect);
      expect(classifyFixtureType(p.key)).toBe("equipment");
      const [item] = inventory([fixture(p.key)]);
      const types = item.tracks.map((t) => t.type);
      expect(types).toContain(p.engineering.sfx.controlChannel);
      expect(types).not.toContain("pyro_fire");
      expect(item.status).toBe("Programmable");
    }
  });
});

describe("every effect has its own look", () => {
  it("each pyro product draws particles during its effect", () => {
    for (const p of PYRO_PRODUCTS) {
      const product = pyroProduct({ type: p.key });
      const cue = { id: p.key, x: 0, y0: 0, z: 0, rot: 0, ignition: 0, product };
      const end = (Math.max(1, product.shots || 1) - 1) * (product.intervalS || 0) + (product.liftTimeS || 0) + product.durationS;
      let best = 0;
      for (const f of [0.15, 0.35, 0.55, 0.8]) best = Math.max(best, fillPyroParticles([cue], end * f + 0.05, {}, out()).count);
      expect(best, p.key).toBeGreaterThan(5);
      expect(fillPyroParticles([cue], -0.5, {}, out()).count).toBe(0);
    }
  });
  it("planar pattern shells keep their shape: a ring burst is flat", () => {
    const product = pyroProduct({ type: "pyro_shell_100_ring" });
    const o = out(), r = fillPyroParticles([{ id: "r", x: 0, y0: 0, z: 0, rot: 0, ignition: 0, product }], product.liftTimeS + 0.5, {}, o);
    let maxZ = 0; for (let i = 0; i < r.count; i++) maxZ = Math.max(maxZ, Math.abs(o.pos[i * 3 + 2]));
    expect(maxZ).toBeLessThan(1);
  });
  it("water shells burst at the surface, swimmers skim it", () => {
    for (const key of ["pyro_water_shell_75mm", "pyro_water_comet_swimmer"]) {
      const product = pyroProduct({ type: key });
      const o = out(), r = fillPyroParticles([{ id: key, x: 0, y0: 0, z: 0, rot: 0, ignition: 0, product }], (product.liftTimeS || 0) + 0.6, {}, o);
      let minY = Infinity; for (let i = 0; i < r.count; i++) minY = Math.min(minY, o.pos[i * 3 + 1]);
      expect(r.count).toBeGreaterThan(5);
      expect(minY).toBeLessThan(0.5);
    }
  });
  it("special effects follow their level clips", () => {
    for (const p of SFX_PRODUCTS) {
      const f = fixture(p.key);
      const ch = p.engineering.sfx.controlChannel;
      const clips = [{ id: "c", fixtureId: f.id, type: ch, startTime: 2, duration: 3, value: 100 }];
      const [cue] = pyroCuesFromClips(clips, [f]);
      expect(cue.sfx).toBe(true);
      expect(sfxLevel(cue, 3)).toBe(1);
      expect(sfxLevel(cue, 6)).toBe(0);
      expect(fillPyroParticles([cue], 1.5, {}, out()).count).toBe(0);
      expect(fillPyroParticles([cue], 3.8, {}, out()).count, p.key).toBeGreaterThan(3);
    }
  });
  it("is deterministic in show time across the new looks", () => {
    const cues = ["pyro_shell_75_kamuro", "pyro_shell_75_heart", "pyro_waterfall_10m", "pyro_wheel_3m", "pyro_lancework_set_piece", "pyro_cake_100_20mm_zipper"]
      .map((k, i) => ({ id: k, x: i * 8, y0: 0, z: 0, rot: 0.3, ignition: 0.2 * i, product: pyroProduct({ type: k }) }));
    const a = out(), b = out();
    const ra = fillPyroParticles(cues, 3.7, {}, a), rb = fillPyroParticles(cues, 3.7, {}, b);
    expect(ra.count).toBe(rb.count);
    expect(Array.from(a.pos.slice(0, ra.count * 3))).toEqual(Array.from(b.pos.slice(0, rb.count * 3)));
  });
});

describe("hardware and the firing script", () => {
  const fixtures = [fixture("pyro_shell_75_peony", "P1", 0, 40), fixture("sfx_cold_spark_3m", "S1", 2, 0), fixture("sfx_co2_jet_8m", "C1", 4, 0)];
  const items = inventory(fixtures);
  const track = (id, type) => items.find((i) => i.id === id).tracks.find((t) => t.type === type).id;
  const clips = [
    { id: "p", fixtureId: "P1", trackId: track("P1", "pyro_fire"), type: "pyro_fire", startTime: 1, duration: 4, value: 100, pyro: { burstTime: 3.4 } },
    { id: "s", fixtureId: "S1", trackId: track("S1", "device_intensity"), type: "device_intensity", startTime: 2, duration: 3, value: 80 },
    { id: "c", fixtureId: "C1", trackId: track("C1", "device_intensity"), type: "device_intensity", startTime: 2, duration: 1, value: 100 },
  ];
  it("the firing script holds only real pyro", () => {
    const rows = firingScriptRows(clips, fixtures);
    expect(rows.map((r) => r.position)).toEqual(["P1"]);
  });
  it("special effects go to the site outputs; pyro never does", () => {
    const sent = compileForSite({ site: {} }, items, clips, {}).clips.map((c) => c.fixtureId).sort();
    expect(sent).toEqual(["C1", "S1"]);
  });
});
