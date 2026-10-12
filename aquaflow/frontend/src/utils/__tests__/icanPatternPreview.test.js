import { afterEach, describe, expect, it, vi } from "vitest";
import { createICANPreviewPlan, evaluateICANPreview } from "../icanPatternPreview";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import { FountainScene } from "../../components/preview/FountainScene_v6";

const fixtures = createICANSiteEngineeringProject().fixtures;
const pattern = { name: "Alternating individual jets", steps: [
  { duration_ms: 1000, groups: { 1: [9], 17: [29] } },
  { duration_ms: 2000, groups: { 9: [40], 17: [29] } },
  { duration_ms: 1000, groups: {} },
] };
const plan = createICANPreviewPlan(pattern, 2);
afterEach(() => { useICANPreviewStore.getState().close(); vi.restoreAllMocks(); });

describe("I-CAN engineering preview", () => {
  it("selects only the addressed jet and preserves IDs across layout moves and reordering", () => {
    const moved = fixtures.map(f => ({ ...f, x: f.x + 20, y: f.y + 3 })).reverse();
    const state = evaluateICANPreview(plan, 0, moved);
    expect(state.fixtureIntensities["rf-01"]).toBe(1);
    expect(state.fixtureIntensities["rf-02"]).toBe(0);
    expect(state.active).toBe(1);
    expect(state.mapped).toBe(64);
    expect(state.unmapped).toBe(36);
    expect(evaluateICANPreview(plan, 1, fixtures).fixtureIntensities["rf-64"]).toBe(1);
  });
  it("replaces step states at exact boundaries, repeats and ends with all jets off", () => {
    expect(evaluateICANPreview(plan, 0.999, fixtures).stepIndex).toBe(0);
    const next = evaluateICANPreview(plan, 1, fixtures);
    expect(next.stepIndex).toBe(1);
    expect(next.fixtureIntensities["rf-01"]).toBe(0);
    expect(next.fixtureIntensities["rf-64"]).toBe(1);
    expect(evaluateICANPreview(plan, 3, fixtures).active).toBe(0);
    expect(evaluateICANPreview(plan, 4, fixtures)).toMatchObject({ passIndex: 2, stepIndex: 0, active: 1 });
    expect(evaluateICANPreview(plan, 8, fixtures)).toMatchObject({ ended: true, active: 0 });
    expect(evaluateICANPreview(plan, 0, fixtures, true).active).toBe(0);
  });
  it("keeps uncommissioned outlets and frequency commands off", () => {
    const protectedPlan = createICANPreviewPlan({ steps: [{ duration_ms: 1000,
      groups: { 1: [9], 2: [1, 2], 17: [29, 30], 25: [33] } }] });
    const state = evaluateICANPreview(protectedPlan, 0, fixtures);
    expect(state.fixtureIntensities["foam-left-01"]).toBe(0);
    expect(state.fixtureIntensities["peacock-01"]).toBe(0);
    expect(state.fixtureIntensities["rf-65"]).toBe(0);
    expect(state.protectedSelected).toBe(true);
    expect(state.flame).toBe(0);
  });
  it("snapshots the pattern and refuses invalid durations and repeat limits", () => {
    const draft = structuredClone(pattern);
    const snapshot = createICANPreviewPlan(draft);
    draft.steps[0].groups[1].push(10);
    expect(snapshot.steps[0].groups[1]).toEqual([9]);
    expect(() => createICANPreviewPlan({ steps: [] })).toThrow();
    expect(() => createICANPreviewPlan(pattern, 21)).toThrow();
    expect(() => createICANPreviewPlan({ steps: [{ duration_ms: 0 }] })).toThrow();
    expect(() => createICANPreviewPlan({ steps: Array(11).fill({ duration_ms: 60000 }) })).toThrow();
  });
  it("gives explicit OFF precedence over group values, decorative patterns and idle water", () => {
    const scene = Object.create(FountainScene.prototype);
    scene._signals = { pump: 1, groups: { running_fountain_jets: 1 }, fixtureIntensities: { "rf-01": 1, "rf-02": 0 } };
    const nozzle = id => ({ config: { id, groupId: "running_fountain_jets", type: "jet_1d" } });
    expect(scene._nozzleOutputIntensity(nozzle("rf-01"), 0, 0.1)).toBe(1);
    expect(scene._nozzleOutputIntensity(nozzle("rf-02"), 1, 0.1)).toBe(0);
    expect(scene._nozzleOutputIntensity(nozzle("rf-65"), 1, 0.1)).toBe(0);
    scene._signals = { groups: {} };
    expect(scene._nozzleOutputIntensity(nozzle("rf-02"), 0, 0.1)).toBe(0.1);
  });
  it("plays, pauses, seeks, completes and replays using only a local clock", () => {
    let timestamp = 0;
    vi.spyOn(performance, "now").mockImplementation(() => timestamp);
    const network = vi.spyOn(globalThis, "fetch").mockImplementation(() => { throw new Error("Preview must not use the network"); });
    const state = () => useICANPreviewStore.getState();
    state().load(pattern, 2);
    state().play();
    timestamp = 1250; state().tick();
    expect(state().position).toBe(1.25);
    state().pause(); timestamp = 5000; state().tick();
    expect(state().position).toBe(1.25);
    state().seek(4); state().play(); timestamp = 6000; state().tick();
    expect(state().position).toBe(5);
    state().stop(); expect(state()).toMatchObject({ position: 0, playback: "stopped", active: true });
    state().seek(7); state().play(); timestamp = 8000; state().tick();
    expect(state()).toMatchObject({ position: 8, playback: "complete" });
    state().play(); expect(state().position).toBe(0);
    state().close(); expect(state().active).toBe(false);
    expect(network).not.toHaveBeenCalled();
  });
});
