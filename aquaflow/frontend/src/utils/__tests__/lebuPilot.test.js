// AF-NEXT-002: the committed Lebu pilot opens through the real project loader and
// shows the same layout, groups and programmed colours on any PC.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deserializeShow } from "../showFile";
import { deriveRuntimeSignals } from "../runtimeSignalSelector";
import { resolveCameraView, normalizeCameraViews } from "../cameraViews";
import { compileStudio, inventory, sampleClips } from "../../components/programmer/studio/showModel";
import { poolCenter } from "../../engineering/geometryContract";
import { buildLebuPilot } from "../../../../tools/generate_lebu_fountain.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pilotDir = path.resolve(here, "..", "..", "..", "..", "samples", "lebu-pilot");
const raw = () => JSON.parse(fs.readFileSync(path.join(pilotDir, "Lebu_Fountain_Pilot.aqua"), "utf8"));

const insidePolygon = (p, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

describe("Lebu pilot package (AF-NEXT-002)", () => {
  it("committed .aqua matches the version-controlled generator", () => {
    expect(raw()).toEqual(JSON.parse(JSON.stringify(buildLebuPilot())));
  });

  it("loads the DWG-derived basin and every fixture inside it", () => {
    const state = deserializeShow(raw());
    const project = state.engineeringProject;
    expect(state.currentShow.name).toBe("Lebu Fountain · Pilot");
    expect(state.currentShow.duration).toBe(60);
    expect(project.pool_type).toBe("freeform");
    expect(project.geometry.points).toHaveLength(40);
    expect(project.geometry.source).toMatchObject({ layer: "Layer 06$fountain", units: "meters", dwgVersion: "AC1021" });
    const xs = project.geometry.points.map(p => p.x), ys = project.geometry.points.map(p => p.y);
    // Sampled spline corners stay inside the DWG control-point extents.
    const ext = project.geometry.source.extents;
    expect(Math.min(...xs)).toBeCloseTo(-22.3265, 3);
    expect(Math.max(...xs)).toBeCloseTo(-5.9773, 3);
    expect(Math.min(...ys)).toBeCloseTo(17.9738, 3);
    expect(Math.max(...ys)).toBeCloseTo(27.9165, 3);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(ext.minX);
    expect(Math.max(...xs)).toBeLessThanOrEqual(ext.maxX);
    expect(Math.max(...ys)).toBeLessThanOrEqual(ext.maxY);
    const water = project.fixtures.filter(f => f.type.startsWith("nozzle_"));
    const lights = project.fixtures.filter(f => f.type.startsWith("light_"));
    expect(water).toHaveLength(23);
    expect(lights).toHaveLength(16);
    for (const f of project.fixtures) expect(insidePolygon(f, project.geometry.points)).toBe(true);
    expect(project.provenance.fromDrawing.layer).toBe("Layer 06$fountain");
    expect(project.provenance.interpretedFromRender.file).toBe("Scene 9_1.png");
  });

  it("keeps groups resolvable and hardware explicitly unmapped", () => {
    const data = raw();
    const state = deserializeShow(data);
    const ids = new Set(state.engineeringProject.fixtures.map(f => f.id));
    const groups = data.programmer.studio.groups;
    expect(groups.map(g => g.id)).toEqual(["group-perimeter", "group-left", "group-right", "group-inner", "group-center", "group-lights"]);
    for (const g of groups) {
      expect(g.memberFixtureIds.length).toBeGreaterThan(0);
      for (const id of g.memberFixtureIds) expect(ids.has(id)).toBe(true);
    }
    expect(groups.find(g => g.id === "group-perimeter").memberFixtureIds).toHaveLength(15);
    expect(groups.find(g => g.id === "group-lights").memberFixtureIds).toHaveLength(16);
    expect(state.devices).toEqual([]);
    expect(data.hardware).toMatchObject({ status: "unmapped", provisional: true, addresses: [] });
  });

  it("resolves the programmed pattern colours", () => {
    const data = raw();
    const state = deserializeShow(data);
    const project = state.engineeringProject;
    const items = inventory(project.fixtures, project.site_models, poolCenter(project.geometry, project.params));
    const compiled = compileStudio(data.programmer.studio, items);
    expect(compiled.issues).toEqual([]);
    const lightColorAt = (t) => {
      const levels = sampleClips(compiled.clips, t);
      return new Set(Object.entries(levels).filter(([id, v]) => id.startsWith("lebu-light-") && v.value > 0).map(([, v]) => v.color));
    };
    expect([...lightColorAt(4)]).toEqual(["#dff7ff"]);   // Moonlight opening
    expect([...lightColorAt(14)]).toEqual(["#25bfff"]);  // Cyan light chase
    expect([...lightColorAt(58)]).toEqual(["#ffffff"]);  // White finale

    // Legacy timeline lighting track (what the embedded 3D preview reads).
    const signal = deriveRuntimeSignals({ timelineTracks: state.timelineTracks, playhead: 26, playbackState: "playing", mode: "timeline" });
    const c = signal.lightingColor;
    expect(c.b).toBeGreaterThan(c.r);          // "Deep Blue" #2266ff
    expect(c.b).toBeGreaterThan(c.g);
  });

  it("restores the saved camera views", () => {
    const state = deserializeShow(raw());
    const render = state.projectDocument.render;
    expect(render.cameraMode).toBe("named");
    expect(normalizeCameraViews(render.cameraViews).map(v => v.id)).toEqual(["plan-top", "base-audience", "apex-three-quarter", "center-feature"]);
    const view = resolveCameraView(render);
    expect(view.id).toBe("base-audience");
    expect(view.position.z).toBeLessThan(-10);   // in front of the straight base edge
  });
});

describe("cameraViews helpers", () => {
  it("drops malformed and duplicate views", () => {
    const views = normalizeCameraViews([
      { id: "a", position: { x: 0, y: 1, z: 2 }, target: { x: 0, y: 0, z: 0 } },
      { id: "a", position: { x: 9, y: 9, z: 9 }, target: { x: 0, y: 0, z: 0 } },
      { id: "b", position: { x: "nope", y: 1, z: 2 }, target: { x: 0, y: 0, z: 0 } },
      { position: { x: 0, y: 1, z: 2 }, target: { x: 0, y: 0, z: 0 } },
    ]);
    expect(views).toEqual([{ id: "a", name: "a", position: { x: 0, y: 1, z: 2 }, target: { x: 0, y: 0, z: 0 } }]);
    expect(resolveCameraView({ cameraViews: views, activeCameraView: "missing" })).toBeNull();
    expect(resolveCameraView({})).toBeNull();
  });
});
