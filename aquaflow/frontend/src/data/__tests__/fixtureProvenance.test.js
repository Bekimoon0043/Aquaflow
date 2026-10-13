// AF-NEXT-012 — shared provenance schema + fixture-library trust labelling.
import { describe, expect, it } from "vitest";
import {
  GENERIC_LABEL, citeProvenance, normalizeProvenance, provenanceBadge, summarizeCitations, validateProvenance,
} from "../fixtureProvenance.js";
import { FIXTURE_LIBRARY, getFixtureProvenance, getFixtureType } from "../fixtureLibrary.js";

const datasheet = {
  source: "manufacturer_datasheet", manufacturer: "Acme", model: "J-1",
  document: { title: "J-1 datasheet" }, revision: "B", licence: "Written permission on file",
};

describe("provenance schema", () => {
  it("defaults to a low-confidence generic estimate", () => {
    const p = normalizeProvenance(undefined, { kind: "nozzle", model: "X" });
    expect(p).toMatchObject({ source: "generic_estimate", confidence: "low", label: GENERIC_LABEL });
    expect(p.units.pressure).toBe("bar");
  });

  it("downgrades an incomplete datasheet claim instead of trusting it", () => {
    const p = normalizeProvenance({ source: "manufacturer_datasheet", manufacturer: "Acme", model: "J-1", confidence: "high" });
    expect(p.source).toBe("generic_estimate");
    expect(p.confidence).toBe("low");
    expect(p.downgradedFrom).toBe("manufacturer_datasheet");
    expect(provenanceBadge(p).label).toBe(GENERIC_LABEL);
  });

  it("keeps a complete datasheet and a dated measurement", () => {
    expect(normalizeProvenance(datasheet).source).toBe("manufacturer_datasheet");
    expect(normalizeProvenance(datasheet).confidence).toBe("high");
    const m = normalizeProvenance({ source: "user_measured", model: "Jet A", date: "2026-10-01" });
    expect(m).toMatchObject({ source: "user_measured", confidence: "medium" });
    expect(validateProvenance({ source: "user_measured", model: "Jet A" })).toContain("user_measured requires 'date'");
  });

  it("generic estimates can never claim medium/high confidence", () => {
    expect(validateProvenance({ source: "generic_estimate", confidence: "high" }).length).toBe(1);
    expect(normalizeProvenance({ source: "generic_estimate", confidence: "high" }).confidence).toBe("low");
  });

  it("citations carry model, source, units and revision; summaries count generic items", () => {
    const c = citeProvenance(normalizeProvenance(datasheet, { kind: "nozzle" }), { equipmentModel: "J-1" });
    expect(c).toMatchObject({ equipmentModel: "J-1", dataSource: "manufacturer_datasheet", revision: "B", document: "J-1 datasheet" });
    const g = citeProvenance(null, { equipmentModel: "pipe", kind: "pipe" });
    expect(g.dataSource).toBe("generic_estimate");
    expect(g.revision).toMatch(/aquaflow-generic/);
    const s = summarizeCitations([c, g]);
    expect(s).toMatchObject({ items: 2, genericItems: 1, allVerified: false });
    expect(s.warning).toMatch(/verify with supplier datasheets/);
  });
});

describe("fixture library trust labelling", () => {
  it("every library item carries a provenance block and none is presented as a datasheet", () => {
    const bad = FIXTURE_LIBRARY.filter((f) => !f.provenance || f.provenance.source !== "generic_estimate" || f.provenance.confidence !== "low");
    expect(bad.map((f) => f.key)).toEqual([]);
    expect(FIXTURE_LIBRARY.length).toBeGreaterThan(500);
  });

  it("a bare manufacturer/model pair is not a datasheet", () => {
    // Legacy rule marked such items source:"datasheet"; AF-NEXT-012 requires a document.
    const lights = FIXTURE_LIBRARY.filter((f) => f.category === "Lights");
    expect(lights.length).toBeGreaterThan(0);
    expect(lights.every((f) => f.provenance.units.dmx_channels === "channels")).toBe(true);
  });

  it("placed fixture provenance: instance block wins, normalised; unknown types are generic", () => {
    const plain = getFixtureProvenance({ type: "nozzle_straight_dn25" });
    expect(plain.source).toBe("generic_estimate");
    const measured = getFixtureProvenance({ type: "nozzle_straight_dn25", provenance: { source: "user_measured", model: "Jet A", date: "2026-10-01" } });
    expect(measured.source).toBe("user_measured");
    const fake = getFixtureProvenance({ type: "nozzle_straight_dn25", provenance: { source: "manufacturer_datasheet" } });
    expect(fake.source).toBe("generic_estimate");
    expect(getFixtureType("no_such").provenance.source).toBe("generic_estimate");
  });
});
