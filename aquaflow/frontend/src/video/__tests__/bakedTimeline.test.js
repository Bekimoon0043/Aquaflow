// AF-3D-VID-001 - baked (frame-exact) video render timing contract.
import { describe, it, expect, vi } from "vitest";
import {
  planBake, frameShowTime, frameTimestamp, prerollShowTime, bakeBitrate,
  chooseCodecs, sliceAudioChannels, etaSeconds, MAX_SUBSTEP_S,
} from "../bakedTimeline";
import { createBakeSampler } from "../bakeSignalSampler";

describe("planBake", () => {
  it("gives exactly fps*duration frames at the export size", () => {
    const p = planBake({ resolution: "4k", fps: 60, durationS: 10 });
    expect(p.width).toBe(3840); expect(p.height).toBe(2160);
    expect(p.frames).toBe(600);
    expect(p.frameDuration).toBeCloseTo(1 / 60, 12);
  });

  it("sub-steps physics so no step exceeds the 60 Hz tuning of the live preview", () => {
    for (const fps of [24, 30, 60]) {
      const p = planBake({ fps, durationS: 1 });
      expect(p.substepDt).toBeLessThanOrEqual(MAX_SUBSTEP_S + 1e-12);
      expect(p.substepDt * p.substeps).toBeCloseTo(1 / fps, 12);
    }
    expect(planBake({ fps: 24 }).substeps).toBe(3);
    expect(planBake({ fps: 60 }).substeps).toBe(1);
  });

  it("frame times are exact (no accumulated drift over long renders)", () => {
    const p = planBake({ fps: 30, startS: 12, durationS: 600 });
    expect(frameShowTime(p, 0)).toBe(12);
    expect(frameShowTime(p, 17999)).toBeCloseTo(12 + 17999 / 30, 9);
    expect(frameTimestamp(p, 90)).toBe(3);
  });

  it("frame timestamps are strictly uniform - the property that makes the video smooth", () => {
    const p = planBake({ fps: 60, durationS: 5 });
    for (let i = 1; i < p.frames; i++) {
      expect(frameTimestamp(p, i) - frameTimestamp(p, i - 1)).toBeCloseTo(1 / 60, 12);
    }
  });

  it("warm-up replays the seconds before the start, clamped at show time 0", () => {
    const p = planBake({ fps: 60, startS: 10, prerollS: 3 });
    expect(prerollShowTime(p, 0)).toBeCloseTo(7, 9);
    const q = planBake({ fps: 60, startS: 1, prerollS: 3 });
    expect(prerollShowTime(q, 0)).toBe(0);
  });

  it("clamps silly durations and keeps dimensions even", () => {
    expect(planBake({ durationS: 1e9 }).durationS).toBeLessThanOrEqual(1800);
    const p = planBake({ resolution: { w: 1001, h: 601 } });
    expect(p.width % 2).toBe(0); expect(p.height % 2).toBe(0);
  });

  it("bitrate is high-quality and capped", () => {
    expect(bakeBitrate(1920, 1080, 60)).toBeGreaterThan(29_000_000);
    expect(bakeBitrate(3840, 2160, 60)).toBeLessThanOrEqual(120_000_000);
  });
});

describe("chooseCodecs", () => {
  it("prefers MP4/H.264", async () => {
    const c = await chooseCodecs({ canVideo: async () => true, canAudio: async () => true, withAudio: true });
    expect(c).toMatchObject({ container: "mp4", video: "avc", audio: "aac" });
  });
  it("falls back to WebM/VP9 when H.264 is unavailable", async () => {
    const c = await chooseCodecs({ canVideo: async (x) => x === "vp9", canAudio: async () => false });
    expect(c).toMatchObject({ container: "webm", video: "vp9" });
  });
  it("returns null when nothing can encode", async () => {
    expect(await chooseCodecs({ canVideo: async () => false, canAudio: async () => false })).toBeNull();
  });
});

describe("sliceAudioChannels", () => {
  it("cuts the window and loops a repeated pass", () => {
    const src = [Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])];
    expect(Array.from(sliceAudioChannels(src, 10, { startS: 0.2, durationS: 0.3 })[0])).toEqual([2, 3, 4]);
    expect(Array.from(sliceAudioChannels(src, 10, { startS: 0.3, durationS: 0.4, loopS: 0.5 })[0])).toEqual([3, 4, 0, 1]);
    expect(Array.from(sliceAudioChannels(src, 10, { startS: 0.8, durationS: 0.4 })[0])).toEqual([8, 9, 0, 0]);
  });
});

describe("etaSeconds", () => {
  it("extrapolates", () => {
    expect(etaSeconds(0, 10, 0)).toBeNull();
    expect(etaSeconds(5, 10, 1000)).toBeCloseTo(1, 9);
  });
});

describe("createBakeSampler", () => {
  it("samples the site preview at the exact requested time", () => {
    const evaluateSite = vi.fn((plan, t) => ({ fixtureIntensities: { a: t } }));
    const s = createBakeSampler({ sitePreview: { active: true, plan: { duration: 20 } }, evaluateSite });
    expect(s.source).toBe("site-preview");
    expect(s.defaultDurationS).toBe(20);
    expect(s.sample(3.25).fixtureIntensities.a).toBe(3.25);
    expect(s.sample(99).fixtureIntensities.a).toBe(20);
  });
  it("drives the timeline with a playing playhead and clears site overrides", () => {
    const deriveTimeline = vi.fn((o) => ({ pump: o.playhead, playbackState: o.playbackState }));
    const s = createBakeSampler({ timeline: { showDuration: 90 }, deriveTimeline });
    const out = s.sample(4.5);
    expect(out).toMatchObject({ pump: 4.5, playbackState: "playing", fixtureIntensities: null });
    expect(s.defaultDurationS).toBe(90);
  });
  it("renders a full-show timeline with per-fixture water and RGB states", () => {
    const plan = { duration: 80 };
    const evaluateSite = vi.fn((received, t) => ({
      source: "full-show-simulation",
      fixtureIntensities: { jet1: t / 80 },
      fixtureLightStates: { light1: { intensity: .2, color: "#0000ff" } },
    }));
    const s = createBakeSampler({ timelinePreviewPlan: plan, fixtures: [{ id: "jet1" }], evaluateSite });
    const out = s.sample(20);
    expect(s.source).toBe("full-show-timeline");
    expect(s.defaultDurationS).toBe(80);
    expect(out.fixtureIntensities.jet1).toBe(.25);
    expect(out.fixtureLightStates.light1.color).toBe("#0000ff");
    expect(evaluateSite).toHaveBeenCalledWith(plan, 20, [{ id: "jet1" }], false);
  });
});
