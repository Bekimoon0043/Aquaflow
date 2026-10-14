// AF-NEXT-013: adaptive quality controller, particle budget and the eco tier.
import { describe, it, expect } from "vitest";
import { AdaptiveQualityController, budgetFraction, ecoParticleScale, attachParticleBudget, ECO_MAX_SIZE_SCALE } from "../sceneAdaptive";
import { QUALITY_CONFIG, TIER_ORDER } from "../sceneQuality";

/** Feed `ms` frames for `durationMs`; return the actions taken. */
function run(ctl, ms, durationMs, start = 0) {
  const actions = [];
  for (let t = start; t < start + durationMs; t += ms) {
    const a = ctl.sample(ms, t);
    if (a) actions.push({ ...a, t });
  }
  return actions;
}

describe("AdaptiveQualityController", () => {
  it("steps scale 1 -> 0.8 -> 0.6 and then drops a tier, ~2 s each above 33 ms", () => {
    const ctl = new AdaptiveQualityController({ tier: "medium", floor: "eco" });
    const a = run(ctl, 50, 12000);
    expect(a.slice(0, 3).map(x => (x.type === "scale" ? x.scale : x.tier))).toEqual([0.8, 0.6, "low"]);
    expect(a[0].t).toBeGreaterThanOrEqual(1900);
    expect(a[0].t).toBeLessThan(4500);
  });
  it("never drops below the floor and leaves a fast machine alone", () => {
    const slow = new AdaptiveQualityController({ tier: "eco", floor: "eco" });
    expect(run(slow, 80, 20000).every(x => x.type === "scale")).toBe(true);
    const fast = new AdaptiveQualityController({ tier: "medium" });
    expect(run(fast, 16.7, 20000)).toEqual([]);   // already at its ceiling
  });
  it("steps back up with headroom, but not above the ceiling", () => {
    const ctl = new AdaptiveQualityController({ tier: "medium", ceiling: "medium", floor: "eco" });
    run(ctl, 50, 9000);
    expect(ctl.tier).toBe("low");
    const up = run(ctl, 10, 40000, 10000);
    expect(up.some(x => x.type === "tier" && x.tier === "medium")).toBe(true);
    expect(up.some(x => x.type === "tier" && x.tier === "high")).toBe(false);
    expect(ctl.tier).toBe("medium");
    expect(ctl.scale).toBe(1);
  });
  it("frames between 20 and 33 ms are a dead band (no oscillation)", () => {
    const ctl = new AdaptiveQualityController({ tier: "low", ceiling: "medium" });
    expect(run(ctl, 25, 30000)).toEqual([]);
  });
});

describe("particle budget", () => {
  it("budgetFraction converges the live count on the budget", () => {
    let f = 1, live = 0;
    for (let i = 0; i < 60; i++) { live = 90000 * f; f = budgetFraction(live, 24000, f); }
    expect(live).toBeGreaterThan(24000 * 0.9);
    expect(live).toBeLessThan(24000 * 1.1);
  });
  it("attachParticleBudget thins the CPU systems evenly when they are the renderers", () => {
    const sys = () => ({ active: 0, sampleFraction: 1 });
    const scene = {
      waterSys: sys(), spraySys: sys(), foamSys: sys(),
      _update() {
        this.waterSys.active = 60000 * this.waterSys.sampleFraction;
        this.spraySys.active = 20000 * this.spraySys.sampleFraction;
      },
    };
    attachParticleBudget(scene, 24000);
    for (let i = 0; i < 80; i++) scene._update(1 / 60, i / 60);
    expect(scene.waterSys.active + scene.spraySys.active).toBeLessThan(24000 * 1.1);
    expect(scene.waterSys.sampleFraction).toBe(scene.spraySys.sampleFraction);
  });
  it("eco draws fewer, larger droplets", () => {
    expect(ecoParticleScale(QUALITY_CONFIG.eco.gpuWater))
      .toBeCloseTo(Math.min(ECO_MAX_SIZE_SCALE, Math.sqrt(QUALITY_CONFIG.medium.gpuWater / QUALITY_CONFIG.eco.gpuWater)), 6);
    expect(ecoParticleScale(1)).toBe(ECO_MAX_SIZE_SCALE);
    expect(ecoParticleScale(QUALITY_CONFIG.medium.gpuWater)).toBe(1);
  });
});

describe("eco tier (AF-NEXT-013)", () => {
  const eco = QUALITY_CONFIG.eco;
  it("fits the entry-GPU budget", () => {
    const particles = eco.gpuWater + eco.gpuSpray;
    // GT 730 re-measure: 12k water + 2k spray holds >= 30 fps at 1440x900; a floor of
    // 12k keeps every jet visibly drawn (AF-NEXT-013-gt730-eco.md).
    expect(particles).toBeGreaterThanOrEqual(12000);
    expect(particles).toBeLessThanOrEqual(30000);
    expect(eco.gpuWater).toBeGreaterThanOrEqual(12000);
    // No soft-depth probe on eco: it re-rendered every opaque mesh (eco drew more than low).
    expect(eco.softDepth).toBe(false);
    expect(eco.cpuParticleBudget).toBeLessThanOrEqual(30000);
    expect(eco).toMatchObject({ pixelRatio: 1, ao: false, shadows: false, reflect: 0, msaa: 0, cones: false, halfResSpray: true, eco: true });
    expect(eco.bloomScale).toBeLessThanOrEqual(0.5);
    expect(TIER_ORDER).toEqual(["eco", "low", "medium", "high"]);
  });
  it("leaves the existing tiers unchanged", () => {
    for (const t of ["low", "medium", "high"]) {
      expect(QUALITY_CONFIG[t].msaa).toBeUndefined();
      expect(QUALITY_CONFIG[t].bloomScale).toBeUndefined();
      expect(QUALITY_CONFIG[t].eco).toBeUndefined();
    }
    expect(QUALITY_CONFIG.medium).toMatchObject({ pixelRatio: 1.5, gpuWater: 131072, gpuSpray: 65536, reflect: 512, postfx: true });
    expect(QUALITY_CONFIG.high).toMatchObject({ pixelRatio: 2.0, gpuWater: 262144, ao: true, smaa: true });
  });
});
