// AF-3D-VID-003 - the baked encoder puts the song in the file, or saves a silent video and says why.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const state = vi.hoisted(() => ({ outputs: [], failAudioAdd: false }));

vi.mock("mediabunny", () => {
  class Output {
    constructor(opts) { this.opts = opts; this.video = null; this.audio = []; this.state = "pending"; state.outputs.push(this); }
    addVideoTrack(src, meta) { this.video = { src, meta }; }
    addAudioTrack(src) { this.audio.push(src); }
    async start() { this.state = "started"; }
    async finalize() { this.state = "finalized"; }
    async cancel() { this.state = "canceled"; }
  }
  class CanvasSource { constructor(canvas, cfg) { this.cfg = cfg; this.frames = []; } add(ts, d) { this.frames.push([ts, d]); } close() {} }
  class EncodedAudioPacketSource {
    constructor(codec) { this.codec = codec; this.packets = []; }
    async add(p, meta) { if (state.failAudioAdd) throw new Error("muxer rejected the AAC config"); this.packets.push({ p, meta }); }
    close() { this.closed = true; }
  }
  return {
    Output, CanvasSource, EncodedAudioPacketSource,
    EncodedPacket: { fromEncodedChunk: (c) => ({ chunk: c }) },
    Mp4OutputFormat: class { constructor(o) { this.kind = "mp4"; this.o = o; } },
    WebMOutputFormat: class { constructor() { this.kind = "webm"; } },
    BufferTarget: class { constructor() { this.buffer = new ArrayBuffer(8); } },
    canEncodeVideo: async (c) => c === "avc",
  };
});

import { openBakedEncoder } from "../bakedEncoder";
import { planBake } from "../bakedTimeline";
import { AUDIO_CODECS } from "../soundtrack";

const plan = planBake({ resolution: "720p", fps: 30, startS: 5, durationS: 4 });
const song = { channels: [new Float32Array(48000 * 6), new Float32Array(48000 * 6)], sampleRate: 48000, durationS: 6 };
const supportsAac = { isConfigSupported: async (cfg) => ({ supported: cfg.codec === "mp4a.40.2" }) };
const soundtrack = {
  Encoder: supportsAac,
  decode: async () => song,
  encode: async (_s, range, codec) => ({ codec, range, packets: [
    { chunk: { timestamp: 0 }, meta: { decoderConfig: { codec: "mp4a.40.2" } } }, { chunk: { timestamp: 21333 } },
  ] }),
};

beforeEach(() => { state.outputs.length = 0; state.failAudioAdd = false; globalThis.window = { VideoEncoder: function VideoEncoder() {} }; });
afterEach(() => { delete globalThis.window; });

describe("openBakedEncoder soundtrack", () => {
  it("adds an AAC track to the MP4 and logs one clear line", async () => {
    const log = vi.fn();
    const enc = await openBakedEncoder({}, plan, { audio: { file: {}, loopS: 0 }, log, soundtrack });
    const out = state.outputs[0];
    expect(out.opts.format.kind).toBe("mp4");
    expect(out.audio).toHaveLength(1);
    expect(out.audio[0].codec).toBe("aac");
    expect(out.audio[0].packets).toHaveLength(2);
    expect(out.audio[0].packets[0].meta.decoderConfig.codec).toBe("mp4a.40.2");
    expect(out.audio[0].closed).toBe(true);
    expect(enc.hasAudio).toBe(true);
    expect(enc.audioInfo).toMatchObject({ codec: "aac", sampleRate: 48000, channels: 2, startS: 5 });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[video-export\] audio: aac 48000Hz 2ch, 3\.9\d s \(song from 5\.00 s, 2\.9\d s silence\)$/));
    const done = await enc.finish();
    expect(done.ext).toBe("mp4");
  });

  it("saves a silent video and says why when the audio track cannot be written", async () => {
    state.failAudioAdd = true;
    const log = vi.fn();
    const enc = await openBakedEncoder({}, plan, { audio: { file: {} }, log, soundtrack });
    expect(state.outputs).toHaveLength(2);
    expect(state.outputs[0].state).toBe("canceled");
    expect(state.outputs[1].audio).toHaveLength(0);
    expect(state.outputs[1].video).toBeTruthy();
    expect(enc.hasAudio).toBe(false);
    expect(enc.audioNote).toMatch(/could not be written \(muxer rejected/);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[video-export\] audio: none - the audio track could not be written/));
  });

  it("stays MP4 and silent when the runtime has no AAC/Opus encoder", async () => {
    const enc = await openBakedEncoder({}, plan, { audio: { file: {} }, log: () => {}, soundtrack: { ...soundtrack, Encoder: { isConfigSupported: async () => ({ supported: false }) } } });
    expect(state.outputs[0].opts.format.kind).toBe("mp4");
    expect(state.outputs[0].audio).toHaveLength(0);
    expect(enc.audioNote).toMatch(/cannot encode AAC or Opus/);
  });

  it("falls back to Opus in MP4", async () => {
    const enc = await openBakedEncoder({}, plan, { audio: { file: {} }, log: () => {}, soundtrack: { ...soundtrack, Encoder: { isConfigSupported: async (c) => ({ supported: c.codec === "opus" }) } } });
    expect(state.outputs[0].opts.format.kind).toBe("mp4");
    expect(state.outputs[0].audio[0].codec).toBe(AUDIO_CODECS.opus.id);
    expect(enc.hasAudio).toBe(true);
  });

  it("no song: plain video, no audio track", async () => {
    const enc = await openBakedEncoder({}, plan, { audio: null, log: () => {}, soundtrack });
    expect(state.outputs[0].audio).toHaveLength(0);
    expect(enc.hasAudio).toBe(false);
    expect(enc.audioNote).toBeNull();
  });
});
