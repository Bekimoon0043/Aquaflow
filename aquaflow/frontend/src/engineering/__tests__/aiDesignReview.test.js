import { describe, expect, it, vi } from "vitest";
import { designReviewInput, findingFixtureIds, pumpFlowBudget, requestDesignReview, REVIEW_WIND_MS } from "../aiDesignReview";
import { aiErrorMessage } from "../../utils/aiError";

// 8 straight jets on a ring, each with a solenoid, on pump A (rated 300 L/min, jets ask 8 × 50);
// two baskets with no valves on pump B (VFD); one light paired to jet 0.
const ring = Array.from({ length: 8 }, (_, i) => ({ i, x: Math.round(5 * Math.cos((i / 8) * 2 * Math.PI) * 1000) / 1000, y: Math.round(3 * Math.sin((i / 8) * 2 * Math.PI) * 1000) / 1000 }));
const FIXTURES = [
  ...ring.map((j) => ({ id: `jet${j.i}`, type: "nozzle_straight_dn25", label: `Jet ${j.i}`, x: j.x, y: j.y, zone: "perimeter",
    engineering: { jetHeightM: 4, solenoidValveId: `valve${j.i}`, pumpId: "pumpA", flowLpm: 50 } })),
  ...ring.map((j) => ({ id: `valve${j.i}`, type: "valve_solenoid_dn25_24v", label: `Valve ${j.i}`, x: j.x, y: j.y, engineering: { controlledFixtureId: `jet${j.i}`, pumpId: "pumpA" } })),
  ...[-0.5, 0.5].map((x, k) => ({ id: `basket${k}`, type: "rotating_jet", label: `Basket ${k}`, x, y: 0, zone: "centre",
    engineering: { jetHeightM: 6, nozzleStyle: "Rotating Basket", pumpId: "pumpB" } })),
  { id: "light0", type: "light_uw_rgb_18w", label: "Light 0", x: ring[0].x, y: ring[0].y, engineering: { pairedNozzleId: "jet0" } },
  { id: "pumpA", type: "pump_inline_pump_7_5kw", label: "Pump A - 7.5 kW", x: -8, y: 0, engineering: { powerKw: 7.5, flowLpm: 300, servesValveIds: ring.map((j) => `valve${j.i}`) } },
  { id: "pumpB", type: "pump_inline_vfd_pump_5_5kw", label: "Pump B", x: 8, y: 0, engineering: { powerKw: 5.5, flowM3Hr: 30 } },
];
const BASIN = [{ id: "basin-1", outer: [{ x: -6, y: -4 }, { x: 6, y: -4 }, { x: 6, y: 4 }, { x: -6, y: 4 }], holes: [] }];

describe("AI design review input", () => {
  it("describes areas, pumps with their flow budget, valves, lights, basin and wind", () => {
    const input = designReviewInput({ fixtures: FIXTURES, basins: BASIN });
    const t = input.description;
    expect(input.areas.length).toBeGreaterThan(0);
    for (const a of input.areas) expect(t).toContain(a);
    expect(t).toMatch(/pumpA · Pump A · 7\.5 kW · no VFD · 300 L\/min · 400 L\/min \(133 % of rated\)/);
    expect(t).toMatch(/pumpB · Pump B · 5\.5 kW · VFD · 500 L\/min · demand \? \(2 jets without flow data\)/);
    expect(t).toContain("BASIN: 96 m²");
    expect(t).toContain(`at ${REVIEW_WIND_MS} m/s wind`);
    expect(t).toContain("VALVES: 8 solenoids; 0 not linked");
    expect(t).toMatch(/LIGHTS: 1; 0 not paired/);
    expect(t).toContain("GROUP CHECK");
    expect(input.ids).toEqual(expect.arrayContaining(["jet0", "valve3", "pumpA", "pumpB", "light0", "basket1"]));
    expect(t.length).toBeLessThan(38001);
  });

  it("says when there is no basin and works without a show", () => {
    const t = designReviewInput({ fixtures: FIXTURES }).description;
    expect(t).toContain("no basin outline drawn");
  });

  it("flags a pump whose jets ask for more than it delivers", () => {
    const input = designReviewInput({ fixtures: FIXTURES });
    const budget = pumpFlowBudget(input.design);
    expect(budget.find((p) => p.id === "pumpA")).toMatchObject({ ratedLpm: 300, demandLpm: 400, over: 133, vfd: false, jets: 8, valved: 8 });
    expect(budget.find((p) => p.id === "pumpB")).toMatchObject({ ratedLpm: 500, demandLpm: null, vfd: true });
  });

  it("posts only the text, area ids and part ids", async () => {
    const input = designReviewInput({ fixtures: FIXTURES });
    const post = vi.fn(async () => ({ summary: "ok", findings: [] }));
    await requestDesignReview(input, { post });
    expect(post).toHaveBeenCalledWith("/ai/design-review", { description: input.description, areas: input.areas, ids: input.ids });
  });

  it("turns a finding's areas into the fixtures to select", () => {
    const input = designReviewInput({ fixtures: FIXTURES });
    const basketArea = input.design.areas.find((a) => a.kind === "basket");
    expect(findingFixtureIds({ ids: ["pumpB"], areas: [basketArea.id] }, input.design).sort()).toEqual(["basket0", "basket1", "pumpB"]);
  });

  it("shows the route's message, or how to enable the feature", () => {
    expect(aiErrorMessage(new Error("HTTP 502 — AI design review: the API key was not accepted"))).toBe("AI design review: the API key was not accepted");
    expect(aiErrorMessage(new Error("HTTP 404"), "The AI design review")).toMatch(/needs the AquaFlow engine and an Anthropic API key/);
  });
});
