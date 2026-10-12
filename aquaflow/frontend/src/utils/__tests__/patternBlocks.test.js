import { describe, it, expect } from "vitest";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { createArrayPatternPlan } from "../arrayPatternEngine";
import { createSiteWaterTrack, compileSiteWaterShow } from "../siteShowCompiler";
import { createICANPreviewPlan, evaluateICANPreview } from "../icanPatternPreview";
import { createPatternBlock, getPatternBlocks, transformPatternBlock, repeatPatternBlock, duplicatePatternBlock,
  deletePatternBlock, unpackPatternBlock, editPatternClip, standaloneClip, filterPatternClips, regeneratePatternBlock } from "../patternBlocks";
const fixtures = createICANSiteEngineeringProject().fixtures;
const tracks = fixtures.map(createSiteWaterTrack).filter(Boolean);
const make = (options = {}) => createArrayPatternPlan({ fixtures, tracks, target: "mapped_running", patternId: "block_chase",
  blockSize: 8, stepDuration: 0.5, pulseDuration: 0.4, repeats: 15, intensity: 100, valveMode: true, ...options });
const group = (options, id = "dance") => createPatternBlock(make(options), { id, name: id });
const live = (clips, time) => evaluateICANPreview(createICANPreviewPlan(compileSiteWaterShow(clips, fixtures)), time, fixtures);
describe("whole-show pattern blocks", () => {
  it("groups a 60-second, 960-clip dance and stores one recipe anchor", () => {
    const clips = group();
    expect(getPatternBlocks(clips)[0]).toMatchObject({ id: "dance", duration: 60, clipCount: 960, outletCount: 64 });
    expect(clips.filter(c => c.patternBlockDefinition)).toHaveLength(1);
    expect(compileSiteWaterShow(clips, fixtures).steps.reduce((n, s) => n + s.duration_ms, 0)).toBe(60000);
  });
  it("moves all members and trailing OFF together without changing another block", () => {
    const original = [...group({ repeats: 1 }), ...group({ repeats: 1, startTime: 20 }, "other")];
    const before = JSON.stringify(original);
    const moved = transformPatternBlock(original, "dance", { startTime: 5 });
    const block = getPatternBlocks(moved).find(b => b.id === "dance");
    expect(block).toMatchObject({ startTime: 5, duration: 4, endTime: 9 });
    expect(block.members[0].startTime).toBe(5);
    expect(block.members.every(c => c.arrayPattern.sequenceEndTime === 9)).toBe(true);
    expect(moved.filter(c => c.patternBlockId === "other")).toEqual(original.filter(c => c.patternBlockId === "other"));
    expect(JSON.stringify(original)).toBe(before);
    expect(live(moved, 4.99).active).toBe(0);
    expect(live(moved, 5).active).toBe(8);
    expect(live(moved, 5.4).active).toBe(0);
  });
  it("stretches pulses, effects, gaps and recipes proportionally", () => {
    const clips = group({ repeats: 1, valveMode: false, intensity: 80 });
    const changed = transformPatternBlock(clips, "dance", { duration: 8 });
    const b = getPatternBlocks(changed)[0];
    expect(b.recipe).toMatchObject({ stepDuration: 1, pulseDuration: 0.8 });
    expect(b.members[0]).toMatchObject({ duration: 0.8, fadeIn: 0.2, fadeOut: 0.2, effects: [{ duration: 0.8 }] });
    expect(b.members[8].startTime).toBe(1);
  });
  it("changes array cycles after moving and resizing without changing unrelated clips", () => {
    const base = transformPatternBlock(group({ repeats: 1 }), "dance", { startTime: 3, duration: 8 });
    const manual = { ...base[0], id: "manual", patternBlockId: null, source: "manual", patternBlockDefinition: undefined };
    const changed = repeatPatternBlock([...base, manual], "dance", 3, fixtures, tracks);
    expect(getPatternBlocks(changed)[0]).toMatchObject({ startTime: 3, duration: 24, clipCount: 192 });
    expect(changed.find(c => c.id === "manual")).toEqual(manual);
  });
  it("duplicates with independent identities, shifts recipes and preserves OFF gaps", () => {
    const original = group({ repeats: 1 });
    const result = duplicatePatternBlock(original, "dance");
    expect(result.id).not.toBe("dance");
    const blocks = getPatternBlocks(result.clips);
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({ startTime: 4, duration: 4, recipe: { startTime: 4 } });
    expect(new Set(result.clips.map(c => c.id)).size).toBe(128);
    expect(live(result.clips, 3.95).active).toBe(0);
    expect(live(result.clips, 4).active).toBe(8);
  });
  it("survives JSON save/export/reload with identical compiled valve states", () => {
    const clips = transformPatternBlock(group(), "dance", { startTime: 2, name: "Opening" });
    const restored = JSON.parse(JSON.stringify({ timelineClips: clips })).timelineClips;
    expect(getPatternBlocks(restored)[0]).toMatchObject({ name: "Opening", startTime: 2, duration: 60, recipe: { repeats: 15 } });
    expect(compileSiteWaterShow(restored, fixtures).steps).toEqual(compileSiteWaterShow(clips, fixtures).steps);
  });
  it("preserves individual edits and migrates the anchor when its clip is deleted", () => {
    const clips = group({ repeats: 1 });
    const changed = editPatternClip(clips, clips[1].id, { value: 0, duration: 0.2 });
    expect(getPatternBlocks(changed)[0]).toMatchObject({ customized: true, recipe: null });
    expect(changed.find(c => c.id === clips[1].id).effects[0]).toMatchObject({ duration: 0.2, params: { value: 0 } });
    expect(() => repeatPatternBlock(changed, "dance", 3, fixtures, tracks)).toThrow(/individual edits/);
    const removed = editPatternClip(changed, clips[0].id, {}, true);
    expect(getPatternBlocks(removed)[0].clipCount).toBe(63);
    expect(removed.filter(c => c.patternBlockDefinition)).toHaveLength(1);
    const duplicate = duplicatePatternBlock(removed, "dance");
    expect(getPatternBlocks(duplicate.clips)[1]).toMatchObject({ clipCount: 63, customized: true });
  });
  it("replaces a movement while keeping its name and unrelated block intact", () => {
    const original = [...group({ repeats: 1 }), ...group({ repeats: 1, startTime: 20 }, "other")];
    const recipe = { ...getPatternBlocks(original)[0].recipe, patternId: "odd_even", repeats: 2 };
    const updated = regeneratePatternBlock(original, "dance", recipe, fixtures, tracks);
    expect(getPatternBlocks(updated)[0]).toMatchObject({ id: "dance", name: "dance", clipCount: 128, duration: 2 });
    expect(updated.filter(c => c.patternBlockId === "other")).toEqual(original.filter(c => c.patternBlockId === "other"));
  });
  it("blocks missing outlets, excessive cycles, oversized shows and invalid timing", () => {
    const clips = group();
    expect(() => repeatPatternBlock(clips, "dance", 1.5, fixtures, tracks)).toThrow(/whole number/);
    expect(() => repeatPatternBlock(clips, "dance", 100, fixtures.filter(f => f.id !== clips[0].fixtureId), tracks)).toThrow(/missing/);
    expect(() => transformPatternBlock(clips, "dance", { duration: 0 })).toThrow(/Duration/);
    expect(() => transformPatternBlock(clips, "dance", { startTime: 590 })).toThrow(/10 minutes/);
    expect(() => repeatPatternBlock(transformPatternBlock(clips, "dance", { startTime: 300 }), "dance", 100, fixtures, tracks)).toThrow(/10 minutes/);
    expect(() => transformPatternBlock(clips, "dance", { duration: 0.1 })).toThrow(/0.05/);
  });
  it("groups legacy arrays without changing physical states, then allows timing and duplication", () => {
    const clips = make({ repeats: 1 }).clips;
    const b = getPatternBlocks(clips)[0];
    expect(b).toMatchObject({ duration: 4, clipCount: 64, recipe: null });
    const moved = transformPatternBlock(clips, b.id, { startTime: 3 });
    expect(live(moved, 3).active).toBe(8);
    expect(getPatternBlocks(duplicatePatternBlock(moved, b.id).clips)).toHaveLength(2);
  });
  it("marks partially replaced blocks custom to avoid restoring deleted outlets", () => {
    const clips = group({ repeats: 1 });
    const retained = filterPatternClips(clips, c => c.fixtureId !== clips[0].fixtureId);
    expect(getPatternBlocks(retained)[0]).toMatchObject({ recipe: null, customized: true, outletCount: 63 });
    expect(() => repeatPatternBlock(retained, "dance", 2, fixtures, tracks)).toThrow(/individual edits/);
  });
  it("ungroups and copies individual clips without inheriting block identities", () => {
    const clips = group({ repeats: 1 });
    expect(getPatternBlocks(unpackPatternBlock(clips, "dance"))).toEqual([]);
    const standalone = standaloneClip(clips[0], 12);
    expect(standalone.patternBlockDefinition).toBeUndefined();
    expect(standalone.arrayPattern).toBeUndefined();
    expect(getPatternBlocks([standalone])).toEqual([]);
    expect(deletePatternBlock(clips, "dance")).toEqual([]);
  });
});
