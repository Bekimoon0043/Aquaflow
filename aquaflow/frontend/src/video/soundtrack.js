// soundtrack.js - the show's song as the audio track of a baked video (AF-3D-VID-003)
//
// The song is decoded once with Web Audio (resampled to 48 kHz), cut to the exported
// window [startS, startS + durationS) so its first sample lines up with video frame 0,
// padded with silence where the song is shorter, and encoded with the WebCodecs
// AudioEncoder (AAC-LC, Opus as fallback) BEFORE the first video frame is rendered.
// Encoding up front means an audio failure is known before any GPU time is spent:
// the caller then simply builds a video-only file and says why the sound is missing.
//
// Everything below takes its Web APIs as parameters so it is unit-tested in Node.

export const SOUNDTRACK_RATE = 48000;
export const SOUNDTRACK_CHANNELS = 2;
export const SOUNDTRACK_BITRATE = 192000;

/** mediabunny codec id -> WebCodecs codec string and encoder frame size (samples). */
export const AUDIO_CODECS = Object.freeze({
  aac:  Object.freeze({ id: "aac",  webcodecs: "mp4a.40.2", frameSize: 1024, label: "aac" }),
  opus: Object.freeze({ id: "opus", webcodecs: "opus",      frameSize: 960,  label: "opus" }),
});
/** Audio codecs each container can carry, in order of preference. */
export const CONTAINER_AUDIO = Object.freeze({ mp4: ["aac", "opus"], webm: ["opus"] });

/**
 * Which song goes into the export, if any. Mirrors what the live preview plays:
 * the site/show preview's own song (looped every pass like the preview sidebar player),
 * otherwise the Show Programmer's song, which starts at show time 0.
 * @param {object} p
 * @param {string} p.source         sampler source: "site-preview" | "full-show-timeline" | "timeline"
 * @param {object} [p.site]         icanPreviewStore state ({ audioFile, editPanel, plan })
 * @param {File|null} [p.programmerSong]
 * @returns {{ file, loopS: number, origin: "preview"|"show" } | null}
 */
export function resolveExportSong({ source, site = null, programmerSong = null } = {}) {
  if (source === "site-preview") {
    const passMs = Number(site?.plan?.passMs) || 0;
    const repeat = Number(site?.plan?.repeat) || 1;
    // A single pass is the whole show: no looping, the song just plays from 0.
    const loopS = passMs > 0 && repeat > 1 ? passMs / 1000 : 0;
    if (site?.audioFile) return { file: site.audioFile, loopS, origin: "preview" };
    if (site?.editPanel === "show_programmer" && programmerSong) return { file: programmerSong, loopS: 0, origin: "show" };
    return null;
  }
  return programmerSong ? { file: programmerSong, loopS: 0, origin: "show" } : null;
}

/**
 * Sample range of the soundtrack for a render plan.
 * `frames` is the video duration in samples, rounded DOWN to whole encoder frames so
 * the audio track never runs past the last video frame (file duration = video duration;
 * at most one codec frame, ~21 ms, of tail is dropped).
 */
export function soundtrackRange({ startS = 0, durationS = 0, loopS = 0, sampleRate = SOUNDTRACK_RATE, frameSize = 1 } = {}) {
  const want = Math.max(0, Math.round((Number(durationS) || 0) * sampleRate));
  const size = Math.max(1, Math.floor(frameSize) || 1);
  const frames = Math.floor(want / size) * size;
  return {
    sampleRate,
    startFrame: Math.max(0, Math.round(Math.max(0, Number(startS) || 0) * sampleRate)),
    frames,
    loopFrames: loopS > 0 ? Math.round(loopS * sampleRate) : 0,
    durationS: frames / sampleRate,
  };
}

/** Walk the range as contiguous source segments: cb(outOffset, srcStart, srcEnd) (srcEnd exclusive, may pass srcLen). */
function eachSegment(range, offset, count, cb) {
  const loop = range.loopFrames > 0 ? range.loopFrames : Infinity;
  let pos = range.startFrame + offset;
  if (loop !== Infinity) pos %= loop;
  let done = 0;
  while (done < count) {
    const take = Math.min(count - done, loop - pos);
    cb(done, pos, pos + take);
    done += take;
    pos = 0;
  }
}

/** How much of the exported range is song vs. silence padding (in samples). */
export function songCoverage(range, songFrames) {
  let audible = 0;
  eachSegment(range, 0, range.frames, (_o, a, b) => { audible += Math.max(0, Math.min(b, songFrames) - Math.min(a, songFrames)); });
  return { songFrames: audible, silentFrames: range.frames - audible };
}

/** Song channels -> exactly SOUNDTRACK_CHANNELS: mono is duplicated, extra channels are dropped. */
export function toStereo(channels) {
  const list = Array.from(channels || []).filter(Boolean);
  if (!list.length) return [];
  return list.length === 1 ? [list[0], list[0]] : [list[0], list[1]];
}

/**
 * `count` samples of the range starting at `offset`, as planar f32 (channel 0 then 1).
 * Samples past the end of the song are silence.
 */
export function fillPlanar(channels, range, offset, count) {
  const n = Math.max(0, count | 0);
  const out = new Float32Array(n * channels.length);
  const srcLen = channels[0]?.length || 0;
  eachSegment(range, offset, n, (o, a, b) => {
    const end = Math.min(b, srcLen);
    if (end > a) channels.forEach((ch, c) => out.set(ch.subarray(a, end), c * n + o));
  });
  return out;
}

/**
 * Decode a song File/Blob to 48 kHz stereo channel data.
 * @returns {Promise<{ channels: Float32Array[], sampleRate: number, durationS: number, sourceChannels: number }>}
 */
export async function decodeSong(file, { Context = globalThis.OfflineAudioContext, sampleRate = SOUNDTRACK_RATE } = {}) {
  if (!file) throw new Error("No song attached.");
  if (typeof Context !== "function") throw new Error("This runtime cannot decode audio (no OfflineAudioContext).");
  const bytes = typeof file.arrayBuffer === "function" ? await file.arrayBuffer() : file;
  // decodeAudioData resamples to the context rate, so the result is always 48 kHz.
  const decoded = await new Context(SOUNDTRACK_CHANNELS, 1, sampleRate).decodeAudioData(bytes);
  const src = [];
  for (let c = 0; c < decoded.numberOfChannels; c++) src.push(decoded.getChannelData(c));
  const channels = toStereo(src);
  if (!channels.length) throw new Error("The song has no audio channels.");
  return { channels, sampleRate: decoded.sampleRate, durationS: channels[0].length / decoded.sampleRate, sourceChannels: decoded.numberOfChannels };
}

const encoderConfig = (codec, sampleRate, bitrate) => ({
  codec: codec.webcodecs, sampleRate, numberOfChannels: SOUNDTRACK_CHANNELS, bitrate,
  ...(codec.id === "aac" ? { aac: { format: "aac" } } : { opus: { format: "opus" } }),
});

/**
 * First audio codec the container can carry that this runtime's AudioEncoder supports.
 * @returns {Promise<object|null>} an AUDIO_CODECS entry
 */
export async function pickAudioCodec(container, deps = {}) {
  for (const id of CONTAINER_AUDIO[container] || []) {
    if (await canEncodeAudioCodec(id, deps)) return AUDIO_CODECS[id];
  }
  return null;
}

/** Does this runtime's AudioEncoder support `id` ("aac" | "opus") at 48 kHz stereo? */
export async function canEncodeAudioCodec(id, { Encoder = globalThis.AudioEncoder, sampleRate = SOUNDTRACK_RATE, bitrate = SOUNDTRACK_BITRATE } = {}) {
  const codec = AUDIO_CODECS[id];
  if (!codec || typeof Encoder?.isConfigSupported !== "function") return false;
  try { return !!(await Encoder.isConfigSupported(encoderConfig(codec, sampleRate, bitrate)))?.supported; }
  catch { return false; }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Encode the range with the WebCodecs AudioEncoder. Resolves only after flush(), so any
 * encoder error surfaces here, before the video render starts.
 * @returns {Promise<{ codec, packets: Array<{chunk, meta}>, range, sampleRate }>}
 */
export async function encodeSoundtrack(song, range, codec, {
  Encoder = globalThis.AudioEncoder, AudioDataImpl = globalThis.AudioData,
  bitrate = SOUNDTRACK_BITRATE, chunkFrames = 0, maxQueue = 4,
} = {}) {
  if (typeof Encoder !== "function" || typeof AudioDataImpl !== "function") throw new Error("This runtime has no WebCodecs AudioEncoder.");
  if (range.frames <= 0) throw new Error("The export is too short for an audio track.");
  const packets = [];
  let failure = null;
  const encoder = new Encoder({
    output: (chunk, meta) => packets.push({ chunk, meta }),
    error: (e) => { failure = failure || e; },
  });
  try {
    encoder.configure(encoderConfig(codec, range.sampleRate, bitrate));
    const step = chunkFrames > 0 ? chunkFrames : range.sampleRate;   // 1 s per AudioData
    for (let off = 0; off < range.frames; off += step) {
      if (failure) throw failure;
      const n = Math.min(step, range.frames - off);
      const data = new AudioDataImpl({
        format: "f32-planar", sampleRate: range.sampleRate, numberOfFrames: n,
        numberOfChannels: SOUNDTRACK_CHANNELS, timestamp: Math.round((off * 1e6) / range.sampleRate),
        data: fillPlanar(song.channels, range, off, n),
      });
      try { encoder.encode(data); } finally { data.close?.(); }
      // Keep only a few seconds of raw PCM queued (this PC has little memory to spare).
      while (!failure && (encoder.encodeQueueSize || 0) > maxQueue) await tick();
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    try { if (encoder.state !== "closed") encoder.close(); } catch { /* already closed */ }
  }
  if (!packets.length) throw new Error("The audio encoder produced no data.");
  // Nothing may start at/after the last video frame's end.
  const endUs = range.durationS * 1e6;
  const kept = packets.filter((p, i) => i === 0 || Number(p.chunk.timestamp) < endUs);
  return { codec, packets: kept, range, sampleRate: range.sampleRate };
}

/**
 * Wire the encoded soundtrack into a mediabunny Output as its audio track.
 * Call before output.start(); call the returned write() after it.
 * @param {object} mb  mediabunny module (EncodedAudioPacketSource, EncodedPacket)
 */
export function addSoundtrackTrack(mb, output, encoded) {
  const source = new mb.EncodedAudioPacketSource(encoded.codec.id);
  output.addAudioTrack(source);
  return {
    source,
    async write() {
      let first = true;
      for (const { chunk, meta } of encoded.packets) {
        // The first packet must carry the decoder config (AAC AudioSpecificConfig / Opus head).
        await source.add(mb.EncodedPacket.fromEncodedChunk(chunk), first ? meta : undefined);
        first = false;
      }
      source.close();
    },
  };
}

/** One line for the log, e.g. "aac 48000Hz 2ch, 256.33 s (song from 0.00 s, 0.00 s silence)". */
export function describeSoundtrack(info) {
  if (!info) return "none";
  return `${info.codec} ${info.sampleRate}Hz ${info.channels}ch, ${info.durationS.toFixed(2)} s`
    + ` (song from ${info.startS.toFixed(2)} s, ${info.silentS.toFixed(2)} s silence)`;
}

/**
 * Full audio preparation for a render: decode, pick a codec, cut, encode.
 * Never throws: returns { encoded, info } or { encoded: null, note } with the reason.
 */
export async function prepareSoundtrack(audio, plan, container, deps = {}) {
  if (!audio?.file) return { encoded: null, info: null, note: null };
  const { decode = decodeSong, pick = pickAudioCodec, encode = encodeSoundtrack } = deps;
  let song;
  try { song = await decode(audio.file, deps); }
  catch (e) { return { encoded: null, info: null, note: `the song could not be decoded (${e?.message || e})` }; }
  const codec = await pick(container, deps);
  if (!codec) return { encoded: null, info: null, note: `this runtime cannot encode AAC or Opus audio for ${container.toUpperCase()}` };
  const range = soundtrackRange({ startS: plan.startS, durationS: plan.durationS, loopS: audio.loopS || 0, sampleRate: song.sampleRate, frameSize: codec.frameSize });
  try {
    const encoded = await encode(song, range, codec, deps);
    const cover = songCoverage(range, song.channels[0].length);
    const info = {
      codec: codec.label, sampleRate: range.sampleRate, channels: SOUNDTRACK_CHANNELS, durationS: range.durationS,
      startS: range.startFrame / range.sampleRate, songS: cover.songFrames / range.sampleRate,
      silentS: cover.silentFrames / range.sampleRate, songDurationS: song.durationS,
    };
    return { encoded, info, note: null };
  } catch (e) {
    return { encoded: null, info: null, note: `the ${codec.label.toUpperCase()} audio encoder failed (${e?.message || e})` };
  }
}
