// bakedEncoder.js - frame-exact WebCodecs encoder for the baked render (AF-3D-VID-001)
//
// Wraps mediabunny (pure-TS muxer over the browser's hardware WebCodecs encoder).
// Each frame is encoded with an explicit timestamp, so playback speed is exact and
// independent of how long the renderer spent on a frame. Loaded lazily: nothing
// here costs anything until the operator actually renders a video.

import { chooseCodecs, bakeBitrate, sliceAudioChannels } from "./bakedTimeline";
import { AUDIO_CODECS, addSoundtrackTrack, canEncodeAudioCodec, describeSoundtrack, prepareSoundtrack } from "./soundtrack";

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
 * `audio` = { file, loopS } puts the song in the file as its own track, cut to the plan's
 * window and aligned to frame 0. Audio problems never fail the render: the file is then
 * written without sound and `audioNote` says why.
 * @returns {Promise<{ addFrame(ts, dur), finish(): Promise<{blob, ext, codec}>, cancel(), hasAudio, audioInfo, audioNote }>}
 */
export async function openBakedEncoder(canvas, plan, { audio = null, log = (m) => console.info(m), soundtrack = {} } = {}) {
  if (!webCodecsAvailable()) throw new Error("This runtime has no WebCodecs VideoEncoder - baked export is unavailable.");
  const mb = await import("mediabunny");
  const size = { width: plan.width, height: plan.height };
  const wantAudio = !!audio?.file;
  const picked = await chooseCodecs({
    withAudio: wantAudio,
    canVideo: (codec) => mb.canEncodeVideo(codec, { ...size, bitrate: bakeBitrate(plan.width, plan.height, plan.fps) }).catch(() => false),
    canAudio: (codec) => canEncodeAudioCodec(codec, soundtrack),
  });
  if (!picked) throw new Error(`No video encoder available for ${plan.width}x${plan.height}. Try a lower resolution.`);

  // Encode the whole soundtrack before any frame is rendered, so a failure is known now.
  let sound = { encoded: null, info: null, note: null };
  if (wantAudio && !picked.audio) sound.note = "this runtime cannot encode AAC or Opus audio";
  else if (wantAudio) {
    sound = await prepareSoundtrack(audio, plan, picked.container, { ...soundtrack, pick: async () => AUDIO_CODECS[picked.audio] });
  }

  const open = async (encoded) => {
    const format = picked.container === "mp4"
      ? new mb.Mp4OutputFormat({ fastStart: "in-memory" })
      : new mb.WebMOutputFormat();
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format, target });
    try {
      const video = new mb.CanvasSource(canvas, {
        codec: picked.video,
        bitrate: bakeBitrate(plan.width, plan.height, plan.fps),
        keyFrameInterval: 2,
        latencyMode: "quality",
        bitrateMode: "variable",
      });
      output.addVideoTrack(video, { frameRate: plan.fps });
      const track = encoded ? addSoundtrackTrack(mb, output, encoded) : null;
      await output.start();
      if (track) await track.write();
      return { output, target, video };
    } catch (e) {
      try { await output.cancel(); } catch (_) { /* never started */ }
      throw e;
    }
  };
  let session;
  try { session = await open(sound.encoded); }
  catch (e) {
    if (!sound.encoded) throw e;
    sound = { encoded: null, info: null, note: `the audio track could not be written (${e?.message || e})` };
    session = await open(null);
  }
  const { output, target, video } = session;
  const hasAudio = !!sound.info;
  try {
    log(`[video-export] audio: ${hasAudio ? describeSoundtrack(sound.info)
      : `none - ${sound.note || "no song attached or Include music is off"}`}`);
  } catch (_) { /* logging is best effort */ }

  let cancelled = false;
  return {
    codec: { ...picked, audio: hasAudio ? picked.audio : null },
    hasAudio,
    audioInfo: sound.info,
    audioNote: hasAudio ? null : sound.note,
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
