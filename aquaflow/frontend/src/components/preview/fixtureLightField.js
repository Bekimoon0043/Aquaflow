/**
 * fixtureLightField.js — AF-3D-022 (CAD/design render plan, Phase 3)
 *
 * Shader-evaluated fixture lighting for water, spray and the pool surface, with no
 * practical cap on fixture count.
 *
 * WHY
 * ---
 * The light field used to be four uniform ARRAYS sized MAX_FIELD_LIGHTS = 16, so a
 * civic show with 300 RGB fixtures lit its water with the first sixteen and silently
 * dropped the rest. Uniform arrays cannot grow much further (the vec4 uniform budget
 * is shared with everything else in the program), and looping 300 lights per droplet
 * would not be affordable anyway.
 *
 * HOW
 * ---
 *   • Every fixture is encoded into a float DataTexture (`MAX_FIXTURE_LIGHTS` wide,
 *     3 rows): position + range, beam axis + cos(outer), colour x intensity + cos(inner).
 *   • A 2D CLUSTER grid over the site's xz plane lists, per cell, the indices of the
 *     (at most CLUSTER_K) nearest fixtures whose range reaches that cell. A shader
 *     looks up its cell and loops only those — cost is bounded by CLUSTER_K, not by
 *     the fixture count. This is Forward+ binning done once on the CPU, which is
 *     enough because fixtures move only when the design changes.
 *   • Per-sample colour = beam-cone falloff x windowed inverse-square distance
 *     attenuation x Henyey-Greenstein forward scattering (g ≈ 0.6). Output is
 *     linear HDR, so bright beams through spray exceed 1.0 and drive bloom.
 *
 * Particles evaluate it per PARTICLE (in the vertex stage), the core column and the
 * pool surface per fragment. A small number of real three.js lights still light the
 * basin and walls (see the scene's underwater lights) — droplets are transparent and
 * cannot be lit by forward lights cheaply, which is why this exists.
 */

export const MAX_FIXTURE_LIGHTS = 1024;
export const LIGHT_ROWS = 3;
export const CLUSTER_DIM = 32;
export const CLUSTER_K = 16;
export const HG_G = 0.6;
/** Inverse-square knee: 1 / (1 + k d²). Matches the old field's falloff over 1–10 m. */
export const ATTEN_K = 0.12;
/** How much of the phase function is HG vs isotropic (keeps side views readable). */
export const PHASE_MIX = 0.7;
/** Brightness gain carried over from the old uniform field (intensity x 1.8 x 0.95). */
export const FIELD_GAIN = 1.71;

/** AF-NEXT-013: overlapping fixtures that pass with no density normalisation. */
export const DENSITY_FREE = 2.0;
/** Exponent of the density normalisation (1 = hold total energy flat beyond FREE). */
export const DENSITY_EXP = 0.85;
/** Pool-surface soft knee: linear below KNEE, asymptote KNEE + ROOM (peak channel). */
export const SURFACE_KNEE = 0.8;
export const SURFACE_ROOM = 0.2;
/**
 * Dense-overlap cap on the pool surface's TOTAL fixture term (after the shader's
 * reflection/caustic/specular gains): blended in from DENSE_FROM to DENSE_TO overlapping
 * fixtures, linear below DENSE_KNEE, asymptote DENSE_MAX on the peak channel. 1.0 HDR
 * keeps saturated LED colours chromatic through ACES at the night exposure (1.55); the
 * old uncapped dense term reached 2.5-4 and ACES turned it white.
 */
export const DENSE_FROM = 2.0;
export const DENSE_TO = 4.0;
export const DENSE_KNEE = 0.6;
export const DENSE_MAX = 1.0;

const DEFAULT_HALF_ANGLE_DEG = 28;
const DEFAULT_SOFTNESS_DEG = 10;

// ─── GLSL ────────────────────────────────────────────────────────────────────
/**
 * Uniform declarations + `vec3 fieldLight(vec3 p, vec3 toCam, float g, float coneW)`.
 * `coneW` = 1 applies the beam cone fully; 0 treats the fixture as an omni glow
 * with the old field's reach (one fixture radius) — used for the pool surface, which
 * sits just above the fixtures and would otherwise see only the beam's footprint.
 */
export const FIELD_LIGHT_GLSL = /* glsl */ `
uniform sampler2D uLightTex;
uniform sampler2D uClusterTex;
uniform vec4  uClusterBounds;   // xy = origin (world xz), zw = 1 / size
uniform float uClusterDim;
uniform int   uFieldCount;
uniform float uFieldDensityNormOff;   // AF-NEXT-013: 1 = pre-fix response ("before" screenshots only)
uniform float uFieldMaxGroups;        // AF-NEXT-013: groups of 4 nearest fixtures evaluated (4 = all 16; eco 1)

vec4 flTexel(float idx, float row){
  return texture2D(uLightTex, vec2((idx + 0.5) / ${MAX_FIXTURE_LIGHTS}.0, (row + 0.5) / ${LIGHT_ROWS}.0));
}

float flPhaseHG(float c, float g){
  float g2 = g * g;
  // Normalised so an isotropic medium scores 1 (4π · HG).
  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
}

vec3 flContribution(float id, vec3 p, vec3 toCam, float g, float coneW){
  vec4 r0 = flTexel(id, 0.0);   // pos.xyz, range
  vec3 L  = p - r0.xyz;
  float d = length(L);
  if (d >= r0.w) return vec3(0.0);
  vec4 r1 = flTexel(id, 1.0);   // axis.xyz, cos(outer)
  vec4 r2 = flTexel(id, 2.0);   // colour x intensity, cos(inner)
  vec3 ld = L / max(d, 1e-4);
  float cone = mix(1.0, smoothstep(r1.w, r2.w, dot(ld, r1.xyz)), coneW);
  // An omni (coneW = 0) sample — the pool surface — keeps the old field's reach of one
  // fixture radius (range / 3); beams through spray carry the full range.
  float x   = d / (r0.w * mix(${(1/3).toFixed(6)}, 1.0, coneW));
  float win = clamp(1.0 - x * x * x * x, 0.0, 1.0);
  float att = win * win / (1.0 + ${ATTEN_K} * d * d);
  float phase = mix(1.0, flPhaseHG(dot(ld, toCam), g), ${PHASE_MIX});
  return r2.rgb * (cone * att * phase);
}

// AF-NEXT-013: accumulate one fixture and track the density statistics.
void flAccum(float id, vec3 p, vec3 toCam, float g, float coneW, inout vec3 acc, inout vec2 dens){
  vec3 c = flContribution(id, p, toCam, g, coneW);
  float e = max(max(c.r, c.g), c.b);
  acc += c;
  dens += vec2(e, 0.0);
  dens.y = max(dens.y, e);
}

/**
 * rgb = summed fixture light (linear HDR); a = effective number of overlapping fixtures
 * at p, n = sum(e_i) / max(e_i) with e_i each fixture's peak channel here: 1 for a lone
 * fixture however bright, ~N where N comparable fixtures overlap. maxGroups limits
 * the loop to the first maxGroups x 4 (nearest) fixtures of the cell (eco tier).
 */
vec4 fieldLightN(vec3 p, vec3 toCam, float g, float coneW, float maxGroups){
  if (uFieldCount <= 0) return vec4(0.0);
  vec2 cuv = (p.xz - uClusterBounds.xy) * uClusterBounds.zw;
  if (cuv.x < 0.0 || cuv.y < 0.0 || cuv.x >= 1.0 || cuv.y >= 1.0) return vec4(0.0);
  vec2 cell = min(floor(cuv * uClusterDim), vec2(uClusterDim - 1.0));
  float cells = uClusterDim * uClusterDim;
  float u = (cell.y * uClusterDim + cell.x + 0.5) / cells;
  vec3 acc = vec3(0.0);
  vec2 dens = vec2(0.0);
  for (int k = 0; k < ${CLUSTER_K / 4}; k++) {
    if (float(k) >= maxGroups) break;
    vec4 ids = texture2D(uClusterTex, vec2(u, (float(k) + 0.5) / ${CLUSTER_K / 4}.0));
    if (ids.x < 0.5) break;
    flAccum(ids.x - 1.0, p, toCam, g, coneW, acc, dens);
    if (ids.y < 0.5) break;
    flAccum(ids.y - 1.0, p, toCam, g, coneW, acc, dens);
    if (ids.z < 0.5) break;
    flAccum(ids.z - 1.0, p, toCam, g, coneW, acc, dens);
    if (ids.w < 0.5) break;
    flAccum(ids.w - 1.0, p, toCam, g, coneW, acc, dens);
  }
  return vec4(acc, dens.x / max(dens.y, 1e-6));
}

vec3 fieldLight(vec3 p, vec3 toCam, float g, float coneW){
  return fieldLightN(p, toCam, g, coneW, uFieldMaxGroups).rgb;
}

/**
 * AF-NEXT-013 energy normalisation for MANY overlapping fixtures. Up to
 * DENSITY_FREE (2) fully overlapping fixtures pass unchanged — the 1-2 fixture look is
 * bit-identical. Beyond that the sum is scaled by (FREE / n)^DENSITY_EXP, a uniform
 * scale, so the hue/chroma of the mix is untouched and only its energy is held back.
 */
vec3 flDensityNormalize(vec4 f){
  return (uFieldDensityNormOff > 0.5 || f.a <= ${DENSITY_FREE.toFixed(1)}) ? f.rgb : f.rgb * pow(${DENSITY_FREE.toFixed(1)} / f.a, ${DENSITY_EXP.toFixed(2)});
}

/**
 * The pool-surface soft knee (moved here from the water shader so a test can evaluate
 * it). Below SURFACE_KNEE the response is linear and unchanged; above, the peak channel
 * approaches SURFACE_KNEE + SURFACE_ROOM asymptotically. Uniform scale: chroma kept.
 */
vec3 flDenseSurface(vec3 c, float n){
  if (uFieldDensityNormOff > 0.5 || n <= ${DENSE_FROM.toFixed(1)}) return c;
  float peak = max(max(c.r, c.g), c.b);
  if (peak <= ${DENSE_KNEE.toFixed(2)}) return c;
  float room = ${(DENSE_MAX - DENSE_KNEE).toFixed(3)};
  vec3 capped = c * (${DENSE_KNEE.toFixed(2)} + room * (1.0 - exp(-(peak - ${DENSE_KNEE.toFixed(2)}) / room))) / peak;
  return mix(c, capped, smoothstep(${DENSE_FROM.toFixed(1)}, ${DENSE_TO.toFixed(1)}, n));
}

vec3 flSurfaceKnee(vec3 c){
  float peak = max(max(c.r, c.g), c.b);
  if (peak <= ${SURFACE_KNEE.toFixed(2)}) return c;
  return c * (${SURFACE_KNEE.toFixed(2)} + ${SURFACE_ROOM.toFixed(2)} * (1.0 - exp(-(peak - ${SURFACE_KNEE.toFixed(2)}) / ${SURFACE_ROOM.toFixed(2)}))) / peak;
}
`;

// ─── CPU side ────────────────────────────────────────────────────────────────
const clamp01 = v => Math.min(1, Math.max(0, v));

/**
 * Normalise a scene light record into the encoded form.
 * Accepts the scene's engineering-light records ({x, z, y?, color, intensity, radius,
 * tiltX?, tiltZ?, beamAngle?}).
 */
export function encodeLight(L) {
  const deg = Math.PI / 180;
  const tx = (Number(L.tiltX) || 0) * deg, tz = (Number(L.tiltZ) || 0) * deg;
  // Fixtures aim straight up unless tilted; tilt about X leans the beam toward +z.
  let ax = -Math.sin(tz), ay = Math.cos(tx) * Math.cos(tz), az = Math.sin(tx);
  const n = Math.hypot(ax, ay, az) || 1;
  ax /= n; ay /= n; az /= n;
  const half = Math.max(2, Math.min(85, (Number(L.beamAngle) || DEFAULT_HALF_ANGLE_DEG * 2) / 2));
  const outer = Math.min(89, half + DEFAULT_SOFTNESS_DEG / 2);
  const inner = Math.max(0.5, half - DEFAULT_SOFTNESS_DEG / 2);
  const radius = Math.max(1, Number(L.radius) || 6);
  const intensity = Math.max(0, Number(L.intensity) || 0) * FIELD_GAIN;
  const c = L.color || { r: 1, g: 1, b: 1 };
  return {
    x: Number(L.x) || 0, y: Number.isFinite(Number(L.y)) ? Number(L.y) : 0, z: Number(L.z) || 0,
    range: radius * 3,
    ax, ay, az,
    cosOuter: Math.cos(outer * deg), cosInner: Math.cos(inner * deg),
    r: (c.r ?? 1) * intensity, g: (c.g ?? 1) * intensity, b: (c.b ?? 1) * intensity,
  };
}

/** JS mirror of flContribution — for tests and CPU-side probes. */
export function lightContribution(enc, p, toCam, g = HG_G, coneW = 1) {
  const lx = p.x - enc.x, ly = p.y - enc.y, lz = p.z - enc.z;
  const d = Math.hypot(lx, ly, lz);
  if (d >= enc.range) return [0, 0, 0];
  const s = 1 / Math.max(d, 1e-4);
  const dx = lx * s, dy = ly * s, dz = lz * s;
  const t = clamp01((dx * enc.ax + dy * enc.ay + dz * enc.az - enc.cosOuter) / ((enc.cosInner - enc.cosOuter) || 1e-6));
  const cone = 1 + (t * t * (3 - 2 * t) - 1) * coneW;
  const x = d / (enc.range * (1 / 3 + (1 - 1 / 3) * coneW));
  const win = clamp01(1 - x * x * x * x);
  const att = (win * win) / (1 + ATTEN_K * d * d);
  const c = dx * (toCam?.x ?? 0) + dy * (toCam?.y ?? 0) + dz * (toCam?.z ?? 0);
  const g2 = g * g;
  const hg = (1 - g2) / Math.pow(Math.max(1 + g2 - 2 * g * c, 1e-4), 1.5);
  const phase = 1 + (hg - 1) * PHASE_MIX;
  const k = cone * att * phase;
  return [enc.r * k, enc.g * k, enc.b * k];
}

/**
 * Bin encoded lights into a dim x dim grid over their combined reach.
 * Each cell keeps the K nearest lights (to the cell centre) whose range reaches it.
 * Returns 1-based indices (0 = empty slot) so a cleared texture reads as "no light".
 */
export function buildClusters(encoded, dim = CLUSTER_DIM, K = CLUSTER_K) {
  const cells = new Float32Array(dim * dim * K);
  if (!encoded.length) return { cells, bounds: [0, 0, 1, 1], origin: [0, 0], size: [1, 1], maxPerCell: 0, dropped: 0 };
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const e of encoded) {
    minX = Math.min(minX, e.x - e.range); maxX = Math.max(maxX, e.x + e.range);
    minZ = Math.min(minZ, e.z - e.range); maxZ = Math.max(maxZ, e.z + e.range);
  }
  const sizeX = Math.max(1e-3, maxX - minX), sizeZ = Math.max(1e-3, maxZ - minZ);
  const cw = sizeX / dim, ch = sizeZ / dim;
  // Conservative reach: a cell is listed if the light's range touches ANY part of it.
  const halfDiag = 0.5 * Math.hypot(cw, ch);
  const lists = Array.from({ length: dim * dim }, () => []);
  encoded.forEach((e, idx) => {
    const i0 = Math.max(0, Math.floor((e.x - e.range - minX) / cw));
    const i1 = Math.min(dim - 1, Math.floor((e.x + e.range - minX) / cw));
    const j0 = Math.max(0, Math.floor((e.z - e.range - minZ) / ch));
    const j1 = Math.min(dim - 1, Math.floor((e.z + e.range - minZ) / ch));
    for (let j = j0; j <= j1; j++) {
      const cz = minZ + (j + 0.5) * ch;
      for (let i = i0; i <= i1; i++) {
        const cx = minX + (i + 0.5) * cw;
        const dist = Math.hypot(cx - e.x, cz - e.z);
        if (dist - halfDiag > e.range) continue;
        lists[j * dim + i].push({ idx, dist });
      }
    }
  });
  let maxPerCell = 0, dropped = 0;
  lists.forEach((list, cell) => {
    maxPerCell = Math.max(maxPerCell, list.length);
    if (list.length > K) { list.sort((a, b) => a.dist - b.dist); dropped += list.length - K; }
    const n = Math.min(K, list.length);
    for (let k = 0; k < n; k++) cells[cell * K + k] = list[k].idx + 1;
  });
  return {
    cells, origin: [minX, minZ], size: [sizeX, sizeZ],
    bounds: [minX, minZ, 1 / sizeX, 1 / sizeZ], maxPerCell, dropped,
  };
}

/** The (x, z) cell a world point falls in — mirrors the shader's lookup. */
export function clusterCellFor(clusters, x, z, dim = CLUSTER_DIM) {
  const u = (x - clusters.bounds[0]) * clusters.bounds[2];
  const v = (z - clusters.bounds[1]) * clusters.bounds[3];
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return -1;
  return Math.min(dim - 1, Math.floor(v * dim)) * dim + Math.min(dim - 1, Math.floor(u * dim));
}

/** Sum of every light reaching p through the cluster grid — the shader's answer. */
export function clusteredLight(encoded, clusters, p, toCam, g = HG_G, coneW = 1, K = CLUSTER_K) {
  const cell = clusterCellFor(clusters, p.x, p.z);
  const acc = [0, 0, 0];
  if (cell < 0) return acc;
  for (let k = 0; k < K; k++) {
    const id = clusters.cells[cell * K + k];
    if (id < 0.5) break;
    const c = lightContribution(encoded[id - 1], p, toCam, g, coneW);
    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
  }
  return acc;
}

/**
 * Like clusteredLight, plus the effective overlap count the shader's fieldLightN returns
 * in .a. `maxGroups` mirrors the eco loop limit (groups of 4 nearest fixtures).
 */
export function clusteredLightN(encoded, clusters, p, toCam, g = HG_G, coneW = 1, K = CLUSTER_K, maxGroups = K / 4) {
  const cell = clusterCellFor(clusters, p.x, p.z);
  const acc = [0, 0, 0];
  let eSum = 0, eMax = 0;
  if (cell < 0) return { rgb: acc, n: 0 };
  const limit = Math.min(K, maxGroups * 4);
  for (let k = 0; k < limit; k++) {
    const id = clusters.cells[cell * K + k];
    if (id < 0.5) break;
    const c = lightContribution(encoded[id - 1], p, toCam, g, coneW);
    acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2];
    const e = Math.max(c[0], c[1], c[2]);
    eSum += e; eMax = Math.max(eMax, e);
  }
  return { rgb: acc, n: eSum / Math.max(eMax, 1e-6) };
}

/** JS mirror of flDensityNormalize. */
export function densityNormalize(rgb, n) {
  if (!(n > DENSITY_FREE)) return rgb.slice();
  const k = Math.pow(DENSITY_FREE / n, DENSITY_EXP);
  return rgb.map(v => v * k);
}

/** JS mirror of flDenseSurface (total pool-surface fixture term, overlap count n). */
export function denseSurface(rgb, n) {
  if (!(n > DENSE_FROM)) return rgb.slice();
  const peak = Math.max(...rgb);
  if (peak <= DENSE_KNEE) return rgb.slice();
  const room = DENSE_MAX - DENSE_KNEE;
  const k = (DENSE_KNEE + room * (1 - Math.exp(-(peak - DENSE_KNEE) / room))) / peak;
  const x = Math.min(1, Math.max(0, (n - DENSE_FROM) / (DENSE_TO - DENSE_FROM)));
  const t = x * x * (3 - 2 * x);
  return rgb.map(v => v + (v * k - v) * t);
}

/** JS mirror of flSurfaceKnee. */
export function surfaceKnee(rgb) {
  const peak = Math.max(...rgb);
  if (peak <= SURFACE_KNEE) return rgb.slice();
  const k = (SURFACE_KNEE + SURFACE_ROOM * (1 - Math.exp(-(peak - SURFACE_KNEE) / SURFACE_ROOM))) / peak;
  return rgb.map(v => v * k);
}

/**
 * GPU-side container. Owns the two textures and the uniform objects every shader
 * shares (bind them with `bindFieldLightUniforms`).
 */
export class FixtureLightField {
  constructor(THREE, { maxLights = MAX_FIXTURE_LIGHTS, clusterDim = CLUSTER_DIM, clusterK = CLUSTER_K } = {}) {
    const T = THREE;
    this.T = T;
    this.maxLights = maxLights;
    this.dim = clusterDim;
    this.K = clusterK;
    this.lightData = new Float32Array(maxLights * LIGHT_ROWS * 4);
    this.lightTex = new T.DataTexture(this.lightData, maxLights, LIGHT_ROWS, T.RGBAFormat, T.FloatType);
    this.clusterData = new Float32Array(clusterDim * clusterDim * clusterK);
    this.clusterTex = new T.DataTexture(this.clusterData, clusterDim * clusterDim, clusterK / 4, T.RGBAFormat, T.FloatType);
    for (const tx of [this.lightTex, this.clusterTex]) {
      tx.minFilter = tx.magFilter = T.NearestFilter;
      tx.generateMipmaps = false;
      if (T.NoColorSpace) tx.colorSpace = T.NoColorSpace;
      tx.needsUpdate = true;
    }
    this.uniforms = {
      uLightTex: { value: this.lightTex },
      uClusterTex: { value: this.clusterTex },
      uClusterBounds: { value: new T.Vector4(0, 0, 1, 1) },
      uClusterDim: { value: clusterDim },
      uFieldCount: { value: 0 },
      uFieldDensityNormOff: { value: 0 },
      uFieldMaxGroups: { value: clusterK / 4 },
    };
    this.count = 0;
    this._geoKey = "";
    this.stats = { lights: 0, maxPerCell: 0, dropped: 0 };
  }

  /**
   * Upload this frame's lights. Colours/intensities are rewritten every call (cheap:
   * 12 floats a light); the cluster grid is rebuilt only when a fixture moves.
   */
  setLights(lights = []) {
    const n = Math.min(lights.length, this.maxLights);
    const W = this.maxLights, d = this.lightData;
    const encoded = this._encoded || (this._encoded = []);
    encoded.length = n;
    let key = "";
    for (let i = 0; i < n; i++) {
      const e = encodeLight(lights[i]);
      encoded[i] = e;
      key += `${e.x.toFixed(3)},${e.y.toFixed(3)},${e.z.toFixed(3)},${e.range.toFixed(2)};`;
      let o = i * 4;
      d[o] = e.x; d[o + 1] = e.y; d[o + 2] = e.z; d[o + 3] = e.range;
      o = (W + i) * 4;
      d[o] = e.ax; d[o + 1] = e.ay; d[o + 2] = e.az; d[o + 3] = e.cosOuter;
      o = (2 * W + i) * 4;
      d[o] = e.r; d[o + 1] = e.g; d[o + 2] = e.b; d[o + 3] = e.cosInner;
    }
    this.lightTex.needsUpdate = true;
    if (key !== this._geoKey) {
      this._geoKey = key;
      const cl = buildClusters(encoded, this.dim, this.K);
      // Texture layout: width = cells, height = K/4; texel (cell, k/4) holds 4 ids.
      const cells = this.dim * this.dim;
      for (let cell = 0; cell < cells; cell++) {
        for (let k = 0; k < this.K; k++) {
          const row = k >> 2, comp = k & 3;
          this.clusterData[(row * cells + cell) * 4 + comp] = cl.cells[cell * this.K + k];
        }
      }
      this.clusterTex.needsUpdate = true;
      this.uniforms.uClusterBounds.value.set(...cl.bounds);
      this.stats = { lights: n, maxPerCell: cl.maxPerCell, dropped: cl.dropped };
      this.clusters = cl;
    }
    this.count = n;
    this.uniforms.uFieldCount.value = n;
  }

  dispose() {
    this.lightTex.dispose();
    this.clusterTex.dispose();
  }
}

/** Point a material's uniform table at the shared field (same objects, not copies). */
export function bindFieldLightUniforms(target, field) {
  if (!target || !field) return target;
  for (const [k, v] of Object.entries(field.uniforms || field)) target[k] = v;
  return target;
}
