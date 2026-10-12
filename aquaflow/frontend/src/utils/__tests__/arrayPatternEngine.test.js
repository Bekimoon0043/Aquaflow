import { describe, expect, it } from "vitest";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { generateAutoTracks } from "../../runtime/autoTrackGenerator";
import { createDryRunPreviewSession } from "../dryRunPreview";
import {
  buildPatternStages,
  createArrayPatternPlan,
  getArrayTargetFixtures,
  parseCustomArray,
} from "../arrayPatternEngine";

const project = createICANSiteEngineeringProject();
const tracks = generateAutoTracks({ fixtures: project.fixtures }).tracks;

describe("arrayPatternEngine", () => {
  it("selects the confirmed site water groups", () => {
    expect(getArrayTargetFixtures(project.fixtures, "running")).toHaveLength(76);
    expect(getArrayTargetFixtures(project.fixtures, "foam_left")).toHaveLength(8);
    expect(getArrayTargetFixtures(project.fixtures, "foam_right")).toHaveLength(8);
    expect(getArrayTargetFixtures(project.fixtures, "peacock")).toHaveLength(8);
    expect(getArrayTargetFixtures(project.fixtures, "all_water")).toHaveLength(100);
  });

  it("uses the 19 physical running sections as pattern stages", () => {
    const running = getArrayTargetFixtures(project.fixtures, "running");
    const stages = buildPatternStages("section_chase", running);
    expect(stages).toHaveLength(19);
    expect(stages.every((stage) => stage.length === 4)).toBe(true);
  });

  it("supports custom array ranges and named selectors", () => {
    expect(parseCustomArray("1-4 | 8,10 | odd | even | center | edges | all", 10)).toEqual([
      [0, 1, 2, 3],
      [7, 9],
      [0, 2, 4, 6, 8],
      [1, 3, 5, 7, 9],
      [4, 5],
      [0, 9],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    ]);
  });

  it("builds a complete repeatable section chase", () => {
    const plan = createArrayPatternPlan({
      fixtures: project.fixtures,
      tracks,
      target: "running",
      patternId: "section_chase",
      startTime: 10,
      stepDuration: 0.5,
      pulseDuration: 0.4,
      repeats: 2,
      repeatGap: 1,
      intensity: 75,
    });
    expect(plan.stages).toHaveLength(19);
    expect(plan.clips).toHaveLength(76 * 2);
    expect(plan.missingTrackFixtureIds).toEqual([]);
    expect(plan.clips[0]).toMatchObject({ startTime: 10, duration: 0.4, value: 75, source: "array-pattern" });
    expect(plan.clips[76].startTime).toBe(20.5);
  });

  it("creates paired center-out stages for even fixture counts", () => {
    const foam = getArrayTargetFixtures(project.fixtures, "foam_all");
    const stages = buildPatternStages("center_out", foam);
    expect(stages).toHaveLength(8);
    expect(stages[0]).toEqual([7, 8]);
    expect(stages.at(-1)).toEqual([0, 15]);
  });

  it("compiles generated array clips into the safe 3D dry-run pipeline", async () => {
    const plan = createArrayPatternPlan({
      fixtures: project.fixtures,
      tracks,
      target: "running",
      patternId: "section_chase",
      stepDuration: 0.5,
      pulseDuration: 0.4,
    });
    const deviceRegistry = Object.fromEntries(tracks.map((track) => [track.fixtureId, {
      deviceId: track.fixtureId,
      deviceType: track.type.split("_")[0],
      protocol: "relay",
      latencyMs: 0,
    }]));
    const session = await createDryRunPreviewSession({
      timelineClips: plan.clips,
      deviceRegistry,
      audioDuration: 12,
      bpm: 120,
    });
    expect(session.success).toBe(true);
    expect(session.eventCount).toBeGreaterThanOrEqual(plan.clips.length);
    expect(session.getDeviceIds()).toHaveLength(76);
    session.cleanup();
  });
});
