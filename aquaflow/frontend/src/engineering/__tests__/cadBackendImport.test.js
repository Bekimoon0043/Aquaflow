/**
 * AF-CAD-012 / 014 / 017 — backend import path (POST /api/cad/import contract), mocked fetch.
 */
import { describe, it, expect, vi } from "vitest";
import * as T from "three";
import {
  requestCadImport, listCadTemplates, saveCadTemplate, recognizeCadImport, requestCadDiff,
  previewCadImportResponse, applyCadImport, cadTemplateFromOverrides, cadOverridesFromTemplate,
  diffCadCandidates, cadDiffPrevious, landMaterialFor, deriveCadLevels, rescaleCadImport,
  CadBackendUnavailableError, CAD_BACKEND_MAX_BYTES, exportCadDxf, parseCadDxf, previewCadImport,
} from "../cadExchange";
import { engineeringToWorld, poolCenter } from "../geometryContract";
import { centeredPoolPoints, centeredPoolHoles, poolShapeGeometry } from "../../components/preview/basinGeometry";

const square = [[0, 0], [20, 0], [20, 12], [0, 12]];
const island = [[8, 4], [12, 4], [12, 8], [8, 8]];
const importResponse = (over = {}) => ({
  version: 1, filename: "site.dxf", dxf_version: "AC1032",
  units: { insunits: 6, name: "m", to_m: 1, unitless: false, suggested: null },
  extents: { min: [0, 0], max: [40, 12] },
  layers: [{ name: "POOL", color: 5, entity_count: 2 }, { name: "NOZZLES", color: 1, entity_count: 3 }, { name: "LAND", color: 3, entity_count: 1 }],
  entities: [
    { handle: "2F1", layer: "POOL", kind: "polyline", points: square, closed: true, z: 0.5, color: 256 },
    { handle: "2F6", layer: "POOL", kind: "polyline", points: island, closed: true, z: 0.5, color: 256 },
    { handle: "2F4", layer: "LAND", kind: "hatch", pattern: "GRASS", loops: [[[25, 0], [40, 0], [40, 12], [25, 12]]], color: 3 },
    { handle: "2F9", layer: "PIPE", kind: "polyline", points: [[1, 1], [5, 1]], closed: false },
    { handle: "2F3", layer: "TEXT", kind: "text", position: [3.2, 2.2], text: "N-01", height: 0.2, rotation_deg: 0 },
  ],
  inserts: [
    { handle: "3A0", block: "*U12", effective_name: "NOZZLE_JET_2M", layer: "NOZZLES", position: [3, 2, 0], rotation_deg: 0, scale: [1, 1, 1],
      attribs: { ID: "N-01", MODEL: "JET-25" }, xdata: { AQUAFLOW: { id: "noz_1", type: "nozzle" } }, depth: 0, parent_handle: null },
    { handle: "3A1", block: "*U12", effective_name: "NOZZLE_JET_2M", layer: "NOZZLES", position: [6, 2, 0], rotation_deg: 0, scale: [1, 1, 1],
      attribs: { ID: "N-02", FFL: "-0.65" }, xdata: {}, depth: 0, parent_handle: null },
  ],
  closed_outlines: [
    { handle: "2F1", layer: "POOL", points: square, area_m2: 240, holes: [] },
    { handle: "2F6", layer: "POOL", points: island, area_m2: 16, holes: [] },
  ],
  tables: [], xrefs: [], warnings: [],
  stats: { entities: 5, inserts: 2, skipped: {}, parse_ms: 12 },
  recognition: {
    candidates: [
      { id: "cand_0", source_handle: "3A0", type: "nozzle", confidence: 0.98, reasons: ["AQUAFLOW XDATA"], position: [3, 2], z: 0, rotation_deg: 90,
        block: "NOZZLE_JET_2M", layer: "NOZZLES", attribs: { ID: "N-01" }, tag: "N-01",
        fields: { model: "JET-25", flow_lpm: 40, height_m: 2, dmx_address: 17, pump_id: "P-1" },
        field_provenance: { model: "attribute MODEL", dmx_address: "attribute DMX" }, aquaflow_id: "noz_1" },
      { id: "cand_1", source_handle: "3A1", type: "nozzle", confidence: 0.7, reasons: ["block name matches NOZZLE"], position: [6, 2], z: 0, rotation_deg: 0,
        block: "NOZZLE_JET_2M", layer: "NOZZLES", attribs: { ID: "N-02" }, tag: "N-02", fields: {}, field_provenance: {}, aquaflow_id: null },
      { id: "cand_2", source_handle: "3A2", type: "light", confidence: 0.35, reasons: ["layer keyword LED"], position: [15, 9], z: 0, rotation_deg: 0,
        block: null, layer: "LED", attribs: {}, tag: null, fields: {}, field_provenance: {}, aquaflow_id: null },
    ],
    basins: [{ source_handle: "2F1", role: "basin", points: square, holes: [], area_m2: 240, confidence: 0.9, reasons: ["largest closed outline"] },
      { source_handle: "2F6", role: "island", points: island, holes: [], area_m2: 16, confidence: 0.7, reasons: ["inside basin"] }],
    pipes: [{ source_handle: "2F9", points: [[1, 1], [5, 1]], dn: 65, material: "PVC", layer: "PIPE" }],
    land: [{ source_handle: "2F4", material: "grass", loops: [[[25, 0], [40, 0], [40, 12], [25, 12]]] }],
    groups: [], template_used: null,
  },
  ...over,
});

const existing = () => ({
  name: "Site", id: "proj-1", pool_type: "freeform", params: { width: 20, length: 12, depth: 1 },
  geometry: { type: "freeform", closed: true, points: square.map(([x, y]) => ({ x, y: -y })) },
  fixtures: [
    { id: "noz_1", type: "nozzle_running", label: "Old 1", x: 3, y: -2, rotation: 0, engineering: { icanGroup: 2, icanChannel: 11, plcChannel: 4 } },
    { id: "jet-7", type: "nozzle_geyser", label: "Old 7", x: 6.01, y: -2, cadHandle: "3A1", engineering: { icanGroup: 2, icanChannel: 12 } },
  ],
  site_surfaces: [{ id: "hand", type: "paving", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
});

const okJson = body => ({ ok: true, status: 200, json: async () => body });

describe("backend API client", () => {
  it("POSTs multipart to /api/cad/import and validates the response", async () => {
    const fetchImpl = vi.fn(async () => okJson(importResponse()));
    const file = new File(["0\nEOF\n"], "site.dxf");
    const r = await requestCadImport(file, { units: "millimeters", fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toMatch(/\/api\/cad\/import$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get("units")).toBe("mm");
    expect(init.body.get("file").name).toBe("site.dxf");
    expect(r.entities).toHaveLength(5);
  });

  it("signals backend-unavailable on network failure or 404/503 so the UI can fall back", async () => {
    const file = new File(["x"], "a.dxf");
    await expect(requestCadImport(file, { fetchImpl: async () => { throw new TypeError("fetch failed"); } }))
      .rejects.toBeInstanceOf(CadBackendUnavailableError);
    await expect(requestCadImport(file, { fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }))
      .rejects.toMatchObject({ backendUnavailable: true });
    await expect(requestCadImport(file, { fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ detail: "Not a DXF" }) }) }))
      .rejects.toThrow("Not a DXF");
    await expect(requestCadImport({ size: CAD_BACKEND_MAX_BYTES + 1, name: "x.dxf" })).rejects.toThrow(/100 MB/);
  });

  it("lists and saves mapping templates, re-runs recognition", async () => {
    const fetchImpl = vi.fn(async (url, init) => {
      if (url.endsWith("/cad/templates") && !init?.method) return okJson({ templates: [{ name: "Client A", rules: [] }, { bad: 1 }] });
      return okJson({ ok: true, candidates: [] });
    });
    expect(await listCadTemplates({ fetchImpl })).toEqual([{ name: "Client A", rules: [] }]);
    await saveCadTemplate({ name: " Client B ", rules: [{ match: "block", pattern: "^JET$", type: "nozzle" }] }, { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ name: "Client B", rules: [{ match: "block", pattern: "^JET$", type: "nozzle" }] });
    await recognizeCadImport(importResponse(), { name: "Client B", rules: [] }, { fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(body.import.recognition).toBeUndefined();
    expect(body.template.name).toBe("Client B");
  });

  it("template rules round-trip the review's apply-to-all-instances overrides", () => {
    const t = cadTemplateFromOverrides("Std", { "block:NOZ.JET(2)": "nozzle", "layer:E-LIGHT": "light", "layer:X": "ignore" });
    expect(t.rules).toHaveLength(2);
    expect(new RegExp(t.rules[0].pattern).test("NOZ.JET(2)")).toBe(true);
    expect(cadOverridesFromTemplate(t)).toEqual({ "block:NOZ.JET(2)": "nozzle", "layer:E-LIGHT": "light" });
  });
});

describe("previewCadImportResponse + applyCadImport", () => {
  it("maps basin, island, candidates, pipes, land and levels through the plan frame", () => {
    const p = previewCadImportResponse(importResponse());
    expect(p.source).toBe("backend");
    expect(p.boundary.id).toBe("2F1");
    expect(p.boundary.points[2]).toEqual({ x: 20, y: -12 });
    expect(p.islands).toHaveLength(1);
    expect(p.fixtures.map(f => f.id)).toEqual(["noz_1", "cad-3A1", "cad-3A2"]);
    expect(p.fixtures[0]).toMatchObject({ x: 3, y: -2, rotation: -90, label: "N-01", cadHandle: "3A0", cadBlock: "NOZZLE_JET_2M" });
    expect(p.fixtures[0].cadFields).toEqual({ model: "JET-25", flow_lpm: 40, height_m: 2 }); // no dmx_address / pump_id
    expect(p.pipes[0]).toMatchObject({ diameterMm: 65, points: [{ x: 1, y: -1 }, { x: 5, y: -1 }] });
    expect(p.landSurfaces[0]).toMatchObject({ type: "grass", cadHandle: "2F4" });
    expect(p.levels).toMatchObject({ copingLevel: 0.5, floorLevel: -0.65, wallHeight: 1.15 });
    expect(p.levels.provenance.floorLevel).toMatch(/attribute FFL/);
    expect(p.underlay.items.length).toBe(5);
    expect(p.groups.find(g => g.key === "block:NOZZLE_JET_2M")).toMatchObject({ count: 2, type: "nozzle" });
  });

  it("group override applies to all instances; per-candidate ignore excludes one", () => {
    const p = previewCadImportResponse(importResponse(), { groupTypes: { "block:NOZZLE_JET_2M": "light" }, candidateTypes: { cand_2: "ignore" } });
    expect(p.fixtures).toHaveLength(2);
    expect(p.fixtures.every(f => f.type === "light_rgb")).toBe(true);
  });

  it("preserves IDs and hardware addresses for XDATA and source-handle matches, never assigns addresses", () => {
    const current = existing();
    const p = previewCadImportResponse(importResponse(), { currentFixtures: current.fixtures });
    expect(p.fixtures[1].id).toBe("jet-7"); // matched by source handle
    const next = applyCadImport(current, p, { mode: "update" });
    const n1 = next.fixtures.find(f => f.id === "noz_1"), n7 = next.fixtures.find(f => f.id === "jet-7");
    expect(n1.engineering).toEqual(current.fixtures[0].engineering);
    expect(n1.type).toBe("nozzle_running");
    expect(n7.engineering).toEqual(current.fixtures[1].engineering);
    expect(n7.x).toBe(6);
    const added = next.fixtures.find(f => f.cadHandle === "3A2");
    expect(added.engineering).toMatchObject({ icanChannel: null, icanGroup: null, plcChannel: null, mappingStatus: "commissioning-required" });
    expect(JSON.stringify(next.fixtures)).not.toMatch(/dmx_address|"P-1"/);
    expect(next.geometry.holes).toHaveLength(1);
    expect(next.params).toMatchObject({ wallHeight: 1.15, floorLevel: -0.65 });
    expect(next.site_surfaces.map(s => s.id)).toEqual(["hand", "cad-land-2F4"]);
    expect(next.cad_underlay.format).toBe("AquaFlowCadUnderlay");
    expect(next.id).toBe("proj-1");
  });

  it("refuses duplicate fixture IDs (copied XDATA)", () => {
    const r = importResponse();
    r.recognition.candidates[1].aquaflow_id = "noz_1";
    expect(() => previewCadImportResponse(r)).toThrow(/Duplicate AquaFlow fixture IDs/);
  });

  it("unitless drawings are rescaled to the chosen unit without re-upload", () => {
    const r = importResponse({ units: { insunits: 0, name: null, to_m: 1, unitless: true, suggested: "mm" } });
    const raw = previewCadImportResponse(r);
    expect(raw.unitless).toBe(true);
    expect(raw.suggestedUnits).toBe("millimeters");
    expect(raw.warnings.join(" ")).toMatch(/unit/);
    const mm = previewCadImportResponse(r, { units: "millimeters" });
    expect(mm.boundary.points[2]).toEqual({ x: 0.02, y: -0.012 });
    expect(rescaleCadImport(r, "meters")).toBe(r);
  });

  it("pick-point origin + edge-align rotation re-frame everything, including the underlay", () => {
    const p = previewCadImportResponse(importResponse(), { frame: { origin: [20, 0], rotationDeg: 90 } });
    expect(p.boundary.points[0].x).toBeCloseTo(0, 9); // (0,0) - (20,0) → (-20,0) → rot90 (0,-20) → flip (0,20)
    expect(p.boundary.points[0].y).toBeCloseTo(20, 9);
    expect(p.underlay.frame).toEqual({ origin: { x: 20, y: 0 }, rotationDeg: 90, flipY: true });
  });

  it("island cuts a hole the 3D raycast falls through; off-centre nozzle lands on the basin", () => {
    const next = applyCadImport({ fixtures: [] }, previewCadImportResponse(importResponse()), { mode: "new" });
    const center = poolCenter(next.geometry, next.params, next.pool_type);
    const geo = poolShapeGeometry(T, centeredPoolPoints(next.geometry.points), centeredPoolHoles(next.geometry.points, next.geometry.holes));
    const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ side: T.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.updateMatrixWorld();
    const hit = (x, z) => new T.Raycaster(new T.Vector3(x, 5, z), new T.Vector3(0, -1, 0)).intersectObject(mesh).length > 0;
    const nozzle = engineeringToWorld(next.fixtures.find(f => f.id === "noz_1"), center);
    expect(hit(nozzle.x, nozzle.z)).toBe(true);
    const islandCentre = engineeringToWorld({ x: 10, y: -6 }, center);
    expect(hit(islandCentre.x, islandCentre.z)).toBe(false);
    geo.dispose(); mesh.material.dispose();
  });

  it("client path round-trips islands through the AquaFlow DXF export", () => {
    const project = { ...existing(), fixtures: [], geometry: { ...existing().geometry, holes: [island.map(([x, y]) => ({ x, y: -y }))] } };
    const p = previewCadImport(parseCadDxf(exportCadDxf(project)));
    expect(p.candidates).toHaveLength(1);
    expect(p.islands).toHaveLength(1);
    expect(applyCadImport(project, p, { mode: "update" }).geometry.holes[0]).toEqual(project.geometry.holes[0]);
  });
});

describe("levels, land and diff helpers", () => {
  it("land materials from hatch patterns / layers", () => {
    expect(landMaterialFor("AR-CONC", "")).toBe("paving");
    expect(landMaterialFor("SOLID", "L-LAWN")).toBe("grass");
    expect(landMaterialFor("GRAVEL", "")).toBe("rock");
    expect(landMaterialFor("ANSI31", "A-WALL")).toBeNull();
  });

  it("levels fall back to defaults with provenance", () => {
    const lv = deriveCadLevels({ entities: [{ handle: "B", z: 0 }], inserts: [], closed_outlines: [] }, "B", {});
    expect(lv).toMatchObject({ copingLevel: 0, wallHeight: 0.8, floorLevel: -0.8 });
    expect(lv.provenance.wallHeight).toMatch(/default/);
    expect(deriveCadLevels({ entities: [], inserts: [] }, "B", { wallHeight: 1.5 })).toMatchObject({ wallHeight: 1.5, floorLevel: -1.5 });
  });

  it("diff matches by XDATA id, then handle, then nearest same type", () => {
    const previous = cadDiffPrevious(existing().fixtures);
    expect(previous[0]).toMatchObject({ id: "noz_1", position: [3, 2], aquaflow_id: "noz_1" });
    const d = diffCadCandidates(previous, importResponse().recognition.candidates);
    expect(d.unchanged.map(u => u.id)).toEqual(["noz_1"]);
    // Same entry shape as the backend diff (candidate_id / match), see docs/CAD-IMPORT-CONTRACT.md.
    expect(d.moved).toEqual([expect.objectContaining({ id: "jet-7", candidate_id: "cand_1", match: "source_handle" })]);
    expect(d.warnings).toEqual([]);
    expect(d.moved[0].distance_m).toBeCloseTo(0.01, 6);
    expect(d.added.map(a => a.id)).toEqual(["cand_2"]);
    expect(d.removed).toEqual([]);
    const gone = diffCadCandidates(previous, []);
    expect(gone.removed.map(r => r.id)).toEqual(["noz_1", "jet-7"]);
  });

  it("requestCadDiff uses the backend and falls back to the local rules", async () => {
    const remote = await requestCadDiff([], [], { fetchImpl: async () => okJson({ added: [1], moved: [], removed: [], unchanged: [] }) });
    expect(remote).toMatchObject({ added: [1], source: "backend" });
    const local = await requestCadDiff([], [{ id: "c", position: [0, 0], type: "nozzle" }], { fetchImpl: async () => { throw new TypeError("down"); } });
    expect(local).toMatchObject({ source: "local", added: [{ id: "c" }] });
  });
});
