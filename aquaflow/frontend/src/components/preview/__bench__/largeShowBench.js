/**
 * largeShowBench.js — AF-3D-020: large-show performance baseline.
 *
 * Builds the real site scale (64 valves, 7 pumps, 300 fixtures) as a synthetic
 * design and measures it two ways:
 *
 *   • `estimateDrawCalls()` — headless. Constructs the per-fixture scene objects the
 *     renderer would build (nozzle core/glow meshes, instanced fixture bodies,
 *     instanced light markers, beam cones) without a WebGL context and counts the
 *     main-pass draw calls they produce. Used by the vitest guard.
 *   • `runLargeShowBenchmark()` — in a browser. Drives a live FountainScene per tier
 *     and records getPerfStats() (fps, frame ms, draw calls, triangles, features).
 *     Call it from the dev console:  import("/src/components/preview/__bench__/largeShowBench.js")
 *       .then(m => m.runLargeShowBenchmark(FountainSceneClass, canvas)).then(console.table)
 */

export const SITE_SCALE = Object.freeze({ valves: 64, pumps: 7, fixtures: 300 });

const NOZZLE_TYPES = ["jet_3d", "jet_1d", "laminar", "geyser", "arch", "mist", "fan_jet", "ring", "motion_2d", "cascade"];

/** Deterministic synthetic site: 3 nozzles per valve (192), the rest RGB lights (108). */
export function buildSyntheticSite({ valves = 64, pumps = 7, fixtures = 300, width = 40, length = 22 } = {}) {
  const nozzles = [];
  const perValve = Math.max(1, Math.floor((fixtures * 0.64) / valves));
  for (let v = 0; v < valves; v++) {
    for (let k = 0; k < perValve; k++) {
      const i = v * perValve + k;
      const col = i % 24, row = Math.floor(i / 24);
      nozzles.push({
        id: `N${i}`, type: NOZZLE_TYPES[i % NOZZLE_TYPES.length],
        x: -width / 2 + 1.5 + col * ((width - 3) / 23), z: -length / 2 + 2 + row * 2.2,
        groupId: `V${v}`, pumpId: `P${v % pumps}`,
      });
    }
  }
  const lights = [];
  for (let i = 0; nozzles.length + lights.length < fixtures; i++) {
    const col = i % 27, row = Math.floor(i / 27);
    lights.push({
      id: `L${i}`, x: -width / 2 + 1 + col * ((width - 2) / 26), z: -length / 2 + 1 + row * 5.2,
      color: ["#2277ff", "#ff3366", "#33ff99"][i % 3], intensity: 0.8, radius: 6,
    });
  }
  return {
    valves, pumps, nozzles, lights,
    poolGeometry: { poolType: "rectangular", params: { width, length } },
    types: new Set([...nozzles.map(n => n.type), "light"]).size,
  };
}

/**
 * Headless main-pass draw-call estimate for the fixtures of a site.
 * @param {object} deps { THREE, NozzleV2, FixtureInstances, LightMarkerInstances, fixtureKindFor, maxCones }
 * @param {object} site from buildSyntheticSite
 * @param {object} opts { legacyLightMarkers: number of per-light marker meshes the old path drew }
 */
export function estimateDrawCalls(deps, site, { legacyLightMarkers = null } = {}) {
  const { THREE, NozzleV2, FixtureInstances, LightMarkerInstances, fixtureKindFor, maxCones = 16 } = deps;
  const root = new THREE.Scene();
  const shared = { uGlobalLight: { value: new THREE.Color() }, uGlobalLightI: { value: 0 }, field: {} };
  const nz = site.nozzles.map(cfg => new NozzleV2(THREE, null, null, null, null, { tiltX: 0, tiltZ: 0, ...cfg }, shared));
  for (const n of nz) { if (n.core) root.add(n.core); if (n.glow) root.add(n.glow); }
  const bodies = new FixtureInstances(THREE);
  bodies.setFixtures(site.nozzles.map(n => ({ id: n.id, kind: fixtureKindFor(n.type), x: n.x, z: n.z })));
  root.add(bodies.group);
  let lightDraws = 0;
  if (legacyLightMarkers != null) {
    lightDraws = legacyLightMarkers;
  } else {
    const markers = new LightMarkerInstances(THREE);
    markers.setLights(site.lights.map(l => ({ ...l, color: new THREE.Color(l.color) })));
    root.add(markers.group);
  }
  // Count draws: one per material group of each visible mesh.
  let draws = 0, meshes = 0;
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    draws += Array.isArray(o.material) ? Math.max(1, o.geometry.groups.length || o.material.length) : 1;
  });
  draws += lightDraws + Math.min(maxCones, site.lights.length);
  return { draws, meshes, nozzles: site.nozzles.length, lights: site.lights.length, types: site.types };
}

/** Browser: run the synthetic site per tier and collect getPerfStats(). */
export async function runLargeShowBenchmark(FountainSceneClass, canvas, {
  tiers = ["low", "medium", "high"], warmupFrames = 30, sampleMs = 3000,
} = {}) {
  const site = buildSyntheticSite();
  const results = [];
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  for (const quality of tiers) {
    const scene = new FountainSceneClass(canvas, { quality, environment: "night" });
    scene.init();
    scene.setPoolGeometry(site.poolGeometry);
    scene.setNozzlesFromEngineering(site.nozzles);
    scene.setEngineeringLights(site.lights);
    scene.setSignals({ pump: 1, valve: 1, lighting: 0.6, fog: 0.3 });
    for (let i = 0; i < warmupFrames; i++) await frame();
    const t0 = performance.now();
    while (performance.now() - t0 < sampleMs) await frame();
    results.push({ ...scene.getPerfStats(), site: `${site.valves}v/${site.pumps}p/${site.nozzles.length + site.lights.length}f` });
    scene.dispose();
  }
  return results;
}
