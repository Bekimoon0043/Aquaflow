// bakedTimeline.js - AquaFlow offline ("baked") video render planning (AF-3D-VID-001)
//
// Why this exists: the live recorder captured the canvas with MediaRecorder while
// the scene ran on wall-clock time. Any frame that took longer than the frame period
// to render was dropped or duplicated, and the particle simulation jumped by the
// real elapsed time - the "stuck"/stuttering video. A baked render inverts that:
// the renderer is driven by a VIRTUAL clock that advances exactly one frame period
// per encoded frame, so the output is perfectly smooth no matter how slowly each
// frame renders. Everything here is pure so the timing contract is unit-tested.

import { getResolution, normalizeFps } from "./videoExport";

/** Physics sub-step ceiling: the live preview is tuned at ~60 Hz. */
export const MAX_SUBSTEP_S = 1 / 60;
/** Default simulation warm-up so jets are already airborne on frame 0. */
export const DEFAULT_PREROLL_S = 3;
/** Hard cap so a typo cannot start a multi-hour render. */
export const MAX_BAKE_DURATION_S = 30 * 60;

/**
 * Plan an offline render.
 * @returns {{ width, height, fps, frames, frameDuration, startS, durationS,
 *             substeps, substepDt, prerollSteps, prerollDt }}
 */
export function planBake({
  resolution = "1080p", fps = 60, startS = 0, durationS = 10,
  prerollS = DEFAULT_PREROLL_S, maxSubstepS = MAX_SUBSTEP_S,
} = {}) {
  const r = getResolution(resolution);
  const f = normalizeFps(fps);
  const dur = Math.min(MAX_BAKE_DURATION_S, Math.max(0, Number(durationS) || 0));
  const start = Math.max(0, Number(startS) || 0);
  const frameDuration = 1 / f;
  const frames = Math.max(1, Math.round(dur * f));
  const substeps = Math.max(1, Math.ceil(frameDuration / maxSubstepS - 1e-9));
  const pre = Math.max(0, Number(prerollS) || 0);
  const prerollSteps = Math.ceil(pre / maxSubstepS - 1e-9);
  return {
    // Encoders require even dimensions (4:2:0 chroma subsampling).
    width: r.w - (r.w % 2), height: r.h - (r.h % 2), label: r.label,
    fps: f, frames, frameDuration, startS: start, durationS: frames / f,
    substeps, substepDt: frameDuration / substeps,
    prerollSteps, prerollDt: prerollSteps ? pre / prerollSteps : 0,
  };
}

/** Exact show time of frame i (no accumulated floating-point drift). */
export function frameShowTime(plan, i) {
  return plan.startS + i / plan.fps;
}

/** Exact presentation timestamp of frame i inside the output file (seconds). */
export function frameTimestamp(plan, i) {
  return i / plan.fps;
}

/**
 * Show time used during warm-up step k. Warm-up replays the seconds just before
 * the start, clamped at 0, so a mid-show start inherits the water already in flight.
 */
export function prerollShowTime(plan, k) {
  const pre = plan.prerollSteps * plan.prerollDt;
  return Math.max(0, plan.startS - pre + k * plan.prerollDt);
}

/** Target bitrate for a high-quality master (~0.12 bits/pixel/frame, capped). */
export function bakeBitrate(width, height, fps, bpp = 0.24) {
  return Math.min(120_000_000, Math.max(4_000_000, Math.round(width * height * fps * bpp)));
}

/**
 * Pick the container + codecs. Prefers MP4/H.264 (plays everywhere), falls back
 * to WebM/VP9/VP8. `canVideo(codec)` / `canAudio(codec)` are async probes.
 */
export async function chooseCodecs({ canVideo, canAudio, withAudio = false }) {
  const options = [
    { container: "mp4",  ext: "mp4",  mime: "video/mp4",  video: ["avc", "hevc", "av1"], audio: ["aac", "opus"] },
    { container: "webm", ext: "webm", mime: "video/webm", video: ["vp9", "av1", "vp8"],  audio: ["opus"] },
  ];
  for (const o of options) {
    let video = null;
    for (const c of o.video) { if (await canVideo(c)) { video = c; break; } }
    if (!video) continue;
    let audio = null;
    if (withAudio) {
      for (const c of o.audio) { if (await canAudio(c)) { audio = c; break; } }
      // Keep looking for a container that can carry the soundtrack too.
      if (!audio && o !== options[options.length - 1]) continue;
    }
    return { container: o.container, ext: o.ext, mime: o.mime, video, audio };
  }
  return null;
}

/**
 * Build the soundtrack for [startS, startS + durationS) from a decoded source.
 * `loopS` (optional) repeats the source every loopS seconds - used by the site
 * preview, whose plan repeats one musical pass N times.
 * Works on plain channel arrays so it is testable without Web Audio.
 */
export function sliceAudioChannels(channels, sampleRate, { startS = 0, durationS = 0, loopS = 0 } = {}) {
  const outLen = Math.max(0, Math.round(durationS * sampleRate));
  const srcLen = channels[0]?.length || 0;
  const loopLen = loopS > 0 ? Math.min(srcLen, Math.round(loopS * sampleRate)) : 0;
  const startIdx = Math.round(startS * sampleRate);
  return channels.map((src) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      let j = startIdx + i;
      if (loopLen > 0) j %= loopLen;
      if (j < srcLen) out[i] = src[j];
    }
    return out;
  });
}

/** Human-readable remaining-time estimate from progress so far. */
export function etaSeconds(doneFrames, totalFrames, elapsedMs) {
  if (doneFrames <= 0) return null;
  return Math.max(0, ((totalFrames - doneFrames) * (elapsedMs / doneFrames)) / 1000);
}
