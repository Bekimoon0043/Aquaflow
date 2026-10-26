/**
 * Real-world simulation (realWorldLook.js): jet break-up / heads from the product,
 * overrides ignored (real-world) vs honoured (artistic), light band and spill from the
 * light's geometry, the realism report, and the artistic stamp layout.
 */
import { describe, it, expect } from "vitest";
import {
  jetFamilyOf, JET_FAMILY, outletOf, launchVelocityOf, jetNumbers, breakupLengthM, riseBreakup,
  jetBreakupOf, dropletHeadOf, physicalCrownOf, effectiveCrownOf, aeratedLookOf, hasLookFeatures,
  beamProfile, beamIlluminance, realBandOf, effectiveBandOf, columnDimOf, realismReport, lumensOf,
  AMBIENT_NIGHT, HALO, APEX_SWELL, LM_PER_W,
} from "../realWorldLook";
import { autoLitBand, BAND_OPEN, crownTuftOf } from "../jetLook";
import { describeNozzleEmitters, drawnApex, EMIT_MODE } from "../nozzleEmitters";
import { aimDirection } from "../elevatedNozzles";
import { launchSpeed } from "../jetPhysics";
import { fixturesToNozzleConfigs } from "../../../hooks/fixtureTypeMap";
import { stampLayout } from "../artisticStamp";

const WIND = { x: 0, z: 0 };
const TINT = { r: 0.55, g: 0.8, b: 1.0 };
const DEG = 180 / Math.PI;
const describe1 = (cfg, ix = 1) => describeNozzleEmitters(cfg, ix, 0, WIND, TINT,
  cfg.designHeightM ? (d, fb) => launchSpeed(null, d, fb, null, cfg) : null);
const roles = (d) => d.map((e) => e.role).filter(Boolean);
const round = (v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : Array.isArray(v) ? v.map(round)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);

// The viewpoint tree's canopy jet: generic DN15 straight jet, 12 mm bore, 0.293 bar, 2.224 m.
const LANCE_ENG = { flowLpm: 46.018, pressureBar: 0.293, jetHeightM: 2.224, nozzleDiaMm: 12, connectionSize: "DN15",
  sprayAngleDeg: 6, group: "Straight Jet", aimDeg: 0, aimAzimuthDeg: 0,
  dataSource: "AquaFlow generic template — verify with the supplier datasheet" };
const lance = (eng = {}, extra = {}) => ({ id: "A1", type: "jet_1d", fixtureType: "nozzle_straight_jet_dn15",
  x: 0, z: 0, designHeightM: 2.224, engineering: { ...LANCE_ENG, ...eng }, ...extra });
const FOAM_ENG = { flowLpm: 31.27, pressureBar: 0.184, jetHeightM: 1.16, nozzleDiaMm: 12.5, connectionSize: "DN25",
  sprayAngleDeg: 20, group: "Foam Jet" };
const foam = (eng = {}, extra = {}) => ({ id: "T1", type: "geyser", fixtureType: "nozzle_foam_jet_dn25", aerated: true,
  x: 0, z: 0, designHeightM: 1.16, engineering: { ...FOAM_ENG, ...eng }, ...extra });
const spotFor = (dist, h, beamAngleDeg, more = {}) => ({
  x: 0, y: 0, z: dist, dir: aimDirection(Math.atan2(dist, h) * DEG, 270), beamAngleDeg, ...more,
});

describe("nozzle family from the product", () => {
  it("type key / group / 3D type", () => {
    expect(jetFamilyOf(lance())).toBe(JET_FAMILY.CLEAR);
    expect(jetFamilyOf(foam())).toBe(JET_FAMILY.AERATED);
    expect(jetFamilyOf({ type: "geyser", engineering: { group: "Foam & Frothy Jets (catalogue)" } })).toBe(JET_FAMILY.AERATED);
    expect(jetFamilyOf({ type: "geyser", fixtureType: "nozzle_ice_tower_dn40_longxin" })).toBe(JET_FAMILY.AERATED);
    expect(jetFamilyOf({ type: "laminar", engineering: { group: "Laminar" } })).toBe(JET_FAMILY.LAMINAR);
    expect(jetFamilyOf({ type: "sphere", fixtureType: "nozzle_mushroom_g2_saferain" })).toBe(JET_FAMILY.BELL);
    expect(jetFamilyOf({ type: "mist", engineering: { group: "Fog" } })).toBe(JET_FAMILY.MIST);
    expect(jetFamilyOf({ type: "fan_jet", engineering: { group: "Fan Jet" } })).toBe(JET_FAMILY.SPRAY);
    expect(jetFamilyOf({ type: "jet_3d" })).toBe(JET_FAMILY.CLEAR);
    expect(jetFamilyOf({ type: "geyser" })).toBe(JET_FAMILY.OTHER);   // no product data: unchanged look
  });

  it("outlet and launch velocity", () => {
    expect(outletOf(lance())).toEqual({ mm: 12, source: "nozzleDiaMm", estimated: false });
    expect(outletOf(lance({ outletDiaMm: 14 })).mm).toBe(14);
    expect(outletOf({ engineering: { connectionSize: "DN25" } })).toEqual({ mm: 25, source: "DN", estimated: true });
    expect(outletOf({ engineering: {} })).toBeNull();
    const v = launchVelocityOf(lance());
    expect(v.source).toBe("pressure");
    expect(v.v).toBeCloseTo(0.97 * Math.sqrt(2 * 0.293e5 / 998), 9);   // ≈ 7.43 m/s
    const vh = launchVelocityOf({ designHeightM: 2, engineering: {} });
    expect(vh).toEqual({ v: Math.sqrt(2 * 9.81 * 2), source: "height" });
  });
});

describe("break-up model", () => {
  it("dimensionless groups and regimes", () => {
    const n = jetNumbers(0.012, 7.43);
    expect(n.We).toBeCloseTo(998 * 7.43 ** 2 * 0.012 / 0.0728, 6);
    expect(n.We).toBeGreaterThan(9000);
    expect(n.regime).toBe("first-wind");         // Weg ≈ 10.9
    expect(n.Oh).toBeLessThan(0.002);
    expect(jetNumbers(0.003, 1).regime).toBe("rayleigh");
    expect(jetNumbers(0.03, 25).regime).toBe("atomisation");
  });

  it("Grant & Middleman turbulent length; laminar (Rayleigh) jets are far longer", () => {
    const L = breakupLengthM(0.012, 7.43);
    const We = jetNumbers(0.012, 7.43).We;
    expect(L).toBeCloseTo(8.51 * We ** 0.32 * 0.012, 9);   // ≈ 1.89 m
    expect(L).toBeGreaterThan(1.7);
    expect(L).toBeLessThan(2.1);
    expect(breakupLengthM(0.012, 7.43, true)).toBeGreaterThan(4 * L);
  });

  it("rising jet: breaks at y = v τ − ½ g τ²; intact when τ ≥ v/g", () => {
    const r = riseBreakup(1.89, 7.43);
    expect(r.intact).toBe(false);
    expect(r.yB).toBeCloseTo(7.43 * r.tau - 0.5 * 9.81 * r.tau ** 2, 9);
    expect(r.fraction).toBeGreaterThan(0.5);
    expect(r.fraction).toBeLessThan(0.62);
    expect(riseBreakup(50, 5)).toMatchObject({ intact: true, fraction: 1 });
  });

  it("the viewpoint lance jet: coherent to ~56 %, then a narrow droplet head", () => {
    const b = jetBreakupOf(lance());
    expect(b.family).toBe(JET_FAMILY.CLEAR);
    expect(b.breakupFraction).toBeCloseTo(0.56, 1);
    const head = dropletHeadOf(lance(), 2.224);
    expect(head.kind).toBe("droplets");
    // width = 4 d + 2 (1 − f) H tan 3°  ≈ 0.15 m — a fifth of the 0.79 m free tuft.
    const span = (1 - b.breakupFraction) * 2.224;
    expect(head.widthM).toBeCloseTo(APEX_SWELL * 0.012 + 2 * span * Math.tan(3 / DEG), 9);
    expect(head.widthM).toBeLessThan(0.2);
    expect(head.heightM).toBeCloseTo(span, 9);
  });

  it("higher pressure breaks relatively lower; a bigger bore stays coherent longer", () => {
    const f = (eng) => jetBreakupOf(lance(eng)).breakupFraction;
    expect(f({ pressureBar: 1.0 })).toBeLessThan(f({ pressureBar: 0.293 }));
    expect(f({ pressureBar: 3.0 })).toBeLessThan(f({ pressureBar: 1.0 }));
    expect(f({ nozzleDiaMm: 25 })).toBeGreaterThan(f({ nozzleDiaMm: 12 }));
    expect(f({ nozzleDiaMm: 6 })).toBeLessThan(f({ nozzleDiaMm: 12 }));
    // heads widen with the broken span
    const w = (eng, H) => dropletHeadOf(lance(eng), H).widthM;
    expect(w({ pressureBar: 3 }, 20)).toBeGreaterThan(w({}, 2.224));
  });

  it("laminar jets stay glassy (no head); foam and other families have no break-up", () => {
    const lam = { type: "laminar", designHeightM: 2, engineering: { group: "Laminar", nozzleDiaMm: 10, pressureBar: 0.25 } };
    expect(jetBreakupOf(lam).intact).toBe(true);
    expect(dropletHeadOf(lam, 2)).toBeNull();
    expect(jetBreakupOf(foam())).toBeNull();
    expect(jetBreakupOf({ type: "mist", engineering: { nozzleDiaMm: 1, pressureBar: 70 } })).toBeNull();
    expect(jetBreakupOf({ type: "jet_1d", designHeightM: 3 })).toBeNull();   // no outlet → not modelled
  });

  it("aerated: white column from the family; crown sized from the product", () => {
    expect(aeratedLookOf({ type: "geyser", engineering: { group: "Foam & Frothy Jets (catalogue)" } })).toBe(true);
    expect(aeratedLookOf({ type: "geyser", realWorld: false, engineering: { group: "Foam & Frothy Jets (catalogue)" } })).toBe(false);
    const c = physicalCrownOf(foam());
    const D = 2.5 * 12.5 / 1000;
    expect(c.widthM).toBeCloseTo(2 * D + 0.3 * 1.16 * Math.tan(10 / DEG), 9);
    expect(c.heightM).toBeCloseTo(0.15 * 1.16 + D, 9);
    // A bigger foam nozzle → a bigger head.
    expect(physicalCrownOf(foam({ nozzleDiaMm: 40, jetHeightM: 5 }), 5).widthM).toBeGreaterThan(c.widthM);
    expect(physicalCrownOf(lance())).toBeNull();
    expect(physicalCrownOf({ type: "sphere", fixtureType: "nozzle_mushroom_g2_saferain", engineering: { diameterM: 1.6 } }).widthM).toBe(1.6);
  });
});

describe("overrides: ignored in real-world mode, honoured in artistic mode", () => {
  const TUFT = { widthM: 0.791, heightM: 1.041, density: 1.2 };

  it("crownTuft on a clear lance jet → the physical droplet head, not the tuft", () => {
    const cfg = lance({ crownTuft: TUFT, topLitFraction: 0.491, columnGlow: 0.18 });
    expect(effectiveCrownOf(cfg)).toBeNull();
    const d = describe1(cfg);
    expect(roles(d)).toEqual(["breakupHead", "breakupShed"]);
    const head = d.find((e) => e.role === "breakupHead");
    expect(head.mode).toBe(EMIT_MODE.TUFT);
    expect(head.p1).toBeLessThan(0.2);
    // Its top sits just above the drawn apex; the zone reaches down to the break-up height.
    const apex = drawnApex(d[0]).apexY;
    expect(head.oy + 0.4 * head.p2).toBeCloseTo(apex + 0.05 * head.p2, 9);
    expect(head.oy - 0.6 * head.p2).toBeLessThan(0.6 * apex);
    // topLitFraction ignored: no aimed light → no band at all.
    for (const e of d) expect(e.band).toBeUndefined();
  });

  it("the same jet in artistic mode draws the free tuft and band", () => {
    const cfg = lance({ crownTuft: TUFT, topLitFraction: 0.491, columnGlow: 0.18 }, { realWorld: false });
    expect(effectiveCrownOf(cfg)).toEqual(crownTuftOf(cfg));
    const d = describe1(cfg);
    expect(roles(d)).toEqual(["tuft", "tuftShed"]);
    expect(d.find((e) => e.role === "tuft").p1).toBeCloseTo(0.791, 9);
    expect(d[0].band.glow).toBe(0.18);
  });

  it("crownTuft on a foam jet → a product-sized froth head (free size ignored)", () => {
    const cfg = foam({ crownTuft: { widthM: 2.5, heightM: 3 } });
    const c = effectiveCrownOf(cfg);
    expect(c.kind).toBe("froth");
    expect(c.widthM).toBeCloseTo(physicalCrownOf(cfg).widthM, 9);
    const d = describe1(cfg);
    const tuft = d.find((e) => e.role === "tuft");
    // Sized at the DRAWN height (≈ the 1.16 m design height).
    expect(tuft.p1).toBeCloseTo(physicalCrownOf(cfg, drawnApex(d[0]).apexY).widthM, 9);
    expect(tuft.p1).toBeCloseTo(c.widthM, 1);
    expect(describe1({ ...cfg, realWorld: false }).find((e) => e.role === "tuft").p1).toBeCloseTo(2.5, 9);
  });

  it("columnDimOf: artistic uses columnGlow; real-world uses the computed band glow", () => {
    const art = lance({ topLitFraction: 0.3, columnGlow: 0.4 }, { realWorld: false });
    expect(columnDimOf(art, null)).toBe(0.4);
    expect(columnDimOf(lance({ columnGlow: 0.4 }), null)).toBe(1);
    expect(columnDimOf(lance(), { glow: 0.11 })).toBe(0.11);
  });
});

describe("absent fields → descriptors identical to the current physics path", () => {
  const CASES = [
    { type: "jet_3d", x: 1, z: 2, tiltX: 10 },
    { type: "jet_1d", x: -1, z: 0 },
    { type: "fan_jet", x: 0, z: 1, rotation: 30 },
    { type: "geyser", x: 0, z: 0, designHeightM: 2, engineering: { jetHeightM: 2 } },
    { type: "geyser", x: 0, z: 0, aerated: true, designHeightM: 2, engineering: { jetHeightM: 2 } },
    { type: "mist", x: 3, z: -1 },
    { type: "jet_3d", x: 1, z: 2, designHeightM: 6, engineering: { jetHeightM: 6 } },
    { type: "cascade", x: 0, z: 0, designHeightM: 2.5, engineering: { jetHeightM: 2.5 } },
    { type: "laminar", x: 0, z: 0, designHeightM: 2, engineering: { jetHeightM: 2, nozzleDiaMm: 10, pressureBar: 0.25, group: "Laminar" } },
  ];
  for (const cfg of CASES) {
    it(`${cfg.type}${cfg.designHeightM ? ` @${cfg.designHeightM} m` : ""}${cfg.aerated ? " aerated" : ""}`, () => {
      expect(hasLookFeatures(cfg)).toBe(false);
      expect(round(describe1(cfg, 0.8))).toEqual(round(describe1({ ...cfg, realWorld: false }, 0.8)));
    });
  }

  it("a clear jet WITH an outlet only gains the break-up head; its other emitters are unchanged", () => {
    const base = { type: "jet_3d", x: 1, z: 2, designHeightM: 6, engineering: { jetHeightM: 6 } };
    const withOutlet = { ...base, engineering: { ...base.engineering, nozzleDiaMm: 16, pressureBar: 0.9 } };
    const rw = describe1(withOutlet, 0.8);
    expect(roles(rw)).toEqual(["breakupHead", "breakupShed"]);
    expect(round(rw.filter((e) => !e.role))).toEqual(round(describe1(base, 0.8)));
    // Tilted jets (arcs) form no apex head.
    const arc = { ...withOutlet, tiltX: 30 };
    expect(roles(describe1(arc, 0.8))).toEqual([]);
  });
});

describe("light on water: band, soft edge and spill from the light's geometry", () => {
  const H = 2.224;
  const cfgWith = (beams, eng = {}) => ({ ...lance(eng), litBeams: beams });

  it("beam profile: 1 on axis, ≈ ½ at the beam edge, small halo far outside", () => {
    const h = 5.5 / DEG;
    expect(beamProfile(0, h)).toBeCloseTo(1, 9);
    expect(beamProfile(h, h)).toBeCloseTo(0.5 * (1 - HALO) + HALO * Math.cos(h), 9);
    expect(beamProfile(4 * h, h)).toBeLessThan(0.03);
    expect(beamProfile(4 * h, h)).toBeGreaterThan(0.015);
  });

  it("illuminance: inverse square on axis, scales with lumens, concentrates in narrow beams", () => {
    const up = (deg, more) => ({ x: 0, y: 0, z: 0, dir: [0, 1, 0], beamAngleDeg: deg, ...more });
    const e1 = beamIlluminance(up(11, { lumens: 733 }), 0, 1, 0), e2 = beamIlluminance(up(11, { lumens: 733 }), 0, 2, 0);
    expect(e1 / e2).toBeCloseTo(4, 6);
    expect(beamIlluminance(up(11, { lumens: 1466 }), 0, 2, 0) / e2).toBeCloseTo(2, 6);
    expect(beamIlluminance(up(11, { lumens: 733 }), 0, 2, 0)).toBeGreaterThan(20 * beamIlluminance(up(56, { lumens: 733 }), 0, 2, 0));
    expect(lumensOf({ wattage: 18 })).toEqual({ lm: 18 * LM_PER_W, estimated: true });
    expect(lumensOf({ lumens: 733 })).toEqual({ lm: 733, estimated: false });
  });

  it("narrow 11° spot aimed at the top: band from the beam, soft edge from the field angle, dark spill below", () => {
    const beams = [spotFor(1.2, H, 11, { wattage: 18 })];
    const cfg = cfgWith(beams);
    const band = realBandOf(cfg, 0, H);
    const b50 = autoLitBand(cfg, 0);
    expect(band.lo).toBe(b50.lo);
    expect(band.lo).toBeGreaterThan(0.5 * H);
    expect(band.soft).toBeGreaterThan(0.05);   // the field angle widens the edge beyond the 2 cm minimum
    expect(band.glow).toBeGreaterThanOrEqual(AMBIENT_NIGHT);
    expect(band.glow).toBeLessThan(0.2);       // darker than the old fixed 0.22 column
    expect(realBandOf(cfg, 0, H)).toBe(band);  // cached
    // effectiveBandOf: real-world → this band; artistic → jetLook (fixed glow 0.22).
    expect(effectiveBandOf(cfg, 0, H)).toBe(band);
    expect(effectiveBandOf({ ...cfg, realWorld: false }, 0, H).glow).toBe(0.22);
  });

  it("a wider beam spills more light onto the column (higher glow)", () => {
    const g = (deg) => realBandOf(cfgWith([spotFor(1.2, H, deg)]), 0, H).glow;
    expect(g(30)).toBeGreaterThan(g(11));
    expect(g(60)).toBeGreaterThan(g(30));
  });

  it("descriptors carry the real band (column, droplet head and its shed)", () => {
    const d = describe1(cfgWith([spotFor(1.2, H, 11)], { crownTuft: true }));
    const band = d[0].band;
    expect(band.lo).toBeGreaterThan(0.5 * H);
    for (const e of d) expect(e.band).toBe(band);
  });

  it("paired lights that miss the jet leave the whole column unlit (ambient only)", () => {
    const miss = { x: 3, y: 0, z: 0, dir: [1, 0.2, 0], beamAngleDeg: 10 };
    const band = realBandOf(cfgWith([miss]), 0, H);
    expect(band.lo).toBeGreaterThan(1e4);
    expect(band.hi).toBe(BAND_OPEN);
    expect(band.glow).toBe(AMBIENT_NIGHT);
  });
});

describe("realism report", () => {
  // A cut-down viewpoint tree: 82 lance jets with tufts and top bands, 4 foam trunks, spots.
  const fixtures = [];
  for (let i = 0; i < 82; i++) {
    fixtures.push({ id: `A${i}`, type: "nozzle_straight_jet_dn15", x: i * 0.1, y: 3,
      engineering: { ...LANCE_ENG, crownTuft: { widthM: 0.791, heightM: 1.041, density: 1.2 }, topLitFraction: 0.491, columnGlow: 0.18 } });
    fixtures.push({ id: `A${i}-spot`, type: "light_uw_rgb_18w", x: i * 0.1, y: 4.2,
      engineering: { wattage: 18, beamAngleDeg: 11, pairedNozzleId: `A${i}`, aimDeg: 28, aimAzimuthDeg: 270,
        dataSource: "AquaFlow generic template — verify with the supplier datasheet" } });
  }
  for (let i = 0; i < 4; i++) {
    fixtures.push({ id: `T${i}`, type: "nozzle_foam_jet_dn25", x: i, y: 4, engineering: { ...FOAM_ENG, topLitFraction: 1 } });
  }
  const { nozzleConfigs, lightConfigs } = fixturesToNozzleConfigs(fixtures);

  it("lists ignored overrides with the physical reason, and the estimates", () => {
    const items = realismReport(nozzleConfigs, lightConfigs);
    const text = items.map((i) => i.text);
    expect(text).toContain("82 nozzles: crownTuft ignored — clear straight jets don't form bushy heads (they break into a narrow droplet head near the apex); use an aerated or foam nozzle for that look.");
    expect(text).toContain("86 nozzles: topLitFraction / columnGlow ignored — water is lit only where a real light's beam reaches it (aim a paired light at the part you want lit).");
    expect(text).toContain("82 nozzles use AquaFlow generic template data — verify outlet, flow and pressure with the supplier datasheet.");
    expect(text).toContain(`82 lights: luminous flux estimated from wattage (${LM_PER_W} lm/W) — no lumens in the product data.`);
    expect(items.find((i) => i.id.startsWith("crown-ignored")).ids).toHaveLength(82);
    expect(items.every((i) => i.level && i.text)).toBe(true);
  });

  it("lance wording, and a foam crown reported as product-sized", () => {
    const n = [{ id: "L", type: "jet_1d", engineering: { group: "Clear Jets (catalogue)", model: "Lance Jet I", nozzleDiaMm: 14, pressureBar: 1, crownTuft: true } },
      { id: "F", type: "geyser", aerated: true, engineering: { ...FOAM_ENG, crownTuft: true } }];
    const t = realismReport(n, []).map((i) => i.text);
    expect(t).toContain("1 nozzle: crownTuft ignored — clear lance jets don't form bushy heads (they break into a narrow droplet head near the apex); use an aerated or foam nozzle for that look.");
    expect(t).toContain("1 nozzle: crownTuft sized from the product (foam / aerated jets), not from the free field.");
  });

  it("artistic mode: a single 'not real-world' notice", () => {
    const items = realismReport(nozzleConfigs, lightConfigs, { realWorld: false });
    expect(items).toHaveLength(1);
    expect(items[0].text).toMatch(/^Artistic preview — not real-world/);
    expect(items[0].ids).toHaveLength(86);
  });

  it("jets without an outlet / pressure are flagged as estimates", () => {
    const t = realismReport([{ id: "x", type: "jet_1d", designHeightM: 2, engineering: { jetHeightM: 2 } },
      { id: "y", type: "jet_1d", engineering: { connectionSize: "DN25", pressureBar: 1 } }], []).map((i) => i.text);
    expect(t).toContain("1 jet: no outlet diameter — break-up head not modelled; enter nozzleDiaMm / outletDiaMm from the datasheet.");
    expect(t).toContain("1 jet: outlet diameter taken from the DN connection size (estimate) — the real orifice is smaller.");
    expect(t).toContain("1 jet: launch velocity estimated from the jet height (no nozzle pressure).");
  });
});

describe("artistic stamp layout", () => {
  it("bottom-right, inside the frame, scales with height", () => {
    const L = stampLayout(1920, 1080, 12);
    expect(L.h).toBeCloseTo(Math.round(1080 * 0.032), 9);
    expect(L.x + L.w / 2).toBeLessThan(1920);
    expect(L.y - L.h / 2).toBeGreaterThan(0);
    expect(L.x).toBeGreaterThan(1920 / 2);
    const small = stampLayout(200, 150, 12);
    expect(small.w).toBeLessThanOrEqual(200);
    expect(small.x - small.w / 2).toBeGreaterThanOrEqual(0);
  });
});
