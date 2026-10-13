/**
 * gpuBenchPage.js — AF-NEXT-013 real-GPU benchmark + fixed-scene screenshot page.
 *
 * Loaded only by gpuBench.html on the Vite DEV server (it is not a `vite build` input).
 * The Electron runner (aquaflow/tools/gpu-bench/run.mjs) calls:
 *   window.__gpuBench.info()            → WebGL vendor/renderer (WEBGL_debug_renderer_info)
 *   window.__gpuBench.bench(cfg)        → frame-time stats for one tier x size
 *   window.__gpuBench.shot(cfg)         → PNG data URL of one fixed scene
 * Everything here drives the real FountainScene; nothing reaches hardware.
 */
import { installGpuMemoryTracker, gpuMemorySnapshot } from "./gpuMemoryTracker";
installGpuMemoryTracker();   // must run before any WebGL context exists

import { FountainScene } from "../FountainScene_v6";
import { siteForFixtureCount, benchCameraAt, frameTimeStats } from "./largeShowBench";
import { applyTierExtras, setDensityNormalization, applyRenderScale } from "../sceneAdaptive";
import { fixturesToNozzleConfigs, geometryToPoolConfig } from "../../../hooks/fixtureTypeMap";
import { poolCenter, centerToWorld } from "../../../engineering/geometryContract";
import { toPreviewSiteSurfaces } from "../../../engineering/siteSurfaces";

const statusEl = document.getElementById("status");
const status = text => { if (statusEl) statusEl.textContent = text; };
const frame = () => new Promise(r => requestAnimationFrame(t => r(t)));

/** Deterministic PRNG (mulberry32) — replaces Math.random while a shot is simulated. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeCanvas(width, height) {
  const host = document.getElementById("host");
  host.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.appendChild(canvas);
  return canvas;
}

function disposeScene(scene, canvas) {
  try { scene?.dispose?.(); } catch (e) { /* best effort */ }
  try { scene?.renderer?.forceContextLoss?.(); } catch (e) { /* best effort */ }
  canvas?.remove();
}

// ─── Content ───────────────────────────────────────────────────────────────

/** Synthetic site → scene. `colors: "design"` keeps each light's own colour. */
function loadSynthetic(scene, { fixtures = 300, colors = "runtime", level = 1 }) {
  const site = siteForFixtureCount(fixtures);
  scene.setPoolGeometry(site.poolGeometry);
  scene.setNozzlesFromEngineering(site.nozzles);
  scene.setEngineeringLights(site.lights);
  // Runtime colour #0066ff as an sRGB 0..1 signal (the convention of every signal source).
  const signals = { pump: 1, valve: 1, lighting: level, fog: 0, lightingColor: { r: 0, g: 0.4, b: 1, w: 0 } };
  if (colors === "design") {
    signals.fixtureLightStates = Object.fromEntries(site.lights.map(l => [l.id, { intensity: level, color: l.color }]));
  }
  return { site, signals, counts: { nozzles: site.nozzles.length, lights: site.lights.length } };
}

/** Lebu pilot (.aqua passed in by the runner) → scene, through the app's own mappers. */
function loadLebu(scene, aqua, { level = 1 } = {}) {
  const eng = aqua.engineering;
  const { nozzleConfigs, lightConfigs } = fixturesToNozzleConfigs(eng.fixtures || []);
  const center = poolCenter(eng.geometry, eng.params, eng.pool_type);
  nozzleConfigs.forEach(n => Object.assign(n, centerToWorld(n, center)));
  lightConfigs.forEach(l => Object.assign(l, centerToWorld(l, center)));
  scene.setPoolGeometry(geometryToPoolConfig(eng.geometry, eng.params, eng.pool_type));
  scene.setSiteSurfaces(toPreviewSiteSurfaces(eng.site_surfaces || [], center));
  scene.setNozzlesFromEngineering(nozzleConfigs);
  scene.setEngineeringLights(lightConfigs);
  const signals = {
    pump: 1, valve: 1, lighting: level, fog: 0,
    fixtureLightStates: Object.fromEntries(lightConfigs.map(l => [l.id, { intensity: level, color: l.color }])),
  };
  return { signals, views: aqua.render?.cameraViews || [], counts: { nozzles: nozzleConfigs.length, lights: lightConfigs.length } };
}

function createScene(canvas, { quality = "medium", environment = "night", toneMapping = "aces", baked = false }) {
  const scene = new FountainScene(canvas, { quality, environment, toneMapping });
  // A baked (fixed-time) scene stands the live loop down BEFORE init, so not even the
  // first synchronous frame sees wall-clock time.
  if (baked) scene._baking = true;
  scene.init();
  applyTierExtras(scene);   // eco water/particles/budget — exactly what the app applies
  return scene;
}

// ─── API ───────────────────────────────────────────────────────────────────

function info() {
  const c = document.createElement("canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  if (!gl) return { webgl: false };
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  const out = {
    webgl: gl instanceof WebGL2RenderingContext ? 2 : 1,
    vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
    renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    shadingLanguage: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
  };
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return out;
}

/**
 * One benchmark run. Live render loop (exactly the app's), camera on the fixed path,
 * every requestAnimationFrame interval recorded over `sampleMs` after `warmupMs`.
 */
/**
 * Cost ablation: switch one feature off on a live scene to see what it costs on this GPU.
 * Investigation only — the shipped tiers are defined in sceneQuality.js.
 */
function applyAblation(scene, ablate = {}) {
  if (ablate.post === false) scene.setPostFX(false);
  if (ablate.shadows === false && scene.renderer.shadowMap) { scene.renderer.shadowMap.enabled = false; scene.renderer.shadowMap.autoUpdate = false; }
  if (ablate.reflection === false && scene._reflection) scene._reflection.interval = 1e9;
  if (ablate.softDepth === false) scene._depthProbe = null;
  if (ablate.cones === false && scene._cones) scene._cones.group.visible = false;
  if (ablate.particles === false) {
    for (const f of [scene._gpuWater, scene._gpuSpray]) if (f?.mesh) f.mesh.visible = false;
    for (const sys of [scene.waterSys, scene.spraySys, scene.foamSys]) if (sys?.mesh) sys.mesh.visible = false;
  }
  if (ablate.halfResSpray === true) scene.setHalfResSpray(true);
  if (Number.isFinite(ablate.msaa) && scene.composer) {
    for (const rt of [scene.composer.renderTarget1, scene.composer.renderTarget2]) { rt.samples = ablate.msaa; rt.dispose(); }
  }
  if (ablate.bloom === false && scene._bloomPass) scene._bloomPass.enabled = false;
  if (ablate.grade === false && scene._gradePass) scene._gradePass.enabled = false;
}

async function bench({ quality = "medium", fixtures = 300, width = 1920, height = 1080,
  warmupMs = 3000, sampleMs = 10000, toneMapping = "aces", ablate = null,
  content = "synthetic", aqua = null, cameraPath = null, renderScale = 1 } = {}) {
  status(`bench ${quality} ${fixtures}f`);
  const memBefore = gpuMemorySnapshot();
  const canvas = makeCanvas(width, height);
  const scene = createScene(canvas, { quality, toneMapping });
  const { signals, counts } = content === "lebu"
    ? loadLebu(scene, aqua, { level: 1 })
    : loadSynthetic(scene, { fixtures, colors: "runtime", level: 1 });
  scene.setSignals(signals);
  if (ablate) applyAblation(scene, ablate);
  if (renderScale !== 1) applyRenderScale(scene, renderScale);
  scene.cameraMode = "named";
  scene.orbitAuto = false;
  const placeCamera = t => { scene._namedView = benchCameraAt(t, cameraPath || undefined); };
  placeCamera(0);

  let t0 = await frame();
  while (performance.now() - t0 < warmupMs) await frame();
  const frameMs = [], draws = [], tris = [], particles = [];
  let start = await frame(), prev = start;
  while (prev - start < sampleMs) {
    const now = await frame();
    frameMs.push(now - prev);
    prev = now;
    placeCamera((now - start) / 1000);
    const s = scene.getPerfStats();
    draws.push(s.drawCalls); tris.push(s.triangles); particles.push(s.particles);
  }
  const stats = scene.getPerfStats();
  const mem = gpuMemorySnapshot();
  const median = a => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
  const result = {
    quality, content, fixtures: content === "lebu" ? counts.nozzles + counts.lights : fixtures,
    nozzles: counts.nozzles, lights: counts.lights, ablate, renderScale,
    resolution: { width, height, pixelRatio: stats.features?.pixelRatio ?? 1,
      drawingBuffer: { width: scene.renderer.domElement.width, height: scene.renderer.domElement.height } },
    toneMapping,
    frameTime: frameTimeStats(frameMs),
    frameIntervalsMs: frameMs.map(x => Number(x.toFixed(1))),
    drawCalls: { median: median(draws), max: Math.max(...draws) },
    triangles: { median: median(tris), max: Math.max(...tris) },
    particles: { median: median(particles), max: Math.max(...particles), backend: stats.backend, gpu: stats.gpuParticles, cpu: stats.cpuParticles },
    programs: stats.programs,
    gpuMemoryEstimateMB: mem && memBefore ? Number((mem.estimatedMB - memBefore.estimatedMB).toFixed(1)) : null,
    gpuMemory: mem,
    rendererInfoMemory: { ...scene.renderer.info.memory },
    features: stats.features,
    lightField: scene._fieldLights?.stats || null,
  };
  disposeScene(scene, canvas);
  status("idle");
  return result;
}

/**
 * One fixed scene, rendered deterministically: Math.random seeded, the live loop stood
 * down (the same mechanism a baked video uses), the simulation stepped at a fixed dt up
 * to `time`, then one frame rendered and read back from the canvas.
 */
async function shot({ content = "synthetic", fixtures = 300, colors = "design", level = 1, aqua = null,
  view = null, viewId = null, time = 4, seed = 1234, quality = "medium", environment = "night",
  toneMapping = "aces", width = 960, height = 540, densityNorm = true, ablate = null } = {}) {
  status(`shot ${content} ${viewId || ""}`);
  const realRandom = Math.random;
  Math.random = mulberry32(seed);
  const canvas = makeCanvas(width, height);
  let scene;
  try {
    scene = createScene(canvas, { quality, environment, toneMapping, baked: true });
    const loaded = content === "lebu" ? loadLebu(scene, aqua, { level }) : loadSynthetic(scene, { fixtures, colors, level });
    scene._bakeSignalWrite = true;   // a baked scene only accepts signals written by the bake
    try { scene.setSignals(loaded.signals); } finally { scene._bakeSignalWrite = false; }
    scene.setReviewOverlays(false);   // presentation image: no analysis overlays (as a video bake)
    const cam = view || loaded.views?.find(v => v.id === viewId);
    if (!cam) throw new Error(`No camera for ${content}/${viewId}`);
    scene.setNamedView(cam);
    if (scene._gradePass) scene._gradePass.uniforms.uGrain.value = 0;
    if (scene._reflection) scene._reflection.interval = 1;
    setDensityNormalization(scene, densityNorm);
    if (ablate) applyAblation(scene, ablate);
    const dt = 1 / 60;
    const steps = Math.round(time / dt);
    for (let k = 1; k <= steps; k++) scene._update(dt, k * dt);
    scene._updateCamera(dt);
    scene.renderer.info.reset();
    scene._renderFrame();
    const png = canvas.toDataURL("image/png");
    const stats = scene.getPerfStats();
    return { png, width, height, counts: loaded.counts, drawCalls: stats.drawCalls, triangles: stats.triangles,
      exposure: scene.renderer.toneMappingExposure, toneMapping };
  } finally {
    Math.random = realRandom;
    disposeScene(scene, canvas);
    status("idle");
  }
}

window.__gpuBench = { info, bench, shot, ready: true };
status("ready");
