/**
 * scenePost.js — post-processing and image-based lighting for FountainScene
 * (AF-3D-021: moved out of FountainScene_v6.js, which is now an orchestrator).
 *
 * Every function takes the live FountainScene as `scene` and reads/writes the same
 * fields the methods always did (`scene.composer`, `scene._bloomPass`, ...), so the
 * public API and behaviour are unchanged. New here: the AF-3D-008 half-resolution
 * spray composite, inserted in linear HDR before tone mapping.
 */
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { createSkyIBL } from "./skyDome";
import { CINEMATIC_SHADER } from "./sceneShaders";
import { QUALITY_CONFIG } from "./sceneQuality";
import { SceneDepthProbe } from "./sceneDepth";
import { HalfResParticlePass, halfResSprayEnabled } from "./halfResParticles";

// ── Image-based lighting ────────────────────────────────────────────────────
// The pool, deck and nozzle bodies are MeshStandardMaterial. Without an environment
// they can only respond to the punctual lights, which reads flat and plastic.
//
// AF-3D-004: the probe is now generated FROM THE SKY DOME, so what the materials
// reflect agrees with the sky the viewer can actually see — a night scene gets a
// dark horizon-graded probe instead of a bright white studio. The RoomEnvironment
// studio probe survives only as the fallback when the sky probe cannot be built.
export function buildEnvironmentIBL(scene) {
  const q = QUALITY_CONFIG[scene.quality] || QUALITY_CONFIG.medium;
  if (!q.ibl) return;
  const T = scene.THREE;
  try {
    scene._envRT?.dispose?.();
    scene._envRT = createSkyIBL(T, scene.renderer, scene.environment);
    scene._iblKind = scene._envRT ? "sky" : null;
    if (!scene._envRT) {
      const pmrem = new T.PMREMGenerator(scene.renderer);
      const room = new RoomEnvironment();   // r165: takes an optional renderer, not THREE
      scene._envRT = pmrem.fromScene(room, 0.04);
      scene._iblKind = "room";
      room.dispose?.();
      pmrem.dispose();
    }
    scene.scene.environment = scene._envRT.texture;
    scene.scene.environmentIntensity = scene._envIntensityFor(scene.environment);
  } catch (e) {
    scene._envRT = null;   // IBL is an enhancement: never fatal
    scene._iblKind = null;
  }
}

/**
 * AF-NEXT-013: OutputPass whose input is clamped to [0, 6e4] before tone mapping.
 * Stacked additive HDR (fp16 overflow to +Inf) made NeutralToneMapping return NaN
 * (Inf/Inf), and the bloom blur after it spread that NaN over the whole frame — the
 * Neutral operator rendered a black screen. clamp() also maps NaN to 0 on D3D/ANGLE
 * (min/max return the non-NaN operand). OutputShader is GLSL ES 1.0, so no isnan().
 */
const OUTPUT_READ = "gl_FragColor = texture2D( tDiffuse, vUv );";
export function sanitizedOutputPass() {
  const pass = new OutputPass();
  const m = pass.material;
  if (m?.fragmentShader?.includes(OUTPUT_READ)) {
    m.fragmentShader = m.fragmentShader.replace(OUTPUT_READ,
      `${OUTPUT_READ}
			gl_FragColor.rgb = clamp( gl_FragColor.rgb, 0.0, 6.0e4 );`);
    m.needsUpdate = true;
  }
  return pass;
}

// ── Post-processing chain ───────────────────────────────────────────────────
export function buildPostFX(scene) {
  const T = scene.THREE;
  const q = QUALITY_CONFIG[scene.quality] || QUALITY_CONFIG.medium;
  scene._postEnabled = false;
  if (!q.postfx || scene._postDisabledByUser) return;
  try {
    const W = scene.canvas.clientWidth || 900, H = scene.canvas.clientHeight || 600;
    // Canvas antialiasing does not apply to the composer's offscreen target.
    // Multisample the scene itself so thin streams survive at export resolution.
    const target = new T.WebGLRenderTarget(W, H, {
      type: T.HalfFloatType,
      // AF-NEXT-013: a tier may set `msaa` (eco: 0). On an entry GPU the 4x fp16
      // multisampled target was the single largest cost (docs/evidence/AF-NEXT-013.md).
      samples: Math.min(Number.isFinite(q.msaa) ? q.msaa : 4, scene.renderer.capabilities.maxSamples || 0),
    });
    const composer = new EffectComposer(scene.renderer, target);
    composer.setPixelRatio?.(scene._pr);
    composer.setSize(W, H);

    composer.addPass(new RenderPass(scene.scene, scene.camera));

    // Ambient occlusion — contact darkening where floor/kerb/nozzle bases meet.
    // Runs on the LINEAR scene buffer, before tone mapping. Solid geometry only:
    // the water particles are transparent and do not write depth.
    if (q.ao) {
      try {
        const gtao = new GTAOPass(scene.scene, scene.camera, W, H);
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
        scene._aoPass = gtao;
      } catch (e) {
        scene._aoPass = null;   // AO is an enhancement, never fatal
      }
    }

    // AF-3D-008: half-res spray/mist joins the image here — linear HDR, after the
    // opaque scene and AO, before tone mapping, exactly where it would have been
    // blended at full resolution.
    if (scene._halfRes && scene._depthProbe) {
      composer.addPass(scene._halfRes.createCompositePass(ShaderPass, scene._depthProbe.texture, scene.camera));
    }

    // Tone mapping + sRGB conversion BEFORE bloom (lesson from the first cut,
    // verified against live screenshots): scene scene's water/spray are additive
    // particle shaders whose linear-HDR sum runs far above 1.0 across most of the
    // frame, so bloom thresholded in pre-tonemap HDR bloomed *everything* and the
    // night scene washed out into white fog. Tone-mapping first means bloom sees
    // exactly the image the user sees, and the threshold below reliably selects
    // only genuinely bright screen content — jet cores, fixtures, flame.
    composer.addPass(sanitizedOutputPass());

    // Display-referred bloom: threshold 0.82 catches only near-white pixels.
    const bloom = new UnrealBloomPass(
      new T.Vector2(W, H),
      q.bloom,        // strength
      0.42,           // radius — tight halo; wider smears the dense jet core
      0.86            // threshold — display-referred, only true highlights
    );
    if (q.bloomScale && q.bloomScale < 1) {
      // AF-NEXT-013: run the bloom mip chain at a fraction of its usual size (eco).
      const setSize = bloom.setSize.bind(bloom);
      bloom.setSize = (w, h) => setSize(Math.max(1, Math.round(w * q.bloomScale)), Math.max(1, Math.round(h * q.bloomScale)));
      bloom.setSize(W, H);
    }
    composer.addPass(bloom);
    scene._bloomPass = bloom;

    // Cinematic grade (vignette / aberration / grain / saturation).
    const grade = new ShaderPass(CINEMATIC_SHADER);
    grade.uniforms.uResolution.value.set(W * scene._pr, H * scene._pr);
    composer.addPass(grade);
    scene._gradePass = grade;

    if (q.smaa) {
      const smaa = new SMAAPass(W * scene._pr, H * scene._pr);
      composer.addPass(smaa);
      scene._smaaPass = smaa;
    }

    scene.composer = composer;
    scene._postEnabled = true;
  } catch (e) {
    // Any failure (old GPU, missing extension) falls back to the direct render path.
    scene.composer = null;
    scene._postEnabled = false;
  }
}

/** Toggle / tune the post chain at runtime. setPostFX(false) restores direct render. */
export function setPostFX(scene, opts) {
  if (opts === false || opts === true) opts = { enabled: opts };
  const o = opts || {};
  if (o.enabled === false) {
    scene._postDisabledByUser = true;
    scene._disposePostFX();
    configureHalfResSpray(scene);   // no composer, so no half-res composite either
    return;
  }
  if (o.enabled === true) {
    scene._postDisabledByUser = false;
    if (!scene.composer && scene._initialized) scene._buildPostFX();
    configureHalfResSpray(scene);
  }
  if (scene._bloomPass) {
    if (typeof o.bloom === "number")     scene._bloomPass.strength  = o.bloom;
    if (typeof o.bloomRadius === "number")    scene._bloomPass.radius    = o.bloomRadius;
    if (typeof o.bloomThreshold === "number") scene._bloomPass.threshold = o.bloomThreshold;
  }
  if (scene._gradePass) {
    const u = scene._gradePass.uniforms;
    if (typeof o.vignette === "number")   u.uVignette.value   = o.vignette;
    if (typeof o.aberration === "number") u.uAberration.value = o.aberration;
    if (typeof o.grain === "number")      u.uGrain.value      = o.grain;
    if (typeof o.saturation === "number") u.uSaturation.value = o.saturation;
    if (typeof o.contrast === "number")   u.uContrast.value   = o.contrast;
  }
}

export function disposePostFX(scene) {
  try {
    scene._smaaPass = null;
    scene._aoPass?.dispose?.();
    scene._aoPass = null;
    scene._bloomPass?.dispose?.();
    scene._bloomPass = null;
    scene._gradePass?.material?.dispose?.();
    scene._gradePass = null;
    if (scene._halfRes) { scene._halfRes.pass?.material?.dispose?.(); scene._halfRes.pass = null; }
    scene.composer?.dispose?.();
  } catch (e) { /* disposal is best-effort */ }
  scene.composer = null;
  scene._postEnabled = false;
}

// ── AF-3D-008: half-resolution spray / mist ─────────────────────────────────
/** The particle systems that render in the half-res pass when it is on. */
export function halfResSprayObjects(scene) {
  return [scene._gpuSpray, scene.spraySys].filter(Boolean);
}

/** Drawing-buffer size in device pixels. */
function bufferSize(scene) {
  const W = scene.canvas?.clientWidth || 900, H = scene.canvas?.clientHeight || 600;
  const pr = scene._pr || 1;
  return { w: W * pr, h: H * pr };
}

/**
 * (Re)configure the half-res spray pass for the current tier and user toggle. The
 * depth probe runs at FULL resolution while the pass is on (it is the upsample's
 * reference depth) and returns to the tier's `softScale` when it is off.
 */
export function configureHalfResSpray(scene) {
  const T = scene.THREE;
  const q = QUALITY_CONFIG[scene.quality] || QUALITY_CONFIG.medium;
  const want = !!(halfResSprayEnabled(scene.quality, scene._halfResUser)
    && q.softDepth && q.postfx && !scene._postDisabledByUser && scene.renderer);
  const { w, h } = bufferSize(scene);
  const probeScale = want ? 1.0 : q.softScale;

  if (q.softDepth && scene.renderer && (!scene._depthProbe || scene._depthProbe.scale !== probeScale)) {
    try {
      scene._depthProbe?.dispose?.();
      scene._depthProbe = new SceneDepthProbe(T, scene.renderer, { width: w, height: h, scale: probeScale });
    } catch (err) {
      console.warn("[FountainScene] depth probe unavailable:", err?.message || err);
      scene._depthProbe = null;
    }
  }

  const had = !!scene._halfRes;
  if (want && scene._depthProbe && !scene._halfRes) {
    try {
      scene._halfRes = new HalfResParticlePass(T, scene.renderer, { width: w, height: h, scale: 0.5 });
    } catch (err) {
      console.warn("[FountainScene] half-res spray unavailable:", err?.message || err);
      scene._halfRes = null;
    }
  } else if ((!want || !scene._depthProbe) && scene._halfRes) {
    scene._halfRes.dispose();
    scene._halfRes = null;
  }
  scene._bindSoftDepth?.();
  // The composite pass lives inside the composer, so a change rebuilds the chain.
  if (had !== !!scene._halfRes && scene._initialized) {
    disposePostFX(scene);
    buildPostFX(scene);
  }
  return !!scene._halfRes;
}

/**
 * Render the spray into the half-res target and hide it from the full-res pass.
 * Returns the visibility records to restore after the composer has run.
 */
export function renderHalfResSpray(scene) {
  if (!scene._halfRes?.pass || !scene._postEnabled) return null;
  const meshes = halfResSprayObjects(scene).map(sys => sys.mesh).filter(m => m?.visible);
  if (!meshes.length) return null;
  scene._halfRes.render(meshes, scene.camera);
  const restore = meshes.map(m => [m, m.visible]);
  for (const m of meshes) m.visible = false;
  return restore;
}

export function restoreVisibility(records) {
  if (records) for (const [o, v] of records) o.visible = v;
}
