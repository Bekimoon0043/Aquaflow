/**
 * sceneQuality.js — the per-tier feature table for FountainScene (AF-3D-021).
 * Pure data, importable headlessly (the AF-3D-020 benchmark reads it without WebGL).
 */

// postFX per tier: `low` stays on the direct render path (no composer) so weak GPUs keep
// their frame rate; `medium` gets bloom + grade; `high` adds SMAA and a wider bloom.
// `reflect` is the planar-reflection target size in px, 0 = off. `reflectEvery` renders
// it on every Nth frame: the mirror image is low-frequency and tolerates staleness far
// better than the direct image, so medium buys the effect at half the cost.
// `halfResSpray` (AF-3D-008): spray/mist in a half-res pass — on, a user toggle, or off.
// AF-3D R1 additions per tier: `softDepth` renders the opaque-scene depth probe that
// soft particles and light cones fade against (one cheap extra pass at `softScale` ×
// canvas resolution); `cones` draws the volumetric fixture beams; `stars` puts the
// starfield in the night sky dome. `low` keeps all three off — it exists for weak GPUs
// and its frame budget is already spoken for.
// AF-NEXT-013 `eco`: entry GPUs (GT 7xx/10xx, Intel HD/UHD, ...) measured fill-rate
// bound — see docs/evidence/AF-NEXT-013.md. A ~25k shared GPU particle budget drawn as
// fewer, larger droplets (sceneAdaptive.applyEcoParticles), pixel ratio 1, no
// shadows/AO/reflection/cones/IBL, post chain WITHOUT MSAA (`msaa: 0`) and with bloom at
// half resolution (`bloomScale`), half-res spray, and the eco water shader (`eco`).
// `msaa`/`bloomScale` are optional: tiers that omit them keep the previous behaviour.
// GT 730 re-measure (docs/evidence/AF-NEXT-013-gt730-eco.md): eco drew MORE than low
// (450 vs 244 draw calls on the Lebu wave project) because the soft-depth probe re-renders
// every opaque mesh, and the 20k particle fill was the largest remaining cost. Eco now skips
// the depth probe (particles meet geometry with a hard edge) and draws 12k water + 2k spray
// droplets; the core-column meshes still carry each jet. 1440x900: Lebu 30.2 → 35.2 fps,
// 100-fixture synthetic 33.1 → 38.9 fps (vsync on, mean).
export const QUALITY_CONFIG = {
  eco:    { pixelRatio: 1.0, shadows: false, markerScale: 0.82, exposure: 1.00,
            postfx: true,  bloom: 0.20, smaa: false, ibl: false, ao: false,
            msaa: 0, bloomScale: 0.5,
            reflect: 0,   reflectEvery: 1,
            softDepth: false, softScale: 0.5, cones: false, stars: false,
            gpuParticles: true, gpuWater: 12288, gpuSpray: 2048,
            halfResSpray: true, eco: true, cpuParticleBudget: 24000 },
  low:    { pixelRatio: 1.0, shadows: false, markerScale: 0.82, exposure: 1.00,
            postfx: false, bloom: 0.00, smaa: false, ibl: false, ao: false,
            reflect: 0,   reflectEvery: 1,
            softDepth: false, softScale: 0.5, cones: false, stars: false,
            gpuParticles: false, gpuWater: 0, gpuSpray: 0,
            halfResSpray: false },
  medium: { pixelRatio: 1.5, shadows: true,  markerScale: 1.00, exposure: 1.00,
            postfx: true,  bloom: 0.20, smaa: false, ibl: true,  ao: false,
            reflect: 512, reflectEvery: 2,
            softDepth: true, softScale: 0.5, cones: true, stars: true,
            gpuParticles: true, gpuWater: 131072, gpuSpray: 65536,
            halfResSpray: "toggle" },
  high:   { pixelRatio: 2.0, shadows: true,  markerScale: 1.15, exposure: 1.08,
            postfx: true,  bloom: 0.29, smaa: true,  ibl: true,  ao: true,
            reflect: 1024, reflectEvery: 1,
            softDepth: true, softScale: 0.5, cones: true, stars: true,
            gpuParticles: true, gpuWater: 262144, gpuSpray: 131072,
            halfResSpray: true },
};

/**
 * When the GPU field is drawing the water, the CPU field keeps running at this
 * fraction purely as a PHYSICS SAMPLE: invisible, but still reporting impacts to the
 * splash map. That map converts impacts into calibrated litres/minute of spill — an
 * engineering figure, not decoration — and its calibration divides solved flow by the
 * spawn rate it actually measures, so sampling one droplet in sixteen changes the
 * per-impact volume and leaves the reported litres unchanged. Dropping the CPU field
 * entirely would have silently zeroed a commissioning number.
 */
export const CPU_SAMPLE_FRACTION = 1 / 16;

/** Tiers from cheapest to richest — the order adaptive quality steps through. */
export const TIER_ORDER = Object.freeze(["eco", "low", "medium", "high"]);
export const isTier = name => TIER_ORDER.includes(name);
