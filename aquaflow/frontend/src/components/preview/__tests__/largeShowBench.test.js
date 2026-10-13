import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { NozzleV2 } from "../FountainScene_v6";
import { FixtureInstances, LightMarkerInstances, fixtureKindFor } from "../fixtureModels";
import { buildSyntheticSite, estimateDrawCalls, SITE_SCALE, BENCH_SIZES, siteForFixtureCount, frameTimeStats, percentile, benchCameraAt } from "../__bench__/largeShowBench";
import { QUALITY_CONFIG } from "../sceneQuality";

const deps = { THREE, NozzleV2, FixtureInstances, LightMarkerInstances, fixtureKindFor };

describe("AF-3D-020 large-show baseline (headless parts)", () => {
  const site = buildSyntheticSite();

  it("builds the real site scale: 64 valves, 7 pumps, 300 fixtures", () => {
    expect(site.valves).toBe(SITE_SCALE.valves);
    expect(site.pumps).toBe(SITE_SCALE.pumps);
    expect(site.nozzles.length + site.lights.length).toBe(SITE_SCALE.fixtures);
    expect(new Set(site.nozzles.map(n => n.groupId)).size).toBe(64);
    expect(new Set(site.nozzles.map(n => n.pumpId)).size).toBe(7);
    expect(new Set(site.nozzles.map(n => n.id)).size).toBe(site.nozzles.length);
  });

  it("AF-3D-019: instanced fixtures stay within legacy draws + number of fixture types", () => {
    const now = estimateDrawCalls(deps, site);
    // The pre-AF-3D-019 path drew one marker mesh per light (capped at 16 lights).
    const legacy = estimateDrawCalls(deps, site, { legacyLightMarkers: Math.min(16, site.lights.length) });
    expect(now.draws).toBeLessThanOrEqual(legacy.draws + site.types);
    // And light count no longer costs draws: 108 lights → a constant handful.
    const fewer = estimateDrawCalls(deps, { ...site, lights: site.lights.slice(0, 5) });
    expect(now.draws - fewer.draws).toBeLessThanOrEqual(16 - 5);   // only the capped beam cones differ
  });

  it("tiers are configured for the benchmark (GPU particles off on low, half-res on high)", () => {
    expect(QUALITY_CONFIG.low.gpuParticles).toBe(false);
    expect(QUALITY_CONFIG.high.halfResSpray).toBe(true);
    expect(QUALITY_CONFIG.medium.halfResSpray).toBe("toggle");
  });
});

describe("AF-NEXT-013 benchmark variants", () => {
  it("builds 20 / 100 / 300-fixture sites with the same nozzle:light mix", () => {
    expect(BENCH_SIZES).toEqual([20, 100, 300]);
    for (const n of BENCH_SIZES) {
      const s = siteForFixtureCount(n);
      expect(s.nozzles.length + s.lights.length).toBe(n);
      expect(s.nozzles.length / n).toBeGreaterThan(0.5);
      expect(s.lights.length).toBeGreaterThan(0);
    }
    const full = siteForFixtureCount(300);
    expect([full.valves, full.pumps]).toEqual([SITE_SCALE.valves, SITE_SCALE.pumps]);
  });
  it("frame-time statistics: median, p99, max and the mean (throughput) frame rate", () => {
    const ms = [...Array(98).fill(10), 100, 400];
    const st = frameTimeStats(ms);
    expect(st.frames).toBe(100);
    expect(st.medianMs).toBe(10);
    expect(st.p99Ms).toBe(100);
    expect(st.maxMs).toBe(400);
    expect(st.meanMs).toBeCloseTo(14.8, 5);
    expect(st.meanFps).toBeCloseTo(1000 / 14.8, 1);
    expect(percentile([], 50)).toBeNull();
  });
  it("the camera path is deterministic", () => {
    expect(benchCameraAt(3)).toEqual(benchCameraAt(3));
    expect(benchCameraAt(0).position.y).toBeCloseTo(13 + Math.sin(0.8) * 1.5, 6);
  });
});
