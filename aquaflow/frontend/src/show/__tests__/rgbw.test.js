import { describe, expect, it } from "vitest";
import { evaluateShowFrameAt, lightViewState } from "../evaluateShowFrame.js";

const project = {
  fixtures: [{ id: "l", type: "light_uw_rgbw_72w" }],
  clips: [
    { id: "master", fixtureId: "l", type: "lighting_master", startTime: 0, duration: 2, value: 50, color: "#0080ff" },
    { id: "white", fixtureId: "l", type: "lighting_white", startTime: 0, duration: 2, value: 60 },
  ],
};

describe("RGBW show frame", () => {
  it("keeps the white channel in the evaluated output", () => {
    const frame = evaluateShowFrameAt(project, 1);
    expect(frame.fixtures.l.level).toBe(0.5);
    expect(frame.fixtures.l.output.w).toBeCloseTo(0.3, 8);
    expect(frame.fixtures.l.output.b).toBe(0.5);
    expect(lightViewState(frame.fixtures.l).whiteIntensity).toBeCloseTo(0.3, 8);
  });

  it("turns on a white-only fixture using its default white colour", () => {
    const frame = evaluateShowFrameAt({ fixtures: project.fixtures, clips: [project.clips[1]] }, 1);
    expect(frame.fixtures.l.output.w).toBeCloseTo(0.6, 8);
    expect(frame.fixtures.l.output.r).toBe(1);
    expect(lightViewState(frame.fixtures.l).color).toBe("#ffffff");
  });

  it("keeps the legacy output shape when no white clip exists", () => {
    const frame = evaluateShowFrameAt({ fixtures: project.fixtures, clips: [project.clips[0]] }, 1);
    expect(frame.fixtures.l.output).not.toHaveProperty("w");
    expect(lightViewState(frame.fixtures.l)).not.toHaveProperty("whiteIntensity");
  });
});
