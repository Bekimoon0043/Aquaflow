import { describe, expect, it } from "vitest";
import { buildSimulationTracks } from "../simulationTimeline";

describe("simulation timeline lanes", () => {
  it("turns I-CAN steps and repeats into a continuous read-only lane", () => {
    const tracks = buildSimulationTracks({
      repeat: 2,
      steps: [{ duration: 500, groups: {} }, { duration: 1000, groups: {} }],
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0].clips).toHaveLength(4);
    expect(tracks[0].clips.map(clip => [clip.start, clip.end])).toEqual([
      [0, 0.5], [0.5, 1.5], [1.5, 2], [2, 3],
    ]);
  });

  it("groups full-show clips into clear signal lanes", () => {
    const tracks = buildSimulationTracks({
      visualClips: [
        { fixtureId: "jet-1", type: "device_intensity", start: 0, end: 2, value: 80 },
        { fixtureId: "light-1", type: "lighting_master", start: 1, end: 3, value: 60 },
        { fixtureId: "jet-2", type: "device_intensity", start: 2, end: 4, value: 100 },
      ],
    });

    expect(tracks.map(track => track.label)).toEqual(["device intensity", "lighting master"]);
    expect(tracks[0].clips).toHaveLength(2);
    expect(tracks[1].clips[0]).toMatchObject({ start: 1, end: 3, intensity: 60 });
  });

  it("combines design-only water clips into one readable lane", () => {
    const tracks = buildSimulationTracks({
      designClips: [
        { fixtureId: "outlet_a", start: 0, end: 1, value: 100 },
        { fixtureId: "outlet_b", start: 1, end: 2, value: 50 },
      ],
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0].label).toBe("water-outlets");
    expect(tracks[0].clips.map(clip => clip.label)).toEqual(["outlet a", "outlet b"]);
  });
});
