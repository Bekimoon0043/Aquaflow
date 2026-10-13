/**
 * sceneLighting.js — environment lights, shadows, sky, underwater lights and the
 * engineering fixture lights for FountainScene (AF-3D-021: moved out of
 * FountainScene_v6.js).
 *
 * Functions take the live FountainScene as `scene` and set the same fields the
 * methods always did. The fixture lights feed the clustered light texture
 * (fixtureLightField.js, AF-3D-022); a small number of real three.js lights still
 * light the basin and walls (the underwater ring + centre light below).
 */
import { ENVIRONMENTS } from "../../rendering";
import { createSkyDome } from "./skyDome";
import { QUALITY_CONFIG } from "./sceneQuality";
import { MAX_FIXTURE_LIGHTS } from "./fixtureLightField";

/** Environment-map strength. The sky-dome IBL is dim and truthful, so it can run
 *  near full strength; the RoomEnvironment fallback is a bright studio probe that
 *  must be held far lower or it flattens the night mood. */
export function envIntensityFor(scene, env) {
  const nightish = env === ENVIRONMENTS.NIGHT || env === ENVIRONMENTS.ARENA;
  if (scene._iblKind === "sky") return nightish ? 1.5 : 1.0;
  return nightish ? 0.16 : 0.42;
}

/** AF-3D-004: the sky dome (and starfield at night) replacing the flat backdrop. */
export function buildSky(scene) {
  const q = QUALITY_CONFIG[scene.quality] || QUALITY_CONFIG.medium;
  scene._sky?.dispose?.();
  scene._sky = null;
  try {
    scene._sky = createSkyDome(scene.THREE, scene.environment, {
      stars: q.stars ? null : false,   // null = per-preset default
      pixelRatio: scene._pr || 1,
    });
    scene.scene.add(scene._sky.group);
  } catch (err) {
    // The scene.background colour below remains the fallback backdrop.
    console.warn("[FountainScene] sky dome unavailable:", err?.message || err);
    scene._sky = null;
  }
}

/**
 * Fit a directional light's shadow frustum to the design (AF-3D-015).
 *
 * three.js defaults a DirectionalLightShadow to an orthographic box of +/-5 metres.
 * Nothing here ever overrode it, so shadows existed only within a 10 m square at
 * the origin while the pool is up to 12 x 8 m and the deck is 80 x 80 — most of the
 * scene could neither cast nor receive a shadow, and the boundary cut straight
 * across the basin.
 *
 * The frustum is sized to the actual design rather than to the deck: shadow texel
 * density is the map resolution divided by the frustum width, so covering ground
 * nobody looks at is paid for as blur everywhere that matters.
 */
/**
 * Re-fit every shadow-casting directional light to the CURRENT design. The
 * environment is built before the pool exists, and the pool can be resized later
 * from the geometry designer, so the fit has to be re-applied rather than only
 * computed once at construction.
 */
export function refitShadows(scene) {
  scene._envGroup?.traverse?.((o) => {
    if (o.isDirectionalLight && o.castShadow) scene._fitShadowCamera(o, o.shadow.mapSize.x || 2048);
  });
}

export function fitShadowCamera(scene, light, mapSize = 2048) {
  if (!light?.shadow) return;
  const half = scene._poolType === "circular"
    ? (scene._poolRadius || 6)
    : Math.max((scene._poolW || 12), (scene._poolL || 8)) / 2;
  const extent = Math.min(40, Math.max(14, half * 2.2 + 8));
  const cam = light.shadow.camera;
  cam.left = -extent; cam.right = extent;
  cam.top = extent;   cam.bottom = -extent;
  cam.near = 0.5;
  // Far must clear the light's own distance from the scene, or geometry falls out
  // the back of the frustum and its shadow silently disappears.
  cam.far = Math.max(80, light.position.length() * 2.2);
  cam.updateProjectionMatrix();
  light.shadow.mapSize.set(mapSize, mapSize);
  light.shadow.normalBias = 0.035;
  light.shadow.bias = -0.0004;
}

export function applyEnvironment(scene) {
  const T=scene.THREE; const env=scene.environment;
  if (scene._envGroup) scene.scene.remove(scene._envGroup);
  scene._envGroup = new T.Group();
  scene._buildSky();
  // Keep the IBL probe in step with the preset — and, since the probe IS the sky
  // now, rebuild it whenever the environment changes after init.
  if (scene._envRT && scene.scene) {
    scene._buildEnvironmentIBL();
  }

  if (env===ENVIRONMENTS.NIGHT){
    scene.scene.background = new T.Color(0x020610);
    scene.scene.fog = new T.FogExp2(0x020610, 0.015);
    const amb  = new T.AmbientLight(0x0d1a30, 2.0);
    const moon = new T.DirectionalLight(0x7788bb, 1.2);
    moon.position.set(-10,30,-10); moon.castShadow=true;
    // normalBias (set in _fitShadowCamera) removes the shadow acne that otherwise
    // stipples the curved pool walls, without the "floating object" gap a large
    // constant bias introduces.
    scene._fitShadowCamera(moon, 2048);
    scene._envGroup.add(amb, moon);
    scene._setBaseExposure(1.55);
    scene.waterMat?.uniforms.uSkyColor.value.set(0x020610);
  } else if (env===ENVIRONMENTS.DUSK){
    scene.scene.background = new T.Color(0x180820);
    scene.scene.fog = new T.Fog(0x250f35, 25, 90);
    const amb = new T.AmbientLight(0x281030, 2.8);
    const sun = new T.DirectionalLight(0xff5522, 1.8);
    sun.position.set(12,7,-20); sun.castShadow=true;
    scene._fitShadowCamera(sun, 2048);
    const fill = new T.HemisphereLight(0x501880, 0x100820, 1.5);
    scene._envGroup.add(amb, sun, fill);
    scene._setBaseExposure(1.9);
    scene.waterMat?.uniforms.uSkyColor.value.set(0x180820);
  } else if (env===ENVIRONMENTS.DAY){
    scene.scene.background = new T.Color(0x6ab4d8);
    scene.scene.fog = new T.Fog(0x9cc5de, 40, 130);
    const amb = new T.AmbientLight(0xffffff, 2.5);
    const sun = new T.DirectionalLight(0xfff8e8, 3.8);
    sun.position.set(25,60,25); sun.castShadow=true;
    scene._fitShadowCamera(sun, 2048);
    const sky = new T.HemisphereLight(0x6ab4d8, 0x2d5c20, 1.0);
    scene._envGroup.add(amb, sun, sky);
    scene._setBaseExposure(1.0);
    scene.waterMat?.uniforms.uSkyColor.value.set(0x6ab4d8);
    scene.waterMat?.uniforms.uDeepColor.value.set(0x0d3550);
    scene.waterMat?.uniforms.uShallowColor.value.set(0x2d7aaa);
  } else if (env===ENVIRONMENTS.ARENA){
    scene.scene.background = new T.Color(0x010305);
    scene.scene.fog = new T.FogExp2(0x010305, 0.013);
    const amb = new T.AmbientLight(0x040810, 1.5);
    const cols=[0xff1100,0x0011ff,0x00ff22,0xff8800,0xff00cc,0x00eeff];
    cols.forEach((color,i)=>{
      const a=(i/cols.length)*Math.PI*2;
      const sp=new T.SpotLight(color,25,70,Math.PI/5,0.3,2);
      sp.position.set(Math.cos(a)*18,22,Math.sin(a)*18);
      sp.target.position.set(0,0,0); sp.castShadow=true;
      scene._envGroup.add(sp, sp.target);
    });
    scene._envGroup.add(amb);
    scene._setBaseExposure(2.6);
  }
  scene.scene.add(scene._envGroup);
}

export function buildUnderwaterLights(scene) {
  // Underwater "ambient" point lights (the engineering-driven RGB lights are
  // handled separately by _rebuildEngineeringLights and the RGB light field).
  const T=scene.THREE;
  if (scene._uwGroup) { scene.scene.remove(scene._uwGroup); }
  scene._uwGroup = new T.Group();

  const r = scene._poolType==='circular' ? scene._poolRadius*0.65 : Math.min(scene._poolW,scene._poolL)*0.3;
  scene.uwLights=[];
  const count=8;
  for (let i=0; i<count; i++){
    const angle=(i/count)*Math.PI*2;
    const light=new T.PointLight(0x0066ff, 2.0, 12, 2);
    light.position.set(Math.cos(angle)*r, -0.2, Math.sin(angle)*r);
    scene._uwGroup.add(light);
    scene.uwLights.push(light);
  }
  scene.centerLight=new T.PointLight(0x0044cc, 3.5, 22, 2);
  scene.centerLight.position.set(0,0.5,0);
  scene._uwGroup.add(scene.centerLight);
  scene.scene.add(scene._uwGroup);
}

// ── Engineering: drive Phase-2 RGB light field from fixture lights ──────
export function setEngineeringLights(scene, lightConfigs) {
  const T = scene.THREE;
  scene._engLights = (lightConfigs||[]).slice(0, MAX_FIXTURE_LIGHTS).map(lc => {
    const color = new T.Color(typeof lc.color === 'string' ? lc.color : (lc.color || 0x0066ff));
    const intensity = (lc.intensity ?? 4.0);
    const radius = lc.radius ?? 6.0;

    return {
      id: lc.id,
      x: lc.x ?? 0,
      z: lc.z ?? (lc.y ?? 0),
      color,
      intensity,
      radius,
      baseColor: color.clone(),
      baseIntensity: intensity,
      baseRadius: radius,
      // Beam aim for the light texture (AF-3D-022); upright, ~56° beam when absent.
      tiltX: Number(lc.tiltX) || 0,
      tiltZ: Number(lc.tiltZ) || 0,
      beamAngle: Number(lc.beamAngle) || undefined,
    };
  });

  // AF-3D-019: one instanced body + lens per light, two draw calls in total.
  scene._lightMarkers?.setLights(scene._engLights);
  scene._engLightMeshes = scene._lightMarkers?.disc ? [scene._lightMarkers.disc] : [];

  // Immediately push to shader light-field
  scene._uploadLightField();
}

// ─── Public API ─────────────────────────────────────────────────────────
// BUG FIX: setSignals merges (not overwrites) so PreviewPanel.timeline driver
// doesn't blank a manually set signal
export function colorFromSignalColor(scene, value, fallback = "#ffffff") {
  const T = scene.THREE;

  if (typeof value === "string") {
    return new T.Color(value);
  }

  if (value && typeof value === "object") {
    // AF-NEXT-013 (docs/COLOR-PIPELINE.md): signal colours are sRGB-ENCODED 0..1 — the
    // same numbers the HUD shows as R/G/B x 255 and the drivers send as DMX/PLC bytes.
    // new THREE.Color(r, g, b) would take them as linear and wash every mid-tone out;
    // decode explicitly so {r,g,b} and the equivalent "#rrggbb" give the same colour.
    const c = new T.Color();
    const r = value.r ?? 1, g = value.g ?? 1, b = value.b ?? 1;
    if (T.SRGBColorSpace && typeof c.setRGB === "function") return c.setRGB(r, g, b, T.SRGBColorSpace);
    return c.setRGB(r, g, b);
  }

  return new T.Color(fallback);
}

export function applyRuntimeLighting(scene) {
  if (!scene._lightField) return;

  const lightIntensity = Math.max(0, Math.min(1, Number(scene._signals?.lighting || 0)));
  const color = scene._colorFromSignalColor(
    scene._signals?.lightingColor,
    scene.lightColor || "#ffffff"
  );

  scene._lightField.uGlobalLight.value.copy(color);
  scene._lightField.uGlobalLightI.value = lightIntensity * 1.8;

  // Runtime RGB override:
  // When the timeline/manual pattern sends RGB color, all engineering RGB fixtures
  // should adopt that color visually instead of staying at their default library color.
  if (lightIntensity > 0.01 && !scene._signals?.fixtureLightStates && scene._engLights?.length) {
    for (const L of scene._engLights) {
      if (L?.color) L.color.copy(color);
      L.intensity = Math.max(L.intensity || 0, lightIntensity * 6.0);
    }

    for (let i = 0; i < scene._engLights.length; i++) scene._lightMarkers?.setLevel(i, color);

    scene._uploadLightField?.();
  }

  // Keep render-panel light color visually synchronized with active runtime color.
  if (lightIntensity > 0.01) {
    scene.lightColor = `#${color.getHexString()}`;
  }
}

export function setLightColor(scene, hex) {
  scene.lightColor = hex;

  // Only apply panel light color directly when runtime is not actively
  // driving lighting. If runtime lighting is active, setSignals/_update
  // remains the authority.
  const activeRuntimeLighting = Number(scene._signals?.lighting || 0) > 0.01;

  if (!activeRuntimeLighting && scene._lightField) {
    const color = scene._colorFromSignalColor(hex, "#ffffff");
    scene._lightField.uGlobalLight.value.copy(color);
    scene._lightField.uGlobalLightI.value = 0.5;
  }
}
