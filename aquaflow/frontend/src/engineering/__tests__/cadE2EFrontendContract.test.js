/**
 * AF-CAD end-to-end frontend contract — runs the CAD import dialog's preview/apply logic on a
 * REAL backend response (no hand-written mock).
 *
 * The fixtures are written by backend/tests/test_cad_e2e_frontend_contract.py, which builds a
 * third-party fountain drawing with ezdxf (millimetres; basin + island + depth-zone outline,
 * attributed nozzle blocks, a nested ring block, lights, pump → valve → nozzle PVC DN50 run,
 * lawn hatch) and POSTs it to /api/cad/import and /api/cad/topology via TestClient.
 * Regenerate with:  cd backend && python -m pytest tests/test_cad_e2e_frontend_contract.py -o addopts=""
 *
 * Drawing (CAD metres, +Y up): basin 0..24 × 0..12, island 10..14 × 4..8, depth zone
 * 1..8 × 1..3.5, jets N-01..N-05 at (3..7, 2), ring of 4 jets r = 1.5 around (18, 6),
 * lights at (1, 11) / (23, 11) rotated 45°, pump (26, 2), valve (22, 2).
 */
import { describe, it, expect, vi } from "vitest";
import * as T from "three";
import importResponse from "./fixtures/cad_import_response.json";
import unitlessResponse from "./fixtures/cad_import_unitless_response.json";
import topologyResponse from "./fixtures/cad_topology_response.json";
import {
  previewCadImportResponse, applyCadImport, cadDiffPrevious, cadDiffCandidates, diffCadCandidates,
  cadTopologyInput, cadHydraulicGroups, requestCadImport, requestCadExportDxf, exportCadDxf, parseCadDxf, previewCadImport,
} from "../cadExchange";
import { createCadUnderlay, buildUnderlayIndex } from "../cadUnderlay";
import { engineeringToWorld, poolCenter, cadToWorld } from "../geometryContract";
import { buildHydraulicPreviewPayload } from "../hydraulicAdapter";
import { centeredPoolPoints, centeredPoolHoles, poolShapeGeometry } from "../../components/preview/basinGeometry";
import { createCadUnderlay3D } from "../../components/preview/cadUnderlay3D";

const clone = (v) => structuredClone(v);
const byLayer = (layer) => importResponse.closed_outlines.find((o) => o.layer === layer);
const BASIN = byLayer("F-BASIN-WATER").handle;
const ISLAND = byLayer("F-ISLAND").handle;
const ZONE = byLayer("F-DEPTH-ZONE").handle;
const cand = (pred) => importResponse.recognition.candidates.find(pred);
const PUMP = cand((c) => c.type === "pump");
const VALVE = cand((c) => c.type === "valve");
const N01 = cand((c) => c.tag === "N-01");
const RING = importResponse.recognition.candidates.filter((c) => String(c.source_handle).includes("/"));
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

function basinMesh(project) {
  const geo = poolShapeGeometry(T, centeredPoolPoints(project.geometry.points), centeredPoolHoles(project.geometry.points, project.geometry.holes));
  const mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ side: T.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2; mesh.updateMatrixWorld();
  const hit = (x, z) => new T.Raycaster(new T.Vector3(x, 5, z), new T.Vector3(0, -1, 0)).intersectObject(mesh).length > 0;
  return { hit, dispose: () => { geo.dispose(); mesh.material.dispose(); } };
}

describe("real /api/cad/import response → review preview", () => {
  const preview = previewCadImportResponse(clone(importResponse), { filename: "central_plaza.dxf" });

  it("is a millimetre drawing already converted to metres by the backend", () => {
    expect(importResponse.units).toMatchObject({ name: "mm", unitless: false });
    expect(preview.units).toBe("millimeters");
    expect(preview.unitless).toBe(false);
  });

  it("chooses the basin, ONE island (no double from basin.holes), and keeps the depth zone reference-only", () => {
    expect(preview.boundary.id).toBe(BASIN);
    expect(preview.boundary.points).toEqual([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: -12 }, { x: 0, y: -12 }]);
    expect(preview.islands).toHaveLength(1);
    const xs = preview.islands[0].map((p) => p.x), ys = preview.islands[0].map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([10, 14, -8, -4]);
    const zone = preview.outlines.find((o) => o.id === ZONE);
    expect(zone.excluded).toMatch(/depth/);
    expect(zone.role).toBe("ignore");
    expect(preview.outlines.find((o) => o.id === ISLAND).role).toBe("island");
    // An excluded outline cannot be promoted to basin/island, even by an explicit override.
    const forced = previewCadImportResponse(clone(importResponse), { outlineRoles: { [ZONE]: "island" } });
    expect(forced.islands).toHaveLength(1);
    expect(forced.outlines.find((o) => o.id === ZONE).role).toBe("ignore");
    // Reference-only island: the hole is dropped, not re-added from basin.holes.
    const noIsland = previewCadImportResponse(clone(importResponse), { outlineRoles: { [ISLAND]: "ignore" } });
    expect(noIsland.islands).toHaveLength(0);
  });

  it("maps every recognised component to a fixture at the right plan position", () => {
    expect(preview.fixtures).toHaveLength(13);
    const count = (t) => preview.fixtures.filter((f) => f.type === t).length;
    expect([count("nozzle_geyser"), count("light_rgb"), count("pump"), count("valve")]).toEqual([9, 2, 1, 1]);
    const n01 = preview.fixtures.find((f) => f.label === "N-01");
    expect(n01).toMatchObject({ x: 3, y: -2, cadHandle: N01.source_handle, cadBlock: "NOZZLE_JET_DN25" });
    expect(n01.cadFields).toMatchObject({ model: "JET-25" });
    const light = preview.fixtures.find((f) => f.type === "light_rgb" && f.x === 1);
    expect(light).toMatchObject({ y: -11, rotation: -45 });
    expect(preview.fixtures.find((f) => f.type === "pump")).toMatchObject({ x: 26, y: -2 });
    // Nested ring: one fixture per INSTANCE, keyed by instance_id (block_path/handle).
    const ring = preview.fixtures.filter((f) => String(f.cadHandle).includes("/"));
    expect(ring).toHaveLength(4);
    expect(new Set(ring.map((f) => f.id)).size).toBe(4);
    for (const f of ring) expect(near(Math.hypot(f.x - 18, f.y + 6), 1.5, 1e-6)).toBe(true);
    const inserts = new Set(importResponse.inserts.map((i) => i.instance_id));
    for (const f of preview.fixtures) expect(inserts.has(f.cadHandle)).toBe(true);
  });

  it("pipes, land and the whole-drawing underlay come through in the plan frame", () => {
    expect(preview.pipes).toHaveLength(3);
    expect(preview.pipes[0]).toMatchObject({ diameterMm: 50, cadHandle: "7B", points: [{ x: 26, y: -2 }, { x: 22, y: -2 }] });
    expect(preview.landSurfaces.map((s) => s.type)).toEqual(["grass"]);
    const u = preview.underlay;
    expect(u.layers.map((l) => l.name)).toEqual(expect.arrayContaining(["F-BASIN-WATER", "F-DEPTH-ZONE", "L-LAWN", "A-TEXT"]));
    const basinItem = u.items.find((i) => i.handle === BASIN);
    expect(basinItem.points).toEqual([0, 0, 24, 0, 24, -12, 0, -12]);
    const lineXs = u.items.filter((i) => i.kind === "line").flatMap((i) => i.points.filter((_, k) => k % 2 === 0));
    expect(Math.min(...lineXs)).toBeCloseTo(-6, 6);   // lawn hatch
    expect(Math.max(...lineXs)).toBeCloseTo(30, 6);
    expect(u.bounds.minX).toBeLessThanOrEqual(-6);    // bounds also pad text extents
    const snap = buildUnderlayIndex(u).nearestVertex({ x: 24.05, y: -12.02 }, 0.2);
    expect(snap).toMatchObject({ x: 24, y: -12 });
    expect(createCadUnderlay(clone(importResponse)).items.length).toBe(u.items.length);
  });
});

describe("apply → engineering project → 3D frame", () => {
  const preview = previewCadImportResponse(clone(importResponse));
  const project = applyCadImport({ fixtures: [] }, preview, { mode: "new", name: "Central plaza" });

  it("stores basin, single island hole, fixtures without hardware addresses", () => {
    expect(project.pool_type).toBe("freeform");
    expect(project.params).toMatchObject({ width: 24, length: 12 });
    expect(project.geometry.holes).toHaveLength(1);
    expect(project.fixtures).toHaveLength(13);
    for (const f of project.fixtures) {
      expect(f.engineering).toMatchObject({ plcChannel: null, icanGroup: null, icanChannel: null, mappingStatus: "commissioning-required" });
    }
    expect(JSON.stringify(project.fixtures)).not.toMatch(/dmx_address|candidateId/);
    expect(project.cad_underlay.format).toBe("AquaFlowCadUnderlay");
  });

  it("plan and 3D agree: nozzles on water, island is a hole, depth zone is NOT a hole", () => {
    const center = poolCenter(project.geometry, project.params, project.pool_type);
    expect(center).toEqual({ cx: 12, cy: -6 });
    const mesh = basinMesh(project);
    const world = (f) => engineeringToWorld(f, center);
    const n01 = project.fixtures.find((f) => f.label === "N-01");
    expect(world(n01)).toEqual({ x: -9, z: 4 });
    // single CAD→world chain gives the same answer straight from the CAD coordinates
    expect(cadToWorld(N01.position, undefined, center)).toEqual({ x: -9, z: 4 });
    for (const f of project.fixtures.filter((x) => x.type === "nozzle_geyser")) {
      const w = world(f);
      expect(mesh.hit(w.x, w.z)).toBe(true);
    }
    expect(mesh.hit(0, 0)).toBe(false);                 // island centre (CAD 12, 6)
    const zoneCentre = cadToWorld([4.5, 2.25], undefined, center);
    expect(mesh.hit(zoneCentre.x, zoneCentre.z)).toBe(true);
    const pump = world(project.fixtures.find((f) => f.type === "pump"));
    expect(pump).toEqual({ x: 14, z: 4 });
    expect(mesh.hit(pump.x, pump.z)).toBe(false);       // plant room, outside the basin
    mesh.dispose();
  });

  it("the 3D underlay lands on the same world frame as the basin", () => {
    const center = poolCenter(project.geometry, project.params, project.pool_type);
    const group = createCadUnderlay3D(project.cad_underlay, { toWorld: (p) => engineeringToWorld(p, center) });
    const box = new T.Box3().setFromObject(group);
    expect(box.min.x).toBeCloseTo(-18, 4);  // lawn hatch from CAD x = −6
    expect(box.max.x).toBeCloseTo(18, 4);   // to CAD x = 30
    expect(group.children.length).toBeGreaterThan(0);
    group.dispose?.();
  });
});

describe("re-import: preserve IDs by instance_id / source_handle, diff field names", () => {
  const first = applyCadImport({ fixtures: [] }, previewCadImportResponse(clone(importResponse)), { mode: "new" });
  const ringFixture = first.fixtures.find((f) => f.cadHandle === RING[0].source_handle);
  // Commissioned since the first import; the operator also nudged N-01 in the designer.
  const current = clone(first);
  current.id = "proj-plaza";
  const ringCur = current.fixtures.find((f) => f.id === ringFixture.id);
  ringCur.engineering = { ...ringCur.engineering, icanGroup: 3, icanChannel: 7, mappingStatus: "mapped" };
  const n01Cur = current.fixtures.find((f) => f.label === "N-01");
  n01Cur.x += 0.2;

  it("matches every fixture (nested ring instances included) and keeps their addresses", () => {
    const preview = previewCadImportResponse(clone(importResponse), { currentFixtures: current.fixtures });
    expect(preview.fixtures.every((f) => f.hasIdentity)).toBe(true);
    expect(preview.reviewCandidates.find((c) => c.source_handle === RING[0].source_handle).matchedId).toBe(ringFixture.id);
    const next = applyCadImport(current, preview, { mode: "update" });
    expect(next.fixtures).toHaveLength(13);
    expect(next.fixtures.find((f) => f.id === ringFixture.id).engineering).toMatchObject({ icanGroup: 3, icanChannel: 7, mappingStatus: "mapped" });
    expect(next.fixtures.find((f) => f.id === n01Cur.id).x).toBe(3);   // drawing wins on position
    expect(next.id).toBe("proj-plaza");
  });

  it("diff request uses categories + handles; local fallback answers in the backend's shape", () => {
    const preview = previewCadImportResponse(clone(importResponse), { currentFixtures: current.fixtures });
    const previous = cadDiffPrevious(current.fixtures);
    const candidates = cadDiffCandidates(preview);
    expect(candidates).toHaveLength(13);
    expect(new Set(previous.map((p) => p.type))).toEqual(new Set(["nozzle", "light", "pump", "valve"]));
    expect(candidates.find((c) => c.id === RING[0].id).source_handle).toBe(RING[0].source_handle);
    const d = diffCadCandidates(previous, candidates);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toHaveLength(12);
    expect(d.moved).toEqual([expect.objectContaining({ id: n01Cur.id, candidate_id: N01.id, match: "source_handle" })]);
    expect(d.moved[0].distance_m).toBeCloseTo(0.2, 9);
    // Without handles the same-category proximity rule still pairs a nozzle with a nozzle.
    const anon = diffCadCandidates(previous.map(({ source_handle: _h, aquaflow_id: _a, ...p }) => p), candidates);
    expect(anon.unchanged.every((u) => u.match === "proximity")).toBe(true);
    expect(anon.unchanged).toHaveLength(12);
  });
});

describe("unitless drawing: backend applied the suggested unit — no double scaling", () => {
  it("previews at the same size as the mm drawing, before and after confirming mm", () => {
    expect(unitlessResponse.units).toMatchObject({ unitless: true, suggested: "mm", name: "mm" });
    const raw = previewCadImportResponse(clone(unitlessResponse));
    expect(raw.unitless).toBe(true);
    expect(raw.suggestedUnits).toBe("millimeters");
    expect(raw.boundary.points).toEqual([{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: -12 }, { x: 0, y: -12 }]);
    const confirmed = previewCadImportResponse(clone(unitlessResponse), { units: "millimeters" });
    expect(confirmed.boundary.points).toEqual(raw.boundary.points);
    expect(confirmed.fixtures.find((f) => f.label === "N-01")).toMatchObject({ x: 3, y: -2 });
  });

  it("choosing another unit rescales relative to the applied one (cm = ×10 of mm)", () => {
    const cm = previewCadImportResponse(clone(unitlessResponse), { units: "centimeters" });
    expect(cm.boundary.points[2].x).toBeCloseTo(240, 9);
    expect(cm.boundary.points[2].y).toBeCloseTo(-120, 9);
    expect(cm.fixtures.find((f) => f.label === "N-01")).toMatchObject({ x: 30, y: -20 });
    const m = previewCadImportResponse(clone(unitlessResponse), { units: "meters" });
    expect(m.boundary.points[2].x).toBeCloseTo(24000, 6);
  });
});

describe("hydraulic network step (POST /api/cad/topology)", () => {
  const preview = previewCadImportResponse(clone(importResponse));

  it("builds the topology request from recognition pipes + effective candidates", () => {
    const body = cadTopologyInput(preview);
    expect(body.pipes.map((p) => p.source_handle)).toEqual(["7B", "7C", "7D"]);
    expect(body.candidates).toHaveLength(13);
    expect(body.candidates.find((c) => c.id === PUMP.id)).toMatchObject({ type: "pump", position: [26, 2] });
    const ignoredValve = cadTopologyInput(previewCadImportResponse(clone(importResponse), { candidateTypes: { [VALVE.id]: "ignore" } }));
    expect(ignoredValve.candidates.some((c) => c.id === VALVE.id)).toBe(false);
  });

  it("proposes pump → valve → nozzle groups unconfirmed, with their pipe handles and dangling ends", () => {
    const groups = cadHydraulicGroups(topologyResponse);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ pump: PUMP.id, valves: [VALVE.id], confirmed: false });
    expect(groups[0].nozzles).toHaveLength(5);
    expect(groups[0].pipe_handles.sort()).toEqual(["7B", "7C", "7D"]);
    expect(topologyResponse.dangling).toEqual(expect.arrayContaining([[22, 9]]));
  });

  it("only confirmed groups are stored, as engineering.pumpId / valveId on fixtures and pumpId on pipes", () => {
    const proposed = cadHydraulicGroups(topologyResponse);
    const unconfirmed = applyCadImport({ fixtures: [] }, preview, { mode: "new", hydraulicGroups: proposed });
    expect(unconfirmed.hydraulic_network).toBeUndefined();
    expect(unconfirmed.fixtures.some((f) => f.engineering.pumpId)).toBe(false);

    const project = applyCadImport({ fixtures: [] }, preview, { mode: "new", hydraulicGroups: proposed.map((g) => ({ ...g, confirmed: true })) });
    const pump = project.fixtures.find((f) => f.type === "pump");
    const valve = project.fixtures.find((f) => f.type === "valve");
    const jets = project.fixtures.filter((f) => /^N-0\d$/.test(f.label));
    expect(jets).toHaveLength(5);
    for (const j of jets) expect(j.engineering).toMatchObject({ pumpId: pump.id, valveId: valve.id });
    expect(valve.engineering.pumpId).toBe(pump.id);
    const ring = project.fixtures.filter((f) => String(f.cadHandle).includes("/"));
    expect(ring.every((f) => !f.engineering.pumpId)).toBe(true);   // unattached: not on a pipe
    expect(project.manualPipes.every((p) => p.pumpId === pump.id)).toBe(true);
    expect(project.hydraulic_network).toEqual({ source: "cad", groups: [expect.objectContaining({
      pumpId: pump.id, valveIds: [valve.id], nozzleIds: jets.map((j) => j.id), confirmed: true })] });
    // The solver adapter carries the assignment through to the nozzle payload.
    const payload = buildHydraulicPreviewPayload({ fixtures: project.fixtures });
    expect(payload.nozzles.filter((n) => n.engineering.pumpId === pump.id)).toHaveLength(5);
  });
});

describe("transport: .json → aqf-json route, DXF export through the backend writer", () => {
  const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => body });

  it("routes an AutoLISP .json to /api/cad/import/aqf-json, then runs /api/cad/recognize", async () => {
    const aqf = { format: "AQFEXPORT", version: 1, insunits: 4, inserts: [] };
    const fetchImpl = vi.fn(async (url) => (String(url).includes("aqf-json")
      ? ok({ ...clone(importResponse), recognition: undefined, source: "autolisp" })
      : ok(clone(importResponse.recognition))));
    const file = new File([JSON.stringify(aqf)], "plaza.json", { type: "application/json" });
    const r = await requestCadImport(file, { units: "millimeters", fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/cad\/import\/aqf-json\?units=mm$/);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ data: aqf, filename: "plaza.json" });
    expect(fetchImpl.mock.calls[1][0]).toMatch(/\/api\/cad\/recognize$/);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).import.source).toBe("autolisp");
    expect(r.recognition.candidates).toHaveLength(13);
  });

  it("exports through POST /api/cad/export.dxf, falling back to the browser writer offline", async () => {
    const project = applyCadImport({ fixtures: [] }, previewCadImportResponse(clone(importResponse)), { mode: "new" });
    const backendDxf = "  0\nSECTION\n  2\nHEADER\n  0\nENDSEC\n  0\nEOF\n";
    const fetchImpl = vi.fn(async () => ok(backendDxf));
    const remote = await requestCadExportDxf(project, { fetchImpl });
    expect(remote).toEqual({ dxf: backendDxf, writer: "backend" });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/api\/cad\/export\.dxf\?dimensions=true$/);
    const offline = await requestCadExportDxf(project, { fetchImpl: async () => { throw new TypeError("down"); } });
    expect(offline.writer).toBe("browser");
    expect(offline.dxf).toBe(exportCadDxf(project));
    await expect(requestCadExportDxf(project, { fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ detail: "invalid design: x" }) }) }))
      .rejects.toThrow("invalid design: x");
  });

  it("the browser writer uses the backend writer's layers / XDATA kinds and round-trips the island", () => {
    const project = applyCadImport({ fixtures: [] }, previewCadImportResponse(clone(importResponse)), { mode: "new" });
    const dxf = exportCadDxf(project);
    for (const layer of ["POOL_OUTLINE", "POOL_ISLANDS", "NOZZLES", "LIGHTS", "EQUIPMENT", "PIPEWORK", "LANDSCAPE"]) {
      expect(dxf).toContain(`\n8\n${layer}\n`);
    }
    expect(dxf).toContain("\nHATCH\n");
    const back = previewCadImport(parseCadDxf(dxf));
    expect(back.islands).toHaveLength(1);
    expect(back.fixtures).toHaveLength(13);
    expect(back.fixtures.find((f) => f.id === project.fixtures[0].id)).toMatchObject({ x: project.fixtures[0].x, y: project.fixtures[0].y });
  });
});
