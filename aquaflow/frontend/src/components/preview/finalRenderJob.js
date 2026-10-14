/**
 * finalRenderJob.js — one "Render" click of the Video export fold (AF-3D-VID-002).
 * Glue between PreviewPanel and the pieces in finalRender.js: tier switch + restore,
 * supersampling, video encoder or PNG-sequence writer, progress and the end summary.
 */
import {
  runFinalRender, bakeTierFor, verifyTierScene, supersampleFor, gpuMaxSize, snapshotView, restoreView,
  createFrameCapture, createVideoSink, createSequenceSink, sequencePrefix, sequenceNote, encodeWav,
  openDesktopFolderWriter, createZipWriter, tierLabel, finishWithWatch, entryTierCap, settleWithin, watchContextLoss, waitForContext,
} from "./finalRender";

const download = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

/** A few rendered frames (or ~1.5 s when the window is hidden) for the rebuilt scene to settle. */
const settleFrames = (frames = 12, maxMs = 1500) => new Promise((resolve) => {
  let n = 0, done = false;
  const finish = () => { if (!done) { done = true; resolve(); } };
  const tick = () => { if (++n >= frames) finish(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(finish, maxMs);
});

/**
 * Pick where PNG frames go before anything is rendered. Desktop: OS folder dialog via the
 * preload bridge. Browser: an in-memory ZIP downloaded at the end. null = user cancelled.
 */
export async function openSequenceWriter(name, bridge = globalThis.window?.aquaflow?.render) {
  if (bridge?.chooseFolder && bridge?.writeFile) return openDesktopFolderWriter(bridge, { title: "Folder for the PNG frames" });
  const { createZip } = await import("../../utils/zipStore");
  return createZipWriter({ createZip, name });
}

/**
 * @returns {Promise<object>} summary for the UI, or { cancelled: true } when the folder dialog was cancelled
 */
export async function runBakeJob({
  scene, plan, sampler, audio, exportQuality, format, effectiveQuality, bakeTier, wind = [0, 0], gpuClass = "unknown",
  projectName, abort, onProgress, onNotice,
}) {
  const t0 = performance.now();
  const prefix = sequencePrefix(projectName);
  const stamp = `${plan.width}x${plan.height}-${plan.fps}fps`;
  let writer = null;
  if (format === "png") {
    writer = await openSequenceWriter(`${prefix}-${stamp}-frames`);
    if (!writer) return { cancelled: true };
  }
  const view = snapshotView(scene);
  const previewTier = scene.quality;
  const hadGpu = !!(scene._gpuWater && scene._gpuSpray);
  // The canvas and its WebGL context outlive every scene rebuild; a GPU reset is seen here.
  const canvas = scene.canvas;
  const gl = scene.renderer?.getContext?.();
  const loss = watchContextLoss(canvas);
  const isLost = () => loss.lost || !!gl?.isContextLost?.();

  const switchTier = async (tier) => {
    onProgress?.({ frame: 0, frames: plan.frames, phase: tier ? "switch" : "restore", tier: tier || previewTier, supersample: 1 });
    if (isLost()) {
      onProgress?.({ frame: 0, frames: plan.frames, phase: "recover", tier: tier || previewTier, supersample: 1 });
      await waitForContext(gl);
      loss.reset?.();
    }
    const s = await bakeTier.request(tier, effectiveQuality);
    restoreView(s, view);
    s.setWind?.(wind[0], wind[1]);
    if (tier) await settleFrames();
    return s;
  };

  const attempt = async (s, tier) => {
    const pr = supersampleFor({ tier, width: plan.width, height: plan.height, maxSize: gpuMaxSize(s) });
    const progress = (p) => onProgress?.({ ...p, tier, supersample: pr });
    progress({ frame: 0, frames: plan.frames, phase: "prepare" });
    if (format === "png") {
      const capture = createFrameCapture(s.canvas, plan.width, plan.height);
      const sink = createSequenceSink({ writer, capture, prefix, total: plan.frames, scene: s });
      await s.bakeVideo({ plan, sampleSignals: sampler.sample, encoder: sink, abort, pixelRatio: pr, onProgress: progress });
      progress({ frame: plan.frames, frames: plan.frames, phase: "finalize" });
      let audioName = null;
      if (audio?.file) {
        try {
          const { buildSoundtrack } = await import("../../video/bakedEncoder");
          const buf = await buildSoundtrack(audio, plan);
          if (buf) {
            const ch = [];
            for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
            audioName = `${prefix}_audio.wav`;
            await writer.write(audioName, encodeWav(ch, buf.sampleRate));
          }
        } catch (e) { onNotice?.(`Frames saved; audio WAV skipped (${e?.message || e}).`); audioName = null; }
      }
      await writer.write(`${prefix}_README.txt`, new TextEncoder().encode(sequenceNote({ prefix, plan, tier, audioName, total: plan.frames })));
      const zip = await writer.finish();
      let file = writer.where;
      if (zip) { file = `${prefix}-${stamp}-frames.zip`; download(zip, file); }
      return { file, bytes: zip ? zip.size : writer.bytes, codec: "PNG", hasAudio: !!audioName, supersample: pr };
    }
    const { openBakedEncoder } = await import("../../video/bakedEncoder");
    const capture = pr !== 1 ? createFrameCapture(s.canvas, plan.width, plan.height) : null;
    const encoder = await openBakedEncoder(capture ? capture.canvas : s.canvas, plan, { audio });
    try {
      const sink = createVideoSink({ encoder, capture, scene: s });
      await s.bakeVideo({ plan, sampleSignals: sampler.sample, encoder: sink, abort, pixelRatio: pr, onProgress: progress });
      progress({ frame: plan.frames, frames: plan.frames, phase: "finalize" });
      const { blob, ext, codec } = await finishWithWatch(encoder, {
        abort, isLost, timeoutMs: 60000 + plan.frames * 100,
      });
      const file = `aquaflow-${stamp}-${tier}-${Date.now()}.${ext}`;
      download(blob, file);
      return { file, bytes: blob.size, codec: codec.video.toUpperCase(), hasAudio: encoder.hasAudio, supersample: pr };
    } catch (e) {
      await settleWithin(encoder.cancel?.());   // may never settle after a GPU reset
      throw e;
    }
  };

  const wanted = bakeTierFor(exportQuality, previewTier);
  const targetTier = entryTierCap({ tier: wanted, gpuClass, width: plan.width, height: plan.height });
  const pre = [];
  if (targetTier !== wanted) {
    pre.push(`${tierLabel(wanted)} at ${plan.label || `${plan.width}×${plan.height}`} needs more GPU memory than this card has — using ${tierLabel(targetTier || previewTier)}.`);
    onNotice?.(pre[0]);
  }
  let out;
  try {
    out = await runFinalRender({
      targetTier,
      previewTier, currentScene: scene, switchTier, attempt, abort, onNotice,
      verify: (s) => verifyTierScene(s, { expectGpuFields: hadGpu }),
    });
  } finally {
    loss.dispose();
  }
  const tookS = (performance.now() - t0) / 1000;
  return {
    ...out.result, tier: out.tier, quality: tierLabel(out.tier), fallbacks: [...pre, ...out.fallbacks],
    width: plan.width, height: plan.height, fps: plan.fps, frames: plan.frames,
    durationS: plan.durationS, tookS, format,
  };
}
