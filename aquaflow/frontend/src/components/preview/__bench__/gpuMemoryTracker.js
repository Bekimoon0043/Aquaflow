/**
 * gpuMemoryTracker.js — AF-NEXT-013: an ESTIMATE of the GPU memory the page allocates.
 *
 * WebGL exposes no "VRAM used" query. This wraps the allocation calls of every WebGL
 * context created after install() (texImage2D/3D, texStorage2D/3D, bufferData,
 * renderbufferStorage[Multisample], generateMipmap) and keeps a running byte total per
 * live object, released on delete*. It counts what the page ASKS for (drawing buffer
 * excluded, driver padding/compression ignored), so treat it as a lower-bound estimate.
 * Bench page only — never imported by the app.
 */
const GL = {
  TEXTURE_2D: 0x0de1, TEXTURE_CUBE_MAP: 0x8513, TEXTURE_3D: 0x806f, TEXTURE_2D_ARRAY: 0x8c1a,
  TEXTURE0: 0x84c0,
};
const TYPE_BYTES = { 0x1401: 1, 0x1400: 1, 0x1403: 2, 0x1402: 2, 0x1405: 4, 0x1404: 4, 0x1406: 4, 0x140b: 2, 0x8d61: 2, 0x8363: 2, 0x8033: 2, 0x8034: 2, 0x84fa: 4, 0x8368: 4, 0x8c3b: 4, 0x8c3e: 4 };
const FORMAT_CHANNELS = { 0x1903: 1, 0x1909: 1, 0x1906: 1, 0x190a: 2, 0x8227: 2, 0x1907: 3, 0x1908: 4, 0x1902: 1, 0x84f9: 1, 0x8d94: 1, 0x8228: 2, 0x8d98: 3, 0x8d99: 4 };
// Sized internal formats → bytes per texel.
const SIZED = {
  0x8229: 1, 0x822b: 2, 0x8051: 3, 0x8058: 4, 0x8c41: 3, 0x8c43: 4, 0x822d: 2, 0x822f: 4,
  0x881b: 6, 0x881a: 8, 0x822e: 4, 0x8230: 8, 0x8815: 12, 0x8814: 16, 0x8c3a: 4, 0x8c3d: 4,
  0x81a5: 2, 0x81a6: 3, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x8232: 1, 0x8236: 4, 0x8235: 4,
  0x8d62: 2, 0x8056: 2, 0x8057: 2, 0x8059: 4, 0x8d7c: 4, 0x8d70: 16, 0x8d76: 8,
};

function texelBytes(internalFormat, format, type) {
  if (SIZED[internalFormat]) return SIZED[internalFormat];
  return (FORMAT_CHANNELS[format] || FORMAT_CHANNELS[internalFormat] || 4) * (TYPE_BYTES[type] || 1);
}

export function installGpuMemoryTracker(target = typeof HTMLCanvasElement !== "undefined" ? HTMLCanvasElement.prototype : null) {
  if (!target || target.__afMemTracker) return globalThis.__afGpuMem;
  const state = globalThis.__afGpuMem = { bytes: 0, peak: 0, textures: 0, buffers: 0, renderbuffers: 0 };
  const sizes = new WeakMap();
  const set = (obj, bytes, kind) => {
    if (!obj) return;
    const prev = sizes.get(obj) || 0;
    if (!prev) state[kind]++;
    sizes.set(obj, bytes);
    state.bytes += bytes - prev;
    state.peak = Math.max(state.peak, state.bytes);
  };
  const free = (obj, kind) => {
    const prev = obj ? sizes.get(obj) : 0;
    if (!prev) return;
    sizes.delete(obj);
    state.bytes -= prev;
    state[kind]--;
  };
  const orig = target.getContext;
  target.getContext = function (type, attrs) {
    const gl = orig.call(this, type, attrs);
    if (!gl || gl.__afTracked || !/webgl/.test(String(type))) return gl;
    gl.__afTracked = true;
    let unit = 0;
    const boundTex = new Map();   // `${unit}:${target}` -> texture
    const boundBuf = new Map();
    let boundRb = null;
    const texFor = t => boundTex.get(`${unit}:${t === GL.TEXTURE_CUBE_MAP || (t >= 0x8515 && t <= 0x851a) ? GL.TEXTURE_CUBE_MAP : t}`);
    const levelBytes = new WeakMap();   // texture -> Map(face:level -> bytes)
    const addLevel = (tex, key, bytes) => {
      if (!tex) return;
      const m = levelBytes.get(tex) || new Map();
      m.set(key, bytes);
      levelBytes.set(tex, m);
      let sum = 0; for (const b of m.values()) sum += b;
      set(tex, sum, "textures");
    };
    const wrap = (name, fn) => { const o = gl[name]; if (typeof o === "function") gl[name] = function (...a) { fn(a); return o.apply(gl, a); }; };
    wrap("activeTexture", a => { unit = a[0] - GL.TEXTURE0; });
    wrap("bindTexture", a => { boundTex.set(`${unit}:${a[0]}`, a[1]); });
    wrap("bindBuffer", a => { boundBuf.set(a[0], a[1]); });
    wrap("bindRenderbuffer", a => { boundRb = a[1]; });
    wrap("texImage2D", a => {
      // (target, level, internalformat, width, height, border, format, type, ...) or the
      // 6-arg TexImageSource form (target, level, internalformat, format, type, source).
      let w, h, fmt, type;
      if (a.length >= 8) { w = a[3]; h = a[4]; fmt = a[6]; type = a[7]; }
      else { const src = a[5] || {}; w = src.videoWidth || src.naturalWidth || src.width || 0; h = src.videoHeight || src.naturalHeight || src.height || 0; fmt = a[3]; type = a[4]; }
      addLevel(texFor(a[0]), `${a[0]}:${a[1]}`, w * h * texelBytes(a[2], fmt, type));
    });
    wrap("texImage3D", a => addLevel(texFor(a[0]), `${a[0]}:${a[1]}`, a[3] * a[4] * a[5] * texelBytes(a[2], a[7], a[8])));
    wrap("texStorage2D", a => {
      let total = 0, w = a[3], h = a[4];
      for (let l = 0; l < a[1]; l++) { total += Math.max(1, w) * Math.max(1, h) * texelBytes(a[2]); w >>= 1; h >>= 1; }
      addLevel(texFor(a[0]), "storage", total * (a[0] === GL.TEXTURE_CUBE_MAP ? 6 : 1));
    });
    wrap("texStorage3D", a => addLevel(texFor(a[0]), "storage", a[3] * a[4] * a[5] * texelBytes(a[2]) * (a[1] > 1 ? 4 / 3 : 1)));
    wrap("generateMipmap", a => {
      const tex = texFor(a[0]); const m = tex && levelBytes.get(tex);
      if (m && !m.has("mips")) { let s = 0; for (const b of m.values()) s += b; addLevel(tex, "mips", s / 3); }
    });
    wrap("bufferData", a => {
      const size = typeof a[1] === "number" ? a[1] : (a[1]?.byteLength || 0);
      set(boundBuf.get(a[0]), size, "buffers");
    });
    wrap("renderbufferStorage", a => set(boundRb, a[2] * a[3] * texelBytes(a[1]), "renderbuffers"));
    wrap("renderbufferStorageMultisample", a => set(boundRb, Math.max(1, a[1]) * a[3] * a[4] * texelBytes(a[2]), "renderbuffers"));
    wrap("deleteTexture", a => free(a[0], "textures"));
    wrap("deleteBuffer", a => free(a[0], "buffers"));
    wrap("deleteRenderbuffer", a => free(a[0], "renderbuffers"));
    return gl;
  };
  target.__afMemTracker = true;
  return state;
}

export function gpuMemorySnapshot() {
  const s = globalThis.__afGpuMem;
  if (!s) return null;
  const mb = b => Number((b / (1024 * 1024)).toFixed(1));
  return { estimatedMB: mb(s.bytes), peakMB: mb(s.peak), textures: s.textures, buffers: s.buffers, renderbuffers: s.renderbuffers };
}
