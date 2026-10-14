/**
 * sceneAdaptive.js — AF-NEXT-013: runtime quality levers that live OUTSIDE the scene
 * orchestrator (FountainScene_v6.js has a line-count guard and must not grow).
 *
 *   • setWaterFlags        — eco water shader / pre-fix density response on the pool
 *   • applyRenderScale     — dynamic resolution (drawing buffer x scale)
 *   • applyEcoParticles    — fewer, larger droplets for the eco particle budget
 *   • attachParticleBudget — caps the CPU particle systems at a total live budget
 *                            shared by the jets that are actually running
 *   • AdaptiveQualityController — frame-time driven scale/tier stepping (pure)
 */
import { QUALITY_CONFIG, TIER_ORDER } from "./sceneQuality";
import { applyFinalExtras } from "./finalRender";

/**
 * Declare/set the eco water flag. GLSL defaults it to 0 (full water shader) when the
 * material does not declare it. Re-run after the water surface is rebuilt
 * (setPoolGeometry builds a new material) — applyTierExtras does that for eco.
 */
export function setWaterFlags(scene, { eco = false } = {}) {
  const mat = scene?.waterMat;
  const u = mat?.uniforms;
  if (!u) return false;
  let added = false;
  if (!u.uEcoWater) { u.uEcoWater = { value: 0 }; added = true; }
  u.uEcoWater.value = eco ? 1 : 0;
  // A uniform added after the program was linked is only bound on the next compile.
  if (added) mat.needsUpdate = true;
  return true;
}

/**
 * Pre-fix fixture response everywhere (harness "before" images only): the flag lives in
 * the shared FixtureLightField uniforms, so every bound material sees it.
 */
export function setDensityNormalization(scene, on = true) {
  const u = scene?._fieldLights?.uniforms?.uFieldDensityNormOff;
  if (!u) return false;
  u.value = on ? 0 : 1;
  return true;
}

/**
 * Dynamic resolution: render at `scale` x the tier's pixel ratio. Mirrors how a baked
 * video swaps the pixel ratio (renderer + composer + every size-dependent pass).
 */
export function applyRenderScale(scene, scale) {
  if (!scene?.renderer || scene._baking) return false;
  const q = QUALITY_CONFIG[scene.quality] || QUALITY_CONFIG.medium;
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  const base = Math.min(dpr, q.pixelRatio);
  const s = Math.max(0.25, Math.min(1, Number(scale) || 1));
  const pr = base * s;
  if (Math.abs((scene._pr || 1) - pr) < 1e-3) { scene._renderScale = s; return false; }
  scene._pr = pr;
  scene._renderScale = s;
  scene.renderer.setPixelRatio(pr);
  scene.composer?.setPixelRatio?.(pr);
  const w = scene.canvas?.clientWidth || scene.canvas?.width || 900;
  const h = scene.canvas?.clientHeight || scene.canvas?.height || 600;
  scene.resize(w, h);
  return true;
}

/**
 * Eco: the GPU pools are an order of magnitude smaller than medium's, so each droplet
 * is drawn larger (and slightly more opaque) to keep the jet's visual mass — "fewer,
 * larger droplets". Coverage scales with count x size², so size grows with
 * sqrt(reference / count), clamped. The core-column meshes (NozzleV2) still carry the
 * solid body of every vertical jet.
 */
export const ECO_MAX_SIZE_SCALE = 1.6;
export function ecoParticleScale(count, reference = QUALITY_CONFIG.medium.gpuWater) {
  if (!(count > 0)) return 1;
  return Math.max(1, Math.min(ECO_MAX_SIZE_SCALE, Math.sqrt(reference / count)));
}
export function applyEcoParticles(scene) {
  const q = QUALITY_CONFIG[scene?.quality];
  if (!q?.eco) return false;
  for (const [field, ref] of [[scene._gpuWater, QUALITY_CONFIG.medium.gpuWater], [scene._gpuSpray, QUALITY_CONFIG.medium.gpuSpray]]) {
    const u = field?.uniforms;
    if (!u?.uSizeScale || field._ecoApplied) continue;
    const k = ecoParticleScale(field.count, ref);
    u.uSizeScale.value *= k;
    if (u.uAlpha) u.uAlpha.value = Math.min(0.5, u.uAlpha.value * Math.sqrt(k));
    field._ecoApplied = k;
  }
  return true;
}

/**
 * Budget for the CPU particle systems: one TOTAL live-particle budget shared across the
 * jets that are actually running. Each system's spawn acceptance (`sampleFraction`, the
 * same mechanism the GPU path uses for its invisible physics sample) is steered so the
 * live total converges on the budget — a 300-nozzle show thins every jet evenly instead
 * of overflowing the ring buffers and truncating jets. Returns the fraction to apply.
 */
export function budgetFraction(live, budget, current = 1, { gain = 0.5, min = 0.05 } = {}) {
  if (!(budget > 0)) return current;
  if (!(live > 0)) return Math.min(1, current + 0.05);
  const target = current * Math.pow(budget / live, gain);
  return Math.max(min, Math.min(1, target));
}

export function attachParticleBudget(scene, budget) {
  if (!scene || scene._particleBudget || !(budget > 0)) return null;
  const systems = () => [scene.waterSys, scene.spraySys, scene.foamSys].filter(Boolean);
  const gpuOwned = () => !!(scene._gpuWater && scene._gpuSpray);
  const orig = scene._update.bind(scene);
  const state = { budget, fraction: 1, live: 0 };
  scene._update = (delta, elapsed) => {
    orig(delta, elapsed);
    // With GPU fields the CPU systems are already an invisible sample: leave them be.
    if (gpuOwned()) return;
    state.live = systems().reduce((s, p) => s + (p.active || 0), 0);
    state.fraction = budgetFraction(state.live, state.budget, state.fraction);
    for (const p of systems()) p.sampleFraction = state.fraction;
  };
  scene._particleBudget = state;
  return state;
}

// ─── Adaptive quality ───────────────────────────────────────────────────────

export const ADAPTIVE_DEFAULTS = Object.freeze({
  targetMs: 33.3,          // 30 fps
  windowMs: 2000,          // sustained for ~2 s before acting
  scales: [1, 0.8, 0.6],   // dynamic-resolution steps before a tier drop
  headroom: 0.6,           // step back up when median < target x headroom ...
  upWindowMs: 5000,        // ... for this long
});

const median = arr => {
  const v = arr.slice().sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
};

/**
 * Pure frame-time controller. Feed it frame intervals (ms) with a timestamp; it answers
 * with an action: { type: "scale", scale } | { type: "tier", tier } | null.
 * Order going down: scale 1 → 0.8 → 0.6, then the next lower tier at scale 1.
 * Going up reverses it, but never above `ceiling` (the tier the user/auto picked).
 */
export class AdaptiveQualityController {
  constructor({ tier = "medium", ceiling = tier, floor = "eco", ...opts } = {}) {
    this.o = { ...ADAPTIVE_DEFAULTS, ...opts };
    this.tier = tier;
    this.ceiling = ceiling;
    this.floor = floor;
    this.scaleIndex = 0;
    this.samples = [];   // [t, ms]
    this.since = null;   // when the current verdict started
    this.verdict = null; // "slow" | "fast" | null
  }

  get scale() { return this.o.scales[this.scaleIndex]; }

  /** Reset the measurement window (after a tier rebuild, a resize, ...). */
  settle(now = 0) { this.samples = []; this.since = null; this.verdict = null; this._settledAt = now; }

  sample(ms, now) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    this.samples.push([now, ms]);
    const keep = Math.max(this.o.windowMs, this.o.upWindowMs);
    while (this.samples.length && now - this.samples[0][0] > keep) this.samples.shift();
    const recent = this.samples.filter(([t]) => now - t <= this.o.windowMs).map(s => s[1]);
    if (recent.length < 5) return null;
    const m = median(recent);
    const verdict = m > this.o.targetMs ? "slow" : m < this.o.targetMs * this.o.headroom ? "fast" : null;
    if (verdict !== this.verdict) { this.verdict = verdict; this.since = now; return null; }
    if (!verdict) return null;
    const need = verdict === "slow" ? this.o.windowMs : this.o.upWindowMs;
    if (now - this.since < need) return null;
    const action = verdict === "slow" ? this._down() : this._up();
    if (action) this.settle(now);
    else this.since = now;   // nothing left to do; re-arm the timer
    return action;
  }

  _down() {
    if (this.scaleIndex < this.o.scales.length - 1) { this.scaleIndex++; return { type: "scale", scale: this.scale }; }
    const i = TIER_ORDER.indexOf(this.tier), f = TIER_ORDER.indexOf(this.floor);
    if (i > f) { this.tier = TIER_ORDER[i - 1]; this.scaleIndex = 0; return { type: "tier", tier: this.tier, scale: 1 }; }
    return null;
  }

  _up() {
    if (this.scaleIndex > 0) { this.scaleIndex--; return { type: "scale", scale: this.scale }; }
    const i = TIER_ORDER.indexOf(this.tier), c = TIER_ORDER.indexOf(this.ceiling);
    if (i < c) { this.tier = TIER_ORDER[i + 1]; this.scaleIndex = this.o.scales.length - 1; return { type: "tier", tier: this.tier, scale: this.scale }; }
    return null;
  }
}

/**
 * Apply the tier extras that are not plain QUALITY_CONFIG switches (call once, right
 * after scene.init()). Eco: eco water shader (kept across water-surface rebuilds),
 * larger GPU droplets, CPU particle budget. Other tiers: nothing changes.
 */
export function applyTierExtras(scene) {
  const q = QUALITY_CONFIG[scene?.quality];
  if (!q || scene._tierExtras) return false;
  scene._tierExtras = true;
  if (q.eco) {
    // Nearest 4 fixtures per particle/pixel instead of 16 (the light loop is the
    // dominant per-particle vertex cost on an entry GPU).
    if (scene._fieldLights?.uniforms?.uFieldMaxGroups) scene._fieldLights.uniforms.uFieldMaxGroups.value = 1;
    setWaterFlags(scene, { eco: true });
    if (typeof scene._buildWaterSurface === "function") {
      const build = scene._buildWaterSurface.bind(scene);
      scene._buildWaterSurface = (...args) => {
        const r = build(...args);
        setWaterFlags(scene, { eco: true });
        return r;
      };
    }
    applyEcoParticles(scene);
  }
  if (q.cpuParticleBudget) attachParticleBudget(scene, q.cpuParticleBudget);
  if (q.final) applyFinalExtras(scene);   // export-only ultra profile (finalRender.js)
  return true;
}
