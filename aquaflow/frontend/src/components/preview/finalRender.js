/**
 * finalRender.js — "Final render" quality for the baked video export (AF-3D-VID-002).
 *
 * The live preview on an entry GPU (GT 730) runs on eco so it stays interactive. A baked
 * render does not need real time, so it can switch the scene to `high` or the export-only
 * `ultra` profile (sceneQuality.js), render every frame offline, and then put the
 * preview back exactly as it was — also when the render is cancelled or fails.
 *
 * Everything here is plain logic with injected scene/DOM operations so it is unit tested
 * (finalRender.test.js). FountainScene_v6.js has a line-count guard; the only scene hook
 * this needs is bakeVideo's `pixelRatio` option.
 */
import { QUALITY_CONFIG } from "./sceneQuality";

// ─── Quality choice ─────────────────────────────────────────────────────────

/** Export quality options shown in the "Video export" fold (short label + tooltip). */
export const EXPORT_QUALITY_OPTIONS = Object.freeze([
  { id: "preview", label: "Preview", tip: "Same quality as the live 3D view. Fastest." },
  { id: "high", label: "Final", tip: "High quality: shadows, ambient occlusion, reflections, full particle count.\nRenders slower than real time; the live view is restored afterwards." },
  { id: "ultra", label: "Ultra", tip: "Final + 2x finer particles, full-res spray, sharper shadows/reflections\nand up to 2x supersampling. Slowest." },
]);
export const EXPORT_FORMAT_OPTIONS = Object.freeze([
  { id: "video", label: "Video", tip: "MP4 (H.264) or WebM file." },
  { id: "png", label: "PNG seq", tip: "Numbered PNG frames for editing software\n(Premiere, Resolve, After Effects, ffmpeg) + audio WAV." },
]);

/** Rank used for fallbacks; `ultra` is above every live tier. */
export const TIER_RANK = Object.freeze({ eco: 0, low: 1, medium: 2, high: 3, ultra: 4 });
const LABEL = { eco: "Eco", low: "Low", medium: "Medium", high: "Final (high)", ultra: "Final (ultra)" };
export const tierLabel = (tier) => LABEL[tier] || "Preview";

/**
 * Tier the bake should switch the scene to, or null to render with the preview's scene
 * as it is ("Match preview", or the preview is already at/above the requested tier).
 */
export function bakeTierFor(exportQuality, previewTier) {
  if (exportQuality !== "high" && exportQuality !== "ultra") return null;
  if (exportQuality === "high" && (TIER_RANK[previewTier] ?? -1) >= TIER_RANK.high) return null;
  return exportQuality;
}

/**
 * Entry GPUs (GT 7xx/10xx, Intel HD, ... — gpuTier.js "entry"/"software"). Measured on the
 * GT 730 4 GB (docs/evidence/FINAL-RENDER.md): high completed at 1080p and 1440p, ultra at
 * 1080p (3840x2160 supersampled); ultra at 1440p, and high AND medium at 4K, exhausted video
 * memory and reset the GPU process. The fallback chain survives that, but each reset costs
 * ~10 s and flickers the screen, so such cards start at the best tier known to fit:
 * returns the tier to try first (null = the preview tier).
 */
export const ENTRY_FINAL_MAX_PIXELS = 2560 * 1440;
export const ENTRY_ULTRA_MAX_PIXELS = 1920 * 1080;
export function entryTierCap({ tier, gpuClass, width, height }) {
  if (!tier || (gpuClass !== "entry" && gpuClass !== "software")) return tier;
  const px = width * height;
  if (px > ENTRY_FINAL_MAX_PIXELS) return null;
  if (tier === "ultra" && px > ENTRY_ULTRA_MAX_PIXELS) return "high";
  return tier;
}

/**
 * Tiers to try, best first. A failed allocation falls to the next one; `null` at the end
 * means "the preview's own tier" (which is known to work on this GPU). `low` is never a
 * fallback: it has no post chain, so it would look worse than eco.
 */
export function fallbackChain(target, previewTier) {
  if (!target) return [null];
  const floor = TIER_RANK[previewTier] ?? -1;
  const chain = ["ultra", "high", "medium"].filter(t => TIER_RANK[t] <= TIER_RANK[target] && TIER_RANK[t] > floor);
  return [...chain, null];
}

/**
 * Supersampling factor for the drawing buffer. Only `ultra` supersamples; the factor is
 * the largest of 2 / 1.5 / 1 that fits the GPU's texture/renderbuffer limits and a pixel
 * budget (default: one 4K UHD frame — a 1080p ultra render draws at 3840x2160 and is
 * downscaled; a 4K ultra render is not supersampled).
 */
export const MAX_SUPERSAMPLE_PIXELS = 3840 * 2160;
export function supersampleFor({ tier, width, height, maxSize = 16384, maxPixels = MAX_SUPERSAMPLE_PIXELS }) {
  const want = QUALITY_CONFIG[tier]?.supersample || 1;
  for (const pr of [2, 1.5, 1]) {
    if (pr > want) continue;
    if (width * pr <= maxSize && height * pr <= maxSize && width * height * pr * pr <= maxPixels) return pr;
  }
  return 1;
}

/** Live preview adaptive quality must never act during a bake or while a bake holds a tier. */
export const adaptiveAllowed = ({ bakeTier = null, baking = false } = {}) => !bakeTier && !baking;

// ─── GPU limits ─────────────────────────────────────────────────────────────

export class GpuLimitError extends Error {
  constructor(message) { super(message); this.name = "GpuLimitError"; }
}
const GPU_PATTERN = /out of memory|out_of_memory|context (was )?lost|context_lost|allocat|framebuffer.*(incomplete|unsupported)|webgl.*(fail|unavailable)|too large|maximum texture/i;
export function isGpuLimitError(e) {
  if (!e || e.name === "AbortError") return false;
  return e.name === "GpuLimitError" || GPU_PATTERN.test(String(e.message || e));
}

/**
 * Throws GpuLimitError if the scene's WebGL context is lost or (with `sync`) reports
 * OUT_OF_MEMORY. The loss check is free and runs every frame, so a GPU reset never
 * produces black frames; getError() stalls the pipeline, so it only runs every 30th frame.
 */
export function checkGpu(scene, { sync = true } = {}) {
  const gl = scene?.renderer?.getContext?.();
  if (!gl) return;
  if (gl.isContextLost?.()) throw new GpuLimitError("The graphics card dropped the WebGL context (out of GPU memory).");
  if (!sync) return;
  const err = gl.getError?.();
  if (err && err === (gl.OUT_OF_MEMORY ?? 0x0505)) throw new GpuLimitError("The graphics card ran out of memory.");
}

/**
 * After a tier switch: the new scene must have a live context, and when the preview had
 * GPU particle fields (so this GPU supports them) the final tier must have them too — a
 * missing field means its allocation failed and the render would silently look worse.
 */
export function verifyTierScene(scene, { expectGpuFields = false } = {}) {
  if (!scene?.renderer) throw new GpuLimitError("The 3D scene could not be created at this quality.");
  checkGpu(scene);
  if (expectGpuFields && QUALITY_CONFIG[scene.quality]?.gpuParticles && !(scene._gpuWater && scene._gpuSpray)) {
    throw new GpuLimitError("GPU particle buffers could not be allocated.");
  }
}

/** GPU texture/renderbuffer limit for the supersample choice. */
export function gpuMaxSize(scene) {
  const gl = scene?.renderer?.getContext?.();
  if (!gl?.getParameter) return 8192;
  const a = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 8192;
  const b = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || a;
  return Math.min(a, b);
}

// ─── Tier extras for the ultra profile ──────────────────────────────────────

/**
 * Ultra extras that are not plain QUALITY_CONFIG switches (called from applyTierExtras):
 * finer droplets, 4096 px shadow maps and 32-sample AO.
 *
 * Droplet size: 2x the particles drawn at size x (high/ultra)^FINAL_SIZE_EXPONENT. 0.5 would
 * keep the jet's coverage exactly equal to high, but on the GT 730 Lebu render that read as
 * visibly thinner jets than high (fine sprites lose more to blending); 0.25 (x0.84 size) gives
 * finer detail with ~1.4x high's coverage. See docs/evidence/FINAL-RENDER.md.
 */
export const FINAL_SIZE_EXPONENT = 0.25;
export function applyFinalExtras(scene) {
  const q = QUALITY_CONFIG[scene?.quality];
  if (!q?.final) return false;
  const high = QUALITY_CONFIG.high;
  for (const [field, ref] of [[scene._gpuWater, high.gpuWater], [scene._gpuSpray, high.gpuSpray]]) {
    const u = field?.uniforms;
    if (!u?.uSizeScale || field._finalApplied || !(field.count > 0)) continue;
    const k = Math.min(1, Math.pow(ref / field.count, FINAL_SIZE_EXPONENT));
    u.uSizeScale.value *= k;
    field._finalApplied = k;
  }
  if (q.shadowMapSize) {
    scene._envGroup?.traverse?.((o) => {
      if (!o.isDirectionalLight || !o.castShadow || !o.shadow) return;
      o.shadow.map?.dispose?.();
      o.shadow.map = null;   // reallocated at the new size on the next render
      if (typeof scene._fitShadowCamera === "function") scene._fitShadowCamera(o, q.shadowMapSize);
      else o.shadow.mapSize?.set?.(q.shadowMapSize, q.shadowMapSize);
    });
  }
  if (q.aoSamples && typeof scene._aoPass?.updateGtaoMaterial === "function") {
    try { scene._aoPass.updateGtaoMaterial({ samples: q.aoSamples }); } catch { /* AO is optional */ }
  }
  return true;
}

// ─── View preservation across a tier rebuild ────────────────────────────────

/** Everything that decides what the camera sees, so the rebuilt scene renders the same shot. */
export function snapshotView(scene) {
  if (!scene) return null;
  const c = scene.camera;
  return {
    cameraMode: scene.cameraMode,
    orbitAngle: scene.orbitAngle, orbitHeight: scene.orbitHeight, orbitRadius: scene.orbitRadius,
    orbitAuto: scene.orbitAuto, pathTime: scene._pathTime,
    namedView: scene._namedView ? JSON.parse(JSON.stringify(scene._namedView)) : null,
    editorMode: !!scene._editorMode,
    position: c ? [c.position.x, c.position.y, c.position.z] : null,
    quaternion: c ? [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w] : null,
    fov: c?.fov,
    editorFocus: scene._editor?.focus ? [scene._editor.focus.x, scene._editor.focus.y, scene._editor.focus.z] : null,
  };
}

export function restoreView(scene, v) {
  if (!scene || !v) return;
  if (v.editorMode) scene.setEditorMode?.(true);
  if (v.namedView) scene.setNamedView?.(v.namedView);
  scene.cameraMode = v.cameraMode;
  Object.assign(scene, { orbitAngle: v.orbitAngle, orbitHeight: v.orbitHeight, orbitRadius: v.orbitRadius, orbitAuto: v.orbitAuto });
  if (Number.isFinite(v.pathTime)) scene._pathTime = v.pathTime;
  const c = scene.camera;
  if (c && v.position) {
    c.position.set(...v.position);
    if (v.quaternion) c.quaternion.set(...v.quaternion);
    if (Number.isFinite(v.fov) && c.fov !== v.fov) { c.fov = v.fov; c.updateProjectionMatrix?.(); }
  }
  if (v.editorFocus && scene._editor?.focus) scene._editor.focus.set(...v.editorFocus);
}

// ─── Orchestration ──────────────────────────────────────────────────────────

export const abortError = () => (typeof DOMException === "function"
  ? new DOMException("Render cancelled", "AbortError")
  : Object.assign(new Error("Render cancelled"), { name: "AbortError" }));

/**
 * Run a bake at the best tier this GPU can allocate, then restore the preview.
 *
 * @param {object} o
 * @param {string|null} o.targetTier     bakeTierFor(...) result (null = no switch)
 * @param {string} o.previewTier         tier the live preview runs on now
 * @param {(tier:string|null)=>Promise<object>} o.switchTier  rebuild at tier; null = the preview tier
 * @param {(scene, tier)=>Promise<any>} o.attempt  one full render on that scene
 * @param {(scene)=>void} [o.verify]     throws GpuLimitError when the tier is unusable
 * @param {(msg:string)=>void} [o.onNotice]
 * @param {{aborted:boolean}} [o.abort]
 * @returns {Promise<{tier, result, fallbacks:string[]}>}
 */
export async function runFinalRender({ targetTier, previewTier, switchTier, attempt, verify, onNotice, abort, currentScene }) {
  const chain = fallbackChain(targetTier, previewTier);
  const fallbacks = [];
  let switched = false;
  let lastErr = null;
  try {
    for (let i = 0; i < chain.length; i++) {
      const tier = chain[i];
      if (abort?.aborted) throw abortError();
      const next = chain[i + 1];
      const fail = (e) => {
        lastErr = e;
        const msg = `${tierLabel(tier)} needs more GPU memory than this card has — using ${next === undefined ? "nothing" : tierLabel(next || previewTier)}.`;
        fallbacks.push(`${msg} (${String(e?.message || e).slice(0, 160)})`);   // detail for the tooltip
        onNotice?.(msg);
      };
      let scene;
      try {
        if (tier || switched) { switched = true; scene = await switchTier(tier); }
        else scene = currentScene;
        if (tier) verify?.(scene);
      } catch (e) {
        if (e?.name === "AbortError" || abort?.aborted) throw abortError();
        if (!tier) throw e;   // the preview tier itself failed: nothing left to fall to
        fail(e);
        continue;
      }
      try {
        return { tier: tier || previewTier, result: await attempt(scene, tier || previewTier), fallbacks };
      } catch (e) {
        if (!tier || !isGpuLimitError(e) || abort?.aborted) throw e;
        fail(e);
      }
    }
    throw lastErr || new Error("No render quality could be allocated on this GPU.");
  } finally {
    if (switched) {
      // Always put the preview back: on success, cancel, error and failed fallbacks.
      try { await switchTier(null); }
      catch (e) { onNotice?.(`Preview restore failed: ${e?.message || e}`); }
    }
  }
}

// ─── Progress / time estimate ───────────────────────────────────────────────

/** frames done/total + elapsed → percent, seconds per frame and remaining seconds. */
export function renderStats({ frame = 0, frames = 0, frameMs = 0 } = {}) {
  const pct = frames > 0 ? Math.min(100, (100 * frame) / frames) : 0;
  if (!(frame > 0) || !(frameMs > 0)) return { pct, secPerFrame: null, etaS: null };
  const secPerFrame = frameMs / frame / 1000;
  return { pct, secPerFrame, etaS: Math.max(0, (frames - frame) * secPerFrame) };
}

/** 75 → "1:15", 3725 → "1:02:05", null → "–". */
export function formatClock(s) {
  if (s == null || !Number.isFinite(s)) return "–";
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// ─── Frame capture and sinks ────────────────────────────────────────────────

const yieldUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * 2D canvas of the export size that the WebGL canvas is copied (and, when supersampled,
 * downscaled, high-quality smoothing) into after each frame.
 */
export function createFrameCapture(src, width, height, doc = globalThis.document) {
  const out = doc.createElement("canvas");
  out.width = width; out.height = height;
  const ctx = out.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return {
    canvas: out,
    capture() { ctx.drawImage(src, 0, 0, src.width, src.height, 0, 0, width, height); },
  };
}

/**
 * Encoder adapter handed to scene.bakeVideo. Per frame: context-loss check (plus a
 * getError() OOM check on frame 1 and every 30th), optional copy/downscale, encode, then
 * give the UI a turn so the app stays
 * responsive during multi-second frames.
 */
export function createVideoSink({ encoder, capture = null, scene = null }) {
  let n = 0;
  return {
    async addFrame(ts, dur) {
      if (scene) checkGpu(scene, { sync: n === 0 || n % 30 === 29 });
      n++;
      capture?.capture();
      await encoder.addFrame(ts, dur);
      await yieldUI();
    },
  };
}

/**
 * encoder.finish() with a watchdog. On the GT 730 a 4K high render made the GPU process
 * exit (D3D11 out of memory) right as encoding finished; the hardware encoder lives in
 * that process, so finish() never settled and the UI sat on "Writing file…". This rejects
 * on cancel (AbortError), on a lost context (GpuLimitError → next tier) or after
 * `timeoutMs` without an answer.
 */
export async function finishWithWatch(encoder, { abort = null, isLost = () => false, timeoutMs = 120000, pollMs = 250 } = {}) {
  let poll = null;
  const started = Date.now();
  const watch = new Promise((_, reject) => {
    poll = setInterval(() => {
      if (abort?.aborted) reject(abortError());
      else if (isLost()) reject(new GpuLimitError("The graphics card ran out of memory while writing the video (GPU reset)."));
      else if (Date.now() - started > timeoutMs) reject(new Error("The video encoder stopped responding."));
    }, pollMs);
  });
  try { return await Promise.race([encoder.finish(), watch]); }
  finally { clearInterval(poll); }
}

/** Resolve within `ms` whatever `p` does (cleanup calls that may hang after a GPU reset). */
export const settleWithin = (p, ms = 3000) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise(r => setTimeout(r, ms))]);

/** Records `webglcontextlost` on a canvas (a GPU process reset) for the length of a render. */
export function watchContextLoss(canvas) {
  const state = { lost: false };
  const onLost = () => { state.lost = true; };
  canvas?.addEventListener?.("webglcontextlost", onLost);
  return {
    get lost() { return state.lost; },
    reset() { state.lost = false; },
    dispose() { canvas?.removeEventListener?.("webglcontextlost", onLost); },
  };
}

/**
 * Before rebuilding after a GPU reset: wait until the browser has restored the canvas's
 * WebGL context (three.js asks for restoration), else fail with a clear message.
 */
export async function waitForContext(gl, { timeoutMs = 15000, pollMs = 200 } = {}) {
  if (!gl?.isContextLost?.()) return true;
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    await new Promise(r => setTimeout(r, pollMs));
    if (!gl.isContextLost()) return true;
  }
  throw new GpuLimitError("The graphics driver did not recover from the GPU reset. Save the project and restart AquaFlow.");
}

/** Number of digits for frame numbers: at least 5 (00000…99999 covers 55 min at 30 fps). */
export function frameDigits(total) { return Math.max(5, String(Math.max(0, total - 1)).length); }
/** "lebu_wave", 7, 150 → "lebu_wave_00007.png" (0-based = frame index, ffmpeg -start_number 0). */
export function frameFileName(prefix, index, total) {
  return `${prefix}_${String(index).padStart(frameDigits(total), "0")}.png`;
}
/** File-system-safe prefix from a project name. */
export function sequencePrefix(name) {
  const s = String(name || "").normalize("NFKD").replace(/[^\w-]+/g, "_").replace(/_*-[-_]*/g, "-").replace(/_+/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "").slice(0, 40);
  return s || "aquaflow";
}

/** Plain-text note written next to the frames: how to reassemble them with the audio. */
export function sequenceNote({ prefix, plan, tier, audioName = null, total }) {
  const d = frameDigits(total);
  return [
    `AquaFlow image sequence`,
    `Frames:     ${prefix}_${"0".repeat(d)}.png … ${frameFileName(prefix, total - 1, total)} (${total} frames)`,
    `Size/rate:  ${plan.width}x${plan.height} @ ${plan.fps} fps`,
    `Show time:  ${plan.startS.toFixed(2)} s → ${(plan.startS + plan.durationS).toFixed(2)} s`,
    `Quality:    ${tierLabel(tier)}`,
    audioName ? `Audio:      ${audioName} (starts with frame 0)` : `Audio:      none`,
    ``,
    `ffmpeg:     ffmpeg -framerate ${plan.fps} -start_number 0 -i ${prefix}_%0${d}d.png${audioName ? ` -i ${audioName}` : ""} -c:v libx264 -pix_fmt yuv420p${audioName ? " -c:a aac -shortest" : ""} ${prefix}.mp4`,
    ``,
  ].join("\r\n");
}

/** 16-bit PCM WAV from planar Float32 channels. */
export function encodeWav(channels, sampleRate) {
  const ch = Math.max(1, channels.length);
  const len = channels[0]?.length || 0;
  const data = len * ch * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + data, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, data, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, channels[c]?.[i] || 0));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true); o += 2;
    }
  }
  return new Uint8Array(buf);
}

const canvasPng = (canvas) => new Promise((resolve, reject) => {
  canvas.toBlob((b) => (b ? b.arrayBuffer().then(a => resolve(new Uint8Array(a)), reject) : reject(new Error("PNG encode failed"))), "image/png");
});

/** Encoder adapter that writes one numbered PNG per frame through `writer.write(name, bytes)`. */
export function createSequenceSink({ writer, capture, prefix, total, scene = null, encodePng = canvasPng }) {
  let n = 0;
  return {
    async addFrame() {
      if (scene) checkGpu(scene, { sync: n === 0 || n % 30 === 29 });
      capture.capture();
      const bytes = await encodePng(capture.canvas);
      await writer.write(frameFileName(prefix, n, total), bytes);
      n++;
      await yieldUI();
    },
    get written() { return n; },
  };
}

// ─── Sequence writers: desktop folder, or a browser ZIP ─────────────────────

/** Browser fallback: STORE zip (PNG is already compressed). Guards the tab's memory. */
export const MAX_BROWSER_ZIP_BYTES = 1.5e9;
export function createZipWriter({ createZip, name, maxBytes = MAX_BROWSER_ZIP_BYTES }) {
  const entries = [];
  let bytes = 0;
  return {
    where: `${name}.zip`,
    async write(file, data) {
      bytes += data.byteLength;
      if (bytes > maxBytes) throw new Error("Too many frames for a browser ZIP — render a shorter range, or use the desktop app.");
      entries.push({ name: file, data });
    },
    async finish() { return new Blob([createZip(entries)], { type: "application/zip" }); },
    get bytes() { return bytes; },
  };
}

/** Desktop: the user picks a folder once; the main process only writes into that folder. */
export async function openDesktopFolderWriter(bridge, { title } = {}) {
  const res = await bridge.chooseFolder({ title });
  if (!res || res.canceled || !res.ok) {
    if (res?.error) throw new Error(res.error);
    return null;
  }
  let bytes = 0;
  return {
    where: res.path,
    async write(file, data) {
      const r = await bridge.writeFile(res.token, file, data);
      if (!r?.ok) throw new Error(r?.error || `Could not write ${file}`);
      bytes += data.byteLength;
    },
    async finish() { return null; },
    get bytes() { return bytes; },
  };
}
