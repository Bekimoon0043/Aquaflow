/**
 * AF-NEXT-010 (= AF-CAD-013) acceptance — multi-basin data model + CAD round trip, frontend side.
 *
 * Fixtures come from backend/tests/test_af_next_010_multibasin_roundtrip.py (REAL /api/cad/import
 * output): a millimetre drawing with TWO basins (A 0..20 × 0..10 m with an island 8..12 × 3..7,
 * B 26..36 × 0..8 m), jets N-01..N-03 in A, N-11/N-12 in B, lights L-01 (A) and L-11 (B).
 * Regenerate: cd backend && python -m pytest tests/test_af_next_010_multibasin_roundtrip.py -o addopts=""
 *
 * Flow: import → confirm fixtures (applyCadImport) → edit one item (move N-02, change controller
 * addresses) → export DXF (browser writer, and the backend writer's re-import fixture) → re-import
 * → basin boundaries, fixture IDs, layer, coordinates (≤ 1 mm) and controller addresses survive with
 * no duplicates and no unexplained movement. Unknown units require explicit confirmation.
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import * as T from "three";
import importResponse from "./fixtures/cad_multibasin_import_response.json";
import reimportResponse from "./fixtures/cad_multibasin_reimport_response.json";
import backendDesign from "./fixtures/cad_multibasin_design.json";
import unitlessResponse from "./fixtures/cad_import_unitless_response.json";
import {
  previewCadImportResponse, applyCadImport, exportCadDxf, parseCadDxf, previewCadImport, requestCadExportDxf,
  diffCadCandidates, cadDiffPrevious, cadDiffCandidates,
} from "../cadExchange";
import { normalizeEngineeringProject } from "../engineeringProject";
import {
  basinToGeometry, geometryToBasin, reconcileBasins, basinForPoint, composeActiveBasin, createBasinBeside,
  upsertBasinDepthZone, zonesForBasin, basinsInWorld,
} from "../basins";
import { poolCenter } from "../geometryContract";
import { buildHydraulicPreviewPayload } from "../hydraulicAdapter";
import { geometryToPoolConfig } from "../../hooks/fixtureTypeMap";
import { multiBasinWorld } from "../../components/preview/sceneBasin";
import { createBasinMask } from "../../components/preview/basinMask";
import { maskedWaterGeometry, deckWithOpening } from "../../components/preview/basinGeometry";
import useEngineeringStore from "../../store/engineeringStore";

globalThis.React = React;
const clone = (v) => structuredClone(v);
const MM = 1e-3;
const near = (a, b, tol = MM) => Math.abs(a - b) <= tol;
const samePt = (a, b, tol = MM) => near(a.x, b.x, tol) && near(a.y, b.y, tol);
const sameRing = (a, b) => a.length === b.length && b.every(p => a.some(q => samePt(p, q)));
const handleOf = (layer, i = 0) => importResponse.closed_outlines.filter(o => o.layer === layer)[i].handle;
const BASIN_A = handleOf("F-BASIN-WATER", 0), BASIN_B = handleOf("F-BASIN-WATER", 1), ISLAND = handleOf("F-ISLAND");
const plan = ([x, y]) => ({ x, y: -y === 0 ? 0 : -y });

function importAndConfirm() {
  const preview = previewCadImportResponse(clone(importResponse), { filename: "two_basins.dxf" });
  return { preview, project: applyCadImport({ fixtures: [] }, preview, { mode: "new", name: "Two basin plaza" }) };
}

function editOneItem(project) {
  const p = clone(project);
  const n02 = p.fixtures.find(f => f.label === "N-02");
  n02.x += 0.5; n02.y += 0.25;                                                   // move a fixture
  const l01 = p.fixtures.find(f => f.label === "L-01");
  l01.engineering = { ...l01.engineering, dmxAddress: 205, mappingStatus: "commissioned" };   // controller address
  const n11 = p.fixtures.find(f => f.label === "N-11");
  n11.engineering = { ...n11.engineering, plcChannel: 12, icanGroup: 2, icanChannel: 7 };
  return p;
}

describe("AF-NEXT-010 import: every chosen basin becomes a basin", () => {
  const { preview, project } = importAndConfirm();

  it("offers both basins by default with no 'one basin' warning, the island attached to basin A", () => {
    expect(preview.basins.map(b => b.handle)).toEqual([BASIN_A, BASIN_B]);
    expect(preview.warnings.join(" ")).not.toMatch(/one basin/i);
    expect(preview.basins[0].islands).toHaveLength(1);
    expect(preview.basins[1].islands).toHaveLength(0);
    expect(preview.basins[0].islandHandles).toEqual([ISLAND]);
  });

  it("an island whose parent_handle is missing still attaches to the basin that contains it", () => {
    const r = clone(importResponse);
    r.closed_outlines.find(o => o.handle === ISLAND).parent_handle = null;
    const p = previewCadImportResponse(r, {});
    expect(p.basins[0].islands).toHaveLength(1);
    expect(p.basins[1].islands).toHaveLength(0);
  });

  it("the user can drop a basin back to reference only (choice respected)", () => {
    const p = previewCadImportResponse(clone(importResponse), { outlineRoles: { [BASIN_B]: "ignore" } });
    expect(p.basins.map(b => b.handle)).toEqual([BASIN_A]);
  });

  it("confirmed project: basins[] with holes and levels, legacy geometry = basins[0]", () => {
    expect(project.basins.map(b => b.id)).toEqual([`basin-${BASIN_A}`, `basin-${BASIN_B}`]);
    expect(sameRing(project.basins[0].outer, [[0, 0], [20, 0], [20, 10], [0, 10]].map(plan))).toBe(true);
    expect(sameRing(project.basins[1].outer, [[26, 0], [36, 0], [36, 8], [26, 8]].map(plan))).toBe(true);
    expect(sameRing(project.basins[0].holes[0], [[8, 3], [12, 3], [12, 7], [8, 7]].map(plan))).toBe(true);
    expect(project.basins[1].holes).toEqual([]);
    expect(project.basins.every(b => Number.isFinite(b.wallHeight) && Number.isFinite(b.floorLevel))).toBe(true);
    expect(project.geometry).toEqual(basinToGeometry(project.basins[0]));
    expect(project.fixtures).toHaveLength(7);
    expect(new Set(project.fixtures.map(f => f.id)).size).toBe(7);
    const labelsIn = id => project.fixtures.filter(f => basinForPoint(project.basins, f)?.id === id).map(f => f.label).sort();
    expect(labelsIn(project.basins[0].id)).toEqual(["L-01", "N-01", "N-02", "N-03"]);
    expect(labelsIn(project.basins[1].id)).toEqual(["L-11", "N-11", "N-12"]);
  });

  it("the import dialog lists 2 basins and enables Import; a unitless drawing must confirm units first", async () => {
    const { default: CADImportDialog } = await import("../../components/panels/CADImportDialog");
    const html = renderToString(React.createElement(CADImportDialog, {
      currentProject: { name: "Site", fixtures: [] }, onApply() {}, onClose() {}, initialImport: { response: clone(importResponse), fileName: "two_basins.dxf" },
    })).replace(/<!-- -->/g, "");
    expect(html).toContain("2 basins");
    expect(html).not.toMatch(/disabled=""[^>]*>Import<\/button>/);
    const unitless = renderToString(React.createElement(CADImportDialog, {
      currentProject: { name: "Site", fixtures: [] }, onApply() {}, onClose() {}, initialImport: { response: clone(unitlessResponse), fileName: "x.dxf" },
    }));
    expect(unitless).toContain("does not say which units");
    expect(unitless).toMatch(/disabled=""[^>]*>Import<\/button>/);
  });

  it("unknown units: backend preview flags them; the browser parser refuses until units are chosen", () => {
    const p = previewCadImportResponse(clone(unitlessResponse), {});
    expect(p.unitless).toBe(true);
    expect(p.warnings.join(" ")).toMatch(/no unit declaration/i);
    const dxf = exportCadDxf(project).replace(/(\$INSUNITS\n70\n)\s*6/, "$1     0");
    const parsed = parseCadDxf(dxf);
    expect(parsed.units).toBeNull();
    expect(() => previewCadImport(parsed, {})).toThrow(/unit/i);
    expect(previewCadImport(parsed, { units: "meters" }).basins).toHaveLength(2);
  });
});

describe("AF-NEXT-010 round trip: edit → export DXF → re-import", () => {
  const { project } = importAndConfirm();
  const edited = editOneItem(normalizeEngineeringProject(JSON.parse(JSON.stringify(project))));   // .aqua save/load

  function assertSurvives(after, before) {
    expect(after.basins.map(b => b.id)).toEqual(before.basins.map(b => b.id));
    before.basins.forEach((b, i) => {
      expect(sameRing(after.basins[i].outer, b.outer)).toBe(true);
      expect(after.basins[i].holes).toHaveLength(b.holes.length);
      b.holes.forEach((h, j) => expect(sameRing(after.basins[i].holes[j], h)).toBe(true));
    });
    expect(after.fixtures).toHaveLength(before.fixtures.length);
    expect(new Set(after.fixtures.map(f => f.id)).size).toBe(after.fixtures.length);          // no duplicates
    for (const f of before.fixtures) {
      const g = after.fixtures.find(x => x.id === f.id);
      expect(g, f.label).toBeTruthy();
      expect(samePt(g, f)).toBe(true);                                                           // ≤ 1 mm, no drift
      expect(g.engineering).toEqual(f.engineering);                                              // addresses kept
      expect(g.type).toBe(f.type);
    }
  }

  it("browser writer → browser importer keeps basins, islands, ids, coordinates and addresses", () => {
    const parsed = parseCadDxf(exportCadDxf(edited));
    const preview = previewCadImport(parsed, {});
    expect(preview.basins.map(b => b.id)).toEqual(edited.basins.map(b => b.id));
    expect(preview.basins.map(b => b.islands.length)).toEqual([1, 0]);
    expect(preview.basins[0].levels.floorLevel).toBe(edited.basins[0].floorLevel);
    const after = applyCadImport(edited, preview, { mode: "update" });
    assertSurvives(after, edited);
    expect(after.fixtures.find(f => f.label === "L-01").engineering.dmxAddress).toBe(205);
    expect(after.fixtures.find(f => f.label === "N-11").engineering.plcChannel).toBe(12);
    expect(new Set(after.fixtures.map(f => f.cadLayer))).toEqual(new Set(["NOZZLES", "LIGHTS"]));
  });

  it("the diff before applying shows no unexplained movement (only the edited fixture vs the original)", () => {
    const preview = previewCadImport(parseCadDxf(exportCadDxf(edited)), {});
    const cands = preview.fixtures.map(f => ({ id: f.id, type: /^light/.test(f.type) ? "light" : "nozzle", position: [f.x, -f.y], aquaflow_id: f.id }));
    const same = diffCadCandidates(cadDiffPrevious(edited.fixtures), cands);
    expect(same.moved).toEqual([]); expect(same.added).toEqual([]); expect(same.removed).toEqual([]);
    const vsOriginal = diffCadCandidates(cadDiffPrevious(project.fixtures), cands);
    expect(vsOriginal.moved.map(m => m.id)).toEqual([project.fixtures.find(f => f.label === "N-02").id]);
    expect(vsOriginal.moved[0].distance_m).toBeCloseTo(Math.hypot(0.5, 0.25), 3);
  });

  it("backend writer (services/cad_export.py) → backend importer → update keeps everything", () => {
    const current = normalizeEngineeringProject(clone(backendDesign));
    const preview = previewCadImportResponse(clone(reimportResponse), { currentFixtures: current.fixtures });
    expect(preview.basins.map(b => b.id)).toEqual(current.basins.map(b => b.id));
    expect(preview.basins.map(b => b.name)).toEqual(["Basin 1", "Basin 2"]);
    expect(preview.basins[0].levels.provenance.floorLevel).toBe("AQUAFLOW XDATA");
    expect(preview.reviewCandidates.every(c => c.matchedId)).toBe(true);
    const diff = diffCadCandidates(cadDiffPrevious(current.fixtures), cadDiffCandidates(preview));
    expect(diff.moved).toEqual([]); expect(diff.added).toEqual([]); expect(diff.removed).toEqual([]);
    const after = applyCadImport(current, preview, { mode: "update" });
    assertSurvives(after, current);
    expect(after.fixtures.find(f => f.label === "L-01").engineering.dmxAddress).toBe(205);
    expect(after.fixtures.find(f => f.label === "N-11").engineering).toMatchObject({ plcChannel: 12, icanGroup: 2, icanChannel: 7 });
    expect(after.basins[0].floorLevel).toBe(-0.8);
  });

  it("the designer export goes to the backend writer with every basin, and falls back to the browser writer", async () => {
    let sent = null;
    const ok = await requestCadExportDxf(edited, { fetchImpl: async (_url, init) => { sent = JSON.parse(init.body); return { ok: true, text: async () => "0\nSECTION\n" }; } });
    expect(ok.writer).toBe("backend");
    expect(sent.basins.map(b => b.id)).toEqual(edited.basins.map(b => b.id));
    const down = await requestCadExportDxf(edited, { fetchImpl: async () => { throw new TypeError("offline"); } });
    expect(down.writer).toBe("browser");
    expect(down.dxf.match(/POOL_OUTLINE/g).length).toBeGreaterThanOrEqual(2);
  });
});

describe("AF-NEXT-010 data model: lossless migration and per-basin depth zones", () => {
  const legacy = {
    pool_type: "freeform", params: { width: 8, length: 6, depth: 1.1 },
    geometry: { type: "freeform", closed: true, floorLevel: -1.2, wallHeight: 1.3,
      points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }],
      holes: [[{ x: 3, y: 2 }, { x: 5, y: 2 }, { x: 5, y: 4 }]] },
    depth_zones: [{ id: "deep", zone: "deep", depth: 1.5, points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] },
      { id: "shallow", zone: "shallow", depth: 0.3, points: [] }],
  };

  it("legacy .aqua engineering → basins[0] holds geometry+holes+levels, geometry unchanged", () => {
    const n = normalizeEngineeringProject(clone(legacy));
    expect(n.geometry).toEqual(legacy.geometry);
    expect(n.basins).toHaveLength(1);
    expect(basinToGeometry(n.basins[0])).toEqual(legacy.geometry);
    expect(n.basins[0]).toMatchObject({ floorLevel: -1.2, wallHeight: 1.3, poolType: "freeform" });
    expect(n.basins[0].depthZones.map(z => z.id)).toEqual(["deep"]);
    expect(n.depth_zones).toEqual(legacy.depth_zones);                         // flat list untouched
    // Save → load is stable.
    expect(normalizeEngineeringProject(JSON.parse(JSON.stringify(n))).basins).toEqual(n.basins);
  });

  it("circle and ellipse geometry round-trip natively; basins-only files get geometry from basins[0]", () => {
    const circle = { type: "circle", center: { x: 3, y: 4 }, radius: 2.5, wallHeight: 0.9 };
    expect(basinToGeometry(geometryToBasin(circle))).toEqual(circle);
    const n = normalizeEngineeringProject({ basins: [geometryToBasin(circle, { id: "c" }), geometryToBasin(legacy.geometry, { id: "p" })] });
    expect(n.geometry).toEqual(circle);
    expect(n.basins.map(b => b.id)).toEqual(["c", "p"]);
  });

  it("a legacy writer that changes only `geometry` updates basins[0] and keeps basin 2", () => {
    const basins = [geometryToBasin(legacy.geometry, { id: "a" }), geometryToBasin(legacy.geometry, { id: "b" })];
    const moved = { ...legacy.geometry, points: legacy.geometry.points.map(p => ({ x: p.x + 1, y: p.y })) };
    const r = reconcileBasins({ basins, geometry: moved });
    expect(r.map(b => b.id)).toEqual(["a", "b"]);
    expect(r[0].outer[0]).toEqual({ x: 1, y: 0 });
    useEngineeringStore.getState().loadProject({ ...clone(legacy), basins });
    useEngineeringStore.getState().updateEngineering({ geometry: moved });
    const s = useEngineeringStore.getState();
    expect(s.basins.map(b => b.id)).toEqual(["a", "b"]);
    expect(s.getProjectPayload().basins[0].outer[0]).toEqual({ x: 1, y: 0 });
    useEngineeringStore.getState().resetProject();
  });

  it("designer helpers: add a basin beside, compose the active one, scope depth zones per basin", () => {
    const a = geometryToBasin(legacy.geometry, { id: "basin-1" });
    const b = createBasinBeside([a]);
    expect(b.id).toBe("basin-2");
    expect(Math.min(...b.outer.map(p => p.x))).toBe(10);
    const edited = composeActiveBasin([a, b], 1, { geometry: { type: "freeform", closed: true, points: b.outer.map(p => ({ x: p.x, y: p.y + 1 })) }, poolType: "freeform", params: { depth: 0.6 } });
    expect(edited[1]).toMatchObject({ id: "basin-2", params: { depth: 0.6 } });
    let zones = clone(legacy.depth_zones);
    zones = upsertBasinDepthZone(zones, { zoneKey: "deep", basinId: "basin-2", primaryId: "basin-1", points: [{ x: 11, y: 1 }, { x: 12, y: 1 }, { x: 12, y: 2 }] });
    zones = upsertBasinDepthZone(zones, { zoneKey: "shallow", basinId: "basin-1", primaryId: "basin-1", points: [{ x: 6, y: 4 }, { x: 7, y: 4 }, { x: 7, y: 5 }] });
    expect(zonesForBasin(zones, "basin-1", "basin-1").map(z => z.id).sort()).toEqual(["deep", "shallow"]);
    expect(zonesForBasin(zones, "basin-2", "basin-1").map(z => z.id)).toEqual(["deep-basin-2"]);
  });

  it("hydraulic preview payload carries every basin", () => {
    const { project } = importAndConfirm();
    const payload = buildHydraulicPreviewPayload({ fixtures: project.fixtures, params: project.params, basins: project.basins });
    expect(payload.basins.map(b => b.id)).toEqual(project.basins.map(b => b.id));
    expect(buildHydraulicPreviewPayload({ fixtures: [], basins: [project.basins[0]] }).basins).toBeUndefined();
  });
});

describe("AF-NEXT-010 3D: every basin rendered and in the shared mask", () => {
  const { project } = importAndConfirm();
  const config = geometryToPoolConfig(project.geometry, project.params, project.pool_type, project.basins);
  const world = multiBasinWorld(config);
  const mask = createBasinMask(world.all.map(b => ({ outer: b.outer, holes: b.holes })));
  const center = poolCenter(project.geometry, project.params, project.pool_type);
  const toWorld = (f) => [f.x - center.cx, f.y - center.cy];

  it("keeps the primary basin's centre as the world origin (same shift as fixtures)", () => {
    expect(config.basins).toHaveLength(2);
    expect(geometryToPoolConfig(project.geometry, project.params, project.pool_type, [project.basins[0]]).basins).toBeUndefined();
    expect(basinsInWorld(project.basins, center)[1].outer).toEqual(world.extra[0].outer);
    const xs = world.primary.outer.map(p => p.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(0, 9);
    expect(world.width).toBeCloseTo(2 * (36 - 10), 6);   // symmetric extent covers basin B
  });

  it("mask: water in both basins, not on the island, not between basins; every fixture is wet", () => {
    for (const f of project.fixtures) expect(mask.contains(...toWorld(f)), f.label).toBe(true);
    expect(mask.contains(...toWorld({ x: 10, y: -5 }))).toBe(false);          // island centre
    expect(mask.contains(...toWorld({ x: 23, y: -4 }))).toBe(false);          // gap between basins
    expect(mask.contains(...toWorld({ x: 31, y: -4 }))).toBe(true);           // basin B
  });

  it("water surface covers both basins; deck has one opening per basin", () => {
    const water = maskedWaterGeometry(T, mask, 120);
    expect(water.index.count).toBeGreaterThan(0);
    const pos = water.attributes.position, idx = water.index.array;
    let inB = 0;
    for (let t = 0; t < idx.length; t += 3) {
      const x = (pos.getX(idx[t]) + pos.getX(idx[t + 1]) + pos.getX(idx[t + 2])) / 3;
      if (x > 16 - center.cx) inB += 1;
    }
    expect(inB).toBeGreaterThan(0);
    const deck = deckWithOpening(T, { poolType: "freeform", points: world.primary.outer, extraBasins: world.extra }, 120);
    expect(deck.attributes.position.count).toBeGreaterThan(0);
    water.dispose(); deck.dispose();
  });
});
