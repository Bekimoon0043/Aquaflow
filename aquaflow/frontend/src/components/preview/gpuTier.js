/**
 * gpuTier.js — AF-NEXT-013: pick the starting render tier for THIS machine.
 *
 * First run: read the GPU name (WEBGL_debug_renderer_info), run a ~100 ms fill-rate
 * probe, classify, and cache the answer in localStorage (re-detected when the GPU
 * string changes). Known weak GPUs start on `eco`. Strong GPUs keep the existing
 * default (`medium`) — their tiers are unchanged.
 *
 * The probe thresholds are calibrated on ONE machine (GeForce GT 730, the AF-NEXT-013
 * entry reference). They are provisional until midrange/high-end GPUs are measured.
 */

const STORAGE_KEY = "aquaflow.gpuProfile.v1";

const PATTERNS = {
  software: /swiftshader|llvmpipe|softpipe|microsoft basic render|software rasterizer/i,
  entry: [
    /geforce\s*(gt|gts)\s*\d{3,4}/i,                 // GT 610…GT 1030
    /geforce\s*(\d{3}m|mx\s?\d{2,3}|9\d{2}m)\b/i,     // old mobile / MX
    /geforce\s*gtx\s*(4\d\d|5\d\d|6[0-5]\d|7[0-4]\d)\b/i,
    /quadro\s*(nvs|k\d{3,4}\b|p[46]\d\d\b)/i,
    /intel.*(hd graphics|uhd graphics|iris(?!(\(r\))?\s*xe)|gma)/i,
    /radeon\s*(\(tm\)\s*)?(r[2-7]\b|r[2-7]\s|hd\s*[2-8]\d{3}|vega\s*[3-8]\b|graphics\b|530|540|550\b)/i,
    /mali|adreno|powervr|videocore/i,
  ],
  high: [
    /rtx\s*(20[6-8]0|30[6-9]0|40[6-9]0|50[6-9]0|a[4-6]000|[4-6]000)/i,
    /radeon\s*(rx\s*)?(6[7-9]\d0|7[7-9]\d0|9\d{3})/i,
    /titan|radeon\s*pro\s*w\d/i,
  ],
};

/** "software" | "entry" | "mid" | "high" | "unknown" from a WebGL renderer string. */
export function classifyGpu(renderer) {
  const s = String(renderer || "");
  if (!s.trim()) return "unknown";
  if (PATTERNS.software.test(s)) return "software";
  if (PATTERNS.high.some(r => r.test(s))) return "high";
  if (PATTERNS.entry.some(r => r.test(s))) return "entry";
  if (/geforce|quadro|rtx|radeon|\barc\b|iris(\(r\))?\s*xe|apple|nvidia|amd/i.test(s)) return "mid";
  return "unknown";
}

/** Probe thresholds (ms for the fixed probe workload). PROVISIONAL — one GPU measured. */
export const PROBE_THRESHOLDS = Object.freeze({ eco: 40, low: 15 });

/**
 * Starting tier. Known-weak (and software) GPUs → eco. Otherwise the probe decides for
 * unknown GPUs; recognised mid/high GPUs keep the existing default (medium).
 */
export function pickStartTier({ gpuClass = "unknown", probeMs = null } = {}) {
  if (gpuClass === "software" || gpuClass === "entry") return "eco";
  if (Number.isFinite(probeMs)) {
    if (probeMs >= PROBE_THRESHOLDS.eco) return "eco";
    if (probeMs >= PROBE_THRESHOLDS.low) return "low";
  }
  return "medium";
}

/** Upper tier adaptive quality may climb back to when the user chose "auto". */
export function tierCeiling(gpuClass) {
  return gpuClass === "software" || gpuClass === "entry" ? "low" : "medium";
}

const TIER_RANK = Object.freeze({ eco: 0, low: 1, medium: 2, high: 3 });

/**
 * Highest tier the adaptive controller may reach.
 *
 * An explicit project tier is a hard override only when adaptive quality is off. With
 * adaptive quality on, an old project saved as high must not let a known entry GPU climb
 * all the way back to high while the preview is hidden or the scene is still empty. That
 * was visible on the GT 730: the profile correctly selected eco, but the Lebu project's
 * saved `high` value became the controller ceiling and the loaded scene stalled at high.
 *
 * Entry/software GPUs, and unknown GPUs whose timed probe selected eco/low, are capped at
 * low. They still start at the detected tier and may climb once when real frame-time
 * evidence allows it. Turning adaptive quality off continues to honour the selected tier
 * exactly.
 */
export function resolveTierLimit({ quality = "auto", adaptive = true, profile = null } = {}) {
  const selected = quality && quality !== "auto" ? quality : tierCeiling(profile?.gpuClass);
  if (!adaptive) return selected;

  const constrained = profile?.gpuClass === "entry"
    || profile?.gpuClass === "software"
    || profile?.tier === "eco"
    || profile?.tier === "low";
  if (!constrained) return selected;

  const safeCeiling = "low";
  const selectedRank = TIER_RANK[selected] ?? TIER_RANK.medium;
  return selectedRank < TIER_RANK[safeCeiling] ? selected : safeCeiling;
}

/** WebGL vendor/renderer of a context (unmasked when the browser allows it). */
export function readGpuInfo(gl) {
  if (!gl) return { vendor: "", renderer: "" };
  const ext = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    vendor: String(ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)),
    renderer: String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)),
  };
}

const PROBE_VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
// Roughly what a lit, blended particle/water pixel costs: ALU + blending, full screen.
const PROBE_FS = `#version 300 es
precision highp float; uniform float uSeed; out vec4 o;
void main(){
  vec2 q = gl_FragCoord.xy * 0.01 + uSeed; float a = 0.0;
  for (int i = 0; i < 24; i++) { a += sin(q.x + float(i)) * cos(q.y * 1.3 - float(i)); q = q.yx * 1.01 + a * 0.01; }
  o = vec4(abs(a) * 0.02, 0.01, 0.02, 0.08);
}`;

/**
 * Timed warm-up probe: 8 blended full-screen passes at 960x540, synchronised with a
 * 1-pixel readPixels; median of 3 after one warm-up. Returns ms, or null if WebGL2 is
 * unavailable. ~50–500 ms total.
 */
export function probeGpu({ width = 960, height = 540, passes = 8, doc = typeof document !== "undefined" ? document : null } = {}) {
  if (!doc) return null;
  let gl = null;
  try {
    const c = doc.createElement("canvas");
    c.width = width; c.height = height;
    gl = c.getContext("webgl2", { antialias: false, powerPreference: "high-performance" });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, PROBE_VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, PROBE_FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.viewport(0, 0, width, height);
    const uSeed = gl.getUniformLocation(prog, "uSeed");
    const px = new Uint8Array(4);
    const run = () => {
      const t0 = performance.now();
      for (let i = 0; i < passes; i++) { gl.uniform1f(uSeed, i * 0.37); gl.drawArrays(gl.TRIANGLES, 0, 3); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return performance.now() - t0;
    };
    run();   // warm-up: shader compile + first-use costs
    const t = [run(), run(), run()].sort((a, b) => a - b);
    return Number(t[1].toFixed(2));
  } catch {
    return null;
  } finally {
    try { gl?.getExtension("WEBGL_lose_context")?.loseContext(); } catch { /* ignore */ }
  }
}

function storage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

/**
 * The machine's GPU profile: { renderer, vendor, gpuClass, probeMs, tier, detectedAt }.
 * Cached; re-detected when the GPU string changes or `force` is set.
 */
export function detectGpuProfile({ force = false, doc = typeof document !== "undefined" ? document : null } = {}) {
  let info = { vendor: "", renderer: "" };
  try {
    const c = doc?.createElement("canvas");
    const gl = c?.getContext("webgl2") || c?.getContext("webgl");
    info = readGpuInfo(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch { /* no WebGL: unknown GPU */ }
  const store = storage();
  if (!force && store) {
    try {
      const cached = JSON.parse(store.getItem(STORAGE_KEY) || "null");
      if (cached && cached.renderer === info.renderer && cached.tier) return { ...cached, cached: true };
    } catch { /* corrupt cache: re-detect */ }
  }
  const gpuClass = classifyGpu(info.renderer);
  // Recognised GPUs do not need the probe; unknown ones get it.
  const probeMs = gpuClass === "unknown" ? probeGpu({ doc }) : null;
  const profile = { ...info, gpuClass, probeMs, tier: pickStartTier({ gpuClass, probeMs }), detectedAt: new Date().toISOString() };
  try { store?.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch { /* storage full/blocked */ }
  return { ...profile, cached: false };
}

/**
 * Effective starting tier for the preview.
 *   quality "auto"  → the detected tier.
 *   explicit tier   → that tier; but with adaptive quality ON, a known-weak GPU is
 *                     capped at its detected tier (eco) — adaptive steps back up if the
 *                     GPU has headroom. Adaptive OFF is the user's hard override.
 */
export function resolveStartTier({ quality = "auto", adaptive = true, profile = null } = {}) {
  const detected = profile?.tier || "medium";
  if (!quality || quality === "auto") return detected;
  const weak = profile?.gpuClass === "entry" || profile?.gpuClass === "software";
  if (adaptive && weak) return detected;
  return quality;
}
