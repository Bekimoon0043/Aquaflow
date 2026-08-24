import { describe, it, expect } from "vitest";
import {
  SplashMap, heatColor, insidePool, litresPerImpact, DEFAULT_DRY_TAU_S,
} from "../splashMap";

describe("insidePool", () => {
  it("tests a circular basin by radius", () => {
    const pool = { type: "circular", radius: 5 };
    expect(insidePool(0, 0, pool)).toBe(true);
    expect(insidePool(4.9, 0, pool)).toBe(true);
    expect(insidePool(5.1, 0, pool)).toBe(false);
    // The corner of the bounding box must be OUTSIDE a circle — the case a naive
    // box test gets wrong, and precisely where deck wetting happens.
    expect(insidePool(4, 4, pool)).toBe(false);
  });

  it("tests a rectangular basin by half-extents", () => {
    const pool = { type: "rect", width: 10, length: 6 };
    expect(insidePool(0, 0, pool)).toBe(true);
    expect(insidePool(4.9, 2.9, pool)).toBe(true);
    expect(insidePool(5.1, 0, pool)).toBe(false);
    expect(insidePool(0, 3.1, pool)).toBe(false);
  });

  it("treats a missing pool as no containment", () => {
    expect(insidePool(0, 0, null)).toBe(false);
  });
});

describe("litresPerImpact", () => {
  it("converts solved flow and spawn rate into litres per droplet", () => {
    // 600 L/min = 10 L/s, depicted with 100 particles/s → 0.1 L per particle.
    expect(litresPerImpact(600, 100)).toBeCloseTo(0.1, 10);
  });

  it("refuses to guess when either input is missing or nonsensical", () => {
    expect(litresPerImpact(0, 100)).toBeNull();
    expect(litresPerImpact(600, 0)).toBeNull();
    expect(litresPerImpact(NaN, 100)).toBeNull();
    expect(litresPerImpact(600, null)).toBeNull();
    expect(litresPerImpact(-5, 100)).toBeNull();
  });
});

describe("SplashMap deposition", () => {
  it("only wets the deck — water landing in the basin joins the pool", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    m.deposit(1, 1, 1, true);          // into the water
    expect(m.peakWetness()).toBe(0);   // deck stays dry
    expect(m.totalImpacts).toBe(1);
    expect(m.outsideImpacts).toBe(0);

    m.deposit(8, 8, 1, false);         // onto the deck
    expect(m.peakWetness()).toBeGreaterThan(0);
    expect(m.outsideImpacts).toBe(1);
  });

  it("records every impact in the cumulative field regardless of where it lands", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    m.deposit(0, 0, 1, true);
    m.deposit(5, 5, 1, false);
    const sum = m.accum.reduce((a, b) => a + b, 0);
    // Bilinear splitting must conserve the deposited weight, not amplify it.
    expect(sum).toBeCloseTo(2, 6);
  });

  it("counts impacts outside the mapped square but cannot place them", () => {
    const m = new SplashMap({ extent: 10, resolution: 16 });
    const placed = m.deposit(500, 500, 1, false);
    expect(placed).toBe(false);
    expect(m.totalImpacts).toBe(1);      // still real water that left the basin
    expect(m.outsideImpacts).toBe(1);
    expect(m.peakAccum()).toBe(0);       // but nothing to draw
  });

  it("rejects malformed impacts rather than corrupting the grid", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    expect(m.deposit(NaN, 0, 1, false)).toBe(false);
    expect(m.deposit(0, Infinity, 1, false)).toBe(false);
    expect(m.deposit(0, 0, 0, false)).toBe(false);
    expect(m.totalImpacts).toBe(0);
    expect(m.accum.every(v => Number.isFinite(v))).toBe(true);
  });

  it("saturates wetness at fully wet rather than growing without bound", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    for (let i = 0; i < 500; i++) m.deposit(6, 6, 1, false);
    expect(m.peakWetness()).toBeLessThanOrEqual(1);
    expect(m.peakWetness()).toBeCloseTo(1, 6);
  });
});

describe("SplashMap drying", () => {
  it("decays exponentially with the documented time constant", () => {
    const m = new SplashMap({ extent: 20, resolution: 32, dryTauS: 10 });
    for (let i = 0; i < 50; i++) m.deposit(6, 6, 1, false);
    const start = m.peakWetness();
    expect(start).toBeCloseTo(1, 6);

    m.dry(10);   // exactly one time constant
    expect(m.peakWetness()).toBeCloseTo(start * Math.exp(-1), 3);
  });

  it("reaches fully dry rather than leaving a permanent stain", () => {
    const m = new SplashMap({ extent: 20, resolution: 32, dryTauS: 2 });
    m.deposit(6, 6, 1, false);
    for (let i = 0; i < 200; i++) m.dry(1);
    expect(m.peakWetness()).toBe(0);
    expect(m.wet.every(v => v === 0)).toBe(true);
  });

  it("keeps the cumulative analysis record while the deck dries", () => {
    const m = new SplashMap({ extent: 20, resolution: 32, dryTauS: 1 });
    m.deposit(6, 6, 1, false);
    const accumBefore = m.peakAccum();
    for (let i = 0; i < 100; i++) m.dry(1);
    // Drying is a surface effect. It must not erase the containment evidence.
    expect(m.peakAccum()).toBeCloseTo(accumBefore, 10);
  });

  it("ignores a non-advancing or negative timestep", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    m.deposit(6, 6, 1, false);
    const before = m.peakWetness();
    m.dry(0); m.dry(-5);
    expect(m.peakWetness()).toBe(before);
    expect(m.elapsedS).toBe(0);
  });

  it("defaults to the exported drying time constant", () => {
    expect(new SplashMap().dryTauS).toBe(DEFAULT_DRY_TAU_S);
  });
});

describe("SplashMap containment", () => {
  it("reports the fraction of water that left the basin", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    for (let i = 0; i < 75; i++) m.deposit(1, 1, 1, true);
    for (let i = 0; i < 25; i++) m.deposit(8, 0, 1, false);
    const c = m.containment();
    expect(c.fractionOutside).toBeCloseTo(0.25, 6);
    expect(c.percentOutside).toBeCloseTo(25, 6);
  });

  it("returns null volumes — never a fabricated litre — when uncalibrated", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    m.deposit(8, 0, 1, false);
    m.dry(1);
    const c = m.containment();
    expect(c.calibrated).toBe(false);
    expect(c.spillLpm).toBeNull();
    expect(c.containedLpm).toBeNull();
    expect(c.peakWettingLpmPerM2).toBeNull();
  });

  it("converts to real litres per minute once calibrated against solved flow", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    m.setCalibration(0.5);              // half a litre per impact
    for (let i = 0; i < 120; i++) m.deposit(8, 0, 1, false);
    m.dry(60);                          // one minute of show
    const c = m.containment();
    expect(c.calibrated).toBe(true);
    // 120 impacts x 0.5 L over 1 minute = 60 L/min leaving the basin.
    expect(c.spillLpm).toBeCloseTo(60, 6);
  });

  it("separates contained flow from spill", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    m.setCalibration(1);
    for (let i = 0; i < 90; i++) m.deposit(1, 1, 1, true);
    for (let i = 0; i < 10; i++) m.deposit(8, 0, 1, false);
    m.dry(60);
    const c = m.containment();
    expect(c.spillLpm).toBeCloseTo(10, 6);
    expect(c.containedLpm).toBeCloseTo(90, 6);
  });

  it("rejects a nonsensical calibration instead of applying it", () => {
    const m = new SplashMap({ extent: 20, resolution: 32 });
    m.setCalibration(-1);
    expect(m.litresPerImpact).toBeNull();
    m.setCalibration(NaN);
    expect(m.litresPerImpact).toBeNull();
  });

  it("reports peak wetting rate per square metre for drain sizing", () => {
    const m = new SplashMap({ extent: 32, resolution: 128 });
    m.setCalibration(1);
    for (let i = 0; i < 60; i++) m.deposit(8, 8, 1, false);
    m.dry(60);
    const c = m.containment();
    // Concentrated on one spot, so the peak cell must exceed the map-wide average.
    expect(c.peakWettingLpmPerM2).toBeGreaterThan(0);
    expect(Number.isFinite(c.peakWettingLpmPerM2)).toBe(true);
  });
});

describe("SplashMap textures", () => {
  it("writes an opaque greyscale wetness buffer", () => {
    const m = new SplashMap({ extent: 20, resolution: 8 });
    m.deposit(0, 0, 1, false);
    const buf = new Uint8Array(8 * 8 * 4);
    m.writeWetRGBA(buf);
    for (let i = 0; i < 64; i++) {
      expect(buf[i * 4]).toBe(buf[i * 4 + 1]);
      expect(buf[i * 4 + 1]).toBe(buf[i * 4 + 2]);
      expect(buf[i * 4 + 3]).toBe(255);
    }
    expect(Math.max(...buf.filter((_, i) => i % 4 === 0))).toBeGreaterThan(0);
  });

  it("leaves untouched heatmap cells fully transparent", () => {
    const m = new SplashMap({ extent: 20, resolution: 8 });
    m.deposit(0, 0, 1, false);
    const buf = new Uint8Array(8 * 8 * 4);
    m.writeHeatRGBA(buf);
    const alphas = [];
    for (let i = 0; i < 64; i++) alphas.push(buf[i * 4 + 3]);
    expect(alphas.some(a => a === 0)).toBe(true);    // dry ground shows through
    expect(alphas.some(a => a > 0)).toBe(true);      // wetted ground is painted
  });

  it("produces an empty heatmap when nothing has landed", () => {
    const m = new SplashMap({ extent: 20, resolution: 8 });
    const buf = new Uint8Array(8 * 8 * 4);
    m.writeHeatRGBA(buf);
    for (let i = 0; i < 64; i++) expect(buf[i * 4 + 3]).toBe(0);
  });
});

describe("heatColor", () => {
  it("stays in range and clamps beyond the ends", () => {
    for (const t of [-1, 0, 0.25, 0.5, 0.75, 1, 2]) {
      const c = heatColor(t);
      expect(c).toHaveLength(3);
      for (const ch of c) {
        expect(ch).toBeGreaterThanOrEqual(0);
        expect(ch).toBeLessThanOrEqual(255);
        expect(Number.isInteger(ch)).toBe(true);
      }
    }
  });

  it("rises monotonically in luminance so it survives greyscale and colour deficiency", () => {
    const lum = t => {
      const [r, g, b] = heatColor(t);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let prev = -1;
    for (let t = 0; t <= 0.75001; t += 0.05) {
      const l = lum(t);
      expect(l).toBeGreaterThan(prev);
      prev = l;
    }
  });
});

describe("SplashMap reset", () => {
  it("clears wetness, the record and the clock together", () => {
    const m = new SplashMap({ extent: 20, resolution: 16 });
    m.deposit(5, 5, 1, false);
    m.dry(1);
    m.reset();
    expect(m.totalImpacts).toBe(0);
    expect(m.outsideImpacts).toBe(0);
    expect(m.elapsedS).toBe(0);
    expect(m.peakWetness()).toBe(0);
    expect(m.peakAccum()).toBe(0);
  });
});
