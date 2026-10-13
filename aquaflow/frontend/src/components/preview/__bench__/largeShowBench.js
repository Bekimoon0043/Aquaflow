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
 *
 * AF-NEXT-013 adds the 20/100/300-fixture variants (siteForFixtureCount), a fixed camera
 * path and frame-time statistics. The real-GPU runner is `aquaflow/tools/gpu-bench/run.mjs`
 * (Electron, hardware acceleration, 1920x1080) driving `gpuBench.html` in this folder.
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

// ─── AF-NEXT-013: 20 / 100 / 300-fixture variants and frame-time statistics ──────────

/** The three benchmark sizes (fixtures). 300 is the real site scale (SITE_SCALE). */
export const BENCH_SIZES = Object.freeze([20, 100, 300]);

/**
 * Synthetic site with `fixtures` fixtures. Valves and pumps scale with the fixture
 * count (64 valves / 7 pumps at 300) so the 20- and 100-fixture variants keep the same
 * nozzle:light mix (~64 % nozzles) on the same 40 x 22 m basin. Light density therefore
 * grows with size, which is exactly what the dense all-on exposure case needs.
 */
export function siteForFixtureCount(fixtures = SITE_SCALE.fixtures) {
  const n = Math.max(3, Math.round(Number(fixtures) || SITE_SCALE.fixtures));
  const valves = Math.max(1, Math.round((SITE_SCALE.valves * n) / SITE_SCALE.fixtures));
  const pumps = Math.max(1, Math.round((SITE_SCALE.pumps * n) / SITE_SCALE.fixtures));
  return buildSyntheticSite({ valves, pumps, fixtures: n });
}

/**
 * The fixed benchmark camera path at time t (seconds since sampling started): a slow
 * elevated orbit (one revolution per 60 s) around the basin centre. Pure, so every run
 * and every machine sees the same views for the same time window.
 */
export function benchCameraAt(t, { radius = 30, height = 13, period = 60, start = 0.4 } = {}) {
  const a = start + (2 * Math.PI * (Number(t) || 0)) / period;
  return {
    position: { x: Math.cos(a) * radius, y: height + Math.sin(a * 2) * 1.5, z: Math.sin(a) * radius },
    target: { x: 0, y: 1.5, z: 0 },
  };
}

/** Nearest-rank percentile of a numeric array (p in 0..100). */
export function percentile(values, p) {
  const v = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const rank = Math.min(v.length, Math.max(1, Math.ceil((p / 100) * v.length)));
  return v[rank - 1];
}

/** Frame-interval summary (ms in, ms + fps out). */
export function frameTimeStats(frameMs) {
  const v = (frameMs || []).filter(x => Number.isFinite(x) && x > 0);
  if (!v.length) return { frames: 0, medianMs: null, p95Ms: null, p99Ms: null, maxMs: null, meanMs: null, meanFps: null, medianFps: null };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const median = percentile(v, 50);
  const r = x => (x == null ? null : Number(x.toFixed(2)));
  return {
    frames: v.length,
    medianMs: r(median), p95Ms: r(percentile(v, 95)), p99Ms: r(percentile(v, 99)),
    maxMs: r(Math.max(...v)), meanMs: r(mean),
    // Throughput: with vsync off, intervals on a GPU-bound machine are bimodal (the CPU
    // runs ahead, then blocks on the GPU queue), so the MEAN is the honest frame rate.
    meanFps: r(1000 / mean),
    medianFps: r(1000 / median),
  };
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
