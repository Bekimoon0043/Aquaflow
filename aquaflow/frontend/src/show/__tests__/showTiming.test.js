// AF-NEXT-005 — state and timing parity.
// Overlapping clips, fades and curves, pattern phase, tempo map, sections, stop,
// mute/solo inheritance, and a deterministic replay of a generated five-minute,
// 300-fixture show. Also maintains frame-trace.json, the cross-language trace the
// backend mirror (backend/engine/show_frame.py) is checked against.
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import golden from "./golden/golden-show.json";
import curves from "./golden/curves-show.json";
import {
  evaluateShowFrame, evaluateShowFrameAt, frameHash, beatsToSeconds, secondsToBeats, showDiagnostics,
  lightBytes, lightViewState, CURVES,
} from "../evaluateShowFrame";
import { compileStudio, sampleClips } from "../../components/programmer/studio/showModel";
import { createFullShowPreview, evaluateFullShowPreview } from "../../utils/fullShowPreview";
import { createICANPreviewPlan, evaluateICANPreview } from "../../utils/icanPatternPreview";
import { compileShow as compileEvents, evaluateAllChannels } from "../../utils/runtimeEventCompiler";
import { useICANPreviewStore } from "../../store/icanPreviewStore";

const near = (a, b, tol = 1e-9) => expect(Math.abs(a - b), `${a} vs ${b}`).toBeLessThanOrEqual(tol);
const level = (frame, id) => frame.fixtures[id].level;

describe("fades and curves", () => {
  const at = t => evaluateShowFrameAt(curves, t);
  it("shapes fade-in and fade-out with one implementation", () => {
    const expected = {
      0.5: { W1: 0.25, W2: 0.0625, W3: 0.4375, W4: 0.125, W5: 0 },
      1.0: { W1: 0.5, W2: 0.25, W3: 0.75, W4: 0.5, W5: 1 },
      6.5: { W1: 0.75, W2: 0.5625, W3: 0.9375, W4: 0.875, W5: 1 },
      7.5: { W1: 0.25, W2: 0.0625, W3: 0.4375, W4: 0.125, W5: 0 },
      4.0: { W1: 1, W2: 1, W3: 1, W4: 1, W5: 1 },
    };
    for (const [t, levels] of Object.entries(expected)) {
      const frame = at(Number(t));
      for (const [id, value] of Object.entries(levels)) near(level(frame, id), value);
    }
    expect(CURVES).toEqual(["linear", "ease-in", "ease-out", "ease-in-out", "step"]);
  });

  it("compiled event lists reproduce every curve (fade-in, hold, mirrored fade-out)", () => {
    const clips = curves.clips.filter(c => /^k[1-5]$/.test(c.id));
    const { compiled } = compileEvents({ timelineClips: clips, audioDuration: 8 });
    for (let t = 0; t < 8; t += 0.1) {
      if ([1, 7].some(edge => Math.abs(t - edge) < 1e-6)) continue; // step switches exactly at the ramp midpoint
      const events = evaluateAllChannels(compiled.events, t);
      const frame = at(t);
      for (const id of ["W1", "W2", "W3", "W4", "W5"]) near(events[id].intensity, level(frame, id), 1e-9);
    }
  });

  it("previews accept the supported curves and reject unknown ones", () => {
    const clip = { ...curves.clips[1], effects: [] };
    expect(() => createFullShowPreview([clip], curves.fixtures)).not.toThrow();
    expect(() => createFullShowPreview([{ ...clip, curveType: "bounce" }], curves.fixtures)).toThrow(/complex effects/);
    expect(showDiagnostics({ clips: [{ ...clip, curveType: "bounce" }] }).map(d => d.code)).toContain("unsupported-curve");
  });
});

describe("tempo map, sections and stop", () => {
  it("converts beats through tempo changes", () => {
    near(beatsToSeconds(curves.tempo, 8), 4);
    near(beatsToSeconds(curves.tempo, 16), 12);
    near(beatsToSeconds(curves.tempo, 4), 2);
    near(secondsToBeats(curves.tempo, 6), 10);
    for (const beat of [0, 3.5, 8, 11.25, 30]) near(secondsToBeats(curves.tempo, beatsToSeconds(curves.tempo, beat)), beat);
  });

  it("places beat-timed clips with the tempo map", () => {
    near(level(evaluateShowFrameAt(curves, 3.99), "W6"), 0);
    near(level(evaluateShowFrameAt(curves, 4.5), "W6"), 0.35);
    near(level(evaluateShowFrameAt(curves, 11.9), "W6"), 0.7);
    near(level(evaluateShowFrameAt(curves, 12), "W6"), 0);
  });

  it("plays and loops named sections", () => {
    const intro = evaluateShowFrameAt(curves, 5, { section: "intro" });
    expect(intro.state).toBe("ended");
    expect(Object.values(intro.fixtures).every(f => f.level === 0)).toBe(true);
    const looped = evaluateShowFrameAt(curves, 13, { section: "main", loop: true });
    expect(looped).toMatchObject({ state: "playing", passIndex: 2 });
    expect(frameHash(looped)).toBe(frameHash(evaluateShowFrameAt(curves, 5)));
    expect(evaluateShowFrameAt(curves, 3, { section: "main", loop: true }).showTimeMs).toBe(3000); // pre-roll does not wrap
  });

  it("stop turns every output off and returns the preview playhead to zero", () => {
    const stopped = evaluateShowFrame(golden, 4000, { stopped: true });
    expect(stopped.state).toBe("stopped");
    expect(Object.values(stopped.fixtures).every(f => f.level === 0)).toBe(true);
    expect(Object.values(stopped.valves).every(v => !v.open)).toBe(true);
    vi.spyOn(performance, "now").mockImplementation(() => 0);
    const store = useICANPreviewStore.getState();
    const visual = golden.clips.filter(c => c.fixtureId !== "V1");
    store.load(createFullShowPreview(visual, golden.fixtures), 1);
    store.seek(4);
    useICANPreviewStore.getState().stop();
    const s = useICANPreviewStore.getState();
    expect(s).toMatchObject({ position: 0, playback: "stopped" });
    expect(evaluateICANPreview(s.plan, s.position, golden.fixtures, true).lightsActive).toBe(0);
    vi.restoreAllMocks();
  });
});

describe("overlaps and mute/solo inheritance", () => {
  it("resolves overlaps highest-takes-precedence, ties to the later clip, and reports them", () => {
    const clips = [
      { id: "a", fixtureId: "F", type: "device_intensity", startTime: 0, duration: 4, value: 50, color: "#ff0000" },
      { id: "b", fixtureId: "F", type: "device_intensity", startTime: 1, duration: 4, value: 80, color: "#00ff00" },
      { id: "c", fixtureId: "F", type: "device_intensity", startTime: 2, duration: 1, value: 80, color: "#0000ff" },
    ];
    const frame = t => evaluateShowFrameAt({ clips }, t).fixtures.F;
    expect(frame(0.5)).toMatchObject({ level: 0.5, source: { clipId: "a" } });
    expect(frame(1.5)).toMatchObject({ level: 0.8, source: { clipId: "b" } });
    expect(frame(2.5)).toMatchObject({ level: 0.8, source: { clipId: "c" } });
    expect(frame(2.5).color.hex).toBe("#0000ff");
    expect(sampleClips(clips, 2.5).F).toEqual({ value: 0.8, color: "#0000ff" });
    expect(showDiagnostics({ clips }).filter(d => d.code === "overlap")).toHaveLength(3);
  });

  it("applies inherited mute and solo identically in the compiler and the evaluator", () => {
    const items = ["A", "B", "C"].map((id, i) => ({ id, label: id, x: i, y: 0, tracks: [{ id: `${id}-t`, type: "device_intensity" }] }));
    const recipe = (id, groupId) => ({ id, groupId, name: id, effect: "static", start: 0, duration: 4, cycles: 1, intensity: 100, spread: 1, color: "#ffffff", attribute: "level" });
    const base = { groups: [
      { id: "root", memberFixtureIds: ["A", "B", "C"] },
      { id: "left", parentId: "root", memberFixtureIds: ["A"] },
      { id: "right", parentId: "root", memberFixtureIds: ["B"] },
      { id: "other", memberFixtureIds: ["C"] },
    ], recipes: [recipe("rl", "left"), recipe("rr", "right"), recipe("ro", "other")], legacyClips: [] };
    const run = studio => {
      const { clips } = compileStudio(studio, items);
      const compiled = new Set(clips.map(c => c.fixtureId));
      // The evaluator re-applies the same rule when given every recipe's clips unfiltered.
      const all = compileStudio({ ...studio, groups: studio.groups.map(g => ({ ...g, muted: false, solo: false })) }, items).clips;
      const frame = evaluateShowFrameAt({ clips: all, groups: studio.groups, recipes: studio.recipes }, 1);
      const evaluated = new Set(Object.entries(frame.fixtures).filter(([, f]) => f.level > 0).map(([id]) => id));
      expect([...evaluated].sort()).toEqual([...compiled].sort());
      return [...compiled].sort();
    };
    expect(run(base)).toEqual(["A", "B", "C"]);
    expect(run({ ...base, groups: base.groups.map(g => g.id === "root" ? { ...g, muted: true } : g) })).toEqual(["C"]);
    expect(run({ ...base, groups: base.groups.map(g => g.id === "root" ? { ...g, solo: true } : g) })).toEqual(["A", "B"]);
    expect(run({ ...base, groups: base.groups.map(g => g.id === "left" ? { ...g, solo: true } : g) })).toEqual(["A"]);
    expect(run({ ...base, recipes: base.recipes.map(r => r.id === "rr" ? { ...r, muted: true } : r) })).toEqual(["A", "C"]);
  });
});

describe("pattern phase", () => {
  it("phase-shifts a wave across the ordered group and every view agrees", () => {
    const fixtures = [0, 1, 2, 3].map(i => ({ id: `J${i}`, type: "nozzle_jet", x: i, y: 0 }));
    const items = fixtures.map(f => ({ ...f, label: f.id, tracks: [{ id: `${f.id}-t`, type: "device_intensity" }] }));
    const studio = { groups: [{ id: "g", memberFixtureIds: ["J3", "J1", "J0", "J2"] }], legacyClips: [],
      recipes: [{ id: "w", groupId: "g", name: "Wave", effect: "wave", start: 0, duration: 8, cycles: 2, spread: 1, intensity: 80, color: "#65d9d0", attribute: "level", order: "left-to-right" }] };
    const { clips, issues } = compileStudio(studio, items);
    expect(issues).toEqual([]);
    const firstStart = id => Math.min(...clips.filter(c => c.fixtureId === id).map(c => c.startTime));
    expect([0, 1, 2, 3].map(i => firstStart(`J${i}`))).toEqual([...[0, 1, 2, 3].map(i => firstStart(`J${i}`))].sort((a, b) => a - b));
    expect(firstStart("J3")).toBeGreaterThan(firstStart("J0"));
    const plan = createICANPreviewPlan(createFullShowPreview(clips, fixtures), 1);
    const project = { fixtures, clips };
    for (let t = 0; t < 8; t += 0.137) {
      const frame = evaluateShowFrameAt(project, t);
      const timeline = sampleClips(clips, t);
      const preview = evaluateFullShowPreview(plan, t, fixtures);
      for (const f of fixtures) {
        near(timeline[f.id]?.value ?? 0, frame.fixtures[f.id].level);
        near(preview.fixtureIntensities[f.id], frame.fixtures[f.id].level, 1e-6);
      }
    }
  });
});

// ─── deterministic replay ───────────────────────────────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateLargeShow(seed = 20261013, seconds = 300) {
  const random = mulberry32(seed);
  const pick = list => list[Math.floor(random() * list.length)];
  const round = n => Math.round(n * 1000) / 1000;
  const fixtures = [
    ...Array.from({ length: 200 }, (_, i) => ({ id: `N${String(i).padStart(3, "0")}`, type: "nozzle_jet", x: i % 20, y: Math.floor(i / 20) })),
    ...Array.from({ length: 80 }, (_, i) => ({ id: `L${String(i).padStart(3, "0")}`, type: "light_rgb", x: i % 20, y: 12 })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `P${String(i).padStart(3, "0")}`, type: "pump", x: i, y: -2 })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `V${String(i).padStart(3, "0")}`, type: "valve_solenoid", x: i, y: -3 })),
  ];
  const clips = [];
  let n = 0;
  for (const fixture of fixtures) {
    const kind = fixture.type.startsWith("light") ? "light" : fixture.type === "pump" ? "pump" : fixture.type.startsWith("valve") ? "valve" : "water";
    let t = round(random() * 4);
    while (t < seconds - 1) {
      const duration = round(Math.min(seconds - t, 1 + random() * 11));
      const type = kind === "light" ? (fixture.id < "L020" && random() < 0.3 ? pick(["lighting_red", "lighting_green", "lighting_blue"]) : "lighting_master")
        : kind === "pump" ? "pump_speed" : kind === "valve" ? "solenoid_open" : "device_intensity";
      const fades = kind !== "valve";
      const fadeIn = fades ? round(random() * duration / 2) : 0, fadeOut = fades ? round(random() * duration / 2) : 0;
      clips.push({ id: `g${n++}`, fixtureId: fixture.id, trackId: `${fixture.id}-${type}`, type, startTime: t, duration,
        value: kind === "valve" ? 100 : Math.round(random() * 100), fadeIn, fadeOut,
        curveType: fades ? pick(CURVES) : "linear",
        color: `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, "0")}`, effects: [] });
      // ~6 % deliberate overlaps exercise the HTP policy.
      t = round(t + duration + (random() < 0.06 ? -duration / 2 : random() * 3));
    }
  }
  return { fixtures, clips, duration: seconds };
}

describe("deterministic replay — five minutes, 300 fixtures", () => {
  const show = generateLargeShow();
  it("is the size the acceptance names", () => {
    expect(show.fixtures).toHaveLength(300);
    expect(show.duration).toBe(300);
    expect(show.clips.length).toBeGreaterThan(5000);
  });

  it("produces identical frames for repeated random seeks (cached, fresh and reordered)", () => {
    const random = mulberry32(7);
    const times = Array.from({ length: 400 }, () => Math.floor(random() * 300000));
    const first = times.map(ms => frameHash(evaluateShowFrame(show, ms)));
    const again = [...times].reverse().map(ms => frameHash(evaluateShowFrame(show, ms))).reverse();
    const fresh = JSON.parse(JSON.stringify(show));
    const rebuilt = times.map(ms => frameHash(evaluateShowFrame(fresh, ms)));
    expect(again).toEqual(first);
    expect(rebuilt).toEqual(first);
    expect(new Set(first).size).toBeGreaterThan(300); // frames genuinely differ over time
  });

  it("timeline sampler and 3D preview agree with the canonical frame at random times", () => {
    const random = mulberry32(99);
    const visual = show.clips.filter(c => c.type !== "solenoid_open");
    const plan = createICANPreviewPlan(createFullShowPreview(visual, show.fixtures), 1);
    const visualProject = { fixtures: show.fixtures, clips: visual };
    for (let i = 0; i < 40; i++) {
      const t = random() * 299;
      const frame = evaluateShowFrameAt(show, t);
      const visualFrame = evaluateShowFrameAt(visualProject, t);
      const timeline = sampleClips(show.clips, t);
      const preview = evaluateFullShowPreview(plan, t, show.fixtures);
      for (const f of show.fixtures) {
        const record = frame.fixtures[f.id];
        const channels = Object.values(record.channels);
        near(timeline[f.id]?.value ?? 0, channels.length ? Math.max(...channels) : 0);
        if (record.kind === "water") near(preview.fixtureIntensities[f.id], record.level, 1e-9);
        if (record.kind === "light") {
          const view = preview.fixtureLightStates[f.id];
          const hex = [1, 3, 5].map(k => parseInt(view.color.slice(k, k + 2), 16));
          lightBytes(record).forEach((b, k) => expect(Math.abs(Math.round(hex[k] * view.intensity) - b)).toBeLessThanOrEqual(1));
          expect(lightViewState(visualFrame.fixtures[f.id])).toEqual(view);
        }
      }
      near(preview.pump, Math.max(0, ...Object.values(frame.pumps).map(p => p.speed)));
    }
  });
});

// ─── cross-language frame trace ─────────────────────────────────────────────

const TRACE = fileURLToPath(new URL("./golden/frame-trace.json", import.meta.url));
function buildTrace() {
  const projects = { golden: { fixtures: golden.fixtures, clips: golden.clips }, curves };
  const samples = [];
  const variants = { golden: [{}, { loop: { startMs: 0, endMs: 8000 } }, { blackout: true }], curves: [{}, { section: "main", loop: true }, { section: "intro" }] };
  for (const [name, project] of Object.entries(projects)) {
    for (const opts of variants[name]) {
      for (let ms = 0; ms <= 13000; ms += 250) {
        const frame = evaluateShowFrame(project, ms, opts);
        samples.push({ project: name, timeMs: ms, opts, state: frame.state, passIndex: frame.passIndex,
          levels: Object.fromEntries(Object.entries(frame.fixtures).map(([id, f]) => [id, f.level])),
          bytes: Object.fromEntries(Object.entries(frame.fixtures).filter(([, f]) => f.kind === "light").map(([id, f]) => [id, lightBytes(f)])),
          sources: Object.fromEntries(Object.entries(frame.fixtures).map(([id, f]) => [id, f.source?.clipId ?? null])),
          pumps: frame.pumps, valves: frame.valves });
      }
    }
  }
  return { contract: "aquaflow-frame-trace", version: 1, note: "Generated by showTiming.test.js (UPDATE_GOLDEN=1). Backend mirror must reproduce it.", samples };
}

describe("cross-language frame trace", () => {
  it("the JS evaluator reproduces frame-trace.json (regenerate with UPDATE_GOLDEN=1)", () => {
    const trace = buildTrace();
    if (process.env.UPDATE_GOLDEN === "1" || !existsSync(TRACE)) writeFileSync(TRACE, `${JSON.stringify(trace, null, 1)}\n`);
    const stored = JSON.parse(readFileSync(TRACE, "utf8"));
    expect(stored.samples.length).toBe(trace.samples.length);
    stored.samples.forEach((sample, i) => {
      const now = trace.samples[i];
      expect({ ...now, levels: undefined }).toEqual({ ...sample, levels: undefined });
      for (const [id, value] of Object.entries(sample.levels)) near(now.levels[id], value, 1e-12);
    });
  });
});
