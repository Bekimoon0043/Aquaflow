import { describe, expect, it } from "vitest";
import { filterFixtureLibrary, fixtureMatchesTool } from "../FixtureLibraryBrowser.jsx";
import { FIXTURE_TYPES } from "../../../engineering/drafting/designerCatalog";

const fixtures = [
  { key: "nozzle_geyser_acme", label: "Geyser 100", category: "Nozzles", manufacturer: "Acme" },
  { key: "light_rgb_marine", label: "RGB Marine", category: "Lighting", manufacturer: "Luma" },
  { key: "pump_variable", label: "Variable Pump", category: "Pumps", manufacturer: "Acme" },
  { key: "nozzle_rotating_spinner", label: "Rotating Spinner DN80", category: "Nozzles", family: "Rotating Nozzles", tags: ["basket", "spinner"] },
];

describe("searchable categorized fixture library", () => {
  it("scopes models to the active placement tool", () => {
    expect(fixtureMatchesTool(fixtures[0], "nozzle")).toBe(true);
    expect(fixtureMatchesTool(fixtures[1], "nozzle")).toBe(false);
    expect(filterFixtureLibrary(fixtures, { tool: "equipment" })).toEqual([fixtures[2]]);
  });

  it("searches label, model key, category, and manufacturer", () => {
    expect(filterFixtureLibrary(fixtures, { tool: "nozzle", query: "acme" })).toEqual([fixtures[0]]);
    expect(filterFixtureLibrary(fixtures, { tool: "light", category: "Lighting" })).toEqual([fixtures[1]]);
  });

  it("searches tags and family so 'basket' finds rotating nozzles", () => {
    expect(filterFixtureLibrary(fixtures, { tool: "nozzle", query: "basket" })).toEqual([fixtures[3]]);
    expect(filterFixtureLibrary(fixtures, { tool: "nozzle", query: "rotating nozzles" })).toEqual([fixtures[3]]);
    expect(filterFixtureLibrary(fixtures, { tool: "nozzle", query: "spinner" })).toEqual([fixtures[3]]);
  });

  it("finds the rotating (basket) nozzles in the list the Engineering Designer actually passes", () => {
    const hits = filterFixtureLibrary(FIXTURE_TYPES, { tool: "nozzle", query: "basket" });
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(hits.map((f) => f.key)).toContain("nozzle_twister_g3_saferain");
    expect(filterFixtureLibrary(FIXTURE_TYPES, { tool: "nozzle", query: "rotating nozzles" }).length).toBeGreaterThanOrEqual(6);
  });
});
