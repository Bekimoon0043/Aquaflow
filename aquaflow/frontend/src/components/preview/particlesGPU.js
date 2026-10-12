/**
 * particlesGPU.js — AF-3D-007 (realism plan, Phase R2)
 *
 * GPU-simulated particle field. Particle state lives in floating-point textures and
 * is advanced entirely on the GPU, so the CPU cost per frame is a handful of small
 * uniform uploads instead of a loop over every droplet.
 *
 * WHY
 * ---
 * The CPU field integrates, tests impacts, compacts its arrays with copyWithin and
 * re-uploads eight attributes every frame. That is O(n) work on the main thread and
 * it caps out around ninety thousand particles — an order of magnitude below the
 * density that makes a Depence jet read as water rather than as sparse dots. Here
 * the same physics runs as a fragment shader over a state texture, and the count is
 * bounded by fill rate rather than by JavaScript.
 *
 * HOW STATE IS STORED
 * -------------------
 *   posLife  RGBA32F   xyz = world position, w = remaining life
 *   velLife  RGBA32F   xyz = velocity,       w = life at spawn (for the age fraction)
 *   meta     RGBA32F   x = emitter index, y = per-particle seed  (static; rebuilt only
 *                      when the design's nozzle layout changes)
 *   emitters RGBA32F   6 rows x N emitters — re-uploaded each frame, ~5 KB
 *
 * Two ping-ponged passes advance it: one writes velocity, one writes position. Both
 * recompute the FULL step from the same previous state and the same uniforms, so
 * they cannot disagree about whether a particle died, respawned or bounced — a
 * shared `simulate()` gives them one definition of the physics. Multiple render
 * targets would save the duplicated arithmetic, but it costs GLSL3 plus an MRT path,
 * and a second fullscreen pass over a 512-square texture is far cheaper than that
 * complexity.
 *
 * SPAWNING WITHOUT A CPU
 * ----------------------
 * There is no append: the pool is fixed and each particle permanently belongs to one
 * emitter (see allocatePool in nozzleEmitters.js). A dead particle respawns at its
 * own emitter with fresh randomised velocity, gated by that emitter's `density`, so
 * live density tracks show intensity while the allocation stays stable. This is why
 * a fountain suits GPU particles so well: its emitters are continuous, not bursty.
 *
 * WHAT STAYS ON THE CPU
 * ---------------------
 * Solved hydraulic launch speed, wind, animated aiming and per-type tuning all stay
 * in nozzleEmitters.js. Flame and laser keep their CPU systems. And the CPU water
 * field keeps running as an invisible statistical SAMPLE so the splash map and its
 * calibrated containment figures — real engineering output — stay exactly as tested.
 */

import { billboardFrag } from "./particlesBillboard";
import { emitterOpacityScale } from './waterOptics';

/** Rows of the emitter parameter texture. Must match EMIT_ROWS in the shaders. */
const EMIT_ROWS = 6;

/**
 * Can this renderer simulate particles on the GPU?
 * Needs WebGL2 plus the ability to render into a 32-bit float target.
 */
export function gpuParticlesSupported(THREE, renderer) {
  try {
    if (!renderer?.capabilities?.isWebGL2) return false;
    return !!renderer.extensions?.get?.("EXT_color_buffer_float");
  } catch (e) {
    return false;
  }
}

// ─── Shared GLSL: hashing, emitter lookup, spawn and the physics step ────────
const SIM_COMMON = /* glsl */ `
precision highp float;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform sampler2D uMeta;
uniform sampler2D uEmit;
uniform vec2  uEmitSize;
uniform float uTime;
uniform float uDt;
uniform float uGravity;
uniform float uDrag;
uniform float uTurb;
uniform vec2  uWind;
uniform vec4  uPool;      // x: 1 = circular, y: radius, z: width, w: length
varying vec2  vUv;

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }

vec3 hash33(vec3 p){
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

vec4 emitTexel(float idx, float row){
  return texture2D(uEmit, vec2((idx + 0.5) / uEmitSize.x, (row + 0.5) / uEmitSize.y));
}

bool insidePool(vec2 xz){
  if (uPool.x > 0.5) return dot(xz, xz) <= uPool.y * uPool.y;
  return abs(xz.x) <= uPool.z * 0.5 && abs(xz.y) <= uPool.w * 0.5;
}

/** Fresh state for a particle being (re)born at its emitter. */
void spawnState(float emitIdx, float seed, out vec3 pos, out vec3 vel, out float life){
  vec4 e0 = emitTexel(emitIdx, 0.0);   // origin.xyz, mode
  vec4 e1 = emitTexel(emitIdx, 1.0);   // dir.xyz,    speed
  vec4 e2 = emitTexel(emitIdx, 2.0);   // spread, speedJitter, spawnRadius, density
  vec4 e3 = emitTexel(emitIdx, 3.0);   // color.rgb,  life
  vec4 e4 = emitTexel(emitIdx, 4.0);   // scale, scaleJitter, stretch, p1
  vec4 e5 = emitTexel(emitIdx, 5.0);   // p2, class, -, -

  float mode   = e0.w;
  float speed  = e1.w;
  float spread = e2.x, sJit = e2.y, sRad = e2.z;
  float p1 = e4.w, p2 = e5.x;

  // Two independent random triples, decorrelated by time so successive lives differ.
  vec3 r  = hash33(vec3(seed * 13.1, uTime * 0.731, seed * 7.7));
  vec3 r2 = hash33(vec3(seed * 3.3,  uTime * 1.117 + 11.0, seed * 29.0));

  pos  = e0.xyz;
  life = e3.w;

  if (mode < 0.5) {
    // CONE — a directed stream with lateral spread in metres/second, exactly as the
    // CPU path jitters vx/vz rather than perturbing an angle.
    vec3 d = normalize(e1.xyz + vec3(0.0, 1e-5, 0.0));
    vel = d * speed * (1.0 + (r.x - 0.5) * sJit)
        + vec3(r.y - 0.5, 0.0, r.z - 0.5) * spread;
    pos += vec3(r2.x - 0.5, 0.0, r2.y - 0.5) * sRad * 2.0;
  } else if (mode < 1.5) {
    // RING — a circle of jets thrown outward and up.
    float a = r.x * 6.2831853;
    vel = vec3(cos(a) * p1, speed * (1.0 + (r.y - 0.5) * sJit), sin(a) * p1)
        + vec3(r2.x - 0.5, 0.0, r2.y - 0.5) * spread;
    pos += vec3(cos(a), 0.0, sin(a)) * sRad;
  } else if (mode < 2.5) {
    // FAN — one launch speed swept across an elevation range in a single vertical
    // plane. dir.xz orients the plane; dir.y carries horizontal compression, which
    // is what gives the water screen its 3:1 envelope.
    float th  = mix(p1, p2, r.x);
    float vy  = speed * sin(th) * (1.0 + (r.y - 0.5) * sJit);
    float vh  = speed * cos(th) * e1.y;
    vec2  ax  = normalize(vec2(e1.x, e1.z) + vec2(1e-5, 0.0));
    vel = vec3(vh * ax.x, vy, vh * ax.y) + vec3(r2.x - 0.5, 0.0, r2.y - 0.5) * spread;
    pos += vec3(r2.x - 0.5, 0.0, r2.y - 0.5) * sRad * 2.0;
    life = max(0.12, vy / 9.81 * 2.0 * 1.05);
  } else if (mode < 3.5) {
    // CASCADE — a curtain spawned above the water and falling.
    pos += vec3((r.x - 0.5) * p1, 0.0, (r.y - 0.5) * sRad * 2.0);
    vel  = vec3((r2.x - 0.5) * spread, -speed * (0.6 + r.z * 0.8), (r2.y - 0.5) * spread);
  } else {
    // MIST — low-speed atomisation drifting outward and up.
    float a  = r.x * 6.2831853;
    float rr = r.y;
    vel = vec3(cos(a) * rr * speed, speed * (0.4 + r.z * 0.8), sin(a) * rr * speed)
        + vec3(r2.x - 0.5, 0.0, r2.y - 0.5) * spread;
    pos += vec3(cos(a) * rr, r2.z * 0.3, sin(a) * rr) * sRad;
  }

  vel.xz += uWind * 0.08;
  life *= 0.85 + r2.z * 0.3;   // spread lifetimes so the field never pulses in unison
}

/**
 * One full step from the previous state. Both passes call this, so velocity and
 * position can never disagree about a death, a respawn or a bounce.
 */
void simulate(vec2 uv, out vec3 outPos, out vec3 outVel, out float outLife, out float outMaxLife){
  vec4 pl   = texture2D(uPos,  uv);
  vec4 vm   = texture2D(uVel,  uv);
  vec4 meta = texture2D(uMeta, uv);

  float emitIdx = meta.x;
  float seed    = meta.y;
  float density = emitTexel(emitIdx, 2.0).w;

  float life = pl.w - uDt;

  if (life <= 0.0) {
    // Dead. Respawn only if the emitter is running, and then only for this
    // particle's share of it — so live density follows show intensity while the
    // pool allocation stays fixed.
    float roll = hash11(seed * 91.7 + floor(uTime * 60.0) * 0.013);
    if (roll < density) {
      vec3 p, v; float l;
      spawnState(emitIdx, seed, p, v, l);
      outPos = p; outVel = v; outLife = l; outMaxLife = l;
    } else {
      outPos = vec3(0.0, -100.0, 0.0);   // parked below the world, drawn as degenerate
      outVel = vec3(0.0);
      outLife = 0.0; outMaxLife = max(vm.w, 1e-3);
    }
    return;
  }

  vec3 p = pl.xyz;
  vec3 v = vm.xyz;

  // Quadratic drag, matching the CPU field, plus curl-flavoured turbulence. The
  // turbulence is what breaks a jet's droplets out of perfectly parallel ballistic
  // tracks — without it a dense stream reads as a solid extruded ribbon.
  float sp    = length(v);
  float dragF = uDrag * sp;
  vec3  tp    = p * 0.9 + vec3(0.0, uTime * 0.6, 0.0);
  vec3  turb  = vec3(sin(tp.z * 1.7 + uTime * 1.3),
                     sin(tp.x * 1.3 + uTime * 0.9),
                     sin(tp.y * 1.9 + uTime * 1.1)) * uTurb;

  v += (vec3(0.0, uGravity, 0.0) - v * dragF + turb) * uDt;
  vec3 np = p + v * uDt;

  // Impact. Water into water punches in and throws a compact splash back up; water
  // onto stone loses its vertical momentum and shears sideways into a low sheet.
  if (np.y < 0.05 && v.y < 0.0) {
    bool inside = insidePool(np.xz);
    if (p.y >= 0.05) {
      if (inside) { v.y = abs(v.y) * 0.15; v.xz *= 0.8; }
      else        { v.y = abs(v.y) * 0.06; v.xz *= 1.35; life = min(life, 0.5); }
    } else {
      // Already down: settle rather than bouncing forever.
      life = min(life, 0.15);
      v.y  = max(v.y, 0.0);
    }
    np.y = inside ? 0.05 : 0.012;
  }

  outPos = np; outVel = v; outLife = life; outMaxLife = max(vm.w, 1e-3);
}
`;

const SIM_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const VEL_FRAG = SIM_COMMON + /* glsl */ `
void main(){
  vec3 p, v; float life, maxLife;
  simulate(vUv, p, v, life, maxLife);
  gl_FragColor = vec4(v, maxLife);
}`;

const POS_FRAG = SIM_COMMON + /* glsl */ `
void main(){
  vec3 p, v; float life, maxLife;
  simulate(vUv, p, v, life, maxLife);
  gl_FragColor = vec4(p, life);
}`;

// ─── Render: instanced billboards sourced from the state textures ────────────
const RENDER_VERT = /* glsl */ `
precision highp float;
attribute float aIndex;
uniform sampler2D uPosTex;
uniform sampler2D uVelTex;
uniform sampler2D uMetaTex;
uniform sampler2D uEmit;
uniform vec2  uTexSize;
uniform vec2  uEmitSize;
uniform float uSizeScale;
uniform float uAlpha;
varying vec4  vColor;
varying float vLife;
varying vec3  vWorldPos;
varying vec2  vUv;
varying float vViewZ;
varying float vSeed;

vec4 emitTexel(float idx, float row){
  return texture2D(uEmit, vec2((idx + 0.5) / uEmitSize.x, (row + 0.5) / uEmitSize.y));
}

void main(){
  vec2 puv = (vec2(mod(aIndex, uTexSize.x), floor(aIndex / uTexSize.x)) + 0.5) / uTexSize;
  vec4 pl = texture2D(uPosTex, puv);
  vec4 vm = texture2D(uVelTex, puv);
  float life = pl.w;

  // Dead particles collapse to a degenerate, off-clip triangle: no fragments, and
  // no need to compact the pool the way the CPU field must.
  if (life <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  vec4 meta = texture2D(uMetaTex, puv);
  float emitIdx = meta.x;
  float seed    = meta.y;
  vec4 e3 = emitTexel(emitIdx, 3.0);   // colour.rgb
  vec4 e4 = emitTexel(emitIdx, 4.0);   // scale, scaleJitter, stretch

  float maxLife  = max(vm.w, 1e-3);
  float lifeFrac = clamp(life / maxLife, 0.0, 1.0);
  float age      = 1.0 - lifeFrac;

  // Life stages, the stream -> droplet -> mist read of a real jet: coherent and
  // stretched leaving the nozzle, breaking into droplets in flight, swelling into
  // soft mist as it falls.
  float scale   = e4.x * (1.0 + e4.y * (seed - 0.5) * 2.0);
  scale        *= mix(1.0, 1.9, smoothstep(0.62, 1.0, age));
  float stretch = e4.z * (1.0 - smoothstep(0.15, 0.75, age) * 0.75);

  // Per-droplet opacity is far lower than the CPU field's. Optical depth through a
  // jet is roughly count x alpha x area, and the GPU field carries well over an
  // order of magnitude more droplets through the same volume — at the old opacity a
  // jet integrates to solid white and loses its shape entirely. Smaller, fainter,
  // far more numerous droplets is also simply what water is.
  vColor    = vec4(e3.rgb, uAlpha * emitTexel(emitIdx, 5.0).z);
  vLife     = lifeFrac;
  vWorldPos = pl.xyz;
  vSeed     = seed;
  vUv       = uv;

  vec4 mv = modelViewMatrix * vec4(pl.xyz, 1.0);
  vec3 vv = (viewMatrix * vec4(vm.xyz, 0.0)).xyz;
  float speed = length(vm.xyz);

  vec2 dir = vv.xy;
  float dl = length(dir);
  vec2 axis = dl > 1e-4 ? dir / dl : vec2(0.0, 1.0);
  vec2 perp = vec2(-axis.y, axis.x);

  float st      = 1.0 + stretch * min(speed * 0.30, 3.5);
  float size    = scale * uSizeScale;
  float halfLen = 0.5 * size * st;
  float halfWid = 0.5 * size / (0.35 + 0.65 * sqrt(st));

  mv.xy += axis * (position.x * 2.0 * halfLen) + perp * (position.y * 2.0 * halfWid);
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}`;

export class GPUParticleField {
  /**
   * @param {object} THREE
   * @param {object} renderer live WebGLRenderer
   * @param {object} opts { count, maxEmitters, map, maxFieldLights, gravity, drag,
   *                        turbulence, sizeScale, blendMode }
   */
  constructor(THREE, renderer, {
    count = 262144, maxEmitters = 64, map = null, maxFieldLights = 16,
    gravity = -9.5, drag = 0.018, turbulence = 0.35, sizeScale = 0.32,
    alpha = 0.20, blendMode = "scatter",
  } = {}) {
    this.T = THREE;
    this.renderer = renderer;
    this.maxEmitters = maxEmitters;

    // Square-ish state texture holding `count` particles.
    const side = Math.max(2, Math.ceil(Math.sqrt(count)));
    this.texW = side;
    this.texH = Math.ceil(count / side);
    this.count = this.texW * this.texH;

    const T = THREE;
    const rtOpts = {
      type: T.FloatType,
      format: T.RGBAFormat,
      minFilter: T.NearestFilter,
      magFilter: T.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    const mkRT = () => {
      const rt = new T.WebGLRenderTarget(this.texW, this.texH, rtOpts);
      if (T.NoColorSpace) rt.texture.colorSpace = T.NoColorSpace;
      return rt;
    };
    this.posRT = [mkRT(), mkRT()];
    this.velRT = [mkRT(), mkRT()];
    this.cur = 0;

    // Emitter parameter texture — 6 rows, re-uploaded each frame.
    this.emitData = new Float32Array(maxEmitters * EMIT_ROWS * 4);
    this.emitTex = new T.DataTexture(this.emitData, maxEmitters, EMIT_ROWS, T.RGBAFormat, T.FloatType);
    this.emitTex.minFilter = this.emitTex.magFilter = T.NearestFilter;
    if (T.NoColorSpace) this.emitTex.colorSpace = T.NoColorSpace;
    this.emitTex.needsUpdate = true;

    // Per-particle emitter assignment + seed. Static: rebuilt only on layout change.
    this.metaData = new Float32Array(this.count * 4);
    this.metaTex = new T.DataTexture(this.metaData, this.texW, this.texH, T.RGBAFormat, T.FloatType);
    this.metaTex.minFilter = this.metaTex.magFilter = T.NearestFilter;
    if (T.NoColorSpace) this.metaTex.colorSpace = T.NoColorSpace;
    this.metaTex.needsUpdate = true;

    const simUniforms = () => ({
      uPos:  { value: null },
      uVel:  { value: null },
      uMeta: { value: this.metaTex },
      uEmit: { value: this.emitTex },
      uEmitSize: { value: new T.Vector2(maxEmitters, EMIT_ROWS) },
      uTime: { value: 0 },
      uDt:   { value: 0 },
      uGravity: { value: gravity },
      uDrag: { value: drag },
      uTurb: { value: turbulence },
      uWind: { value: new T.Vector2() },
      uPool: { value: new T.Vector4(1, 6, 12, 8) },
    });

    this.velMat = new T.ShaderMaterial({ vertexShader: SIM_VERT, fragmentShader: VEL_FRAG, uniforms: simUniforms(), depthTest: false, depthWrite: false });
    this.posMat = new T.ShaderMaterial({ vertexShader: SIM_VERT, fragmentShader: POS_FRAG, uniforms: simUniforms(), depthTest: false, depthWrite: false });

    this._quadScene = new T.Scene();
    this._quadCam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new T.Mesh(new T.PlaneGeometry(2, 2), this.velMat);
    this._quadScene.add(this._quad);

    // ── Render mesh: one instanced quad per particle ──
    const geo = new T.InstancedBufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    geo.setAttribute("uv", new T.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const indices = new Float32Array(this.count);
    for (let i = 0; i < this.count; i++) indices[i] = i;
    geo.setAttribute("aIndex", new T.InstancedBufferAttribute(indices, 1));
    geo.instanceCount = this.count;
    geo.boundingSphere = new T.Sphere(new T.Vector3(0, 0, 0), 1e4);

    this.mat = new T.ShaderMaterial({
      vertexShader: RENDER_VERT,
      fragmentShader: billboardFrag(maxFieldLights),
      transparent: true,
      depthWrite: false,
      blending: T.CustomBlending,
      blendEquation: T.AddEquation,
      blendSrc: T.OneFactor,
      blendDst: blendMode === "emissive" ? T.OneFactor : T.OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
      uniforms: {
        uPosTex: { value: null },
        uVelTex: { value: null },
        uMetaTex: { value: this.metaTex },
        uEmit: { value: this.emitTex },
        uTexSize: { value: new T.Vector2(this.texW, this.texH) },
        uEmitSize: { value: new T.Vector2(maxEmitters, EMIT_ROWS) },
        uSizeScale: { value: sizeScale },
        uAlpha: { value: alpha },
        // Shared with the CPU backend's fragment stage.
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
        uFieldCount: { value: 0 },
        uFieldPos: { value: Array.from({ length: maxFieldLights }, () => new T.Vector3()) },
        uFieldCol: { value: Array.from({ length: maxFieldLights }, () => new T.Color(0, 0, 0)) },
        uFieldInt: { value: new Float32Array(maxFieldLights) },
        uFieldRad: { value: new Float32Array(maxFieldLights).fill(4.0) },
      },
    });
    this.uniforms = this.mat.uniforms;
    this.mesh = new T.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;

    this.activeEmitters = 0;
    this._layoutKey = "";
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

  setSoftEnabled(on) {
    const u = this.uniforms;
    u.uUseDepth.value = (on && u.uSceneDepth.value) ? 1.0 : 0.0;
  }

  /**
   * Assign particles to emitters. Only rebuilds the (large) meta texture when the
   * layout actually changes — `ranges` comes from allocatePool and is stable while
   * the design is.
   */
  setLayout(ranges, key) {
    if (key === this._layoutKey) return;
    this._layoutKey = key;
    this._ranges = ranges;
    const meta = this.metaData;
    meta.fill(0);
    for (let e = 0; e < ranges.length; e++) {
      const { start, count } = ranges[e];
      for (let i = 0; i < count; i++) {
        const p = (start + i) * 4;
        if (p + 1 >= meta.length) break;
        meta[p] = e;
        // Deterministic per-particle seed — same field every run, so a screenshot
        // comparison is meaningful.
        meta[p + 1] = ((start + i) * 2654435761 % 65536) / 65536;
      }
    }
    this.metaTex.needsUpdate = true;
    this.activeEmitters = ranges.length;
  }

  /** Upload this frame's emitter parameters. */
  setEmitters(list) {
    const d = this.emitData;
    const n = Math.min(list.length, this.maxEmitters);
    const W = this.maxEmitters;
    const put = (row, col, a, b, c, dd) => {
      const o = (row * W + col) * 4;
      d[o] = a; d[o + 1] = b; d[o + 2] = c; d[o + 3] = dd;
    };
    for (let i = 0; i < n; i++) {
      const e = list[i];
      put(0, i, e.ox, e.oy, e.oz, e.mode);
      put(1, i, e.dx, e.dy, e.dz, e.speed);
      put(2, i, e.spread, e.speedJitter, e.spawnRadius, Math.max(0, Math.min(1, e.density)));
      put(3, i, e.color[0], e.color[1], e.color[2], e.life);
      put(4, i, e.scale, e.scaleJitter, e.stretch, e.p1);
      put(5, i, e.p2, 0, emitterOpacityScale(e, this._ranges?.[i]?.count || 0), 0);
    }
    for (let i = n; i < W; i++) {
      // Density 0 parks any particle still assigned to a removed emitter.
      put(2, i, 0, 0, 0, 0);
    }
    this.emitTex.needsUpdate = true;
  }

  /** Advance the simulation one frame. */
  step(delta, elapsed, { wind, pool } = {}) {
    const r = this.renderer;
    const read = this.cur, write = 1 - this.cur;
    const dt = Math.min(delta, 0.05);

    for (const mat of [this.velMat, this.posMat]) {
      const u = mat.uniforms;
      u.uPos.value = this.posRT[read].texture;
      u.uVel.value = this.velRT[read].texture;
      u.uTime.value = elapsed;
      u.uDt.value = dt;
      if (wind) u.uWind.value.set(wind.x || 0, wind.z || 0);
      if (pool) {
        u.uPool.value.set(
          pool.type === "circular" ? 1 : 0,
          pool.radius || 6, pool.width || 12, pool.length || 8,
        );
      }
    }

    const prevTarget = r.getRenderTarget();
    const prevXR = r.xr.enabled;
    r.xr.enabled = false;

    this._quad.material = this.velMat;
    r.setRenderTarget(this.velRT[write]);
    r.render(this._quadScene, this._quadCam);

    this._quad.material = this.posMat;
    r.setRenderTarget(this.posRT[write]);
    r.render(this._quadScene, this._quadCam);

    r.setRenderTarget(prevTarget);
    r.xr.enabled = prevXR;

    this.cur = write;
    this.uniforms.uPosTex.value = this.posRT[write].texture;
    this.uniforms.uVelTex.value = this.velRT[write].texture;
  }

  dispose() {
    this.posRT.forEach(rt => rt.dispose());
    this.velRT.forEach(rt => rt.dispose());
    this.emitTex.dispose();
    this.metaTex.dispose();
    this.velMat.dispose();
    this.posMat.dispose();
    this.mat.dispose();
    this._quad.geometry.dispose();
    this.mesh.geometry.dispose();
    this.mesh.parent?.remove(this.mesh);
  }
}
