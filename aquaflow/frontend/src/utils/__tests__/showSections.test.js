import { describe, it, expect } from "vitest";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { createArrayPatternPlan, getArrayTargetFixtures } from "../arrayPatternEngine";
import { createSiteWaterTrack, compileSiteWaterShow, createDesignShowPreview } from "../siteShowCompiler";
import { createICANPreviewPlan, evaluateICANPreview } from "../icanPatternPreview";
import { createPatternBlock, getPatternBlocks, editPatternClip } from "../patternBlocks";
import { arrangeShowBlocks, saveShowSection, insertShowSection, validateShowSection, readSectionLibrary } from "../showSections";

const fixtures = createICANSiteEngineeringProject().fixtures;
const tracks = fixtures.map(createSiteWaterTrack).filter(Boolean);
const mapped = getArrayTargetFixtures(fixtures, "mapped_running");
const odd = mapped.filter((_, i) => i % 2 === 0).map(f => f.id);
const even = mapped.filter((_, i) => i % 2 === 1).map(f => f.id);
const make = (id, options = {}) => createPatternBlock(createArrayPatternPlan({ fixtures, tracks, target: "mapped_running",
  patternId: "all_pulse", stepDuration: 1, pulseDuration: 0.4, repeats: 1, valveMode: true, ...options }), { id, name: id });
const active = (clips, time) => evaluateICANPreview(createICANPreviewPlan(compileSiteWaterShow(clips, fixtures)), time, fixtures).active;
const source = () => [...make("left", { startTime: 5, selectedFixtureIds: odd }), ...make("right", { startTime: 8, selectedFixtureIds: even })];

describe("layered reusable show sections", () => {
  it("gives every block independent clip identities when the same generated plan is reused", () => {
    const plan = createArrayPatternPlan({ fixtures, tracks, target: "mapped_running", patternId: "all_pulse", valveMode: true, stepDuration: 1, pulseDuration: 0.4 });
    const original = structuredClone(plan);
    const clips = [...createPatternBlock(plan, { id: "one" }), ...createPatternBlock(plan, { id: "two" })];
    expect(new Set(clips.map(c => c.id)).size).toBe(128);
    expect(saveShowSection(clips, ["one", "two"], "Reused source").clips).toHaveLength(128);
    expect(plan).toEqual(original);
  });
  it("sequences selected blocks with explicit gaps while preserving unrelated clips", () => {
    const other = make("other", { startTime: 30 });
    const clips = [...source(), ...other], original = structuredClone(clips);
    const result = arrangeShowBlocks(clips, ["right", "left"], { mode: "sequence", startTime: 2, gap: 0.5 });
    expect(getPatternBlocks(result).map(b => [b.id, b.startTime])).toEqual([["left", 2], ["right", 3.5], ["other", 30]]);
    expect(result.filter(c => c.patternBlockId === "other")).toEqual(other);
    expect(active(result, 3)).toBe(0);
    expect(active(result, 3.5)).toBe(32);
    expect(clips).toEqual(original);
  });
  it("layers separate outlet selections and combines their exact ON states", () => {
    const result = arrangeShowBlocks(source(), ["left", "right"], { mode: "layer", startTime: 2 });
    expect(getPatternBlocks(result).every(b => b.startTime === 2)).toBe(true);
    expect(active(result, 2)).toBe(64);
    expect(active(result, 2.4)).toBe(0);
    const pattern = compileSiteWaterShow(result, fixtures);
    expect(pattern.steps.every(s => !s.groups["2"].length && !s.groups["25"].length && !s.groups["17"].length)).toBe(true);
  });
  it("moves a selection together without changing internal offsets or pulse lengths", () => {
    const result = arrangeShowBlocks(source(), ["left", "right"], { mode: "move", startTime: 1 });
    expect(getPatternBlocks(result).map(b => b.startTime)).toEqual([1, 4]);
    expect(result.every(c => c.duration === 0.4)).toBe(true);
  });
  it("saves relative timings and restores layered blocks through JSON with independent identities", () => {
    const clips = arrangeShowBlocks(source(), ["left", "right"], { mode: "layer", startTime: 3 });
    const before = JSON.stringify(clips);
    const section = saveShowSection(clips, ["left", "right"], "Opening duet");
    expect(section.duration).toBe(1);
    expect(getPatternBlocks(section.clips).every(b => b.startTime === 0)).toBe(true);
    const result = insertShowSection(clips, JSON.parse(JSON.stringify(section)), fixtures, tracks, { startTime: 6 });
    expect(new Set(result.clips.map(c => c.id)).size).toBe(128);
    expect(result.ids).toHaveLength(2);
    expect(result.ids.every(id => !["left", "right"].includes(id))).toBe(true);
    expect(active(result.clips, 6)).toBe(64);
    expect(JSON.stringify(clips)).toBe(before);
  });
  it("repeats entire sections with their internal offsets, gaps and final OFF intact", () => {
    const section = saveShowSection(source(), ["left", "right"], "Offset duet");
    expect(section.duration).toBe(4);
    const result = insertShowSection([], section, fixtures, tracks, { startTime: 2, repeats: 2, gap: 1 });
    expect(result.endTime).toBe(11);
    expect(getPatternBlocks(result.clips).map(b => b.startTime)).toEqual([2, 5, 7, 10]);
    expect(active(result.clips, 6.99)).toBe(0);
    expect(active(result.clips, 7)).toBe(32);
    expect(compileSiteWaterShow(result.clips, fixtures).steps.at(-1).groups).toEqual({ "1": [], "2": [], "9": [], "17": [], "25": [] });
  });
  it("preserves individual jet edits and their disabled regeneration state", () => {
    const initial = make("dance");
    const clips = editPatternClip(initial, initial[0].id, { value: 0 });
    const section = saveShowSection(clips, ["dance"], "Edited dance");
    const result = insertShowSection([], section, fixtures, tracks, { repeats: 2 });
    expect(getPatternBlocks(result.clips).every(b => b.customized && b.recipe === null)).toBe(true);
    expect(active(result.clips, 0)).toBe(63);
    expect(active(result.clips, 1)).toBe(63);
  });
  it("retains explicit trailing OFF stages in custom section repetition", () => {
    const clips = make("off-dance", { patternId: "custom", customProgram: "all | off | off", stepDuration: 0.5 });
    const section = saveShowSection(clips, ["off-dance"], "Long rest");
    expect(section.duration).toBe(1.5);
    const result = insertShowSection([], section, fixtures, tracks, { repeats: 2, gap: 0.5 });
    expect(active(result.clips, 1.99)).toBe(0);
    expect(active(result.clips, 2)).toBe(64);
    expect(result.endTime).toBe(3.5);
  });
  it("previews uncommissioned layered zones but keeps their hardware conversion blocked", () => {
    const clips = [...make("foam", { target: "foam_left" }), ...make("peacock", { target: "peacock" })];
    const section = saveShowSection(clips, ["foam", "peacock"], "Design duet");
    const result = insertShowSection([], section, fixtures, tracks, { startTime: 2 });
    const state = evaluateICANPreview(createICANPreviewPlan(createDesignShowPreview(result.clips, fixtures)), 2, fixtures);
    expect(state.active).toBe(16);
    expect(() => compileSiteWaterShow(result.clips, fixtures)).toThrow(/no capture-derived/);
  });
  it("refuses missing outlets and track types rather than silently remapping a section", () => {
    const section = saveShowSection(source(), ["left"], "Linked section");
    expect(() => insertShowSection([], section, fixtures.filter(f => f.id !== odd[0]), tracks)).toThrow(/engineering project/);
    expect(() => insertShowSection([], section, fixtures, tracks.filter(t => t.fixtureId !== odd[0]))).toThrow(/engineering project/);
    expect(() => insertShowSection([], section, fixtures, tracks.map(t => ({ ...t, type: "device_intensity" })))).toThrow(/engineering project/);
  });
  it("rejects invalid selection, timing, cycles and excessive clip counts atomically", () => {
    const clips = source(), before = structuredClone(clips);
    expect(() => arrangeShowBlocks(clips, [], {})).toThrow(/Select at least/);
    expect(() => arrangeShowBlocks(clips, ["missing"], {})).toThrow(/Select at least/);
    expect(() => arrangeShowBlocks(clips, ["left", "missing"], {})).toThrow(/no longer exist/);
    expect(() => arrangeShowBlocks(clips, ["left", "right"], { startTime: 599.5 })).toThrow(/10 minutes/);
    expect(() => arrangeShowBlocks(clips, ["left"], { gap: -1 })).toThrow(/gap/);
    const section = saveShowSection(clips, ["left", "right"], "Limits");
    expect(() => insertShowSection([], section, fixtures, tracks, { repeats: 1.5 })).toThrow(/whole number/);
    expect(() => insertShowSection([], section, fixtures, tracks, { startTime: 599 })).toThrow(/10 minutes/);
    expect(() => insertShowSection(Array(20000).fill(clips[0]), section, fixtures, tracks)).toThrow(/20,000/);
    expect(clips).toEqual(before);
  });
  it("rejects corrupt imported definitions, duplicate clip IDs, invalid recipes and unknown formats", () => {
    const section = saveShowSection(source(), ["left", "right"], "Valid");
    expect(() => validateShowSection({ ...section, version: 2 })).toThrow(/not an AquaFlow/);
    expect(() => validateShowSection({ ...section, duration: 3 })).toThrow(/duration/);
    expect(() => validateShowSection({ ...section, clips: [...section.clips, section.clips[0]] })).toThrow(/duplicate/);
    const broken = structuredClone(section);
    broken.clips.find(c => c.patternBlockDefinition).patternBlockDefinition.recipe.stepDuration = null;
    expect(() => validateShowSection(broken)).toThrow(/recipe/);
    expect(() => validateShowSection({ ...section, clips: section.clips.map(c => ({ ...c, patternBlockDefinition: undefined })) })).toThrow(/definition/);
  });
  it("restores a valid library and rejects duplicate identities or names", () => {
    const section = saveShowSection(source(), ["left", "right"], "Saved");
    expect(readSectionLibrary(JSON.stringify([section]))).toEqual([section]);
    expect(readSectionLibrary(null)).toEqual([]);
    expect(() => readSectionLibrary(JSON.stringify([section, section]))).toThrow(/duplicate identities/);
    expect(() => readSectionLibrary(JSON.stringify([section, { ...section, id: "another" }]))).toThrow(/duplicate names/);
  });
});
