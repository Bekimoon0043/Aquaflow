import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

// vitest.config.js has no React plugin (classic JSX runtime), so expose React before loading the component.
globalThis.React = React;

describe("CADImportDialog (AF-CAD-012)", () => {
  it("renders the novice-first chooser with one primary Import button and .json support", async () => {
    const { default: CADImportDialog } = await import("../CADImportDialog");
    const html = renderToString(React.createElement(CADImportDialog, { currentProject: { name: "Site", fixtures: [] }, onApply() {}, onClose() {} }));
    expect(html).toContain("Import AutoCAD drawing");
    expect(html).toContain('accept=".dxf,.dwg,.json"');
    expect(html.match(/>Import<\/button>/g)).toHaveLength(1);
    expect(html).toMatch(/disabled=""[^>]*>Import<\/button>/); // nothing to import yet
  });

  it("renders the review step: outlines, grouped candidates with reasons, levels, advanced collapsed", async () => {
    const { default: CADImportDialog } = await import("../CADImportDialog");
    const square = [[0, 0], [20, 0], [20, 12], [0, 12]];
    const response = {
      version: 1, filename: "site.dxf", units: { name: "m", to_m: 1, unitless: false },
      layers: [{ name: "POOL", color: 5 }], extents: { min: [0, 0], max: [20, 12] },
      entities: [{ handle: "2F1", layer: "POOL", kind: "polyline", points: square, closed: true, z: 0 }],
      inserts: [], closed_outlines: [{ handle: "2F1", layer: "POOL", points: square, area_m2: 240, holes: [] }],
      recognition: { candidates: [
        { id: "c0", source_handle: "3A0", type: "nozzle", confidence: 0.92, reasons: ["block name matches NOZZLE"], position: [3, 2], rotation_deg: 0,
          block: "NOZZLE_JET_2M", layer: "NOZZLES", attribs: {}, tag: "N-01", fields: { model: "JET-25" }, field_provenance: { model: "attribute MODEL" }, aquaflow_id: null },
        { id: "c1", source_handle: "3A1", type: "nozzle", confidence: 0.4, reasons: ["layer keyword JET"], position: [5, 2], rotation_deg: 0,
          block: "NOZZLE_JET_2M", layer: "NOZZLES", attribs: {}, tag: "N-02", fields: {}, field_provenance: {}, aquaflow_id: null },
      ], basins: [], pipes: [], land: [], groups: [] },
    };
    const html = renderToString(React.createElement(CADImportDialog, {
      currentProject: { name: "Site", fixtures: [] }, onApply() {}, onClose() {}, initialImport: { response, fileName: "site.dxf" },
    }));
    expect(html).toContain("Basin and islands");
    expect(html).toContain("Recognised fountain components");
    expect(html).toContain("Block NOZZLE_JET_2M");
    expect(html).toContain("Type for all instances of block:NOZZLE_JET_2M");
    expect(html).toContain("Advanced options");
    expect(html).not.toContain("Pick origin"); // advanced section collapsed for novices
    expect(html).toMatch(/2(<!-- -->)? fixtures/);
    expect(html).not.toMatch(/disabled=""[^>]*>Import<\/button>/); // basin chosen by default → Import enabled
  });

  it("renders a REAL backend response: depth zone reference-only, hydraulic network step, no unit prompt", async () => {
    const { default: CADImportDialog } = await import("../CADImportDialog");
    const response = (await import("../../../engineering/__tests__/fixtures/cad_import_response.json")).default;
    const zone = response.closed_outlines.find(o => o.layer === "F-DEPTH-ZONE").handle;
    const html = renderToString(React.createElement(CADImportDialog, {
      currentProject: { name: "Site", fixtures: [] }, onApply() {}, onClose() {}, initialImport: { response, fileName: "central_plaza.dxf" },
    }));
    expect(html).toMatch(new RegExp(`aria-label="Use outline ${zone} as"[^>]*disabled=""`));
    expect(html.replace(/<!-- -->/g, "")).toContain("reference only (layer F-DEPTH-ZONE is depth (not structural))");
    expect(html).toContain("Hydraulic network");
    expect(html).toMatch(/13(<!-- -->)? fixtures/);
    expect(html).toMatch(/1(<!-- -->)? islands/);
    expect(html).not.toContain("does not say which units");
  });

  it("asks to confirm the units of a unitless drawing previewed in the backend's suggested unit", async () => {
    const { default: CADImportDialog } = await import("../CADImportDialog");
    const response = (await import("../../../engineering/__tests__/fixtures/cad_import_unitless_response.json")).default;
    const html = renderToString(React.createElement(CADImportDialog, {
      currentProject: { name: "Site", fixtures: [] }, onApply() {}, onClose() {}, initialImport: { response, fileName: "plaza.dxf" },
    }));
    expect(html).toContain("does not say which units");
    expect(html).toContain("previewed in millimeters");
    expect(html.replace(/<!-- -->/g, "")).toContain("Pool span: 24.000 × 12.000 meters");
    expect(html).toMatch(/disabled=""[^>]*>Import<\/button>/); // must confirm first
  });
});
