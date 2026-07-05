// caveatFallbacks.test.js — AQ-FIX-004 / AQ-FIX-005
//
// EVAL-AQ-001 flagged two "works, with caveat" features whose real path needs
// hardware/browser capabilities that CI cannot provide:
//   * AQ-S3-006 VR walkthrough  — needs a physical WebXR headset,
//   * AQ-S3-007 4K video export — needs a browser MediaRecorder.
// The engines are built so the *capability is detected and degrades gracefully*
// rather than crashing when the capability is absent. These regression tests
// pin that graceful-fallback contract, so a future change that makes the
// headless path throw (or falsely claim support) fails the suite.
import { describe, it, expect } from "vitest";
import {
  isWebXRAvailable, isVRSupported, vrState, vrSessionOptions, VR_STATE,
} from "../walkthrough/vrMode";
import { supportedMimeType, buildExportConfig, is4K } from "../video/videoExport";

describe("AQ-FIX-004 — VR walkthrough degrades without a headset", () => {
  it("reports WebXR unavailable when the runtime has no navigator.xr", () => {
    expect(isWebXRAvailable({})).toBe(false);
    expect(isWebXRAvailable(undefined)).toBe(false);
  });

  it("resolves VR unsupported (never throws) with no XR device", async () => {
    await expect(isVRSupported({})).resolves.toBe(false);
    expect(await vrState({}, false)).toBe(VR_STATE.UNSUPPORTED);
  });

  it("swallows an xr.isSessionSupported that throws", async () => {
    const nav = { xr: { isSessionSupported: () => { throw new Error("no device"); } } };
    await expect(isVRSupported(nav)).resolves.toBe(false);
  });

  it("still reports READY when a headset advertises immersive-vr", async () => {
    const nav = { xr: { isSessionSupported: async (m) => m === "immersive-vr" } };
    expect(await vrState(nav, false)).toBe(VR_STATE.READY);
    expect(await vrState(nav, true)).toBe(VR_STATE.ACTIVE);   // active session wins
    expect(vrSessionOptions().requiredFeatures).toContain("local-floor");
  });
});

describe("AQ-FIX-005 — 4K video export degrades without MediaRecorder", () => {
  it("returns a safe default mime type when MediaRecorder is absent", () => {
    // recorder undefined (the headless case) must not throw and must yield a string.
    const mime = supportedMimeType(undefined, undefined);
    expect(typeof mime).toBe("string");
    expect(mime.length).toBeGreaterThan(0);
  });

  it("picks the first supported candidate when a recorder is present", () => {
    const recorder = { isTypeSupported: (m) => m === "video/webm;codecs=vp9" };
    expect(supportedMimeType(["video/mp4", "video/webm;codecs=vp9"], recorder))
      .toBe("video/webm;codecs=vp9");
  });

  it("builds a valid 4K/60 export config headlessly", () => {
    const cfg = buildExportConfig({ resolution: "4k", fps: 60, durationS: 10, withAudio: true });
    expect(cfg.width).toBe(3840);
    expect(cfg.height).toBe(2160);
    expect(cfg.is4K).toBe(true);
    expect(is4K("4k")).toBe(true);
    expect(cfg.fps).toBe(60);
    expect(cfg.frameCount).toBe(600);           // 10 s @ 60 fps
    expect(cfg.videoBitrate).toBeGreaterThan(0);
    expect(cfg.hasAudio).toBe(true);
    expect(typeof cfg.mimeType).toBe("string"); // resolved via graceful fallback
  });
});
