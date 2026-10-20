// AF-3D-VID-003 - the show's song as the exported video's audio track.
import { describe, it, expect, vi } from "vitest";
import {
  resolveExportSong, soundtrackRange, songCoverage, toStereo, fillPlanar, decodeSong,
  pickAudioCodec, canEncodeAudioCodec, encodeSoundtrack, addSoundtrackTrack, prepareSoundtrack,
  describeSoundtrack, AUDIO_CODECS, SOUNDTRACK_RATE,
} from "../soundtrack";
import { planBake } from "../bakedTimeline";

const ramp = (n, base = 0) => Float32Array.from({ length: n }, (_, i) => base + i);

describe("resolveExportSong", () => {
  const song = { name: "song.mp3" };
  it("uses the Show Programmer song for the timeline, starting at show time 0", () => {
    expect(resolveExportSong({ source: "timeline", programmerSong: song })).toEqual({ file: song, loopS: 0, origin: "show" });
    expect(resolveExportSong({ source: "full-show-timeline", programmerSong: song })).toMatchObject({ file: song, loopS: 0 });
    expect(resolveExportSong({ source: "timeline", programmerSong: null })).toBeNull();
  });
  it("uses the preview's own song, looping only for repeated passes", () => {
    const other = { name: "preview.wav" };
    const one = { audioFile: other, plan: { passMs: 30000, repeat: 1 } };
    expect(resolveExportSong({ source: "site-preview", site: one, programmerSong: song })).toEqual({ file: other, loopS: 0, origin: "preview" });
    const three = { audioFile: other, plan: { passMs: 30000, repeat: 3 } };
    expect(resolveExportSong({ source: "site-preview", site: three }).loopS).toBe(30);
  });
  it("falls back to the programmer song in the Show Studio preview, not in a pattern preview", () => {
    expect(resolveExportSong({ source: "site-preview", site: { editPanel: "show_programmer", plan: {} }, programmerSong: song })).toMatchObject({ file: song });
    expect(resolveExportSong({ source: "site-preview", site: { editPanel: "patterns", plan: {} }, programmerSong: song })).toBeNull();
  });
});

describe("soundtrackRange", () => {
  it("starts at the export start time and lasts exactly the video duration", () => {
    const plan = planBake({ fps: 30, startS: 12.5, durationS: 20 });
    const r = soundtrackRange({ startS: plan.startS, durationS: plan.durationS });
    expect(r.startFrame).toBe(12.5 * 48000);
    expect(r.frames).toBe(20 * 48000);
    expect(r.durationS).toBe(plan.durationS);
  });
  it("rounds down to whole codec frames so audio never outlasts the picture", () => {
    const r = soundtrackRange({ durationS: 1, frameSize: 1024 });   // 48000 samples
    expect(r.frames).toBe(46 * 1024);
    expect(r.frames).toBeLessThanOrEqual(48000);
    expect(48000 - r.frames).toBeLessThan(1024);
    expect(soundtrackRange({ durationS: 1, frameSize: 960 }).frames).toBe(48000);   // Opus divides 48 kHz evenly
  });
  it("length 0 (whole show) plans the show length, not the song length", () => {
    // PreviewPanel turns length 0 into (show duration - start); planBake rounds to frames.
    const plan = planBake({ fps: 24, startS: 0, durationS: 256.33 });
    const r = soundtrackRange({ durationS: plan.durationS, frameSize: 1 });
    expect(r.frames).toBe(Math.round(plan.frames / 24 * 48000));
  });
  it("clamps a negative start", () => {
    expect(soundtrackRange({ startS: -3, durationS: 1 }).startFrame).toBe(0);
  });
});

describe("fillPlanar / songCoverage", () => {
  const range = (o) => ({ sampleRate: 10, startFrame: 0, frames: 0, loopFrames: 0, ...o });
  it("cuts the window out of a longer song", () => {
    const ch = [ramp(10), ramp(10, 100)];
    const out = fillPlanar(ch, range({ startFrame: 2, frames: 3 }), 0, 3);
    expect(Array.from(out)).toEqual([2, 3, 4, 102, 103, 104]);   // planar: L then R
    expect(songCoverage(range({ startFrame: 2, frames: 3 }), 10)).toEqual({ songFrames: 3, silentFrames: 0 });
  });
  it("pads with silence where the song is shorter than the range", () => {
    const ch = [ramp(10), ramp(10)];
    const r = range({ startFrame: 8, frames: 5 });
    expect(Array.from(fillPlanar(ch, r, 0, 5).subarray(0, 5))).toEqual([8, 9, 0, 0, 0]);
    expect(songCoverage(r, 10)).toEqual({ songFrames: 2, silentFrames: 3 });
    // A start beyond the end of the song is all silence.
    expect(songCoverage(range({ startFrame: 20, frames: 4 }), 10)).toEqual({ songFrames: 0, silentFrames: 4 });
  });
  it("fills chunk by chunk with the same result as one block", () => {
    const ch = [ramp(50), ramp(50, 1000)];
    const r = range({ startFrame: 7, frames: 30 });
    const whole = fillPlanar(ch, r, 0, 30);
    const a = fillPlanar(ch, r, 0, 11), b = fillPlanar(ch, r, 11, 19);
    expect(Array.from(a.subarray(0, 11)).concat(Array.from(b.subarray(0, 19)))).toEqual(Array.from(whole.subarray(0, 30)));
    expect(Array.from(a.subarray(11)).concat(Array.from(b.subarray(19)))).toEqual(Array.from(whole.subarray(30)));
  });
  it("restarts the song every pass; a short song leaves silence until the next pass", () => {
    const ch = [ramp(3, 1)];   // song: 1 2 3
    const r = range({ startFrame: 0, frames: 10, loopFrames: 5 });
    expect(Array.from(fillPlanar(ch, r, 0, 10))).toEqual([1, 2, 3, 0, 0, 1, 2, 3, 0, 0]);
    expect(songCoverage(r, 3)).toEqual({ songFrames: 6, silentFrames: 4 });
  });
});

describe("toStereo", () => {
  it("duplicates mono, keeps stereo, drops surround extras", () => {
    const a = ramp(2), b = ramp(2, 5), c = ramp(2, 9);
    expect(toStereo([a])).toEqual([a, a]);
    expect(toStereo([a, b])).toEqual([a, b]);
    expect(toStereo([a, b, c, c, c, c])).toEqual([a, b]);
    expect(toStereo([])).toEqual([]);
  });
});

describe("decodeSong", () => {
  it("decodes at 48 kHz into two channels", async () => {
    const made = [];
    class Ctx {
      constructor(ch, len, rate) { made.push({ ch, len, rate }); this.rate = rate; }
      async decodeAudioData() { const d = ramp(96000); return { numberOfChannels: 1, sampleRate: this.rate, getChannelData: () => d }; }
    }
    const song = await decodeSong({ arrayBuffer: async () => new ArrayBuffer(4) }, { Context: Ctx });
    expect(made[0].rate).toBe(SOUNDTRACK_RATE);
    expect(song.channels).toHaveLength(2);
    expect(song.sourceChannels).toBe(1);
    expect(song.durationS).toBe(2);
  });
  it("reports a runtime without Web Audio", async () => {
    await expect(decodeSong({}, { Context: undefined })).rejects.toThrow(/cannot decode/);
  });
});

describe("codec choice", () => {
  const encoderWith = (ok) => ({ isConfigSupported: vi.fn(async (cfg) => ({ supported: ok.includes(cfg.codec) })) });
  it("prefers AAC-LC in MP4 at 48 kHz stereo 192 kbps", async () => {
    const Encoder = encoderWith(["mp4a.40.2", "opus"]);
    expect(await pickAudioCodec("mp4", { Encoder })).toBe(AUDIO_CODECS.aac);
    expect(Encoder.isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({
      codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000, aac: { format: "aac" },
    }));
  });
  it("falls back to Opus in MP4, and reports nothing when neither encodes", async () => {
    expect(await pickAudioCodec("mp4", { Encoder: encoderWith(["opus"]) })).toBe(AUDIO_CODECS.opus);
    expect(await pickAudioCodec("mp4", { Encoder: encoderWith([]) })).toBeNull();
    expect(await pickAudioCodec("webm", { Encoder: encoderWith(["mp4a.40.2"]) })).toBeNull();
    expect(await canEncodeAudioCodec("aac", { Encoder: undefined })).toBe(false);
  });
});

/** Fake WebCodecs AudioEncoder: one packet per 1024 input samples, in order. */
function fakeWebCodecs({ failOn = -1 } = {}) {
  const log = { configs: [], datas: [], closed: false };
  class AudioDataImpl {
    constructor(init) { Object.assign(this, init); log.datas.push(init); }
    close() { this.closed = true; }
  }
  class Encoder {
    constructor({ output, error }) { this.output = output; this.error = error; this.state = "unconfigured"; this.encodeQueueSize = 0; this.pending = 0; this.sent = 0; }
    configure(cfg) { log.configs.push(cfg); this.state = "configured"; this.rate = cfg.sampleRate; }
    encode(d) {
      if (log.datas.length - 1 === failOn) { this.error(new Error("encoder exploded")); return; }
      this.pending += d.numberOfFrames;
      while (this.pending >= 1024) {
        const ts = Math.round(this.sent * 1024 * 1e6 / this.rate);
        this.output({ timestamp: ts, byteLength: 4 }, this.sent === 0 ? { decoderConfig: { codec: "mp4a.40.2", sampleRate: this.rate, numberOfChannels: 2 } } : undefined);
        this.sent++; this.pending -= 1024;
      }
    }
    async flush() {}
    close() { this.state = "closed"; log.closed = true; }
  }
  return { Encoder, AudioDataImpl, log };
}

describe("encodeSoundtrack", () => {
  const song = { channels: [ramp(48000 * 3), ramp(48000 * 3)] };
  it("encodes the range in 1 s planar chunks timestamped from frame 0", async () => {
    const { Encoder, AudioDataImpl, log } = fakeWebCodecs();
    const range = soundtrackRange({ startS: 1, durationS: 2, frameSize: 1024 });
    const enc = await encodeSoundtrack(song, range, AUDIO_CODECS.aac, { Encoder, AudioDataImpl });
    expect(log.configs[0]).toMatchObject({ codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2 });
    expect(log.datas.map(d => d.timestamp)).toEqual([0, 1e6]);
    expect(log.datas.every(d => d.format === "f32-planar" && d.numberOfChannels === 2)).toBe(true);
    expect(log.datas.reduce((n, d) => n + d.numberOfFrames, 0)).toBe(range.frames);
    expect(log.datas[0].data[0]).toBe(48000);   // first sample = song at the 1 s start time
    expect(enc.packets).toHaveLength(range.frames / 1024);
    expect(enc.packets[0].meta.decoderConfig.codec).toBe("mp4a.40.2");
    expect(log.closed).toBe(true);
  });
  it("throws (so the caller saves a silent video) when the encoder errors", async () => {
    const { Encoder, AudioDataImpl, log } = fakeWebCodecs({ failOn: 1 });
    const range = soundtrackRange({ durationS: 3, frameSize: 1024 });
    await expect(encodeSoundtrack(song, range, AUDIO_CODECS.aac, { Encoder, AudioDataImpl })).rejects.toThrow(/exploded/);
    expect(log.closed).toBe(true);
  });
  it("refuses an empty range", async () => {
    const { Encoder, AudioDataImpl } = fakeWebCodecs();
    await expect(encodeSoundtrack(song, soundtrackRange({ durationS: 0.01, frameSize: 1024 }), AUDIO_CODECS.aac, { Encoder, AudioDataImpl })).rejects.toThrow(/too short/);
  });
});

describe("addSoundtrackTrack (muxer wiring)", () => {
  it("adds one audio track and writes every packet, decoder config first, then closes", async () => {
    const added = [];
    class EncodedAudioPacketSource {
      constructor(codec) { this.codec = codec; this.closed = false; }
      async add(packet, meta) { added.push({ packet, meta }); }
      close() { this.closed = true; }
    }
    const mb = { EncodedAudioPacketSource, EncodedPacket: { fromEncodedChunk: (c) => ({ wrapped: c }) } };
    const output = { addAudioTrack: vi.fn() };
    const encoded = { codec: AUDIO_CODECS.aac, packets: [
      { chunk: { timestamp: 0 }, meta: { decoderConfig: { codec: "mp4a.40.2" } } },
      { chunk: { timestamp: 21333 }, meta: undefined },
    ] };
    const track = addSoundtrackTrack(mb, output, encoded);
    expect(output.addAudioTrack).toHaveBeenCalledWith(track.source);
    expect(track.source.codec).toBe("aac");
    await track.write();
    expect(added.map(a => a.packet.wrapped.timestamp)).toEqual([0, 21333]);
    expect(added[0].meta.decoderConfig.codec).toBe("mp4a.40.2");
    expect(added[1].meta).toBeUndefined();
    expect(track.source.closed).toBe(true);
  });
});

describe("prepareSoundtrack", () => {
  const plan = planBake({ fps: 30, startS: 10, durationS: 20 });
  const song = { channels: [ramp(48000 * 25), ramp(48000 * 25)], sampleRate: 48000, durationS: 25 };
  it("returns the encoded track and what was used (song shorter than the range → silence)", async () => {
    const encode = vi.fn(async (_s, range, codec) => ({ codec, packets: [{}], range }));
    const r = await prepareSoundtrack({ file: {}, loopS: 0 }, plan, "mp4", { decode: async () => song, pick: async () => AUDIO_CODECS.aac, encode });
    expect(r.note).toBeNull();
    expect(r.info).toMatchObject({ codec: "aac", sampleRate: 48000, channels: 2, startS: 10 });
    expect(r.info.songS).toBeCloseTo(15, 6);
    expect(r.info.silentS).toBeCloseTo(r.info.durationS - 15, 6);
    expect(describeSoundtrack(r.info)).toMatch(/^aac 48000Hz 2ch, 19\.9\d s \(song from 10\.00 s, 4\.9\d s silence\)$/);
  });
  it("never throws: decode, codec and encoder failures become a note", async () => {
    const bad = await prepareSoundtrack({ file: {} }, plan, "mp4", { decode: async () => { throw new Error("corrupt"); } });
    expect(bad).toMatchObject({ encoded: null, note: expect.stringMatching(/could not be decoded \(corrupt\)/) });
    const none = await prepareSoundtrack({ file: {} }, plan, "mp4", { decode: async () => song, pick: async () => null });
    expect(none.note).toMatch(/cannot encode AAC or Opus/);
    const boom = await prepareSoundtrack({ file: {} }, plan, "mp4", { decode: async () => song, pick: async () => AUDIO_CODECS.aac, encode: async () => { throw new Error("busy"); } });
    expect(boom).toMatchObject({ encoded: null, info: null, note: expect.stringMatching(/AAC audio encoder failed \(busy\)/) });
    expect(await prepareSoundtrack(null, plan, "mp4")).toEqual({ encoded: null, info: null, note: null });
  });
});
