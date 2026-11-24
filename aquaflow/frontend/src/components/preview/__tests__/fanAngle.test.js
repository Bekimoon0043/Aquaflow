import { describe, expect, it } from "vitest";
import { evaluateShowFrameAt } from "../../../show/evaluateShowFrame";
import { createFullShowPreview, evaluateFullShowPreview } from "../../../utils/fullShowPreview";
import { createShowHistory } from "../studio/showHistory";
import { outletsOf } from "../../panels/easy/EasyScene";

const project = {
  fixtures: [{ id: "vario", type: "nozzle_fan_large", engineering: { jetHeightM: 9 } }],
  clips: [{ id: "width", fixtureId: "vario", type: "fan_angle", startTime: 0, duration: 4.4,
    keys: [0, 90, 0.5, 10, 1, 90] }],
};

describe("Vario fan-angle width control", () => {
  it("maps width percentages directly to fan degrees without the legacy 1D offset", () => {
    expect(evaluateShowFrameAt(project, 0.25).fixtures.vario.motion.fan).toBeCloseTo(50, 2);
    expect(evaluateShowFrameAt(project, 0.5).fixtures.vario.motion.fan).toBeCloseTo(10, 2);
    expect(evaluateShowFrameAt(project, 0.75).fixtures.vario.motion.fan).toBeCloseTo(50, 2);
  });

  it("interpolates the fan angle through Studio history", () => {
    const history = createShowHistory(project, { rate: 20 });
    expect(history.fan("vario", 0.25)).toBeCloseTo(50, 2);
    expect(history.fan("vario", 0.5)).toBeCloseTo(10, 2);
    expect(history.fan("vario", 0.75)).toBeCloseTo(50, 2);
  });

  it("narrows and widens the curtain outlets without changing their count", () => {
    const wide = outletsOf({ id: "vario", kind: "curtain" }, 0, 0, { fan: () => 90 });
    const thick = outletsOf({ id: "vario", kind: "curtain" }, 0, 0, { fan: () => 10 });
    expect(wide).toHaveLength(11);
    expect(thick).toHaveLength(11);
    expect(Math.max(...wide.map(out => out.th))).toBeCloseTo(0.75, 3);
    expect(Math.max(...thick.map(out => out.th))).toBeCloseTo(0.75 / 9, 3);
  });
});

describe("1D motion preview compatibility", () => {
  it("keeps normalized motion clips and preserves their exact degree mapping", () => {
    const fixtures = [{ id: "swing", type: "motion_nozzle_1d_tilt_motor", engineering: { angleRangeDeg: 120 } }];
    const clips = [{ id: "swing", fixtureId: "swing", type: "motion_angle", startTime: 0, duration: 2,
      value: 100, keys: [0, 0, 1, 50, 2, 100], motionOffset: -35, motionScale: 0.7 }];
    const plan = createFullShowPreview(clips, fixtures);
    expect(plan.skippedClips).toBe(0);
    expect(evaluateFullShowPreview(plan, 1, fixtures).showFrame.fixtures.swing.motion.pan).toBeCloseTo(0, 5);
    expect(evaluateFullShowPreview(plan, 1.5, fixtures).showFrame.fixtures.swing.motion.pan).toBeCloseTo(17.5, 5);
  });
});
