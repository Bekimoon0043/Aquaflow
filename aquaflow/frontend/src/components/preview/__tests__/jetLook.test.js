/**
 * Lit top band + crown tuft (jetLook.js) and how nozzleEmitters.js applies them.
 */
import { describe, it, expect } from "vitest";
import {
  topLitFractionOf, columnGlowOf, crownTuftOf, hasJetLook, litBandFromFraction, beamHitBand,
  autoLitBand, jetBandOf, bandFactor, tuftProfile, tuftWeight, isAerated,
  DEFAULT_COLUMN_GLOW, BAND_OPEN, CROWN_DEFAULTS, TUFT_BASE, TUFT_MAX_WEIGHT, NO_BAND,
} from "../jetLook";
import {
  describeNozzleEmitters, sampleEmitterParticle, drawnApex, allocatePool, EMIT_MODE, EMIT_CLASS,
} from "../nozzleEmitters";
import { aimDirection } from "../elevatedNozzles";
import { launchSpeed } from "../jetPhysics";

const WIND = { x: 0, z: 0 };
const TINT = { r: 0.55, g: 0.8, b: 1.0 };
const DEG = 180 / Math.PI;
const describe1 = (cfg, ix = 1) => describeNozzleEmitters(cfg, ix, 0, WIND, TINT,
  cfg.designHeightM ? (d, fb) => launchSpeed(null, d, fb, null, cfg) : null);
const strip = (descs) => descs.filter((e) => e.role !== "tuft" && e.role !== "tuftShed")
  .map(({ band, ...rest }) => rest);   // eslint-disable-line no-unused-vars

// A canopy jet like the viewpoint tree's: 3.07 m, aimDeg 0, a spot 1.2 m in front aimed at its top.
// These tests cover the ARTISTIC preview (realWorld: false), where the free fields are
// honoured as set; real-world mode is covered by realWorldLook.test.js.
const H = 3.07;
const jet = (eng = {}) => ({ id: "B1", type: "jet_1d", x: 0, z: 0, designHeightM: H, realWorld: false,
  engineering: { jetHeightM: H, aimDeg: 0, aimAzimuthDeg: 0, ...eng } });
const spotFor = (dist = 1.2, h = H, beamAngleDeg = 11) => {
  const aim = Math.atan2(dist, h) * DEG;   // tilt from vertical, leaning back toward the jet (−z)
  return { x: 0, y: 0, z: dist, dir: aimDirection(aim, 270), beamAngleDeg };
};

describe("fields and defaults", () => {
  it("topLitFraction / columnGlow", () => {
    expect(topLitFractionOf({})).toBeNull();
    expect(topLitFractionOf({ engineering: { topLitFraction: 0.3 } })).toBe(0.3);
    expect(topLitFractionOf({ engineering: { topLitFraction: 4 } })).toBe(1);
    expect(topLitFractionOf({ topLitFraction: -1 })).toBe(0);
    expect(columnGlowOf({})).toBe(DEFAULT_COLUMN_GLOW);
    expect(DEFAULT_COLUMN_GLOW).toBe(0.22);
    expect(columnGlowOf({ engineering: { columnGlow: 0.4 } })).toBe(0.4);
  });

  it("crownTuft: true → defaults; object merged and clamped; density 0 → none", () => {
    expect(crownTuftOf({})).toBeNull();
    expect(crownTuftOf({ engineering: { crownTuft: true } })).toEqual({ ...CROWN_DEFAULTS });
    expect(CROWN_DEFAULTS).toEqual({ widthM: 0.9, heightM: 1.2, density: 1 });
    expect(crownTuftOf({ engineering: { crownTuft: { widthM: 1.1 } } })).toEqual({ widthM: 1.1, heightM: 1.2, density: 1 });
    expect(crownTuftOf({ engineering: { crownTuft: { density: 9 } } }).density).toBe(2);
    expect(crownTuftOf({ engineering: { crownTuft: { density: 0 } } })).toBeNull();
    expect(crownTuftOf({ engineering: { crownTuft: false } })).toBeNull();
  });

  it("hasJetLook only with a field (or paired beams)", () => {
    expect(hasJetLook({ engineering: { jetHeightM: 3 } })).toBe(false);
    expect(hasJetLook({ engineering: { topLitFraction: 0.3 } })).toBe(true);
    expect(hasJetLook({ engineering: { crownTuft: true } })).toBe(true);
    expect(hasJetLook({ litBeams: [spotFor()] })).toBe(true);
    expect(hasJetLook({ litBeams: [] })).toBe(false);
  });

  it("aerated jets", () => {
    expect(isAerated({ engineering: { aerated: true } })).toBe(true);
    expect(isAerated({ aerated: true })).toBe(true);
    expect(isAerated({ engineering: {} })).toBe(false);
  });
});

describe("band maths", () => {
  it("fraction → the top fraction of mount..apex is lit, ~10 % transition", () => {
    const b = litBandFromFraction(0, 4, 0.25);
    expect(b.lo).toBeCloseTo(3, 9);
    expect(b.hi).toBe(BAND_OPEN);
    expect(b.soft).toBeCloseTo(0.2, 9);       // ± 5 % of the height
    const m = litBandFromFraction(2, 6, 0.5);  // elevated: measured from the mount
    expect(m.lo).toBeCloseTo(4, 9);
    expect(litBandFromFraction(0, 4, 1).lo).toBe(0);
    expect(litBandFromFraction(0, 4, 0).lo).toBe(4);
  });

  it("bandFactor: 1 inside, 0 well below, smooth across", () => {
    const b = { ...litBandFromFraction(0, 4, 0.25), glow: 0.22 };
    expect(bandFactor(b, 3.5)).toBe(1);
    expect(bandFactor(b, 2.5)).toBe(0);
    expect(bandFactor(b, 3)).toBeCloseTo(0.5, 6);
    expect(bandFactor(NO_BAND, 0)).toBe(1);
    expect(bandFactor(NO_BAND, 500)).toBe(1);
    expect(bandFactor(null, 2)).toBe(1);
  });

  it("beamHitBand: a narrow spot beside the jet aimed at its top lights the top only", () => {
    const r = beamHitBand(spotFor(), { x: 0, z: 0, y0: 0, y1: H * 1.3 });
    expect(r).not.toBeNull();
    // The beam axis meets the jet at H; the 11° beam covers a band round it, not the base.
    expect(r.lo).toBeGreaterThan(0.5 * H);
    expect(r.lo).toBeLessThan(H);
    expect(r.hi).toBeGreaterThan(H);
    // Analytic lower edge: angle from the light to (0, y) equals aim + half-beam.
    const aim = Math.atan(1.2 / H), half = 5.5 / DEG;
    expect(r.lo).toBeCloseTo(1.2 / Math.tan(aim + half), 2);
    const upper = 1.2 / Math.tan(aim - half);
    if (upper < H * 1.3) expect(r.hi).toBeCloseTo(upper, 2);
  });

  it("beamHitBand: a beam that misses the jet → null; a vertical beam on the axis → whole jet", () => {
    const miss = { x: 3, y: 0, z: 0, dir: [1, 0.2, 0], beamAngleDeg: 10 };
    expect(beamHitBand(miss, { x: 0, z: 0, y0: 0, y1: 4 })).toBeNull();
    const up = { x: 0, y: 0, z: 0, dir: [0, 1, 0], beamAngleDeg: 20 };
    expect(beamHitBand(up, { x: 0, z: 0, y0: 0, y1: 4 })).toEqual({ lo: 0, hi: BAND_OPEN });
  });

  it("wider beams light a longer band", () => {
    const n = beamHitBand(spotFor(1.2, H, 8), { x: 0, z: 0, y0: 0, y1: 10 });
    const w = beamHitBand(spotFor(1.2, H, 24), { x: 0, z: 0, y0: 0, y1: 10 });
    expect(w.lo).toBeLessThan(n.lo);
  });

  it("autoLitBand / jetBandOf: paired beams unless topLitFraction is explicit", () => {
    const beams = [spotFor()];
    const cfg = { ...jet(), litBeams: beams };
    const a = autoLitBand(cfg, 0);
    expect(a.lo).toBeGreaterThan(0.5 * H);
    expect(autoLitBand(cfg, 0)).toBe(a);   // cached
    const b = jetBandOf(cfg, 0, H);
    expect(b.lo).toBe(a.lo);
    expect(b.glow).toBe(0.22);
    expect(b.soft).toBeCloseTo(0.05 * H, 9);
    const explicit = jetBandOf({ ...jet({ topLitFraction: 0.2 }), litBeams: beams }, 0, H);
    expect(explicit.lo).toBeCloseTo(0.8 * H, 9);
    expect(jetBandOf(jet(), 0, H)).toBeNull();
  });
});

describe("descriptors", () => {
  it("without the fields: no band, no tuft, no new keys", () => {
    for (const cfg of [jet(), { type: "jet_3d", x: 1, z: 2 }, { type: "geyser", x: 0, z: 0 }]) {
      for (const e of describe1(cfg)) {
        expect(e.band).toBeUndefined();
        expect(e.alphaGain).toBeUndefined();
        expect(e.role).toBeUndefined();
        expect(e.mode).not.toBe(EMIT_MODE.TUFT);
      }
    }
  });

  it("topLitFraction adds only a band; kinematics unchanged", () => {
    const plain = describe1(jet());
    const lit = describe1(jet({ topLitFraction: 0.3, columnGlow: 0.3 }));
    expect(strip(lit)).toEqual(plain);
    const apex = drawnApex(plain[0]).apexY;
    expect(apex).toBeGreaterThan(H * 0.95);
    for (const e of lit) {
      expect(e.band.lo).toBeCloseTo(0.7 * apex, 6);
      expect(e.band.hi).toBe(BAND_OPEN);
      expect(e.band.glow).toBe(0.3);
    }
  });

  it("paired aimed spot → automatic band from the beam", () => {
    const d = describe1({ ...jet(), litBeams: [spotFor()] });
    expect(d[0].band.lo).toBeGreaterThan(0.5 * H);
    expect(d[0].band.lo).toBeLessThan(H);
  });

  it("crownTuft adds a head and its shed droplets at the drawn apex", () => {
    const plain = describe1(jet());
    const d = describe1(jet({ crownTuft: true }));
    expect(strip(d)).toEqual(plain);
    const head = d.find((e) => e.role === "tuft"), shed = d.find((e) => e.role === "tuftShed");
    expect(head.mode).toBe(EMIT_MODE.TUFT);
    expect(head.cls).toBe(EMIT_CLASS.SPRAY);
    expect(head.aux).toBe(0);
    expect(shed.aux).toBe(1);
    const apex = drawnApex(plain[0]);
    expect(head.oy).toBeCloseTo(apex.apexY, 9);
    expect(head.p1).toBeCloseTo(0.9, 9);
    expect(head.p2).toBeCloseTo(1.2, 9);
    expect(head.band).toBeUndefined();   // the head is never dimmed
    expect(shed.band.lo).toBeCloseTo(apex.apexY - TUFT_BASE * 1.2, 9);   // sheds dim below the head
    // Present (density 0) when off, so the GPU pool layout never reshuffles.
    const off = describe1(jet({ crownTuft: true }), 0);
    expect(off.filter((e) => e.role).length).toBe(2);
    expect(off.find((e) => e.role === "tuft").density).toBe(0);
  });

  it("crown colour follows the paired light's tint when supplied", () => {
    const d = describe1({ ...jet({ crownTuft: true }), crownTint: { r: 0.02, g: 1, b: 0.05 } });
    const c = d.find((e) => e.role === "tuft").color;
    expect(c[1]).toBeGreaterThan(1);       // full brightness (HDR, blooms)
    expect(c[0]).toBeLessThan(0.2);
  });

  it("tuft particles fill a flame-shaped volume round the apex", () => {
    const head = describe1(jet({ crownTuft: { widthM: 1, heightM: 1.5 } })).find((e) => e.role === "tuft");
    let seed = 7;
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const p = {};
    let maxR = 0;
    for (let i = 0; i < 4000; i++) {
      sampleEmitterParticle(head, rand, null, p);
      const s = (p.y - head.oy) / head.p2 + TUFT_BASE;
      expect(s).toBeGreaterThanOrEqual(-1e-9);
      expect(s).toBeLessThanOrEqual(1 + 1e-9);
      const r = Math.hypot(p.x - head.ox, p.z - head.oz);
      expect(r).toBeLessThanOrEqual(0.5 * head.p1 * tuftProfile(s) * 1.5 + 1e-9);
      maxR = Math.max(maxR, r);
      expect(Math.abs(p.vx)).toBeLessThan(1);   // slow
      expect(p.life).toBeLessThan(0.7);         // short-lived
    }
    expect(maxR).toBeGreaterThan(0.4);
  });

  it("tuft profile: wider in the middle, rounded (closed) top", () => {
    expect(tuftProfile(0.45)).toBeGreaterThan(tuftProfile(0.05));
    expect(tuftProfile(0.45)).toBeGreaterThan(tuftProfile(0.9));
    expect(tuftProfile(1)).toBeCloseTo(0, 6);
    expect(tuftProfile(0.45)).toBeLessThanOrEqual(1);
  });

  it("tuft weights are bounded and scale with density", () => {
    const w1 = tuftWeight(crownTuftOf({ crownTuft: true }));
    const w2 = tuftWeight(crownTuftOf({ crownTuft: { density: 2 } }));
    expect(w2).toBe(2 * w1);
    expect(tuftWeight(crownTuftOf({ crownTuft: { density: 2, widthM: 5, heightM: 6 } }))).toBeLessThanOrEqual(TUFT_MAX_WEIGHT);
    expect(tuftWeight(null)).toBe(0);
    // A 42-jet canopy shares a fixed pool: no tuft takes more than its weight's share.
    const descs = [];
    for (let i = 0; i < 42; i++) descs.push(...describe1({ ...jet({ crownTuft: { density: 2 } }), x: i * 0.6 })
      .filter((e) => e.cls === EMIT_CLASS.SPRAY));
    const ranges = allocatePool(descs, 65536);
    expect(ranges.reduce((s, r) => s + r.count, 0)).toBe(65536);
    const heads = descs.map((e, i) => (e.role === "tuft" ? ranges[i].count : null)).filter((n) => n != null);
    expect(Math.max(...heads) - Math.min(...heads)).toBeLessThanOrEqual(2);
  });

  it("aerated geyser (foam jet): wider, whiter core plus a froth sheath reaching ~the column top", () => {
    const base = { type: "geyser", x: 0, z: 0, designHeightM: 2, engineering: { jetHeightM: 2 } };
    const plain = describe1(base);
    const foam = describe1({ ...base, aerated: true });
    expect(foam.length).toBe(plain.length + 1);
    expect(foam[0].spawnRadius).toBeGreaterThan(plain[0].spawnRadius);
    expect(foam[0].color[0]).toBeGreaterThan(plain[0].color[0]);
    const froth = foam.find((e) => e.role === "froth");
    expect(froth.cls).toBe(EMIT_CLASS.SPRAY);
    const a = drawnApex(froth).apexY, top = drawnApex(foam[0]).apexY;
    expect(a).toBeGreaterThan(0.8 * top);
    expect(a).toBeLessThan(1.05 * top);
  });
});
