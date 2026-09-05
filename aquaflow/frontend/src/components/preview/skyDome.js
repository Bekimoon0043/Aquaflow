/**
 * skyDome.js — AF-3D-004 (realism plan, Phase R1)
 *
 * Procedural sky dome + starfield, replacing the flat THREE.Color background.
 *
 * A fountain preview at night was rendered against a solid navy rectangle — no
 * gradient, no stars, no horizon. Real night skies grade from a light-polluted
 * horizon glow up to a dark zenith, and that gradient is most of what the pool's
 * fresnel mirror actually reflects. The dome here is a big inward-facing sphere
 * with an analytic gradient per environment preset; NIGHT adds a twinkling
 * starfield (sceneModes.js has declared `starfield: true` since AQ-S3-004 —
 * this finally consumes it).
 *
 * The same dome doubles as the IBL source: `createSkyIBL` PMREM-filters a scene
 * containing only the dome, so material reflections agree with the visible sky
 * instead of fighting it (the old RoomEnvironment was a bright studio probe
 * inside a night scene).
 */

const SKY_PRESETS = {
  night: {
    zenith: 0x010409, horizon: 0x0c1a2e, glow: 0x2a2018, glowStrength: 0.55,
    stars: true,
  },
  arena: {
    // Indoor: a near-black ceiling with a faint warm bounce at the "horizon" (the
    // arena bowl). No stars indoors.
    zenith: 0x010204, horizon: 0x090b10, glow: 0x181009, glowStrength: 0.35,
    stars: false,
  },
  dusk: {
    zenith: 0x120a26, horizon: 0x5a2410, glow: 0xb4501e, glowStrength: 0.85,
    stars: false,
  },
  day: {
    zenith: 0x3d7fc6, horizon: 0xa8cde4, glow: 0xf4ead2, glowStrength: 0.30,
    stars: false,
  },
};

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uGlow;
uniform float uGlowStrength;

void main(){
  float h = vDir.y;   // -1 below horizon … +1 zenith

  // Horizon → zenith gradient, biased so most of the grade happens low in the sky
  // as it does in a real atmosphere.
  vec3 col = mix(uHorizon, uZenith, smoothstep(0.0, 0.55, h));

  // Below the horizon (visible from elevated cameras) the dome darkens toward the
  // zenith tone rather than mirroring the sky.
  col = mix(col, uZenith * 0.6, smoothstep(0.0, -0.25, h));

  // Light-pollution / sunset band hugging the horizon line.
  float band = exp(-abs(h) * 7.0);
  col += uGlow * band * uGlowStrength;

  gl_FragColor = vec4(col, 1.0);
}`;

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uTime;
uniform float uPixelRatio;
varying float vTwinkle;
void main(){
  // Slow, per-star twinkle. Kept subtle: real stars flicker in the last few
  // percent of their brightness, not on and off.
  vTwinkle = 0.72 + 0.28 * sin(uTime * (0.6 + aPhase * 1.7) + aPhase * 40.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}`;

const STAR_FRAG = /* glsl */ `
precision highp float;
varying float vTwinkle;
void main(){
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vTwinkle;
  // Slightly warm-white; pure white stars read as noise pixels.
  gl_FragColor = vec4(vec3(1.0, 0.97, 0.92) * a, a);
}`;

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build the dome (and starfield where the preset calls for one).
 *
 * @param {object} T the three namespace
 * @param {string} envId "night" | "dusk" | "day" | "arena"
 * @param {object} opts { radius, stars: force-enable/disable, pixelRatio }
 * @returns {{ group, update(elapsed), dispose() }}
 */
export function createSkyDome(T, envId, { radius = 300, stars = null, pixelRatio = 1 } = {}) {
  const preset = SKY_PRESETS[envId] || SKY_PRESETS.night;
  const group = new T.Group();
  group.name = "skyDome";

  const domeGeo = new T.SphereGeometry(radius, 32, 20);
  const domeMat = new T.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: T.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new T.Color(preset.zenith) },
      uHorizon: { value: new T.Color(preset.horizon) },
      uGlow: { value: new T.Color(preset.glow) },
      uGlowStrength: { value: preset.glowStrength },
    },
  });
  const dome = new T.Mesh(domeGeo, domeMat);
  dome.renderOrder = -10;         // paint first; everything else draws over it
  dome.frustumCulled = false;
  group.add(dome);

  let starMat = null;
  const wantStars = stars === null ? preset.stars : !!stars;
  if (wantStars) {
    const count = 1100;
    const rand = mulberry(97);
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const r = radius * 0.985;
    for (let i = 0; i < count; i++) {
      // Uniform over the upper hemisphere, thinned near the horizon where haze
      // hides real stars.
      const azimuth = rand() * Math.PI * 2;
      const elev = Math.asin(0.06 + rand() * 0.94);
      pos[i * 3] = Math.cos(azimuth) * Math.cos(elev) * r;
      pos[i * 3 + 1] = Math.sin(elev) * r;
      pos[i * 3 + 2] = Math.sin(azimuth) * Math.cos(elev) * r;
      // A few bright stars in a field of faint ones — real magnitudes are log-distributed.
      const m = rand();
      size[i] = 1.0 + m * m * m * 3.2;
      phase[i] = rand();
    }
    const starGeo = new T.BufferGeometry();
    starGeo.setAttribute("position", new T.BufferAttribute(pos, 3));
    starGeo.setAttribute("aSize", new T.BufferAttribute(size, 1));
    starGeo.setAttribute("aPhase", new T.BufferAttribute(phase, 1));
    starMat = new T.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
      },
    });
    const starPoints = new T.Points(starGeo, starMat);
    starPoints.renderOrder = -9;
    starPoints.frustumCulled = false;
    group.add(starPoints);
  }

  return {
    group,
    update(elapsed) {
      if (starMat) starMat.uniforms.uTime.value = elapsed;
    },
    dispose() {
      group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      group.parent?.remove(group);
    },
  };
}

/**
 * PMREM-filter the dome into an environment map, so PBR materials reflect the sky
 * they are actually standing under. Returns the render target (caller owns
 * disposal) or null on failure — IBL is an enhancement, never a dependency.
 */
export function createSkyIBL(T, renderer, envId) {
  try {
    const scene = new T.Scene();
    const sky = createSkyDome(T, envId, { stars: false });   // stars are sub-texel in a probe
    scene.add(sky.group);
    const pmrem = new T.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(scene, 0.04);
    pmrem.dispose();
    sky.dispose();
    return rt;
  } catch (e) {
    return null;
  }
}
