/**
 * Elevated / aimed nozzles are opt-in: a fixture WITHOUT mountHeightM, aimDeg, catchAtM
 * (and not of the new "sphere" type) must describe exactly the emitters it did before
 * those fields existed. The snapshot was recorded from the code before the change.
 */
import { describe, it, expect } from "vitest";
import { describeNozzleEmitters } from "../nozzleEmitters";
import { launchSpeed } from "../jetPhysics";

const WIND = { x: 0, z: 0 };
const TINT = { r: 0.55, g: 0.8, b: 1.0 };
const round = (v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : Array.isArray(v) ? v.map(round)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);

const CASES = [
  { type: "jet_3d", x: 1, z: 2, tiltX: 10 },
  { type: "jet_1d", x: -1, z: 0 },
  { type: "fan_jet", x: 0, z: 1, rotation: 30 },
  { type: "screen", x: 0, z: 0 },
  { type: "cascade", x: 2, z: 2 },
  { type: "ring", x: 0, z: 0 },
  { type: "mist", x: 3, z: -1 },
  { type: "arch", x: 4, z: 0 },
  { type: "jet_3d", x: 1, z: 2, designHeightM: 6, engineering: { jetHeightM: 6 } },
  { type: "fan_jet", x: 0, z: 1, designHeightM: 3, engineering: { jetHeightM: 3, sprayAngleDeg: 60 } },
  { type: "cascade", x: 0, z: 0, designHeightM: 2.5, engineering: { jetHeightM: 2.5 } },
  { type: "mist", x: 0, z: 0, designHeightM: 1, engineering: { jetHeightM: 1 } },
];

describe("absent elevated/aim fields leave descriptors unchanged", () => {
  for (const cfg of CASES) {
    it(`${cfg.type}${cfg.designHeightM ? ` @${cfg.designHeightM} m` : ""}`, () => {
      const launch = cfg.designHeightM ? (d, fb) => launchSpeed(null, d, fb, null, cfg) : null;
      expect(round(describeNozzleEmitters(cfg, 0.8, 1.5, WIND, TINT, launch))).toMatchSnapshot();
    });
  }
});

describe("absent lit-band / crown fields leave descriptors unchanged", () => {
  for (const cfg of CASES) {
    it(`${cfg.type}${cfg.designHeightM ? ` @${cfg.designHeightM} m` : ""}`, () => {
      const launch = cfg.designHeightM ? (d, fb) => launchSpeed(null, d, fb, null, cfg) : null;
      const plain = describeNozzleEmitters(cfg, 0.8, 1.5, WIND, TINT, launch);
      // columnGlow alone, a disabled crown and an empty beam list do nothing.
      const inert = { ...cfg, litBeams: [], engineering: { ...(cfg.engineering || {}), columnGlow: 0.5, crownTuft: false } };
      const launch2 = cfg.designHeightM ? (d, fb) => launchSpeed(null, d, fb, null, inert) : null;
      expect(round(describeNozzleEmitters(inert, 0.8, 1.5, WIND, TINT, launch2))).toEqual(round(plain));
    });
  }
});
