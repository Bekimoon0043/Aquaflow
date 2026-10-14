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
// Basin / water-surface / site-surface construction lives in sceneBasin.js.
import { buildPool, disposeSiteSurfaces, buildSiteSurfaces, buildWaterSurface, setCadUnderlay } from "./sceneBasin";
// Environment lights, shadows, sky, underwater + engineering lights: sceneLighting.js.
import {
  envIntensityFor, buildSky, refitShadows, fitShadowCamera, applyEnvironment,
  buildUnderwaterLights, setEngineeringLights, colorFromSignalColor,
  applyRuntimeLighting, setLightColor,
} from "./sceneLighting";
// Photorealistic Rendering Engine (AQ-S3-004) — single source of truth for the
// environment presets and gravity used by the water physics below.
import { ENVIRONMENTS as RE_ENVIRONMENTS, GRAVITY as RE_GRAVITY, threeToneMapping, calibratedExposure, getToneMapping } from "../../rendering";
// VR Walkthrough Engine (AQ-S3-006) — WebXR session config + guided-tour sequencing.
import {
  isVRSupported as WT_isVRSupported, vrSessionOptions as WT_vrSessionOptions,
  vrReferenceSpaceType as WT_vrReferenceSpaceType, DEFAULT_TOUR as WT_DEFAULT_TOUR,
  buildTour as WT_buildTour, tourStepAt as WT_tourStepAt,
} from "../../walkthrough";
// 4K Video Export Engine (AQ-S3-007) — export config + A/V sync.
import { buildExportConfig as VE_buildExportConfig, combineStreams as VE_combineStreams } from "../../video/videoExport";
import { frameShowTime as VB_frameShowTime, frameTimestamp as VB_frameTimestamp, prerollShowTime as VB_prerollShowTime } from "../../video/bakedTimeline";
// AQ-S3-010 — the cinematic post chain (bloom, AO, grade, SMAA) and the AF-3D-008
// half-res spray composite live in scenePost.js.
// AQ-S2-002 Phase 2 — solver-driven jet physics (pure, unit-tested, single definition).
import { launchSpeed as JP_launchSpeed, jetHeightFor as JP_jetHeightFor, normalizePhysics as JP_normalizePhysics, engineeringGate as JP_engineeringGate } from "./jetPhysics";
// AQ-S3-012 — a real mirror image in the pool, and a record of where the water lands.
import { WaterReflectionProbe } from "./waterReflection";
import { SplashMap, insidePool as SM_insidePool, litresPerImpact as SM_litresPerImpact } from "./splashMap";
import { WaterHeightField } from "./waterHeightField";
// AF-3D Phase R1 (realism plan) — the night-look upgrades:
//   billboard particles (velocity-stretched quads + soft depth fade), procedural
//   sprite textures, an opaque-scene depth probe, a sky dome with starfield that
//   doubles as the IBL source, and volumetric beam cones for the RGB fixtures.
import { buildBillboardGeometry, buildBillboardMaterial } from "./particlesBillboard";
import { makeDropletTexture, makeMistTexture, makeFoamTexture, makeFlameTexture } from "./particleTextures";
// (sky dome construction moved to sceneLighting.js)
import { LightConeSet } from "./lightCones";
// AF-3D-012 (pulled forward from Phase R4) — procedural stone/tile PBR maps for the
// hard surfaces; the flat single-colour deck was the loudest remaining CGI cue.
import { createStoneMaps, cloneStoneMaps, disposeStoneMaps } from "./groundTextures";
// AF-3D-006/007 (Phase R2) — GPU particle simulation. State lives in float textures
// and is advanced by shaders, lifting the count an order of magnitude above what the
// CPU field can carry. The CPU field stays as the low-tier fallback AND as the
// invisible statistical sample that keeps the splash/containment analysis honest.
import { GPUParticleField, gpuParticlesSupported } from "./particlesGPU";
import { describeNozzleEmitters, allocatePool, EMIT_CLASS, spawnDesignNozzle } from "./nozzleEmitters";
// AF-3D-014 (Phase R4) — real nozzle and luminaire bodies, drawn instanced.
import { FixtureInstances, LightMarkerInstances, fixtureKindFor } from "./fixtureModels";
import { buildVenue, disposeVenue } from "./venueModels";
import { ModelLayer } from "./modelLibrary";
import { QUALITY_CONFIG, CPU_SAMPLE_FRACTION } from "./sceneQuality";
import {
  buildEnvironmentIBL, buildPostFX, setPostFX, disposePostFX,
  configureHalfResSpray, renderHalfResSpray, restoreVisibility, halfResSprayObjects,
} from "./scenePost";
import { FixtureLightField, bindFieldLightUniforms } from "./fixtureLightField";
import {
  CORE_VERT, CORE_FRAG, GLOW_VERT, GLOW_FRAG,
  FOG_VERT, FOG_FRAG, LASER_VERT, LASER_FRAG, MAX_RIPPLES,
} from "./sceneShaders";

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

// AF-3D-022: fixture lights live in a clustered light TEXTURE (fixtureLightField.js),
// so the old 16-light uniform cap is gone. Volumetric beam cones stay a per-mesh
// effect and are drawn for the brightest MAX_BEAM_CONES fixtures only.
const MAX_BEAM_CONES = 16;
// Emitter slots in the GPU field's parameter texture. A nozzle contributes one or
// two (a jet plus its atomised shell), so this carries a large design comfortably.
const MAX_GPU_EMITTERS = 96;
// MAX_RIPPLES (the pool-surface impact ring buffer) lives with the water shader.
// QUALITY_CONFIG (per-tier feature table) and CPU_SAMPLE_FRACTION live in sceneQuality.js.

/** The `n` most intense fixtures — beam cones are per-mesh, so only these get one. */
function brightestLights(lights, n) {
  if (!Array.isArray(lights) || lights.length <= n) return lights || [];
  return [...lights].sort((a, b) => (b.intensity || 0) - (a.intensity || 0)).slice(0, n);
}

function seededNoise(i, salt = 0) {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

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
export class NozzleV2 {
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

  // The visible body is now an instanced fixture model owned by the scene
  // (fixtureModels.js), not a per-nozzle mesh — see FixtureInstances. Nothing is
  // built here any more; `dot` stays null so the dispose path remains valid.
  _buildMarker() {
    this.dot = null;
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
    // This is the visible, aerated stream rather than the nozzle bore. A
    // literal DN25 cylinder vanishes at the normal overview camera distance.
    const radius = (type === 'laminar') ? 0.042
                 : (type === 'jet_1d')  ? 0.034
                 : (type === 'jet_2d')  ? 0.040
                 : (type === 'geyser')  ? 0.135
                                        : 0.072;
    const segments = 10;
    const heightDivs = 40;
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
      uHorizontalSpeed: { value: new T.Vector2(0, 0) },
      uVerticalSpeed: { value: 1 },
      uWaterColor:   { value: new T.Color(0x88ccff) },
      uGlobalLight:  sharedLightUniforms.uGlobalLight,
      uGlobalLightI: sharedLightUniforms.uGlobalLightI,
      ...sharedLightUniforms.field,
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

  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)) * JP_engineeringGate(this.physics); }

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
                          this._overDemandSink, this.config); // config.designHeightM = 100 % apex
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
    const yaw = (cfg.rotationY || 0) * Math.PI / 180;
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
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
      // The core ends before the spray's apex, where a pressurised stream breaks
      // into droplets. Use the same solved/fallback launch speed as the emitters.
      const fallback = this._coreSpeedFor(type, ix);
      const speed = this._launchSpeed(ix, fallback);
      const tiltX = (cfg.tiltX || 0) * Math.PI / 180;
      const tiltZ = (cfg.tiltZ || 0) * Math.PI / 180;
      const verticalSpeed = Math.max(0.1, speed * Math.cos(tiltX) * Math.cos(tiltZ));
      uns.uVerticalSpeed.value = verticalSpeed;
      const localX = speed * Math.sin(tiltX), localZ = speed * Math.sin(tiltZ);
      uns.uHorizontalSpeed.value.set(
        localX * cosYaw + localZ * sinYaw,
        -localX * sinYaw + localZ * cosYaw,
      );
      const apex = JP_jetHeightFor(verticalSpeed);
      uns.uHeight.value = Math.max(0.05, apex * 0.92);
      if (tintColor) uns.uWaterColor.value.copy(tintColor).multiplyScalar(0.6).add(new this.T.Color(0.3,0.5,0.8));
    }
    if (this.glow) {
      const uns = this.glow.material.uniforms;
      uns.uTime.value = elapsed;
      uns.uIntensity.value = ix * 0.55;
      uns.uOrigin.value.set(ox, 0.1, oz);
      // Light scatters most visibly where the jet meets the water. A full-height
      // billboard made every stream look like a rectangular blue beam.
      uns.uHeight.value = 0.9 + ix * (type === 'geyser' ? 1.2 : 0.65);
      uns.uRadius.value = this._glowRadiusFor(type, ix) * 0.8;
      if (tintColor) uns.uColor.value.copy(tintColor);
    }

    if (ix < 0.015 || spawnDesignNozzle(this, delta, elapsed, wind, wc)) return; // design height → nozzleEmitters

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
        if (ix > 0.4) this._spawnApexMist(ox, this._launchSpeed(ix, 4.5+ix*5.5)**2/(2*9.81), oz, ix, 0.14);
        break;
      }

      case 'jet_2d': {
        const spawnN = Math.floor(delta * 320 * ix);
        const tiltX = (cfg.tiltX||0)*Math.PI/180;
        const tiltZ = (cfg.tiltZ||0)*Math.PI/180;
        for (let s=0; s<spawnN; s++) {
          const speed = this._launchSpeed(ix, 5.5 + ix*7.0);
          const vy = Math.cos(tiltX)*Math.cos(tiltZ)*speed;
          const localX = Math.sin(tiltX)*speed, localZ = Math.sin(tiltZ)*speed;
          const vx = localX*cosYaw + localZ*sinYaw + (Math.random()-0.5)*0.06 + wind.x*0.1;
          const vz = -localX*sinYaw + localZ*cosYaw + (Math.random()-0.5)*0.06 + wind.z*0.1;
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
          const localX = Math.sin(tiltX)*speed, localZ = Math.sin(tiltZ)*speed;
          const vx = localX*cosYaw + localZ*sinYaw + (Math.random()-0.5)*spread + wind.x*0.12;
          const vz = -localX*sinYaw + localZ*cosYaw + (Math.random()-0.5)*spread + wind.z*0.12;
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
        const speed2 = this._launchSpeed(ix, 6.5 + ix*8.5); // mist at the jet's real apex
        this._spawnApexMist(ox, speed2*speed2/(2*9.81), oz, ix, 0.36);
        break;
      }

       case 'geyser': {
        const spawnN = Math.floor(delta * 380 * ix);
        for (let s=0; s<spawnN; s++) {
          const coreSpd = this._launchSpeed(ix, 8.0 + ix*7.0);
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
          const localX = Math.sin(tiltX), localZ = Math.sin(tiltZ);
          const beamVx = localX*cosYaw + localZ*sinYaw;
          const beamVy = Math.cos(tiltX) * Math.cos(tiltZ);
          const beamVz = -localX*sinYaw + localZ*cosYaw;
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
        const tiltX = (cfg.motionOverride ? cfg.motionOverride.pan : (cfg.tiltX || 0) + animPhase * 30) * Math.PI / 180;
        const spawnN = Math.floor(delta * 380 * ix);
        for (let s = 0; s < spawnN; s++) {
          const speed = this._launchSpeed(ix, 5.5 + ix * 7.0);
          const vy = Math.cos(tiltX) * speed;
          const localX = Math.sin(tiltX) * speed;
          const vx = localX*cosYaw + (Math.random()-0.5)*0.1 + wind.x*0.1;
          const vz = -localX*sinYaw + (Math.random()-0.5)*0.1 + wind.z*0.1;
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
        const tiltX = (cfg.motionOverride ? cfg.motionOverride.pan : (cfg.tiltX || 0) + animX * 25) * Math.PI / 180;
        const tiltZ = (cfg.motionOverride ? cfg.motionOverride.tilt : (cfg.tiltZ || 0) + animZ * 25) * Math.PI / 180;
        const spawnN = Math.floor(delta * 400 * ix);
        for (let s = 0; s < spawnN; s++) {
          const speed = this._launchSpeed(ix, 5.5 + ix * 7.0);
          const vy = Math.cos(tiltX) * Math.cos(tiltZ) * speed;
          const localX = Math.sin(tiltX) * speed, localZ = Math.sin(tiltZ) * speed;
          const vx = localX*cosYaw + localZ*sinYaw + (Math.random()-0.5)*0.12 + wind.x*0.1;
          const vz = -localX*sinYaw + localZ*cosYaw + (Math.random()-0.5)*0.12 + wind.z*0.1;
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
        const tiltX = (cfg.motionOverride ? cfg.motionOverride.pan : (cfg.tiltX || 0) + animX * 35) * Math.PI / 180;
        const tiltZ = (cfg.motionOverride ? cfg.motionOverride.tilt : (cfg.tiltZ || 0) + animZ * 35) * Math.PI / 180;
        const spawnN = Math.floor(delta * 420 * ix);

        for (let s = 0; s < spawnN; s++) {
          const speed = 6.0 + ix * 7.5 + animY * 2.0;
          const vy = Math.cos(tiltX) * Math.cos(tiltZ) * speed;
          const localX = Math.sin(tiltX) * speed, localZ = Math.sin(tiltZ) * speed;
          const vx = localX*cosYaw + localZ*sinYaw + (Math.random() - 0.5) * 0.15 + wind.x * 0.12;
          const vz = -localX*sinYaw + localZ*cosYaw + (Math.random() - 0.5) * 0.15 + wind.z * 0.12;
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
    if (ix > 0.25 && Math.random() < ix*delta*18) {
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

  _coreSpeedFor(type, ix) {
    switch (type) {
      case 'jet_1d': return 4.5 + ix * 5.5;
      case 'jet_2d': return 5.5 + ix * 7.0;
      case 'geyser': return 8.0 + ix * 7.0;
      case 'laminar': return 6.5 + ix * 7.5;
      case 'motion_3d': return 6.0 + ix * 7.5;
      case 'jet_3d': return 6.5 + ix * 8.5;
      default: return 5.5 + ix * 7.0;
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
    this._siteSurfaces = options.siteSurfaces || [];
    this.wind         = options.wind         || { x:0, z:0 };
    this.toneMapping  = getToneMapping(options.toneMapping).id;   // AF-3D-024
    this._halfResUser = !!options.halfResSpray;                   // AF-3D-008 (medium)

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
    this.renderer.toneMapping       = threeToneMapping(T, this.toneMapping);
    this._setBaseExposure(2.1 * q.exposure);
    this.renderer.xr.enabled = true;   // VR Walkthrough (AQ-S3-006)

    this.scene  = new T.Scene();
    this.camera = new T.PerspectiveCamera(50, W/H, 0.1, 500);
    this.clock  = new T.Clock();
    this._pr    = PR;

    // Shared RGB light-field uniforms (single source of truth — everything reads from this)
    this._lightField = {
      uGlobalLight:  { value: new T.Color(0,0,0) },
      uGlobalLightI: { value: 0.0 },
      field:         null,   // FixtureLightField uniforms (AF-3D-022), set just below
    };

    this._fieldLights = new FixtureLightField(T);
    this._lightField.field = this._fieldLights.uniforms;

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
      bindFieldLightUniforms(ps.uniforms, this._fieldLights);
    });

    this._buildFogSystem();
    this.scene.add(this.waterSys.mesh, this.spraySys.mesh, this.foamSys.mesh, this.flameSys.mesh);

    // AF-3D-001: opaque-scene depth probe for soft particles + beam cones. An
    // enhancement, never a dependency — on failure the sprites keep hard edges.
    // Built by configureHalfResSpray: full-res while the AF-3D-008 half-res spray
    // pass needs it as the upsample reference, `softScale` otherwise.
    this._depthProbe = null;
    configureHalfResSpray(this);

    // AF-3D-007: GPU particle fields. When they are carrying the water, the CPU
    // fields keep simulating as an invisible physics sample (see CPU_SAMPLE_FRACTION)
    // so the splash map and its calibrated containment figures stay intact.
    this._gpuWater = null;
    this._gpuSpray = null;
    if (q.gpuParticles && gpuParticlesSupported(T, this.renderer)) {
      try {
        const shared = { maxEmitters: MAX_GPU_EMITTERS };
        this._gpuWater = new GPUParticleField(T, this.renderer, {
          ...shared, count: q.gpuWater, map: this._particleTex.droplet,
          gravity: -9.5, drag: 0.018, turbulence: 0.35,
          sizeScale: 0.44, alpha: 0.14,
        });
        this._gpuSpray = new GPUParticleField(T, this.renderer, {
          ...shared, count: q.gpuSpray, map: this._particleTex.mist,
          gravity: -7.0, drag: 0.024, turbulence: 0.55,
          sizeScale: 0.58, alpha: 0.11,
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
          bindFieldLightUniforms(f.uniforms, this._fieldLights);
        });
      } catch (err) {
        console.warn("[FountainScene] GPU particles unavailable:", err?.message || err);
        this._disposeGPUFields();
      }
    }

    // AF-3D-005: volumetric beam cones for the RGB fixture lights.
    this._cones = null;
    if (q.cones) {
      this._cones = new LightConeSet(T, MAX_BEAM_CONES);
      this.scene.add(this._cones.group);
    }
    this._bindSoftDepth();

    // AQ-S3-012 — the mirror image and the landing record. Both must exist before the
    // water surface is built, because its material binds their texture and matrix.
    this._buildReflection();
    this._buildSplashMap();

    this._buildEnvironment();
    this._buildPool();
    this._buildSiteSurfaces();
    this._buildVenueElements();
    this._modelLayer = new ModelLayer(this.THREE, this.scene);
    this._buildWaterSurface();
    this._buildUnderwaterLights();
    this._buildLasers();
    this._fixtureInstances = new FixtureInstances(this.THREE);
    this.scene.add(this._fixtureInstances.group);
    // AF-3D-019: every engineering light is an instance (body + lens), not a mesh.
    this._lightMarkers = new LightMarkerInstances(this.THREE);
    this.scene.add(this._lightMarkers.group);
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

    // Water Realism V2: a coupled heightfield fed by the same physical landing
    // events as containment. It is intentionally quality-scaled and uploaded as a
    // universally supported RGBA texture; weak GPUs keep the existing ring path.
    const heightRes = this.quality === "high" || this.quality === "ultra" ? 96 : this.quality === "medium" ? 72 : 48;
    this._heightField = new WaterHeightField({ extent, resolution: heightRes });
    this._heightBytes = new Uint8Array(heightRes * heightRes * 4);
    this._heightField.writeRGBA(this._heightBytes);
    this._heightTex = new T.DataTexture(this._heightBytes, heightRes, heightRes, T.RGBAFormat);
    this._heightTex.minFilter = T.LinearFilter;
    this._heightTex.magFilter = T.LinearFilter;
    this._heightTex.wrapS = this._heightTex.wrapT = T.ClampToEdgeWrapping;
    this._heightTex.needsUpdate = true;
    this._heightUploadT = 0;

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

    // Impact ripples: the ring buffer of recent in-basin landings (AF-3D-010).
    this._ripples = Array.from({ length: MAX_RIPPLES }, () => ({ x: 0, z: 0, age: 1e3, str: 0 }));
    this._rippleNext = 0;
    this._rippleCooldown = 0;

    // Give the particle systems somewhere to report their impacts.
    const sink = (x, z, amount, inside) => {
      this._splash?.deposit(x, z, amount, inside);
      // Seed a ripple from a real landing. Rate-limited: thousands of droplets land
      // each second and spawning a ring per droplet would leave the surface a
      // featureless boil rather than the readable rings a viewer expects.
      if (inside && this._rippleCooldown <= 0) {
        this._rippleCooldown = 0.11;
        this._heightField?.disturb(x, z,
          Math.min(0.075, 0.028 + amount * 0.008) * (this._waveResponse ?? 1), 0.34);
        const r = this._ripples[this._rippleNext];
        this._rippleNext = (this._rippleNext + 1) % MAX_RIPPLES;
        r.x = x; r.z = z; r.age = 0; r.str = 1;
      }
    };
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
    b.mask = null;
    if (this._poolType === "circular") {
      b.type = "circular";
      b.radius = this._poolRadius || 6;
    } else if (this._poolType === "freeform" && this._basinMask) {
      // AF-3D-017: the polygon itself, not its bounding rectangle.
      b.type = "polygon";
      b.mask = this._basinMask;
      b.width = this._poolW || 12;
      b.length = this._poolL || 8;
    } else {
      b.type = "rect";
      b.width = this._poolW || 12;
      b.length = this._poolL || 8;
    }
    return b;
  }

  /** Age the impact ripples and push them to the water shader. */
  _updateRipples(delta) {
    if (!this._ripples || !this.waterMat?.uniforms?.uRipples) return;
    this._rippleCooldown -= delta;
    if (this._heightField) {
      this._heightField.advance(delta);
      this._heightUploadT += delta;
      if (this._heightUploadT >= 1 / 30) {
        this._heightUploadT = 0;
        this._heightField.writeRGBA(this._heightBytes);
        this._heightTex.needsUpdate = true;
      }
    }
    const u = this.waterMat.uniforms;
    let n = 0;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = this._ripples[i];
      r.age += delta;
      // Past ~3.5 s the exp(-age) envelope has taken the ring below visibility;
      // dropping it there keeps the shader's loop short.
      if (r.str <= 0 || r.age > 3.5) continue;
      u.uRipples.value[n].set(r.x, r.z, r.age, r.str);
      n++;
    }
    u.uRippleCount.value = n;
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
    if (editor) this.syncModelGraph(editor.graph);
    return this._editor;
  }

  _syncHeightFieldPool() {
    if (!this._heightField) return;
    const pool = this._poolBoundsForSplash();
    const span = pool.type === "circular"
      ? (pool.radius || 6) * 2
      : Math.max(pool.width || 12, pool.length || 8);
    // Leave deck space around the water while preserving detail for ordinary pools.
    this._heightField.setExtent(Math.max(16, span * 1.22));
    this._heightField.setPool(pool);
    this._heightField.reset();
    if (this._heightTex && this._heightBytes) {
      this._heightField.writeRGBA(this._heightBytes);
      this._heightTex.needsUpdate = true;
    }
  }

  syncModelGraph(graph) { return this._modelLayer?.syncGraph(graph); }

  pickableModels() {
    return [
      ...(this._modelLayer?.root.children || []),
      ...(this._fixtureInstances?.group.children || []),
      ...(this._engLightMeshes || []),
      ...(this._lightMarkers?.bodies.group.children || []),
    ];
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

  _buildEnvironmentIBL() { return buildEnvironmentIBL(this); }

  _buildPostFX() { return buildPostFX(this); }

  setPostFX(opts) { return setPostFX(this, opts); }

  _disposePostFX() { return disposePostFX(this); }

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
    // AF-3D-008: spray drawn into the half-res target sees half-res gl_FragCoord.
    if (this._halfRes) {
      const lr = this._halfRes.lowRes;
      halfResSprayObjects(this).forEach(ps => ps.setSoftDepth(this._depthProbe.texture, 1 / lr.x, 1 / lr.y, near, far));
      this._halfRes.setDepth(this._depthProbe.texture);
    }
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
      this._laserGroup, this._cones?.group, this._sky?.group, this._editor?.root, this._cadUnderlay?.group,
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
        [this.waterSurface, this._wetOverlay, this._reviewGroup, this._editor?.root, this._cadUnderlay?.group]
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
      if (this._gradePass) this._gradePass.uniforms.uTime.value = this._baking ? this._bakeElapsed : (this.clock?.elapsedTime || 0);
      const halfRes = renderHalfResSpray(this);   // AF-3D-008
      this.composer.render();
      restoreVisibility(halfRes);
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
        //
        // Wall tiling is per SHAPE and deliberately near-isotropic. The circular wall
        // is an open cylinder: many repeats around its circumference, one up its
        // 0.45 m band. The rectangular wall is a solid Box whose top face is a large
        // quad — and a box face's UVs are 0..1 regardless of its size, so a strongly
        // anisotropic repeat there smears the stone into parallel bands across the
        // whole pool interior. That is exactly what an earlier 16 x 0.4 did: it read
        // as striping on the water and survived every attempt to blame the water,
        // the basin floor, shadows or post-processing, because it was none of them.
        wallCyl: cloneStoneMaps(deck, 18, 1),
        wallBox: cloneStoneMaps(deck, 5, 5),
        stage:  cloneStoneMaps(deck, 6, 6),
        coping: createStoneMaps(T, { kind: "coping", repeat: 10 }),
        basin:  createStoneMaps(T, { kind: "basin", repeat: 2 }),
      } : null;
    } catch (e) {
      this._groundTex = null;   // textures are an enhancement, never fatal
    }
    return this._groundTex;
  }

  _buildPool() { return buildPool(this); }

  _disposeSiteSurfaces() { return disposeSiteSurfaces(this); }

  _buildSiteSurfaces() { return buildSiteSurfaces(this); }

  _buildWaterSurface() { return buildWaterSurface(this); }

  _setWaterPalette() {
    const u = this.waterMat?.uniforms;
    if (!u) return;
    const day = this.environment === ENVIRONMENTS.DAY;
    u.uDeepColor.value.set(day ? 0x18506a : 0x010c1c);
    u.uShallowColor.value.set(day ? 0x5294aa : 0x0c3558);
    u.uSkyColor.value.set(day ? 0x6ab4d8 : this.environment === ENVIRONMENTS.DUSK ? 0x180820 : 0x030810);
  }

  _buildUnderwaterLights() { return buildUnderwaterLights(this); }

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

  _buildEnvironment() { this._applyEnvironment(); }
  _buildVenueElements() {
    if (this._venueGroup) disposeVenue(this._venueGroup);
    this._venueGroup = buildVenue(this.THREE, {
      poolType: this._poolType, radius: this._poolRadius, points: this._poolPoints,
      width: this._poolW, length: this._poolL, extraBasins: this._extraBasins,
      quality: this.quality, environment: this.environment,
    });
    this.scene.add(this._venueGroup);
  }
  _envIntensityFor(env) { return envIntensityFor(this, env); }

  _buildSky() { return buildSky(this); }

  _refitShadows() { return refitShadows(this); }

  _fitShadowCamera(light, mapSize = 2048) { return fitShadowCamera(this, light, mapSize); }

  _applyEnvironment() { return applyEnvironment(this); }

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

    const fixtureBodies = [];
    layout.forEach(cfg => {
      // Normalize: ensure type exists
      const finalCfg = {
        id: cfg.id || `n-${Math.random().toString(36).slice(2,8)}`,
        type: cfg.type || NOZZLE_TYPES.JET_3D,
        x: cfg.x ?? 0,
        z: cfg.z ?? 0,
        tiltX: cfg.tiltX ?? 0,
        tiltZ: cfg.tiltZ ?? 0,
	rotationY: cfg.rotationY ?? 0,
	groupId: cfg.groupId || null,
        engineering: cfg.engineering || null,
      };
      const nz = new NozzleV2(this.THREE, this.waterSys, this.spraySys, this.foamSys, this.flameSys, finalCfg, this._lightField);
      if (nz.dot) this.scene.add(nz.dot);
      if (nz.core) this.scene.add(nz.core);
      if (nz.glow) this.scene.add(nz.glow);
      this.nozzles.push(nz);
      fixtureBodies.push({
        id: finalCfg.id,
        kind: fixtureKindFor(finalCfg.type),
        x: finalCfg.x, y: 0, z: finalCfg.z,
        rotationX: finalCfg.tiltX,
        rotationY: finalCfg.rotationY,
        rotationZ: finalCfg.tiltZ,
      });
    });
    this._fixtureInstances?.setFixtures(fixtureBodies);

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
	rotationY: c.rotationY || 0,
	groupId: c.groupId || null,
        engineering: c.engineering || null,
        designHeightM: c.designHeightM ?? null, // 100 % apex (jetPhysics.launchSpeed)
      }));
    }
    if (this._initialized) this._buildNozzles();
  }

  setEngineeringLights(lightConfigs) { return setEngineeringLights(this, lightConfigs); }

  _uploadLightField() {
    // AF-3D-022: every fixture goes into the light texture; the cluster grid is only
    // rebuilt when a fixture moves.
    this._fieldLights?.setLights(Array.isArray(this._engLights) ? this._engLights : []);
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
    const individualLights = !!I.fixtureLightStates;

    const runtimeColor = this._colorFromSignalColor(
      I.lightingColor,
      this.lightColor || "#ffffff"
    );

    this._runtimeLightColor = runtimeColor;

    // Stronger visible global tint for water, spray, pool and glow.
    this._lightField.uGlobalLight.value.copy(runtimeColor);
    this._lightField.uGlobalLightI.value = individualLights ? 0.12 : lightI * 0.7;
    // Keep the pool surface shader synchronized with runtime RGB.
    if (this.waterMat?.uniforms) {
      this.waterMat.uniforms.uLightColor.value.copy(runtimeColor);
      this.waterMat.uniforms.uLightIntensity.value = individualLights ? 0.16 : 0.16 + lightI * 0.42;
    }

    // Full-show previews set each engineering light independently by fixture ID.
    if (I.fixtureLightStates && this._engLights?.length) {
      this._engLights.forEach((L, index) => {
        const state = I.fixtureLightStates[L.id];
        const level = Math.max(0, Math.min(1, Number(state?.intensity) || 0));
        L.color.copy(this._colorFromSignalColor(state?.color, "#ffffff"));
        L.intensity = L.baseIntensity * level;
        L.radius = L.baseRadius;
        this._lightMarkers?.setLevel(index, L.color, 0.08 + level * 0.84);
      });
    } else if (this._engLights?.length) {
      for (const L of this._engLights) {
        if (L?.color) L.color.copy(runtimeColor);
        L.intensity = L.baseIntensity * lightI;
	L.radius = L.baseRadius;
      }

      for (let i = 0; i < this._engLights.length; i++) this._lightMarkers?.setLevel(i, runtimeColor);
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
      nz.config.motionOverride = I.fixtureMotion?.[nz.config.id] || null;
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

      // Jet height comes from config.designHeightM via _launchSpeed — no intensity re-scaling here.
      const floor = (IDLE[t] || 0.02) * breath * Math.max(0, 1.0 - live*5.0);
      const finalI = this._nozzleOutputIntensity(nz, live, floor);
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
    this._updateRipples(delta);

    // ─── Sky + volumetric beam cones (AF-3D R1) ────────────────────────
    this._sky?.update(elapsed);
    if (this._cones) {
      // A beam is only visible where there is spray to scatter it.
      const activity = Math.max(I.pump || 0, I.valve || 0, (I.fog || 0) * 0.6);
      this._cones.update(brightestLights(this._engLights, MAX_BEAM_CONES), elapsed, activity, this.camera);
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
      this.waterMat.uniforms.uLightIntensity.value = individualLights ? 0.16 : 0.16 + lightI * 0.42;
      this.waterMat.uniforms.uCameraPos.value.copy(this.camera.position);
    }

    // ─── Underwater point lights tinted to global light ────────────────
    const pulseI = lightI * breath;
    const lcol = this._lightField.uGlobalLight.value;
    this.uwLights.forEach((ul,i) => {
      ul.intensity = individualLights ? 0.12
        : 0.12 + pulseI * 1.5 * (Math.sin(elapsed*1.3 + i*0.75)*0.18 + 0.82);
      ul.color.lerp(lcol, 0.04);
    });
    if (this.centerLight) {
      this.centerLight.intensity = individualLights ? 0.16
        : 0.16 + pulseI * 1.8 * (Math.sin(elapsed*0.85)*0.18 + 0.82);
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

  // ── Performance counters (AF-3D-013) ────────────────────────────────────────
  /**
   * Rolling frame statistics. A preview whose realism is tuned against frame budget
   * needs the budget to be VISIBLE — otherwise every judgement about whether a tier
   * is affordable is guesswork. Measured over a one-second window rather than from
   * the instantaneous delta, which is far too noisy to read.
   */
  _tickPerf(delta) {
    const p = this._perf || (this._perf = {
      fps: 0, ms: 0, frames: 0, accum: 0, worstMs: 0, _worst: 0,
    });
    p.frames++;
    p.accum += delta;
    const ms = delta * 1000;
    if (ms > p._worst) p._worst = ms;
    if (p.accum >= 1.0) {
      p.fps = p.frames / p.accum;
      p.ms = (p.accum / p.frames) * 1000;
      p.worstMs = p._worst;
      p.frames = 0; p.accum = 0; p._worst = 0;
    }
  }

  /**
   * What the renderer is actually doing this frame — frame rate, the work behind it,
   * and which realism features the active tier switched on.
   */
  getPerfStats() {
    const p = this._perf || { fps: 0, ms: 0, worstMs: 0 };
    const info = this.renderer?.info;
    const q = QUALITY_CONFIG[this.quality] || QUALITY_CONFIG.medium;
    const gpuCount = (this._gpuWater?.count || 0) + (this._gpuSpray?.count || 0);
    const cpuCount = (this.waterSys?.active || 0) + (this.spraySys?.active || 0)
                   + (this.foamSys?.active || 0) + (this.flameSys?.active || 0);
    return {
      fps: Math.round(p.fps),
      ms: Number(p.ms.toFixed(2)),
      worstMs: Number(p.worstMs.toFixed(2)),
      quality: this.quality,
      backend: gpuCount ? "GPU" : "CPU",
      particles: gpuCount || cpuCount,
      gpuParticles: gpuCount,
      // The CPU field is an invisible physics sample once the GPU has the water.
      cpuParticles: cpuCount,
      drawCalls: info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0,
      programs: info?.programs?.length ?? 0,
      features: {
        softParticles: !!this._depthProbe,
        lightCones: !!this._cones,
        reflection: !!this._reflection,
        postfx: !!this._postEnabled,
        shadows: !!this.renderer?.shadowMap?.enabled,
        ao: !!this._aoPass,
        ibl: this._iblKind || null,
        pixelRatio: this._pr || 1,
        reflectRes: q.reflect || 0,
        toneMapping: this.toneMapping,
        halfResSpray: !!this._halfRes,
      },
    };
  }

  _animate() {
    if (!this._initialized) return;
    this._rafId = requestAnimationFrame(() => this._animate());
    // A baked render owns the simulation and the canvas; the live loop stands down
    // so wall-clock time can never leak into the exported frames.
    if (this._baking) { this.clock.getDelta(); return; }
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime || 0;
    this._tickPerf(delta);
    // A frame is many passes — depth probe, reflection, then the composer chain — and
    // three.js clears its counters on every render() call. Left on auto, the HUD would
    // only ever report the final pass (one draw), which is worse than no number at all.
    // Reset once per frame instead, so the counters accumulate the whole frame's work.
    if (this.renderer.info.autoReset) this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this._update(delta, elapsed);
    this._updateCamera(delta);
    this._renderFrame();
  }

  /** Place the camera for this frame. Shared by the live loop and the baked render. */
  _updateCamera(delta) {
    const cam = this.camera;
    // In editor mode the editor owns the camera. Re-deriving it from orbitAngle every
    // frame here would undo every pan and orbit the designer just made.
    if (this._editorMode) {
      this._editor?.update?.();
      return;
    }
    const cinematic = [CAMERA_MODES.AERIAL, CAMERA_MODES.FLYTHROUGH, CAMERA_MODES.DRAMATIC, CAMERA_MODES.AUDIENCE];
    if (cinematic.includes(this.cameraMode)) {
      this._pathTime = (this._pathTime + delta*0.08) % 1;
      const cp = this._getCameraPath(this._pathTime, this.cameraMode);
      // Frame-rate independent easing (0.025 per 60 Hz frame), so a 24 fps bake moves
      // the camera exactly like the 60 Hz preview does.
      const k = 1 - Math.pow(1 - 0.025, Math.max(0, delta) * 60);
      if (cp) { cam.position.lerp(cp.pos, k); cam.lookAt(cp.look); }
    } else if (this.cameraMode === CAMERA_MODES.ORBIT) {
      if (this.orbitAuto) this.orbitAngle += delta*0.055;
      cam.position.set(Math.cos(this.orbitAngle)*this.orbitRadius, this.orbitHeight, Math.sin(this.orbitAngle)*this.orbitRadius);
      cam.lookAt(0, 3, 0);
    } else if (this.cameraMode === CAMERA_MODES.TOP) {
      cam.position.set(0, 25, 0.01); cam.lookAt(0,0,0);
    } else if (this.cameraMode === CAMERA_MODES.FRONT) {
      cam.position.set(0, 5, 17); cam.lookAt(0, 4, 0);
    } else if (this.cameraMode === "named" && this._namedView) {
      // AF-NEXT-002: a project-saved viewpoint (render.cameraViews), held fixed.
      const v = this._namedView;
      cam.position.set(v.position.x, v.position.y, v.position.z);
      cam.lookAt(v.target.x, v.target.y, v.target.z);
    }
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
  // ─── Baked (offline) video render - AF-3D-VID-001 ─────────────────────────
  /**
   * Render the show frame-by-frame on a VIRTUAL clock and hand each frame to an
   * encoder with an exact timestamp. Unlike startRecording() (which captures the
   * live canvas on wall-clock time and drops/duplicates frames whenever a frame
   * renders slower than real time), the output here is perfectly smooth at any
   * resolution: a 4K frame may take 200 ms to draw, it still lasts exactly 1/fps.
   *
   * @param {object} o
   * @param {object} o.plan           planBake() result (video/bakedTimeline.js)
   * @param {(t:number)=>object|null} o.sampleSignals  show state at show-time t
   * @param {{addFrame:(ts:number,dur:number)=>Promise<void>}} o.encoder
   * @param {(p:{frame:number,frames:number,phase:string})=>void} [o.onProgress]
   * @param {{aborted:boolean}} [o.abort]
   */
  async bakeVideo({ plan, sampleSignals, encoder, onProgress, abort, pixelRatio = 1 }) {
    if (!this._initialized) throw new Error("Scene not initialised");
    if (this._baking) throw new Error("A video render is already running");
    if (this._xrSession) throw new Error("Exit VR before rendering a video");
    const saved = {
      w: this.canvas.clientWidth || this.canvas.width,
      h: this.canvas.clientHeight || this.canvas.height,
      pr: this._pr || 1,
      overlays: [this._reviewGroup, this._editor?.root].filter(Boolean).map(object => [object, object.visible]),
      grain: this._gradePass?.uniforms?.uGrain?.value,
      reflectionInterval: this._reflection?.interval,
    };
    const setPR = (pr) => {
      this._pr = pr;
      this.renderer.setPixelRatio(pr);
      this.composer?.setPixelRatio?.(pr);
    };
    const apply = (t) => {
      const s = sampleSignals ? sampleSignals(t) : null;
      if (!s) return;
      this._bakeSignalWrite = true;
      try { this.setSignals(s); } finally { this._bakeSignalWrite = false; }
    };
    const yieldUI = () => new Promise((r) => setTimeout(r, 0));
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

    this._baking = true;
    this._bakeElapsed = this.clock.elapsedTime || 0;
    try {
      // Presentation exports must not contain selection gizmos or safety guides.
      saved.overlays.forEach(([object]) => { object.visible = false; });
      if (this._gradePass) this._gradePass.uniforms.uGrain.value = 0;
      if (this._reflection) this._reflection.interval = 1;
      // Drawing buffer == exact export size at pixel ratio 1, so the encoder gets
      // true 1080p/4K pixels rather than an upscaled preview.
      setPR(pixelRatio);   // 1, or >1 to supersample a Final (ultra) render (finalRender.js)
      this._bakeResizing = true;
      try { this.resize(plan.width, plan.height); } finally { this._bakeResizing = false; }

      // 1. Warm-up: the particle system needs a few seconds before the jets are in
      //    the air. Simulate (no rendering) the seconds leading into the start time.
      onProgress?.({ frame: 0, frames: plan.frames, phase: "warmup" });
      for (let k = 0; k < plan.prerollSteps; k++) {
        if (abort?.aborted) throw new DOMException("Render cancelled", "AbortError");
        apply(VB_prerollShowTime(plan, k));
        this._bakeElapsed += plan.prerollDt;
        this._update(plan.prerollDt, this._bakeElapsed);
        this._updateCamera(plan.prerollDt);
        if (k % 30 === 29) await yieldUI();
      }

      // 2. Frames: fixed physics sub-steps per frame, then one render + encode.
      const t0 = now();
      for (let i = 0; i < plan.frames; i++) {
        if (abort?.aborted) throw new DOMException("Render cancelled", "AbortError");
        const frameStart = VB_frameShowTime(plan, i) - plan.frameDuration;
        for (let s = 1; s <= plan.substeps; s++) {
          apply(Math.max(0, frameStart + s * plan.substepDt));
          this._bakeElapsed += plan.substepDt;
          this._update(plan.substepDt, this._bakeElapsed);
        }
        this._updateCamera(plan.frameDuration);
        if (this.renderer.info.autoReset) this.renderer.info.autoReset = false;
        this.renderer.info.reset();
        this._renderFrame();
        // Awaiting respects encoder back-pressure (bounded memory at 4K).
        await encoder.addFrame(VB_frameTimestamp(plan, i), plan.frameDuration);
        onProgress?.({ frame: i + 1, frames: plan.frames, phase: "render", elapsedMs: now() - t0 });
        if (i % 2 === 1) await yieldUI();
      }
    } finally {
      this._baking = false;
      saved.overlays.forEach(([object, visible]) => { object.visible = visible; });
      if (this._gradePass && saved.grain !== undefined) this._gradePass.uniforms.uGrain.value = saved.grain;
      if (this._reflection && saved.reflectionInterval !== undefined) this._reflection.interval = saved.reflectionInterval;
      setPR(saved.pr);
      const vp = this._bakeViewport || saved; this._bakeViewport = null;
      try { this.resize(vp.w, vp.h); } catch (e) { /* canvas gone */ }
      this.clock.getDelta();   // discard the wall time spent baking
    }
  }
  isBaking() { return !!this._baking; }

  /** Expose the last/target export config (for the UI). */
  getExportConfig(opts = {}) { return VE_buildExportConfig({ resolution: opts.resolution || "1080p", fps: opts.fps || 60, withAudio: !!opts.withAudio }); }
  _nozzleOutputIntensity(nozzle, fallback, floor) {
    const live = this._groupIntensityForNozzle(nozzle, fallback);
    // A simulated OFF must also suppress the renderer's decorative idle water.
    return this._signals?.fixtureIntensities ? live : live > 0.015 ? live : floor;
  }
    _groupIntensityForNozzle(nozzle, fallback = 0) {
    // Site simulation is authoritative by fixture ID, including explicit zeroes.
    // This prevents group averages or a decorative pattern activating other jets.
    const fixtureIntensities = this._signals?.fixtureIntensities;
    if (fixtureIntensities) {
      return Math.max(0, Math.min(1, Number(fixtureIntensities[nozzle?.config?.id]) || 0));
    }
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

  _colorFromSignalColor(value, fallback = "#ffffff") { return colorFromSignalColor(this, value, fallback); }

  _applyRuntimeLighting() { return applyRuntimeLighting(this); }
  setSignals(s) {
    if (!s) return;
    // During a baked render the show is sampled at exact virtual times by the bake
    // itself; live React updates (wall-clock playhead) must not interleave.
    if (this._baking && !this._bakeSignalWrite) return;

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
  setEnvironment(env){
    this.environment=env;
    if(this._initialized) { this._applyEnvironment(); this._setWaterPalette(); this._buildVenueElements(); }
  }
  setCameraMode(m)  { this.cameraMode=m; this._pathTime=0; if(m===CAMERA_MODES.ORBIT) this.orbitAuto=true; }
  /**
   * AF-NEXT-002: hold the camera on a saved project view ({position, target} in world
   * metres, see utils/cameraViews.js). Passing null clears it. In editor mode the
   * editor owns navigation, so the view is applied once and the editor takes over.
   */
  setNamedView(view) {
    this._namedView = view && view.position && view.target
      ? { position: { ...view.position }, target: { ...view.target } }
      : null;
    if (!this._namedView) return false;
    this.cameraMode = "named";
    this.orbitAuto = false;
    if (this._editorMode && this.camera) {
      const { position: p, target: t } = this._namedView;
      this.camera.position.set(p.x, p.y, p.z);
      this.camera.lookAt(t.x, t.y, t.z);
    }
    return true;
  }
  setReviewOverlays(visible) {
    this.reviewOverlays = visible !== false;
    if (this._reviewGroup) this._reviewGroup.visible = this.reviewOverlays;
  }
  fitCameraToDesign() {
    const r = this._poolType === "circular"
      ? (this._poolRadius || 6)
      : Math.max((this._poolW || 12) / 2, (this._poolL || 8) / 2);
    this.orbitRadius = Math.max(12, Math.min(38, r * 3.1));
    this.orbitHeight = Math.max(6, Math.min(20, r * 1.3));
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
      setLightColor(hex) { return setLightColor(this, hex); }
  setWind(x,z)      { this.wind={x:x||0, z:z||0}; }
  /** AF-3D-024: exposure presets are authored for ACES; other operators are recalibrated. */
  _setBaseExposure(acesExposure) {
    this._baseExposure = acesExposure;
    if (this.renderer) this.renderer.toneMappingExposure = calibratedExposure(this.toneMapping, acesExposure);
  }
  /** AF-3D-008: opt the medium tier into half-res spray (high is always on, low never). */
  setHalfResSpray(on) {
    this._halfResUser = !!on;
    return this.renderer ? configureHalfResSpray(this) : this._halfResUser;
  }
  setToneMapping(name) {
    this.toneMapping = getToneMapping(name).id;
    if (!this.renderer) return this.toneMapping;
    this.renderer.toneMapping = threeToneMapping(this.THREE, this.toneMapping);
    this._setBaseExposure(this._baseExposure ?? this.renderer.toneMappingExposure);
    return this.toneMapping;
  }
  setWaterSimulation({ response, damping, boundaryDamping } = {}) {
    const nextResponse = Number(response);
    if (Number.isFinite(nextResponse)) {
      this._waveResponse = Math.max(0, Math.min(2, nextResponse));
    } else if (!Number.isFinite(this._waveResponse)) {
      this._waveResponse = 1;
    }
    if (!this._heightField) return;
    if (Number.isFinite(damping)) this._heightField.damping = Math.max(0.9, Math.min(0.9999, damping));
    if (Number.isFinite(boundaryDamping)) {
      this._heightField.boundaryDamping = Math.max(0, Math.min(1, boundaryDamping));
    }
  }
  setPoolGeometry(geom) {
    const dimensionsChanged = JSON.stringify(this.poolGeometry) !== JSON.stringify(geom);
    this.poolGeometry = geom;
    if (this._initialized) {
      this._buildPool();
      this._buildVenueElements();
      this._buildWaterSurface();
      this._buildUnderwaterLights();
      this._buildLasers();
      this._buildNozzles();
      this._buildReviewOverlays();
      // A saved named view (AF-NEXT-002) is the designer's explicit choice; loading the
      // pool geometry must not silently replace it with the auto-fit orbit.
      if (dimensionsChanged && !(this.cameraMode === "named" && this._namedView)) this.fitCameraToDesign();
    }
  }
  /** AF-CAD-011: the locked CAD underlay ({ toWorld, centerKey } — see sceneBasin.js). */
  setCadUnderlay(underlay, opts) { return setCadUnderlay(this, underlay, opts); }
  setSiteSurfaces(surfaces) {
    this._siteSurfaces = Array.isArray(surfaces) ? surfaces : [];
    if (this._initialized) this._buildSiteSurfaces();
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
    // Layout observers keep firing while a bake owns the drawing buffer; remember the
    // latest viewport size and apply it when the bake restores the preview.
    if (this._baking && !this._bakeResizing) { this._bakeViewport = { w, h }; return; }
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
      this._halfRes?.setSize(w * pr, h * pr);
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
    this._halfRes?.dispose?.();
    this._halfRes = null;
    this._disposeGPUFields();
    this._cones?.dispose?.();
    this._cones = null;
    this._sky?.dispose?.();
    this._sky = null;
    if (this._venueGroup) { disposeVenue(this._venueGroup); this._venueGroup = null; }
    this._disposeSiteSurfaces();
    setCadUnderlay(this, null);
    this._modelLayer?.dispose?.();
    this._modelLayer = null;
    this._fixtureInstances?.dispose?.();
    this._fixtureInstances = null;
    this._lightMarkers?.dispose?.();
    this._lightMarkers = null;
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
    this._heightTex?.dispose?.();
    this._heightTex = null;
    this._heightField = null;
    this._basinMask?.dispose?.();
    this._basinMask = null;
    this._wetMat?.dispose?.();
    this._wetOverlay?.geometry?.dispose?.();
    this._envRT?.dispose?.();
    this._envRT = null;
    this._fieldLights?.dispose?.();
    this._fieldLights = null;
    this.renderer?.dispose();
  }
}
