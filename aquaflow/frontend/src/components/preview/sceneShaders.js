/**
 * sceneShaders.js — GLSL for the FountainScene orchestrator (AF-3D-021).
 *
 * Moved verbatim out of FountainScene_v6.js (which must not grow, AF-3D-018) apart
 * from the fixture light field: the 16-entry uniform arrays were replaced by the
 * clustered light texture from fixtureLightField.js (AF-3D-022).
 */
import * as THREE from "three";
import { FIELD_LIGHT_GLSL, HG_G } from "./fixtureLightField";

/** Concurrent impact ripples on the pool surface (ring buffer in the scene). */
export const MAX_RIPPLES = 8;

// ── Camera-response pass ────────────────────────────────────────────────────
// Applied after bloom, before OutputPass (which owns tone mapping + colour space).
// These are lens/sensor behaviours a real camera exhibits — optical vignetting,
// lateral chromatic aberration and sensor noise — not a stylistic "filter". Values
// are deliberately near the threshold of perception: they make the image read as
// photographed rather than synthetic, without altering what an engineer can measure.
export const CINEMATIC_SHADER = {
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


// ─── PARTICLE SPRITES ────────────────────────────────────────────────────────
// The point-sprite shaders that lived here moved to particlesBillboard.js when the
// particles became instanced, velocity-stretched quads (AF-3D-002). The droplet
// optical model, light-field injection and premultiplied blending rationale are
// preserved there verbatim — plus soft-depth fade and sprite textures.

// ─── WATER CORE COLUMN SHADER — coherent pressurized body ───────────────────
export const CORE_VERT = /* glsl */`
attribute vec3  aPos;     // base pos (cylinder vertex, y in [0..1])
uniform float   uHeight;
uniform float   uTime;
uniform float   uIntensity;
uniform vec3    uOrigin;
uniform vec2    uWind;
uniform vec2    uHorizontalSpeed;
uniform float   uVerticalSpeed;
varying float   vT;       // 0=base, 1=tip
varying vec3    vWorldPos;
varying float   vAlpha;
varying vec3    vRadial;

void main(){
  float t  = clamp(aPos.y, 0.0, 1.0);
  vT       = t;

  // The coherent core occupies the lower portion of a ballistic jet. Keep Y
  // monotonic: multiplying the height by a decreasing tip factor folded the
  // old mesh downward and made the water look like a bent glass rod.
  float y = t * uHeight;

  // Kelvin-Helmholtz turbulent breakup (more at tip)
  float turb = pow(t, 2.2);
  float tx = sin(t*14.0 + uTime*7.0) * 0.030;
  float tz = cos(t*11.0 - uTime*5.5) * 0.026;
  // Wind drag (parabolic, more at tip)
  float w  = t * t;

  // Slightly expanding aeration, then feather into the ballistic spray crown.
  float taper = mix(1.0, 1.35, t) * mix(1.0, 0.65, smoothstep(0.82, 1.0, t));
  taper *= 1.0 + 0.06 * sin(t * 75.0 - uTime * 19.0);
  vRadial = normalize(vec3(aPos.x, 0.0, aPos.z));
  // The coherent body follows the same ballistic path as the droplets. Its
  // centerline must lean with a tilted nozzle instead of staying vertical.
  float flightTime = (uVerticalSpeed - sqrt(max(0.0,
    uVerticalSpeed*uVerticalSpeed - 19.62*y))) / 9.81;
  vec3 worldPos = uOrigin + vec3(
    aPos.x * taper + tx * turb + uHorizontalSpeed.x * flightTime + uWind.x * w * 0.9,
    y,
    aPos.z * taper + tz * turb + uHorizontalSpeed.y * flightTime + uWind.y * w * 0.9
  );
  vWorldPos = worldPos;

  // Breakup alpha: solid at base, transparent at tip
  float breakup = 1.0 - smoothstep(0.78, 1.0, t);
  vAlpha = smoothstep(0.0, 0.16, uIntensity) * breakup * 0.72;

  gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
}`;

export const CORE_FRAG = /* glsl */`
precision highp float;
uniform vec3  uWaterColor;
uniform vec3  uGlobalLight;
uniform float uGlobalLightI;
${FIELD_LIGHT_GLSL}
varying float vT;
varying vec3  vWorldPos;
varying float vAlpha;
varying vec3 vRadial;
uniform float uTime;

void main(){
  if (vAlpha < 0.01) discard;

  // Cross-section: bright TIR core, slight rim
  vec3 deep    = uWaterColor * 0.7;
  vec3 shallow = mix(uWaterColor, vec3(0.85, 0.95, 1.0), 0.55);
  vec3 col     = mix(shallow, deep, vT * 0.6);

  // Camera-facing longitudinal highlight, not a horizontal bright band.
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  float facing = abs(dot(normalize(vRadial), viewDir));
  float filament = pow(facing, 9.0);
  float flow = 0.92 + 0.08 * sin(vWorldPos.y * 42.0 - uTime * 24.0);
  col += filament * vec3(0.82, 0.92, 1.0) * 0.7;
  col *= flow;

      // RGB main light — subtle global tint only.
  // Main visible color must come from the physical fixture field below.
    float runtimeTint = clamp(uGlobalLightI * 1.1, 0.0, 0.92);
  float luminance = max(max(col.r, col.g), col.b);
  vec3 tintedCore = uGlobalLight * max(luminance, 0.40);

  col = mix(col, tintedCore, runtimeTint);
  col += uGlobalLight * uGlobalLightI * 0.25;

  // RGB fixture field (AF-3D-022): every fixture whose beam reaches this point —
  // cone x distance x forward scattering, linear HDR so bright beams bloom.
  col += flDensityNormalize(fieldLightN(vWorldPos, viewDir, ${HG_G.toFixed(2)}, 1.0, uFieldMaxGroups));   // AF-NEXT-013

  gl_FragColor = vec4(col, vAlpha * (0.55 + 0.45 * facing));
}`;

// ─── LOCALIZED LIT-VOLUME GLOW (camera-facing billboard above each jet) ──────
export const GLOW_VERT = /* glsl */`
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

export const GLOW_FRAG = /* glsl */`
precision highp float;
varying vec2  vUv;
varying vec3  vWorld;
uniform vec3  uColor;
uniform float uIntensity;
uniform float uTime;

void main(){
  vec2 c = vUv - 0.5;
  float horiz = 1.0 - smoothstep(0.03, 0.5, abs(c.x));
  // Reach zero at both quad edges. The previous *0.7 left a visible flat
  // rectangle at the top of each glowing jet.
  float vert = 1.0 - smoothstep(0.14, 0.5, abs(c.y));
  float shape = horiz * horiz * vert * vert;
  float pulse = 0.94 + sin(uTime * 2.1) * 0.06;
  float a = shape * uIntensity * pulse * 0.20;
  gl_FragColor = vec4(uColor, a);
}`;

// ─── WATER SURFACE — Gerstner + GGX + caustic + RGB light field ─────────────
export const WATER_VERT_V2 = /* glsl */`
uniform float uTime;
uniform float uIntensity;
uniform float uWind;
uniform mat4  uReflectMatrix;
uniform vec4  uRipples[${MAX_RIPPLES}];   // xy = centre, z = age (s), w = strength
uniform int   uRippleCount;
uniform sampler2D uHeightTex;
uniform float uHeightEnabled;
uniform float uHeightTexel;
uniform float uWaveExtent;
uniform float uWaveHeightScale;
varying vec2  vUv;
varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vDepth;
varying float vFoam;
varying vec4  vReflectCoord;
varying vec2  vLocalXZ;

vec3 gerstner(vec2 p, vec2 dir, float amp, float freq, float speed, float steep, float t){
  float phase = dot(dir, p) * freq + t * speed;
  float s = sin(phase), c = cos(phase);
  return vec3(steep * amp * dir.x * c, amp * s, steep * amp * dir.y * c);
}

void main(){
  vUv = uv;
  // Wave input must be the WORLD ground plane. A PlaneGeometry's local position lies
  // in XY with z identically zero, so the old position.xz fed every Gerstner term
  // (x, 0): each wave reduced to dir.x * x, varying along X and constant along Z.
  // The result was a set of parallel bands rather than a wave field — the surface
  // could never look like water no matter how the amplitudes were tuned.
  vec3 wp0 = (modelMatrix * vec4(position, 1.0)).xyz;
  vec2 P   = wp0.xz;
  float I  = max(uIntensity, 0.2);
  vec3 w1 = gerstner(P, normalize(vec2( 1.0, 0.6)), 0.035*I, 2.1, 1.20, 0.8, uTime);
  vec3 w2 = gerstner(P, normalize(vec2(-0.7, 1.0)), 0.028*I, 1.8, 0.90, 0.6, uTime*0.85);
  vec3 w3 = gerstner(P, normalize(vec2( 0.3,-1.0)), 0.018*I, 3.5, 1.80, 0.4, uTime*1.15);
  vec3 w4 = gerstner(P, normalize(vec2(-1.0, 0.4)), 0.012*I, 4.8, 2.40, 0.3, uTime*0.70);
  vec3 disp = w1 + w2 + w3 + w4;
  float dx = (w1.y + w2.y + w3.y) * 2.0;
  float dz = (w1.y + w2.y + w4.y) * 2.0;

  // ── Impact ripples (AF-3D-010) ──
  // Expanding rings where the jets ACTUALLY land, sourced from the same impact
  // events the splash map records. Ambient wave trains make a pool look animated
  // but inert; rings appearing under a running jet are what tie the surface to the
  // show. The slope is differentiated analytically rather than sampled, so the
  // normal stays exact — a ripple visible in the reflection but not in the shading
  // reads as a decal painted on glass.
  float ripple = 0.0;
  for (int i = 0; i < ${MAX_RIPPLES}; i++) {
    if (i >= uRippleCount) break;
    vec2  d     = P - uRipples[i].xy;
    float r     = length(d) + 1e-4;
    float age   = uRipples[i].z;
    float front = age * 1.7;                    // ring travel, metres/second
    float env   = exp(-abs(r - front) * 3.2)    // energy stays at the wavefront
                * exp(-age * 1.15)              // and decays with age
                * uRipples[i].w;
    float k     = 9.0;
    float phase = (r - front) * k;
    ripple += sin(phase) * env * 0.05;
    float dhdr = cos(phase) * k * env * 0.05;
    dx += dhdr * (d.x / r) * 2.0;
    dz += dhdr * (d.y / r) * 2.0;
  }
  disp.y += ripple;

  // Coupled shallow-water field. Unlike the readable ring accents above, this grid
  // exchanges energy between neighbouring cells, so simultaneous jet landings
  // interfere and reflect from the real basin boundary.
  float coupledWave = 0.0;
  if (uHeightEnabled > 0.5) {
    vec2 huv = P / uWaveExtent + 0.5;
    if (huv.x >= 0.0 && huv.x <= 1.0 && huv.y >= 0.0 && huv.y <= 1.0) {
      float hc = (texture2D(uHeightTex, huv).r * 2.0 - 1.0) * uWaveHeightScale;
      float hl = (texture2D(uHeightTex, huv - vec2(uHeightTexel, 0.0)).r * 2.0 - 1.0) * uWaveHeightScale;
      float hr = (texture2D(uHeightTex, huv + vec2(uHeightTexel, 0.0)).r * 2.0 - 1.0) * uWaveHeightScale;
      float hd = (texture2D(uHeightTex, huv - vec2(0.0, uHeightTexel)).r * 2.0 - 1.0) * uWaveHeightScale;
      float hu = (texture2D(uHeightTex, huv + vec2(0.0, uHeightTexel)).r * 2.0 - 1.0) * uWaveHeightScale;
      coupledWave = hc;
      disp.y += coupledWave;
      dx += (hr - hl) / max(2.0 * uHeightTexel * uWaveExtent, 0.001);
      dz += (hu - hd) / max(2.0 * uHeightTexel * uWaveExtent, 0.001);
    }
  }

  vLocalXZ = P;
  // World-space normal. The slope above is already expressed in world XZ, and the
  // fragment stage dots this against world-space view and light vectors — routing it
  // through normalMatrix (which maps object space to VIEW space) mixed two frames of
  // reference and quietly corrupted every fresnel, specular and refraction term.
  vNormal = normalize(vec3(-dx*1.8, 1.0, -dz*1.8));
  // Foam only where wave trains actually superpose near their combined maximum.
  // The old 0.02 threshold sat below every single crest, so daylight painted the
  // whole surface in ordered white rows — wave-pattern stripes, not foam.
  // Quiet pool waves do not form ocean whitecaps. Foam belongs to jet impacts.
  vFoam   = smoothstep(0.025, 0.09, abs(ripple) + abs(coupledWave) * 0.65) * 0.45;
  vDepth  = 1.0 - length(uv - 0.5) * 2.2;
  // Displacement is authored in world axes, so it is applied to the world position
  // directly rather than being pushed back through the model matrix.
  vec4 wp = vec4(wp0 + disp, 1.0);
  vWorldPos = wp.xyz;
  // Project against the FLAT plane, not the wave-displaced point: the mirror lives at
  // the mean waterline, and projecting the displaced position would double-count the
  // wave (once here, once via the normal perturbation in the fragment stage) and make
  // the reflection swim.
  vReflectCoord = uReflectMatrix * (modelMatrix * vec4(position, 1.0));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const WATER_FRAG_V2 = /* glsl */`
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
uniform sampler2D uFloorTex;      // basin lining, sampled through the refracted ray
uniform float uHasFloorTex;
uniform float uFloorY;            // basin floor height, world metres
uniform float uFloorScale;        // world metres per texture tile
uniform vec3  uAbsorb;            // Beer-Lambert extinction per metre, per channel
uniform vec4  uPoolShape;         // x: 1 = circular, y: radius, z: width, w: length
// AF-NEXT-013 (defaults to 0 when the material does not declare it):
uniform float uEcoWater;            // 1 = eco tier: 4 nearest fixtures, no refraction ray
${FIELD_LIGHT_GLSL}
varying vec2  vUv;
varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vDepth;
varying float vFoam;
varying vec4  vReflectCoord;
varying vec2  vLocalXZ;

void main(){
  // A circular basin is drawn as a tessellated plane and cut to shape here. A fan
  // (CircleGeometry) has vertices only on its rim, so wave displacement and ripples
  // had nothing to move — the round pools were flat by construction.
  if (uPoolShape.x > 0.5 && length(vLocalXZ) > uPoolShape.y) discard;

  float depth = clamp(vDepth, 0.0, 1.0);
  float absorption = exp(-depth * 2.5);
  vec3  base = mix(uDeepColor, uShallowColor, pow(1.0 - absorption, 0.7));

  vec3 viewIn = normalize(vWorldPos - uCameraPos);

  // ── Refraction through the surface onto the basin floor (AF-3D-009) ──
  // Reflection alone cannot make a basin read as water: looking down, fresnel says
  // you see THROUGH it, and what you see is the lining, displaced by the waves. The
  // basin is a known flat plane, so the refracted ray can be intersected with it
  // analytically — no second scene pass, and the wobble is physically the right
  // shape rather than a scrolling normal-map trick.
  float causticsFloor = 0.0;
  if (uHasFloorTex > 0.5 && uEcoWater < 0.5) {
    vec3 rdir = refract(viewIn, normalize(vNormal), 1.0 / 1.333);
    if (rdir.y < -1e-3) {
      float t   = (uFloorY - vWorldPos.y) / rdir.y;
      vec3  hit = vWorldPos + rdir * t;
      // World-space tiling: the lining is seamless, so this avoids having to match
      // the floor mesh's own UV layout for two different pool shapes.
      vec3 floorCol = texture2D(uFloorTex, hit.xz / uFloorScale).rgb;

      // Caustics belong HERE — focused light on the floor — not painted on the
      // surface as they were before. Animated in world space so they stay put as
      // the camera orbits.
      float k1 = sin(hit.x * 3.1 + uTime * 1.1) * cos(hit.z * 2.6 + uTime * 0.85);
      float k2 = sin(hit.x * 2.0 - uTime * 1.3) * cos(hit.z * 2.2 + uTime * 0.65);
      causticsFloor = pow(max(k1 * k2, 0.0), 2.0) * 0.9;
      floorCol *= 1.0 + causticsFloor * 2.2;
      floorCol += causticsFloor * uLightColor * uLightIntensity * 0.5;

      // Beer-Lambert along the real path length: red is stripped first, which is
      // why deep water goes blue-green rather than merely darker.
      float pathLen = length(hit - vWorldPos);
      vec3  trans   = exp(-uAbsorb * pathLen);
      // Submerged lining receives filtered skylight, not unlit albedo at full
      // contrast. A little suspended-water scattering softens the tile pattern.
      vec3 submerged = floorCol * mix(vec3(0.12), vec3(0.55), clamp(uSkyColor * 2.0, 0.0, 1.0));
      base = mix(submerged * trans + uDeepColor * (1.0 - trans), uShallowColor, 0.28);
    }
  }

  // Surface-level shimmer, kept subtle now that the real caustics live on the floor.
  float c3 = sin((vUv.x + vUv.y) * 9.0 + uTime * 0.9) * 0.5;
  float caustics = pow(max(c3, 0.0), 3.0) * 0.2 + causticsFloor * 0.25;

    // Main light caustic tint
  base += caustics * uLightColor * uLightIntensity * 0.7;

  // Per-fixture light field — pool surface receives bleeds + specular tint
  // The surface sits just above the fixtures, so it takes their omni glow (cone off)
  // and no scattering phase — it is a reflector, not a scattering medium.
  vec4 fieldN = fieldLightN(vWorldPos, normalize(uCameraPos - vWorldPos), 0.0, 0.0, uEcoWater > 0.5 ? 1.0 : uFieldMaxGroups);
  // AF-NEXT-013: many overlapping fixtures are energy-normalised by their local
  // overlap count (1-2 fixtures untouched), then the AF-3D-022 soft knee compresses
  // what remains so the pool saturates toward the fixture colour instead of white.
  vec3 fieldContrib = flSurfaceKnee(flDensityNormalize(fieldN));

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

  // The fixture light the surface shows: realistic bleed (a visible reflection, not a
  // full material recolour), caustic modulation, the strength-weighted lift and the
  // coloured specular spike under strong RGB fixtures. Summed first so that, where
  // more than two fixtures overlap, the TOTAL is capped hue-preservingly
  // (flDenseSurface, AF-NEXT-013); for 1-2 fixtures it is the same sum as before.
  float fieldStrength = clamp(length(fieldContrib), 0.0, 1.0);
  vec3 fixtureLight = fieldContrib * (0.95 + caustics * 1.35 + 1.4 * fieldStrength + ggx * 1.8);
  base += flDenseSurface(fixtureLight, fieldN.a);

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
export const FOG_VERT = /* glsl */`
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

export const FOG_FRAG = /* glsl */`
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
export const LASER_VERT = /* glsl */`
varying float vPos;
void main(){
  vPos = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
export const LASER_FRAG = /* glsl */`
precision highp float;
uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
varying float vPos;
void main(){
  float glow  = exp(-abs(vPos - 0.5) * 8.0);
  float flick = 0.85 + sin(uTime * 40.0) * 0.15;
  float a = uIntensity * flick * (0.6 + glow * 0.4);
  gl_FragColor = vec4(uColor + glow * 0.5, a * 0.9);
}`;
