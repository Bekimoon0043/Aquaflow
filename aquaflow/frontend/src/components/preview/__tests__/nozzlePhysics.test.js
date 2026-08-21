/**
 * AQ-S2-002 Phase 2 — solver-driven jet physics.
 *
 * Verifies the contract that makes the preview engineering-true:
 *   * physics is the HARD CEILING — the show can never render a jet taller than
 *     the hydraulics can deliver;
 *   * the show scalar still modulates beneath that ceiling (choreography works);
 *   * height scales as v²/2g, so a demand fraction f gives sqrt(f) of velocity;
 *   * over-demand is flagged rather than silently clamped;
 *   * with no solve attached, behaviour is byte-identical to the legacy estimate.
 *
 * The resolver is pure arithmetic, so it is tested directly — no WebGL needed.
 */
import { describe, it, expect } from "vitest";
// The REAL implementation the renderer uses — not a copy, so the test cannot
// silently drift away from shipping behaviour.
import { launchSpeed, normalizePhysics, jetHeightFor } from "../jetPhysics";

const G = 9.81;

/** Thin harness mirroring how NozzleV2 calls the shared resolver. */
function makeNozzle(id, physics) {
  return {
    config: { id },
    physics: normalizePhysics(physics),
    _overDemandSink: null,
    setPhysics(rec, sink) {
      this.physics = normalizePhysics(rec);
      this._overDemandSink = sink || null;
    },
    _launchSpeed(demand, fallbackSpeed) {
      return launchSpeed(this.physics, demand, fallbackSpeed,
                         this._overDemandSink, this.config?.id);
    },
  };
}

const heightOf = (v) => jetHeightFor(v, G);

describe("solver-driven jet physics", () => {
  it("falls back to the legacy estimate when the design is unsolved", () => {
    const nz = makeNozzle("n1", null);
    // Exactly the old formula, untouched.
    expect(nz._launchSpeed(0.8, 5.5 + 0.8 * 7.0)).toBe(5.5 + 0.8 * 7.0);
  });

  it("uses the solved exit velocity at full demand", () => {
    const nz = makeNozzle("n1", { exitVelocityMs: 20, jetHeightM: heightOf(20) });
    expect(nz._launchSpeed(1.0, 999)).toBeCloseTo(20, 10);
  });

  it("scales as sqrt(demand) so height is linear in demand", () => {
    const vMax = 20;
    const nz = makeNozzle("n1", { exitVelocityMs: vMax, jetHeightM: heightOf(vMax) });
    // Half demand must give HALF THE HEIGHT, not half the velocity.
    const vHalf = nz._launchSpeed(0.5, 0);
    expect(vHalf).toBeCloseTo(vMax * Math.SQRT1_2, 10);
    expect(heightOf(vHalf)).toBeCloseTo(heightOf(vMax) * 0.5, 10);

    const vQuarter = nz._launchSpeed(0.25, 0);
    expect(heightOf(vQuarter)).toBeCloseTo(heightOf(vMax) * 0.25, 10);
  });

  it("treats physics as a hard ceiling when the show over-demands", () => {
    const vMax = 20;
    const nz = makeNozzle("n1", { exitVelocityMs: vMax, jetHeightM: heightOf(vMax) });
    // heightScale can reach 2.0 upstream; the jet must NOT exceed the solved max.
    expect(nz._launchSpeed(2.0, 0)).toBeCloseTo(vMax, 10);
    expect(nz._launchSpeed(1.7, 0)).toBeCloseTo(vMax, 10);
    expect(heightOf(nz._launchSpeed(2.0, 0))).toBeCloseTo(heightOf(vMax), 10);
  });

  it("flags over-demand with the demanded ratio and the physical cap", () => {
    const sink = {};
    const nz = makeNozzle("jet-3", null);
    nz.setPhysics({ exitVelocityMs: 15, jetHeightM: 11.47 }, sink);

    nz._launchSpeed(0.9, 0);            // within physics — no flag
    expect(sink["jet-3"]).toBeUndefined();

    nz._launchSpeed(1.8, 0);            // beyond physics — flagged
    expect(sink["jet-3"].demand).toBeCloseTo(1.8, 10);
    expect(sink["jet-3"].jetHeightM).toBeCloseTo(11.47, 10);

    nz._launchSpeed(1.2, 0);            // keeps the WORST offence, not the latest
    expect(sink["jet-3"].demand).toBeCloseTo(1.8, 10);
  });

  it("choreography still modulates the jet beneath the ceiling", () => {
    const nz = makeNozzle("n1", { exitVelocityMs: 18, jetHeightM: heightOf(18) });
    const heights = [0.2, 0.4, 0.6, 0.8, 1.0].map(d => heightOf(nz._launchSpeed(d, 0)));
    // Strictly increasing => the show visibly drives the jet up and down.
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it("zero demand produces no jet, and negative demand is treated as zero", () => {
    const nz = makeNozzle("n1", { exitVelocityMs: 20, jetHeightM: heightOf(20) });
    expect(nz._launchSpeed(0, 0)).toBe(0);
    expect(nz._launchSpeed(-5, 0)).toBe(0);
  });

  it("ignores a malformed physics record rather than rendering NaN jets", () => {
    const nz = makeNozzle("n1", null);
    nz.setPhysics({ exitVelocityMs: "not-a-number" }, {});
    expect(nz.physics).toBeNull();
    expect(nz._launchSpeed(1.0, 7.25)).toBe(7.25);   // legacy fallback intact
  });
});
