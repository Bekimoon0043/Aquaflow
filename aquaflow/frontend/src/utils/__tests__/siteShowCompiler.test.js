import { describe, expect, it } from "vitest";
import { createICANSiteEngineeringProject } from "../../data/icanSiteEngineeringProject";
import { generateAutoTracks } from "../../runtime/autoTrackGenerator";
import { createArrayPatternPlan, getArrayTargetFixtures, parseCustomArray, buildPatternStages } from "../arrayPatternEngine";
import { compileSiteWaterShow, createDesignShowPreview, createSiteWaterTrack, CAPTURED_SITE_SUPPORT } from "../siteShowCompiler";
import { createICANPreviewPlan, evaluateICANPreview } from "../icanPatternPreview";

const fixtures = createICANSiteEngineeringProject().fixtures;
const tracks = generateAutoTracks({ fixtures }).tracks;
const array = options => createArrayPatternPlan({ fixtures, tracks, target: "mapped_running", valveMode: true, intensity: 100, patternId: "all_pulse", stepDuration: 1, pulseDuration: 0.4, ...options });
const signals = (pattern, t) => evaluateICANPreview(createICANPreviewPlan(pattern), t, fixtures);

describe("site water show conversion", () => {
  it("converts 64 captured valve clips with full support and an explicit final OFF", () => {
    const source = array();
    const before = JSON.stringify(source);
    const pattern = compileSiteWaterShow(source.clips, fixtures, { includeCapturedSupport: true });
    expect(pattern.steps[0].groups[1]).toHaveLength(32);
    expect(pattern.steps[0].groups[9]).toHaveLength(32);
    expect(pattern.steps[0].groups[17]).toEqual(CAPTURED_SITE_SUPPORT);
    expect(pattern.steps.at(-1)).toMatchObject({ duration_ms: 600, groups: { "1": [], "9": [], "17": [], "2": [], "25": [] } });
    expect(signals(pattern, 0).active).toBe(64);
    expect(signals(pattern, 0.4).active).toBe(0);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("keeps support OFF by default and preserves lead-in and silent gaps", () => {
    const source = array({ startTime: 2, repeats: 2 });
    const pattern = compileSiteWaterShow(source.clips, fixtures);
    expect(signals(pattern, 1.99).active).toBe(0);
    expect(signals(pattern, 2).active).toBe(64);
    expect(signals(pattern, 2.4).active).toBe(0);
    expect(signals(pattern, 3).active).toBe(64);
    expect(pattern.steps.every(s => s.groups[17].length === 0)).toBe(true);
  });
  it("unions overlapping ON clips without prematurely switching the outlet off", () => {
    const clip = array().clips[0];
    const pattern = compileSiteWaterShow([clip, { ...clip, id: "overlap", startTime: 0.2, duration: 0.4, effects: [] }], fixtures);
    expect(pattern.steps[0].duration_ms).toBe(600);
    expect(signals(pattern, 0.5).active).toBe(1);
    expect(signals(pattern, 0.6).active).toBe(0);
  });
  it("rejects conflicting ON/OFF overlaps", () => {
    const clip = array().clips[0];
    expect(() => compileSiteWaterShow([clip, { ...clip, value: 0, effects: [] }], fixtures)).toThrow(/ambiguous/);
  });
  it("never drops unresolved running outlets, foam, peacock or equipment from a real show", () => {
    for (const target of ["running", "foam_left", "peacock"]) {
      expect(() => compileSiteWaterShow(array({ target }).clips, fixtures)).toThrow(/no capture-derived/);
    }
    const pump = fixtures.find(f => f.type === "pump");
    expect(() => compileSiteWaterShow([{ ...array().clips[0], fixtureId: pump.id }], fixtures)).toThrow(/water outlet clips only/);
  });
  it("rejects analogue intensity, fades, sub-100 ms states and nonconstant effects", () => {
    const clip = array().clips[0];
    expect(() => compileSiteWaterShow([{ ...clip, value: 70, effects: [] }], fixtures)).toThrow(/ON\/OFF/);
    expect(() => compileSiteWaterShow([{ ...clip, fadeIn: 0.1 }], fixtures)).toThrow(/ON\/OFF/);
    expect(() => compileSiteWaterShow([{ ...clip, duration: 0.05, effects: [] }], fixtures)).toThrow(/100 ms/);
    expect(() => compileSiteWaterShow([{ ...clip, effects: [{ type: "wave" }] }], fixtures)).toThrow(/Complex effects/);
  });
  it("splits long silent intervals without producing short or oversized steps", () => {
    const pattern = compileSiteWaterShow(array({ startTime: 120.05 }).clips, fixtures);
    expect(pattern.steps.every(s => s.duration_ms >= 100 && s.duration_ms <= 60000)).toBe(true);
    expect(signals(pattern, 120).active).toBe(0);
    expect(signals(pattern, 120.05).active).toBe(64);
  });
  it("refuses duplicate fixture addresses and shows beyond the runtime budget", () => {
    const clip = array().clips[0], original = fixtures.find(f => f.id === clip.fixtureId);
    expect(() => compileSiteWaterShow([clip], [...fixtures, { ...original, id: "alias" }])).toThrow(/Duplicate address/);
    expect(() => compileSiteWaterShow(array({ startTime: 600 }).clips, fixtures)).toThrow(/10 minutes/);
  });
  it("design simulation animates all 100 outlets with fades while exact conversion stays blocked", () => {
    const source = array({ target: "all_water", valveMode: false, intensity: 80, pulseDuration: 1 });
    const pattern = createDesignShowPreview(source.clips, fixtures);
    const live = signals(pattern, 0.5);
    expect(live.active).toBe(100);
    expect(Object.values(live.fixtureIntensities).filter(v => v > 0).every(v => v === 0.8)).toBe(true);
    expect(signals(pattern, 0).active).toBe(0);
    expect(signals(pattern, 1).active).toBe(0);
  });
});

describe("visual arrays and operator stages", () => {
  it("labels site water tracks as outlets while leaving real pump equipment separate", () => {
    expect(createSiteWaterTrack(getArrayTargetFixtures(fixtures, "mapped_running")[0])).toMatchObject({ type: "solenoid_open", siteWaterOutlet: true });
    expect(createSiteWaterTrack(getArrayTargetFixtures(fixtures, "foam_left")[0])).toMatchObject({ type: "device_intensity", siteWaterOutlet: true });
    expect(createSiteWaterTrack(fixtures.find(f => f.type === "pump"))).toBeNull();
  });
  it("uses explicit selected fixture IDs and preserves an empty selection", () => {
    const chosen = getArrayTargetFixtures(fixtures, "mapped_running").slice(4, 8).map(f => f.id);
    expect(array({ selectedFixtureIds: chosen }).fixtures.map(f => f.id)).toEqual(chosen);
    expect(array({ selectedFixtureIds: [] }).clips).toEqual([]);
    expect(array({ selectedFixtureIds: chosen, order: "reverse" }).fixtures.map(f => f.id)).toEqual([...chosen].reverse());
  });
  it("preserves programmed OFF stages and rejects typos or out-of-range numbers", () => {
    expect(parseCustomArray("1 | off | 2", 2)).toEqual([[0], [], [1]]);
    expect(() => parseCustomArray("3", 2)).toThrow(/Unknown outlet/);
    expect(() => parseCustomArray("1-3", 2)).toThrow(/within/);
    expect(() => parseCustomArray("1oops", 2)).toThrow(/Unknown outlet/);
    const plan = array({ patternId: "custom", customProgram: "all | off", pulseDuration: 1 });
    expect(plan.duration).toBe(2);
    expect(compileSiteWaterShow(plan.clips, fixtures).steps.reduce((n, s) => n + s.duration_ms, 0)).toBe(2000);
  });
  it("builds mirrored blocks and a traveling window without duplicate outlets", () => {
    const selected = fixtures.slice(0, 8);
    expect(buildPatternStages("mirrored_blocks", selected, { blockSize: 2 })).toEqual([[0, 1, 7, 6], [2, 3, 5, 4]]);
    expect(buildPatternStages("traveling_wave", selected, { blockSize: 3 })[1]).toEqual([1, 2, 3]);
    expect(buildPatternStages("fill_drain", selected).at(-1)).toEqual([]);
  });
  it("bounds large generated programs before allocating timeline clips", () => {
    expect(() => array({ patternId: "progressive_fill", repeats: 100 })).toThrow(/20,000/);
  });
  it("holds captured support steady across valve gaps and shuts it off after the last ON", () => {
    const pattern = compileSiteWaterShow(array({ repeats: 2 }).clips, fixtures, { includeCapturedSupport: true });
    expect(signals(pattern, 0.5).active).toBe(0);
    expect(signals(pattern, 0.5).supportSelected).toBe(true);
    expect(signals(pattern, 1.4).supportSelected).toBe(false);
    expect(pattern.steps.every(s => s.groups[2].length === 0 && s.groups[25].length === 0)).toBe(true);
  });
});
