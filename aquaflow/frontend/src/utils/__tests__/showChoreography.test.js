import { describe, expect, it } from "vitest";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { createSiteWaterTrack, compileSiteWaterShow } from "../siteShowCompiler";
import { getPatternBlocks, transformPatternBlock } from "../patternBlocks";
import { choreographyToBlocks, choreographyProjectSignature, validateMusicAnalysis } from "../showChoreography";

const fixtures = createICANSiteEngineeringProject().fixtures;
const tracks = fixtures.map(createSiteWaterTrack).filter(Boolean);
const state = (duration_ms, first = [], ninth = []) => ({ duration_ms, groups: { "1": first, "9": ninth, "2": [], "17": [], "25": [] } });
const convert = (steps, options = {}, fs = fixtures, ts = tracks) => choreographyToBlocks({ steps }, fs, ts, { duration: 60, ...options });
const analysis = { duration: 70, bpm: 120, beats: [0, 0.5, 1, 2, 30, 59.9, 60, 69], analysis_method: "pcm-wav" };

describe("editable prompt and music choreography", () => {
  it("round-trips valve changes, gaps, and a cropped terminal OFF without mutating the source", () => {
    const steps = [state(1000), state(2000, [9, 10]), state(500), state(2000, [10], [9]), state(1000)];
    const before = JSON.stringify(steps);
    const proposal = convert(steps, { duration: 6 });
    const compiled = compileSiteWaterShow(proposal.clips, fixtures);
    expect(compiled.steps).toEqual([state(1000), state(2000, [9, 10]), state(500), state(2000, [10], [9]), state(500)]);
    expect(proposal.duration).toBe(6);
    expect(JSON.stringify(steps)).toBe(before);
  });
  it("limits long music to the first minute and imports only excerpt beat markers", () => {
    const proposal = convert([state(60000, [9]), state(10000, [10])], { analysis });
    expect(compileSiteWaterShow(proposal.clips, fixtures).steps).toEqual([state(59900, [9]), state(100)]);
    expect(proposal.beatMarkers.map(b => b.time)).toEqual([0, 0.5, 1, 2, 30, 59.9]);
    expect(proposal.music).toBe(true);
  });
  it("closes early if excerpt trimming would produce a short valve state", () => {
    const proposal = convert([state(1000, [9]), state(1000, [10])], { duration: 1.15 });
    expect(compileSiteWaterShow(proposal.clips, fixtures).steps).toEqual([state(1000, [9]), state(150)]);
  });
  it("imports measured beat objects from the actual audio API without losing their time positions", () => {
    const result = { ...analysis, beats: [{ time: 1.4396, type: "beat", strength: 1 }, { time: 0.418, type: "downbeat", strength: 1 }, { time: 60 }] };
    const proposal = convert([state(60000, [9])], { analysis: result });
    expect(proposal.beatMarkers.map(b => b.time)).toEqual([0.418, 1.44]);
    expect(() => validateMusicAnalysis({ ...result, beats: [{ time: "1" }] })).toThrow(/invalid/);
  });
  it("keeps phrase lead-in and all-OFF phrases editable and independently movable", () => {
    const proposal = convert([...Array.from({ length: 8 }, () => state(100)), state(1000), state(1000, [9]), state(1000)], { duration: 3.8 });
    const blocks = getPatternBlocks(proposal.clips);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ startTime: 0, duration: 0.8 });
    expect(blocks[1]).toMatchObject({ startTime: 0.8, duration: 3 });
    const moved = transformPatternBlock(proposal.clips, blocks[1].id, { startTime: 5 });
    expect(getPatternBlocks(moved)[1]).toMatchObject({ startTime: 5, duration: 3 });
    expect(getPatternBlocks(moved)[1].members[0].startTime).toBe(6);
  });
  it("coalesces sustained ON runs inside each phrase and makes independent clip identities", () => {
    const steps = Array.from({ length: 16 }, () => state(1000, [9, 10]));
    const proposal = convert(steps, { duration: 16, startTime: 20 });
    expect(proposal.clips).toHaveLength(4);
    expect(getPatternBlocks(proposal.clips).map(b => b.startTime)).toEqual([20, 28]);
    expect(new Set([...proposal.clips, ...convert(steps).clips].map(c => c.id)).size).toBe(8);
    expect(compileSiteWaterShow(proposal.clips, fixtures).steps).toEqual([state(20000), state(15900, [9, 10]), state(100)]);
  });
  it("rejects pump commands, unmapped addresses, duplicate channels and malformed state timing", () => {
    expect(() => convert([{ ...state(1000, [9]), groups: { ...state(1000).groups, "17": [9] } }])).toThrow(/must remain OFF/);
    expect(() => convert([state(1000, [8])])).toThrow(/Malformed/);
    expect(() => convert([state(1000, [9, 9])])).toThrow(/Malformed/);
    expect(() => convert([state(50, [9])])).toThrow(/Malformed/);
    expect(() => convert([state(1000, [9])], {}, fixtures, [])).toThrow(/matching valve track/);
    const first = fixtures.find(f => f.engineering?.icanGroup === 1 && f.engineering?.icanChannel === 9);
    expect(() => convert([state(1000, [9])], {}, [...fixtures, { ...first, id: "alias" }])).toThrow(/Duplicate/);
  });
  it("refuses estimates, invalid beats, empty dances and shows beyond the site limits", () => {
    expect(() => validateMusicAnalysis({ ...analysis, analysis_method: "metadata-estimate" })).toThrow(/estimates only/);
    expect(() => validateMusicAnalysis({ ...analysis, beats: [-1] })).toThrow(/invalid/);
    expect(() => convert([state(1000)])).toThrow(/no ON/);
    expect(() => convert([state(1000, [9])], { startTime: 600 })).toThrow(/10 minutes/);
    expect(() => convert([state(1000, [9])], { duration: NaN })).toThrow(/10 minutes/);
  });
  it("detects changed engineering identities, addresses and tracks while accepting reordered lists", () => {
    const signature = choreographyProjectSignature(fixtures, tracks);
    expect(choreographyProjectSignature([...fixtures].reverse(), [...tracks].reverse())).toBe(signature);
    expect(choreographyProjectSignature(fixtures.map((f, i) => i ? f : { ...f, id: "changed" }), tracks)).not.toBe(signature);
    expect(choreographyProjectSignature(fixtures, tracks.map((t, i) => i ? t : { ...t, type: "pump_speed" }))).not.toBe(signature);
  });
});
