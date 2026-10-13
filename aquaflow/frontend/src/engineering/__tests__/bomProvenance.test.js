// AF-NEXT-012 — BOM lines cite equipment model / data source / units / revision,
// the verified-model form enforces the trust rules, and the UI badges render.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React, { createElement } from "react";

// Node test env has no JSX automatic-runtime plugin: components expect React in scope.
globalThis.React = React;
import { BOM_PROVENANCE_HEADERS, bomCitation, bomProvenanceCells, generateBOM } from "../bomEngine.js";
import { buildVerifiedModelRecord, emptyVerifiedForm, parsePointLines } from "../verifiedModelForm.js";
import { getDefaultEngineering, FIXTURE_LIBRARY } from "../../data/fixtureLibrary.js";
import { GENERIC_LABEL } from "../../data/fixtureProvenance.js";
import ProvenanceBadge from "../../components/panels/ProvenanceBadge.jsx";
import FixtureLibraryBrowser from "../../components/panels/FixtureLibraryBrowser.jsx";
import { ReplacementReport } from "../../components/panels/FixtureTrustPanel.jsx";
import { replaceFixtureType } from "../fixtureTypeReplacement.js";

const place = (id, type, extra = {}) => ({ id, type, engineering: getDefaultEngineering(type), ...extra });

describe("BOM provenance", () => {
  it("every BOM item cites model, source, units and revision", () => {
    const bom = generateBOM([place("a", "nozzle_straight_dn25"), place("b", "nozzle_straight_dn25"), place("c", "light_underwater_par_rgbw_36w")]);
    expect(bom).toHaveLength(2);
    for (const item of bom) {
      expect(item.equipmentModel).toBe(item.type);
      expect(item.dataSource).toBe("generic_estimate");
      expect(item.sourceLabel).toBe(GENERIC_LABEL);
      expect(item.revision).toMatch(/aquaflow-generic/);
      expect(Object.keys(item.citation.units).length).toBeGreaterThan(0);
    }
  });

  it("a fixture linked to a measured model gets its own line, never merged with generic", () => {
    const measured = { source: "user_measured", model: "Jet A", date: "2026-10-01", revision: "run-1" };
    const bom = generateBOM([place("a", "nozzle_straight_dn25"), place("b", "nozzle_straight_dn25", { provenance: measured })]);
    expect(bom).toHaveLength(2);
    const m = bom.find((i) => i.dataSource === "user_measured");
    expect(m).toMatchObject({ quantity: 1, revision: "run-1" });
  });

  it("CSV columns: headers + cells, including pipework items without a citation", () => {
    expect(BOM_PROVENANCE_HEADERS).toEqual(["Equipment Model", "Data Source", "Confidence", "Units Basis", "Data Revision", "Source Document"]);
    const cells = bomProvenanceCells({ key: "pipe_dn50_branch", label: "Branch Pipe DN50", unit: "m", category: "Pipework" });
    expect(cells[0]).toBe("pipe_dn50_branch");
    expect(cells[1]).toBe(GENERIC_LABEL);
    expect(cells[3]).toMatch(/length=m/);
    expect(bomCitation({ key: "x" }).dataSource).toBe("generic_estimate");
  });
});

describe("verified model form", () => {
  it("builds a measured nozzle record from jet height vs pressure lines", () => {
    const form = { ...emptyVerifiedForm("nozzle"), label: "Site jet", model: "Site jet", date: "2026-10-01", points: "0.5, 40, 3\n1.0, 57, 6" };
    const { record, errors } = buildVerifiedModelRecord(form);
    expect(errors).toEqual([]);
    expect(record.data.pressure_flow_points).toEqual([{ pressure: 0.5, flow: 40, jet_height: 3 }, { pressure: 1, flow: 57, jet_height: 6 }]);
    expect(record.provenance.units.jet_height).toBe("m");
  });

  it("refuses untrustworthy or incomplete records", () => {
    const noDate = buildVerifiedModelRecord({ ...emptyVerifiedForm("pump"), label: "P", model: "P", points: "0,30\n0.01,28\n0.02,23" });
    expect(noDate.errors.join(" ")).toMatch(/date/);
    const sheet = buildVerifiedModelRecord({ ...emptyVerifiedForm("valve"), source: "manufacturer_datasheet", label: "V", model: "V", kv: "40" });
    expect(sheet.errors.join(" ")).toMatch(/manufacturer/);
    expect(sheet.errors.join(" ")).toMatch(/licence/);
    const generic = buildVerifiedModelRecord({ ...emptyVerifiedForm("light"), source: "generic_estimate", label: "L", powerW: "10", dmxChannels: "4" });
    expect(generic.errors.join(" ")).toMatch(/manufacturer datasheet or a user measurement/);
    expect(parsePointLines("1, 2\nx, y\n").bad).toEqual([2]);
  });
});

describe("trust UI", () => {
  it("generic badge always reads the generic label", () => {
    const html = renderToStaticMarkup(createElement(ProvenanceBadge, { provenance: null }));
    expect(html).toContain(GENERIC_LABEL);
    const measured = renderToStaticMarkup(createElement(ProvenanceBadge, { provenance: { dataSource: "user_measured", confidence: "medium" } }));
    expect(measured).toContain("User measured");
  });

  it("fixture library shows source badges and the generic note", () => {
    const html = renderToStaticMarkup(createElement(FixtureLibraryBrowser, {
      fixtures: FIXTURE_LIBRARY, tool: "nozzle", selectedKey: "nozzle_straight_dn25", onSelect: () => {},
    }));
    expect(html).toContain(`All items: ${GENERIC_LABEL}`);
    expect(html).toContain("GENERIC");
    expect(html).toContain('data-testid="provenance-badge"');
  });

  it("replacement report lists footprint changes and affected items", () => {
    const fixtures = [place("n1", "nozzle_straight_dn15")];
    const { report } = replaceFixtureType(fixtures, "n1", "light_uw_rgb_18w");
    const html = renderToStaticMarkup(createElement(ReplacementReport, { report }));
    expect(html).toContain("CONTROL FOOTPRINT CHANGED");
    expect(html).toContain("DMX channel count");
    expect(html).toContain("[dmx]");
    expect(html).toContain("never auto-reassigned");
  });
});
