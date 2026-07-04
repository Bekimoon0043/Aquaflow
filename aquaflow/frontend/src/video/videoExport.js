// videoExport.js — AquaFlow Stage 3, Priority 7 (AQ-S3-007)
//
// 4K video export engine for the fountain show preview. Pure, framework-agnostic
// configuration + A/V sync helpers (MediaRecorder / MediaStream are injectable)
// so the export pipeline is deterministic and unit-tested; the FountainScene
// drives the actual canvas capture from this config.

export const RESOLUTIONS = Object.freeze({
  "720p":  { w: 1280, h: 720,  label: "HD 720p" },
  "1080p": { w: 1920, h: 1080, label: "Full HD 1080p" },
  "1440p": { w: 2560, h: 1440, label: "QHD 1440p" },
  "4k":    { w: 3840, h: 2160, label: "4K UHD" },
});

export const FRAMERATES = Object.freeze([24, 30, 60]);

const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

/** Resolve a resolution key (or {w,h}) to a { w, h, label } object. */
export function getResolution(res) {
  if (res && typeof res === "object" && res.w && res.h) {
    return { w: res.w, h: res.h, label: res.label || `${res.w}x${res.h}` };
  }
  return RESOLUTIONS[String(res || "1080p").toLowerCase()] || RESOLUTIONS["1080p"];
}

/** True if the resolution is 4K (≥ 3840×2160). */
export function is4K(res) {
  const r = getResolution(res);
  return r.w >= 3840 && r.h >= 2160;
}

/** Nearest valid framerate (defaults to 60). */
export function normalizeFps(fps) {
  const f = Number(fps) || 60;
  return FRAMERATES.reduce((best, cur) => (Math.abs(cur - f) < Math.abs(best - f) ? cur : best), 60);
}

/** Target video bitrate (bits/s) from resolution + fps (≈0.07 bits/pixel/frame). */
export function estimateBitrate(width, height, fps, bpp = 0.07) {
  return Math.round(width * height * fps * bpp);
}

/** Number of frames for a duration at a framerate. */
export function frameCount(durationS, fps) {
  return Math.max(0, Math.round(Math.max(0, durationS) * normalizeFps(fps)));
}

/** Frame period in milliseconds. */
export function frameDurationMs(fps) {
  return 1000 / normalizeFps(fps);
}

/** Pick the first supported MediaRecorder MIME type. */
export function supportedMimeType(candidates = MIME_CANDIDATES, recorder = (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined)) {
  if (recorder && typeof recorder.isTypeSupported === "function") {
    for (const m of candidates) {
      try { if (recorder.isTypeSupported(m)) return m; } catch (e) { /* ignore */ }
    }
  }
  return "video/webm";
}

/**
 * Compute audio/video synchronization. Returns the A/V offset (audio relative to
 * video, ms), whether it is within tolerance, and the correction to apply.
 */
export function audioVideoSync({ videoStartMs = 0, audioStartMs = 0, audioLatencyMs = 0, toleranceMs = 40 } = {}) {
  const offsetMs = (audioStartMs - videoStartMs) + audioLatencyMs;
  return {
    offsetMs,
    synced: Math.abs(offsetMs) <= toleranceMs,
    correctionMs: -offsetMs,   // shift audio by this to align
    toleranceMs,
  };
}

/** Collect the tracks of a stream (video or audio) into an output MediaStream. */
function _newStream() {
  if (typeof MediaStream !== "undefined") return new MediaStream();
  // Node/test shim.
  const tracks = [];
  return { addTrack: (t) => tracks.push(t), getTracks: () => tracks.slice() };
}

/**
 * Combine a canvas video stream and an audio stream into a single MediaStream so
 * the recorder muxes synchronized audio + video.
 */
export function combineStreams(videoStream, audioStream) {
  const out = _newStream();
  const vids = videoStream
    ? (videoStream.getVideoTracks ? videoStream.getVideoTracks() : (videoStream.getTracks ? videoStream.getTracks() : []))
    : [];
  vids.forEach((t) => out.addTrack(t));
  const auds = audioStream
    ? (audioStream.getAudioTracks ? audioStream.getAudioTracks() : (audioStream.getTracks ? audioStream.getTracks() : []))
    : [];
  auds.forEach((t) => out.addTrack(t));
  return out;
}

/**
 * Build a complete, renderer-agnostic export configuration.
 *
 * @param {object} opts { resolution, fps, durationS, withAudio, bpp }
 */
export function buildExportConfig({ resolution = "4k", fps = 60, durationS = 0, withAudio = false, bpp = 0.07 } = {}) {
  const r = getResolution(resolution);
  const f = normalizeFps(fps);
  const bitrate = estimateBitrate(r.w, r.h, f, bpp);
  const mimeType = supportedMimeType();
  return {
    width: r.w,
    height: r.h,
    label: r.label,
    is4K: r.w >= 3840 && r.h >= 2160,
    fps: f,
    videoBitrate: bitrate,
    audioBitrate: withAudio ? 192000 : 0,
    mimeType,
    fileExtension: mimeType.indexOf("mp4") >= 0 ? "mp4" : "webm",
    hasAudio: !!withAudio,
    frameCount: frameCount(durationS, f),
    frameDurationMs: frameDurationMs(f),
    durationS,
  };
}
