/**
 * FountainScene_v6.js — AquaFlow Phase 13C (Phase 1 + Phase 2 integrated)
 *
 * Fountain-focused renderer:
 *   PHASE 1 — Water optics
 *     • 4-layer fountain stack: core column + breakup shell + atomized mist + surface impact
 *     • Velocity-aligned anisotropic droplet splats (denser look at distance)
 *     • Per-droplet life/scale/color shading with RGB light injection
 *     • Pool surface: Gerstner-style displacement, GGX specular, Beer-Lambert depth,
 *       fresnel reflection, per-light caustic modulation
 *
 *   PHASE 2 — RGB lighting
 *     • Per-fixture spatial RGB light field (up to 16 active fixture lights uploaded to shaders)
 *     • Water core / spray / surface all sample the same light field for unified bleed
 *     • Localized lit-volume glow around active jets (camera-aware billboards, additive)
 *     • Underwater point lights replaced with engineering-driven RGB lights
 *
 *   BUG FIXES vs previous v6
 *     • Engineering nozzles fully REPLACE the default layout (no ghost ring)
 *     • Nozzle TYPE carried through from engineering (no more "all jets look same")
 *     • Pattern playback driven by render delta (not setInterval) — survives tab throttle
 *     • Pattern + per-nozzle intensities work together with named-list indexing
 *     • Engineering lights drive the spatial RGB field (lightConfigs respected)
 *     • setSignals merges instead of replacing (so backend doesn't blank manual controls)
 *
 * Public API preserved:
 *   new FountainScene(canvas, options?)
 *   .init()
 *   .setSignals(obj)
 *   .setPerNozzleIntensities(array)
 *   .setPoolGeometry(geom)
 *   .setNozzlesFromEngineering(nozzleConfigs)
 *   .setEngineeringLights(lightConfigs)
 *   .setEnvironment(env)
 *   .setCameraMode(mode)
 *   .setLightColor(hex)
 *   .setWind(x,z)
 *   .playPattern(name, intensity?)
 *   .stopPattern()
 *   .startRecording() / .stopRecording()
 *   .resize(w,h)
 *   .dispose()
 */

import * as THREE from "three";
// Photorealistic Rendering Engine (AQ-S3-004) — single source of truth for the
// environment presets and gravity used by the water physics below.
import { ENVIRONMENTS as RE_ENVIRONMENTS, GRAVITY as RE_GRAVITY } from "../../rendering";
// VR Walkthrough Engine (AQ-S3-006) — WebXR session config + guided-tour sequencing.
import {
  isVRSupported as WT_isVRSupported, vrSessionOptions as WT_vrSessionOptions,
  vrReferenceSpaceType as WT_vrReferenceSpaceType, DEFAULT_TOUR as WT_DEFAULT_TOUR,
  buildTour as WT_buildTour, tourStepAt as WT_tourStepAt,
} from "../../walkthrough";
// 4K Video Export Engine (AQ-S3-007) — export config + A/V sync.
import { buildExportConfig as VE_buildExportConfig, combineStreams as VE_combineStreams } from "../../video/videoExport";
// AQ-S3-010 — cinematic post-processing chain. A fountain is emissive water, light and
// flame against a night sky: bloom is what makes it read as *light* rather than bright
// pixels, so the composer is the single biggest visual win available here.
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
// AQ-S2-002 Phase 2 — solver-driven jet physics (pure, unit-tested, single definition).
import { launchSpeed as JP_launchSpeed, normalizePhysics as JP_normalizePhysics } from "./jetPhysics";
// AQ-S3-012 — a real mirror image in the pool, and a record of where the water lands.
import { WaterReflectionProbe } from "./waterReflection";
import { SplashMap, insidePool as SM_insidePool, litresPerImpact as SM_litresPerImpact } from "./splashMap";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
// AF-3D Phase R1 (realism plan) — the night-look upgrades:
//   billboard particles (velocity-stretched quads + soft depth fade), procedural
//   sprite textures, an opaque-scene depth probe, a sky dome with starfield that
//   doubles as the IBL source, and volumetric beam cones for the RGB fixtures.
import { buildBillboardGeometry, buildBillboardMaterial } from "./particlesBillboard";
import { makeDropletTexture, makeMistTexture, makeFoamTexture, makeFlameTexture } from "./particleTextures";
import { SceneDepthProbe } from "./sceneDepth";
import { createSkyDome, createSkyIBL } from "./skyDome";
import { LightConeSet } from "./lightCones";
// AF-3D-012 (pulled forward from Phase R4) — procedural stone/tile PBR maps for the
// hard surfaces; the flat single-colour deck was the loudest remaining CGI cue.
import { createStoneMaps, cloneStoneMaps, applyStoneMaps, disposeStoneMaps } from "./groundTextures";
// AF-3D-006/007 (Phase R2) — GPU particle simulation. State lives in float textures
// and is advanced by shaders, lifting the count an order of magnitude above what the
// CPU field can carry. The CPU field stays as the low-tier fallback AND as the
// invisible statistical sample that keeps the splash/containment analysis honest.
import { GPUParticleField, gpuParticlesSupported } from "./particlesGPU";
import { describeNozzleEmitters, allocatePool, EMIT_CLASS } from "./nozzleEmitters";

export const NOZZLE_TYPES = {
  JET_1D:"jet_1d", JET_2D:"jet_2d", JET_3D:"jet_3d",
  ARCH:"arch", RING:"ring", CASCADE:"cascade",
    GEYSER:"geyser", MIST:"mist", LAMINAR:"laminar", PIROUETTE:"pirouette",
  FAN:"fan_jet", FLAME:"flame", LASER:"laser",
  MOTION_1D:"motion_1d", MOTION_2D:"motion_2d", MOTION_3D:"motion_3d",
  SCREEN:"screen",
};
export const ENVIRONMENTS = RE_ENVIRONMENTS;   // sourced from the rendering engine (AQ-S3-004)
export const CAMERA_MODES  = {
  ORBIT:"orbit", TOP:"top", FRONT:"front",
  AERIAL:"aerial", FLYTHROUGH:"flythrough", DRAMATIC:"dramatic", AUDIENCE:"audience",
};
export const RENDER_QUALITY = { LOW:"low", MEDIUM:"medium", HIGH:"high" };

// Max RGB fixture lights uploaded to the spatial light field shader
const MAX_FIELD_LIGHTS = 16;
// Emitter slots in the GPU field's parameter texture. A nozzle contributes one or
// two (a jet plus its atomised shell), so this carries a large design comfortably.
const MAX_GPU_EMITTERS = 96;
// postFX per tier: `low` stays on the direct render path (no composer) so weak GPUs keep
// their frame rate; `medium` gets bloom + grade; `high` adds SMAA and a wider bloom.
// `reflect` is the planar-reflection target size in px, 0 = off. `reflectEvery` renders
// it on every Nth frame: the mirror image is low-frequency and tolerates staleness far
// better than the direct image, so medium buys the effect at half the cost.
// AF-3D R1 additions per tier: `softDepth` renders the opaque-scene depth probe that
// soft particles and light cones fade against (one cheap extra pass at `softScale` ×
// canvas resolution); `cones` draws the volumetric fixture beams; `stars` puts the
// starfield in the night sky dome. `low` keeps all three off — it exists for weak GPUs
// and its frame budget is already spoken for.
const QUALITY_CONFIG = {
  low:    { pixelRatio: 1.0, shadows: false, markerScale: 0.82, exposure: 1.00,
            postfx: false, bloom: 0.00, smaa: false, ibl: false, ao: false,
            reflect: 0,   reflectEvery: 1,
            softDepth: false, softScale: 0.5, cones: false, stars: false,
            gpuParticles: false, gpuWater: 0, gpuSpray: 0 },
  medium: { pixelRatio: 1.5, shadows: true,  markerScale: 1.00, exposure: 1.00,
            postfx: true,  bloom: 0.35, smaa: false, ibl: true,  ao: false,
            reflect: 512, reflectEvery: 2,
            softDepth: true, softScale: 0.5, cones: true, stars: true,
            gpuParticles: true, gpuWater: 131072, gpuSpray: 65536 },
  high:   { pixelRatio: 2.0, shadows: true,  markerScale: 1.15, exposure: 1.08,
            postfx: true,  bloom: 0.48, smaa: true,  ibl: true,  ao: true,
            reflect: 1024, reflectEvery: 1,
            softDepth: true, softScale: 0.5, cones: true, stars: true,
            gpuParticles: true, gpuWater: 262144, gpuSpray: 131072 },
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
const CPU_SAMPLE_FRACTION = 1 / 16;

// ── Camera-response pass ────────────────────────────────────────────────────
// Applied after bloom, before OutputPass (which owns tone mapping + colour space).
// These are lens/sensor behaviours a real camera exhibits — optical vignetting,
// lateral chromatic aberration and sensor noise — not a stylistic "filter". Values
// are deliberately near the threshold of perception: they make the image read as
// photographed rather than synthetic, without altering what an engineer can measure.
const CINEMATIC_SHADER = {
  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uVignette:   { value: 0.42 },   // gentle optical falloff, not a dark tunnel
    uAberration: { value: 0.30 },   // slight edge-only RGB split, as a real lens
    uGrain:      { value: 0.012 },  // faint sensor noise in the shadows
    uSaturation: { value: 1.03 },
    uContrast:   { value: 1.02 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uVignette, uAberration, uGrain, uSaturation, uContrast;
    uniform vec2  uResolution;
    varying vec2 vUv;

    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

    void main(){
      vec2 uv = vUv;
      vec2 toCenter = uv - 0.5;
      float r2 = dot(toCenter, toCenter);          // 0 at centre -> 0.5 at corners

      // Chromatic aberration: zero in the middle, grows toward the frame edge, the way
      // a real lens behaves. Scaled to pixels so it is resolution-independent.
      vec2 px = (uAberration / max(uResolution.x, 1.0)) * r2 * 4.0 * normalize(toCenter + 1e-6);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + px).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - px).b;

      // Saturation + contrast, around mid grey.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;

      // Vignette — smooth, keeps the pool centre bright. Written as 1.0 - smoothstep
      // with increasing edges: reversed edges (edge0 > edge1) are undefined in GLSL.
      float vig = 1.0 - smoothstep(0.18, 0.95, r2 * uVignette * 2.4);
      col *= mix(1.0, vig, clamp(uVignette, 0.0, 1.0));

      // Animated fine grain; strongest in the shadows so highlights stay clean.
      float g = hash(uv * uResolution + fract(uTime) * 137.0) - 0.5;
      col += g * uGrain * (1.0 - smoothstep(0.0, 0.75, luma));

      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

function seededNoise(i, salt = 0) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ─── PARTICLE SPRITES ────────────────────────────────────────────────────────
// The point-sprite shaders that lived here moved to particlesBillboard.js when the
// particles became instanced, velocity-stretched quads (AF-3D-002). The droplet
// optical model, light-field injection and premultiplied blending rationale are
// preserved there verbatim — plus soft-depth fade and sprite textures.

// ─── WATER CORE COLUMN SHADER — coherent pressurized body ───────────────────
const CORE_VERT = /* glsl */`
attribute vec3  aPos;     // base pos (cylinder vertex, y in [0..1])
uniform float   uHeight;
uniform float   uTime;
uniform float   uIntensity;
uniform vec3    uOrigin;
uniform vec2    uWind;
uniform float   uTilt;    // radians
varying float   vT;       // 0=base, 1=tip
varying vec3    vWorldPos;
varying float   vAlpha;

void main(){
  float t  = clamp(aPos.y, 0.0, 1.0);
  vT       = t;

  // Bernoulli-like decay
  float bern = 1.0 - pow(max(t - 0.55, 0.0)/0.45, 2.0) * 0.78;
  float y = t * uHeight * bern * (0.25 + uIntensity * 0.75);

  // Kelvin-Helmholtz turbulent breakup (more at tip)
  float turb = pow(t, 2.2);
  float tx = sin(t*14.0 + uTime*7.0) * 0.030;
  float tz = cos(t*11.0 - uTime*5.5) * 0.026;
  // Wind drag (parabolic, more at tip)
  float w  = t * t;

  vec3 worldPos = uOrigin + vec3(
    aPos.x + tx * turb + uWind.x * w * 0.9,
    y,
    aPos.z + tz * turb + uWind.y * w * 0.9
  );
  vWorldPos = worldPos;

  // Breakup alpha: solid at base, transparent at tip
  float breakup = 1.0 - smoothstep(0.55, 0.95, t);
  vAlpha = uIntensity * breakup * 0.85;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}`;

const CORE_FRAG = /* glsl */`
precision highp float;
uniform vec3  uWaterColor;
uniform vec3  uGlobalLight;
uniform float uGlobalLightI;
uniform int   uFieldCount;
uniform vec3  uFieldPos[${MAX_FIELD_LIGHTS}];
uniform vec3  uFieldCol[${MAX_FIELD_LIGHTS}];
uniform float uFieldInt[${MAX_FIELD_LIGHTS}];
uniform float uFieldRad[${MAX_FIELD_LIGHTS}];
varying float vT;
varying vec3  vWorldPos;
varying float vAlpha;

void main(){
  if (vAlpha < 0.01) discard;

  // Cross-section: bright TIR core, slight rim
  vec3 deep    = uWaterColor * 0.7;
  vec3 shallow = mix(uWaterColor, vec3(0.85, 0.95, 1.0), 0.55);
  vec3 col     = mix(shallow, deep, vT * 0.6);

  // SSS bright streak inside core
  float coreBand = pow(1.0 - abs(vT - 0.3), 6.0);
  col += coreBand * vec3(0.8, 0.92, 1.0) * 0.7;

      // RGB main light — subtle global tint only.
  // Main visible color must come from the physical fixture field below.
    float runtimeTint = clamp(uGlobalLightI * 0.50, 0.0, 0.85);
  float luminance = max(max(col.r, col.g), col.b);
  vec3 tintedCore = uGlobalLight * max(luminance, 0.40);

  col = mix(col, tintedCore, runtimeTint);
  col += uGlobalLight * uGlobalLightI * 0.25;

  // RGB fixture field
  for (int i = 0; i < ${MAX_FIELD_LIGHTS}; i++) {
    if (i >= uFieldCount) break;
        vec2 hd = vWorldPos.xz - uFieldPos[i].xz;
    float horizontalFall = 1.0 - clamp(length(hd) / uFieldRad[i], 0.0, 1.0);
    horizontalFall = horizontalFall * horizontalFall;

    float verticalFall = exp(-max(vWorldPos.y, 0.0) * 0.22);
    float beam = horizontalFall * verticalFall;

    col += uFieldCol[i] * uFieldInt[i] * beam * 0.95;
  }

  gl_FragColor = vec4(col, vAlpha);
}`;

// ─── LOCALIZED LIT-VOLUME GLOW (camera-facing billboard above each jet) ──────
const GLOW_VERT = /* glsl */`
uniform vec3   uOrigin;
uniform float  uHeight;
uniform float  uRadius;
varying vec2   vUv;
varying vec3   vWorld;

void main(){
  vUv = uv;
  // Build camera-facing billboard centered on (uOrigin + height/2)
  vec3 center = uOrigin + vec3(0.0, uHeight * 0.5, 0.0);
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp    = vec3(0.0, 1.0, 0.0);
  vec3 world = center + camRight * position.x * uRadius + camUp * position.y * uHeight * 0.5;
  vWorld = world;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;

const GLOW_FRAG = /* glsl */`
precision highp float;
varying vec2  vUv;
varying vec3  vWorld;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uTime;

void main(){
  vec2 c = vUv - 0.5;
  float horiz = 1.0 - smoothstep(0.0, 0.5, abs(c.x));
  float vert  = 1.0 - smoothstep(0.0, 0.5, abs(c.y) * 0.7);
  float shape = horiz * horiz * vert;
  float pulse = 0.85 + sin(uTime * 3.0) * 0.15;
  float a = shape * uIntensity * pulse * 0.55;
  gl_FragColor = vec4(uColor, a);
}`;

// ─── WATER SURFACE — Gerstner + GGX + caustic + RGB light field ─────────────
const WATER_VERT_V2 = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform float uWind;
uniform mat4  uReflectMatrix;
varying vec2  vUv;
varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vDepth;
varying float vFoam;
varying vec4  vReflectCoord;

vec3 gerstner(vec2 p, vec2 dir, float amp, float freq, float speed, float steep, float t){
  float phase = dot(dir, p) * freq + t * speed;
  float s = sin(phase), c = cos(phase);
  return vec3(steep * amp * dir.x * c, amp * s, steep * amp * dir.y * c);
}

void main(){
  vUv = uv;
  vec3 pos = position;
  float I  = max(uIntensity, 0.2);
  vec3 w1 = gerstner(pos.xz, normalize(vec2( 1.0, 0.6)), 0.035*I, 2.1, 1.20, 0.8, uTime);
  vec3 w2 = gerstner(pos.xz, normalize(vec2(-0.7, 1.0)), 0.028*I, 1.8, 0.90, 0.6, uTime*0.85);
  vec3 w3 = gerstner(pos.xz, normalize(vec2( 0.3,-1.0)), 0.018*I, 3.5, 1.80, 0.4, uTime*1.15);
  vec3 w4 = gerstner(pos.xz, normalize(vec2(-1.0, 0.4)), 0.012*I, 4.8, 2.40, 0.3, uTime*0.70);
  vec3 disp = w1 + w2 + w3 + w4;
  pos += disp;
  float dx = (w1.y + w2.y + w3.y) * 2.0;
  float dz = (w1.y + w2.y + w4.y) * 2.0;
  vNormal = normalize(normalMatrix * normalize(vec3(-dx*1.8, 1.0, -dz*1.8)));
  // Foam only where wave trains actually superpose near their combined maximum.
  // The old 0.02 threshold sat below every single crest, so daylight painted the
  // whole surface in ordered white rows — wave-pattern stripes, not foam.
  vFoam   = smoothstep(0.058, 0.105, disp.y) * I;
  vDepth  = 1.0 - length(uv - 0.5) * 2.2;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorldPos = wp.xyz;
  // Project against the FLAT plane, not the wave-displaced point: the mirror lives at
  // the mean waterline, and projecting the displaced position would double-count the
  // wave (once here, once via the normal perturbation in the fragment stage) and make
  // the reflection swim.
  vReflectCoord = uReflectMatrix * (modelMatrix * vec4(position, 1.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const WATER_FRAG_V2 = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3  uLightColor;
uniform float uLightIntensity;
uniform vec3  uDeepColor;
uniform vec3  uShallowColor;
uniform vec3  uSkyColor;
uniform float uRoughness;
uniform vec3  uCameraPos;
uniform sampler2D uReflectTex;
uniform float uReflectStrength;   // 0 disables the sample and falls back to flat sky
uniform float uIntensity;         // surface agitation — drives reflection break-up
uniform int   uFieldCount;
uniform vec3  uFieldPos[${MAX_FIELD_LIGHTS}];
uniform vec3  uFieldCol[${MAX_FIELD_LIGHTS}];
uniform float uFieldInt[${MAX_FIELD_LIGHTS}];
uniform float uFieldRad[${MAX_FIELD_LIGHTS}];
varying vec2  vUv;
varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vDepth;
varying float vFoam;
varying vec4  vReflectCoord;

void main(){
  float depth = clamp(vDepth, 0.0, 1.0);
  float absorption = exp(-depth * 2.5);
  vec3  base = mix(uDeepColor, uShallowColor, pow(1.0 - absorption, 0.7));

  // Procedural caustics
  float c1 = sin(vUv.x * 18.0 + uTime * 1.1) * cos(vUv.y * 14.0 + uTime * 0.85);
  float c2 = sin(vUv.x * 11.0 - uTime * 1.3) * cos(vUv.y * 12.0 + uTime * 0.65);
  float c3 = sin((vUv.x + vUv.y) * 9.0 + uTime * 0.9) * 0.5;
  float caustics = pow(max(c1*c2, 0.0), 2.2) * 0.35 + pow(max(c3, 0.0), 3.0) * 0.2;

    // Main light caustic tint
  base += caustics * uLightColor * uLightIntensity * 0.7;

  // Per-fixture light field — pool surface receives bleeds + specular tint
  vec3 fieldContrib = vec3(0.0);
  for (int i = 0; i < ${MAX_FIELD_LIGHTS}; i++) {
    if (i >= uFieldCount) break;
    float dist = distance(vWorldPos, uFieldPos[i]);
    float fall = 1.0 - clamp(dist / uFieldRad[i], 0.0, 1.0);
    fall = fall * fall;
    fieldContrib += uFieldCol[i] * uFieldInt[i] * fall;
  }
      // Realistic surface bleed: visible reflection, not full material recolor.
    base += fieldContrib * 0.95;
  base += fieldContrib * caustics * 1.35;

  float fieldStrength = clamp(length(fieldContrib), 0.0, 1.0);
  base = mix(base, base + fieldContrib * 1.4, fieldStrength);

  // GGX specular
  vec3 viewDir  = normalize(uCameraPos - vWorldPos);
  vec3 lightDir = normalize(vec3(0.4, 1.0, 0.6));
  vec3 halfDir  = normalize(viewDir + lightDir);
  float NdotH   = max(dot(vNormal, halfDir), 0.0);
  float rough   = max(uRoughness, 0.05);
  float a2      = rough * rough;
  float denom   = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float ggx     = a2 / (3.14159 * denom * denom);
  base += vec3(ggx * 0.35);

  // Colored specular spike under strong RGB fixtures
  base += fieldContrib * ggx * 1.8;

  // ── Fresnel reflection ────────────────────────────────────────────────────
  // Schlick against water's true normal-incidence reflectance. For IOR 1.333,
  // F0 = ((1.333-1)/(1.333+1))^2 = 0.02: looking straight down, water reflects
  // almost nothing and you see the basin; at a grazing angle it becomes a mirror.
  // That enormous swing is the single strongest cue that a surface IS water, so it
  // is worth getting exactly right rather than approximating with a tuned power.
  float NdotV   = max(dot(vNormal, viewDir), 0.0);
  const float F0 = 0.02;
  float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

  // The mirror image, projected from the reflection pass and perturbed by the wave
  // normal so it breaks up and streams with the surface.
  vec3 skyFallback = uSkyColor * 0.55 + uLightColor * 0.10;
  vec3 reflected   = skyFallback;
  if (uReflectStrength > 0.0 && vReflectCoord.w > 0.0) {
    vec2 ruv = vReflectCoord.xy / vReflectCoord.w;
    // Perturbation shrinks as the surface calms, and with distance, so a still pool
    // gives a clean mirror and a driven one gives broken light.
    vec2 distort = vNormal.xz * (0.055 + 0.10 * uIntensity);
    vec2 suv = clamp(ruv + distort, vec2(0.001), vec2(0.999));
    vec3 mirrorCol = texture2D(uReflectTex, suv).rgb;
    // Water is not a perfect mirror: it tints what it reflects and loses a little
    // energy doing it.
    mirrorCol *= mix(vec3(1.0), uShallowColor * 2.2 + vec3(0.35), 0.28);
    reflected = mix(skyFallback, mirrorCol, uReflectStrength);
  }
  base = mix(base, reflected, fresnel);

  // Underwater light bleed
  base += uLightColor * uLightIntensity * 0.3 * depth;

  // Foam
  float foamTex = sin(vUv.x*80.0 + uTime) * cos(vUv.y*80.0 + uTime*0.8) * 0.5 + 0.5;
  base = mix(base, vec3(0.95, 0.97, 1.0), vFoam * foamTex * 0.7);

  // Edge darkening
  base *= 0.85 + depth * 0.15;

  // Opacity follows the same fresnel term. Looking down you see INTO the water, so it
  // is translucent; at a grazing angle the surface is a mirror and nothing behind it
  // shows through. A constant alpha makes water look like tinted glass.
  float alpha = mix(0.86, 1.0, fresnel);
  gl_FragColor = vec4(base, alpha);
}`;

// ─── FOG SHADER ──────────────────────────────────────────────────────────────
const FOG_VERT = /* glsl */`
attribute vec3  aOffset;
attribute float aScale;
attribute float aDensity;
attribute float aLife;
uniform float uTime;
varying float vDensity;
varying float vLife;
void main(){
  vDensity = aDensity; vLife = aLife;
  vec3 pos = aOffset;
  pos.x += sin(uTime*0.3 + aOffset.z) * 0.10;
  pos.z += cos(uTime*0.25 + aOffset.x) * 0.08;
  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = aScale * (500.0 / -mvPos.z);
  gl_Position  = projectionMatrix * mvPos;
}`;

const FOG_FRAG = /* glsl */`
precision highp float;
uniform vec3 uFogColor;
varying float vDensity; varying float vLife;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv); if(d > 0.5) discard;
  float a = smoothstep(0.5, 0.05, d) * vDensity * vLife * 0.35;
  gl_FragColor = vec4(uFogColor, a);
}`;

// ─── LASER BEAM ──────────────────────────────────────────────────────────────
const LASER_VERT = /* glsl */`
varying float vPos;
void main(){
  vPos = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const LASER_FRAG = /* glsl */`
precision highp float;
uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
varying float vPos;
void main(){
  float glow  = exp(-abs(vPos - 0.5) * 8.0);
  float flick = 0.85 + sin(uTime * 40.0) * 0.15;
  float a = uIntensity * flick * (0.6 + glow * 0.4);
  gl_FragColor = vec4(uColor + glow * 0.5, a * 0.9);
}`;
// ─── GPU Particle System (with anisotropic stretch + RGB field uniforms) ────
const MAX_WATER  = 60000;
const MAX_SPRAY  = 22000;
const MAX_FOAM   = 6000;
const MAX_FLAME  = 3000;
const MAX_FOG    = 2000;

class GPUParticleSystem {
  /**
   * @param {"scatter"|"emissive"} blendMode
   *   "scatter" — water, spray, foam. Premultiplied source-over: the medium occludes
   *   and saturates, which is how a cloud of droplets actually behaves.
   *   "emissive" — flame. Genuinely radiating, so it adds and does not occlude.
   */
  constructor(T, maxCount, pixelRatio, blendMode = "scatter", map = null) {
    this.T = T;
    this.maxCount = maxCount;
    this.active   = 0;
    this.px = pixelRatio;
    this.blendMode = blendMode;
    this.sampleFraction = 1;

    this.positions  = new Float32Array(maxCount * 3);
    this.velocities = new Float32Array(maxCount * 3);
    this.colors     = new Float32Array(maxCount * 4);
    this.scales     = new Float32Array(maxCount);
    this.lives      = new Float32Array(maxCount);
    this.maxLives   = new Float32Array(maxCount);
    this.bounced    = new Uint8Array(maxCount);
    this.stretches  = new Float32Array(maxCount);
    this.seeds      = new Float32Array(maxCount);

    // AF-3D-002: instanced billboard quads instead of gl_Points — velocity-aligned
    // stretch, no driver point-size clamp, sprite textures, soft-depth fade. The
    // geometry wraps THIS class's arrays, so the simulation below is untouched.
    const geo = buildBillboardGeometry(T, maxCount, this);
    this.mat = buildBillboardMaterial(T, {
      maxFieldLights: MAX_FIELD_LIGHTS,
      blendMode,
      map,
    });
    // Light-field entries are re-pointed at the scene's shared uniforms in init().
    this.uniforms = this.mat.uniforms;
    this.mesh = new T.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
  }

  /** Bind (or with null, unbind) the scene-depth probe for soft particles. */
  setSoftDepth(texture, invResX, invResY, near, far) {
    const u = this.uniforms;
    u.uSceneDepth.value = texture || null;
    u.uUseDepth.value = texture ? 1.0 : 0.0;
    u.uInvRes.value.set(invResX || 1, invResY || 1);
    u.uNear.value = near ?? 0.1;
    u.uFar.value = far ?? 500;
  }

  /** Temporarily toggle the soft-depth fade (off during the reflection pass, where
   *  gl_FragCoord lives in the probe's target, not the screen). */
  setSoftEnabled(on) {
    const u = this.uniforms;
    u.uUseDepth.value = (on && u.uSceneDepth.value) ? 1.0 : 0.0;
  }

  spawn(x,y,z, vx,vy,vz, r,g,b,a, life, scale, stretch=0.5) {
    if (this.active >= this.maxCount) return;
    // Statistical sampling (see CPU_SAMPLE_FRACTION). Applied here rather than at the
    // call sites so the sample is unbiased across nozzles — thinning inside each
    // emitter's loop would have favoured whichever nozzle is iterated first.
    if (this.sampleFraction < 1 && Math.random() >= this.sampleFraction) return;
    const i = this.active++;
    // Sub-frame spawn advance: all of a frame's particles used to be born at the
    // nozzle mouth in the same instant, so a fast jet rendered as a chain of pearls
    // one frame-step apart. Distributing each birth along its own first 1/60 s of
    // flight fills the gaps and the stream reads as continuous.
    const sub = Math.random() * 0.0167;
    x += vx * sub; y += vy * sub; z += vz * sub;
    this.positions[i*3]=x; this.positions[i*3+1]=y; this.positions[i*3+2]=z;
    this.velocities[i*3]=vx; this.velocities[i*3+1]=vy; this.velocities[i*3+2]=vz;
    this.colors[i*4]=r; this.colors[i*4+1]=g; this.colors[i*4+2]=b; this.colors[i*4+3]=a;
    this.scales[i]=scale;
    this.lives[i]=life; this.maxLives[i]=life;
    this.bounced[i]=0;
    this.stretches[i]=stretch;
    this.seeds[i]=(i * 2654435761 % 1000) / 1000;
  }

  update(delta, gravity=-RE_GRAVITY, elapsed=0) {
    let alive = 0;
    const drag = 0.018;

    for (let i=0; i<this.active; i++) {
      this.lives[i] -= delta;
      if (this.lives[i] <= 0) continue;

      const lifeRatio = this.lives[i] / this.maxLives[i];
      const vx = this.velocities[i*3];
      const vy = this.velocities[i*3+1];
      const vz = this.velocities[i*3+2];
      const speed = Math.sqrt(vx*vx + vy*vy + vz*vz);
      const dragF = drag * speed;
      const ax = -vx * dragF;
      const ay = gravity - vy * dragF;
      const az = -vz * dragF;

      this.velocities[i*3]   += ax * delta;
      this.velocities[i*3+1] += ay * delta;
      this.velocities[i*3+2] += az * delta;
      this.positions[i*3]   += this.velocities[i*3]   * delta;
      this.positions[i*3+1] += this.velocities[i*3+1] * delta;
      this.positions[i*3+2] += this.velocities[i*3+2] * delta;

      // ── Impact ──────────────────────────────────────────────────────────────
      // Landing in the basin and landing on the deck are different events, and the
      // old code treated the whole world as one infinite water plane. Water hitting
      // stone shatters and scatters sideways; water hitting water punches in and
      // throws a compact splash back up. Getting this wrong is very visible at the
      // pool edge, which is exactly where a viewer looks to judge whether the
      // fountain is contained.
      if (this.positions[i*3+1] < 0.05 && this.bounced[i] === 0 && vy < -0.5) {
        const px = this.positions[i*3], pz = this.positions[i*3+2];
        const inside = this.poolBounds ? SM_insidePool(px, pz, this.poolBounds()) : true;

        this.bounced[i] = 1;
        this.positions[i*3+1] = inside ? 0.05 : 0.012;

        if (inside) {
          // Water into water: elastic-ish vertical return, splash broadens.
          this.velocities[i*3+1] = Math.abs(vy) * 0.15;
          this.velocities[i*3]   *= 0.8;
          this.velocities[i*3+2] *= 0.8;
          this.scales[i] *= 2.0;
          this.colors[i*4+3] *= 0.7;
          this.stretches[i]   *= 0.4;
        } else {
          // Water onto stone: most of the vertical momentum is lost to the surface,
          // and the drop breaks into a low, fast lateral sheet.
          this.velocities[i*3+1] = Math.abs(vy) * 0.06;
          this.velocities[i*3]   *= 1.35;
          this.velocities[i*3+2] *= 1.35;
          this.scales[i] *= 1.5;
          this.colors[i*4+3] *= 0.5;
          this.stretches[i]   *= 0.25;
          this.lives[i] = Math.min(this.lives[i], 0.5);
        }

        // Record it. This is what drives the wetness field and the containment figures.
        if (this.impactSink) this.impactSink(px, pz, 1, inside);
      }

      // Alpha fade
      this.colors[i*4+3] *= (1 - delta * 1.2 * (1.0 - lifeRatio));
      this.lives[alive] = this.lives[i];
      this.maxLives[alive] = this.maxLives[i];

      if (alive !== i) {
        this.positions.copyWithin(alive*3,  i*3,  i*3+3);
        this.velocities.copyWithin(alive*3, i*3,  i*3+3);
        this.colors.copyWithin(alive*4,     i*4,  i*4+4);
        this.scales[alive]    = this.scales[i];
        this.bounced[alive]   = this.bounced[i];
        this.stretches[alive] = this.stretches[i];
        this.seeds[alive]     = this.seeds[i];
      }
      alive++;
    }
    this.active = alive;
    this.mesh.geometry.instanceCount = alive;
    this.mesh.geometry.attributes.aOffset.needsUpdate  = true;
    this.mesh.geometry.attributes.aVel.needsUpdate     = true;
    this.mesh.geometry.attributes.aColor.needsUpdate   = true;
    this.mesh.geometry.attributes.aLife.needsUpdate    = true;
    this.mesh.geometry.attributes.aScale.needsUpdate   = true;
    this.mesh.geometry.attributes.aStretch.needsUpdate = true;
    this.mesh.geometry.attributes.aSeed.needsUpdate    = true;
  }

  reset() { this.active = 0; this.mesh.geometry.instanceCount = 0; }
  dispose() { this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ─── NozzleV2 — 4-layer fountain stack (core column + breakup + mist + impact)
class NozzleV2 {
  constructor(T, waterSys, spraySys, foamSys, flameSys, config, sharedLightUniforms) {
    this.T = T;
    this.waterSys = waterSys;
    this.spraySys = spraySys;
    this.foamSys  = foamSys;
    this.flameSys = flameSys;
    this.config   = config;
    this.intensity = 0;

    this._buildMarker();
    this._buildCoreColumn(sharedLightUniforms);
    this._buildGlow(sharedLightUniforms);
  }

  _buildMarker() {
    const T=this.T;
    const dg = new T.CylinderGeometry(0.04, 0.06, 0.12, 8);
    const dm = new T.MeshStandardMaterial({
      color:0x334455, emissive:0x001122, roughness:0.3, metalness:0.9
    });
    this.dot = new T.Mesh(dg, dm);
    this.dot.position.set(this.config.x||0, 0.06, this.config.z||0);
  }

  // ── Layer 1: Pressurized water CORE column (a thin cylinder rendered with
  //    custom shader). Acts as the coherent body the eye reads as a solid jet.
  _buildCoreColumn(sharedLightUniforms) {
    const T = this.T;
    const type = this.config.type || 'jet_3d';

    // Skip core mesh for layer-style nozzles that don't have a vertical column
        if (type === 'mist' || type === 'cascade' || type === 'ring' || type === 'arch' || type === 'fan_jet' || type === 'flame' || type === 'laser' || type === 'screen') {
      this.core = null;
      return;
    }

    // Build a low-poly cylinder where Y in [0..1] is parameter along jet
    const radius = (type === 'laminar') ? 0.022
                 : (type === 'jet_1d')  ? 0.010
                 : (type === 'jet_2d')  ? 0.012
                 : (type === 'geyser')  ? 0.038
                                        : 0.014; // jet_3d default — matches DN25 bore
    const segments = 10;
    const heightDivs = 14;
    const geo = new T.CylinderGeometry(radius, radius * 1.1, 1.0, segments, heightDivs, true);
    // Move pivot so Y=0 is base
    geo.translate(0, 0.5, 0);
    // Provide aPos attribute (use position cloned)
    const posAttr = geo.attributes.position;
    const aPos = new Float32Array(posAttr.count * 3);
    for (let i=0; i<posAttr.count; i++) {
      aPos[i*3]   = posAttr.getX(i);
      aPos[i*3+1] = posAttr.getY(i);
      aPos[i*3+2] = posAttr.getZ(i);
    }
    geo.setAttribute('aPos', new T.BufferAttribute(aPos, 3));

    const uniforms = {
      uHeight:       { value: 6.0 },
      uTime:         { value: 0 },
      uIntensity:    { value: 0 },
      uOrigin:       { value: new T.Vector3(this.config.x||0, 0.0, this.config.z||0) },
      uWind:         { value: new T.Vector2(0,0) },
      uTilt:         { value: 0 },
      uWaterColor:   { value: new T.Color(0x88ccff) },
      uGlobalLight:  sharedLightUniforms.uGlobalLight,
      uGlobalLightI: sharedLightUniforms.uGlobalLightI,
      uFieldCount:   sharedLightUniforms.uFieldCount,
      uFieldPos:     sharedLightUniforms.uFieldPos,
      uFieldCol:     sharedLightUniforms.uFieldCol,
      uFieldInt:     sharedLightUniforms.uFieldInt,
      uFieldRad:     sharedLightUniforms.uFieldRad,
    };

    this.core = new T.Mesh(geo, new T.ShaderMaterial({
      vertexShader: CORE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: T.NormalBlending,
      uniforms,
    }));
    this.core.frustumCulled = false;
  }

  // ── Localized lit-volume glow billboard around active jet (Phase 2)
  _buildGlow(sharedLightUniforms) {
    const T = this.T;
    const type = this.config.type || 'jet_3d';
        if (type === 'cascade' || type === 'ring' || type === 'laser' || type === 'screen') { this.glow = null; return; }

    const quadGeo = new T.PlaneGeometry(1, 1);
    const uniforms = {
      uOrigin:    { value: new T.Vector3(this.config.x||0, 0, this.config.z||0) },
      uHeight:    { value: 6.0 },
      uRadius:    { value: 1.2 },
      uColor:     { value: new T.Color(0xffffff) },
      uIntensity: { value: 0 },
      uTime:      { value: 0 },
    };
    this.glow = new T.Mesh(quadGeo, new T.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms,
    }));
    this.glow.frustumCulled = false;
  }

  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }

  /** Attach solved hydraulics for this nozzle (AQ-S2-002 Phase 2).
   *  `rec` = { exitVelocityMs, jetHeightM }; `sink` collects over-demand reports. */
  setPhysics(rec, sink) {
    this.physics = JP_normalizePhysics(rec);
    this._overDemandSink = sink || null;
  }

  /** Launch speed for this frame — see jetPhysics.js for the rule. Unsolved
   *  nozzles return the caller's legacy per-type estimate unchanged. */
  _launchSpeed(demand, fallbackSpeed) {
    return JP_launchSpeed(this.physics, demand, fallbackSpeed,
                          this._overDemandSink, this.config?.id);
  }

  /**
   * Drive all 4 layers each frame.
   * @param delta seconds since last frame
   * @param elapsed total scene time
   * @param wind  {x,z}
   * @param tintColor THREE.Color — current effective RGB tint for spray
   */
  update(delta, elapsed, wind, tintColor) {
    const ix = this.intensity;
    const cfg = this.config;
    const type = cfg.type || 'jet_3d';
    const ox = cfg.x || 0;
    const oz = cfg.z || 0;
    // Dynamic RGB water coloration
    const wc = tintColor || new this.T.Color(0.55, 0.80, 1.0);

    // Water particles should inherit lighting color
    // while still preserving slight natural blue tint.
    const waterR = Math.min(1.0, wc.r * 0.85 + 0.15);
    const waterG = Math.min(1.0, wc.g * 0.85 + 0.15);
    const waterB = Math.min(1.0, wc.b * 0.90 + 0.25);

    // Phase-2: drive the lit-volume glow & core uniforms continuously
    if (this.core) {
      const uns = this.core.material.uniforms;
      uns.uTime.value = elapsed;
      uns.uIntensity.value = ix;
      uns.uOrigin.value.set(ox, 0.05, oz);
      uns.uWind.value.set(wind.x||0, wind.z||0);
      uns.uHeight.value = this._coreHeightFor(type, ix);
      if (tintColor) uns.uWaterColor.value.copy(tintColor).multiplyScalar(0.6).add(new this.T.Color(0.3,0.5,0.8));
    }
    if (this.glow) {
      const uns = this.glow.material.uniforms;
      uns.uTime.value = elapsed;
      uns.uIntensity.value = ix * 0.85;
      uns.uOrigin.value.set(ox, 0.1, oz);
      uns.uHeight.value = this._coreHeightFor(type, ix) * 0.9;
      uns.uRadius.value = this._glowRadiusFor(type, ix);
      if (tintColor) uns.uColor.value.copy(tintColor);
    }

    if (ix < 0.015) return;

    // Phase-1: 4-layer emission per nozzle type ────────────────────────────
    switch (type) {

      case 'jet_1d': {
        const spawnN = Math.floor(delta * 280 * ix);
        for (let s=0; s<spawnN; s++) {
          const jit = 0.015;
          const vy = this._launchSpeed(ix, 4.5 + ix * 5.5) + (Math.random()-0.5)*0.3;
          const vx = (Math.random()-0.5)*jit + wind.x*0.08;
          const vz = (Math.random()-0.5)*jit + wind.z*0.08;
          const life = vy * 2.04 / 9.81;
          const sc = 0.09 + ix*0.05;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.02, 0.08, oz+(Math.random()-0.5)*0.02,
            vx, vy, vz, waterR, waterG, waterB, 0.9, life, sc, 0.7);
        }
        if (ix > 0.4) this._spawnApexMist(ox, (4.5+ix*5.5)**2/(2*9.81), oz, ix, 0.14);
        break;
      }

      case 'jet_2d': {
        const spawnN = Math.floor(delta * 320 * ix);
        const tiltX = (cfg.tiltX||0)*Math.PI/180;
        const tiltZ = (cfg.tiltZ||0)*Math.PI/180;
        for (let s=0; s<spawnN; s++) {
          const speed = this._launchSpeed(ix, 5.5 + ix*7.0);
          const vy = Math.cos(tiltX)*Math.cos(tiltZ)*speed;
          const vx = Math.sin(tiltX)*speed + (Math.random()-0.5)*0.06 + wind.x*0.1;
          const vz = Math.sin(tiltZ)*speed + (Math.random()-0.5)*0.06 + wind.z*0.1;
          const life = vy/9.81*2.0*1.05;
          const sc = 0.10 + ix*0.06;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.04, 0.08, oz+(Math.random()-0.5)*0.04,
  	    vx, vy, vz, waterR, waterG, waterB, 0.88, life, sc, 0.6);
        }
        if (ix > 0.35) {
          const speed = this._launchSpeed(ix, 5.5 + ix*7.0);
          const apex = (Math.cos((cfg.tiltX||0)*Math.PI/180)*speed)**2/(2*9.81);
          this._spawnApexMist(ox, apex, oz, ix, 0.20);
        }
        break;
      }

      case 'jet_3d': {
        const spawnN = Math.floor(delta * 260 * ix);
        const tiltX = (cfg.tiltX||0)*Math.PI/180;
        const tiltZ = (cfg.tiltZ||0)*Math.PI/180;
        for (let s=0; s<spawnN; s++) {
          const speed = this._launchSpeed(ix, 6.5 + ix*8.5);
          const spread = 0.055 + ix*0.04;
          const vy = Math.cos(tiltX)*speed;
          const vx = Math.sin(tiltX)*speed + (Math.random()-0.5)*spread + wind.x*0.12;
          const vz = Math.sin(tiltZ)*speed + (Math.random()-0.5)*spread + wind.z*0.12;
          const life = vy/9.81*2.0*1.1;
          const sc = 0.11 + ix*0.06;
          const b = 0.7 + Math.random()*0.3;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.06, 0.08, oz+(Math.random()-0.5)*0.06,
  	    vx, vy, vz, waterR, waterG, waterB, 0.85, life, sc, 0.55);
          if (ix > 0.6 && Math.random() < 0.25) {
            this.spraySys.spawn(ox+(Math.random()-0.5)*0.1, 0.08, oz+(Math.random()-0.5)*0.1,
 		 vx*0.7+(Math.random()-0.5)*0.8, vy*0.8, vz*0.7+(Math.random()-0.5)*0.8,
		  waterR, waterG, waterB, 0.65, life*0.6, sc*0.5, 0.35);
          }
        }
        const speed2 = 6.5 + ix*8.5;
        this._spawnApexMist(ox, speed2*speed2/(2*9.81), oz, ix, 0.36);
        break;
      }

       case 'geyser': {
        const spawnN = Math.floor(delta * 380 * ix);
        for (let s=0; s<spawnN; s++) {
          const coreSpd = 9.0 + ix*13.0;
          const spread = 0.35*ix;
          const vx = (Math.random()-0.5)*spread + wind.x*0.15;
          const vy = coreSpd * (0.88 + Math.random()*0.24);
          const vz = (Math.random()-0.5)*spread + wind.z*0.15;
          const life = vy/9.81*2.0*(0.9+Math.random()*0.2);
          const sc = 0.14 + ix*0.10 + Math.random()*0.06;
          const w = 0.7 + ix*0.3;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.12, 0.08, oz+(Math.random()-0.5)*0.12,
 	  vx, vy, vz, waterR, waterG, waterB, 0.82, life, sc, 0.65);
        }
        if (ix > 0.3) {
          const mistN = Math.floor(delta*140*ix);
          for (let m=0; m<mistN; m++) {
            const angle = Math.random()*Math.PI*2;
            const r = 0.2 + Math.random()*0.5;
            this.spraySys.spawn(
  		ox+Math.cos(angle)*r, 0.1+Math.random()*2.0*ix, oz+Math.sin(angle)*r,
  		Math.cos(angle)*0.6*ix+(Math.random()-0.5)*0.4,
 	 	1.5+Math.random()*2.0*ix,
  		Math.sin(angle)*0.6*ix+(Math.random()-0.5)*0.4,
  		waterR, waterG, waterB, 0.55, 0.8+Math.random()*0.8, 0.25+ix*0.20, 0.30);
          }
        }
        if (ix > 0.5) this._spawnBaseSplash(ox, oz, ix, 1.8);
        break;
      }

      case 'arch': {
        const spawnN = Math.floor(delta * 380 * ix);
        const toCenter = Math.atan2(-oz, -ox);
        const archAngle = 28 + ix*18;
        const archRad = archAngle*Math.PI/180;
        const speed = 5.0 + ix*6.5;
        for (let s=0; s<spawnN; s++) {
          const sp = 0.04 + (1-ix)*0.03;
          const vx = Math.cos(toCenter)*Math.cos(archRad)*speed + (Math.random()-0.5)*sp + wind.x*0.1;
          const vy = Math.sin(archRad)*speed + (Math.random()-0.5)*0.12;
          const vz = Math.sin(toCenter)*Math.cos(archRad)*speed + (Math.random()-0.5)*sp + wind.z*0.1;
          const life = vy/9.81*2.0*1.15;
          const sc = 0.10 + ix*0.06;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.03, 0.1, oz+(Math.random()-0.5)*0.05,
  		vx, vy, vz, waterR, waterG, waterB, 0.90, life, sc, 0.55);
        }
        break;
      }

      case 'ring': {
        const numJets = 12;
        const spawnEach = Math.floor(delta * 25 * ix);
        for (let j=0; j<numJets; j++) {
          const angle = (j/numJets)*Math.PI*2;
          const outward = 0.35 + ix*0.45;
          for (let s=0; s<spawnEach; s++) {
            const vy = 3.5 + ix*4.5 + (Math.random()-0.5)*0.5;
            const vx = Math.cos(angle)*outward*(3+ix*3) + (Math.random()-0.5)*0.08 + wind.x*0.1;
            const vz = Math.sin(angle)*outward*(3+ix*3) + (Math.random()-0.5)*0.08 + wind.z*0.1;
            const life = vy/9.81*2.0*1.05;
            const sc = 0.09 + ix*0.05;
            this.waterSys.spawn(
  		ox+Math.cos(angle)*0.1+(Math.random()-0.5)*0.02, 0.08,
  		oz+Math.sin(angle)*0.1+(Math.random()-0.5)*0.03,
  		vx, vy, vz, waterR, waterG, waterB, 0.88, life, sc, 0.5);
          }
        }
        break;
      }

      case 'laminar': {
        const spawnN = Math.floor(delta * 200 * ix);
        for (let s=0; s<spawnN; s++) {
          const jit = 0.008;
          const vy = 6.5 + ix*7.5 + (Math.random()-0.5)*0.15;
          const vx = (Math.random()-0.5)*jit + wind.x*0.05;
          const vz = (Math.random()-0.5)*jit + wind.z*0.05;
          const life = vy/9.81*2.0*1.08;
          const sc = 0.09 + ix*0.04;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.005, 0.08, oz+(Math.random()-0.5)*0.01,
  		vx, vy, vz, waterR, waterG, waterB, 0.95, life, sc, 0.8);
        }
        if (ix > 0.5) {
          const h = (6.5+ix*7.5)**2/(2*9.81);
          this._spawnApexMist(ox, h, oz, ix*0.4, 0.08);
        }
        break;
      }

      case 'mist': {
        const spawnN = Math.floor(delta * 500 * ix);
        for (let s=0; s<spawnN; s++) {
          const angle = Math.random()*Math.PI*2;
          const rOut = Math.random()*0.6*ix;
          const vy = 0.8 + ix*1.8 + (Math.random()-0.5)*0.6;
          const vx = Math.cos(angle)*rOut*1.5 + (Math.random()-0.5)*0.35 + wind.x*0.3;
          const vz = Math.sin(angle)*rOut*1.5 + (Math.random()-0.5)*0.35 + wind.z*0.3;
          const life = 1.2 + Math.random()*2.2*ix;
          const sc = 0.16 + ix*0.12 + Math.random()*0.06;
          this.spraySys.spawn(ox+(Math.random()-0.5)*0.15, 0.08+Math.random()*0.3,
  		oz+(Math.random()-0.5)*0.15,
  		vx, vy, vz, waterR, waterG, waterB, 0.45+Math.random()*0.35, life, sc, 0.2);
        }
        break;
      }

      case 'cascade': {
        const spawnN = Math.floor(delta * 450 * ix);
        for (let s=0; s<spawnN; s++) {
          const offset = (Math.random()-0.5)*(1.5+ix*2.0);
          const vx = (Math.random()-0.5)*0.3 + offset*0.1 + wind.x*0.2;
          const vy = 0.5 + ix*1.5 + Math.random()*0.8;
          const vz = (Math.random()-0.5)*0.3 + wind.z*0.2;
          const life = 0.6 + Math.random()*0.9;
          const sc = 0.10 + ix*0.06;
          this.waterSys.spawn(ox+offset, 2.5+ix*3.0, oz+(Math.random()-0.5)*0.08,
  		vx, -vy, vz, waterR, waterG, waterB, 0.82, life, sc, 0.6);
        }
        break;
      }

      case 'pirouette': {
        const spawnN = Math.floor(delta * 360 * ix);
        const rot = elapsed * 2.5;
        for (let s=0; s<spawnN; s++) {
          const a = rot + (Math.random()-0.5)*0.4;
          const speed = this._launchSpeed(ix, 5.5 + ix*7.0);
          const vy = Math.cos(0.4)*speed;
          const vx = Math.sin(0.4)*Math.cos(a)*speed + wind.x*0.1;
          const vz = Math.sin(0.4)*Math.sin(a)*speed + wind.z*0.1;
          const life = vy/9.81*2.0*1.05;
          const sc = 0.10 + ix*0.06;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.03, 0.08, oz+(Math.random()-0.5)*0.03,
  		vx, vy, vz, waterR, waterG, waterB, 0.88, life, sc, 0.55);
        }
        break;
      }

      case 'fan_jet': {
        const spreadAngle = 25 + ix * 20; // degrees half-angle
        const numStreams = 5;
        const spawnEach = Math.floor(delta * 80 * ix);
        for (let st = 0; st < numStreams; st++) {
          const streamAngle = ((st / (numStreams - 1)) - 0.5) * 2 * spreadAngle * Math.PI / 180;
          for (let s = 0; s < spawnEach; s++) {
            const speed = 4.0 + ix * 5.0;
            const vy = Math.cos(Math.abs(streamAngle)) * speed;
            const vx = Math.sin(streamAngle) * speed + (Math.random()-0.5)*0.2 + wind.x*0.12;
            const vz = (Math.random()-0.5)*0.15 + wind.z*0.1;
            const life = vy/9.81*2.0*1.05;
            const sc = 0.09 + ix*0.05;
            this.waterSys.spawn(
  		ox+(Math.random()-0.5)*0.03, 0.08, oz+(Math.random()-0.5)*0.03,
  		vx, vy, vz, waterR, waterG, waterB, 0.85, life, sc, 0.45
	    );
          }
        }
        // Wide spray shell for fan
        if (ix > 0.3) {
          const shellN = Math.floor(delta * 120 * ix);
          for (let s = 0; s < shellN; s++) {
            const angle = ((Math.random()-0.5) * 2 * spreadAngle * 1.5) * Math.PI / 180;
            const speed = 3.0 + ix * 3.5;
            const vy = Math.cos(Math.abs(angle)) * speed;
            const vx = Math.sin(angle) * speed;
            const vz = (Math.random()-0.5)*0.3;
            this.spraySys.spawn(
  		ox+(Math.random()-0.5)*0.2, 0.08, oz+(Math.random()-0.5)*0.2,
  		vx*0.6+(Math.random()-0.5)*0.5, vy*0.7, vz*0.6+(Math.random()-0.5)*0.5,
  		waterR, waterG, waterB, 0.55, 0.6+Math.random()*0.3, 0.18+ix*0.08, 0.25
	    );
          }
        }
                break;
      }

      case 'flame': {
        const spawnN = Math.floor(delta * 200 * ix);
        for (let s = 0; s < spawnN; s++) {
          const angle = Math.random() * Math.PI * 2;
          const r = Math.random() * 0.15 * ix;
          const vy = 2.5 + ix * 4.0 + Math.random() * 1.5;
          const vx = Math.cos(angle) * r * 2.0 + (Math.random()-0.5)*0.3;
          const vz = Math.sin(angle) * r * 2.0 + (Math.random()-0.5)*0.3;
          const life = 0.5 + Math.random() * 0.8 * ix;
          const sc = 0.35 + ix * 0.25 + Math.random() * 0.15;
                    // Warm fire colors: deep orange → yellow.
          // Keep blue/white very low so flame does not become washed-out white.
          const warmth = Math.random();
          const rCol = 1.0;
	  const gCol = 0.18 + warmth * 0.58;
	  const bCol = 0.00 + warmth * 0.03;
          this.flameSys.spawn(
            ox+Math.cos(angle)*r, 0.1+Math.random()*0.2, oz+Math.sin(angle)*r,
            vx, vy, vz,
            rCol, gCol, bCol, 0.7+Math.random()*0.25,
            life, sc, 0.15
          );
        }
        // Dynamic fire glow
        if (this.glow && ix > 0.1) {
          const gun = this.glow.material.uniforms;
          gun.uColor.value.setRGB(1.0, 0.22 + ix * 0.45, 0.01);
          gun.uHeight.value = 1.5 + ix * 2.0;
          gun.uRadius.value = 0.6 + ix * 0.5;
        }
                break;
      }

      case 'laser': {
        const spawnN = Math.floor(delta * 40 * ix);
        const tiltX = (cfg.tiltX||0)*Math.PI/180;
        const tiltZ = (cfg.tiltZ||0)*Math.PI/180;
        const beamLen = 15.0 + ix * 25.0;
        for (let s = 0; s < spawnN; s++) {
          const t = Math.random(); // position along beam
          const beamVx = Math.sin(tiltX);
          const beamVy = Math.cos(tiltX) * Math.cos(tiltZ);
          const beamVz = Math.sin(tiltZ);
          const px = ox + beamVx * beamLen * t;
          const py = 0.1 + beamVy * beamLen * t;
          const pz = oz + beamVz * beamLen * t;
          const jitter = 0.02;
          const life = 0.08 + Math.random() * 0.05;
          const sc = 0.15 + ix * 0.1;
          // Bright saturated laser color
          const laserColor = tintColor || new this.T.Color(0.2, 1.0, 0.3);
          this.waterSys.spawn(
            px+(Math.random()-0.5)*jitter, py, pz+(Math.random()-0.5)*jitter,
            0, 0, 0,
            laserColor.r, laserColor.g, laserColor.b, 0.95,
            life, sc, 0.05
          );
        }
                break;
      }

      case 'motion_1d': {
        const animPhase = Math.sin(elapsed * 1.5 + ox * 0.5) * 0.5 + 0.5;
        const tiltX = ((cfg.tiltX || 0) + animPhase * 30) * Math.PI / 180;
        const spawnN = Math.floor(delta * 380 * ix);
        for (let s = 0; s < spawnN; s++) {
          const speed = this._launchSpeed(ix, 5.5 + ix * 7.0);
          const vy = Math.cos(tiltX) * speed;
          const vx = Math.sin(tiltX) * speed + (Math.random()-0.5)*0.1 + wind.x*0.1;
          const vz = (Math.random()-0.5)*0.1 + wind.z*0.1;
          const life = vy/9.81*2.0*1.05;
          const sc = 0.10 + ix*0.06;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.04, 0.08, oz+(Math.random()-0.5)*0.04,
  		vx, vy, vz, waterR, waterG, waterB, 0.88, life, sc, 0.55);
        }
        break;
      }

      case 'motion_2d': {
        const animX = Math.sin(elapsed * 1.2 + ox * 0.3) * 0.5 + 0.5;
        const animZ = Math.cos(elapsed * 0.9 + oz * 0.4) * 0.5 + 0.5;
        const tiltX = ((cfg.tiltX || 0) + animX * 25) * Math.PI / 180;
        const tiltZ = ((cfg.tiltZ || 0) + animZ * 25) * Math.PI / 180;
        const spawnN = Math.floor(delta * 400 * ix);
        for (let s = 0; s < spawnN; s++) {
          const speed = this._launchSpeed(ix, 5.5 + ix * 7.0);
          const vy = Math.cos(tiltX) * Math.cos(tiltZ) * speed;
          const vx = Math.sin(tiltX) * speed + (Math.random()-0.5)*0.12 + wind.x*0.1;
          const vz = Math.sin(tiltZ) * speed + (Math.random()-0.5)*0.12 + wind.z*0.1;
          const life = vy/9.81*2.0*1.05;
          const sc = 0.10 + ix*0.06;
          this.waterSys.spawn(ox+(Math.random()-0.5)*0.04, 0.08, oz+(Math.random()-0.5)*0.04,
  		vx, vy, vz, waterR, waterG, waterB, 0.88, life, sc, 0.50);
        }
        break;
      }

            case 'motion_3d': {
        const animX = Math.sin(elapsed * 1.5 + ox * 0.5) * 0.5 + 0.5;
        const animZ = Math.cos(elapsed * 1.1 + oz * 0.6) * 0.5 + 0.5;
        const animY = Math.sin(elapsed * 2.0) * 0.3;
        const tiltX = ((cfg.tiltX || 0) + animX * 35) * Math.PI / 180;
        const tiltZ = ((cfg.tiltZ || 0) + animZ * 35) * Math.PI / 180;
        const spawnN = Math.floor(delta * 420 * ix);

        for (let s = 0; s < spawnN; s++) {
          const speed = 6.0 + ix * 7.5 + animY * 2.0;
          const vy = Math.cos(tiltX) * Math.cos(tiltZ) * speed;
          const vx = Math.sin(tiltX) * speed + (Math.random() - 0.5) * 0.15 + wind.x * 0.12;
          const vz = Math.sin(tiltZ) * speed + (Math.random() - 0.5) * 0.15 + wind.z * 0.12;
          const life = vy / 9.81 * 2.0 * 1.1;
          const sc = 0.11 + ix * 0.07;

          this.waterSys.spawn(
            ox + (Math.random() - 0.5) * 0.05,
            0.08,
            oz + (Math.random() - 0.5) * 0.05,
            vx, vy, vz,
	    waterR, waterG, waterB, 0.86,
	    life, sc, 0.50
          );
        }

        break;
      }

case 'screen': {
        // ─── WATER SCREEN — full 180° fan, physically correct semicircle ───
        // The nozzle fires a fan of jets across the FULL 180° arc:
        //   θ = 0°   → horizontal right   (forms right base edge)
        //   θ = 90°  → straight up        (forms tall center peak)
        //   θ = 180° → horizontal left    (forms left base edge)
        // All jets share one launch speed v (set by pump pressure).
        // Each jet is its own parabola; their UNION fills the half-ellipse.
        // Center height = v²/2g; envelope is 4:1, compressed 0.75 → 3:1 (15m×5m).
        // Size scales with pump intensity, keeping the 3:1 proportion.

        const v      = this._launchSpeed(ix, 7.5 + ix * 3.5);  // solved exit velocity when available
        const HCOMP  = 0.75;                 // horizontal compression → 15:5 (3:1) ratio
        const thMin  = 14 * Math.PI / 180;   // skip degenerate near-horizontal jets
        const thMax  = 166 * Math.PI / 180;
        const spawnN = Math.floor(delta * 1800 * ix);  // wall density
        const rot7   = (cfg.rotation || 0) * Math.PI / 180;
        const cosR7  = Math.cos(rot7), sinR7 = Math.sin(rot7);

        for (let s = 0; s < spawnN; s++) {
          // Elevation angle swept across the full 180° fan
          const th  = thMin + Math.random() * (thMax - thMin);
          const vy7 = v * Math.sin(th) * (0.96 + Math.random() * 0.04);
          // Horizontal throw: +v at θ=0 (right), -v at θ=180 (left), 0 at vertical
          const vh7 = v * Math.cos(th) * HCOMP;

          // Project the horizontal throw onto the screen's facing plane (rotation)
          const vx7 = vh7 * cosR7 + (Math.random()-0.5)*0.10 + wind.x*0.04;
          const vz7 = vh7 * sinR7 + (Math.random()-0.5)*0.10 + wind.z*0.04;

          const life7 = vy7 / 9.81 * 2.0 * 1.05;
          const sc7   = 0.10 + ix * 0.07;
          // High alpha — dense enough to reflect a projector beam (projection wall)
          const alpha7 = 0.80 + Math.random() * 0.18;

          this.waterSys.spawn(
            ox + (Math.random()-0.5)*0.05, 0.08, oz + (Math.random()-0.5)*0.05,
            vx7, vy7, vz7,
            0.84, 0.94, 1.0, alpha7,
            life7, sc7, 0.66
          );
        }

        // Dense spray fill — semi-opaque haze that closes the gaps between jets
        if (ix > 0.05) {
          const fillN7 = Math.floor(delta * 1000 * ix);
          for (let s = 0; s < fillN7; s++) {
            const th2  = thMin + Math.random() * (thMax - thMin);
            const vy8  = v * Math.sin(th2) * (0.92 + Math.random() * 0.08);
            const vh8  = v * Math.cos(th2) * HCOMP;
            const vx8  = vh8 * cosR7 + (Math.random()-0.5)*0.08;
            const vz8  = vh8 * sinR7 + (Math.random()-0.5)*0.08;
            const life8 = vy8 / 9.81 * 2.0 * 1.0;
            this.spraySys.spawn(
              ox + (Math.random()-0.5)*0.06, 0.08, oz + (Math.random()-0.5)*0.06,
              vx8, vy8, vz8,
              0.88, 0.96, 1.0, 0.46 + Math.random() * 0.34,
              life8, 0.09 + ix * 0.06, 0.04
            );
          }
        }
        break;
      }

        
      default: {
        const spawnN = Math.floor(delta * 300 * ix);
        for (let s = 0; s < spawnN; s++) {
          const vy = 5.0 + ix * 6.0;
          this.waterSys.spawn(
            ox + (Math.random() - 0.5) * 0.05,
            0.08,
            oz + (Math.random() - 0.5) * 0.05,
            (Math.random() - 0.5) * 0.1 + wind.x * 0.1,
            vy,
            (Math.random() - 0.5) * 0.1 + wind.z * 0.1,
	    waterR, waterG, waterB, 0.88,
	    vy / 9.81 * 2.0 * 1.1,
            0.25 + ix * 0.12,
            0.5
          );
        }
      }
    }

    // Layer 4: impact foam at the water surface
    if (ix > 0.25 && Math.random() < ix*delta*8) {
      this._spawnImpactFoam(ox, oz, ix);
    }
  }

  _coreHeightFor(type, ix) {
    switch (type) {
      case 'laminar': return 4.0 + ix * 6.5;
      case 'jet_1d':  return 3.0 + ix * 4.5;
      case 'jet_2d':  return 3.5 + ix * 5.5;
      case 'jet_3d':  return 4.0 + ix * 6.5;
      case 'geyser':  return 5.0 + ix * 10.0;
      case 'pirouette': return 3.5 + ix * 5.5;
      case 'fan_jet': return 2.0 + ix * 3.0;
      case 'flame': return 0;
      case 'laser': return 0;
      case 'screen': return 0;
      case 'motion_1d': return 3.0 + ix * 5.0;
      case 'motion_2d': return 3.5 + ix * 5.5;
      case 'motion_3d': return 4.0 + ix * 6.0;
      default: return 3.0 + ix * 4.0;
    }
  }

  _glowRadiusFor(type, ix) {
    switch (type) {
      case 'laminar': return 0.35 + ix*0.10;
      case 'jet_1d':  return 0.50 + ix*0.18;
      case 'jet_2d':  return 0.65 + ix*0.25;
      case 'jet_3d':  return 0.85 + ix*0.35;
      case 'geyser':  return 1.35 + ix*0.60;
      case 'mist':    return 1.20 + ix*0.40;
      case 'pirouette': return 0.70 + ix*0.30;
      case 'fan_jet': return 1.50 + ix*0.80;
      case 'flame': return 0.80 + ix*0.60;
      case 'laser': return 0.20 + ix*0.10;
      case 'motion_1d': return 0.60 + ix*0.25;
      case 'motion_2d': return 0.70 + ix*0.30;
      case 'motion_3d': return 0.80 + ix*0.35;
      default: return 0.6 + ix*0.2;
    }
  }

  _spawnApexMist(ox, apexH, oz, ix, spread) {
    if (Math.random() > ix*0.5) return;
    const n = 3 + Math.floor(ix*5);
    for (let i=0; i<n; i++) {
      const angle = Math.random()*Math.PI*2;
      const r = Math.random()*spread;
      this.spraySys.spawn(
        ox+Math.cos(angle)*r, apexH*0.85, oz+Math.sin(angle)*r,
        (Math.random()-0.5)*0.8*ix, Math.random()*0.5*ix, (Math.random()-0.5)*0.8*ix,
        0.88, 0.95, 1.0, 0.6, 0.3+Math.random()*0.4, 0.10+ix*0.08, 0.15
      );
    }
  }

  _spawnBaseSplash(ox, oz, ix, radius) {
    const n = Math.floor(ix*8);
    for (let i=0; i<n; i++) {
      const angle = Math.random()*Math.PI*2;
      const r = Math.random()*radius*ix;
      this.foamSys.spawn(
        ox+Math.cos(angle)*r, 0.06, oz+Math.sin(angle)*r,
        Math.cos(angle)*0.8*ix, 0.18+Math.random()*0.3, Math.sin(angle)*0.8*ix,
        1.0, 1.0, 1.0, 0.65, 0.4+Math.random()*0.4, 0.18, 0.4
      );
    }
  }

  _spawnImpactFoam(ox, oz, ix) {
    const n = Math.floor(ix*6);
    for (let i=0; i<n; i++) {
      const angle = Math.random()*Math.PI*2;
      const r = 0.1 + Math.random()*0.4*ix;
      this.foamSys.spawn(
        ox+Math.cos(angle)*r, 0.06, oz+Math.sin(angle)*r,
        Math.cos(angle)*0.5*ix, 0.12, Math.sin(angle)*0.5*ix,
        1.0, 1.0, 1.0, 0.55, 0.3+Math.random()*0.3, 0.14, 0.3
      );
    }
  }

  dispose() {
    if (this.dot?.parent)  this.dot.parent.remove(this.dot);
    if (this.core?.parent) this.core.parent.remove(this.core);
    if (this.glow?.parent) this.glow.parent.remove(this.glow);
    this.core?.geometry?.dispose();
    this.core?.material?.dispose();
    this.glow?.geometry?.dispose();
    this.glow?.material?.dispose();
  }
}

const IDLE = {
  jet_1d:0.02, jet_2d:0.02, jet_3d:0.03,
  arch:0.02, ring:0.02, cascade:0.08,
  geyser:0.04, mist:0.10, laminar:0.02, pirouette:0.02,
  fan_jet:0.02, flame:0.04, laser:0.0, screen:0.06,
  motion_1d:0.03, motion_2d:0.03, motion_3d:0.03,
};

// Pattern definitions — delta-driven, not setInterval
function patternIntensity(name, t, idx, count, base) {
  switch (name) {
    case 'wave':      return base * (0.45 + 0.55*Math.sin(t*2 + idx*0.38));
    case 'pulse':     return base * (0.45 + 0.55*Math.sin(t*4));
    case 'ripple':    return base * (0.45 + 0.55*Math.sin(t*3 - idx*0.48));
    case 'chase':     return Math.floor(t*3) % count === idx ? base : 0.05;
    case 'burst':     return (Math.sin(t*1.4 + idx*1.7) > 0.4) ? base : 0.10;
    case 'alternate': return (idx%2 === Math.floor(t*2)%2) ? base : 0.10;
    case 'spiral':    return base * (0.35 + 0.65*Math.sin(t*3 + idx*0.65));
    case 'firework': {
      const peak = Math.sin(t*1.5);
      return peak > 0.8 ? base * (0.5 + ((idx*13+7)%100)/100*0.5) : 0.08;
    }
    default: return base;
  }
}
// ─── Main Scene v6 ────────────────────────────────────────────────────────────
export class FountainScene {
  constructor(canvas, options={}) {
    this.canvas       = canvas;
    this.environment  = options.environment  || ENVIRONMENTS.NIGHT;
    this.quality      = options.quality      || RENDER_QUALITY.MEDIUM;
    this.cameraMode   = options.cameraMode   || CAMERA_MODES.ORBIT;
    this.lightColor   = options.lightColor   || '#0066ff';
    this.poolGeometry = options.poolGeometry || null;
    this.wind         = options.wind         || { x:0, z:0 };

        this._signals   = {
      pump: 0,
      valve: 0,
      lighting: 0,
      lightingColor: { r: 1, g: 1, b: 1, w: 0 },
      flame: 0,
      fog: 0,
      laser: 0,
    };
    this._perNozzle = null;
    this.userNozzles= null;   // null = use default layout, array = engineering override
    // Solver-supplied per-nozzle physics (AQ-S2-002 Phase 2). null = unsolved, so
    // jets fall back to the legacy per-type heuristic and report basis ESTIMATED.
    this._nozzlePhysics = null;
    this._overDemand    = {};
    this.nozzles    = [];
    this._initialized = false;

    this.orbitAngle  = 0.4;
    this.orbitHeight = 7;
    this.orbitRadius = 14;
    this.orbitAuto   = true;
    this._isDragging = false;
    this._pathTime   = 0;

    this._mediaRecorder  = null;
    this._recordedChunks = [];

    // Pattern (delta-driven, not setInterval)
    this._patternName = null;
    this._patternBase = 0.88;
    this._patternTime = 0;

    // Engineering lights (Phase 2 RGB light field)
    this._engLights = []; // {x,z,color:THREE.Color,intensity,radius}
    this._engLightMeshes = [];

    this.THREE = THREE;
  }

  init() {
    const T=this.THREE;
    const W=this.canvas.clientWidth||900, H=this.canvas.clientHeight||600;
    const q = QUALITY_CONFIG[this.quality] || QUALITY_CONFIG.medium;
    const PR=Math.min(window.devicePixelRatio||1, q.pixelRatio);

    this.renderer = new T.WebGLRenderer({
      canvas:this.canvas, antialias:true, alpha:false,
      powerPreference:"high-performance",
      preserveDrawingBuffer:true,
    });
    this.renderer.setSize(W, H, false);
    this.renderer.setPixelRatio(PR);
    if (T.SRGBColorSpace) this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type    = T.PCFSoftShadowMap;
    this.renderer.toneMapping       = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2.1 * q.exposure;
    this.renderer.xr.enabled = true;   // VR Walkthrough (AQ-S3-006)

    this.scene  = new T.Scene();
    this.camera = new T.PerspectiveCamera(50, W/H, 0.1, 500);
    this.clock  = new T.Clock();
    this._pr    = PR;

    // Shared RGB light-field uniforms (single source of truth — everything reads from this)
    this._lightField = {
      uGlobalLight:  { value: new T.Color(0,0,0) },
      uGlobalLightI: { value: 0.0 },
      uFieldCount:   { value: 0 },
      uFieldPos:     { value: Array.from({length:MAX_FIELD_LIGHTS}, () => new T.Vector3()) },
      uFieldCol:     { value: Array.from({length:MAX_FIELD_LIGHTS}, () => new T.Color(0,0,0)) },
      uFieldInt:     { value: new Float32Array(MAX_FIELD_LIGHTS) },
      uFieldRad:     { value: new Float32Array(MAX_FIELD_LIGHTS).fill(4.0) },
    };

    // AF-3D-003: procedural sprite textures. Null (no DOM / headless) simply means
    // the shaders fall back to their analytic shapes.
    this._particleTex = {
      droplet: makeDropletTexture(T),
      mist:    makeMistTexture(T),
      foam:    makeFoamTexture(T),
      flame:   makeFlameTexture(T),
    };

    // GPU particle systems — share the light-field uniforms
    this.waterSys = new GPUParticleSystem(T, MAX_WATER, PR, "scatter",  this._particleTex.droplet);
    this.spraySys = new GPUParticleSystem(T, MAX_SPRAY, PR, "scatter",  this._particleTex.mist);
    this.foamSys  = new GPUParticleSystem(T, MAX_FOAM,  PR, "scatter",  this._particleTex.foam);
    this.flameSys = new GPUParticleSystem(T, MAX_FLAME, PR, "emissive", this._particleTex.flame);
    [this.waterSys, this.spraySys, this.foamSys].forEach(ps => {
      ps.uniforms.uGlobalLight  = this._lightField.uGlobalLight;
      ps.uniforms.uGlobalLightI = this._lightField.uGlobalLightI;
      ps.uniforms.uFieldCount   = this._lightField.uFieldCount;
      ps.uniforms.uFieldPos     = this._lightField.uFieldPos;
      ps.uniforms.uFieldCol     = this._lightField.uFieldCol;
      ps.uniforms.uFieldInt     = this._lightField.uFieldInt;
      ps.uniforms.uFieldRad     = this._lightField.uFieldRad;
    });

    this._buildFogSystem();
    this.scene.add(this.waterSys.mesh, this.spraySys.mesh, this.foamSys.mesh, this.flameSys.mesh);

    // AF-3D-001: opaque-scene depth probe for soft particles + beam cones. An
    // enhancement, never a dependency — on failure the sprites keep hard edges.
    this._depthProbe = null;
    if (q.softDepth) {
      try {
        this._depthProbe = new SceneDepthProbe(T, this.renderer, {
          width: W * PR, height: H * PR, scale: q.softScale,
        });
      } catch (err) {
        console.warn("[FountainScene] depth probe unavailable:", err?.message || err);
        this._depthProbe = null;
      }
    }

    // AF-3D-007: GPU particle fields. When they are carrying the water, the CPU
    // fields keep simulating as an invisible physics sample (see CPU_SAMPLE_FRACTION)
    // so the splash map and its calibrated containment figures stay intact.
    this._gpuWater = null;
    this._gpuSpray = null;
    if (q.gpuParticles && gpuParticlesSupported(T, this.renderer)) {
      try {
        const shared = { maxFieldLights: MAX_FIELD_LIGHTS, maxEmitters: MAX_GPU_EMITTERS };
        this._gpuWater = new GPUParticleField(T, this.renderer, {
          ...shared, count: q.gpuWater, map: this._particleTex.droplet,
          gravity: -9.5, drag: 0.018, turbulence: 0.35,
          sizeScale: 0.30, alpha: 0.17,
        });
        this._gpuSpray = new GPUParticleField(T, this.renderer, {
          ...shared, count: q.gpuSpray, map: this._particleTex.mist,
          gravity: -7.0, drag: 0.024, turbulence: 0.55,
          sizeScale: 0.42, alpha: 0.10,
        });
        this.scene.add(this._gpuWater.mesh, this._gpuSpray.mesh);
        // The CPU water/spray fields become invisible samplers.
        this.waterSys.mesh.visible = false;
        this.spraySys.mesh.visible = false;
        this.waterSys.sampleFraction = CPU_SAMPLE_FRACTION;
        this.spraySys.sampleFraction = CPU_SAMPLE_FRACTION;
        // Share the light field so GPU droplets are lit identically to CPU ones.
        [this._gpuWater, this._gpuSpray].forEach(f => {
          f.uniforms.uGlobalLight  = this._lightField.uGlobalLight;
          f.uniforms.uGlobalLightI = this._lightField.uGlobalLightI;
          f.uniforms.uFieldCount   = this._lightField.uFieldCount;
          f.uniforms.uFieldPos     = this._lightField.uFieldPos;
          f.uniforms.uFieldCol     = this._lightField.uFieldCol;
          f.uniforms.uFieldInt     = this._lightField.uFieldInt;
          f.uniforms.uFieldRad     = this._lightField.uFieldRad;
        });
      } catch (err) {
        console.warn("[FountainScene] GPU particles unavailable:", err?.message || err);
        this._disposeGPUFields();
      }
    }

    // AF-3D-005: volumetric beam cones for the RGB fixture lights.
    this._cones = null;
    if (q.cones) {
      this._cones = new LightConeSet(T, MAX_FIELD_LIGHTS);
      this.scene.add(this._cones.group);
    }
    this._bindSoftDepth();

    // AQ-S3-012 — the mirror image and the landing record. Both must exist before the
    // water surface is built, because its material binds their texture and matrix.
    this._buildReflection();
    this._buildSplashMap();

    this._buildEnvironment();
    this._buildPool();
    this._buildWaterSurface();
    this._buildUnderwaterLights();
    this._buildLasers();
    this._buildNozzles();
    this._buildReviewOverlays();
    this._setupEvents();

    this._buildEnvironmentIBL();
    this._buildPostFX();

    this._initialized = true;
    // Dev-only debug handle: lets a console (or a headless test driver) reach the
    // live scene to toggle materials and passes. Stripped from production builds.
    try {
      if (import.meta.env?.DEV && typeof window !== "undefined") window.__aquaflowScene = this;
    } catch (e) { /* non-vite consumers */ }
    this._animate();
  }

  // ── Planar reflection ───────────────────────────────────────────────────────
  _buildReflection() {
    const q = QUALITY_CONFIG[this.quality] || QUALITY_CONFIG.medium;
    this._reflection?.dispose?.();
    this._reflection = null;
    if (!q.reflect) return;   // `low` stays on the flat-sky fallback by design
    try {
      this._reflection = new WaterReflectionProbe(this.THREE, this.renderer, {
        resolution: q.reflect,
        interval: q.reflectEvery,
      });
    } catch (err) {
      // A reflection is an enhancement, never a dependency. If the target cannot be
      // allocated (old GPU, no half-float support) the water keeps its flat sky term.
      console.warn("[FountainScene] planar reflection unavailable:", err?.message || err);
      this._reflection = null;
    }
  }

  // ── Splash map: where the water lands ───────────────────────────────────────
  // Two products from one grid: a wetness field that darkens and glosses the deck and
  // then dries, and a cumulative containment heatmap. See splashMap.js for the physics.
  _buildSplashMap() {
    const T = this.THREE;
    const extent = 32, res = 128;
    this._splash = new SplashMap({ extent, resolution: res });
    this._splashExtent = extent;
    this._splashRes = res;
    this._showHeatmap = false;
    this._wetEnabled = true;

    this._wetBytes  = new Uint8Array(res * res * 4);
    this._heatBytes = new Uint8Array(res * res * 4);

    const mkTex = (bytes) => {
      const tx = new T.DataTexture(bytes, res, res, T.RGBAFormat);
      tx.minFilter = T.LinearFilter;
      tx.magFilter = T.LinearFilter;
      tx.wrapS = tx.wrapT = T.ClampToEdgeWrapping;
      tx.needsUpdate = true;
      return tx;
    };
    this._wetTex  = mkTex(this._wetBytes);
    this._heatTex = mkTex(this._heatBytes);

    // Deck overlay. World-space UV rather than geometry UV, so the mapping is correct
    // regardless of what shape the deck happens to be.
    const deckR = 12.2;
    const geo = new T.CircleGeometry(deckR, 96);
    this._wetMat = new T.ShaderMaterial({
      transparent: true, depthWrite: false,
      // Sits a few millimetres above the deck; polygon offset keeps it off the z-fighting
      // knife-edge with the stage top.
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {
        uWetTex:    { value: this._wetTex },
        uHeatTex:   { value: this._heatTex },
        uHeatMode:  { value: 0.0 },
        uExtent:    { value: extent },
        uCameraPos: { value: new T.Vector3() },
        uTime:      { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        uniform sampler2D uWetTex;
        uniform sampler2D uHeatTex;
        uniform float uHeatMode;
        uniform float uExtent;
        uniform vec3  uCameraPos;
        uniform float uTime;
        varying vec3  vWorld;

        void main(){
          vec2 uv = (vWorld.xz + uExtent * 0.5) / uExtent;
          if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;

          if (uHeatMode > 0.5) {
            vec4 h = texture2D(uHeatTex, uv);
            if (h.a <= 0.003) discard;
            gl_FragColor = h;
            return;
          }

          float wet = texture2D(uWetTex, uv).r;
          if (wet <= 0.004) discard;

          // A wet surface is darker because the water film fills surface pores: light
          // that would have scattered straight back off the roughness now enters,
          // bounces inside and is partly absorbed. Hence darker AND glossier, together.
          vec3  viewDir = normalize(uCameraPos - vWorld);
          float NdotV   = max(viewDir.y, 0.0);          // deck normal is +Y
          float fres    = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

          // Sheen: a broad highlight the dry stone does not have.
          float sheen = pow(1.0 - NdotV, 3.0) * wet;

          vec3  darken = vec3(0.015, 0.022, 0.030);
          float alpha  = clamp(wet * (0.55 + 0.45 * fres), 0.0, 0.92);
          vec3  col    = darken + vec3(0.28, 0.36, 0.45) * sheen * 0.9;

          gl_FragColor = vec4(col, alpha);
        }`,
    });
    this._wetOverlay = new T.Mesh(geo, this._wetMat);
    this._wetOverlay.rotation.x = -Math.PI / 2;
    this._wetOverlay.position.y = 0.001;
    this._wetOverlay.renderOrder = 2;
    this.scene.add(this._wetOverlay);

    // Give the particle systems somewhere to report their impacts.
    const sink = (x, z, amount, inside) => this._splash?.deposit(x, z, amount, inside);
    const bounds = () => this._poolBoundsForSplash();
    [this.waterSys, this.spraySys].forEach(ps => { ps.impactSink = sink; ps.poolBounds = bounds; });
  }

  /**
   * Pool bounds for the impact test. Cached and mutated in place rather than rebuilt:
   * this is read once per particle impact — thousands per second — and allocating a
   * fresh object each time is pure garbage-collector pressure on the hottest loop in
   * the renderer.
   */
  _poolBoundsForSplash() {
    const b = this._splashBounds || (this._splashBounds = {});
    if (this._poolType === "circular") {
      b.type = "circular";
      b.radius = this._poolRadius || 6;
    } else {
      b.type = "rect";
      b.width = this._poolW || 12;
      b.length = this._poolL || 8;
    }
    return b;
  }

  _updateSplashMap(delta) {
    if (!this._splash) return;
    this._splash.dry(delta);

    // Uploading 64 KB every frame to depict a field that changes over tens of seconds
    // is wasted bandwidth. ~12 Hz is well above what drying needs and is invisible.
    this._splashUploadT = (this._splashUploadT || 0) + delta;
    if (this._splashUploadT < 1 / 12) return;
    this._splashUploadT = 0;

    if (this._wetEnabled && !this._showHeatmap) {
      this._splash.writeWetRGBA(this._wetBytes);
      this._wetTex.needsUpdate = true;
    }
    if (this._showHeatmap) {
      this._splash.writeHeatRGBA(this._heatBytes);
      this._heatTex.needsUpdate = true;
    }
    if (this._wetMat) {
      this._wetMat.uniforms.uCameraPos.value.copy(this.camera.position);
      this._wetMat.uniforms.uHeatMode.value = this._showHeatmap ? 1.0 : 0.0;
    }
    if (this._wetOverlay) {
      this._wetOverlay.visible = this._showHeatmap || this._wetEnabled;
    }
  }

  // ── Quad View ───────────────────────────────────────────────────────────────
  // Depence splits the render view into four independently configured viewports. It is
  // not a luxury: a perspective view is the wrong instrument for placing a nozzle on an
  // exact coordinate, and the orthographic Top/Front/Side views are where that work
  // actually happens. Ours mirrors that layout.
  //
  // Quad view renders directly rather than through the composer. Bloom and AO are
  // presentation; these panes are for measuring, and four composited passes would cost
  // four times the post-processing for no benefit to the task.
  _buildQuadCameras() {
    const T = this.THREE;
    if (this._quadCams) return;
    const mk = (pos, up) => {
      const c = new T.OrthographicCamera(-10, 10, 10, -10, -500, 500);
      c.position.set(pos.x, pos.y, pos.z);
      if (up) c.up.set(up.x, up.y, up.z);
      c.lookAt(0, 0, 0);
      return c;
    };
    this._quadCams = {
      top:   mk({ x: 0, y: 60, z: 0 }, { x: 0, y: 0, z: -1 }),
      front: mk({ x: 0, y: 0, z: 60 }, { x: 0, y: 1, z: 0 }),
      side:  mk({ x: 60, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
    };
    this._quadZoom = 9;
  }

  /** Turn the four-pane layout on or off. */
  setQuadView(on) {
    this._quadView = !!on;
    if (this._quadView) this._buildQuadCameras();
    // Quad panes render without the depth-probe refresh, so soft fades stand down
    // with it and return when the single perspective view does.
    this._setSoftDepthEnabled(!this._quadView);
    return this._quadView;
  }

  isQuadView() { return !!this._quadView; }

  /** Extent, in metres, that the orthographic panes cover. */
  setQuadZoom(metres) {
    this._quadZoom = Math.max(1.5, Math.min(80, metres || 9));
  }

  /**
   * The four panes, as fractions of the canvas. Shared with the editor so a click can be
   * routed to the camera of whichever pane it landed in — otherwise picking in an
   * orthographic pane would silently use the perspective camera and select the wrong thing.
   */
  quadLayout() {
    return [
      { key: "persp", label: "Perspective", x: 0,   y: 0.5, w: 0.5, h: 0.5 },
      { key: "top",   label: "Top",         x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      { key: "front", label: "Front",       x: 0,   y: 0,   w: 0.5, h: 0.5 },
      { key: "side",  label: "Side",        x: 0.5, y: 0,   w: 0.5, h: 0.5 },
    ];
  }

  /** The camera driving a given pane. */
  quadCamera(key) {
    if (key === "persp") return this.camera;
    return this._quadCams?.[key] || this.camera;
  }

  /**
   * Objects that belong only to the presentation view. The orthographic panes are
   * construction views — Depence calls its equivalent the CAD View and draws it as
   * wireframe — so the water simulation has no business in them. Hiding it is not only
   * truer to the task, it is what makes four panes affordable at all: drawing six
   * thousand particles, the fog volume and the water surface four times over collapsed
   * the frame rate to under one frame a second.
   */
  _cadHiddenObjects() {
    return [
      this.waterSys?.mesh, this.spraySys?.mesh, this.foamSys?.mesh, this.flameSys?.mesh,
      this._gpuWater?.mesh, this._gpuSpray?.mesh,
      this._fogMesh, this.waterSurface, this._wetOverlay,
      this._cones?.group, this._sky?.group,
      ...(this.nozzles || []).map(n => n.glow),
    ].filter(Boolean);
  }

  _renderQuad() {
    const T = this.THREE;
    const r = this.renderer;
    const W = this.canvas.clientWidth || 900, H = this.canvas.clientHeight || 600;
    const panes = this.quadLayout();

    // Keep the ortho frusta square-correct for their pane's aspect, or the scene shears.
    const z = this._quadZoom || 9;
    for (const key of ["top", "front", "side"]) {
      const c = this._quadCams[key];
      const pw = W * 0.5, ph = H * 0.5;
      const aspect = pw / Math.max(1, ph);
      c.left = -z * aspect; c.right = z * aspect;
      c.top = z; c.bottom = -z;
      c.updateProjectionMatrix();
    }

    const cadHidden = this._cadHiddenObjects();

    r.setScissorTest(true);
    for (const p of panes) {
      const x = Math.floor(p.x * W), y = Math.floor(p.y * H);
      const w = Math.floor(p.w * W), h = Math.floor(p.h * H);
      r.setViewport(x, y, w, h);
      r.setScissor(x, y, w, h);

      // Construction panes drop the water simulation; the perspective pane keeps it.
      const restore = [];
      if (p.key !== "persp") {
        for (const o of cadHidden) { restore.push([o, o.visible]); o.visible = false; }
      }
      r.render(this.scene, this.quadCamera(p.key));
      for (const [o, v] of restore) o.visible = v;
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, W, H);
    r.setScissor(0, 0, W, H);
  }

  // ── Public: 3D editing workspace ────────────────────────────────────────────
  /**
   * Attach the scene editor, turning the viewport from a render into a workspace.
   * Kept as an opt-in attachment rather than something init() always builds, so a
   * client-presentation view or a headless export still runs without editor overhead.
   *
   * @param {SceneEditor} editor
   */
  attachEditor(editor) {
    this._editor = editor || null;
    return this._editor;
  }

  /**
   * Hand the viewport to the editor. While on, the legacy orbit/wheel handlers stand
   * down and the camera is driven by the editor's navigation instead, so the two cannot
   * fight over the same pointer.
   */
  setEditorMode(on) {
    this._editorMode = !!on;
    if (this._editorMode) {
      // A camera that drifts while you are trying to place a fixture is unusable.
      this.orbitAuto = false;
      this.cameraMode = CAMERA_MODES.ORBIT;
    }
    this._editor?.setEnabled?.(this._editorMode);
    return this._editorMode;
  }

  isEditorMode() { return !!this._editorMode; }

  // ── Public: splash containment ──────────────────────────────────────────────

  /**
   * Show or hide the containment heatmap — where water has cumulatively landed.
   * Replaces the wetness view while active, because the two occupy the same surface.
   */
  setSplashHeatmap(on) {
    this._showHeatmap = !!on;
    if (this._wetMat) this._wetMat.uniforms.uHeatMode.value = this._showHeatmap ? 1.0 : 0.0;
    // Force an immediate rebuild so the toggle is instant rather than up to 1/12 s late.
    this._splashUploadT = 999;
    return this._showHeatmap;
  }

  /** Turn the wet-deck effect on or off (it is on by default). */
  setWetSurfaces(on) {
    this._wetEnabled = !!on;
    if (this._wetOverlay) this._wetOverlay.visible = this._showHeatmap || this._wetEnabled;
    return this._wetEnabled;
  }

  /**
   * Calibrate the splash map against the SOLVED design flow, so containment is
   * reported in litres rather than in particles.
   *
   * @param {number} solvedFlowLpm total nozzle flow from the hydraulic solve, L/min
   */
  calibrateSplash(solvedFlowLpm) {
    if (!this._splash) return false;
    // The spawn rate the renderer actually used, measured rather than assumed — the
    // emitters vary their rate with intensity, so a hardcoded constant would drift.
    const pps = this._measuredSpawnRate();
    const lpi = SM_litresPerImpact(solvedFlowLpm, pps);
    this._splash.setCalibration(lpi);
    return lpi != null;
  }

  _measuredSpawnRate() {
    // Impacts per second observed so far. Every particle that leaves a nozzle
    // eventually lands, so over a window longer than a jet's flight time the impact
    // rate converges on the spawn rate.
    const s = this._splash;
    if (!s || s.elapsedS < 2) return null;   // too early to be meaningful
    return s.totalImpacts / s.elapsedS;
  }

  /**
   * Containment analysis. Volumetric figures are present only when calibrated;
   * otherwise they are null and `calibrated` is false — never a fabricated number.
   */
  getSplashContainment() {
    if (!this._splash) return null;
    return { ...this._splash.containment(), peakWetness: this._splash.peakWetness() };
  }

  /** Clear the accumulated splash record and dry the deck immediately. */
  resetSplash() {
    this._splash?.reset();
    this._splashUploadT = 999;
  }

  // ── Image-based lighting ────────────────────────────────────────────────────
  // The pool, deck and nozzle bodies are MeshStandardMaterial. Without an environment
  // they can only respond to the punctual lights, which reads flat and plastic.
  //
  // AF-3D-004: the probe is now generated FROM THE SKY DOME, so what the materials
  // reflect agrees with the sky the viewer can actually see — a night scene gets a
  // dark horizon-graded probe instead of a bright white studio. The RoomEnvironment
  // studio probe survives only as the fallback when the sky probe cannot be built.
  _buildEnvironmentIBL() {
    const q = QUALITY_CONFIG[this.quality] || QUALITY_CONFIG.medium;
    if (!q.ibl) return;
    const T = this.THREE;
    try {
      this._envRT?.dispose?.();
      this._envRT = createSkyIBL(T, this.renderer, this.environment);
      this._iblKind = this._envRT ? "sky" : null;
      if (!this._envRT) {
        const pmrem = new T.PMREMGenerator(this.renderer);
        const room = new RoomEnvironment();   // r165: takes an optional renderer, not THREE
        this._envRT = pmrem.fromScene(room, 0.04);
        this._iblKind = "room";
        room.dispose?.();
        pmrem.dispose();
      }
      this.scene.environment = this._envRT.texture;
      this.scene.environmentIntensity = this._envIntensityFor(this.environment);
    } catch (e) {
      this._envRT = null;   // IBL is an enhancement: never fatal
      this._iblKind = null;
    }
  }

  // ── Post-processing chain ───────────────────────────────────────────────────
  _buildPostFX() {
    const T = this.THREE;
    const q = QUALITY_CONFIG[this.quality] || QUALITY_CONFIG.medium;
    this._postEnabled = false;
    if (!q.postfx || this._postDisabledByUser) return;
    try {
      const W = this.canvas.clientWidth || 900, H = this.canvas.clientHeight || 600;
      const composer = new EffectComposer(this.renderer);
      composer.setPixelRatio?.(this._pr);
      composer.setSize(W, H);

      composer.addPass(new RenderPass(this.scene, this.camera));

      // Ambient occlusion — contact darkening where floor/kerb/nozzle bases meet.
      // Runs on the LINEAR scene buffer, before tone mapping. Solid geometry only:
      // the water particles are transparent and do not write depth.
      if (q.ao) {
        try {
          const gtao = new GTAOPass(this.scene, this.camera, W, H);
          gtao.output = GTAOPass.OUTPUT.Default;
          if (typeof gtao.updateGtaoMaterial === "function") {
            gtao.updateGtaoMaterial({
              radius: 0.55,        // metres — tight contact shadows, not global dimming
              distanceExponent: 1.0,
              thickness: 1.0,
              scale: 0.9,
              samples: 16,
            });
          }
          composer.addPass(gtao);
          this._aoPass = gtao;
        } catch (e) {
          this._aoPass = null;   // AO is an enhancement, never fatal
        }
      }

      // Tone mapping + sRGB conversion BEFORE bloom (lesson from the first cut,
      // verified against live screenshots): this scene's water/spray are additive
      // particle shaders whose linear-HDR sum runs far above 1.0 across most of the
      // frame, so bloom thresholded in pre-tonemap HDR bloomed *everything* and the
      // night scene washed out into white fog. Tone-mapping first means bloom sees
      // exactly the image the user sees, and the threshold below reliably selects
      // only genuinely bright screen content — jet cores, fixtures, flame.
      composer.addPass(new OutputPass());

      // Display-referred bloom: threshold 0.82 catches only near-white pixels.
      const bloom = new UnrealBloomPass(
        new T.Vector2(W, H),
        q.bloom,        // strength
        0.42,           // radius — tight halo; wider smears the dense jet core
        0.86            // threshold — display-referred, only true highlights
      );
      composer.addPass(bloom);
      this._bloomPass = bloom;

      // Cinematic grade (vignette / aberration / grain / saturation).
      const grade = new ShaderPass(CINEMATIC_SHADER);
      grade.uniforms.uResolution.value.set(W * this._pr, H * this._pr);
      composer.addPass(grade);
      this._gradePass = grade;

      if (q.smaa) {
        const smaa = new SMAAPass(W * this._pr, H * this._pr);
        composer.addPass(smaa);
        this._smaaPass = smaa;
      }

      this.composer = composer;
      this._postEnabled = true;
    } catch (e) {
      // Any failure (old GPU, missing extension) falls back to the direct render path.
      this.composer = null;
      this._postEnabled = false;
    }
  }

  /** Toggle / tune the post chain at runtime. setPostFX(false) restores direct render. */
  setPostFX(opts) {
    if (opts === false || opts === true) opts = { enabled: opts };
    const o = opts || {};
    if (o.enabled === false) {
      this._postDisabledByUser = true;
      this._disposePostFX();
      return;
    }
    if (o.enabled === true) {
      this._postDisabledByUser = false;
      if (!this.composer && this._initialized) this._buildPostFX();
    }
    if (this._bloomPass) {
      if (typeof o.bloom === "number")     this._bloomPass.strength  = o.bloom;
      if (typeof o.bloomRadius === "number")    this._bloomPass.radius    = o.bloomRadius;
      if (typeof o.bloomThreshold === "number") this._bloomPass.threshold = o.bloomThreshold;
    }
    if (this._gradePass) {
      const u = this._gradePass.uniforms;
      if (typeof o.vignette === "number")   u.uVignette.value   = o.vignette;
      if (typeof o.aberration === "number") u.uAberration.value = o.aberration;
      if (typeof o.grain === "number")      u.uGrain.value      = o.grain;
      if (typeof o.saturation === "number") u.uSaturation.value = o.saturation;
      if (typeof o.contrast === "number")   u.uContrast.value   = o.contrast;
    }
  }

  _disposePostFX() {
    try {
      this._smaaPass = null;
      this._aoPass?.dispose?.();
      this._aoPass = null;
      this._bloomPass?.dispose?.();
      this._bloomPass = null;
      this._gradePass?.material?.dispose?.();
      this._gradePass = null;
      this.composer?.dispose?.();
    } catch (e) { /* disposal is best-effort */ }
    this.composer = null;
    this._postEnabled = false;
  }

  // ── Solver-driven jet physics (AQ-S2-002 Phase 2) ───────────────────────────
  /**
   * Feed per-nozzle results from the backend hydraulic solver.
   *
   * `physics` is { [nozzleId]: { exitVelocityMs, jetHeightM, basis } } as returned
   * by POST /api/hydraulics (services/hydraulic_solver.py). Once set, a nozzle's
   * launch speed is CALCULATED from its solved exit velocity instead of the old
   * per-type guess, and the solved height becomes a hard physical ceiling.
   *
   * Passing null/{} reverts every nozzle to the legacy heuristic — the preview
   * still runs without a solve, it is just no longer physically backed.
   */
  setNozzlePhysics(physics) {
    this._nozzlePhysics = (physics && typeof physics === "object") ? physics : null;
    this._overDemand = {};   // recomputed as frames render
    this._applyNozzlePhysics();
  }

  /** Push the solved records onto the live nozzle instances. Called whenever the
   *  physics changes AND after nozzles are rebuilt, so a re-layout keeps its solve. */
  _applyNozzlePhysics() {
    const map = this._nozzlePhysics;
    (this.nozzles || []).forEach(nz => {
      const rec = map ? (map[nz?.config?.id] || null) : null;
      nz.setPhysics?.(rec, this._overDemand);
    });
  }

  /**
   * Diagnostics for the honesty layer: which nozzles are being asked for more
   * height than the solved hydraulics can deliver, and on what basis the jets are
   * currently drawn. `basis` is CALCULATED once a solve has been supplied,
   * ESTIMATED otherwise — the preview must never imply more rigour than it has.
   */
  getPhysicsStatus() {
    const solved = !!this._nozzlePhysics;
    const over = Object.entries(this._overDemand || {}).map(([id, o]) => ({
      nozzleId: id,
      demand: Number(o.demand.toFixed(3)),
      maxJetHeightM: Number((o.jetHeightM || 0).toFixed(3)),
      message: `Show demands ${o.demand.toFixed(2)}x design height — hydraulics cap this jet at ${(o.jetHeightM || 0).toFixed(2)} m.`,
    }));
    return {
      basis: solved ? "CALCULATED" : "ESTIMATED",
      solvedNozzles: solved ? Object.keys(this._nozzlePhysics).length : 0,
      overDemand: over,
    };
  }

  // ── Soft-depth plumbing (AF-3D-001) ─────────────────────────────────────────
  /** Point every soft-depth consumer (particles, cones) at the probe's texture. */
  _bindSoftDepth() {
    const systems = [this.waterSys, this.spraySys, this.foamSys, this.flameSys,
                     this._gpuWater, this._gpuSpray].filter(Boolean);
    if (!this._depthProbe) {
      systems.forEach(ps => ps.setSoftDepth(null));
      this._cones?.setDepth(null);
      return;
    }
    // gl_FragCoord in the main pass lives in drawing-buffer pixels; the normalized
    // lookup needs 1/that, regardless of the probe's own (half) resolution.
    const size = this.renderer.getDrawingBufferSize(this._dbSize || (this._dbSize = new this.THREE.Vector2()));
    const ix = 1 / Math.max(1, size.x), iy = 1 / Math.max(1, size.y);
    const near = this.camera.near, far = this.camera.far;
    systems.forEach(ps => ps.setSoftDepth(this._depthProbe.texture, ix, iy, near, far));
    this._cones?.setDepth(this._depthProbe.texture, ix, iy, near, far);
  }

  /** Release the GPU particle fields and hand the water back to the CPU path. */
  _disposeGPUFields() {
    this._gpuWater?.dispose?.();
    this._gpuSpray?.dispose?.();
    this._gpuWater = null;
    this._gpuSpray = null;
    this._gpuLayoutKey = null;
    if (this.waterSys) { this.waterSys.mesh.visible = true; this.waterSys.sampleFraction = 1; }
    if (this.spraySys) { this.spraySys.mesh.visible = true; this.spraySys.sampleFraction = 1; }
  }

  /** Toggle the fade without unbinding — used around the reflection pass, whose
   *  framebuffer does not match the probe's screen-space lookup. */
  _setSoftDepthEnabled(on) {
    [this.waterSys, this.spraySys, this.foamSys, this.flameSys,
     this._gpuWater, this._gpuSpray].forEach(ps => ps?.setSoftEnabled(on));
    this._cones?.cones.forEach(c => {
      c.material.uniforms.uUseDepth.value = (on && c.material.uniforms.uSceneDepth.value) ? 1.0 : 0.0;
    });
  }

  /** Everything that must NOT write into the opaque depth probe: transparent media,
   *  overlays, and the sky (whose dome would otherwise stamp depth at 300 m). */
  _depthHiddenObjects() {
    return [
      this.waterSys?.mesh, this.spraySys?.mesh, this.foamSys?.mesh, this.flameSys?.mesh,
      this._gpuWater?.mesh, this._gpuSpray?.mesh,
      this._fogMesh, this.waterSurface, this._wetOverlay, this._reviewGroup,
      this._laserGroup, this._cones?.group, this._sky?.group, this._editor?.root,
      ...(this.nozzles || []).map(n => n.glow),
      ...(this.nozzles || []).map(n => n.core),
      ...(this._engLightMeshes || []),
    ].filter(Boolean);
  }

  /** Render through the composer when available, else straight to the canvas. */
  _renderFrame() {
    // AF-3D-001: refresh the opaque-scene depth first — the camera is already placed
    // for this frame, and both the particles and the beam cones sample the result.
    if (this._depthProbe && !this._quadView) {
      this.camera.updateMatrixWorld();
      this._depthProbe.update(this.scene, this.camera, this._depthHiddenObjects());
    }
    // The mirror image is rendered first, from a camera reflected through the
    // waterline. It must run after the camera has been placed for this frame and
    // before the main pass, which samples its result. Skipped in quad view: that layout
    // already costs four scene passes, and a reflection is presentation, not construction.
    if (this._reflection && this.waterSurface && !this._quadView) {
      this.camera.updateMatrixWorld();
      const waterY = this.waterSurface.position.y;
      // The mirror pass renders into its own target, where gl_FragCoord no longer
      // corresponds to the screen-space depth probe — soft fades must sit out.
      this._setSoftDepthEnabled(false);
      const rendered = this._reflection.update(
        this.scene, this.camera, waterY,
        // The water cannot reflect itself; the analysis overlays and the editor's
        // gizmos and handles are annotation rather than scene. None belongs in the
        // mirror image — a reflected gizmo would be both wrong and distracting.
        [this.waterSurface, this._wetOverlay, this._reviewGroup, this._editor?.root]
      );
      this._setSoftDepthEnabled(!this._quadView);
      const u = this.waterMat?.uniforms;
      if (u) {
        if (rendered && u.uReflectStrength.value === 0) {
          // Only trust the target once it actually holds a frame.
          u.uReflectTex.value = this._reflection.texture;
          u.uReflectMatrix.value = this._reflection.textureMatrix;
        }
        if (rendered || u.uReflectStrength.value > 0) u.uReflectStrength.value = 1.0;
      }
    }

    if (this._quadView) { this._renderQuad(); return; }

    if (this._postEnabled && this.composer) {
      if (this._gradePass) this._gradePass.uniforms.uTime.value = this.clock?.elapsedTime || 0;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ── Fog ─────────────────────────────────────────────────────────────────
  _buildFogSystem() {
    const T=this.THREE;
    const maxFog = MAX_FOG;
    this._fogPositions = new Float32Array(maxFog*3);
    this._fogDensities = new Float32Array(maxFog);
    this._fogScales    = new Float32Array(maxFog);
    this._fogLives     = new Float32Array(maxFog);
    this._fogMaxLives  = new Float32Array(maxFog);
    this._fogVels      = new Float32Array(maxFog*3);
    this._fogActive    = 0;

    const geo = new T.BufferGeometry();
    geo.setAttribute('aOffset',  new T.BufferAttribute(this._fogPositions, 3));
    geo.setAttribute('aDensity', new T.BufferAttribute(this._fogDensities, 1));
    geo.setAttribute('aScale',   new T.BufferAttribute(this._fogScales, 1));
    geo.setAttribute('aLife',    new T.BufferAttribute(this._fogLives, 1));
    geo.setDrawRange(0,0);
    this._fogMat = new T.ShaderMaterial({
      vertexShader: FOG_VERT, fragmentShader: FOG_FRAG,
      transparent:true, depthWrite:false, blending:T.NormalBlending,
      uniforms:{ uTime:{value:0}, uFogColor:{value:new T.Color(0xddeeff)} },
    });
    this._fogMesh = new T.Points(geo, this._fogMat);
    this._fogMesh.frustumCulled = false;
    this.scene.add(this._fogMesh);
  }
  _spawnFog(x,y,z, vx,vy,vz, density, scale, life) {
    if (this._fogActive >= MAX_FOG) return;
    const i=this._fogActive++;
    this._fogPositions[i*3]=x; this._fogPositions[i*3+1]=y; this._fogPositions[i*3+2]=z;
    this._fogVels[i*3]=vx; this._fogVels[i*3+1]=vy; this._fogVels[i*3+2]=vz;
    this._fogDensities[i]=density; this._fogScales[i]=scale;
    this._fogLives[i]=life; this._fogMaxLives[i]=life;
  }
  _updateFog(delta, elapsed) {
    this._fogMat.uniforms.uTime.value=elapsed;
    let alive=0;
    for (let i=0; i<this._fogActive; i++) {
      this._fogLives[i]-=delta;
      if (this._fogLives[i]<=0) continue;
      this._fogPositions[i*3]   += this._fogVels[i*3]   * delta;
      this._fogPositions[i*3+1] += this._fogVels[i*3+1] * delta;
      this._fogPositions[i*3+2] += this._fogVels[i*3+2] * delta;
      this._fogLives[alive]    = this._fogLives[i];
      this._fogMaxLives[alive] = this._fogMaxLives[i];
      this._fogDensities[alive]= this._fogDensities[i]*0.999;
      if (alive!==i) {
        this._fogPositions.copyWithin(alive*3, i*3, i*3+3);
        this._fogVels.copyWithin(alive*3, i*3, i*3+3);
        this._fogScales[alive] = this._fogScales[i];
      }
      alive++;
    }
    this._fogActive=alive;
    this._fogMesh.geometry.setDrawRange(0,alive);
    this._fogMesh.geometry.attributes.aOffset.needsUpdate=true;
    this._fogMesh.geometry.attributes.aDensity.needsUpdate=true;
    this._fogMesh.geometry.attributes.aLife.needsUpdate=true;
  }

  // ── Ground texture cache (AF-3D-012) ────────────────────────────────────
  // Generated once per scene, reused across pool rebuilds. Null in headless
  // contexts — every material then keeps its flat colour, the pre-texture look.
  _ensureGroundTextures() {
    if (this._groundTex !== undefined) return this._groundTex;
    const T = this.THREE;
    try {
      const deck = createStoneMaps(T, { kind: "deck", repeat: 20 });
      this._groundTex = deck ? {
        deck,
        // Same stone at wall/stage scale — clones share the canvases.
        wall:   cloneStoneMaps(deck, 16, 0.4),
        stage:  cloneStoneMaps(deck, 6, 6),
        coping: createStoneMaps(T, { kind: "coping", repeat: 10 }),
        basin:  createStoneMaps(T, { kind: "basin", repeat: 2 }),
      } : null;
    } catch (e) {
      this._groundTex = null;   // textures are an enhancement, never fatal
    }
    return this._groundTex;
  }

  // ── Pool / surface / lasers / venue ─────────────────────────────────────
  _buildPool() {
    const T=this.THREE;
    const geom=this.poolGeometry;
    if (this._poolObjects) this._poolObjects.forEach(o => { if(o.parent) o.parent.remove(o); });
    this._poolObjects = [];

    let poolRadius=6, poolW=12, poolL=8, poolType='circular';
    if (geom?.params) {
      poolRadius=geom.params.radius||6;
      poolW=geom.params.width||12;
      poolL=geom.params.length||8;
      const t=geom.poolType||'circular';
      poolType = (t==='rectangular'||t==='lshape'||t==='freeform'||t==='false_lake'||t==='false_river')
                  ? 'rectangular' : (t==='elliptical') ? 'ellipse' : t;
    }
    this._poolRadius=poolRadius; this._poolW=poolW; this._poolL=poolL; this._poolType=poolType;

    const gt = this._ensureGroundTextures();

    const deckMat = new T.MeshStandardMaterial({ color:0x10151b, roughness:0.78, metalness:0.12 });
    if (gt) { applyStoneMaps(deckMat, gt.deck); deckMat.metalness = 0.05; }
    const deck = new T.Mesh(new T.PlaneGeometry(80,80), deckMat);
    deck.rotation.x=-Math.PI/2; deck.position.y=-0.02; deck.receiveShadow=true;
    this.scene.add(deck); this._poolObjects.push(deck);

    const wallGeo = poolType==='circular'
      ? new T.CylinderGeometry(poolRadius+0.18, poolRadius+0.18, 0.45, 64, 1, true)
      : new T.BoxGeometry(poolW+0.35, 0.45, poolL+0.35);
    const wallMat = new T.MeshStandardMaterial({ color:0x252535, roughness:0.65, metalness:0.25 });
    if (gt) { applyStoneMaps(wallMat, gt.wall, { normalScale: 0.6 }); wallMat.metalness = 0.08; }
    const wall = new T.Mesh(wallGeo, wallMat); wall.position.y=0.22; wall.castShadow=true;
    this.scene.add(wall); this._poolObjects.push(wall);

    const copingMat = new T.MeshStandardMaterial({color:0x999aaa,roughness:0.2,metalness:0.7});
    // Polished stone, not chrome: with a real albedo the high metalness read as
    // smoked mirror and swallowed the texture.
    if (gt) { applyStoneMaps(copingMat, gt.coping, { normalScale: 0.4 }); copingMat.metalness = 0.22; }
    if (poolType==='circular') {
      const coping = new T.Mesh(new T.TorusGeometry(poolRadius+0.18,0.09,8,64), copingMat);
      // A torus is generated standing in the XY plane. Without this rotation the pool
      // rim was installed VERTICALLY — a giant archway hooping over the water, its
      // lower half buried under the deck. Only circular pools build a torus coping,
      // which is why rectangular layouts (box copings) never showed it.
      coping.rotation.x = -Math.PI/2;
      coping.position.y=0.46; this.scene.add(coping); this._poolObjects.push(coping);
    } else {
      const s1 = poolW + 0.35;
      const s2 = poolL + 0.35;
      const c1 = new T.Mesh(new T.BoxGeometry(s1,0.09,0.18), copingMat);
      c1.position.set(0,0.46, poolL/2+0.175); this.scene.add(c1); this._poolObjects.push(c1);
      const c2 = new T.Mesh(new T.BoxGeometry(s1,0.09,0.18), copingMat);
      c2.position.set(0,0.46,-poolL/2-0.175); this.scene.add(c2); this._poolObjects.push(c2);
      const c3 = new T.Mesh(new T.BoxGeometry(0.18,0.09,s2), copingMat);
      c3.position.set(poolW/2+0.175,0.46,0); this.scene.add(c3); this._poolObjects.push(c3);
      const c4 = new T.Mesh(new T.BoxGeometry(0.18,0.09,s2), copingMat);
      c4.position.set(-poolW/2-0.175,0.46,0); this.scene.add(c4); this._poolObjects.push(c4);
    }

    const floorGeo = poolType==='circular' ? new T.CircleGeometry(poolRadius,64) : new T.PlaneGeometry(poolW,poolL);
    const floorMat = new T.MeshStandardMaterial({color:0x08101e,roughness:0.95});
    // Mosaic basin lining — visible through the water and under the caustics.
    if (gt) applyStoneMaps(floorMat, gt.basin, { normalScale: 0.45 });
    const floor = new T.Mesh(floorGeo,floorMat);
    floor.rotation.x=-Math.PI/2; floor.position.y=-0.45;
    this.scene.add(floor); this._poolObjects.push(floor);

    const gridHelper = new T.GridHelper(40,40,0x263447,0x101b29);
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.32;
    gridHelper.position.y=0.001; this.scene.add(gridHelper); this._poolObjects.push(gridHelper);
  }

  _buildWaterSurface() {
    const T=this.THREE;
    if (this.waterSurface?.parent) this.waterSurface.parent.remove(this.waterSurface);
    const segs=48;
    const geo = this._poolType==='circular'
      ? new T.CircleGeometry(this._poolRadius, 64)
      : new T.PlaneGeometry(this._poolW, this._poolL, segs, segs);

    this.waterMat = new T.ShaderMaterial({
      vertexShader: WATER_VERT_V2, fragmentShader: WATER_FRAG_V2,
      transparent:true, side:T.FrontSide, depthWrite:false,
      uniforms:{
        uTime:           {value:0},
        uIntensity:      {value:1.0},
        uWind:           {value:0},
        uLightColor:     {value:new T.Color(0x0066ff)},
        uLightIntensity: {value:0.5},
        uDeepColor:      {value:new T.Color(0x010c1c)},
        uShallowColor:   {value:new T.Color(0x0c3558)},
        uSkyColor:       {value:new T.Color(0x030810)},
        uRoughness:      {value:0.3},
        uCameraPos:      {value:new T.Vector3()},
        // Planar reflection. Strength stays 0 until a probe has actually rendered a
        // frame, so the water falls back to the flat sky term rather than sampling an
        // empty target and going black.
        uReflectTex:      {value: this._reflection ? this._reflection.texture : null},
        uReflectMatrix:   {value: this._reflection ? this._reflection.textureMatrix : new T.Matrix4()},
        uReflectStrength: {value: 0.0},
        uFieldCount:     this._lightField.uFieldCount,
        uFieldPos:       this._lightField.uFieldPos,
        uFieldCol:       this._lightField.uFieldCol,
        uFieldInt:       this._lightField.uFieldInt,
        uFieldRad:       this._lightField.uFieldRad,
      }
    });
    this.waterSurface = new T.Mesh(geo, this.waterMat);
    this.waterSurface.rotation.x=-Math.PI/2;
    this.waterSurface.position.y=0.02;
    this.scene.add(this.waterSurface);
  }

  _buildUnderwaterLights() {
    // Underwater "ambient" point lights (the engineering-driven RGB lights are
    // handled separately by _rebuildEngineeringLights and the RGB light field).
    const T=this.THREE;
    if (this._uwGroup) { this.scene.remove(this._uwGroup); }
    this._uwGroup = new T.Group();

    const r = this._poolType==='circular' ? this._poolRadius*0.65 : Math.min(this._poolW,this._poolL)*0.3;
    this.uwLights=[];
    const count=8;
    for (let i=0; i<count; i++){
      const angle=(i/count)*Math.PI*2;
      const light=new T.PointLight(0x0066ff, 2.0, 12, 2);
      light.position.set(Math.cos(angle)*r, -0.2, Math.sin(angle)*r);
      this._uwGroup.add(light);
      this.uwLights.push(light);
    }
    this.centerLight=new T.PointLight(0x0044cc, 3.5, 22, 2);
    this.centerLight.position.set(0,0.5,0);
    this._uwGroup.add(this.centerLight);
    this.scene.add(this._uwGroup);
  }

  _buildLasers() {
    const T=this.THREE;
    if (this._laserGroup) { this.scene.remove(this._laserGroup); }
    this._laserGroup = new T.Group();
    this._laserBeams=[];
    const colors=[0xff0000,0x00ff00,0x0088ff,0xff00ff,0xffff00,0x00ffff];
    for (let i=0; i<6; i++){
      const angle=(i/6)*Math.PI*2;
      const geo=new T.CylinderGeometry(0.012,0.012,18,6);
      const mat=new T.ShaderMaterial({
        vertexShader:LASER_VERT, fragmentShader:LASER_FRAG,
        transparent:true, depthWrite:false, blending:T.AdditiveBlending,
        uniforms:{ uColor:{value:new T.Color(colors[i])}, uIntensity:{value:0}, uTime:{value:0} },
      });
      const beam=new T.Mesh(geo,mat);
      const r=this._poolRadius||6;
      beam.position.set(Math.cos(angle)*r*0.7,-0.1,Math.sin(angle)*r*0.7);
      beam.rotation.x=Math.PI/2+Math.sin(angle)*0.3;
      beam.rotation.z=Math.cos(angle)*0.3;
      beam.visible=false;
      this._laserGroup.add(beam);
      this._laserBeams.push(beam);
    }
    this.scene.add(this._laserGroup);
  }

  _buildEnvironment() { this._applyEnvironment(); this._buildVenueElements(); }
  _buildVenueElements() {
    const T=this.THREE;
    if (this._venueGroup) { this.scene.remove(this._venueGroup); }
    this._venueGroup = new T.Group();

    const stageMat = new T.MeshStandardMaterial({
      color: 0x11161b,
      roughness: 0.72,
      metalness: 0.18,
    });
    const gtStage = this._ensureGroundTextures();
    if (gtStage) { applyStoneMaps(stageMat, gtStage.stage); stageMat.metalness = 0.05; }
    const stage = new T.Mesh(new T.CylinderGeometry(11.5, 12.2, 0.22, 96), stageMat);
    stage.position.y = -0.12;
    stage.receiveShadow = true;
    this._venueGroup.add(stage);

    const rimMat = new T.MeshStandardMaterial({
      color: 0x27313c,
      emissive: 0x041526,
      roughness: 0.35,
      metalness: 0.65,
    });
    const rim = new T.Mesh(new T.TorusGeometry(12.35, 0.045, 8, 128), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.03;
    this._venueGroup.add(rim);

    for (let i=0;i<16;i++){
      const a=(i/16)*Math.PI*2;
      const d=24+seededNoise(i, 1)*10;
      const h=3+seededNoise(i, 2)*6;
      const tg=new T.CylinderGeometry(0.15,0.9,h,5);
      const tm=new T.MeshStandardMaterial({color:0x101716,roughness:0.92});
      const t=new T.Mesh(tg,tm);
      t.position.set(Math.cos(a)*d,h/2,Math.sin(a)*d);
      this._venueGroup.add(t);
    }
    for (let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2+0.2;
      const d=35+seededNoise(i, 3)*15;
      const h=8+seededNoise(i, 4)*20;
      const bg=new T.BoxGeometry(4+seededNoise(i, 5)*5,h,4+seededNoise(i, 6)*5);
      const bm=new T.MeshStandardMaterial({color:0x070b12,roughness:0.95,metalness:0.05});
      const b=new T.Mesh(bg,bm);
      b.position.set(Math.cos(a)*d,h/2,Math.sin(a)*d);
      this._venueGroup.add(b);
    }
    this.scene.add(this._venueGroup);
  }
  /** Environment-map strength. The sky-dome IBL is dim and truthful, so it can run
   *  near full strength; the RoomEnvironment fallback is a bright studio probe that
   *  must be held far lower or it flattens the night mood. */
  _envIntensityFor(env) {
    const nightish = env === ENVIRONMENTS.NIGHT || env === ENVIRONMENTS.ARENA;
    if (this._iblKind === "sky") return nightish ? 1.5 : 1.0;
    return nightish ? 0.16 : 0.42;
  }

  /** AF-3D-004: the sky dome (and starfield at night) replacing the flat backdrop. */
  _buildSky() {
    const q = QUALITY_CONFIG[this.quality] || QUALITY_CONFIG.medium;
    this._sky?.dispose?.();
    this._sky = null;
    try {
      this._sky = createSkyDome(this.THREE, this.environment, {
        stars: q.stars ? null : false,   // null = per-preset default
        pixelRatio: this._pr || 1,
      });
      this.scene.add(this._sky.group);
    } catch (err) {
      // The scene.background colour below remains the fallback backdrop.
      console.warn("[FountainScene] sky dome unavailable:", err?.message || err);
      this._sky = null;
    }
  }

  _applyEnvironment() {
    const T=this.THREE; const env=this.environment;
    if (this._envGroup) this.scene.remove(this._envGroup);
    this._envGroup = new T.Group();
    this._buildSky();
    // Keep the IBL probe in step with the preset — and, since the probe IS the sky
    // now, rebuild it whenever the environment changes after init.
    if (this._envRT && this.scene) {
      this._buildEnvironmentIBL();
    }

    if (env===ENVIRONMENTS.NIGHT){
      this.scene.background = new T.Color(0x020610);
      this.scene.fog = new T.FogExp2(0x020610, 0.015);
      const amb  = new T.AmbientLight(0x0d1a30, 2.0);
      const moon = new T.DirectionalLight(0x7788bb, 1.2);
      moon.position.set(-10,30,-10); moon.castShadow=true; moon.shadow.mapSize.set(2048,2048);
      // normalBias removes the shadow acne that otherwise stipples the curved pool
      // walls, without the "floating object" gap a large constant bias introduces.
      moon.shadow.normalBias = 0.035; moon.shadow.bias = -0.0004;
      this._envGroup.add(amb, moon);
      if (this.renderer) this.renderer.toneMappingExposure = 2.3;
      this.waterMat?.uniforms.uSkyColor.value.set(0x020610);
    } else if (env===ENVIRONMENTS.DUSK){
      this.scene.background = new T.Color(0x180820);
      this.scene.fog = new T.Fog(0x250f35, 25, 90);
      const amb = new T.AmbientLight(0x281030, 2.8);
      const sun = new T.DirectionalLight(0xff5522, 1.8);
      sun.position.set(12,7,-20); sun.castShadow=true;
      const fill = new T.HemisphereLight(0x501880, 0x100820, 1.5);
      this._envGroup.add(amb, sun, fill);
      if (this.renderer) this.renderer.toneMappingExposure = 1.9;
      this.waterMat?.uniforms.uSkyColor.value.set(0x180820);
    } else if (env===ENVIRONMENTS.DAY){
      this.scene.background = new T.Color(0x6ab4d8);
      this.scene.fog = new T.Fog(0x9cc5de, 40, 130);
      const amb = new T.AmbientLight(0xffffff, 2.5);
      const sun = new T.DirectionalLight(0xfff8e8, 3.8);
      sun.position.set(25,60,25); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048);
      const sky = new T.HemisphereLight(0x6ab4d8, 0x2d5c20, 1.0);
      this._envGroup.add(amb, sun, sky);
      if (this.renderer) this.renderer.toneMappingExposure = 1.0;
      this.waterMat?.uniforms.uSkyColor.value.set(0x6ab4d8);
      this.waterMat?.uniforms.uDeepColor.value.set(0x0d3550);
      this.waterMat?.uniforms.uShallowColor.value.set(0x2d7aaa);
    } else if (env===ENVIRONMENTS.ARENA){
      this.scene.background = new T.Color(0x010305);
      this.scene.fog = new T.FogExp2(0x010305, 0.013);
      const amb = new T.AmbientLight(0x040810, 1.5);
      const cols=[0xff1100,0x0011ff,0x00ff22,0xff8800,0xff00cc,0x00eeff];
      cols.forEach((color,i)=>{
        const a=(i/cols.length)*Math.PI*2;
        const sp=new T.SpotLight(color,25,70,Math.PI/5,0.3,2);
        sp.position.set(Math.cos(a)*18,22,Math.sin(a)*18);
        sp.target.position.set(0,0,0); sp.castShadow=true;
        this._envGroup.add(sp, sp.target);
      });
      this._envGroup.add(amb);
      if (this.renderer) this.renderer.toneMappingExposure = 2.6;
    }
    this.scene.add(this._envGroup);
  }

  // ── Nozzle layout (default OR engineering override) ─────────────────────
  _defaultLayout() {
    const r=this._poolRadius||6;
    const layout=[];
    layout.push({id:'center-geyser', type:NOZZLE_TYPES.GEYSER, x:0, z:0});
    for (let i=0;i<6;i++){
      const a=(i/6)*Math.PI*2;
      layout.push({id:`arch-${i}`, type:NOZZLE_TYPES.ARCH, x:Math.cos(a)*r*0.52, z:Math.sin(a)*r*0.52, tiltX:30});
    }
    for (let i=0;i<8;i++){
      const a=(i/8)*Math.PI*2;
      layout.push({id:`jet-${i}`, type:NOZZLE_TYPES.JET_3D, x:Math.cos(a)*r*0.76, z:Math.sin(a)*r*0.76, tiltX:i%2===0?10:-10});
    }
    for (let i=0;i<4;i++){
      const a=(i/4)*Math.PI*2;
      layout.push({id:`laminar-${i}`, type:NOZZLE_TYPES.LAMINAR, x:Math.cos(a)*r*0.35, z:Math.sin(a)*r*0.35});
    }
    for (let i=0;i<14;i++){
      const a=(i/14)*Math.PI*2;
      layout.push({id:`mist-${i}`, type:NOZZLE_TYPES.MIST, x:Math.cos(a)*r*0.92, z:Math.sin(a)*r*0.92});
    }
    return layout;
  }

  _buildNozzles() {
    // Dispose old nozzles
    this.nozzles.forEach(n => n.dispose?.());
    this.nozzles = [];

    // BUG FIX: engineering nozzles REPLACE default layout (not append)
    const layout = (this.userNozzles && this.userNozzles.length > 0)
      ? this.userNozzles
      : this._defaultLayout();

    layout.forEach(cfg => {
      // Normalize: ensure type exists
      const finalCfg = {
        id: cfg.id || `n-${Math.random().toString(36).slice(2,8)}`,
        type: cfg.type || NOZZLE_TYPES.JET_3D,
        x: cfg.x ?? 0,
        z: cfg.z ?? 0,
        tiltX: cfg.tiltX ?? 0,
        tiltZ: cfg.tiltZ ?? 0,
	groupId: cfg.groupId || null,
        engineering: cfg.engineering || null,
      };
      const nz = new NozzleV2(this.THREE, this.waterSys, this.spraySys, this.foamSys, this.flameSys, finalCfg, this._lightField);
      this.scene.add(nz.dot);
      if (nz.core) this.scene.add(nz.core);
      if (nz.glow) this.scene.add(nz.glow);
      this.nozzles.push(nz);
    });

    // Re-attach any solved hydraulics to the freshly built nozzle instances, so a
    // re-layout does not silently drop back to the estimated jet heights.
    this._applyNozzlePhysics();

    if (this._initialized) this._buildReviewOverlays();
  }

  _buildReviewOverlays() {
    const T = this.THREE;
    if (this._reviewGroup) this.scene.remove(this._reviewGroup);
    this._reviewGroup = new T.Group();
    this._reviewGroup.visible = this.reviewOverlays !== false;

    const ringMat = new T.LineBasicMaterial({
      color: 0x58c7ff,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    const safetyMat = new T.LineBasicMaterial({
      color: 0xffcc55,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });
    const boundsMat = new T.LineBasicMaterial({
      color: 0xd7b957,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });

    const circleLine = (radius, mat, y = 0.055) => {
      const pts = [];
      const segs = 96;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        pts.push(new T.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
      }
      return new T.Line(new T.BufferGeometry().setFromPoints(pts), mat);
    };

    if (this._poolType === "circular") {
      this._reviewGroup.add(circleLine((this._poolRadius || 6) + 0.2, boundsMat, 0.075));
    } else {
      const w = (this._poolW || 12) / 2 + 0.18;
      const l = (this._poolL || 8) / 2 + 0.18;
      const pts = [
        new T.Vector3(-w, 0.075, -l), new T.Vector3(w, 0.075, -l),
        new T.Vector3(w, 0.075, l), new T.Vector3(-w, 0.075, l),
        new T.Vector3(-w, 0.075, -l),
      ];
      this._reviewGroup.add(new T.Line(new T.BufferGeometry().setFromPoints(pts), boundsMat));
    }

    const nozzles = this.getNozzles();
    nozzles.forEach((n) => {
      const type = String(n.type || "");
      if (type === NOZZLE_TYPES.LASER || type === NOZZLE_TYPES.FLAME) return;
      const radius =
        type === NOZZLE_TYPES.GEYSER ? 1.15 :
        type === NOZZLE_TYPES.ARCH || type === NOZZLE_TYPES.LAMINAR ? 2.3 :
        type === NOZZLE_TYPES.MIST ? 0.9 :
        1.55;
      const reach = circleLine(radius, ringMat, 0.07);
      reach.position.set(n.x || 0, 0, n.z || 0);
      this._reviewGroup.add(reach);
      const safety = circleLine(radius * 1.55, safetyMat, 0.065);
      safety.position.set(n.x || 0, 0, n.z || 0);
      this._reviewGroup.add(safety);
    });

    this.scene.add(this._reviewGroup);
  }

  // ── Engineering: REPLACE layout entirely with the designer's nozzles ────
  setNozzlesFromEngineering(nozzleConfigs) {
    // Accept either an array of configs or null to revert to default
    if (!nozzleConfigs || nozzleConfigs.length === 0) {
      this.userNozzles = null;
    } else {
      // Map engineering-format → internal nozzle config
      this.userNozzles = nozzleConfigs.map(c => ({
        id:    c.id,
        type:  c.type || c.nozzleType || NOZZLE_TYPES.JET_3D,
        x:     c.x ?? 0,
        z:     c.z ?? (c.y ?? 0),
        tiltX: c.tiltX || 0,
        tiltZ: c.tiltZ || 0,
	groupId: c.groupId || null,
        engineering: c.engineering || null,
      }));
    }
    if (this._initialized) this._buildNozzles();
  }

  // ── Engineering: drive Phase-2 RGB light field from fixture lights ──────
  setEngineeringLights(lightConfigs) {
    const T = this.THREE;
    // Remove any visible markers
    this._engLightMeshes.forEach(m => { if (m.parent) m.parent.remove(m); });
    this._engLightMeshes = [];

    this._engLights = (lightConfigs||[]).slice(0, MAX_FIELD_LIGHTS).map(lc => {
      const color = new T.Color(typeof lc.color === 'string' ? lc.color : (lc.color || 0x0066ff));
      const intensity = (lc.intensity ?? 4.0);
      const radius = lc.radius ?? 6.0;
      // Tiny marker for debugging
      const mk = new T.Mesh(
        new T.CircleGeometry(0.35, 24),
        new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.92,
          side: T.DoubleSide, depthWrite: false })
      );
      mk.rotation.x = -Math.PI / 2;
      mk.position.set(lc.x ?? 0, 0.03, lc.z ?? (lc.y ?? 0));
      this.scene.add(mk);
      this._engLightMeshes.push(mk);

      return {
        x: lc.x ?? 0,
        z: lc.z ?? (lc.y ?? 0),
        color,
        intensity,
        radius,
      };
    });

    // Immediately push to shader light-field
    this._uploadLightField();
  }

    _uploadLightField() {
    const lf = this._lightField;
    if (!lf) return;

    const lights = Array.isArray(this._engLights) ? this._engLights : [];
    const n = Math.min(lights.length, MAX_FIELD_LIGHTS);

    lf.uFieldCount.value = n;

    for (let i = 0; i < MAX_FIELD_LIGHTS; i++) {
      if (i < n) {
        const L = lights[i];
        lf.uFieldPos.value[i].set(L.x || 0, 0.35, L.z || 0);
        lf.uFieldCol.value[i].copy(L.color || new this.THREE.Color(1, 1, 1));
        lf.uFieldInt.value[i] = Math.max(0, Number(L.intensity || 0)) * 1.8;
        lf.uFieldRad.value[i] = Math.max(1, Number(L.radius || 6));
      } else {
        lf.uFieldPos.value[i].set(0, 0, 0);
        lf.uFieldCol.value[i].setRGB(0, 0, 0);
        lf.uFieldInt.value[i] = 0;
        lf.uFieldRad.value[i] = 1;
      }
    }
  }

  // ── Patterns: delta-driven (BUG FIX: previously setInterval) ────────────
  playPattern(name, intensity=0.88) {
    this._patternName = name;
    this._patternBase = intensity;
    this._patternTime = 0;
    // Clear manual per-nozzle override so pattern can drive
    this._perNozzle = null;
  }
  stopPattern() {
    this._patternName = null;
    this._perNozzle = null;
  }

  // ── Main update tick ────────────────────────────────────────────────────
  _update(delta, elapsed) {
    const I = this._signals || {};
    const breath = 0.72 + Math.sin(elapsed*0.62) * 0.28;

        // ─── RGB light field globals (runtime-controlled) ─────────────────────
    // Runtime/timeline/manual pattern must be the authority for RGB color.
    // Do NOT generate an automatic rainbow chase here, because it overrides
    // Pattern Designer RGB selections.
    const T = this.THREE;
    const lightI = Math.max(0, Math.min(1, Number(I.lighting || 0)));

    const runtimeColor = this._colorFromSignalColor(
      I.lightingColor,
      this.lightColor || "#ffffff"
    );

    this._runtimeLightColor = runtimeColor;

    // Stronger visible global tint for water, spray, pool and glow.
    this._lightField.uGlobalLight.value.copy(runtimeColor);
    this._lightField.uGlobalLightI.value = lightI * 2.5;
    // Keep the pool surface shader synchronized with runtime RGB.
    if (this.waterMat?.uniforms) {
      this.waterMat.uniforms.uLightColor.value.copy(runtimeColor);
      this.waterMat.uniforms.uLightIntensity.value = Math.max(0.5, lightI * 2.2);
    }

    // Keep underwater point lights synchronized too.
    for (const light of this.uwLights || []) {
      light.color.copy(runtimeColor);
      light.intensity = Math.max(1.5, lightI * 5.0);
    }

    if (this.centerLight) {
      this.centerLight.color.copy(runtimeColor);
      this.centerLight.intensity = Math.max(2.0, lightI * 7.0);
    }

    // If the user has engineering RGB lights, runtime RGB must tint them too.
    if (this._engLights?.length) {
      for (const L of this._engLights) {
        if (L?.color) L.color.copy(runtimeColor);
        L.intensity = Math.max(Number(L.intensity || 0), lightI * 10.0);
	L.radius = Math.max(Number(L.radius || 0), 5.5);
      }

      for (const mesh of this._engLightMeshes || []) {
        if (mesh?.material?.color) mesh.material.color.copy(runtimeColor);
      }
    }

    this._uploadLightField();

    // ─── Update pattern (delta-driven, replaces setInterval) ────────────
    if (this._patternName) {
      this._patternTime += delta;
      const count = this.nozzles.length;
      if (count > 0) {
        if (!this._perNozzleArr || this._perNozzleArr.length !== count) {
          this._perNozzleArr = new Array(count).fill(0);
        }
        for (let i=0; i<count; i++) {
          this._perNozzleArr[i] = patternIntensity(this._patternName, this._patternTime, i, count, this._patternBase);
        }
        this._perNozzle = this._perNozzleArr;
      }
    }

    // GPU emitter descriptors are rebuilt each frame from the same intensities that
    // drive the CPU path, so the two backends stay in step.
    const gpuOn = !!(this._gpuWater && this._gpuSpray);
    const emitWater = gpuOn ? (this._emitWaterBuf || (this._emitWaterBuf = [])) : null;
    const emitSpray = gpuOn ? (this._emitSprayBuf || (this._emitSprayBuf = [])) : null;
    if (gpuOn) { emitWater.length = 0; emitSpray.length = 0; }

       // ─── Drive nozzles ──────────────────────────────────────────────────
    this.nozzles.forEach((nz, idx) => {
      const t = nz.config.type;
      let live = 0;

      if (this._perNozzle) {
        const patternValue = this._perNozzle[idx] || 0;
        let runtimeValue = 0;

        const jets = [
          'jet_1d','jet_2d','jet_3d','geyser','laminar','pirouette',
          'fan_jet','motion_1d','motion_2d','motion_3d'
        ];

        if (jets.includes(t)) {
          runtimeValue = I.pump || 0;
        }
        else if (['arch','ring','cascade'].includes(t)) {
          runtimeValue = Math.max((I.pump || 0) * 0.65, I.valve || 0);
        }
        else if (t === 'mist') {
          runtimeValue = Math.max(I.fog || 0, (I.pump || 0) * 0.35);
        }
        else if (t === 'screen') {
          runtimeValue = Math.max((I.pump || 0) * 0.8, I.screen || 0);
        }
        else if (t === 'flame') {
          runtimeValue = I.flame || 0;
        }
        else if (t === 'laser') {
          runtimeValue = I.laser || 0;
        }

        live = patternValue * runtimeValue;
      } else {
        const jets = ['jet_1d','jet_2d','jet_3d','geyser','laminar','pirouette',
                      'fan_jet','motion_1d','motion_2d','motion_3d'];
        if (jets.includes(t)) live = I.pump || 0;
        else if (['arch','ring','cascade'].includes(t)) live = Math.max((I.pump||0)*0.65, I.valve||0);
        else if (t === 'mist')   live = Math.max(I.fog||0, (I.pump||0)*0.35);
        else if (t === 'screen') live = Math.max((I.pump||0)*0.8, I.screen||0);
        else if (t === 'flame')  live = I.flame || 0;
        else if (t === 'laser') live = I.laser || 0;
      }

      // Apply engineering scalar (jet height/pressure) if present
      if (nz.config.engineering?.heightScale) {
        live *= Math.min(2.0, Math.max(0.3, nz.config.engineering.heightScale));
      }

      const floor = (IDLE[t] || 0.02) * breath * Math.max(0, 1.0 - live*5.0);
      live = this._groupIntensityForNozzle(nz, live);
      const finalI = live > 0.015 ? live : floor;
      nz.setIntensity(finalI);
      nz.update(delta, elapsed, this.wind, this._lightField.uGlobalLight.value);

      if (gpuOn) {
        const descs = describeNozzleEmitters(
          nz.config, finalI, elapsed, this.wind,
          this._lightField.uGlobalLight.value,
          (demand, fallback) => nz._launchSpeed(demand, fallback),
        );
        for (const d of descs) {
          const bucket = d.cls === EMIT_CLASS.SPRAY ? emitSpray : emitWater;
          // The parameter texture is MAX_GPU_EMITTERS wide; a particle assigned past
          // its edge would sample garbage, so a very large design simply drops its
          // tail rather than corrupting the field.
          if (bucket.length < MAX_GPU_EMITTERS) bucket.push(d);
        }
      }
    });

    // ─── GPU particle simulation ───────────────────────────────────────
    if (gpuOn) {
      const pool = this._poolBoundsForSplash();
      // The allocation only has to be recomputed when the DESIGN changes; keying on
      // the emitter signature keeps a fading nozzle from reshuffling the whole field.
      const key = `${this.nozzles.map(n => `${n.config.id}:${n.config.type}`).join("|")}#${emitWater.length}/${emitSpray.length}`;
      if (key !== this._gpuLayoutKey) {
        this._gpuLayoutKey = key;
        this._gpuWater.setLayout(allocatePool(emitWater, this._gpuWater.count), key);
        this._gpuSpray.setLayout(allocatePool(emitSpray, this._gpuSpray.count), key);
      }
      this._gpuWater.setEmitters(emitWater);
      this._gpuSpray.setEmitters(emitSpray);
      this._gpuWater.step(delta, elapsed, { wind: this.wind, pool });
      this._gpuSpray.step(delta, elapsed, { wind: this.wind, pool });
    }
      
    // ─── Particle systems ──────────────────────────────────────────────
    this.waterSys.update(delta, -9.5, elapsed);
    this.spraySys.update(delta, -7.0, elapsed);
    this.foamSys.update(delta, -2.5, elapsed);
    this.flameSys.update(delta, -0.6, elapsed);
    this._updateFog(delta, elapsed);
    this._emitFlame(delta, I.flame || 0);
    this._emitGroundFog(delta, I.fog || 0);
    this._updateSplashMap(delta);

    // ─── Sky + volumetric beam cones (AF-3D R1) ────────────────────────
    this._sky?.update(elapsed);
    if (this._cones) {
      // A beam is only visible where there is spray to scatter it.
      const activity = Math.max(I.pump || 0, I.valve || 0, (I.fog || 0) * 0.6);
      let coneLights = this._engLights;
      if (!coneLights?.length && lightI > 0.02 && this.uwLights?.length) {
        // No engineering fixtures placed: synthesize beams at the default
        // underwater ring so the stock preview still gets the signature look.
        if (!this._defaultConeLights || this._defaultConeLights.length !== this.uwLights.length) {
          this._defaultConeLights = this.uwLights.map(l => ({
            x: l.position.x, z: l.position.z, color: l.color, intensity: 0, radius: 5,
          }));
        }
        for (const c of this._defaultConeLights) c.intensity = lightI * 4.0;
        coneLights = this._defaultConeLights;
      }
      this._cones.update(coneLights, elapsed, activity, this.camera);
    }

    // ─── Lasers ────────────────────────────────────────────────────────
    const laserI = I.laser || 0;
    this._laserBeams.forEach((beam,i) => {
      beam.visible = laserI > 0.05;
      beam.material.uniforms.uIntensity.value = laserI;
      beam.material.uniforms.uTime.value = elapsed;
      beam.rotation.y += delta * 0.5 * (i%2===0?1:-1);
    });

    // ─── Water surface ─────────────────────────────────────────────────
    if (this.waterMat) {
      this.waterMat.uniforms.uTime.value = elapsed;
      this.waterMat.uniforms.uIntensity.value = 0.4 + (I.pump||0)*0.6;
      this.waterMat.uniforms.uWind.value = Math.sqrt(this.wind.x**2 + this.wind.z**2);
      this.waterMat.uniforms.uLightColor.value.copy(this._lightField.uGlobalLight.value);
      this.waterMat.uniforms.uLightIntensity.value = 0.25 + lightI*0.75;
      this.waterMat.uniforms.uCameraPos.value.copy(this.camera.position);
    }

    // ─── Underwater point lights tinted to global light ────────────────
    const pulseI = lightI * breath;
    const lcol = this._lightField.uGlobalLight.value;
    this.uwLights.forEach((ul,i) => {
      ul.intensity = 1.5 + pulseI*5.0 * (Math.sin(elapsed*1.3 + i*0.75)*0.28 + 0.72);
      ul.color.lerp(lcol, 0.04);
    });
    if (this.centerLight) {
      this.centerLight.intensity = 2.5 + pulseI*6.0 * (Math.sin(elapsed*0.85)*0.25 + 0.75);
      this.centerLight.color.lerp(lcol, 0.04);
    }
  }

  _emitFlame(delta, intensity) {
    if (intensity < 0.05) return;
    const count = Math.floor(delta * intensity * 40);
    for (let i=0; i<count; i++){
      const angle = Math.random()*Math.PI*2;
      const d = 0.15 + Math.random()*0.4*intensity;
      const vy = 1.0 + Math.random()*2.5*intensity;
      const t = Math.random();
      this.flameSys.spawn(
        Math.cos(angle)*d, 0.12, Math.sin(angle)*d,
        (Math.random()-0.5)*0.4, vy, (Math.random()-0.5)*0.4,
        1.0, 0.3+t*0.4, 0.0, 0.9, 0.3+Math.random()*0.7, 0.2+intensity*0.15, 0.4
      );
    }
  }
  _emitGroundFog(delta, intensity) {
    if (intensity < 0.08) return;
    const r=this._poolRadius||6;
    const count=Math.floor(delta*intensity*12);
    for (let i=0;i<count;i++){
      const angle=Math.random()*Math.PI*2;
      const d=r*0.85+Math.random()*r*0.4;
      this._spawnFog(
        Math.cos(angle)*d, 0.08+Math.random()*0.12, Math.sin(angle)*d,
        (Math.random()-0.5)*0.35*intensity, 0.04+Math.random()*0.08,
        (Math.random()-0.5)*0.35*intensity,
        0.7+Math.random()*0.3, 0.45+intensity*0.35, 2.0+Math.random()*3.0
      );
    }
  }

  _getCameraPath(t, mode){
    const T=this.THREE;
    switch(mode){
      case CAMERA_MODES.AERIAL:{
        const a=t*Math.PI*2*0.25;
        return{pos:new T.Vector3(Math.cos(a)*22,20+Math.sin(t*0.5)*2,Math.sin(a)*22),look:new T.Vector3(0,2,0)};
      }
      case CAMERA_MODES.FLYTHROUGH:{
        const a=t*Math.PI*2;
        const r=Math.max(12-t*8,4);
        return{pos:new T.Vector3(Math.cos(a)*r,2+t*8,Math.sin(a)*r),look:new T.Vector3(0,3,0)};
      }
      case CAMERA_MODES.DRAMATIC:{
        const a=t*Math.PI*0.7-0.1;
        return{pos:new T.Vector3(Math.cos(a)*9,0.8+t*14,Math.sin(a)*9),look:new T.Vector3(0,t*7,0)};
      }
      case CAMERA_MODES.AUDIENCE:
        return{pos:new T.Vector3(Math.sin(t*0.25)*5,3.0,16),look:new T.Vector3(0,4,0)};
      default: return null;
    }
  }

  _animate() {
    if (!this._initialized) return;
    this._rafId = requestAnimationFrame(() => this._animate());
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime || 0;
    this._update(delta, elapsed);

    const cam = this.camera;
    // In editor mode the editor owns the camera. Re-deriving it from orbitAngle every
    // frame here would undo every pan and orbit the designer just made.
    if (this._editorMode) {
      this._editor?.update?.();
      this._renderFrame();
      return;
    }
    const cinematic = [CAMERA_MODES.AERIAL, CAMERA_MODES.FLYTHROUGH, CAMERA_MODES.DRAMATIC, CAMERA_MODES.AUDIENCE];
    if (cinematic.includes(this.cameraMode)) {
      this._pathTime = (this._pathTime + delta*0.08) % 1;
      const cp = this._getCameraPath(this._pathTime, this.cameraMode);
      if (cp) { cam.position.lerp(cp.pos, 0.025); cam.lookAt(cp.look); }
    } else if (this.cameraMode === CAMERA_MODES.ORBIT) {
      if (this.orbitAuto) this.orbitAngle += delta*0.055;
      cam.position.set(Math.cos(this.orbitAngle)*this.orbitRadius, this.orbitHeight, Math.sin(this.orbitAngle)*this.orbitRadius);
      cam.lookAt(0, 3, 0);
    } else if (this.cameraMode === CAMERA_MODES.TOP) {
      cam.position.set(0, 25, 0.01); cam.lookAt(0,0,0);
    } else if (this.cameraMode === CAMERA_MODES.FRONT) {
      cam.position.set(0, 5, 17); cam.lookAt(0, 4, 0);
    }

    this._renderFrame();
  }

  _setupEvents() {
    const c = this.canvas;
    // When the editor owns the viewport it also owns navigation (Depence's scheme:
    // ALT+drag orbits, right-drag pans, wheel dollies toward the picked point). The
    // legacy spin-on-drag would fight it, so every handler below stands down.
    this._onDown = e => {
      if (this._editorMode) return;
      this._isDragging=true; this._dragStart={x:e.clientX,y:e.clientY};
    };
    this._onMove = e => {
      if (this._editorMode) return;
      if (!this._isDragging) return;
      const dx=e.clientX-this._dragStart.x, dy=e.clientY-this._dragStart.y;
      this._dragStart={x:e.clientX,y:e.clientY};
      this.orbitAngle += dx*0.005;
      this.orbitHeight = Math.max(1, Math.min(25, this.orbitHeight - dy*0.04));
      this.orbitAuto=false; this.cameraMode=CAMERA_MODES.ORBIT;
    };
    this._onUp = () => { this._isDragging=false; };
    this._onWheel = e => {
      if (this._editorMode) return;
      this.orbitRadius = Math.max(3, Math.min(25, this.orbitRadius + e.deltaY*0.012));
    };
    this._onTouchstart = e => {
      if (this._editorMode) return;
      if(e.touches[0]) this._dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY}; this._isDragging=true;
    };
    this._onTouchmove = e => {
      if (this._editorMode) return;
      if(!this._isDragging || !e.touches[0]) return;
      const dx=e.touches[0].clientX-this._dragStart.x, dy=e.touches[0].clientY-this._dragStart.y;
      this._dragStart={x:e.touches[0].clientX,y:e.touches[0].clientY};
      this.orbitAngle += dx*0.005;
      this.orbitHeight = Math.max(1, Math.min(25, this.orbitHeight - dy*0.04));
      this.orbitAuto=false;
    };
    c.addEventListener('mousedown',  this._onDown);
    c.addEventListener('mousemove',  this._onMove);
    c.addEventListener('mouseup',    this._onUp);
    c.addEventListener('mouseleave', this._onUp);
    c.addEventListener('wheel',      this._onWheel, {passive:true});
    c.addEventListener('touchstart', this._onTouchstart, {passive:true});
    c.addEventListener('touchmove',  this._onTouchmove,  {passive:true});
    c.addEventListener('touchend',   this._onUp);
  }

  // ─── Video capture — 4K / 60 FPS / synchronized audio (AQ-S3-007) ─────────
  /**
   * @param {object} opts { resolution:"720p|1080p|1440p|4k", fps:24|30|60,
   *                        audioStream?:MediaStream, durationS?:number }
   */
  startRecording(opts = {}) {
    if (!this.canvas.captureStream) return false;
    const cfg = VE_buildExportConfig({
      resolution: opts.resolution || "1080p",
      fps: opts.fps || 60,
      durationS: opts.durationS || 0,
      withAudio: !!opts.audioStream,
    });
    this._exportCfg = cfg;
    // Render at the export resolution so the captured frames are true 4K/etc.
    if (opts.resolution) {
      this._preExportSize = { w: this.canvas.clientWidth || this.canvas.width, h: this.canvas.clientHeight || this.canvas.height };
      try { this.renderer.setSize(cfg.width, cfg.height, false); this.camera.aspect = cfg.width / cfg.height; this.camera.updateProjectionMatrix(); } catch (e) {}
    }
    let stream = this.canvas.captureStream(cfg.fps);
    if (opts.audioStream) stream = VE_combineStreams(stream, opts.audioStream);
    this._recordedChunks = [];
    const recOpts = { mimeType: cfg.mimeType, videoBitsPerSecond: cfg.videoBitrate };
    if (cfg.hasAudio) recOpts.audioBitsPerSecond = cfg.audioBitrate;
    try { this._mediaRecorder = new MediaRecorder(stream, recOpts); }
    catch (e) { this._mediaRecorder = new MediaRecorder(stream); }
    this._mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this._recordedChunks.push(e.data); };
    this._mediaRecorder.start(100);
    return true;
  }
  stopRecording() {
    if (!this._mediaRecorder) return;
    const cfg = this._exportCfg || { mimeType: "video/webm", fileExtension: "webm", label: "" };
    // Restore the preview size after capturing at export resolution.
    if (this._preExportSize) {
      const s = this._preExportSize; this._preExportSize = null;
      try { this.resize(s.w, s.h); } catch (e) {}
    }
    this._mediaRecorder.stop();
    setTimeout(() => {
      const blob = new Blob(this._recordedChunks, { type: (cfg.mimeType || "video/webm").split(";")[0] });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const tag = cfg.label ? cfg.label.replace(/\s+/g, "") : "show";
      a.href = url; a.download = `aquaflow-${tag}-${Date.now()}.${cfg.fileExtension || "webm"}`; a.click();
      URL.revokeObjectURL(url);
    }, 500);
  }
  /** Expose the last/target export config (for the UI). */
  getExportConfig(opts = {}) { return VE_buildExportConfig({ resolution: opts.resolution || "1080p", fps: opts.fps || 60, withAudio: !!opts.withAudio }); }
    _groupIntensityForNozzle(nozzle, fallback = 0) {
    const groups = this._signals?.groups || {};

    // New system: engineering/runtime group id controls the nozzle
    const groupId = nozzle?.config?.groupId;
    if (groupId && groups[groupId] !== undefined) {
      return Math.max(fallback, groups[groupId] || 0);
    }

    // Old fallback system
    const type = nozzle?.config?.type || "";

    if (["jet_1d", "jet_2d", "jet_3d", "geyser", "laminar", "pirouette",
         "fan_jet", "motion_1d", "motion_2d", "motion_3d"].includes(type)) {
      return Math.max(fallback, groups.center_jets || 0);
    }

    if (type === "flame") {
      return Math.max(fallback, groups.flame_units || 0, this._signals?.flame || 0);
    }

    if (type === "laser") {
      return Math.max(fallback, groups.laser_units || 0, this._signals?.laser || 0);
    }

    if (type === "ring") {
      return Math.max(fallback, groups.outer_ring_jets || 0);
    }

    if (type === "arch") {
      return Math.max(fallback, groups.arch_jets || 0);
    }

    if (type === "cascade") {
      return Math.max(fallback, groups.cascade_jets || 0);
    }
    
    if (type === "screen") {
      return Math.max(fallback, groups.screen_jets || 0);
    }

    if (type === "mist") {
      return Math.max(fallback, groups.mist_jets || 0, groups.fog_machines || 0);
    }

    return fallback;
  }

  // ─── Public API ─────────────────────────────────────────────────────────
  // BUG FIX: setSignals merges (not overwrites) so PreviewPanel.timeline driver
  // doesn't blank a manually set signal
  _colorFromSignalColor(value, fallback = "#ffffff") {
    const T = this.THREE;

    if (typeof value === "string") {
      return new T.Color(value);
    }

    if (value && typeof value === "object") {
      return new T.Color(
        value.r ?? 1,
        value.g ?? 1,
        value.b ?? 1
      );
    }

    return new T.Color(fallback);
  }

  _applyRuntimeLighting() {
    if (!this._lightField) return;

    const lightIntensity = Math.max(0, Math.min(1, Number(this._signals?.lighting || 0)));
    const color = this._colorFromSignalColor(
      this._signals?.lightingColor,
      this.lightColor || "#ffffff"
    );

    this._lightField.uGlobalLight.value.copy(color);
    this._lightField.uGlobalLightI.value = lightIntensity * 1.8;

    // Runtime RGB override:
    // When the timeline/manual pattern sends RGB color, all engineering RGB fixtures
    // should adopt that color visually instead of staying at their default library color.
    if (lightIntensity > 0.01 && this._engLights?.length) {
      for (const L of this._engLights) {
        if (L?.color) L.color.copy(color);
        L.intensity = Math.max(L.intensity || 0, lightIntensity * 6.0);
      }

      for (const mesh of this._engLightMeshes || []) {
        if (mesh?.material?.color) {
          mesh.material.color.copy(color);
        }
      }

      this._uploadLightField?.();
    }

    // Keep render-panel light color visually synchronized with active runtime color.
    if (lightIntensity > 0.01) {
      this.lightColor = `#${color.getHexString()}`;
    }
  }  
  setSignals(s) {
    if (!s) return;

    this._signals = Object.assign(
      this._signals || {
        pump: 0,
        valve: 0,
        lighting: 0,
        lightingColor: { r: 1, g: 1, b: 1, w: 0 },
        flame: 0,
        fog: 0,
        laser: 0,
      },
      s
    );

    this._applyRuntimeLighting();
  }
  setPerNozzleIntensities(a) {
    // Stops pattern playback; explicit per-nozzle takes precedence
    this._patternName = null;
    this._perNozzle = a;
  }
  setEnvironment(env){ this.environment=env; if(this._initialized) this._applyEnvironment(); }
  setCameraMode(m)  { this.cameraMode=m; this._pathTime=0; if(m===CAMERA_MODES.ORBIT) this.orbitAuto=true; }
  setReviewOverlays(visible) {
    this.reviewOverlays = visible !== false;
    if (this._reviewGroup) this._reviewGroup.visible = this.reviewOverlays;
  }
  fitCameraToDesign() {
    const r = this._poolType === "circular"
      ? (this._poolRadius || 6)
      : Math.max((this._poolW || 12) / 2, (this._poolL || 8) / 2);
    this.orbitRadius = Math.max(8, Math.min(32, r * 2.45));
    this.orbitHeight = Math.max(5.2, Math.min(18, r * 0.95));
    this.orbitAngle = -0.72;
    this.setCameraMode(CAMERA_MODES.ORBIT);
    this.orbitAuto = false;
  }

  // ── VR Walkthrough (AQ-S3-006) ────────────────────────────────────────────
  /** Is an immersive-vr session available in this browser/device? */
  async supportsVR(){ try{ return await WT_isVRSupported(); }catch(e){ return false; } }
  /** Enter an immersive-vr walkthrough. Returns true on success. */
  async enterVR(){
    if(this._xrSession) return true;
    try{
      if(!navigator.xr) return false;
      const session=await navigator.xr.requestSession("immersive-vr", WT_vrSessionOptions());
      try{ this.renderer.xr.setReferenceSpaceType(WT_vrReferenceSpaceType()); }catch(e){}
      await this.renderer.xr.setSession(session);
      this._xrSession=session;
      // The XR loop renders directly (no depth-probe refresh), so a soft-particle
      // fade would sample a stale frame. Hard edges are the honest fallback in VR.
      this._setSoftDepthEnabled(false);
      // WebXR drives its own frame loop; the headset controls the camera pose.
      this.renderer.setAnimationLoop(()=>{
        try{
          const delta=Math.min(this.clock.getDelta(),0.05);
          const elapsed=this.clock.elapsedTime||0;
          this._update(delta, elapsed);
          // Direct render on purpose: EffectComposer cannot target the WebXR
          // framebuffer, so headset sessions bypass the post chain.
          this.renderer.render(this.scene, this.camera);
        }catch(e){}
      });
      session.addEventListener("end", ()=>{ this._xrSession=null; this.renderer.setAnimationLoop(null); this._setSoftDepthEnabled(true); });
      return true;
    }catch(e){ return false; }
  }
  /** Exit VR. */
  exitVR(){ if(this._xrSession){ try{ this._xrSession.end(); }catch(e){} this._xrSession=null; } }

  /** Start the guided client-presentation tour (cinematic auto-advance + captions). */
  startPresentation(tour, onCaption){
    this.stopPresentation();
    this._tour = WT_buildTour(tour || WT_DEFAULT_TOUR);
    this._presenting = true;
    const start = (typeof performance!=="undefined"?performance.now():Date.now());
    let lastIdx = -1;
    const tick = ()=>{
      if(!this._presenting) return;
      const now = (typeof performance!=="undefined"?performance.now():Date.now());
      const st = WT_tourStepAt(this._tour, (now-start)/1000, {loop:true});
      if(st.index!==lastIdx){
        lastIdx=st.index;
        this.setCameraMode(st.step.cameraMode);
        if(typeof onCaption==="function") onCaption(st.step.caption, st.index);
      }
      this._presentTimer = setTimeout(tick, 250);
    };
    tick();
    return this._tour;
  }
  /** Stop the presentation tour. */
  stopPresentation(){ this._presenting=false; if(this._presentTimer){ clearTimeout(this._presentTimer); this._presentTimer=null; } }
      setLightColor(hex) {
    this.lightColor = hex;

    // Only apply panel light color directly when runtime is not actively
    // driving lighting. If runtime lighting is active, setSignals/_update
    // remains the authority.
    const activeRuntimeLighting = Number(this._signals?.lighting || 0) > 0.01;

    if (!activeRuntimeLighting && this._lightField) {
      const color = this._colorFromSignalColor(hex, "#ffffff");
      this._lightField.uGlobalLight.value.copy(color);
      this._lightField.uGlobalLightI.value = 0.5;
    }
  }
  setWind(x,z)      { this.wind={x:x||0, z:z||0}; }
  setPoolGeometry(geom) {
    this.poolGeometry = geom;
    if (this._initialized) {
      this._buildPool();
      this._buildWaterSurface();
      this._buildUnderwaterLights();
      this._buildLasers();
      this._buildNozzles();
      this._buildReviewOverlays();
    }
  }
  addNozzle(cfg) {
    if (!cfg.id) cfg.id = 'user-'+Date.now();
    if (!this.userNozzles) this.userNozzles = [];
    this.userNozzles.push(cfg);
    if (this._initialized) this._buildNozzles();
    return cfg.id;
  }
  removeNozzle(id) {
    if (!this.userNozzles) return;
    this.userNozzles = this.userNozzles.filter(n => n.id !== id);
    if (this._initialized) this._buildNozzles();
  }
  getNozzles() {
    return this.userNozzles && this.userNozzles.length > 0 ? [...this.userNozzles] : this._defaultLayout();
  }

  resize(w,h) {
    if (!this.renderer) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // The composer owns its own render targets — they must track the canvas or the
    // post chain renders at the old size and the image goes soft/stretched.
    if (this.composer) {
      // setSize propagates to every pass (scaled by the composer's pixel ratio), so
      // only the custom grade uniform needs updating by hand.
      this.composer.setSize(w, h);
      const pr = this._pr || 1;
      this._gradePass?.uniforms?.uResolution?.value?.set(w * pr, h * pr);
    }
    // The depth probe tracks the drawing buffer; a resize rebuilds its depth texture,
    // so every consumer must be re-pointed at the fresh one.
    if (this._depthProbe) {
      const pr = this._pr || 1;
      this._depthProbe.setSize(w * pr, h * pr);
      this._bindSoftDepth();
    }
  }

  dispose() {
    cancelAnimationFrame(this._rafId);
    this.stopPattern();
    const c = this.canvas;
    c.removeEventListener('mousedown',  this._onDown);
    c.removeEventListener('mousemove',  this._onMove);
    c.removeEventListener('mouseup',    this._onUp);
    c.removeEventListener('mouseleave', this._onUp);
    c.removeEventListener('wheel',      this._onWheel);
    c.removeEventListener('touchstart', this._onTouchstart);
    c.removeEventListener('touchmove',  this._onTouchmove);
    c.removeEventListener('touchend',   this._onUp);
    this.nozzles.forEach(n => n.dispose?.());
    this.waterSys?.dispose?.();
    this.spraySys?.dispose?.();
    this.foamSys?.dispose?.();
    this.flameSys?.dispose?.();
    this._disposePostFX();
    this._reflection?.dispose?.();
    this._reflection = null;
    this._depthProbe?.dispose?.();
    this._depthProbe = null;
    this._disposeGPUFields();
    this._cones?.dispose?.();
    this._cones = null;
    this._sky?.dispose?.();
    this._sky = null;
    if (this._particleTex) {
      Object.values(this._particleTex).forEach(t => t?.dispose?.());
      this._particleTex = null;
    }
    if (this._groundTex) {
      Object.values(this._groundTex).forEach(maps => disposeStoneMaps(maps));
      this._groundTex = undefined;
    }
    this._wetTex?.dispose?.();
    this._heatTex?.dispose?.();
    this._wetMat?.dispose?.();
    this._wetOverlay?.geometry?.dispose?.();
    this._envRT?.dispose?.();
    this._envRT = null;
    this.renderer?.dispose();
  }
}
