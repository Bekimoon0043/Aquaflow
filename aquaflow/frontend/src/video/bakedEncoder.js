// bakedEncoder.js - frame-exact WebCodecs encoder for the baked render (AF-3D-VID-001)
//
// Wraps mediabunny (pure-TS muxer over the browser's hardware WebCodecs encoder).
// Each frame is encoded with an explicit timestamp, so playback speed is exact and
// independent of how long the renderer spent on a frame. Loaded lazily: nothing
// here costs anything until the operator actually renders a video.

import { chooseCodecs, bakeBitrate, sliceAudioChannels } from "./bakedTimeline";

export function webCodecsAvailable() {
  return typeof window !== "undefined" && typeof window.VideoEncoder === "function";
}

/** Decode an audio File/Blob and cut it to the render window. Returns AudioBuffer|null. */
export async function buildSoundtrack(audio, plan) {
  if (!audio?.file || typeof OfflineAudioContext === "undefined") return null;
  const sampleRate = 48000;
  const bytes = await audio.file.arrayBuffer();
  const decoded = await new OfflineAudioContext(2, 1, sampleRate).decodeAudioData(bytes);
  const src = [];
  for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) src.push(decoded.getChannelData(c));
  const sliced = sliceAudioChannels(src, decoded.sampleRate, {
    startS: plan.startS, durationS: plan.durationS, loopS: audio.loopS || 0,
  });
  const out = new AudioBuffer({ numberOfChannels: sliced.length, length: Math.max(1, sliced[0].length), sampleRate: decoded.sampleRate });
  sliced.forEach((data, c) => out.copyToChannel(data, c));
  return out;
}

/**
 * Open an encoder session bound to `canvas`.
 * @returns {Promise<{ addFrame(ts, dur), finish(): Promise<{blob, ext, codec}>, cancel() }>}
 */
export async function openBakedEncoder(canvas, plan, { audio = null } = {}) {
  if (!webCodecsAvailable()) throw new Error("This runtime has no WebCodecs VideoEncoder - baked export is unavailable.");
  const mb = await import("mediabunny");
  const size = { width: plan.width, height: plan.height };
  const soundtrack = audio?.file ? await buildSoundtrack(audio, plan).catch(() => null) : null;
  const picked = await chooseCodecs({
    withAudio: !!soundtrack,
    canVideo: (codec) => mb.canEncodeVideo(codec, { ...size, bitrate: bakeBitrate(plan.width, plan.height, plan.fps) }).catch(() => false),
    canAudio: (codec) => mb.canEncodeAudio(codec, { numberOfChannels: soundtrack?.numberOfChannels || 2, sampleRate: soundtrack?.sampleRate || 48000, bitrate: 192000 }).catch(() => false),
  });
  if (!picked) throw new Error(`No video encoder available for ${plan.width}x${plan.height}. Try a lower resolution.`);

  const format = picked.container === "mp4"
    ? new mb.Mp4OutputFormat({ fastStart: "in-memory" })
    : new mb.WebMOutputFormat();
  const target = new mb.BufferTarget();
  const output = new mb.Output({ format, target });

  const video = new mb.CanvasSource(canvas, {
    codec: picked.video,
    bitrate: bakeBitrate(plan.width, plan.height, plan.fps),
    keyFrameInterval: 2,
    latencyMode: "quality",
    bitrateMode: "variable",
  });
  output.addVideoTrack(video, { frameRate: plan.fps });

  let audioSource = null;
  if (soundtrack && picked.audio) {
    audioSource = new mb.AudioBufferSource({ codec: picked.audio, bitrate: 192000 });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  if (audioSource) { await audioSource.add(soundtrack); audioSource.close(); }

  let cancelled = false;
  return {
    codec: picked,
    hasAudio: !!audioSource,
    addFrame: (timestamp, duration) => video.add(timestamp, duration),
    async finish() {
      video.close();
      await output.finalize();
      return { blob: new Blob([target.buffer], { type: picked.mime }), ext: picked.ext, codec: picked };
    },
    async cancel() {
      if (cancelled) return; cancelled = true;
      try { await output.cancel(); } catch (e) { /* already torn down */ }
    },
  };
}
