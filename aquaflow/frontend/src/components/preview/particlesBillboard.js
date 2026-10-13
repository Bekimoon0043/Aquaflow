/**
 * particlesBillboard.js — AF-3D-001/002 (realism plan, Phase R1)
 *
 * Instanced, velocity-stretched billboard quads for the particle systems, replacing
 * gl_Points. Two problems with point sprites made the old jets read as "game
 * particles" rather than water:
 *
 *   • a point is always a screen-aligned CIRCLE. A droplet at 8 m/s is a streak;
 *     the old shader could only grow the circle, never elongate it, so a dense jet
 *     looked like glass beads. Here each particle is a camera-facing quad whose
 *     local X axis is aligned with the particle's screen-space velocity and
 *     stretched by its speed (width narrows to roughly conserve volume);
 *
 *   • gl_PointSize is clamped by the driver's POINT_SIZE_RANGE, so close-up
 *     droplets popped to a capped size. Quads have no such clamp.
 *
 * The fragment stage adds two more Depence-signature behaviours:
 *
 *   • an optional sprite texture (particleTextures.js) modulates the analytic
 *     droplet shading with micro-structure;
 *   • SOFT PARTICLES — the fragment fades as it approaches scene depth
 *     (sceneDepth.js provides the depth texture), which removes the hard sprite
 *     cut against the pool rim, deck and fixtures.
 *
 * The simulation (spawn/advect/impact) is untouched and stays in
 * FountainScene_v6.js; this module only owns geometry + material.
 *
 * AF-3D-022: fixture light is evaluated once per PARTICLE in the vertex stage from
 * the clustered light texture (fixtureLightField.js) and handed to the fragment
 * stage as `vFieldLight` — no fixture cap, and no per-pixel light loop.
 */
import { FIELD_LIGHT_GLSL, HG_G } from "./fixtureLightField";

/** Uniform placeholders; the scene re-points them at its shared FixtureLightField. */
export function fieldLightUniformStubs(T) {
  return {
    uLightTex: { value: null },
    uClusterTex: { value: null },
    uClusterBounds: { value: new T.Vector4(0, 0, 1, 1) },
    uClusterDim: { value: 1 },
    uFieldCount: { value: 0 },
  };
}

/** Vertex-stage snippet: per-particle fixture light for world position `wp`. */
export const FIELD_LIGHT_VARYING = /* glsl */ `
varying vec3 vFieldLight;
${FIELD_LIGHT_GLSL}
vec3 particleFieldLight(vec3 wp){
  return fieldLight(wp, normalize(cameraPosition - wp), ${HG_G.toFixed(2)}, 1.0);
}
`;

/** Build the instanced quad geometry over the caller's simulation arrays. */
export function buildBillboardGeometry(T, maxCount, arrays) {
  const geo = new T.InstancedBufferGeometry();

  // Unit quad in the XY plane, corners at ±0.5, with UVs.
  const quadPos = new Float32Array([
    -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
  ]);
  const quadUv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  geo.setAttribute("position", new T.BufferAttribute(quadPos, 3));
  geo.setAttribute("uv", new T.BufferAttribute(quadUv, 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);

  geo.setAttribute("aOffset", new T.InstancedBufferAttribute(arrays.positions, 3));
  geo.setAttribute("aVel", new T.InstancedBufferAttribute(arrays.velocities, 3));
  geo.setAttribute("aColor", new T.InstancedBufferAttribute(arrays.colors, 4));
  geo.setAttribute("aScale", new T.InstancedBufferAttribute(arrays.scales, 1));
  geo.setAttribute("aLife", new T.InstancedBufferAttribute(arrays.lives, 1));
  geo.setAttribute("aStretch", new T.InstancedBufferAttribute(arrays.stretches, 1));
  geo.setAttribute("aSeed", new T.InstancedBufferAttribute(arrays.seeds, 1));
  geo.instanceCount = 0;
  return geo;
}

const BILLBOARD_VERT = /* glsl */ `
attribute vec3  aOffset;
attribute vec3  aVel;
attribute vec4  aColor;
attribute float aScale;
attribute float aLife;
attribute float aStretch;
attribute float aSeed;
uniform float uSizeScale;
varying vec4  vColor;
varying float vLife;
varying vec3  vWorldPos;
varying vec2  vUv;
varying float vViewZ;
varying float vSeed;
${FIELD_LIGHT_VARYING}

void main(){
  vFieldLight = particleFieldLight(aOffset);
  vColor    = aColor;
  vLife     = aLife;
  vWorldPos = aOffset;
  vSeed     = aSeed;
  vUv       = uv;

  vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);

  // Velocity in view space (particle meshes carry no model transform of their own,
  // so the view matrix alone rotates the direction correctly).
  vec3 vv = (viewMatrix * vec4(aVel, 0.0)).xyz;
  float speed = length(aVel);

  // Screen-space stretch axis; a near-stationary particle stays a round billboard.
  vec2 dir = vv.xy;
  float dl = length(dir);
  vec2 axis = dl > 1e-4 ? dir / dl : vec2(0.0, 1.0);
  vec2 perp = vec2(-axis.y, axis.x);

  // Fast droplets elongate along their motion; width narrows so the streak does
  // not simply gain area. aStretch is the per-particle "how streaky" authored by
  // the emitter (laminar cores high, mist near zero).
  float stretch  = 1.0 + aStretch * min(speed * 0.30, 3.5);
  float size     = aScale * uSizeScale;
  float halfLen  = 0.5 * size * stretch;
  float halfWid  = 0.5 * size / (0.35 + 0.65 * sqrt(stretch));

  mv.xy += axis * (position.x * 2.0 * halfLen) + perp * (position.y * 2.0 * halfWid);

  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/**
 * The droplet fragment stage. Exported so the GPU-simulated field (particlesGPU.js)
 * renders with the SAME optical model, light-field injection and soft-depth fade —
 * the two backends must be visually indistinguishable, so this shading exists once.
 * Its contract is the varying set: vColor, vLife, vWorldPos, vUv, vViewZ, vSeed,
 * vFieldLight. (The argument is accepted for call-site compatibility and ignored:
 * the fixture count is no longer baked into the shader.)
 */
// eslint-disable-next-line no-unused-vars
export function billboardFrag(_unusedMaxFieldLights) {
  return /* glsl */ `
precision highp float;
varying vec4  vColor;
varying float vLife;
varying vec3  vWorldPos;
varying vec2  vUv;
varying float vViewZ;
varying float vSeed;
varying vec3  vFieldLight;

uniform sampler2D uMap;
uniform float uUseMap;

uniform sampler2D uSceneDepth;
uniform float uUseDepth;
uniform vec2  uInvRes;
uniform float uNear;
uniform float uFar;
uniform float uSoftDist;

uniform vec3  uGlobalLight;
uniform float uGlobalLightI;

void main(){
  vec2  uv = vUv - 0.5;
  float d  = length(uv);

  // Sprite texture (droplet / mist / foam / flame). When absent, the analytic
  // radial model below is the whole shape — the pre-R1 behaviour.
  float texA = 1.0;
  if (uUseMap > 0.5) {
    texA = texture2D(uMap, vUv).a;
    if (texA < 0.012) discard;
  } else if (d > 0.5) {
    discard;
  }

  // Droplet optical model (unchanged from the point-sprite shader).
  float edge        = smoothstep(0.5, 0.30, d);
  float core        = smoothstep(0.22, 0.0, d);
  float refractGlow = smoothstep(0.18, 0.0, abs(d - 0.12));
  vec2  specUv      = uv - vec2(0.12, 0.14);
  float spec        = smoothstep(0.12, 0.0, length(specUv)) * 0.9;

  vec3 col = vColor.rgb;
  col += core        * vec3(0.6, 0.8, 1.0);
  col += refractGlow * vec3(0.3, 0.5, 0.8);
  col += spec        * vec3(1.0);

  // ── RGB LIGHT FIELD INJECTION (identical rules to the point-sprite shader) ──
  float runtimeTint = clamp(uGlobalLightI * 0.55, 0.0, 0.90);
  float luminance = max(max(col.r, col.g), col.b);
  vec3 tintedWater = uGlobalLight * max(luminance, 0.35);
  col = mix(col, tintedWater + spec * vec3(1.0), runtimeTint);
  col += uGlobalLight * uGlobalLightI * 0.35;

  // Fixture light (cone x distance x Henyey-Greenstein), computed per particle in
  // the vertex stage. Linear HDR: a droplet in a bright beam goes above 1 and blooms.
  col += vFieldLight;

  // Texture modulates the analytic shape rather than replacing it, so lighting
  // and saturation behaviour stay identical with or without a DOM to draw on.
  // Kept <= the analytic alpha: a boost above it made dense columns saturate to
  // white noticeably faster than the tuned point-sprite look.
  float shape = mix(edge, edge * (0.30 + texA * 0.70), uUseMap);
  col *= mix(1.0, 0.78 + texA * 0.44, uUseMap * 0.6);

  float alpha = shape * vColor.a * (0.30 + vLife * 0.70);

  // ── SOFT PARTICLES ──
  // Fade as the fragment approaches the opaque scene behind it. Without this every
  // droplet hard-cuts against the pool rim and deck — the single most "rendered"
  // artifact the old preview had.
  if (uUseDepth > 0.5) {
    vec2  suv    = gl_FragCoord.xy * uInvRes;
    float sceneD = texture2D(uSceneDepth, suv).x;
    float sceneZ = (uNear * uFar) / ((uFar - uNear) * sceneD - uFar);  // view-space, negative
    float diff   = vViewZ - sceneZ;   // positive when the particle is in front
    alpha *= clamp(diff / uSoftDist, 0.0, 1.0);
  }

  // PREMULTIPLIED output — see the blending rationale on the particle material:
  // water saturates like a cloud (source-over), flame adds (additive).
  gl_FragColor = vec4(col * alpha, alpha);
}`;
}

/**
 * Build the billboard material.
 *
 * @param {object} T three namespace
 * @param {object} opts { maxFieldLights, blendMode: "scatter"|"emissive",
 *                        map: Texture|null, sizeScale }
 */
export function buildBillboardMaterial(T, { maxFieldLights = 0, blendMode = "scatter", map = null, sizeScale = 0.55 } = {}) {
  const uniforms = {
    uSizeScale: { value: sizeScale },
    uMap: { value: map },
    uUseMap: { value: map ? 1.0 : 0.0 },
    uSceneDepth: { value: null },
    uUseDepth: { value: 0.0 },
    uInvRes: { value: new T.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 500 },
    uSoftDist: { value: 0.6 },
    uGlobalLight: { value: new T.Color(1, 1, 1) },
    uGlobalLightI: { value: 0.0 },
    ...fieldLightUniformStubs(T),
  };

  return new T.ShaderMaterial({
    vertexShader: BILLBOARD_VERT,
    fragmentShader: billboardFrag(maxFieldLights),
    transparent: true,
    depthWrite: false,
    // Same premultiplied scheme as before: shared blendSrc = ONE; the destination
    // factor decides occlude-and-saturate (water) vs pure add (flame).
    blending: T.CustomBlending,
    blendEquation: T.AddEquation,
    blendSrc: T.OneFactor,
    blendDst: blendMode === "emissive" ? T.OneFactor : T.OneMinusSrcAlphaFactor,
    premultipliedAlpha: true,
    uniforms,
  });
}
