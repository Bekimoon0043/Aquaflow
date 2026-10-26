/**
 * lightCones.js — AF-3D-005 (realism plan, Phase R1)
 *
 * Volumetric beam cones for the submersible RGB fixtures — the single most
 * recognisable element of the Depence night look. A real underwater fixture
 * fires a visible shaft of coloured light up through the spray; the preview's
 * light FIELD tinted the droplets it touched but drew no beam, so a lit fountain
 * read as "coloured water" instead of "light through water".
 *
 * Each field light gets an upward-opening cone shell shaded as a cheap analytic
 * volume:
 *   • optical-depth term — brightest where the view ray crosses the most cone
 *     (facing fragments), vanishing at the silhouette;
 *   • axial falloff — the beam dies with height as water absorbs and spray thins;
 *   • scrolling haze noise so the shaft shimmers rather than sitting frozen;
 *   • soft-depth fade against the opaque scene (same probe the particles use),
 *     so the cone never hard-clips through the pool rim;
 *   • intensity scaled by SPRAY ACTIVITY — a light beam is only visible where
 *     there is medium to scatter it, so beams bloom when the jets run and almost
 *     vanish over still water. This is the honest physics and also the
 *     show-design payoff: light cues and water cues visibly interact.
 *
 * Additive, depthWrite off, one draw per active light (max 16).
 */

import { bladePlanesOf, bladeSoftnessOf, MAX_BLADES } from "./lightFraming.js";

const CONE_VERT = /* glsl */ `
varying vec3  vWorld;
varying vec3  vNormal;
varying float vH;        // 0 at the fixture, 1 at the beam tip
varying float vViewZ;
void main(){
  vH = position.y;       // geometry is unit-height with y in [0,1]
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vec4 mv = viewMatrix * wp;
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const CONE_FRAG = /* glsl */ `
precision highp float;
varying vec3  vWorld;
varying vec3  vNormal;
varying float vH;
varying float vViewZ;

uniform vec3  uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;
uniform vec3  uCameraPos;

uniform sampler2D uSceneDepth;
uniform float uUseDepth;
uniform vec2  uInvRes;
uniform float uNear;
uniform float uFar;
// Framing blades (lightFraming.js): world planes n.xyz, w — kept where n·p + w >= 0.
uniform vec4  uBlades[${MAX_BLADES}];
uniform float uBladeCount;
uniform float uBladeSoft;

void main(){
  if (uIntensity < 0.004) discard;
  float blade = 1.0;
  for (int b = 0; b < ${MAX_BLADES}; b++) {
    if (float(b) >= uBladeCount) break;
    float s = dot(uBlades[b].xyz, vWorld) + uBlades[b].w;
    blade *= uBladeSoft > 0.0 ? smoothstep(0.0, uBladeSoft, s) : step(0.0, s);
  }
  if (blade < 0.002) discard;

  vec3 V = normalize(uCameraPos - vWorld);

  // Optical depth through the cone: a view ray through the centre crosses far more
  // glowing medium than one grazing the silhouette. dot(V, N) is exactly that cue —
  // 1 facing the camera (centre), 0 at the rim.
  float body = clamp(dot(V, vNormal), 0.0, 1.0);
  body = pow(body, 1.35);

  // The beam dies with height: absorption plus thinning spray.
  float axial = pow(1.0 - vH, 1.7);
  // …and is not born as a hard disc at the waterline.
  float base = smoothstep(0.0, 0.05, vH);

  // Scrolling haze — two incommensurate waves against height and azimuth-ish
  // world position, per-light phase offset so 16 beams never pulse in unison.
  float n1 = sin(vH * 21.0 - uTime * 1.9 + uSeed * 17.0);
  float n2 = sin((vWorld.x + vWorld.z) * 3.1 + vH * 9.0 + uTime * 1.1 + uSeed * 9.0);
  float haze = 0.78 + 0.14 * n1 + 0.08 * n2;

  float a = uIntensity * body * axial * base * haze * blade;

  // Soft fade against the opaque scene, so the shaft dissolves at the pool rim
  // instead of clipping through it.
  if (uUseDepth > 0.5) {
    vec2  suv    = gl_FragCoord.xy * uInvRes;
    float sceneD = texture2D(uSceneDepth, suv).x;
    float sceneZ = (uNear * uFar) / ((uFar - uNear) * sceneD - uFar);
    float diff   = vViewZ - sceneZ;
    a *= clamp(diff / 0.8, 0.0, 1.0);
  }

  gl_FragColor = vec4(uColor * a, a);
}`;

export class LightConeSet {
  /**
   * @param {object} T the three namespace
   * @param {number} maxLights matches MAX_FIELD_LIGHTS in the scene
   */
  constructor(T, maxLights = 16) {
    this.T = T;
    this.group = new T.Group();
    this.group.name = "lightCones";
    this.cones = [];

    // Unit cone: narrow at the fixture (y=0), opening upward to y=1. Open-ended —
    // caps would draw hard discs at both ends of a volume that has none.
    const geo = new T.CylinderGeometry(1.0, 0.16, 1.0, 24, 1, true);
    geo.translate(0, 0.5, 0);   // y ∈ [0,1], base at origin
    this._geo = geo;

    for (let i = 0; i < maxLights; i++) {
      const mat = new T.ShaderMaterial({
        vertexShader: CONE_VERT,
        fragmentShader: CONE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,
        side: T.FrontSide,
        fog: false,
        uniforms: {
          uColor: { value: new T.Color(1, 1, 1) },
          uIntensity: { value: 0 },
          uTime: { value: 0 },
          uSeed: { value: i / Math.max(1, maxLights - 1) },
          uCameraPos: { value: new T.Vector3() },
          uSceneDepth: { value: null },
          uUseDepth: { value: 0.0 },
          uInvRes: { value: new T.Vector2(1, 1) },
          uNear: { value: 0.1 },
          uFar: { value: 500 },
          uBlades: { value: Array.from({ length: MAX_BLADES }, () => new T.Vector4(0, 0, 0, 0)) },
          uBladeCount: { value: 0 },
          uBladeSoft: { value: 0 },
        },
      });
      const mesh = new T.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.cones.push(mesh);
    }
  }

  /** Bind (or unbind, with null) the scene-depth probe all cones fade against. */
  setDepth(texture, invResX, invResY, near, far) {
    for (const cone of this.cones) {
      const u = cone.material.uniforms;
      u.uSceneDepth.value = texture || null;
      u.uUseDepth.value = texture ? 1.0 : 0.0;
      u.uInvRes.value.set(invResX || 1, invResY || 1);
      u.uNear.value = near ?? 0.1;
      u.uFar.value = far ?? 500;
    }
  }

  /**
   * Drive the cones from the live light list, once per frame.
   *
   * @param {Array}  lights   [{x, z, color: THREE.Color, intensity, radius}] — the
   *                          same records that feed the shader light field
   * @param {number} elapsed  scene time, seconds
   * @param {number} activity 0..1 — how much water/spray is currently in the air
   * @param {object} camera   the live camera (for the view-dependent volume term)
   */
  update(lights, elapsed, activity, camera) {
    const list = Array.isArray(lights) ? lights : [];
    const act = Math.max(0, Math.min(1, activity ?? 0));
    for (let i = 0; i < this.cones.length; i++) {
      const cone = this.cones[i];
      const L = list[i];
      const fieldI = L ? Math.max(0, Number(L.intensity || 0)) : 0;
      // A beam needs medium to scatter in: dim over still water, full through spray.
      const beamI = fieldI * (0.20 + 0.80 * act) * 0.035;
      if (!L || beamI < 0.004) {
        cone.visible = false;
        continue;
      }
      cone.visible = true;
      const radius = Math.max(1, Number(L.radius || 6));
      const height = Math.min(6.5, 2.0 + radius * 0.55);
      cone.position.set(L.x || 0, (Number(L.y) > 0 ? Number(L.y) : 0) + 0.04, L.z || 0);
      cone.scale.set(radius * 0.16, height, radius * 0.16);
      // Aimed light: the unit-height beam (+y) turns to the aim; upright otherwise.
      const a = L.aimDir;
      if (Array.isArray(a)) {
        this._aim = this._aim || { up: cone.up.clone().set(0, 1, 0), d: cone.up.clone() };
        cone.quaternion.setFromUnitVectors(this._aim.up, this._aim.d.set(a[0], a[1], a[2]).normalize());
      } else cone.quaternion.identity();
      const u = cone.material.uniforms;
      u.uColor.value.copy(L.color);
      u.uIntensity.value = Math.min(0.9, beamI);
      // Blades cut the drawn beam volume along their planes (cached per framing object).
      const planes = L.framing ? this._planesOf(L) : null;
      u.uBladeCount.value = planes ? planes.length : 0;
      u.uBladeSoft.value = planes ? bladeSoftnessOf(L) : 0;
      if (planes) planes.forEach((pl, k) => u.uBlades.value[k].set(pl.n[0], pl.n[1], pl.n[2], pl.w));
      u.uTime.value = elapsed;
      if (camera) u.uCameraPos.value.copy(camera.position);
    }
  }

  /** World blade planes of a light, cached on (framing, x, z). */
  _planesOf(L) {
    const c = this._planeCache || (this._planeCache = new WeakMap());
    const hit = c.get(L.framing);
    if (hit && hit.x === L.x && hit.z === L.z) return hit.planes;
    const planes = bladePlanesOf(L);
    c.set(L.framing, { x: L.x, z: L.z, planes });
    return planes;
  }

  dispose() {
    for (const cone of this.cones) cone.material.dispose();
    this._geo.dispose();
    this.group.parent?.remove(this.group);
  }
}
