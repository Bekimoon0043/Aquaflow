import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { NozzleV2 } from "../FountainScene_v6";
import { FixtureInstances, LightMarkerInstances, fixtureKindFor } from "../fixtureModels";
import { buildSyntheticSite, estimateDrawCalls, SITE_SCALE } from "../__bench__/largeShowBench";
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
