// AF-NEXT-004 golden parity: one fixed show, every evaluation path, same answers.
//
// Paths compared at start, fade boundaries, overlap, midpoint, loop boundary, end and
// blackout:
//   canonical  evaluateShowFrame (src/show/evaluateShowFrame.js)
//   timeline   Show Studio sampleClips (studio/showModel.js)
//   embedded   StudioPreview 3D path: createFullShowPreview → createICANPreviewPlan → evaluateFullShowPreview
//   full       PreviewPanel path: icanPreviewStore.load/seek → evaluateICANPreview
//   video      createBakeSampler(site preview).sample
//   dry run    createDryRunPreviewSession().evaluateAllChannels
//   compiler   runtimeEventCompiler.compileShow events + showProgrammerCompiler.compileShow frames
//   timeline signals  deriveRuntimeSignals per-clip intensities
// The backend mirror is checked against the same JSON in backend/tests/test_show_frame.py.
import { describe, expect, it, beforeEach, vi } from "vitest";
import golden from "./golden/golden-show.json";
import {
  evaluateShowFrame, prepareShow, resolvePlayTime, clipLevel, showDiagnostics, lightBytes,
  SHOW_FRAME_VERSION, FRAME_TOLERANCE,
} from "../evaluateShowFrame";
import { sampleClips } from "../../components/programmer/studio/showModel";
import { createFullShowPreview, evaluateFullShowPreview } from "../../utils/fullShowPreview";
import { createICANPreviewPlan, evaluateICANPreview } from "../../utils/icanPatternPreview";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import { createBakeSampler } from "../../video/bakeSignalSampler";
import { createDryRunPreviewSession } from "../../utils/dryRunPreview";
import { compileShow as compileEvents, evaluateAllChannels } from "../../utils/runtimeEventCompiler";
import { compileShow as compileFrames } from "../../utils/showProgrammerCompiler";
import { deriveRuntimeSignals } from "../../utils/runtimeSignalSelector";

const project = { fixtures: golden.fixtures, clips: golden.clips };
const LEVEL = golden.tolerance.level;
const fixtures = golden.fixtures;
const isLoop = cp => Boolean(cp.opts.loop);
const isBlackout = cp => Boolean(cp.opts.blackout);
const showSeconds = cp => resolvePlayTime(prepareShow(project), cp.timeMs / 1000, cp.opts).showTime;
const hexBytes = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
// Emitted bytes of a 3D light state: colour × intensity (the renderer's contract).
const viewBytes = state => hexBytes(state.color).map(v => Math.round(v * state.intensity));
const expectNear = (actual, expected, tolerance, label) => {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance + 1e-12);
};
const expectBytes = (actual, expected, label) => actual.forEach((v, i) => expectNear(v, expected[i], golden.tolerance.byte, `${label}[${i}]`));

// The StudioPreview keeps only clips the 3D renderer can show (valves are not drawn).
function visualClips(clips) {
  return clips.filter(clip => { try { createFullShowPreview([clip], fixtures); return true; } catch { return false; } });
}

describe("AF-NEXT-004 canonical frame — golden show", () => {
  it("has a versioned contract", () => {
    const frame = evaluateShowFrame(project, 0);
    expect(frame.version).toBe(SHOW_FRAME_VERSION);
    expect(frame.contract).toBe("aquaflow-show-frame");
    expect(FRAME_TOLERANCE).toBeCloseTo(1 / 255, 12);
    expect(Object.keys(frame.fixtures).sort()).toEqual(["L1", "L2", "N1", "P1", "V1"]);
  });

  for (const cp of golden.checkpoints) {
    it(`matches the hand-derived expectation: ${cp.name}`, () => {
      const frame = evaluateShowFrame(project, cp.timeMs, cp.opts);
      expect(frame.state).toBe(cp.expect.state);
      if (cp.expect.passIndex) expect(frame.passIndex).toBe(cp.expect.passIndex);
      for (const [id, level] of Object.entries(cp.expect.levels)) expectNear(frame.fixtures[id].level, level, LEVEL, `${cp.name} ${id}`);
      for (const [id, speed] of Object.entries(cp.expect.pumps)) expectNear(frame.pumps[id].speed, speed, LEVEL, `${cp.name} pump ${id}`);
      for (const [id, open] of Object.entries(cp.expect.valves)) expect(frame.valves[id].open).toBe(open);
      for (const [id, bytes] of Object.entries(cp.expect.lights)) expectBytes(lightBytes(frame.fixtures[id]), bytes, `${cp.name} ${id}`);
      for (const [id, clipId] of Object.entries(cp.expect.source || {})) expect(frame.fixtures[id].source.clipId).toBe(clipId);
      for (const code of cp.expect.diagnostics || []) expect(frame.diagnostics.map(d => d.code)).toContain(code);
    });
  }

  it("reports the overlap the Siemens compiler would reject", () => {
    const overlaps = showDiagnostics(project).filter(d => d.code === "overlap");
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ fixtureId: "N1", channel: "device_intensity", clipIds: ["c3", "c4"], startMs: 3000, endMs: 4000 });
  });

  it("documents both colour encodings", () => {
    const light = evaluateShowFrame(project, 4000).fixtures.L1;
    expect(light.color.hex).toBe("#ff8000");
    expect(light.color.srgb.g).toBeCloseTo(128 / 255, 12);
    expect(light.color.linear.g).toBeCloseTo(Math.pow((128 / 255 + 0.055) / 1.055, 2.4), 12);
    expect(light.output.r).toBeCloseTo(0.8, 12);
  });
});

describe("AF-NEXT-004 parity — every view agrees with the canonical frame", () => {
  beforeEach(() => { vi.restoreAllMocks(); useICANPreviewStore.getState().close(); });

  for (const cp of golden.checkpoints) {
    it(`timeline sampler: ${cp.name}`, () => {
      if (isBlackout(cp)) return; // The Studio timeline has no blackout; transport stop/blackout is a preview state.
      const levels = sampleClips(golden.clips, showSeconds(cp));
      for (const [id, level] of Object.entries(cp.expect.levels)) expectNear(levels[id]?.value ?? 0, level, LEVEL, `${cp.name} ${id}`);
    });

    it(`embedded 3D preview: ${cp.name}`, () => {
      // StudioPreview wraps the loop itself and has no blackout, so blackout is shown as stopped.
      const plan = createICANPreviewPlan(createFullShowPreview(visualClips(golden.clips), fixtures), 1);
      const state = evaluateFullShowPreview(plan, showSeconds(cp), fixtures, isBlackout(cp));
      expectNear(state.fixtureIntensities.N1, cp.expect.levels.N1, LEVEL, `${cp.name} N1`);
      expectNear(state.pump, cp.expect.pumps.P1, LEVEL, `${cp.name} pump`);
      for (const id of ["L1", "L2"]) expectBytes(viewBytes(state.fixtureLightStates[id]), cp.expect.lights[id], `${cp.name} ${id}`);
    });

    it(`full preview + video sampler: ${cp.name}`, () => {
      vi.spyOn(performance, "now").mockImplementation(() => 0);
      const store = useICANPreviewStore.getState();
      store.load(createFullShowPreview(visualClips(golden.clips), fixtures), isLoop(cp) ? 2 : 1, null, "show_programmer");
      store.seek(cp.timeMs / 1000);
      if (isBlackout(cp)) useICANPreviewStore.getState().stop();
      const s = useICANPreviewStore.getState();
      const state = evaluateICANPreview(s.plan, s.position, fixtures, s.playback === "stopped");
      const checks = [["full", state]];
      if (!isBlackout(cp)) checks.push(["video", createBakeSampler({ sitePreview: { active: true, plan: s.plan }, fixtures }).sample(cp.timeMs / 1000)]);
      for (const [view, out] of checks) {
        expectNear(out.fixtureIntensities.N1, cp.expect.levels.N1, LEVEL, `${view} ${cp.name} N1`);
        expectNear(out.pump, cp.expect.pumps.P1, LEVEL, `${view} ${cp.name} pump`);
        for (const id of ["L1", "L2"]) expectBytes(viewBytes(out.fixtureLightStates[id]), cp.expect.lights[id], `${view} ${cp.name} ${id}`);
      }
    });

    it(`dry run + event compiler: ${cp.name}`, async () => {
      if (isBlackout(cp)) return; // Dry run/compiled events have no blackout command; stop clears the session.
      const t = showSeconds(cp);
      const session = await createDryRunPreviewSession({ timelineClips: golden.clips, audioDuration: 8 });
      expect(session.success).toBe(true);
      const { compiled, warnings } = compileEvents({ timelineClips: golden.clips, audioDuration: 8 });
      expect(warnings.some(w => w.startsWith("OVERLAP"))).toBe(true);
      const views = [["dry run", session.evaluateAllChannels(t), true], ["compiler", evaluateAllChannels(compiled.events, t), false]];
      for (const [view, channels, htp] of views) {
        expectNear(channels.P1.pump_speed, cp.expect.pumps.P1, LEVEL, `${view} ${cp.name} P1`);
        expect(channels.V1.enable > 0, `${view} ${cp.name} V1`).toBe(cp.expect.valves.V1);
        expectNear(channels.L1.intensity, cp.expect.levels.L1, LEVEL, `${view} ${cp.name} L1`);
        expectNear(channels.L2.intensity, t >= 1 && t < 7 ? cp.expect.levels.L2 : 0, LEVEL, `${view} ${cp.name} L2`);
        expectNear(channels.L2.r, t >= 2 && t < 4 ? 0.5 : 0, LEVEL, `${view} ${cp.name} L2.r`);
        // N1 has overlapping clips: only the canonical (HTP) evaluator resolves them;
        // the raw event list is flagged with an OVERLAP diagnostic instead.
        if (htp) expectNear(channels.N1.intensity, cp.expect.levels.N1, LEVEL, `${view} ${cp.name} N1`);
      }
    });

    it(`frame compiler: ${cp.name}`, () => {
      const t = showSeconds(cp);
      if (isBlackout(cp) || t >= 8) return; // Frames cover [0, duration); blackout is not a compiled frame.
      const compiled = compileFrames({ clips: golden.clips, fixtures, duration: 8, fps: 10 });
      const states = compiled.frames[Math.round(t * 10)].states;
      expectNear(states.N1.intensity, cp.expect.levels.N1, LEVEL, `${cp.name} N1`);
      expectNear(states.P1.intensity, cp.expect.pumps.P1, LEVEL, `${cp.name} P1`);
      expect(states.V1.on).toBe(cp.expect.valves.V1);
      for (const id of ["L1", "L2"]) expectBytes(viewBytes(states[id]), cp.expect.lights[id], `${cp.name} ${id}`);
    });

    it(`timeline runtime signals (per clip): ${cp.name}`, () => {
      if (isBlackout(cp)) return;
      const t = showSeconds(cp);
      const signals = deriveRuntimeSignals({ timelineTracks: golden.clips.map(clip => ({ id: clip.trackId, type: clip.type, clips: [clip] })), playhead: t, mode: "timeline" });
      const prepared = prepareShow(project);
      // The legacy selector projects pump/valve/intensity/master tracks; per-channel RGB
      // clips have no global signal there (they are fixture-level only).
      const mapped = new Set(["pump_speed", "device_intensity", "solenoid_open", "lighting_master"]);
      const active = prepared.clips.filter(clip => mapped.has(clip.type) && t >= clip.start && t < clip.end);
      expect(signals.activeClips.map(c => c.id).sort()).toEqual(active.map(c => c.id).sort());
      for (const clip of active) expectNear(signals.activeClips.find(c => c.id === clip.id).intensity, clipLevel(clip, t), 1e-12, `${cp.name} ${clip.id}`);
    });
  }
});

describe("AF-NEXT-004 no playhead reset after an ordinary edit", () => {
  it("keeps the preview position and play state when the edited show replaces the plan", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const store = () => useICANPreviewStore.getState();
    store().load(createFullShowPreview(visualClips(golden.clips), fixtures), 1, null, "show_programmer");
    store().seek(3.2);
    store().play();
    now = 300; // the playhead advanced 0.3 s since the last tick
    const edited = golden.clips.map(clip => clip.id === "c5" ? { ...clip, value: 50 } : clip);
    store().replace(createFullShowPreview(visualClips(edited), fixtures), 1, null, "show_programmer");
    expect(store().position).toBeCloseTo(3.5, 9);
    expect(store().playback).toBe("playing");
    const state = evaluateICANPreview(store().plan, store().position, fixtures, false);
    expect(state.fixtureLightStates.L1.intensity).toBeCloseTo(0.5, 9); // the edit is visible at the same time
    store().pause();
    store().replace(createFullShowPreview(visualClips(golden.clips), fixtures), 1, null, "show_programmer");
    expect(store()).toMatchObject({ playback: "paused" });
    expect(store().position).toBeCloseTo(3.5, 9);
  });
});
