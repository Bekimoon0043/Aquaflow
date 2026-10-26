/**
 * Framing projectors (lightFraming.js), unpaired lights reaching jets with a
 * forward-scatter factor, and exit turbulence / turbulent-surface break-up
 * (realWorldLook.js).
 */
import { describe, it, expect } from "vitest";
import {
  parseFraming, framingForRenderer, bladePlanesOf, bladeFactor, bladeEdge, DEFAULT_BLADE_SOFTNESS_M, MAX_BLADES,
} from "../lightFraming";
import {
  jetBreakupOf, dropletHeadOf, breakupLengthM, realBandOf, beamIlluminance, beamBandOnJet,
  selectLitBeams, reachingLights, beamRecordOf, rankLitBeams, scatterPhase, forwardScatterFactor, exitTurbulenceOf,
  turbulentBreakupLengthM, turbulentWeberThreshold, jetNumbers, realismReport, bladesExcludeBeam,
  TU_SMOOTH_BORE, TU_STRAIGHTENED, SCATTER_G, MIN_LIGHT_SHARE,
} from "../realWorldLook";
import { beamHitBand, BAND_OPEN } from "../jetLook";
import { aimDirection } from "../elevatedNozzles";
import { encodeLight, lightContribution } from "../fixtureLightField";
import { fixturesToNozzleConfigs, classifyFixtureType } from "../../../hooks/fixtureTypeMap";
import { getFixtureLibraryEntry } from "../../../data/fixtureLibrary";

const DEG = 180 / Math.PI;
const upBlade = (h, soft) => ({ blades: [{ point: [0, 0, h], normal: [0, 0, 1] }], ...(soft != null ? { softnessM: soft } : {}) });

describe("framing blades", () => {
  it("validates blades and reports malformed ones", () => {
    const f = parseFraming({ blades: [
      { point: [0, 0, 3], normal: [0, 0, 2] },
      { point: [0, "x", 3], normal: [0, 0, 1] },
      { point: [0, 0, 3], normal: [0, 0, 0] },
      null,
    ] });
    expect(f.blades).toHaveLength(1);
    expect(f.blades[0].normal).toEqual([0, 0, 1]);           // normalised
    expect(f.softnessM).toBe(DEFAULT_BLADE_SOFTNESS_M);
    expect(f.invalid.map((q) => q.index)).toEqual([1, 2, 3]);
    expect(parseFraming(null)).toBeNull();
    expect(parseFraming({ blades: "no" }).invalid[0].index).toBe(-1);
    const many = parseFraming({ blades: Array.from({ length: 6 }, () => ({ point: [0, 0, 0], normal: [1, 0, 0] })) });
    expect(many.blades).toHaveLength(MAX_BLADES);
    expect(many.invalid).toHaveLength(2);
  });

  it("is a half-space with a soft edge on the kept side", () => {
    const L = { x: 0, z: 0, framing: framingForRenderer(upBlade(3, 0.2), 0, 0) };
    expect(bladeFactor(L, 0, 4, 0)).toBe(1);        // world y = height
    expect(bladeFactor(L, 0, 2.99, 0)).toBe(0);     // excluded side: always dark
    const mid = bladeFactor(L, 0, 3.1, 0);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    const hard = { x: 0, z: 0, framing: framingForRenderer(upBlade(3, 0), 0, 0) };
    expect(bladeFactor(hard, 0, 3.0001, 0)).toBe(1);
    expect(bladeEdge(-1e-6, 0)).toBe(0);
    // No blades: everything passes.
    expect(bladeFactor({ x: 0, z: 0 }, 0, -5, 0)).toBe(1);
  });

  it("plan coordinates map to world axes and follow the pool-centre shift", () => {
    // Light at plan (10, 5); blade keeps the side with plan y >= 7 (normal +plan y).
    const fr = framingForRenderer({ blades: [{ point: [10, 7, 0], normal: [0, 1, 0] }] }, 10, 5);
    expect(fr.blades[0]).toEqual({ d: [0, 0, 2], n: [0, 0, 1] });
    const centred = { x: 0, z: -1, framing: fr };          // light shifted by centre (10, 6)
    const [pl] = bladePlanesOf(centred);
    expect(pl.n).toEqual([0, 0, 1]);
    expect(bladeFactor(centred, 0, 0, 1.2)).toBe(1);        // plan y 7.2 → kept
    expect(bladeFactor(centred, 0, 0, 0.9)).toBe(0);        // plan y 6.9 → cut
  });

  it("cuts the shader light field (JS mirror)", () => {
    const base = { x: 0, z: 0, y: 0, color: { r: 1, g: 1, b: 1 }, intensity: 4, radius: 6 };
    const open = encodeLight(base);
    const cut = encodeLight({ ...base, framing: framingForRenderer(upBlade(2, 0), 0, 0) });
    const toCam = { x: 0, y: 0, z: 1 };
    expect(lightContribution(open, { x: 0, y: 1, z: 0 }, toCam)[0]).toBeGreaterThan(0);
    expect(lightContribution(cut, { x: 0, y: 1, z: 0 }, toCam)[0]).toBe(0);
    expect(lightContribution(cut, { x: 0, y: 3, z: 0 }, toCam)[0]).toBeCloseTo(lightContribution(open, { x: 0, y: 3, z: 0 }, toCam)[0], 9);
    expect(open.blades).toEqual([]);
  });
});

describe("framing projector product", () => {
  it("is a placeable DMX light with 5,200 lm and a 30° beam", () => {
    const p = getFixtureLibraryEntry("light_projector_framing_5200lm");
    expect(p).toBeTruthy();
    expect(p.category).toBe("Lights");
    expect(p.engineering.lumens).toBe(5200);
    expect(p.engineering.beamAngleDeg).toBe(30);
    expect(p.engineering.zoomRangeDeg).toEqual([15, 45]);
    expect(p.engineering.ipRating).toBe("IP66");
    expect(p.model).toMatch(/Martin Exterior Projection Pro Compact class, verify datasheet/);
    expect(classifyFixtureType("light_projector_framing_5200lm")).toBe("light");
  });

  it("carries its blades (and blade issues) to the renderer light config", () => {
    const fixture = { id: "P1", type: "light_projector_framing_5200lm", x: 5.5, y: 14,
      engineering: { lumens: 5200, wattage: 140, beamAngleDeg: 30, mountHeightM: 3.4, aimDeg: 70, aimAzimuthDeg: 250,
        framing: { blades: [{ point: [5.5, 14, 2.6], normal: [0, -0.3, 1] }, { point: [1, 2], normal: [0, 0, 1] }], softnessM: 0.1 } } };
    const { lightConfigs, nozzleConfigs } = fixturesToNozzleConfigs([fixture]);
    expect(nozzleConfigs).toHaveLength(0);
    const L = lightConfigs[0];
    expect(L.lumens).toBe(5200);
    expect(L.framing.blades).toHaveLength(1);
    expect(L.framing.softnessM).toBe(0.1);
    expect(L.framing.blades[0].d).toEqual([0, 2.6, 0]);
    expect(L.framingIssues).toEqual([{ index: 1, reason: expect.stringMatching(/point/) }]);
    // Without framing: no new fields (no-change).
    const plain = fixturesToNozzleConfigs([{ ...fixture, engineering: { ...fixture.engineering, framing: undefined } }]).lightConfigs[0];
    expect(plain.framing).toBeUndefined();
    expect(plain.framingIssues).toBeUndefined();
  });
});

// A 3 m jet at the origin and an aimed light record.
const jet = (extra = {}) => ({ id: "J1", type: "jet_3d", fixtureType: "nozzle_straight_jet", x: 0, z: 0, designHeightM: 3,
  engineering: { jetHeightM: 3, nozzleDiaMm: 12, pressureBar: 0.35 }, ...extra });
/** Light at plan (x, z) height h aimed at the jet point (0, yT, 0). */
const aimedAt = (x, z, h, yT, more = {}) => {
  const dx = -x, dy = yT - h, dz = -z, n = Math.hypot(dx, dy, dz);
  return { id: more.id || "L", x, z, y: h, aimDeg: Math.acos(dy / n) * DEG, aimDir: [dx / n, dy / n, dz / n],
    beamAngleDeg: 30, lumens: 5200, ...more };
};

describe("framed band on a jet", () => {
  it("unframed beams give exactly the jetLook band (no change)", () => {
    const b = { x: 0, y: 0, z: 2, dir: aimDirection(30, 270), beamAngleDeg: 20 };
    const j = { x: 0, z: 0, y0: 0, y1: 6 };
    expect(beamBandOnJet(b, j)).toEqual(beamHitBand(b, j));
  });

  it("a blade raises the bottom of the lit band to its plane", () => {
    const L = beamRecordOf(aimedAt(0, 6, 0.5, 2, { beamAngleDeg: 30 }));
    const cfg = (beams) => ({ ...jet(), litBeams: beams });
    const open = realBandOf(cfg([L]), 0, 3);
    const framed = { ...L, framing: framingForRenderer(upBlade(2.2, 0.02), 0, 6) };
    const cut = realBandOf(cfg([framed]), 0, 3);
    expect(open.lo).toBeLessThan(1.6);
    expect(cut.lo).toBeGreaterThan(2.15);
    expect(cut.lo).toBeLessThan(2.3);
    // Illuminance is zero below the blade, unchanged well above it.
    expect(beamIlluminance(framed, 0, 1.8, 0)).toBe(0);
    expect(beamIlluminance(framed, 0, 2.6, 0)).toBeCloseTo(beamIlluminance(L, 0, 2.6, 0), 9);
  });
});

describe("unpaired lights and forward scatter", () => {
  it("an unpaired aimed light that reaches the jet lights a band on it", () => {
    const mast = aimedAt(5, 8, 3.4, 2.8, { id: "M1" });
    const beams = selectLitBeams(jet(), [mast]);
    expect(beams).toHaveLength(1);
    expect(beams[0]).toMatchObject({ id: "M1", paired: false, scatter: 1 });
    const band = realBandOf({ ...jet(), litBeams: beams }, 0, 3);
    expect(band.lo).toBeGreaterThan(0.1);
    expect(band.lo).toBeLessThan(2.8);
    expect(band.glow).toBeLessThan(1);
    // Aimed away, blocked by its blades, or not aimed: no band.
    expect(selectLitBeams(jet(), [aimedAt(5, 8, 3.4, 2.8, { aimDir: [0, 1, 0] })])).toBeNull();
    expect(selectLitBeams(jet(), [{ ...mast, framing: framingForRenderer(upBlade(20, 0), 5, 8) }])).toBeNull();
    expect(selectLitBeams(jet(), [{ id: "U", x: 0, z: 0, y: 0 }])).toBeNull();
  });

  it("paired lights are always kept (old behaviour), even when they miss", () => {
    const miss = aimedAt(2, 0, 0, 1, { id: "P", aimDir: [1, 0, 0], pairedNozzleId: "J1" });
    const beams = selectLitBeams(jet(), [miss]);
    expect(beams.map((b) => b.id)).toEqual(["P"]);
    expect(beams[0].paired).toBe(true);
  });

  it("Henyey–Greenstein: back-lit toward the viewer >> side-lit >> front-lit", () => {
    expect(scatterPhase(1)).toBeCloseTo((1 - SCATTER_G ** 2) / (1 - SCATTER_G) ** 3, 9);
    expect(scatterPhase(1)).toBeGreaterThan(scatterPhase(0));
    expect(scatterPhase(0)).toBeGreaterThan(scatterPhase(-1));
    const viewer = { x: 0, y: 1.6, z: -14 };
    const P = { x: 0, y: 3, z: 0 };
    const behind = forwardScatterFactor({ x: 2, y: 3.4, z: 8 }, P, viewer);   // light behind the jet
    const front = forwardScatterFactor({ x: 0, y: 1.2, z: -1.2 }, P, viewer);  // spot on the viewer's side
    expect(behind).toBeGreaterThan(5 * front);
    expect(forwardScatterFactor({ x: 2, y: 3, z: 8 }, P, null)).toBe(1);
  });

  it("ranking by E × phase keeps the back light and drops a weak front light", () => {
    const viewer = { x: 0, y: 1.6, z: -14 };
    const back = aimedAt(1, 8, 3.4, 2.5, { id: "BACK" });
    const front = aimedAt(1, -8, 3.4, 2.5, { id: "FRONT" });
    const cands = reachingLights(jet(), [front, back]);
    expect(cands).toHaveLength(2);
    expect(cands[0].lux).toBeCloseTo(cands[1].lux, 6);          // mirror images
    const ranked = rankLitBeams(jet(), cands, { viewer });
    expect(ranked.map((b) => b.id)).toEqual(["BACK"]);           // front < MIN_LIGHT_SHARE
    expect(ranked[0].scatter).toBeGreaterThan(1);
    expect(MIN_LIGHT_SHARE).toBeGreaterThan(0);
    // No viewer: both kept (equal weight).
    expect(rankLitBeams(jet(), cands).map((b) => b.id).sort()).toEqual(["BACK", "FRONT"]);
  });

  it("a single beam's scatter does not change its band (glow is a ratio of its own E)", () => {
    const L = beamRecordOf(aimedAt(0, 6, 0.5, 2, { beamAngleDeg: 30 }));
    const a = realBandOf({ ...jet(), litBeams: [L] }, 0, 3);
    const b = realBandOf({ ...jet(), litBeams: [{ ...L, scatter: 7.5 }] }, 0, 3);
    for (const k of ["lo", "hi", "soft", "glow"]) expect(b[k]).toBeCloseTo(a[k], 12);
  });
});

describe("exit turbulence and turbulent-surface break-up", () => {
  const smooth = (d, H, extra = {}) => ({ id: "S", type: "jet_3d", fixtureType: "nozzle_smooth_bore_jet_12mm", x: 0, z: 0,
    designHeightM: H, engineering: { nozzleDiaMm: d, jetHeightM: H, ...extra } });

  it("defaults by family, field wins and is clamped", () => {
    expect(exitTurbulenceOf(smooth(12, 4))).toEqual({ tu: TU_SMOOTH_BORE, source: "family" });
    expect(exitTurbulenceOf(jet({ engineering: { flowStraightener: true } }))).toEqual({ tu: TU_STRAIGHTENED, source: "family" });
    expect(exitTurbulenceOf({ type: "laminar", fixtureType: "nozzle_laminar_jet" }).tu).toBe(TU_STRAIGHTENED);
    expect(exitTurbulenceOf(jet())).toBeNull();                                          // unknown → current model
    expect(exitTurbulenceOf(jet({ engineering: { exitTurbulence: 0.08 } }))).toEqual({ tu: 0.08, source: "field" });
    expect(exitTurbulenceOf(jet({ engineering: { exitTurbulence: 0.5 } }))).toEqual({ tu: 0.2, source: "field", clamped: true });
  });

  it("uses x_b/d = 3.61·Tu^-0.275·We^0.334 above We = 8·Tu^-2", () => {
    const dM = 0.012, v = 8.86, tu = 0.06;
    const { We } = jetNumbers(dM, v);
    expect(turbulentBreakupLengthM(dM, v, tu)).toBeCloseTo(3.61 * tu ** -0.275 * We ** 0.334 * dM, 9);
    expect(turbulentWeberThreshold(0.06)).toBeCloseTo(8 / 0.0036, 6);
    const b = jetBreakupOf(smooth(12, 4));
    expect(b.model).toBe("turbulent-surface");
    expect(b.breakupLengthM).toBeCloseTo(turbulentBreakupLengthM(b.dM, b.v0, TU_SMOOTH_BORE), 9);
  });

  it("switches regime at We = 8·Tu^-2", () => {
    // 12 mm at 4 m: We ≈ 1.3e4. Tu = 0.02 → threshold 2e4 (laminar/GM path); Tu = 0.03 → 8.9e3 (turbulent).
    const below = jetBreakupOf(smooth(12, 4, { exitTurbulence: 0.02 }));
    const above = jetBreakupOf(smooth(12, 4, { exitTurbulence: 0.03 }));
    expect(below.We).toBeLessThan(turbulentWeberThreshold(0.02));
    expect(below.model).toBe("grant-middleman");
    expect(below.breakupLengthM).toBeCloseTo(breakupLengthM(below.dM, below.v0, false), 9);
    expect(above.We).toBeGreaterThan(turbulentWeberThreshold(0.03));
    expect(above.model).toBe("turbulent-surface");
  });

  it("crown width lands in 0.3–1.0 m for 10–16 mm jets at 2–6.5 m (estimate)", () => {
    for (const [d, H] of [[10, 2], [12, 3], [12, 4], [14, 4], [16, 6.5]]) {
      const head = dropletHeadOf(smooth(d, H), H);
      expect(head.widthEstimated).toBe(true);
      expect(head.widthM).toBeGreaterThanOrEqual(0.3);
      expect(head.widthM).toBeLessThanOrEqual(1.0);
    }
  });

  it("no exit turbulence: break-up and head unchanged", () => {
    const cfg = jet();
    const b = jetBreakupOf(cfg);
    expect(b.model).toBe("grant-middleman");
    expect(b.exitTurbulence).toBeUndefined();
    expect(b.breakupLengthM).toBeCloseTo(breakupLengthM(b.dM, b.v0, false), 12);
    const head = dropletHeadOf(cfg, 3);
    expect(head.widthEstimated).toBeUndefined();
    expect(Object.keys(head).sort()).toEqual(["breakupFraction", "density", "heightM", "kind", "widthM"]);
  });
});

describe("realism report", () => {
  it("lists framed lights, malformed blades, blades that cut everything, and turbulent crowns", () => {
    const fixtures = [
      { id: "P1", type: "light_projector_framing_5200lm", x: 5.5, y: 14,
        engineering: { lumens: 5200, beamAngleDeg: 30, mountHeightM: 3.4, aimDeg: 70, aimAzimuthDeg: 250,
          framing: { blades: [{ point: [5.5, 14, 2.6], normal: [0, 0, 1] }, { point: "x", normal: [0, 0, 1] }] } } },
      { id: "P2", type: "light_projector_framing_5200lm", x: -5.5, y: 14,
        engineering: { lumens: 5200, beamAngleDeg: 30, mountHeightM: 3.4, aimDeg: 70, aimAzimuthDeg: 290,
          // keeps only what is below the ground AND above 50 m: nothing
          framing: { blades: [{ point: [0, 0, 50], normal: [0, 0, 1] }, { point: [0, 0, -1], normal: [0, 0, -1] }] } } },
      { id: "S1", type: "nozzle_smooth_bore_jet_12mm", x: 0, y: 0, engineering: { nozzleDiaMm: 12, jetHeightM: 4, pressureBar: 0.48 } },
    ];
    const { nozzleConfigs, lightConfigs } = fixturesToNozzleConfigs(fixtures);
    const items = realismReport(nozzleConfigs, lightConfigs);
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(byId["framing:P1"].text).toMatch(/1 framing blade/);
    expect(byId["framing:P1"].text).toMatch(/point \(5\.5, 14, 2\.6\)/);
    expect(byId["framing-invalid:P1"].level).toBe("ignored");
    expect(byId["framing-blocked"].ids).toEqual(["P2"]);
    expect(byId["turbulent-crown"].text).toMatch(/crown width is an estimate — measure on site/);
    expect(byId["tu-family"].ids).toEqual(["S1"]);
  });

  it("bladesExcludeBeam is false for a sensible cut and without blades", () => {
    const L = aimedAt(5, 8, 3.4, 2.8);
    expect(bladesExcludeBeam(L)).toBe(false);
    expect(bladesExcludeBeam({ ...L, framing: framingForRenderer(upBlade(2.6), 5, 8) })).toBe(false);
  });

  it("realBandOf keeps BAND_OPEN semantics with framing", () => {
    const L = beamRecordOf(aimedAt(0, 6, 0.5, 3.5, { beamAngleDeg: 60, framing: framingForRenderer(upBlade(1, 0), 0, 6) }));
    const band = realBandOf({ ...jet(), litBeams: [L] }, 0, 3);
    expect(band.hi).toBe(BAND_OPEN);
  });
});
