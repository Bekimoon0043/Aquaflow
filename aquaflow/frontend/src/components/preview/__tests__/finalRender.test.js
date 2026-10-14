// AF-3D-VID-002 — Final render quality: tier switch + restore, fallback on GPU limits,
// adaptive quality gating, progress maths and image-sequence naming.
import { describe, it, expect, vi } from "vitest";
import {
  bakeTierFor, fallbackChain, supersampleFor, adaptiveAllowed, runFinalRender, GpuLimitError,
  isGpuLimitError, checkGpu, verifyTierScene, applyFinalExtras, renderStats, formatClock,
  frameFileName, frameDigits, sequencePrefix, sequenceNote, encodeWav, createSequenceSink,
  createVideoSink, createZipWriter, snapshotView, restoreView, abortError, tierLabel, FINAL_SIZE_EXPONENT,
} from "../finalRender";
import { QUALITY_CONFIG, TIER_ORDER } from "../sceneQuality";
import { halfResSprayEnabled } from "../halfResParticles";
import { AdaptiveQualityController, applyRenderScale } from "../sceneAdaptive";
import { planBake } from "../../../video/bakedTimeline";

/** Fake preview that records every tier the scene was built with. */
function harness({ preview = "eco", failTiers = [], attemptImpl } = {}) {
  const built = [];
  const state = { tier: preview };
  const scene = (tier) => ({ quality: tier, id: `${tier}-${built.length}` });
  const switchTier = vi.fn(async (tier) => {
    const t = tier || preview;
    built.push(t);
    if (failTiers.includes(t)) throw new GpuLimitError(`cannot allocate ${t}`);
    state.tier = t;
    return scene(t);
  });
  const attempt = vi.fn(attemptImpl || (async (s, tier) => ({ ok: true, tier, sceneTier: s.quality })));
  return { built, state, switchTier, attempt, current: scene(preview) };
}

describe("quality choice", () => {
  it("maps export quality to the bake tier", () => {
    expect(bakeTierFor("preview", "eco")).toBeNull();
    expect(bakeTierFor("high", "eco")).toBe("high");
    expect(bakeTierFor("high", "high")).toBeNull();          // already high: no rebuild
    expect(bakeTierFor("ultra", "high")).toBe("ultra");
    expect(bakeTierFor(undefined, "eco")).toBeNull();
  });

  it("falls back ultra → high → medium → the preview tier, never to low", () => {
    expect(fallbackChain("ultra", "eco")).toEqual(["ultra", "high", "medium", null]);
    expect(fallbackChain("high", "eco")).toEqual(["high", "medium", null]);
    expect(fallbackChain("ultra", "medium")).toEqual(["ultra", "high", null]);
    expect(fallbackChain(null, "eco")).toEqual([null]);
  });

  it("ultra is an export-only profile: richer than high, never an adaptive tier", () => {
    const u = QUALITY_CONFIG.ultra, h = QUALITY_CONFIG.high;
    expect(TIER_ORDER).not.toContain("ultra");
    expect(u.gpuWater).toBeGreaterThan(h.gpuWater);
    expect(u.gpuSpray).toBeGreaterThan(h.gpuSpray);
    expect(u.reflect).toBeGreaterThanOrEqual(h.reflect);
    expect(u.shadowMapSize).toBeGreaterThan(2048);
    expect(halfResSprayEnabled("ultra", true)).toBe(false);   // full-res spray
    expect(halfResSprayEnabled("high", false)).toBe(true);
  });

  it("supersamples only ultra, within GPU and pixel limits", () => {
    expect(supersampleFor({ tier: "high", width: 1920, height: 1080 })).toBe(1);
    expect(supersampleFor({ tier: "ultra", width: 1920, height: 1080 })).toBe(2);      // 3840x2160
    expect(supersampleFor({ tier: "ultra", width: 2560, height: 1440 })).toBe(1.5);    // 3840x2160
    expect(supersampleFor({ tier: "ultra", width: 3840, height: 2160 })).toBe(1);
    expect(supersampleFor({ tier: "ultra", width: 1920, height: 1080, maxSize: 3000 })).toBe(1.5);
    expect(supersampleFor({ tier: "ultra", width: 1280, height: 720 })).toBe(2);
  });
});

describe("tier switch and exact restore", () => {
  it("switches to the final tier for the bake and back to the preview after", async () => {
    const h = harness({ preview: "eco" });
    const out = await runFinalRender({ targetTier: "high", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt });
    expect(out.tier).toBe("high");
    expect(out.result.sceneTier).toBe("high");
    expect(h.switchTier.mock.calls.map(c => c[0])).toEqual(["high", null]);
    expect(h.state.tier).toBe("eco");
    expect(out.fallbacks).toEqual([]);
  });

  it("Match preview renders on the current scene without any rebuild", async () => {
    const h = harness({ preview: "eco" });
    const out = await runFinalRender({ targetTier: null, previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt });
    expect(h.switchTier).not.toHaveBeenCalled();
    expect(h.attempt).toHaveBeenCalledWith(h.current, "eco");
    expect(out.tier).toBe("eco");
  });

  it("restores the preview when the render is cancelled", async () => {
    const abort = { aborted: false };
    const h = harness({ attemptImpl: async () => { abort.aborted = true; throw abortError(); } });
    await expect(runFinalRender({ targetTier: "ultra", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt, abort }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(h.switchTier.mock.calls.map(c => c[0])).toEqual(["ultra", null]);
    expect(h.state.tier).toBe("eco");
  });

  it("restores the preview when the render fails (and does not fall back on non-GPU errors)", async () => {
    const h = harness({ attemptImpl: async () => { throw new Error("No video encoder available"); } });
    await expect(runFinalRender({ targetTier: "high", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt }))
      .rejects.toThrow(/encoder/);
    expect(h.attempt).toHaveBeenCalledTimes(1);
    expect(h.switchTier.mock.calls.map(c => c[0])).toEqual(["high", null]);
    expect(h.state.tier).toBe("eco");
  });

  it("cancel before the switch does nothing to the preview", async () => {
    const h = harness();
    await expect(runFinalRender({ targetTier: "high", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt, abort: { aborted: true } }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(h.switchTier).not.toHaveBeenCalled();
  });

  it("a restore failure is reported, not thrown over the render result", async () => {
    const notices = [];
    const switchTier = vi.fn(async (t) => { if (!t) throw new Error("canvas gone"); return { quality: t }; });
    const out = await runFinalRender({ targetTier: "high", previewTier: "eco", currentScene: {}, switchTier, attempt: async () => 1, onNotice: m => notices.push(m) });
    expect(out.result).toBe(1);
    expect(notices.join()).toMatch(/restore failed/i);
  });
});

describe("GPU memory fallback", () => {
  it("falls back to the next tier when a tier cannot be allocated", async () => {
    const notices = [];
    const h = harness({ preview: "eco", failTiers: ["ultra"] });
    const out = await runFinalRender({ targetTier: "ultra", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt, onNotice: m => notices.push(m) });
    expect(out.tier).toBe("high");
    expect(h.built).toEqual(["ultra", "high", "eco"]);
    expect(notices[0]).toMatch(/Final \(ultra\).*GPU memory.*Final \(high\)/);
    expect(h.state.tier).toBe("eco");
  });

  it("falls back when the GPU runs out of memory mid-render (verify or attempt)", async () => {
    const h = harness({
      attemptImpl: async (s) => { if (s.quality !== "medium") throw new GpuLimitError("The graphics card ran out of memory."); return "ok"; },
    });
    const out = await runFinalRender({ targetTier: "ultra", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt });
    expect(out.tier).toBe("medium");
    expect(out.fallbacks).toHaveLength(2);
    expect(h.built).toEqual(["ultra", "high", "medium", "eco"]);
  });

  it("ends on the preview tier when every final tier fails", async () => {
    const h = harness({ failTiers: ["high", "medium"] });
    const out = await runFinalRender({ targetTier: "high", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt });
    expect(out.tier).toBe("eco");
    expect(out.fallbacks.at(-1)).toMatch(/using Eco/);
  });

  it("verify() rejections fall back too", async () => {
    const h = harness();
    const verify = (s) => { if (s.quality === "high") throw new GpuLimitError("GPU particle buffers could not be allocated."); };
    const out = await runFinalRender({ targetTier: "high", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt, verify });
    expect(out.tier).toBe("medium");
  });

  it("classifies GPU errors", () => {
    expect(isGpuLimitError(new GpuLimitError("x"))).toBe(true);
    expect(isGpuLimitError(new Error("WebGL: CONTEXT_LOST_WEBGL"))).toBe(true);
    expect(isGpuLimitError(new Error("Failed to allocate texture"))).toBe(true);
    expect(isGpuLimitError(new Error("No video encoder available"))).toBe(false);
    expect(isGpuLimitError(abortError())).toBe(false);
  });

  it("checkGpu / verifyTierScene detect lost contexts, OOM and missing GPU fields", () => {
    const sceneWith = (gl, extra = {}) => ({ quality: "high", renderer: { getContext: () => gl }, ...extra });
    expect(() => checkGpu(sceneWith({ isContextLost: () => true }))).toThrow(GpuLimitError);
    expect(() => checkGpu(sceneWith({ isContextLost: () => false, getError: () => 0x0505, OUT_OF_MEMORY: 0x0505 }))).toThrow(/out of memory/);
    expect(() => checkGpu(sceneWith({ isContextLost: () => false, getError: () => 0 }))).not.toThrow();
    const ok = { isContextLost: () => false, getError: () => 0 };
    expect(() => verifyTierScene(sceneWith(ok), { expectGpuFields: true })).toThrow(/particle buffers/);
    expect(() => verifyTierScene(sceneWith(ok, { _gpuWater: {}, _gpuSpray: {} }), { expectGpuFields: true })).not.toThrow();
    expect(() => verifyTierScene(sceneWith(ok), { expectGpuFields: false })).not.toThrow();
    expect(() => verifyTierScene(null)).toThrow(GpuLimitError);
  });
});

describe("adaptive quality stays off during a bake", () => {
  it("adaptiveAllowed is false while a bake holds a tier or the scene is baking", () => {
    expect(adaptiveAllowed({})).toBe(true);
    expect(adaptiveAllowed({ bakeTier: "high" })).toBe(false);
    expect(adaptiveAllowed({ baking: true })).toBe(false);
  });

  it("dynamic resolution refuses to touch a baking scene", () => {
    const scene = { _baking: true, quality: "high", renderer: { setPixelRatio: vi.fn() }, resize: vi.fn(), _pr: 1 };
    expect(applyRenderScale(scene, 0.6)).toBe(false);
    expect(scene.renderer.setPixelRatio).not.toHaveBeenCalled();
    expect(scene._pr).toBe(1);
  });

  it("a slow bake would trip the controller — which is why it is gated", () => {
    const ctl = new AdaptiveQualityController({ tier: "high", ceiling: "high" });
    let action = null;
    for (let t = 0; t < 5000 && !action; t += 100) action = ctl.sample(2000, t);   // 2 s frames
    expect(action).toBeTruthy();
  });
});

describe("ultra extras", () => {
  it("draws 2x the particles finer, raises shadow map size and AO samples", () => {
    const light = { isDirectionalLight: true, castShadow: true, shadow: { map: { dispose: vi.fn() }, mapSize: { set: vi.fn() } } };
    const field = (count) => ({ count, uniforms: { uSizeScale: { value: 1 } } });
    const scene = {
      quality: "ultra",
      _gpuWater: field(QUALITY_CONFIG.ultra.gpuWater), _gpuSpray: field(QUALITY_CONFIG.ultra.gpuSpray),
      _envGroup: { traverse: (fn) => fn(light) },
      _fitShadowCamera: vi.fn(),
      _aoPass: { updateGtaoMaterial: vi.fn() },
    };
    expect(applyFinalExtras(scene)).toBe(true);
    expect(scene._gpuWater.uniforms.uSizeScale.value).toBeCloseTo(Math.pow(0.5, FINAL_SIZE_EXPONENT), 5);
    expect(scene._fitShadowCamera).toHaveBeenCalledWith(light, 4096);
    expect(light.shadow.map).toBeNull();
    expect(scene._aoPass.updateGtaoMaterial).toHaveBeenCalledWith({ samples: 32 });
    applyFinalExtras(scene);   // idempotent
    expect(scene._gpuWater.uniforms.uSizeScale.value).toBeCloseTo(Math.pow(0.5, FINAL_SIZE_EXPONENT), 5);
    expect(applyFinalExtras({ quality: "high" })).toBe(false);
  });
});

describe("camera view survives the rebuild", () => {
  const cam = () => ({
    position: { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } },
    quaternion: { x: 0, y: 0, z: 0, w: 1, set(x, y, z, w) { Object.assign(this, { x, y, z, w }); } },
    fov: 50, updateProjectionMatrix: vi.fn(),
  });
  it("copies orbit + camera pose into the new scene", () => {
    const a = { camera: cam(), cameraMode: "orbit", orbitAngle: 1.2, orbitHeight: 9, orbitRadius: 20, orbitAuto: false, _pathTime: 0.3 };
    a.camera.position.set(1, 2, 3); a.camera.quaternion.set(0, 0.5, 0, 0.8);
    const b = { camera: cam(), cameraMode: "orbit", orbitAngle: -0.72, orbitHeight: 6, orbitRadius: 12, orbitAuto: true };
    restoreView(b, snapshotView(a));
    expect([b.orbitAngle, b.orbitHeight, b.orbitRadius, b.orbitAuto, b._pathTime]).toEqual([1.2, 9, 20, false, 0.3]);
    expect([b.camera.position.x, b.camera.position.y, b.camera.position.z]).toEqual([1, 2, 3]);
    expect(b.camera.quaternion.y).toBe(0.5);
  });
  it("re-applies a saved named view", () => {
    const a = { camera: cam(), cameraMode: "named", _namedView: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } } };
    const b = { camera: cam(), setNamedView: vi.fn() };
    restoreView(b, snapshotView(a));
    expect(b.setNamedView).toHaveBeenCalledWith(a._namedView);
    expect(b.cameraMode).toBe("named");
  });
});

describe("progress and time estimate", () => {
  it("computes percent, s/frame and remaining time", () => {
    expect(renderStats({ frame: 0, frames: 150, frameMs: 0 })).toEqual({ pct: 0, secPerFrame: null, etaS: null });
    const s = renderStats({ frame: 30, frames: 150, frameMs: 60000 });   // 2 s per frame
    expect(s.pct).toBe(20);
    expect(s.secPerFrame).toBe(2);
    expect(s.etaS).toBe(240);
    expect(renderStats({ frame: 150, frames: 150, frameMs: 300000 }).etaS).toBe(0);
  });
  it("formats clocks", () => {
    expect(formatClock(null)).toBe("–");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(75)).toBe("1:15");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(59.6)).toBe("1:00");
  });
  it("labels tiers", () => {
    expect(tierLabel("ultra")).toBe("Final (ultra)");
    expect(tierLabel("eco")).toBe("Eco");
  });
});

describe("image sequence", () => {
  it("names frames with zero-padded, 0-based numbers", () => {
    expect(frameDigits(150)).toBe(5);
    expect(frameDigits(123456)).toBe(6);
    expect(frameFileName("lebu", 0, 150)).toBe("lebu_00000.png");
    expect(frameFileName("lebu", 149, 150)).toBe("lebu_00149.png");
    expect(frameFileName("x", 100000, 100001)).toBe("x_100000.png");
  });
  it("makes a safe prefix", () => {
    expect(sequencePrefix("Lebu Fountain: Wave/SoftLights 30s")).toBe("Lebu_Fountain_Wave_SoftLights_30s");
    expect(sequencePrefix("..\\..")).toBe("aquaflow");
    expect(sequencePrefix("")).toBe("aquaflow");
  });
  it("writes a note with an ffmpeg line and the audio file", () => {
    const plan = planBake({ resolution: "1080p", fps: 30, startS: 2, durationS: 5 });
    const note = sequenceNote({ prefix: "lebu", plan, tier: "high", audioName: "lebu_audio.wav", total: plan.frames });
    expect(note).toMatch(/lebu_00000\.png … lebu_00149\.png \(150 frames\)/);
    expect(note).toMatch(/1920x1080 @ 30 fps/);
    expect(note).toMatch(/-framerate 30 -start_number 0 -i lebu_%05d\.png -i lebu_audio\.wav/);
  });
  it("sink writes one numbered PNG per frame through the writer", async () => {
    const written = [];
    const capture = { canvas: {}, capture: vi.fn() };
    const sink = createSequenceSink({
      writer: { write: async (n, b) => written.push([n, b.length]) }, capture, prefix: "show", total: 3,
      encodePng: async () => new Uint8Array([137, 80, 78, 71]),
    });
    for (let i = 0; i < 3; i++) await sink.addFrame(i / 30, 1 / 30);
    expect(written).toEqual([["show_00000.png", 4], ["show_00001.png", 4], ["show_00002.png", 4]]);
    expect(capture.capture).toHaveBeenCalledTimes(3);
  });
  it("video sink copies (downscales) before encoding and checks the GPU", async () => {
    const order = [];
    const gl = { isContextLost: () => true };
    const sink = createVideoSink({
      encoder: { addFrame: async () => order.push("enc") }, capture: { capture: () => order.push("cap") },
      scene: { renderer: { getContext: () => gl } },
    });
    await expect(sink.addFrame(0, 1 / 30)).rejects.toBeInstanceOf(GpuLimitError);
    gl.isContextLost = () => false;
    const sink2 = createVideoSink({ encoder: { addFrame: async () => order.push("enc") }, capture: { capture: () => order.push("cap") } });
    await sink2.addFrame(0, 1 / 30);
    expect(order).toEqual(["cap", "enc"]);
  });
  it("browser ZIP writer refuses to exhaust memory", async () => {
    const w = createZipWriter({ createZip: (e) => new Uint8Array(e.length), name: "x", maxBytes: 10 });
    await w.write("a_00000.png", new Uint8Array(6));
    await expect(w.write("a_00001.png", new Uint8Array(6))).rejects.toThrow(/shorter range/);
  });
  it("encodes a valid 16-bit PCM WAV", () => {
    const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 48000);
    const v = new DataView(wav.buffer);
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe("RIFF");
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(40, true)).toBe(3 * 2 * 2);
    expect(wav.length).toBe(44 + 12);
    expect(v.getInt16(44 + 4, true)).toBe(32767);    // frame 1, left = +1
    expect(v.getInt16(44 + 8, true)).toBe(-32768);   // frame 2, left = -1
  });
});

describe("GPU reset during encode (GT 730, 4K high)", () => {
  it("finishWithWatch: resolves normally, rejects on cancel, on GPU loss and on a hung encoder", async () => {
    const { finishWithWatch } = await import("../finalRender");
    await expect(finishWithWatch({ finish: async () => "file" })).resolves.toBe("file");
    const hung = { finish: () => new Promise(() => {}) };
    await expect(finishWithWatch(hung, { abort: { aborted: true }, pollMs: 5 })).rejects.toMatchObject({ name: "AbortError" });
    await expect(finishWithWatch(hung, { isLost: () => true, pollMs: 5 })).rejects.toBeInstanceOf(GpuLimitError);
    await expect(finishWithWatch(hung, { timeoutMs: 20, pollMs: 5 })).rejects.toThrow(/stopped responding/);
  });

  it("the video sink stops on the first frame after a context loss (no black frames)", async () => {
    const gl = { isContextLost: () => false, getError: vi.fn(() => 0) };
    const enc = { addFrame: vi.fn(async () => {}) };
    const sink = createVideoSink({ encoder: enc, scene: { renderer: { getContext: () => gl } } });
    await sink.addFrame(0, 1);
    await sink.addFrame(1, 1);
    expect(gl.getError).toHaveBeenCalledTimes(1);   // sync check only on frame 1 / every 30th
    gl.isContextLost = () => true;
    await expect(sink.addFrame(2, 1)).rejects.toBeInstanceOf(GpuLimitError);
    expect(enc.addFrame).toHaveBeenCalledTimes(2);
  });

  it("watchContextLoss / waitForContext / settleWithin", async () => {
    const { watchContextLoss, waitForContext, settleWithin } = await import("../finalRender");
    const listeners = {};
    const canvas = { addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: vi.fn() };
    const w = watchContextLoss(canvas);
    expect(w.lost).toBe(false);
    listeners.webglcontextlost();
    expect(w.lost).toBe(true);
    w.reset(); expect(w.lost).toBe(false);
    w.dispose(); expect(canvas.removeEventListener).toHaveBeenCalled();
    let lost = true;
    setTimeout(() => { lost = false; }, 15);
    await expect(waitForContext({ isContextLost: () => lost }, { pollMs: 5 })).resolves.toBe(true);
    await expect(waitForContext({ isContextLost: () => true }, { timeoutMs: 20, pollMs: 5 })).rejects.toThrow(/did not recover/);
    await expect(settleWithin(new Promise(() => {}), 10)).resolves.toBeUndefined();
  });

  it("a GPU reset while encoding falls back to the next tier", async () => {
    const h = harness({
      attemptImpl: async (s) => { if (s.quality === "high") throw new GpuLimitError("The graphics card ran out of memory while writing the video (GPU reset)."); return "ok"; },
    });
    const out = await runFinalRender({ targetTier: "high", previewTier: "eco", currentScene: h.current, switchTier: h.switchTier, attempt: h.attempt });
    expect(out.tier).toBe("medium");
    expect(h.built).toEqual(["high", "medium", "eco"]);
  });

  it("prefix keeps hyphens tidy", () => {
    expect(sequencePrefix("Lebu Fountain - Wave, soft lights (30 s)")).toBe("Lebu_Fountain-Wave_soft_lights_30_s");
  });
});

describe("entry-GPU final size limit", () => {
  it("entry/software GPUs: Final up to 1440p, Ultra up to 1080p, 4K at the preview tier", async () => {
    const { entryTierCap } = await import("../finalRender");
    const cap = (tier, gpuClass, width, height) => entryTierCap({ tier, gpuClass, width, height });
    expect(cap("high", "entry", 1920, 1080)).toBe("high");
    expect(cap("high", "entry", 2560, 1440)).toBe("high");
    expect(cap("ultra", "entry", 1920, 1080)).toBe("ultra");
    expect(cap("ultra", "entry", 2560, 1440)).toBe("high");
    expect(cap("high", "entry", 3840, 2160)).toBeNull();
    expect(cap("ultra", "software", 3840, 2160)).toBeNull();
    expect(cap("ultra", "mid", 3840, 2160)).toBe("ultra");
    expect(cap(null, "entry", 3840, 2160)).toBeNull();
  });
});
