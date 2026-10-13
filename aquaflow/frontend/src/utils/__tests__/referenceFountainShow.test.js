import { describe, expect, it } from "vitest";
import { deserializeShow } from "../showFile";
import { deriveRuntimeSignals } from "../runtimeSignalSelector";
// AF-NEXT-001: build the artifact in memory from the generator's pure function.
// The test previously read <repo>/outputs/Reference_Keyhole_Crown_Fountain.aqua,
// which is gitignored and absent on a fresh checkout. JSON round-trip mirrors
// what the real file write/read did.
import { buildReferenceFountainShow } from "../../../../tools/generate_reference_fountain_show.mjs";

const loadArtifact = () => JSON.parse(JSON.stringify(buildReferenceFountainShow({ savedAt: "2026-10-13T00:00:00.000Z" })));

describe("reference keyhole crown fountain artifact", () => {
  it("loads through the real AquaFlow show deserializer", () => {
    const data = loadArtifact();
    const state = deserializeShow(data);
    const water = state.engineeringProject.fixtures.filter(fixture => fixture.type.startsWith("nozzle_"));

    expect(state.currentShow.name).toBe("Reference Keyhole Crown Fountain");
    expect(state.currentShow.loop).toBe(true);
    expect(state.timelineTracks).toHaveLength(7);
    expect(state.engineeringProject.pool_type).toBe("freeform");
    expect(state.engineeringProject.geometry.points).toHaveLength(17);
    expect(water).toHaveLength(61);
    expect(state.engineeringProject.site_models).toHaveLength(20);
  });

  it("drives five independent crowns while the hero jet remains active", () => {
    const data = loadArtifact();
    const state = deserializeShow(data);
    const snapshots = [3, 9, 15, 21, 27, 33].map(playhead => deriveRuntimeSignals({
      timelineTracks: state.timelineTracks,
      playhead,
      playbackState: "playing",
      mode: "timeline",
    }));

    for (const signal of snapshots) expect(signal.groups.center_jets).toBeCloseTo(1, 4);
    expect(snapshots[0].groups.arch_jets).toBeGreaterThan(snapshots[0].groups.motion_1d_jets);
    expect(snapshots[2].groups.cascade_jets).toBeCloseTo(1, 4);
    expect(snapshots[4].groups.motion_2d_jets).toBeGreaterThan(snapshots[4].groups.outer_ring_jets);
    expect(snapshots[5].groups.outer_ring_jets).toBeGreaterThan(0.9);
  });
});
