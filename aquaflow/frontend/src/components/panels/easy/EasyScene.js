// EasyScene — the big 3D space of the Easy Fountain Design window (plain three.js).
//
// The panel owns the data and calls setData(); this class only draws and reports what the user
// does with the mouse:
//   drop an asset from the tray       → handlers.onDrop(key, {x, z})
//   click an item / a line / nothing  → handlers.onSelect(id) / onSelectLink(linkId) / onSelect(null)
//   drag an item                       → handlers.onMoveEnd(id, {x, z})          (live while dragging)
//   drag a plug at a line's end        → handlers.onReplug(linkId, end, targetId | null)
// World frame: x right, y up, z = plan depth (geometryContract: world z === engineering y).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { loadEquipmentAsset } from "../../preview/equipmentAssets";
import { laserFrame } from "../../preview/laser/laserRig";
import { sampleCameraTrack } from "../../preview/camera/cameraTrack";

const G = 9.81;
const MODEL_SCALE = 1;            // equipment at its real size; the coloured base disc keeps small parts easy to grab
const MAX_PARTICLES = 42000;
const ROLE_COLOR = { pump: 0x38bdf8, valve: 0xa78bfa, nozzle: 0x5eead4, light: 0xfacc15, effect: 0xfb923c };
const LINK_COLOR = { pump: 0x38bdf8, valve: 0xa78bfa, light: 0xfacc15 };
const PORT_Y = 0.18;
const DRAG = 0.35;                  // 1/s: air drag on the drops' horizontal speed
const SPLASH_S = 0.45;
const BASKET_RAD_S = 2.4;           // rotating basket speed (rad/s, about 23 rpm)              // how long a landing splash lasts (s)
const MAX_BEAM_VERTS = 6 * 2400;   // 2 400 ribbon quads
const MAX_DOTS = 3000;
const MAX_FLAME = 9000;
const MAX_FOG = 2400;
const BEAM_DRAW_M = 70;             // beams are drawn this far (they fade into the night sky)
const MAX_MIST = 36000;
const MAX_LAMPS = 2400;
// Show lighting (Studio renderer). Water is seen only by the light it scatters: city glow alone
// leaves an unlit jet a faint grey ghost, as at night on a real lake.
const AMBIENT = [0.012, 0.015, 0.022];
const WATER_GAIN = 0.42;            // soft drops (the spray volume)
const STREAK_GAIN = 0.75;           // exposure streaks (the continuous stream a camera sees)
const EXPOSURE_S = 1 / 40;          // a night camera's shutter: a 20 m/s drop smears 0.5 m
const MIST_GAIN = 0.2;
const POOL_GAIN = 0.85;
const BEAM_TAN = 0.4;               // underwater lamp beam: ~45° full angle
const LAMP_DEPTH = 0.25;            // underwater lamps sit this far below the surface
const WIND = { x: 0.7, z: 0.25 };   // m/s: drifting spray

/** Visible lamp output with or without water: lens bloom + light pool on the basin surface. */
export function showLampLevels(lampLevel, waterLevel = 0, heightM = 4) {
  const k = Math.max(0, Math.min(1, Number(lampLevel) || 0));
  const water = Math.max(0, Math.min(1, Number(waterLevel) || 0));
  const H = Math.max(1, Number(heightM) || 4);
  return { pool: k * (0.8 + 0.012 * H) * (0.35 + 0.65 * water), lens: k * (1.6 + 0.8 * water),
    radius: 1.8 + 0.05 * H * (0.3 + 0.7 * water), lensSize: 0.65 + 0.04 * H };
}

/** Keep dense lamp artwork readable by limiting total light per square metre of pool. */
export function showLightExposure(pool, activeLamps) {
  const points = pool?.shape === "poly" ? pool.points || [] : [];
  let area = 0;
  if (points.length > 2) for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]; area += a.x * b.z - b.x * a.z;
  }
  area = Math.abs(area) / 2;
  if (pool?.shape === "circle") area = Math.PI * Number(pool.radius || 0) ** 2;
  if (pool?.shape === "ellipse") area = Math.PI * Number(pool.rx || 0) * Number(pool.ry || 0);
  if (!(area > 0) || !(activeLamps > 0)) return { area, density: 0, poolScale: 1, lensScale: 1 };
  const density = activeLamps / area;
  const poolScale = Math.min(1, 0.25 / density);
  return { area, density, poolScale, lensScale: Math.max(0.35, Math.sqrt(poolScale)) };
}

/**
 * Basin water: a planar mirror (Reflector) seen through gentle animated ripples, with a Fresnel
 * blend — mirror-like at grazing angles, the dark water body when looking straight down — as in
 * show-visualisation renders where jets, lights and beams reflect in the pool.
 */
export const WATER_SHADER = {
  name: "AquaFlowWater",
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    time: { value: 0 }, waterColor: { value: new THREE.Color(0x041c30) },
    // 0 = a calm mirror (design view); > 0 stretches reflections into vertical glitter streaks,
    // as wind-rippled water does with lit jets on a lake at night.
    streak: { value: 0 }, waveScale: { value: 1 }, reflectionStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform vec3 waterColor;
    uniform float streak;
    uniform float waveScale;
    uniform float reflectionStrength;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec3 w = vWorld / waveScale;
      vec2 rip = vec2(
        sin(w.x * 3.1 + time * 1.7) + sin(w.z * 4.3 - time * 1.3) + 0.5 * sin((w.x - w.z) * 9.0 + time * 2.9),
        cos(w.z * 2.7 + time * 1.1) + sin((w.x + w.z) * 5.0 + time * 2.3) + 0.5 * cos(w.x * 8.0 - time * 3.1)) * 0.0028;
      // Gusts: the wave height varies across the lake, so ripples are never a regular pattern.
      float gust = 0.55 + 0.9 * pow(sin(w.x * 0.37 + w.z * 0.53 + time * 0.21) * sin(w.x * 0.11 - w.z * 0.19 + 1.7), 2.0);
      vec4 uv = vUv;
      uv.xy += rip * uv.w * mix(1.0, gust * 1.6, step(0.0001, streak));
      vec3 refl;
      if (streak > 0.0) {
        // Each wave facet tilts a little toward the camera, so a light's reflection smears into
        // a long vertical streak, broken into bands by the wave crests.
        refl = vec3(0.0);
        float wsum = 0.0;
        for (int i = -4; i <= 4; i++) {
          float fi = float(i);
          float k = exp(-fi * fi / 7.0);
          vec4 u2 = uv;
          u2.y += fi * streak * uv.w * (0.75 + 0.25 * sin(w.x * 1.7 + fi * 1.3 + time));
          refl += texture2DProj(tDiffuse, u2).rgb * k;
          wsum += k;
        }
        refl /= wsum;
        float crest = sin(w.z * 2.1 + 1.6 * sin(w.x * 0.7 + time * 0.35) + time * 1.4);
        refl *= 0.55 + 0.9 * smoothstep(-0.35, 0.9, crest);
      } else {
        refl = texture2DProj(tDiffuse, uv).rgb;
      }
      vec3 viewDir = normalize(cameraPosition - vWorld);
      float fres = (0.18 + 0.82 * pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 3.0)) * reflectionStrength;
      gl_FragColor = vec4(mix(waterColor, refl * color, fres), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

const SKY_SHADER = {
  uniforms: { top: { value: new THREE.Color(0x01030a) }, horizon: { value: new THREE.Color(0x0d2140) }, glow: { value: new THREE.Color(0x1b3157) } },
  vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; varying vec3 vDir;
    void main() {
      float h = clamp(vDir.y, -0.2, 1.0);
      vec3 c = mix(horizon, top, pow(max(h, 0.0), 0.55));
      c += glow * 0.45 * exp(-abs(h) * 14.0);          // city-light glow along the horizon
      gl_FragColor = vec4(c, 1.0);
    }`,
};

function roundSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Spray mist: soft round puffs of any size (per-puff world diameter), lit colour already in
 * `tint`, added onto the night like glowing fog.
 */
function mistMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { projScale: { value: 500 } },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute vec3 tint;
      uniform float projScale;
      varying vec3 vTint;
      void main() {
        vTint = tint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = min(900.0, size * projScale / max(0.5, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vTint;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r2 = dot(d, d) * 4.0;
        if (r2 > 1.0) discard;
        gl_FragColor = vec4(vTint * (exp(-r2 * 3.0) - 0.05), 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** The glowing pool an underwater lamp makes on the lake surface (and the aerated boil above it). */
function poolGlowSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.14)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textSprite(text, color = "#e2e8f0") {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = "600 28px system-ui, sans-serif";
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = 44;
  g.font = font;
  g.fillStyle = "rgba(8,15,25,0.72)";
  g.beginPath();
  g.roundRect?.(0, 0, w, 44, 10);
  if (g.roundRect) g.fill(); else g.fillRect(0, 0, w, 44);
  g.fillStyle = color;
  g.textBaseline = "middle";
  g.fillText(text, 12, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Constant size on screen (not in metres), so close-ups are not covered by giant name tags.
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false });
  const s = new THREE.Sprite(mat);
  const k = 0.026 / 44;
  s.scale.set(w * k, 44 * k, 1);
  s.center.set(0.5, 0);
  s.renderOrder = 10;
  return s;
}

function placeholder(role) {
  const color = ROLE_COLOR[role] ?? 0x94a3b8;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.45 });
  let geo;
  if (role === "pump") geo = new THREE.CylinderGeometry(0.2, 0.22, 0.45, 20).translate(0, 0.225, 0);
  else if (role === "valve") geo = new THREE.BoxGeometry(0.16, 0.16, 0.16).translate(0, 0.08, 0);
  else if (role === "light") geo = new THREE.CylinderGeometry(0.1, 0.12, 0.1, 20).translate(0, 0.05, 0);
  else if (role === "nozzle") geo = new THREE.CylinderGeometry(0.03, 0.06, 0.2, 14).translate(0, 0.1, 0);
  else geo = new THREE.BoxGeometry(0.3, 0.25, 0.3).translate(0, 0.125, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Where a moving nozzle's head points at time tau (world frame) and how far its head has spun.
 *   1D  one swing axis: tilt in the vertical plane of the fixture's facing
 *   2D  tilt + rotation: anywhere in the cone; rotation limited to the pan range
 *   3D  as 2D, plus the head spins (its outlets are splayed round the head axis)
 * Each drop keeps the direction it left with, so the water traces the motion.
 * @returns {{ ax, ay, az, spin, lift }}
 */
function motionState(m, rot, tau) {
  const w = 2 * Math.PI * m.speedHz;
  const amp = ((m.range / 2) * Math.PI) / 180;
  const panHalf = ((m.pan / 2) * Math.PI) / 180;
  const fullPan = m.pan >= 359;
  // Rotation within the pan range: full turns with a slip ring, else back and forth.
  const turn = (a) => (fullPan ? a : panHalf * Math.sin(a));
  let tx = 0, tz = 0;                              // tilt as a 2-vector (radians) in the fixture frame
  switch (m.axes >= 2 ? m.pattern : (m.pattern === "wave" ? "wave" : "sweep")) {
    case "wave": tx = amp * Math.sin(w * tau + m.phase); break;
    case "circle": { const a = turn(w * tau); tx = amp * 0.8 * Math.cos(a); tz = amp * 0.8 * Math.sin(a); break; }
    case "figure8": tx = amp * Math.sin(w * tau); tz = amp * 0.55 * Math.sin(2 * w * tau); break;
    case "cross": {
      const a = amp * Math.sin(w * tau);
      if (Math.floor((w * tau) / (2 * Math.PI)) % 2) tz = a; else tx = a;
      break;
    }
    case "dance":                                  // smooth and non-repeating: incommensurate sines
      tx = amp * (0.6 * Math.sin(w * tau) + 0.4 * Math.sin(1.73 * w * tau + 1.1));
      tz = amp * (0.6 * Math.sin(1.31 * w * tau + 0.4) + 0.4 * Math.sin(2.17 * w * tau));
      break;
    case "spiral": {
      const a = turn(w * tau), r = amp * (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(0.23 * w * tau)));
      tx = r * Math.cos(a); tz = r * Math.sin(a);
      break;
    }
    case "sweep":
    default: tx = amp * Math.sin(w * tau);
  }
  const th = Math.min(Math.PI / 2, Math.hypot(tx, tz));
  const ph = rot + Math.atan2(tz, tx);
  const st = Math.sin(th);
  return { ax: st * Math.cos(ph), ay: Math.cos(th), az: st * Math.sin(ph),
    spin: (m.spinRpm / 60) * 2 * Math.PI * tau,
    lift: m.liftM ? m.liftM * (0.5 + 0.5 * Math.sin(0.5 * w * tau)) : 0 };
}

/** Direction of outlet k of n on a head with axis (ax, ay, az), splayed `splay` rad and spun `spin` rad. */
function outletDir(st, k, n, splay, out) {
  if (!(splay > 0) || n <= 1) { out[0] = st.ax; out[1] = st.ay; out[2] = st.az; return out; }
  // Basis (u, v) perpendicular to the head axis.
  let ux = -st.az, uz = st.ax;
  const uy = 0;
  let l = Math.hypot(ux, uz);
  if (l < 1e-6) { ux = 1; uz = 0; l = 1; }
  ux /= l; uz /= l;
  const vx = st.ay * uz - st.az * uy, vy = st.az * ux - st.ax * uz, vz = st.ax * uy - st.ay * ux;
  const a = st.spin + (2 * Math.PI * k) / n, c = Math.cos(splay), s = Math.sin(splay);
  out[0] = c * st.ax + s * (Math.cos(a) * ux + Math.sin(a) * vx);
  out[1] = c * st.ay + s * (Math.cos(a) * uy + Math.sin(a) * vy);
  out[2] = c * st.az + s * (Math.cos(a) * uz + Math.sin(a) * vz);
  return out;
}

/** Outlets of a jet: fixed directions (th, ph) or `at(τ)` for moving / rotating ones. */
export function outletsOf(jet, t, rot, src = null) {
  const kind = jet.kind;
  const out = [];
  if (jet.motion) {
    const m = jet.motion, n = Math.max(1, m.outlets || 1);
    for (let k = 0; k < n; k += 1) out.push({ motion: m, k, n, splay: ((m.splayDeg || 0) * Math.PI) / 180, spread: 0.02 });
  } else if (kind === "basket") {
    const n = Math.max(2, jet.outlets || 3);
    for (let i = 0; i < n; i += 1) out.push({ basket: true, th: 0.32, ph0: (i * Math.PI * 2) / n, spread: 0.03 });
  } else if (jet.vario) {
    // Vario jet: a core column plus two rings of outlets whose cone opens with the fan_angle channel
    // (degrees of full opening; 0 = a thin column) — column → flame → wide V → column.
    const open = src?.fan ? Math.max(0, Math.min(100, src.fan(jet.id, t))) : 0;
    // engineering.varioSpanDeg: the full V at 100 (default 40°); a wide cone also gets a thick third ring.
    const span = jet.varioSpanDeg > 0 ? jet.varioSpanDeg : 40;
    const half = ((open / 100) * (span / 2) * Math.PI) / 180;
    out.push({ th: 0, ph: 0, spread: 0.012 + half * 0.08 });
    if (half > 0.02) {
      for (let i = 0; i < 14; i += 1) out.push({ th: half, ph: (i * Math.PI * 2) / 14, spread: 0.02 + half * 0.1 });
      for (let i = 0; i < 8; i += 1) out.push({ th: half * 0.5, ph: (i * Math.PI * 2) / 8 + 0.2, spread: 0.02 });
    }
    if (half > 0.4) for (let i = 0; i < 12; i += 1) out.push({ th: half * 0.75, ph: (i * Math.PI * 2) / 12 + 0.1, spread: 0.05 + half * 0.08 });
  } else if (jet.bell) {
    // Mushroom / bell head: a ring of short jets thrown outward and falling into a dome.
    for (let i = 0; i < 20; i += 1) out.push({ th: 0.85, ph: (i * Math.PI * 2) / 20, spread: 0.02 });
  } else if (kind === "ring") {
    const n = 12;
    for (let i = 0; i < n; i += 1) out.push({ th: 0.42, ph: (i * Math.PI * 2) / n, spread: 0.03 });
  } else if (kind === "curtain") {
    const n = 11, fanScale = src?.fan ? Math.max(0.05, src.fan(jet.id, t) / 90) : 1;
    for (let i = 0; i < n; i += 1) {
      const a = (-0.75 + (1.5 * i) / (n - 1)) * fanScale;
      out.push({ th: Math.abs(a), ph: rot + (a < 0 ? Math.PI : 0), spread: 0.025 });
    }
  } else if (kind === "mist") {
    for (let i = 0; i < 16; i += 1) out.push({ th: 0.2 + (i % 4) * 0.25, ph: i * 2.39996, spread: 0.25, mist: true });
  } else if (kind === "jumping") {
    out.push({ th: 0.62, ph: rot, spread: 0.008, pulse: true });
  } else if (kind === "swing") {
    out.push({ th: 0.45 * Math.sin(t * 1.3), ph: rot, spread: 0.03 });
  } else if (kind === "geyser") {
    out.push({ th: 0, ph: 0, spread: 0.11, foam: true });
  } else if (jet.aimTiltDeg > 0) {
    // A fixed nozzle set at an angle (e.g. a diagonal "rainbow" jet): tilted toward its rotation.
    out.push({ th: (Math.min(80, jet.aimTiltDeg) * Math.PI) / 180, ph: rot, spread: 0.015 });
  } else {
    out.push({ th: 0, ph: 0, spread: kind === "shooter" ? 0.015 : 0.025 });
  }
  return out;
}

/** Aim of a swinging head (pan/tilt in degrees) in world space, for a fixture turned by `rot`. */
function showPose(pan, tilt, rot, roll = 0) {
  const a = (pan * Math.PI) / 180, b = (tilt * Math.PI) / 180;
  const x0 = Math.sin(a), z0 = Math.sin(b);
  return { ax: x0 * Math.cos(rot) - z0 * Math.sin(rot), ay: Math.cos(a) * Math.cos(b), az: x0 * Math.sin(rot) + z0 * Math.cos(rot), spin: (roll * Math.PI) / 180, lift: 0 };
}

export class EasyScene {
  /**
   * @param {HTMLElement} container
   * @param {object} handlers  design-mode callbacks (drop, select, move, re-plug)
   * @param {{ maxParticles?: number }} options  a show with ~1,000 jets needs far more drops than a design
   */
  constructor(container, handlers = {}, options = {}) {
    this.maxParticles = Math.max(MAX_PARTICLES, Number(options.maxParticles) || 0);
    this.container = container;
    this.handlers = handlers;
    this.items = new Map();        // id → { group, role, modelKind, data, label, modelToken }
    this.linkObjects = [];
    this.jetState = new Map();     // id → smoothed height
    this.data = { items: [], links: [], jets: [], pool: null };
    this.poolReflection = 1;
    this.drag = null;
    this.disposed = false;
    this.time = 0;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.domElement.style.display = "block";
    r.domElement.style.width = "100%";
    r.domElement.style.height = "100%";
    r.domElement.style.touchAction = "none";
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050b16);
    scene.fog = new THREE.Fog(0x0b1830, 70, 220);
    // Night sky dome with a horizon glow, and stars.
    const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16),
      new THREE.ShaderMaterial({ ...SKY_SHADER, uniforms: THREE.UniformsUtils.clone(SKY_SHADER.uniforms), side: THREE.BackSide, depthWrite: false, fog: false }));
    sky.renderOrder = -10;
    scene.add(sky);
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(1600 * 3);
    for (let i = 0; i < 1600; i += 1) {
      const u = Math.random(), v = 0.06 + Math.random() * 0.94, a = u * Math.PI * 2, r = Math.sqrt(1 - v * v);
      starPos[i * 3] = 380 * r * Math.cos(a); starPos[i * 3 + 1] = 380 * v; starPos[i * 3 + 2] = 380 * r * Math.sin(a);
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x9fb4d8, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 })));
    // Indirect lighting: lit water and flames light their surroundings in their own colour.
    this.glowLights = Array.from({ length: 6 }, () => {
      const l = new THREE.PointLight(0xffffff, 0, 14, 1.6);
      scene.add(l);
      return l;
    });

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    this.camera.layers.enable(1);
    this.camera.position.set(0, 11, 16);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 140;
    this.controls.screenSpacePanning = false;

    this.hemi = new THREE.HemisphereLight(0xc6e2ff, 0x1d2a20, 0.85);
    scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(12, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 80 });
    scene.add(sun);

    const ground = this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x27322b, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(120, 120, 0x3b4c5e, 0x2a3644);
    grid.position.y = -0.005;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);
    this.grid = grid;

    this.basin = new THREE.Group();
    scene.add(this.basin);
    this.itemRoot = new THREE.Group();
    scene.add(this.itemRoot);
    this.linkRoot = new THREE.Group();
    scene.add(this.linkRoot);
    this.coneRoot = new THREE.Group();
    scene.add(this.coneRoot);

    // Water particles.
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(this.maxParticles * 3);
    this.pCol = new Float32Array(this.maxParticles * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.sprite = roundSprite();
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.13, map: this.sprite, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 2;
    scene.add(this.particles);
    this.jitter = new Float32Array(this.maxParticles * 3);
    for (let i = 0; i < this.jitter.length; i += 1) this.jitter[i] = Math.random() * 2 - 1;

    // Show lighting: lit spray mist, and the glowing pools underwater lamps make on the lake.
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_MIST * 3), 3).setUsage(THREE.DynamicDrawUsage));
    mistGeo.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(MAX_MIST * 3), 3).setUsage(THREE.DynamicDrawUsage));
    mistGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(MAX_MIST), 1).setUsage(THREE.DynamicDrawUsage));
    mistGeo.setDrawRange(0, 0);
    this.mist = new THREE.Points(mistGeo, mistMaterial());
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 3;
    this.mist.visible = false;
    scene.add(this.mist);
    this.poolGlowTex = poolGlowSprite();
    this.poolGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: this.poolGlowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      MAX_LAMPS);
    this.poolGlow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.poolGlow.setColorAt(0, new THREE.Color(0));
    this.poolGlow.count = 0;
    this.poolGlow.frustumCulled = false;
    this.poolGlow.renderOrder = 1;
    this.poolGlow.visible = false;
    // Layer 1: on the surface itself, so the lake's mirror camera (layer 0 only) does not reflect it.
    this.poolGlow.layers.set(1);
    scene.add(this.poolGlow);
    // The lamp lens remains visible with the water off: a small hot core and soft optical aura.
    const lampGeo = new THREE.BufferGeometry();
    lampGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_LAMPS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    lampGeo.setAttribute("tint", new THREE.BufferAttribute(new Float32Array(MAX_LAMPS * 3), 3).setUsage(THREE.DynamicDrawUsage));
    lampGeo.setAttribute("size", new THREE.BufferAttribute(new Float32Array(MAX_LAMPS), 1).setUsage(THREE.DynamicDrawUsage));
    lampGeo.setDrawRange(0, 0);
    this.lampPoints = new THREE.Points(lampGeo, mistMaterial());
    this.lampPoints.frustumCulled = false;
    this.lampPoints.renderOrder = 4;
    this.lampPoints.visible = false;
    scene.add(this.lampPoints);
    // Exposure streaks: each drop also drawn as the short line it travels during a camera's shutter.
    const streakGeo = new THREE.BufferGeometry();
    streakGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.maxParticles * 6), 3).setUsage(THREE.DynamicDrawUsage));
    streakGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(this.maxParticles * 6), 3).setUsage(THREE.DynamicDrawUsage));
    streakGeo.setDrawRange(0, 0);
    this.streaks = new THREE.LineSegments(streakGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending }));
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 2;
    this.streaks.visible = false;
    scene.add(this.streaks);

    // Effects: laser beams (camera-facing ribbons), beam dots, flames and fog.
    const dyn = (count, itemSize) => new THREE.BufferAttribute(new Float32Array(count * itemSize), itemSize).setUsage(THREE.DynamicDrawUsage);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", dyn(MAX_BEAM_VERTS, 3));
    beamGeo.setAttribute("color", dyn(MAX_BEAM_VERTS, 3));
    beamGeo.setDrawRange(0, 0);
    this.beams = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 2;
    scene.add(this.beams);
    const pointsOf = (count, material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", dyn(count, 3));
      g.setAttribute("color", dyn(count, 3));
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, material);
      p.frustumCulled = false;
      p.renderOrder = 2;
      scene.add(p);
      return p;
    };
    this.dots = pointsOf(MAX_DOTS, new THREE.PointsMaterial({ size: 0.35, map: this.sprite, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flames = pointsOf(MAX_FLAME, new THREE.PointsMaterial({ size: 0.26, map: this.sprite, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fog = pointsOf(MAX_FOG, new THREE.PointsMaterial({ size: 2.6, map: this.sprite, vertexColors: true, transparent: true,
      opacity: 0.22, depthWrite: false }));

    // Selection ring, drop ghost, drag line.
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.renderOrder = 5;
    this.selRing.visible = false;
    scene.add(this.selRing);
    this.ghost = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.dragLine = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.dragLine.visible = false;
    scene.add(this.dragLine);
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    scene.add(this.hoverRing);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // Post-processing: bloom (bright water, lamps, beams and flames glow like on camera) + tone mapping.
    this.realistic = true;
    this.grid.visible = false;
    this.coneRoot.visible = false;
    try {
      this.composer = new EffectComposer(r);
      this.composer.addPass(new RenderPass(scene, this.camera));
      // Only the hottest cores bloom, so lit water keeps its colour instead of washing to white.
      this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } catch {
      this.composer = null;
    }

    this._bind();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this.frame = requestAnimationFrame(this._loop);
  }

  // ─── data ─────────────────────────────────────────────────────────────────

  /**
   * @param {{ items: Array<{id,label,role,modelKind,x,z,elevation,rotation,color,on,intensity,beamDeg}>,
   *           links: Array<{id,kind,from,to}>, jets: Array<{id,kind,heightM,color,intensity,outlets}>,
   *           pool: {shape,radius?,rx?,ry?,points?}, selectedId, selectedLinkId, showLinks, showLabels }} data
   */
  setData(data) {
    if (Object.hasOwn(data, "poolReflection")) this.setPoolReflection(data.poolReflection);
    this.data = { ...this.data, ...data };
    if ("pool" in data) {
      const poolKey = JSON.stringify(data.pool || null);
      if (poolKey !== this.poolKey) { this.poolKey = poolKey; this._buildBasin(data.pool); }
    }
    this._syncItems();
    this._buildLinks();
    this._buildCones();
    this._updateSelection();
  }

  _syncItems() {
    const seen = new Set();
    // Labels on every item while the design is small; on a busy design only the selected one.
    const busy = this.data.items.length > 16;
    for (const it of this.data.items) {
      seen.add(it.id);
      let rec = this.items.get(it.id);
      if (!rec || rec.role !== it.role || rec.modelKind !== it.modelKind) {
        if (rec) this._removeItem(it.id);
        rec = this._createItem(it);
      }
      const labelOn = this.data.showLabels !== false && (!busy || it.id === this.data.selectedId);
      if (rec.label !== `${it.label}|${labelOn}`) {
        if (rec.labelSprite) { rec.group.remove(rec.labelSprite); rec.labelSprite.material.map.dispose(); rec.labelSprite.material.dispose(); }
        rec.labelSprite = null;
        if (labelOn) {
          rec.labelSprite = textSprite(it.label);
          rec.labelSprite.position.y = (it.role === "pump" ? 0.75 : 0.45);
          rec.labelSprite.userData.fixtureId = it.id;
          rec.group.add(rec.labelSprite);
        }
        rec.label = `${it.label}|${labelOn}`;
      }
      rec.data = it;
      if (!(this.drag?.mode === "move" && this.drag.id === it.id && this.drag.moved)) {
        rec.group.position.set(it.x, it.elevation || 0, it.z);
      }
      rec.group.rotation.y = -((Number(it.rotation) || 0) * Math.PI) / 180;
      // A raised item (laser on a truss, elevated nozzle) stands on a mast down to the ground.
      const elev = Number(it.elevation) || 0;
      if (elev > 0.3) {
        if (!rec.pole) {
          rec.pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1, 10).translate(0, -0.5, 0),
            new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6, roughness: 0.4 }));
          rec.group.add(rec.pole);
        }
        rec.pole.scale.y = elev;
      } else if (rec.pole) {
        rec.group.remove(rec.pole);
        disposeObject(rec.pole);
        rec.pole = null;
      }
      rec.base.material.opacity = it.on === false ? 0.18 : 0.55;
      if (rec.lamp) {
        const k = it.on === false ? 0 : Math.max(0, Math.min(1, (it.intensity ?? 100) / 100));
        rec.lamp.material.color.set(it.color || "#ffffff");
        rec.lamp.material.opacity = 0.25 + 0.75 * k;
      }
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this._removeItem(id);
  }

  _createItem(it) {
    const group = new THREE.Group();
    group.userData.fixtureId = it.id;
    const base = new THREE.Mesh(new THREE.CircleGeometry(it.role === "pump" ? 0.45 : 0.22, 32),
      new THREE.MeshBasicMaterial({ color: ROLE_COLOR[it.role] ?? 0x94a3b8, transparent: true, opacity: 0.55, depthWrite: false }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.012;
    group.add(base);
    const ph = placeholder(it.role);
    group.add(ph);
    let lamp = null;
    if (it.role === "light") {
      lamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 10),
        new THREE.MeshBasicMaterial({ color: it.color || "#ffffff", transparent: true, opacity: 1 }));
      lamp.position.y = 0.12;
      group.add(lamp);
    }
    const rec = { group, base, model: ph, role: it.role, modelKind: it.modelKind, data: it, lamp, label: "", token: Symbol("model") };
    this._tagPickable(group, it.id);
    this.itemRoot.add(group);
    this.items.set(it.id, rec);
    if (it.modelKind) {
      const token = rec.token;
      loadEquipmentAsset(THREE, it.modelKind).then((asset) => {
        const cur = this.items.get(it.id);
        if (!asset || this.disposed || !cur || cur.token !== token) return;
        const model = asset.template.clone(true);
        model.scale.setScalar(MODEL_SCALE);
        model.userData.sharedAsset = true;
        cur.outletY = (asset.height || 0.15) * MODEL_SCALE;   // water leaves from the top of the real nozzle
        cur.rig = readRig(model);
        if (cur.rig.socketY != null) cur.outletY = cur.rig.socketY;
        cur.aim = null;
        group.remove(cur.model);
        disposeObject(cur.model);
        cur.model = model;
        group.add(model);
        this._tagPickable(group, it.id);
      }).catch(() => { /* keep the placeholder */ });
    }
    return rec;
  }

  _tagPickable(group, id) {
    group.traverse((o) => { o.userData.fixtureId = id; });
  }

  _removeItem(id) {
    const rec = this.items.get(id);
    if (!rec) return;
    this.itemRoot.remove(rec.group);
    disposeObject(rec.group);
    this.items.delete(id);
    this.jetState.delete(id);
  }

  _portOf(id) {
    const rec = this.items.get(id);
    if (!rec) return null;
    const p = rec.group.position;
    return new THREE.Vector3(p.x, p.y + PORT_Y, p.z);
  }

  _curve(a, b) {
    const d = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 0.25 + 0.12 * d;
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }

  _buildLinks() {
    for (const o of this.linkObjects) { this.linkRoot.remove(o); o.geometry.dispose(); o.material.dispose(); }
    this.linkObjects = [];
    if (this.data.showLinks === false) return;
    const dragging = this.drag?.mode === "replug" ? this.drag.link.id : null;
    for (const link of this.data.links) {
      const a = this._portOf(link.from), b = this._portOf(link.to);
      if (!a || !b) continue;
      const curve = this._curve(a, b);
      const selected = link.id === this.data.selectedLinkId;
      const color = LINK_COLOR[link.kind] ?? 0xffffff;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, link.kind === "light" ? 0.022 : (selected ? 0.06 : 0.04), 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: selected ? 0.9 : 0.35, transparent: true,
          opacity: dragging === link.id ? 0.15 : (link.kind === "light" ? 0.7 : 0.92), roughness: 0.4 }));
      tube.userData.linkId = link.id;
      this.linkRoot.add(tube);
      this.linkObjects.push(tube);
      // Plugs at both ends, a little way along the line so they are not hidden inside the model.
      for (const [end, t] of [["from", 0.1], ["to", 0.9]]) {
        if (dragging === link.id && this.drag.end === end) continue;
        const plug = new THREE.Mesh(new THREE.SphereGeometry(selected ? 0.15 : 0.12, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.8, roughness: 0.3 }));
        plug.position.copy(curve.getPoint(t));
        plug.userData.plug = { linkId: link.id, end };
        plug.renderOrder = 3;
        this.linkRoot.add(plug);
        this.linkObjects.push(plug);
      }
    }
  }

  _buildCones() {
    for (const c of [...this.coneRoot.children]) { this.coneRoot.remove(c); c.geometry.dispose(); c.material.dispose(); }
    for (const it of this.data.items) {
      if (it.role !== "light" || it.on === false) continue;
      const k = Math.max(0, Math.min(1, (it.intensity ?? 100) / 100));
      if (k <= 0) continue;
      // A short, faint beam: enough to show colour and aim without hiding the water.
      const beam = Math.max(5, Math.min(60, it.beamDeg || 40));
      const h = 1.3;
      const r = Math.tan((beam * Math.PI) / 360) * h;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 32, 1, true).translate(0, -h / 2, 0).rotateX(Math.PI),
        new THREE.MeshBasicMaterial({ color: it.color || "#ffffff", transparent: true, opacity: 0.05 * k + 0.015,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      cone.position.set(it.x, (it.elevation || 0) + 0.2, it.z);
      cone.userData.lightId = it.id;
      this.coneRoot.add(cone);
    }
  }

  _buildBasin(pool) {
    for (const c of [...this.basin.children]) { this.basin.remove(c); if (c.isReflector || c.getRenderTarget) c.dispose?.(); disposeObject(c); }
    if (!pool) return;
    let shape;
    if (pool.shape === "circle") {
      shape = new THREE.Shape();
      shape.absarc(0, 0, pool.radius || 6, 0, Math.PI * 2, false);
    } else if (pool.shape === "ellipse") {
      shape = new THREE.Shape();
      shape.absellipse(0, 0, pool.rx || 6, pool.ry || 4, 0, Math.PI * 2, false, 0);
    } else if (pool.points?.length >= 3) {
      // Shape space (x, −z) so that rotation.x = −π/2 lands back on world z.
      shape = new THREE.Shape(pool.points.map((p) => new THREE.Vector2(p.x, -p.z)));
    } else return;
    let water;
    this.waterMirror = null;
    if (this.realistic) {
      const px = Math.min(1024, Math.round((this.container.clientWidth || 800) * 0.5));
      water = new Reflector(new THREE.ShapeGeometry(shape, 64), {
        color: 0x9fb8c8, textureWidth: px, textureHeight: Math.round(px * 0.6), clipBias: 0.003, shader: WATER_SHADER,
      });
      this.waterMirror = water;
      const renderReflection = water.onBeforeRender;
      water.onBeforeRender = (...args) => { if (this.poolReflection > 0) renderReflection.apply(water, args); };
      this.setPoolReflection(this.poolReflection);
    } else {
      water = new THREE.Mesh(new THREE.ShapeGeometry(shape, 64),
        new THREE.MeshStandardMaterial({ color: 0x0b4f7a, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }));
    }
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.0;
    water.receiveShadow = true;
    // Drawn before every particle effect: the particles write no depth, so a later water surface
    // would paint over the jets, flames and beams standing above it.
    water.renderOrder = -2;
    this.basin.add(water);
    const pts = shape.getSpacedPoints(160).map((p) => new THREE.Vector3(p.x, 0.06, -p.y));
    const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 220, 0.09, 8, true),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7 }));
    rim.castShadow = true;
    this.basin.add(rim);
    const box = new THREE.Box3().setFromObject(water);
    this.poolSize = Math.max(4, box.max.x - box.min.x, box.max.z - box.min.z);
    if (!this.framed) { this.frameAll(); this.framed = true; }
  }

  /** Frame the basin again the next time it is drawn (a whole new project was loaded). */
  reframeOnNextPool() {
    this.framed = false;
    this.poolKey = null;
  }

  // ─── show mode: the Studio renderer of the 3D preview ─────────────────────

  /**
   * Drive a show (studio/showHistory.js): level(id, τ), pan/tilt/roll(id, τ), color(id, τ).
   * Each drop leaves with the level and pose its nozzle had when it was fired. Lamp lenses and
   * pool glows are driven directly by light levels, including when every water jet is off.
   * data.jets then lists the jets: { id, kind, nominalHeightM, swing, lightId, outlets }.
   */
  setShowSource(source) {
    this.showSource = source || null;
    const show = !!this.showSource;
    // A show site is hundreds of metres across: bigger drops read as continuous streams, as on camera.
    this.particles.material.size = show ? 0.3 : 0.13;
    this._applyShowLook();
    if (!show) {
      this.mist.geometry.setDrawRange(0, 0); this.poolGlow.count = 0; this.streaks.geometry.setDrawRange(0, 0);
      this.lampPoints.geometry.setDrawRange(0, 0);
    }
    // Hide the lamp housing, not its emitted light: the dedicated lens/pool layers stay active.
    for (const rec of this.items.values()) if (rec.role === "light") rec.group.visible = !show;
  }

  /** Night-show look: lit mist, lamp lenses and pools, streaked reflections, clear night air. */
  /** Lit spray clouds over the jets (off by default: clear night air). */
  setMist(on) {
    this.mistEnabled = !!on;
    if (!this.mistEnabled) this.mist.geometry.setDrawRange(0, 0);
    this._applyShowLook();
  }

  _applyShowLook() {
    const show = !!this.showSource && this.realistic;
    this.mist.visible = show && !!this.mistEnabled;
    this.poolGlow.visible = show;
    this.lampPoints.visible = show;
    this.streaks.visible = !!this.showSource;
    // A night show has no work light: moonlight and the city's glow, the lamps do the rest.
    this.hemi.intensity = show ? 0.1 : 0.85;
    this.sun.intensity = show ? 0.06 : 1.4;
    this.ground.material.color.setHex(show ? 0x0c100e : 0x27322b);
    this.renderer.toneMappingExposure = show ? 0.8 : 1.05;
    if (this.scene.fog) { this.scene.fog.near = show ? 140 : 70; this.scene.fog.far = show ? 800 : 220; }
    if (this.bloom) {
      this.bloom.strength = show ? 0.28 : 0.42;
      this.bloom.radius = show ? 0.32 : 0.45;
      this.bloom.threshold = show ? 0.95 : 0.9;
    }
  }

  /** The lamp lighting a show jet: level × power now, colour (linear), and where it sits. */
  _showLamp(jet, rec, H) {
    const cache = this._lampCache || (this._lampCache = new Map());
    let lamp = cache.get(jet.id);
    if (!lamp) { lamp = { color: new THREE.Color() }; cache.set(jet.id, lamp); }
    const src = this.showSource, t = this.time;
    const lampRec = jet.lightId ? this.items.get(jet.lightId) : null;
    // Taller jets carry bigger lamp clusters (Bellagio: 4,792 lights under 1,214 nozzles).
    lamp.power = 0.8 + 0.012 * H;
    if (lampRec) {
      lamp.k = src.level(jet.lightId, t);
      lamp.color.set(src.color(jet.lightId, t) || "#fff1dc");
      lamp.x = lampRec.group.position.x; lamp.z = lampRec.group.position.z;
    } else {
      lamp.k = 0.55;
      lamp.color.set(0xdcecff);
      lamp.x = rec.group.position.x; lamp.z = rec.group.position.z;
    }
    return lamp;
  }

  /**
   * Show lighting beyond the jets themselves:
   *  · spray mist — every jet throws fine spray at its crown and a boil where it lands; it lingers
   *    and drifts for seconds and glows in the light of the lamps below (strongest near them);
   *  · lamp pools — an underwater lamp lights the water around it, brightest where the jet's
   *    aerated base boils over it;
   *  · indirect light — the brightest lit areas light the basin rim and the ground around them.
   */
  _updateShowLight() {
    if (!this.realistic || !this.showSource) return;
    const src = this.showSource, t = this.time, jit = this.jitter, J = jit.length;
    const lit = this.showLit || [];
    const [ar, ag, ab] = AMBIENT;
    // ── mist ──
    const mg = this.mist.geometry;
    const mp = mg.attributes.position.array, mc = mg.attributes.tint.array, ms = mg.attributes.size.array;
    let m = 0;
    const budget = lit.length && this.mistEnabled ? Math.max(2, Math.floor(MAX_MIST / lit.length)) : 0;
    for (let ji = 0; ji < lit.length; ji += 1) {
      const { jet, rec, H, rot, oyBase, lamp } = lit[ji];
      if (H < 3) continue;
      const o = rec.group.position;
      const K = Math.min(budget, jet.swing ? 7 : Math.min(16, 3 + Math.round(H / 8)));
      const Tm = Math.min(9, 3.5 + 0.045 * H);
      const aNom = Math.sqrt((2 * H) / G);
      const lk = lamp.k * lamp.power, lc = lamp.color;
      const reach = 2.5 + 0.06 * H;
      for (let i = 0; i < K && m < MAX_MIST; i += 1) {
        const j = (((ji * 131 + i * 17) * 3) % (J - 3) + J) % (J - 3);
        const u = (((i + 0.5 + 0.4 * jit[j]) / K) % 1 + 1) % 1;
        const age = (((t / Tm + u) % 1) + 1) % 1 * Tm;
        const tb = t - age;
        const crown = i % 3 !== 2;
        const te = tb - (crown ? aNom * (0.9 + 0.5 * Math.abs(jit[j + 1])) : 2 * aNom);
        const L = src.level(jet.id, te);
        if (L < 0.05) continue;
        let dx = 0, dy = 1, dz = 0, ox = o.x, oz = o.z, y0 = oyBase;
        if (jet.swing) {
          const st = showPose(src.pan(jet.id, te), src.tilt(jet.id, te), rot);
          dx = st.ax; dy = st.ay; dz = st.az;
          const tip = this._headOutlet(rec, st);
          ox = o.x + tip.x; oz = o.z + tip.z; y0 = o.y + tip.y;
        }
        const v0 = Math.sqrt(2 * G * H * L), vy = v0 * dy;
        const tL = (vy + Math.sqrt(vy * vy + 2 * G * y0)) / G;
        const a = crown ? Math.min(tL * 0.95, (vy / G) * (0.85 + 0.4 * Math.abs(jit[j + 2]))) : tL;
        const fx = (1 - Math.exp(-DRAG * a)) / DRAG;
        const spread = (crown ? 0.05 * H * L : 0.8 + 0.02 * H * L) * (1 + 0.5 * age);
        const px = ox + v0 * dx * fx + jit[j] * spread + WIND.x * age;
        const pz = oz + v0 * dz * fx + jit[j + 1] * spread + WIND.z * age;
        const py = Math.max(0.3, crown ? y0 + vy * a - 0.5 * G * a * a - 0.35 * age : 0.4 + 1.4 * Math.abs(jit[j + 2]) + 0.25 * age);
        const fadeIn = Math.min(1, age / 0.5), fadeOut = (1 - age / Tm) ** 1.5;
        const alpha = L * fadeIn * fadeOut * (crown ? 1 : 0.9) * (jet.swing ? 0.55 : 1);
        if (alpha < 0.01) continue;
        // Lit by the lamp's upward beam: bright inside its cone, fading with height (spreading
        // light), dark once the drift carries the spray out of the beam — plus the glow next to the lamp.
        const h = py + LAMP_DEPTH, r = Math.hypot(px - lamp.x, pz - lamp.z);
        const cone = Math.exp(-((r / (0.6 + BEAM_TAN * h)) ** 2));
        const beam = cone / (1 + (h / (0.45 * H + 6)) ** 2);
        const e = lk * (1.4 * Math.exp(-Math.hypot(r, h) / reach) + 1.2 * beam) * alpha * MIST_GAIN;
        const k3 = m * 3;
        mp[k3] = px; mp[k3 + 1] = py; mp[k3 + 2] = pz;
        mc[k3] = lc.r * e + ar * alpha * 0.5; mc[k3 + 1] = lc.g * e + ag * alpha * 0.5; mc[k3 + 2] = lc.b * e + ab * alpha * 0.5;
        ms[m] = Math.min(14, (crown ? 1.0 + 0.06 * H * L : 1.5 + 0.03 * H * L) * (1 + 0.8 * age));
        m += 1;
      }
    }
    mg.setDrawRange(0, m);
    mg.attributes.position.needsUpdate = true;
    mg.attributes.tint.needsUpdate = true;
    mg.attributes.size.needsUpdate = true;
    const vh = this.renderer.getDrawingBufferSize(this._dbSize || (this._dbSize = new THREE.Vector2())).y;
    this.mist.material.uniforms.projScale.value = vh / (2 * Math.tan((this.camera.fov * Math.PI) / 360));

    // ── lamp pools on the lake, and indirect light ──
    if (!this._lampJets || this._lampJetsFor !== this.data.jets) {
      this._lampJetsFor = this.data.jets;
      this._lampJets = new Map((this.data.jets || []).filter((j) => j.lightId).map((j) => [j.lightId, j]));
      this._lampIds = (this.data.items || []).filter((it) => it.role === "light").map((it) => it.id);
    }
    const mesh = this.poolGlow, mtx = this._mtx || (this._mtx = new THREE.Matrix4()), c = this._col || (this._col = new THREE.Color());
    const hex = this._hexCol || (this._hexCol = new THREE.Color());
    const lensGeo = this.lampPoints.geometry, lp = lensGeo.attributes.position.array, lc = lensGeo.attributes.tint.array, ls = lensGeo.attributes.size.array;
    let activeLamps = 0;
    for (const id of this._lampIds) if (src.level(id, t) >= 0.01 && this.items.has(id)) activeLamps += 1;
    const exposure = showLightExposure(this.data.pool, activeLamps);
    const cands = [];
    let g = 0;
    for (const id of this._lampIds) {
      if (g >= MAX_LAMPS) break;
      const k = src.level(id, t);
      if (k < 0.01) continue;
      const rec = this.items.get(id);
      if (!rec) continue;
      const jet = this._lampJets.get(id);
      const H = jet ? Math.max(1, jet.nominalHeightM || 2) : 4;
      const wL = jet ? src.level(jet.id, t) : 0;
      const visible = showLampLevels(k, wL, H);
      const p = rec.group.position;
      // The pool and lens have independent light-driven energy: neither requires running water.
      // A light with no jet over it is a pixel of floor artwork: a small, sharp glow.
      const radius = jet ? visible.radius : 0.38;
      mtx.makeScale(radius, 1, radius).setPosition(p.x, 0.03, p.z);
      mesh.setMatrixAt(g, mtx);
      hex.set(src.color(id, t) || "#fff1dc");
      const poolEnergy = visible.pool * exposure.poolScale, lensEnergy = visible.lens * exposure.lensScale;
      c.copy(hex).multiplyScalar(poolEnergy * POOL_GAIN);
      mesh.setColorAt(g, c);
      const k3 = g * 3;
      lp[k3] = p.x; lp[k3 + 1] = 0.09; lp[k3 + 2] = p.z;
      lc[k3] = hex.r * lensEnergy; lc[k3 + 1] = hex.g * lensEnergy; lc[k3 + 2] = hex.b * lensEnergy;
      ls[g] = visible.lensSize * (0.65 + 0.35 * exposure.lensScale);
      g += 1;
      if (poolEnergy > 0.15) cands.push({ x: p.x, z: p.z, e: poolEnergy, color: hex.getHex() });
    }
    mesh.count = g;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    lensGeo.setDrawRange(0, g);
    lensGeo.attributes.position.needsUpdate = true;
    lensGeo.attributes.tint.needsUpdate = true;
    lensGeo.attributes.size.needsUpdate = true;
    this.lampPoints.material.uniforms.projScale.value = this.mist.material.uniforms.projScale.value;
    cands.sort((a, b) => b.e - a.e);
    const picked = [];
    for (const cd of cands) {
      if (picked.length >= this.glowLights.length) break;
      if (picked.every((p) => Math.hypot(p.x - cd.x, p.z - cd.z) > 30)) picked.push(cd);
    }
    this.glowLights.forEach((l, i) => {
      const cd = picked[i];
      if (!cd) { l.intensity = 0; return; }
      l.position.set(cd.x, 4, cd.z);
      l.color.setHex(cd.color);
      l.distance = 45;
      l.decay = 1.2;
      l.intensity = 2 * Math.min(1.5, cd.e);
    });
  }
  /** Show time source for live playback (seconds); null returns to design mode. */
  setClock(fn) { this.clockFn = typeof fn === "function" ? fn : null; }
  /** Follow the project's camera track (preview/camera/cameraTrack.js) while it has keys. */
  setCameraTrack(track, follow = true) { this.cameraTrack = track || null; this.followCamera = !!follow; }
  /** Render one exact frame at show time t (video export). */
  renderAt(t, dt = 1 / 30) { this._renderShowFrame(t, dt); }

  _renderShowFrame(t, dt) {
    this.time = Math.max(0, Number(t) || 0);
    const cam = this.followCamera && this.cameraTrack ? sampleCameraTrack(this.cameraTrack, this.time) : null;
    if (cam) {
      this.camera.position.set(cam.position.x, cam.position.y, cam.position.z);
      if (Number(cam.fov) > 0 && Math.abs(this.camera.fov - cam.fov) > 1e-3) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }
      this.controls.target.set(cam.target.x, cam.target.y, cam.target.z);
      this.camera.lookAt(this.controls.target);
    } else this.controls.update();
    if (this.showSource) this._updateShowWater(); else this._updateWater(dt);
    this._updateEffects();
    if (this.showSource) this._updateShowLight(); else this._updateGlow();
    if (this.waterMirror) {
      const u = this.waterMirror.material.uniforms;
      u.time.value = this.time;
      // A lake hundreds of metres across: longer waves, reflections smeared into streaks.
      u.streak.value = this.showSource ? 0.0065 : 0;
      u.waveScale.value = this.showSource ? 3.5 : 1;
    }
    if (this.realistic && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  _updateShowWater() {
    const src = this.showSource, jets = this.data.jets || [];
    const pos = this.pPos, col = this.pCol, jit = this.jitter, max = this.maxParticles;
    const t = this.time;
    // Jets with water now or still in the air from the last few seconds.
    const active = [];
    for (const j of jets) {
      const L = Math.max(src.level(j.id, t), src.level(j.id, t - 1), src.level(j.id, t - 2.5), src.level(j.id, t - 4));
      this.jetState.set(j.id, (j.nominalHeightM || 0) * src.level(j.id, t));
      if (L > 0.01) active.push(j);
    }
    // Drops are shared by weight: a long arc or a bell head needs more drops than a short jet to
    // read as a continuous stream.
    const weightOf = (j) => Math.min(6, Math.max(1, (j.nominalHeightM || 2) / 8)) * (j.bell || j.vario ? 2.5 : 1);
    const totalW = active.reduce((a, j) => a + weightOf(j), 0);
    const per = active.length ? Math.min(2600, Math.floor(max / totalW)) : 0;
    let n = 0, q = 0, ns = 0;
    const sGeo = this.streaks.geometry, sp6 = sGeo.attributes.position.array, sc6 = sGeo.attributes.color.array;
    const pose = (pan, tilt, rot, roll = 0) => showPose(pan, tilt, rot, roll);
    const [ar, ag, ab] = AMBIENT;
    const lit = this.showLit = [];
    // A compact, dense fountain (hundreds of jets in a pool) overlaps far more water per pixel
    // than a lake show: scale each drop's light by the jet density so the jets stay readable.
    if (this._siteScaleFor !== jets) {
      this._siteScaleFor = jets;
      const area = showLightExposure(this.data.pool, 1).area;
      const perM2 = area > 0 ? jets.length / area : 0;
      this._siteScale = perM2 > 0 ? Math.max(0.35, Math.min(1, Math.sqrt(0.04 / perM2))) : 1;
    }
    const siteScale = this._siteScale;
    for (const jet of active) {
      const rec = this.items.get(jet.id);
      if (!rec) continue;
      const o = rec.group.position, rot = -rec.group.rotation.y;
      const H = Math.max(0.2, jet.nominalHeightM || 2);
      const oyBase = o.y + (rec.outletY ?? 0.15);
      const vmax = Math.sqrt(2 * G * H);
      const T = (vmax + Math.sqrt(vmax * vmax + 2 * G * oyBase)) / G + SPLASH_S;
      if (jet.swing) this._aimHead(rec, pose(src.pan(jet.id, t), src.tilt(jet.id, t), rot, src.roll?.(jet.id, t)));
      // Light is instantaneous: every drop in the air now is lit by its lamp's level now. A jet
      // without a lamp keeps a neutral work light so designs without lights stay visible.
      const lamp = this._showLamp(jet, rec, H);
      const lk = lamp.k * lamp.power, lc = lamp.color, lx = lamp.x, lz = lamp.z;
      const hotR = 1.2 + 0.04 * H;
      // Fewer drops per jet (a crowded show) → each drop carries more of the jet's light.
      const density = Math.min(1.6, Math.max(0.7, Math.sqrt(1300 / Math.max(200, per))));
      const gain = WATER_GAIN * density * siteScale, sGain = STREAK_GAIN * density * siteScale;
      lit.push({ jet, rec, H, rot, oyBase, lamp });
      const outletCount = jet.axes >= 3 ? Math.max(1, jet.outlets || 1) : 1;
      const outlets = jet.swing ? Array.from({ length: outletCount }, (_, k) => ({ swing: true, k, n: outletCount,
        splay: (jet.splayDeg * Math.PI) / 180, spread: 0.02 })) : outletsOf({ ...jet, motion: null }, t, rot, src);
      const each = Math.max(8, Math.floor((per * weightOf(jet)) / outlets.length));
      for (const out of outlets) {
        let sdx = 0, sdy = 1, sdz = 0;
        if (!out.swing && !out.basket) {
          const sTh = Math.sin(out.th || 0);
          sdx = sTh * Math.cos(out.ph || 0); sdz = sTh * Math.sin(out.ph || 0); sdy = Math.cos(out.th || 0);
        }
        for (let i = 0; i < each && n < max; i += 1) {
          const j = (q++ * 3) % jit.length;
          const u = (i / each + 0.37 * jit[j + 2] * 0.05 + 1) % 1;
          const age = ((t / T + u) % 1) * T;
          const tau = t - age;
          const L = src.level(jet.id, tau);
          if (L < 0.01) continue;
          const v0 = Math.sqrt(2 * G * H * L);
          let dx = sdx, dy = sdy, dz = sdz, ox = o.x, oz = o.z, y0 = oyBase;
          if (out.swing) {
            // Direction and outlet at the moment this drop left the swinging head.
            const st = pose(src.pan(jet.id, tau), src.tilt(jet.id, tau), rot, src.roll?.(jet.id, tau));
            if (out.n > 1) {
              const dir = outletDir(st, out.k, out.n, out.splay, [0, 1, 0]);
              dx = dir[0]; dy = dir[1]; dz = dir[2];
            } else { dx = st.ax; dy = st.ay; dz = st.az; }
            const tip = this._headOutlet(rec, st);
            ox = o.x + tip.x; oz = o.z + tip.z; y0 = o.y + tip.y;
          }
          const vy = v0 * dy * (1 + out.spread * 0.4 * jit[j + 2]);
          const tLand = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * y0))) / G;
          const breakup = Math.min(1, age / Math.max(0.2, tLand));
          const s = out.spread * (0.25 + 1.4 * breakup ** 1.6);
          const vx = v0 * (dx + s * jit[j]), vz = v0 * (dz + s * jit[j + 1]);
          const k = n * 3;
          if (age < tLand) {
            const fx = (1 - Math.exp(-DRAG * age)) / DRAG;
            const px = ox + vx * fx, py = Math.max(0.01, y0 + vy * age - 0.5 * G * age * age), pz = oz + vz * fx;
            pos[k] = px; pos[k + 1] = py; pos[k + 2] = pz;
            // Light guide: the lamp's light enters the coherent stream at its base and travels up
            // inside it, leaking out where the surface roughens and the stream breaks into drops,
            // so it fades along the flight. Next to the lamp the aerated base is lit directly
            // (the hot core every Bellagio jet has at the water line).
            // Light lost along the stream depends on the metres it has travelled (≈ twice the
            // apex over the whole flight): a 22 m arc stays lit end to end, a 73 m shooter's
            // crown is a dim glow above a blazing base.
            const path = 2 * H * L * (age / tLand);
            const guide = (0.2 + 0.8 * Math.exp(-path / 28)) * (0.6 + 0.6 * breakup);
            const dB = Math.hypot(px - lx, py + LAMP_DEPTH, pz - lz);
            const lum = lk * (guide + 1.6 * Math.exp(-dB / hotR));
            const e = lum * gain;
            col[k] = lc.r * e + ar; col[k + 1] = lc.g * e + ag; col[k + 2] = lc.b * e + ab;
            // The same drop as the camera records it: a streak back along its path over one shutter.
            if (ns < max) {
              const a2 = Math.max(0, age - EXPOSURE_S), fx2 = (1 - Math.exp(-DRAG * a2)) / DRAG;
              // A broken-up crown is a spray, not a stream: its drops smear far less visibly.
              const k6 = ns * 6, es = lum * sGain * (1 - breakup) ** 1.5;
              sp6[k6] = px; sp6[k6 + 1] = py; sp6[k6 + 2] = pz;
              sp6[k6 + 3] = ox + vx * fx2; sp6[k6 + 4] = Math.max(0.01, y0 + vy * a2 - 0.5 * G * a2 * a2); sp6[k6 + 5] = oz + vz * fx2;
              sc6[k6] = lc.r * es; sc6[k6 + 1] = lc.g * es; sc6[k6 + 2] = lc.b * es;
              sc6[k6 + 3] = lc.r * es * 0.4; sc6[k6 + 4] = lc.g * es * 0.4; sc6[k6 + 5] = lc.b * es * 0.4;
              ns += 1;
            }
          } else {
            const sp = age - tLand;
            if (sp > SPLASH_S) continue;
            const fx = (1 - Math.exp(-DRAG * tLand)) / DRAG;
            const impact = Math.min(1.5, Math.abs(vy - G * tLand) / 8);
            const r = (0.05 + 1.1 * sp) * (0.3 + 0.7 * Math.abs(jit[j + 2])) * impact;
            const a = 6.283 * (0.5 + 0.5 * jit[j]);
            const px = ox + vx * fx + r * Math.cos(a), py = 0.02 + 3.2 * impact * sp * (SPLASH_S - sp), pz = oz + vz * fx + r * Math.sin(a);
            pos[k] = px; pos[k + 1] = py; pos[k + 2] = pz;
            // White water scatters strongly but is lit only if it lands near a lamp.
            const dB = Math.hypot(px - lx, py + LAMP_DEPTH, pz - lz);
            const e = lk * (0.12 + 2.0 * Math.exp(-dB / hotR)) * gain * (1 - sp / SPLASH_S);
            col[k] = lc.r * e + ar; col[k + 1] = lc.g * e + ag; col[k + 2] = lc.b * e + ab;
          }
          n += 1;
        }
      }
    }
    const geo = this.particles.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    sGeo.setDrawRange(0, ns * 2);
    sGeo.attributes.position.needsUpdate = true;
    sGeo.attributes.color.needsUpdate = true;
  }

  setPoolReflection(value) {
    const n = Number(value);
    this.poolReflection = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
    if (this.waterMirror?.material?.uniforms?.reflectionStrength) this.waterMirror.material.uniforms.reflectionStrength.value = this.poolReflection;
  }

  /** Realistic render (bloom, reflective water, indirect light) on/off — off for slow computers. */
  setRealistic(on) {
    const next = !!on;
    if (next === this.realistic) return;
    this.realistic = next;
    // A design grid and fake light cones belong to the working view, not the rendered night scene.
    this.grid.visible = !next;
    this.coneRoot.visible = !next;
    this.poolKey = null;
    if (this.data.pool) { this.poolKey = JSON.stringify(this.data.pool); this._buildBasin(this.data.pool); }
    for (const l of this.glowLights) l.intensity = 0;
    this._applyShowLook();
  }

  /**
   * Indirect lighting: the brightest lit jets (their light colour) and flames light the basin rim,
   * ground and equipment around them, like Depence's "Indirect Lighting".
   */
  _updateGlow() {
    const lights = this.glowLights;
    if (!this.realistic) return;
    const cands = [];
    for (const j of this.data.jets || []) {
      const h = this.jetState.get(j.id) || 0;
      if (!j.color || !(j.intensity > 0) || h < 0.2) continue;
      const rec = this.items.get(j.id);
      if (rec) cands.push({ p: rec.group.position, y: Math.min(3, h * 0.35), color: j.color, k: j.intensity * Math.min(1, h / 3) });
    }
    for (const fx of this.data.effects || []) {
      if (fx.kind !== "flame" || !(fx.intensity > 0)) continue;
      const rec = this.items.get(fx.id);
      if (rec) cands.push({ p: rec.group.position, y: 0.8, color: "#ff8a2a", k: 1.2 * fx.intensity * (0.85 + 0.15 * Math.sin(this.time * 19)) });
    }
    cands.sort((a, b) => b.k - a.k);
    lights.forEach((l, i) => {
      const c = cands[i];
      if (!c) { l.intensity = 0; return; }
      l.distance = 14;
      l.decay = 1.6;
      l.position.set(c.p.x, c.p.y, c.p.z);
      l.color.set(c.color);
      l.intensity = 9 * c.k;
    });
  }

  frameAll() {
    const size = this.poolSize || 12;
    this.controls.target.set(0, 1, 0);
    this.camera.position.set(size * 0.12, size * 0.55 + 2.5, size * 0.85 + 3);
    this.controls.update();
  }

  _updateSelection() {
    const rec = this.data.selectedId && this.items.get(this.data.selectedId);
    this.selRing.visible = !!rec;
    if (rec) this.selRing.position.set(rec.group.position.x, rec.group.position.y + 0.03, rec.group.position.z);
  }

  // ─── frame ────────────────────────────────────────────────────────────────

  _loop() {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this._loop);
    if (this.baking) return;                 // a video render draws its frames itself (renderAt)
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.container.clientWidth || !this.container.isConnected) return;
    if (this.clockFn) { this._renderShowFrame(this.clockFn(), dt); return; }
    this.time += dt;
    this.controls.update();
    this._updateWater(dt);
    this._updateEffects();
    this._updateGlow();
    if (this.waterMirror) this.waterMirror.material.uniforms.time.value = this.time;
    if (this.selRing.visible) this.selRing.rotation.z += dt * 0.8;
    if (this.realistic && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  _updateWater(dt) {
    const jets = this.data.jets || [];
    const pos = this.pPos, col = this.pCol, jit = this.jitter;
    const active = jets.filter((j) => (j.heightM > 0.02) || (this.jetState.get(j.id) || 0) > 0.02);
    const per = active.length ? Math.min(3000, Math.floor(this.maxParticles / active.length)) : 0;
    let n = 0, q = 0;
    const t = this.time;
    const tmp = new THREE.Color();
    const white = new THREE.Color(0xd8f1ff);
    const dir = [0, 1, 0];
    for (const jet of jets) {
      // Pump ramp: the jet eases to its new height like a real pump changing speed.
      const target = Math.max(0, jet.heightM || 0);
      const cur = this.jetState.get(jet.id) ?? 0;
      const h = cur + (target - cur) * Math.min(1, dt * 2.2);
      this.jetState.set(jet.id, h);
      const rec = this.items.get(jet.id);
      if (!rec) continue;
      const rot = rec.group.rotation.y * -1;
      if (jet.motion) this._aimHead(rec, motionState(jet.motion, rot, t));
      if (h < 0.02) continue;
      const o = rec.group.position;
      const oy = o.y + (rec.outletY ?? 0.15);
      const outlets = outletsOf(jet, t, rot);
      if (jet.kind === "basket" && !jet.motion && rec.rig?.basket) {
        // The basket's real outlets (radius, height, angle) and its rotor turning with the water.
        const b = rec.rig.basket;
        for (let i = 0; i < outlets.length; i += 1) Object.assign(outlets[i], { r: b[i % b.length].r, y: b[i % b.length].y, ph0: b[i % b.length].a });
        rec.rig.rotor.quaternion.copy(rec.rig.rotorRest).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -t * BASKET_RAD_S));
      }
      // A moving head's outlets each get a full stream (they are few and are what the eye follows).
      const each = Math.max(8, Math.floor(jet.motion ? per * Math.min(1, 1.6 / outlets.length) * 1.4 : per / outlets.length));
      tmp.copy(white);
      if (jet.color) tmp.lerp(new THREE.Color(jet.color), Math.min(1, 0.35 + 0.65 * (jet.intensity || 0)));
      // Additive drops add up in a dense core; in realistic mode each is dimmer so the sum stays coloured.
      const bright = (jet.color ? 0.6 + 0.4 * (jet.intensity || 0) : 0.6) * (this.realistic ? 0.62 : 1);
      for (const out of outlets) {
        let hh = h;
        if (out.mist) hh = Math.min(h, 1.2);
        if (out.pulse && (t % 1.6) / 1.6 > 0.7) continue;
        const v0 = Math.sqrt(2 * G * hh);
        // Cycle = flight of a vertical drop + the splash it makes when it lands.
        const tFly = (v0 + Math.sqrt(v0 * v0 + 2 * G * oy)) / G;
        const T = Math.max(0.3, tFly + SPLASH_S);
        let dx = 0, dz = 0, dy = 1;
        if (!out.motion && !out.basket) {
          const sTh = Math.sin(out.th), cTh = Math.cos(out.th);
          dx = sTh * Math.cos(out.ph); dz = sTh * Math.sin(out.ph); dy = cTh;
        }
        for (let i = 0; i < each && n < this.maxParticles; i += 1) {
          const j = (q++ * 3) % jit.length;
          const u = (i / each + 0.37 * jit[j + 2] * 0.05 + 1) % 1;
          const age = ((t / T + u) % 1) * T;
          let lift = 0, ox = o.x, oz = o.z, y0 = oy;
          if (out.motion) {
            // Direction and outlet position at the moment this drop left the nozzle.
            const st = motionState(out.motion, rot, t - age);
            outletDir(st, out.k, out.n, out.splay, dir);
            dx = dir[0]; dy = dir[1]; dz = dir[2]; lift = st.lift;
            const tip = this._headOutlet(rec, st);
            ox = o.x + tip.x; oz = o.z + tip.z; y0 = o.y + tip.y + lift;
          } else if (out.basket) {
            const ph = out.ph0 + rot + (t - age) * BASKET_RAD_S, sTh = Math.sin(out.th);
            dx = sTh * Math.cos(ph); dz = sTh * Math.sin(ph); dy = Math.cos(out.th);
            if (out.r) { ox = o.x + out.r * Math.cos(ph); oz = o.z + out.r * Math.sin(ph); y0 = o.y + out.y; }
          }
          const vy = v0 * dy * (1 + out.spread * 0.4 * jit[j + 2]);
          const tLand = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * y0))) / G;
          const breakup = Math.min(1, age / Math.max(0.2, tLand));
          // Tight glassy stream near the nozzle, breaking up into a spreading spray higher up.
          // (a 10 m straight jet spreads about 1-1.5 m at its top)
          const s = out.spread * (out.foam ? 1 + 3 * breakup : 0.25 + 1.4 * breakup ** 1.6);
          const vx = v0 * (dx + s * jit[j]);
          const vz = v0 * (dz + s * jit[j + 1]);
          const k = n * 3;
          if (age < tLand) {
            // Air drag on the drops shortens the horizontal reach: x = v (1 - e^(-c t)) / c.
            const fx = (1 - Math.exp(-DRAG * age)) / DRAG;
            pos[k] = ox + vx * fx;
            pos[k + 1] = Math.max(0.01, y0 + vy * age - 0.5 * G * age * age);
            pos[k + 2] = oz + vz * fx;
            const fade = bright * (1 - 0.5 * breakup) * (out.mist ? 0.45 : 1) * (breakup < 0.15 ? 1.25 : 1);
            col[k] = tmp.r * fade; col[k + 1] = tmp.g * fade; col[k + 2] = tmp.b * fade;
          } else {
            // Splash: drops hitting the water throw up a short crown of white spray.
            const sp = age - tLand;
            if (sp > SPLASH_S || out.mist) continue;
            const fx = (1 - Math.exp(-DRAG * tLand)) / DRAG;
            const impact = Math.min(1.5, Math.abs(vy - G * tLand) / 8);
            const r = (0.05 + 1.1 * sp) * (0.3 + 0.7 * Math.abs(jit[j + 2])) * impact;
            const a = 6.283 * (0.5 + 0.5 * jit[j]);
            pos[k] = ox + vx * fx + r * Math.cos(a);
            pos[k + 1] = 0.02 + 3.2 * impact * sp * (SPLASH_S - sp);
            pos[k + 2] = oz + vz * fx + r * Math.sin(a);
            const fade = 0.55 * bright * (1 - sp / SPLASH_S);
            col[k] = fade; col[k + 1] = fade; col[k + 2] = fade;
          }
          n += 1;
        }
      }
    }
    const geo = this.particles.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  /**
   * Turn a moving nozzle to where its head points. With a rigged model the Pan and Tilt joints
   * move (and a 3D head spins); otherwise the whole model turns about its foot.
   */
  _aimHead(rec, st) {
    if (!rec.model) return;
    if (!rec.aim) rec.aim = { q: new THREE.Quaternion(), qs: new THREE.Quaternion(), inv: new THREE.Quaternion(),
      up: new THREE.Vector3(0, 1, 0), x: new THREE.Vector3(1, 0, 0), d: new THREE.Vector3() };
    const A = rec.aim;
    A.d.set(st.ax, st.ay, st.az).normalize();
    A.inv.copy(rec.group.quaternion).invert();
    const rig = rec.rig;
    if (rig?.pan) {
      // Direction in the fixture's own frame; tilt θ about X then pan φ about Y gives
      // (sinθ·sinφ, cosθ, sinθ·cosφ), so φ = atan2(x, z), θ = acos(y).
      A.d.applyQuaternion(A.inv);
      const phi = Math.atan2(A.d.x, A.d.z), th = Math.acos(Math.max(-1, Math.min(1, A.d.y)));
      rig.pan.quaternion.copy(rig.panRest).multiply(A.q.setFromAxisAngle(A.up, phi));
      rig.tilt.quaternion.copy(rig.tiltRest).multiply(A.q.setFromAxisAngle(A.x, th)).multiply(A.qs.setFromAxisAngle(A.up, st.spin || 0));
      rec.model.quaternion.identity();
      // A 3D robotic module's head rises on its lift stroke; the base stays bolted down.
      // (Pan_Z hangs under the model root, so its local +Y is the model's up.)
      rig.pan.position.copy(rig.panRestPos);
      rig.pan.position.y += (st.lift || 0) / Math.max(1e-6, rec.model.scale.y);
      // The telescopic column the head rides on.
      const lift = st.lift || 0;
      if (lift > 0.005) {
        if (!rig.mast) {
          rig.mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 16).translate(0, 0.5, 0),
            new THREE.MeshStandardMaterial({ color: 0xb8c2cc, metalness: 0.85, roughness: 0.25 }));
          rec.group.add(rig.mast);
        }
        rig.mast.visible = true;
        rig.mast.position.set(0, rig.panBaseY, 0);
        rig.mast.scale.y = lift;
      } else if (rig.mast) rig.mast.visible = false;
      return;
    }
    rec.model.position.y = st.lift || 0;
    A.q.setFromUnitVectors(A.up, A.d);
    A.qs.setFromAxisAngle(A.up, st.spin || 0);
    rec.model.quaternion.copy(A.inv).multiply(A.q).multiply(A.qs);
  }

  /** Where a moving nozzle's water leaves at a head direction (joint height + arm along the head). */
  _headOutlet(rec, st) {
    const rig = rec.rig;
    if (rig?.pan) return { y: rig.pivotY + st.ay * rig.arm, x: st.ax * rig.arm, z: st.az * rig.arm };
    const L = rec.outletY ?? 0.15;               // whole model turns about its foot
    return { y: st.ay * L, x: st.ax * L, z: st.az * L };
  }

  /**
   * Lasers, flames and fog. data.effects: [{ id, kind: 'laser', state, engineering, mountM }
   * | { id, kind: 'flame', heightM, intensity, burst } | { id, kind: 'fog', radiusM, density }].
   * Positions come from the item in the scene, so an effect follows its item while it is dragged.
   */
  _updateEffects() {
    const t = this.time;
    const effects = this.data.effects || [];
    const bPos = this.beams.geometry.attributes.position.array, bCol = this.beams.geometry.attributes.color.array;
    const dPos = this.dots.geometry.attributes.position.array, dCol = this.dots.geometry.attributes.color.array;
    const fPos = this.flames.geometry.attributes.position.array, fCol = this.flames.geometry.attributes.color.array;
    const gPos = this.fog.geometry.attributes.position.array, gCol = this.fog.geometry.attributes.color.array;
    let bv = 0, dn = 0, fn = 0, gn = 0;
    const cam = this.camera.position;

    const quad = (ax, ay, az, bx, by, bz, width, r, g, b, endK = 1) => {
      if (bv + 6 > MAX_BEAM_VERTS) return;
      // Width across the beam, facing the camera.
      const mx = (ax + bx) / 2 - cam.x, my = (ay + by) / 2 - cam.y, mz = (az + bz) / 2 - cam.z;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      let wx = dy * mz - dz * my, wy = dz * mx - dx * mz, wz = dx * my - dy * mx;
      const l = Math.hypot(wx, wy, wz) || 1;
      wx = (wx / l) * width * 0.5; wy = (wy / l) * width * 0.5; wz = (wz / l) * width * 0.5;
      const v = [ax - wx, ay - wy, az - wz, ax + wx, ay + wy, az + wz, bx + wx, by + wy, bz + wz,
        ax - wx, ay - wy, az - wz, bx + wx, by + wy, bz + wz, bx - wx, by - wy, bz - wz];
      // Vertices 2, 4, 5 sit at the far end: the beam fades as it scatters away into the haze.
      for (let i = 0; i < 18; i += 3) {
        const f = i === 6 || i === 12 || i === 15 ? endK : 1;
        bPos[bv * 3] = v[i]; bPos[bv * 3 + 1] = v[i + 1]; bPos[bv * 3 + 2] = v[i + 2];
        bCol[bv * 3] = r * f; bCol[bv * 3 + 1] = g * f; bCol[bv * 3 + 2] = b * f;
        bv += 1;
      }
    };
    const tri = (a, b, c, r, g, bl) => {
      if (bv + 3 > MAX_BEAM_VERTS) return;
      for (const p of [a, b, c]) {
        bPos[bv * 3] = p.x; bPos[bv * 3 + 1] = p.y; bPos[bv * 3 + 2] = p.z;
        bCol[bv * 3] = r; bCol[bv * 3 + 1] = g; bCol[bv * 3 + 2] = bl;
        bv += 1;
      }
    };
    const dot = (p, r, g, b) => {
      if (dn >= MAX_DOTS) return;
      dPos[dn * 3] = p.x; dPos[dn * 3 + 1] = p.y; dPos[dn * 3 + 2] = p.z;
      dCol[dn * 3] = r; dCol[dn * 3 + 1] = g; dCol[dn * 3 + 2] = b;
      dn += 1;
    };

    for (const fx of effects) {
      const rec = this.items.get(fx.id);
      if (!rec) continue;
      const o = rec.group.position;
      if (fx.kind === "laser") {
        if (!(fx.state?.intensity > 0)) continue;
        const frame = laserFrame({ id: fx.id, x: o.x, z: o.z, y: Math.max(o.y, fx.mountM ?? 0.5), rotation: rec.data.rotation || 0,
          engineering: fx.engineering || {} }, fx.state, t, { basin: this.data.safetyBasin || null });
        fx.frame = frame;
        // Beams are only seen where the haze scatters them (same rule as the full preview).
        const haze = Math.max(0, Math.min(1, this.data.haze ?? 0.35));
        const vis = 0.12 + 0.88 * haze;
        const k = frame.intensity * (frame.faint ? 0.5 : 1) * vis;
        const { r, g, b } = frame.color;
        const end = (beam) => {
          const len = Math.min(beam.length, BEAM_DRAW_M);
          return { x: frame.origin.x + beam.dir.x * len, y: frame.origin.y + beam.dir.y * len, z: frame.origin.z + beam.dir.z * len };
        };
        const ends = frame.beams.map(end);
        if (frame.sheet && ends.length > 1) {
          for (let i = 1; i < ends.length; i += 1) tri(frame.origin, ends[i - 1], ends[i], r * k * 0.06, g * k * 0.06, b * k * 0.06);
        }
        frame.beams.forEach((beam, i) => {
          const e = ends[i];
          const gk = k * (beam.glint ?? 1);
          // A real show beam is a few millimetres wide: a thin bright core and a faint haze glow.
          const core = frame.heavy ? 0.06 : frame.faint ? 0.008 : 0.014;
          quad(frame.origin.x, frame.origin.y, frame.origin.z, e.x, e.y, e.z, core, r * gk, g * gk, b * gk, 0.25);
          quad(frame.origin.x, frame.origin.y, frame.origin.z, e.x, e.y, e.z, core * 5, r * gk * 0.12 * haze, g * gk * 0.12 * haze, b * gk * 0.12 * haze, 0.1);
          if (beam.hit || frame.faint) dot(e, r * gk, g * gk, b * gk);
        });
        for (const s of frame.outline || []) quad(s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z, 0.03, r * k * 1.4, g * k * 1.4, b * k * 1.4);
        dot(frame.origin, r * k, g * k, b * k);
      } else if (fx.kind === "flame") {
        if (!(fx.intensity > 0)) continue;
        // Burst mode: 0.8 s puffs every 2.5 s.
        const env = fx.burst ? Math.max(0, Math.sin(Math.min(1, (t % 2.5) / 0.8) * Math.PI)) * ((t % 2.5) < 0.8 ? 1 : 0) : 1;
        if (env <= 0.01) continue;
        const H = fx.heightM * fx.intensity * env;
        const count = 1800;
        for (let i = 0; i < count && fn < MAX_FLAME; i += 1) {
          const j = (i * 3) % this.jitter.length;
          // Fast-rising gas (a flame jet leaves the burner at several m/s), a little turbulence.
          const T = 0.55 + 0.2 * this.jitter[j];
          const age = ((t / T + i / count) % 1);
          const tongue = (i % 5) * 1.2566 + 0.6 * Math.sin(t * 2.3 + i);          // 5 licking tongues
          const wob = 0.10 * age * Math.sin(t * 13 + i * 0.7) + 0.05 * Math.sin(t * 29 + i);
          const rad = 0.22 * Math.sqrt(Math.max(0, 1 - age)) * (0.5 + 0.5 * Math.abs(this.jitter[j + 1])) * Math.max(0.5, fx.intensity) * (1 + 0.6 * age);
          fPos[fn * 3] = o.x + rad * Math.cos(tongue) + wob;
          fPos[fn * 3 + 1] = o.y + 0.2 + H * (age + 0.08 * age * this.jitter[j + 2]);
          fPos[fn * 3 + 2] = o.z + rad * Math.sin(tongue) + 0.6 * wob;
          // Colour by temperature: white-yellow root, orange body, deep red tips.
          const heat = 1 - age;
          // Many particles overlap (additive), so each is dim: the sum reads yellow at the root,
          // orange in the body and see-through red at the tips instead of saturating to white.
          const fade = 0.32 * Math.max(0, 1 - age * 1.05) * (0.75 + 0.25 * Math.sin(t * 17 + i));
          fCol[fn * 3] = fade; fCol[fn * 3 + 1] = (0.1 + 0.62 * heat * heat) * fade; fCol[fn * 3 + 2] = 0.12 * heat ** 4 * fade;
          fn += 1;
        }
      } else if (fx.kind === "fog") {
        if (!(fx.density > 0)) continue;
        const count = Math.round(140 + 180 * fx.density);
        for (let i = 0; i < count && gn < MAX_FOG; i += 1) {
          const j = (i * 3) % this.jitter.length;
          const r0 = fx.radiusM * Math.sqrt(0.5 + 0.5 * this.jitter[j]);
          const a = i * 2.39996 + t * 0.06 * (0.5 + 0.5 * this.jitter[j + 1]);
          gPos[gn * 3] = o.x + r0 * Math.cos(a);
          gPos[gn * 3 + 1] = 0.2 + 0.7 * (0.5 + 0.5 * this.jitter[j + 2]) + 0.12 * Math.sin(t * 0.4 + i);
          gPos[gn * 3 + 2] = o.z + r0 * Math.sin(a);
          const c = 0.55 * fx.density;
          gCol[gn * 3] = c; gCol[gn * 3 + 1] = c * 1.02; gCol[gn * 3 + 2] = c * 1.06;
          gn += 1;
        }
      }
    }
    const finish = (obj, count) => {
      const g = obj.geometry;
      g.setDrawRange(0, count);
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    };
    finish(this.beams, bv);
    finish(this.dots, dn);
    finish(this.flames, fn);
    finish(this.fog, gn);
  }

  /** The laser frame drawn last for an item (beams, blanked / clamped counts), for the sidebar. */
  laserStatus(id) {
    const fx = (this.data.effects || []).find((e) => e.id === id && e.kind === "laser");
    return fx?.frame ? { beams: fx.frame.beams.length, blanked: fx.frame.blanked, clamped: fx.frame.clamped } : null;
  }

  // ─── input ────────────────────────────────────────────────────────────────

  _bind() {
    const el = this.renderer.domElement;
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onDragOver = (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("application/x-aquaflow-asset")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const p = this._groundAt(e);
      this.ghost.visible = !!p;
      if (p) this.ghost.position.set(p.x, 0.04, p.z);
    };
    this._onDragLeave = () => { this.ghost.visible = false; };
    this._onDrop = (e) => {
      const key = e.dataTransfer?.getData("application/x-aquaflow-asset");
      this.ghost.visible = false;
      if (!key) return;
      e.preventDefault();
      const p = this._groundAt(e);
      if (p) this.handlers.onDrop?.(key, { x: p.x, z: p.z });
    };
    // Capture phase: decide (move item / re-plug / orbit) before OrbitControls starts a rotate.
    el.addEventListener("pointerdown", this._onDown, true);
    window.addEventListener("pointermove", this._onMove);
    window.addEventListener("pointerup", this._onUp);
    el.addEventListener("dragover", this._onDragOver);
    el.addEventListener("dragleave", this._onDragLeave);
    el.addEventListener("drop", this._onDrop);
  }

  _setPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  _groundAt(e, height = 0) {
    this._setPointer(e);
    this.groundPlane.constant = -height;
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  _hit(e) {
    this._setPointer(e);
    const plugs = this.linkObjects.filter((o) => o.userData.plug);
    const ph = this.raycaster.intersectObjects(plugs, false)[0];
    if (ph) return { plug: ph.object.userData.plug };
    const ih = this.raycaster.intersectObjects(this.itemRoot.children, true).find((h) => h.object.userData.fixtureId && !h.object.isSprite);
    const lh = this.raycaster.intersectObjects(this.linkObjects.filter((o) => o.userData.linkId), false)[0];
    if (ih && (!lh || ih.distance <= lh.distance + 0.2)) return { fixtureId: ih.object.userData.fixtureId };
    if (lh) return { linkId: lh.object.userData.linkId };
    // Labels are easy targets too.
    const sh = this.raycaster.intersectObjects(this.itemRoot.children, true).find((h) => h.object.isSprite);
    if (sh) return { fixtureId: sh.object.userData.fixtureId };
    return {};
  }

  _fixtureUnder(e, exclude) {
    this._setPointer(e);
    const hit = this.raycaster.intersectObjects(this.itemRoot.children, true).find((h) => h.object.userData.fixtureId && h.object.userData.fixtureId !== exclude);
    if (hit) return hit.object.userData.fixtureId;
    // Near miss on the ground: the closest item within 0.8 m.
    const p = this._groundAt(e);
    if (!p) return null;
    let best = null, bestD = 0.8;
    for (const [id, rec] of this.items) {
      if (id === exclude) continue;
      const d = Math.hypot(rec.group.position.x - p.x, rec.group.position.z - p.z);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  _pointerDown(e) {
    if (e.button !== 0) return;
    this.renderer.domElement.focus();
    const hit = this._hit(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    if (hit.plug) {
      const link = this.data.links.find((l) => l.id === hit.plug.linkId);
      if (!link) return;
      this.controls.enabled = false;
      this.drag = { mode: "replug", link, end: hit.plug.end, fixed: hit.plug.end === "from" ? link.to : link.from, target: null };
      this.handlers.onSelectLink?.(link.id);
      this._buildLinks();
      this._updateDragLine(e);
      return;
    }
    if (hit.fixtureId) {
      this.controls.enabled = false;
      const rec = this.items.get(hit.fixtureId);
      const p = this._groundAt(e, rec?.group.position.y || 0);
      this.drag = { mode: "move", id: hit.fixtureId, moved: false,
        offset: p && rec ? new THREE.Vector3(rec.group.position.x - p.x, 0, rec.group.position.z - p.z) : new THREE.Vector3() };
      this.handlers.onSelect?.(hit.fixtureId);
      return;
    }
    this.drag = { mode: "click", linkId: hit.linkId || null };
  }

  _pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const far = this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
    if (d.mode === "move" && (d.moved || far)) {
      const rec = this.items.get(d.id);
      if (!rec) return;
      const p = this._groundAt(e, rec.group.position.y);
      if (!p) return;
      d.moved = true;
      rec.group.position.x = p.x + d.offset.x;
      rec.group.position.z = p.z + d.offset.z;
      // Lights, cones and lines follow the item while it moves.
      const it = this.data.items.find((x) => x.id === d.id);
      if (it) { it.x = rec.group.position.x; it.z = rec.group.position.z; }
      this._buildLinks();
      this._buildCones();
      this._updateSelection();
    } else if (d.mode === "replug") {
      this._updateDragLine(e);
    } else if (d.mode === "click" && far) {
      d.mode = "orbit";
    }
  }

  _updateDragLine(e) {
    const d = this.drag;
    const a = this._portOf(d.fixed);
    if (!a) return;
    const target = this._fixtureUnder(e, d.fixed);
    d.target = target;
    let b;
    if (target) b = this._portOf(target);
    else b = this._groundAt(e, 0) || a.clone();
    const ok = target ? (this.handlers.canConnect?.(d.fixed, target) ?? true) : true;
    const curve = this._curve(a, b);
    this.dragLine.geometry.dispose();
    this.dragLine.geometry = new THREE.TubeGeometry(curve, 24, 0.045, 8);
    this.dragLine.material.color.set(target ? (ok ? 0x22c55e : 0xef4444) : 0xffffff);
    this.dragLine.visible = true;
    this.hoverRing.visible = !!target;
    if (target) {
      const p = this.items.get(target).group.position;
      this.hoverRing.position.set(p.x, p.y + 0.03, p.z);
      this.hoverRing.material.color.set(ok ? 0x22c55e : 0xef4444);
    }
  }

  _pointerUp() {
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    if (!d) return;
    if (d.mode === "move") {
      if (d.moved) {
        const rec = this.items.get(d.id);
        if (rec) this.handlers.onMoveEnd?.(d.id, { x: rec.group.position.x, z: rec.group.position.z });
      }
    } else if (d.mode === "replug") {
      this.dragLine.visible = false;
      this.hoverRing.visible = false;
      this.handlers.onReplug?.(d.link.id, d.end, d.target || null);
      this._buildLinks();
    } else if (d.mode === "click") {
      if (d.linkId) this.handlers.onSelectLink?.(d.linkId);
      else this.handlers.onSelect?.(null);
    }
  }

  /** Where plugs and items are on screen (client px) — for automated UI checks. */
  screenPositions() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toScreen = (v) => {
      const p = v.clone().project(this.camera);
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    };
    return {
      plugs: this.linkObjects.filter((o) => o.userData.plug).map((o) => ({ ...o.userData.plug, ...toScreen(o.position) })),
      items: [...this.items.entries()].map(([id, rec]) => ({ id, ...toScreen(rec.group.position.clone().setY(rec.group.position.y + 0.15)) })),
    };
  }

  /** Plan point at the middle of the current view (where "click to add" puts an item). */
  viewCenter() {
    const t = this.controls.target;
    return { x: t.x, z: t.z };
  }

  resize() {
    if (this.baking) return;                 // a video render holds the canvas at its export size
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this._onDown, true);
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerup", this._onUp);
    el.removeEventListener("dragover", this._onDragOver);
    el.removeEventListener("dragleave", this._onDragLeave);
    el.removeEventListener("drop", this._onDrop);
    this.controls.dispose();
    this.composer?.dispose?.();
    disposeObject(this.scene);
    this.sprite.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

/**
 * The joints of an equipment model (generate_fountain_assets.py conventions, glTF +Y up):
 *   motion nozzle   Pan_Z (turns about +Y) → Tilt_X (tilts about +X) → NozzleSocket (water outlet)
 *   rotating basket Rotor_Z (spins about +Y) with Outlet_1..n round it
 * Positions are read in model space (the clone is not parented yet, so world = model space).
 */
function readRig(model) {
  model.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const rig = {};
  const socket = model.getObjectByName("NozzleSocket");
  if (socket) rig.socketY = socket.getWorldPosition(v).y;
  const pan = model.getObjectByName("Pan_Z"), tilt = model.getObjectByName("Tilt_X");
  if (pan && tilt && socket) {
    const pivot = tilt.getWorldPosition(new THREE.Vector3());
    const tip = socket.getWorldPosition(new THREE.Vector3());
    rig.pan = pan; rig.tilt = tilt;
    rig.panRest = pan.quaternion.clone(); rig.tiltRest = tilt.quaternion.clone();
    rig.panRestPos = pan.position.clone();
    rig.panBaseY = pan.getWorldPosition(new THREE.Vector3()).y;   // where the head sits when lowered
    rig.pivotY = pivot.y;                       // the tilt joint height
    rig.arm = tip.distanceTo(pivot);            // joint → outlet
  }
  const rotor = model.getObjectByName("Rotor_Z");
  if (rotor) {
    const outs = [];
    for (let i = 1; i <= 6; i += 1) {
      const o = model.getObjectByName(`Outlet_${i}`);
      if (!o) break;
      const w = o.getWorldPosition(new THREE.Vector3());
      outs.push({ a: Math.atan2(w.z, w.x), r: Math.hypot(w.x, w.z), y: w.y });
    }
    if (outs.length) { rig.rotor = rotor; rig.rotorRest = rotor.quaternion.clone(); rig.basket = outs; }
  }
  return rig;
}

/** Free GPU memory under `root`, except GLB clones: they share geometry with the cached template. */
function disposeObject(root) {
  if (!root || root.userData?.sharedAsset) return;
  root.geometry?.dispose?.();
  const mats = Array.isArray(root.material) ? root.material : root.material ? [root.material] : [];
  for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  for (const child of root.children || []) disposeObject(child);
}
