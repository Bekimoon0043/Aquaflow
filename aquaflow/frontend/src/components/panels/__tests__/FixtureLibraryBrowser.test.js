import { describe, expect, it } from "vitest";
import { filterFixtureLibrary, fixtureMatchesTool } from "../FixtureLibraryBrowser.jsx";

const fixtures = [
  { key: "nozzle_geyser_acme", label: "Geyser 100", category: "Nozzles", manufacturer: "Acme" },
  { key: "light_rgb_marine", label: "RGB Marine", category: "Lighting", manufacturer: "Luma" },
  { key: "pump_variable", label: "Variable Pump", category: "Pumps", manufacturer: "Acme" },
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
});
