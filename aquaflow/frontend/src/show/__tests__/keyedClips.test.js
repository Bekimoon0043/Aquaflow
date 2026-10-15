import { describe, expect, it } from "vitest";
import { evaluateShowFrameAt, expandKeyedClips, parseKeys, keyedValue } from "../evaluateShowFrame.js";
import { createFullShowPreview, evaluateFullShowPreview } from "../../utils/fullShowPreview.js";

const jet = { id: "jet-1", type: "nozzle_straight_dn25" };
const keyed = (extra = {}) => ({ id: "k", fixtureId: "jet-1", type: "device_intensity", startTime: 10, duration: 4,
  value: 80, keys: [0, 20, 1, 80, 3, 40], ...extra });
const level = (clips, t) => evaluateShowFrameAt({ fixtures: [jet], clips }, t).fixtures["jet-1"].channels.device_intensity ?? 0;

describe("keyed clips", () => {
  it("interpolates linearly between keys and holds before the first / after the last", () => {
    expect(level([keyed()], 10)).toBeCloseTo(0.2, 6);
    expect(level([keyed()], 10.5)).toBeCloseTo(0.5, 6);
    expect(level([keyed()], 12)).toBeCloseTo(0.6, 6);
    expect(level([keyed()], 13.5)).toBeCloseTo(0.4, 6);
    expect(level([keyed()], 14)).toBe(0); // half-open window
  });

  it("holds each key in step mode", () => {
    expect(level([keyed({ keyMode: "step" })], 10.9)).toBeCloseTo(0.2, 6);
    expect(level([keyed({ keyMode: "step" })], 11)).toBeCloseTo(0.8, 6);
  });

  it("applies fades on top of the curve", () => {
    expect(level([keyed({ fadeIn: 1 })], 10.5)).toBeCloseTo(0.25, 6);
  });

  it("falls back to the constant value with a diagnostic when keys are invalid", () => {
    const project = { fixtures: [jet], clips: [keyed({ keys: [0, 20, 0, 30] })] };
    const frame = evaluateShowFrameAt(project, 11);
    expect(frame.fixtures["jet-1"].channels.device_intensity).toBeCloseTo(0.8, 6);
    expect(parseKeys([0, 20, 0, 30])).toBeNull();
    expect(parseKeys([0, 120])).toBeNull();
    expect(parseKeys([0, 20, 1])).toBeNull();
    expect(parseKeys([true, 20])).toBeNull();
    expect(parseKeys([])).toBeNull();
  });

  it("binary search matches a linear scan on a long curve", () => {
    const keys = []; for (let i = 0; i <= 400; i++) keys.push(i * 0.25, 50 + 40 * Math.sin(i / 7));
    const curve = parseKeys(keys);
    for (const u of [0.1, 13.37, 50, 99.9]) {
      const i = Math.floor(u / 0.25), a = keys[2 * i + 1], b = keys[2 * i + 3];
      expect(keyedValue(curve, u)).toBeCloseTo(a + (b - a) * (u - i * 0.25) / 0.25, 9);
    }
  });

  it("expands to contiguous constant clips that sample the curve", () => {
    const out = expandKeyedClips([keyed(), { id: "plain", fixtureId: "jet-1", type: "lighting_master", startTime: 0, duration: 2, value: 10 }]);
    const parts = out.filter(c => c.id.startsWith("k~"));
    expect(out.some(c => c.id === "plain")).toBe(true);
    expect(parts.every(c => c.keys === undefined)).toBe(true);
    expect(parts[0].startTime).toBe(10);
    for (let i = 1; i < parts.length; i++) expect(parts[i].startTime).toBeCloseTo(parts[i - 1].startTime + parts[i - 1].duration, 6);
    expect(parts.at(-1).startTime + parts.at(-1).duration).toBeCloseTo(14, 6);
    for (const p of parts) expect(p.value / 100).toBeCloseTo(level([keyed()], p.startTime + p.duration / 2), 3);
    const steps = expandKeyedClips([keyed({ keyMode: "step" })]);
    expect(steps.map(c => [c.startTime, c.duration, c.value])).toEqual([[10, 1, 20], [11, 2, 80], [13, 1, 40]]);
  });

  it("accepts VFD pump channels and skips solenoid channels in the 3D preview", () => {
    const pump = { id: "p1", type: "pump_inline_vfd_pump_4_0kw" }, valve = { id: "v1", type: "valve_solenoid_dn25_24v" };
    const plan = createFullShowPreview([keyed(),
      { id: "ps", fixtureId: "p1", type: "pump_speed", startTime: 0, duration: 20, value: 60 },
      { id: "vo", fixtureId: "v1", type: "solenoid_open", startTime: 0, duration: 20, value: 100 }], [jet, pump, valve], "s", { skipUnsupported: true });
    expect(plan.visualClips.map(c => c.id)).toEqual(["k", "ps"]);
    expect(plan.skippedClips).toBe(1);
    expect(createFullShowPreview([keyed(), { id: "x", fixtureId: "p1", type: "lighting_red", startTime: 0, duration: 1, value: 1 }],
      [jet, pump], "s", { skipUnsupported: true }).skippedClips).toBe(1);
  });

  it("passes the curve through the full 3D show preview", () => {
    const plan = createFullShowPreview([keyed()], [jet]);
    plan.duration = 14; plan.passMs = 14000;
    const at = t => evaluateFullShowPreview(plan, t, [jet]).fixtureIntensities?.["jet-1"];
    expect(at(10.5)).toBeCloseTo(at(13.5) + 0.1, 3);
  });
});
