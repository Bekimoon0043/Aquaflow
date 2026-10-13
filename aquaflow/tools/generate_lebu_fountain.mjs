/**
 * generate_lebu_fountain.mjs — AF-NEXT-002 Lebu pilot project generator.
 *
 * Version-controlled successor of the untracked <repo>/.tools/generate_lebu_fountain.mjs
 * (kept untouched). The basin, fixtures and pattern show are the same design; this
 * copy adds deterministic timestamps, saved camera views, source provenance and an
 * explicit "no hardware mapped" record, and writes the portable pilot package
 * instead of the gitignored outputs/ folder:
 *
 *   node aquaflow/tools/generate_lebu_fountain.mjs
 *     → aquaflow/samples/lebu-pilot/Lebu_Fountain_Pilot.aqua
 *     → aquaflow/samples/lebu-pilot/manifest.json  (asset hashes / presence)
 *
 * buildLebuPilot() is pure so tests can compare the committed .aqua to the generator.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { poolCenter } from "../frontend/src/engineering/geometryContract.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");
export const PILOT_DIR = path.resolve(here, "..", "samples", "lebu-pilot");
export const PILOT_FILE = "Lebu_Fountain_Pilot.aqua";
/** Fixed so regenerating the pilot is reproducible (no churn in the committed file). */
export const PILOT_TIMESTAMP = "2026-10-13T00:00:00.000Z";

const r2 = (n) => Number(n.toFixed(2));

export function buildLebuPilot({ savedAt = PILOT_TIMESTAMP } = {}) {
  const round = (n, p = 4) => Number(n.toFixed(p));
  const mix = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const q = ([p0, p1, p2], [w0, w1, w2], t) => {
    const a = (1 - t) ** 2 * w0, b = 2 * (1 - t) * t * w1, c = t ** 2 * w2;
    const d = a + b + c;
    return { x: (a * p0.x + b * p1.x + c * p2.x) / d, y: (a * p0.y + b * p1.y + c * p2.y) / d };
  };
  const sampleCorner = (points, weights, segments = 6) => {
    const result = [];
    for (let half = 0; half < 2; half += 1) {
      const ps = points.slice(half * 2, half * 2 + 3);
      const ws = weights.slice(half * 2, half * 2 + 3);
      for (let i = half ? 1 : 0; i <= segments; i += 1) result.push(q(ps, ws, i / segments));
    }
    return result;
  };
  const point = (x, y) => ({ x, y });
  const corners = {
    top: {
      points: [point(-16.2057834293, 27.4257962387), point(-15.8498367163, 27.8724480580), point(-15.2803041154, 27.9152093336), point(-14.7107715146, 27.9579706092), point(-14.2921209267, 27.5694765997)],
      weights: [1, 0.9165230328, 1, 0.9165230328, 1],
    },
    right: {
      points: [point(-6.3956032031, 20.2417672384), point(-5.7415825009, 19.6348574853), point(-6.0675753286, 18.8043087488), point(-6.3935681564, 17.9737600124), point(-7.2858027261, 17.9737600124)],
      weights: [1, 0.8262465524, 1, 0.8262465524, 1],
    },
    left: {
      points: [point(-21.0219340991, 17.9737600124), point(-21.8440951358, 17.9737600124), point(-22.2009422734, 18.7144413816), point(-22.5577894109, 19.4551227508), point(-22.0453970787, 20.0980868773)],
      weights: [1, 0.8467690282, 1, 0.8467690282, 1],
    },
  };
  const geometryPoints = [
    ...sampleCorner(corners.top.points, corners.top.weights),
    point(-6.3956032031, 20.2417672384),
    ...sampleCorner(corners.right.points, corners.right.weights).slice(1),
    point(-21.0219340991, 17.9737600124),
    ...sampleCorner(corners.left.points, corners.left.weights).slice(1),
    point(-16.2057834293, 27.4257962387),
  ].map(p => ({ x: round(p.x), y: round(p.y) }));

  const center = point(-14.1497, 21.6500);
  const inward = (p, amount = 0.48) => {
    const d = Math.hypot(center.x - p.x, center.y - p.y);
    return point(p.x + (center.x - p.x) * amount / d, p.y + (center.y - p.y) * amount / d);
  };
  const baseA = point(-20.45, 17.97376), baseB = point(-7.86, 17.97376);
  const leftA = point(-21.75, 20.47), leftB = point(-16.56, 26.99);
  const rightA = point(-13.94, 27.24), rightB = point(-6.70, 20.52);
  const placements = [
    ...Array.from({ length: 7 }, (_, i) => ({ ...inward(mix(baseA, baseB, i / 6)), side: "base" })),
    ...Array.from({ length: 4 }, (_, i) => ({ ...inward(mix(leftA, leftB, (i + 0.5) / 4)), side: "left" })),
    ...Array.from({ length: 4 }, (_, i) => ({ ...inward(mix(rightA, rightB, (i + 0.5) / 4)), side: "right" })),
  ];

  const engineering = { jetHeightM: 2.8, flowLpm: 44, pressureBar: 2.6, nozzleDiaMm: 11, connectionSize: "DN25", designSource: "Scene 9_1.png" };
  const fixtures = [];
  placements.forEach((p, i) => {
    const n = String(i + 1).padStart(2, "0");
    fixtures.push({ id: `lebu-perimeter-${n}`, type: "nozzle_straight_dn25", label: `Perimeter Jet ${n}`, x: round(p.x), y: round(p.y), z: 0, rotation: 0, zone: `perimeter-${p.side}`, groupId: "outer_ring_jets", visible: true, engineering: { ...engineering, cadLayer: "Layer 06$fountain", side: p.side } });
    fixtures.push({ id: `lebu-light-${n}`, type: "light_uw_rgb_36w", label: `RGB Light ${n}`, x: round(p.x), y: round(p.y), z: 0, rotation: 0, zone: `perimeter-${p.side}`, groupId: "rgb_lights", visible: true, color: i % 2 ? "#eaf7ff" : "#55bfff", intensity: 4.5, radius: 4.2, engineering: { wattage: 36, beamRadiusM: 4.2, ipRating: "IP68", pairedNozzleId: `lebu-perimeter-${n}` } });
  });
  for (let i = 0; i < 6; i += 1) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / 6;
    const p = point(center.x + Math.cos(angle) * 2.05, center.y + Math.sin(angle) * 1.55);
    const n = String(i + 1).padStart(2, "0");
    fixtures.push({ id: `lebu-inner-arch-${n}`, type: "nozzle_arch_small", label: `Inner Arch ${n}`, x: round(p.x), y: round(p.y), z: 0, rotation: round((angle * 180 / Math.PI + 180) % 360), zone: "inner-crown", groupId: "arch_jets", visible: true, engineering: { jetHeightM: 1.8, flowLpm: 30, pressureBar: 2.2, nozzleDiaMm: 10, connectionSize: "DN20" } });
  }
  fixtures.push({ id: "lebu-center-crown", type: "nozzle_geyser", label: "Central Crown Jet", x: center.x, y: center.y, z: 0.08, rotation: 0, zone: "center-feature", groupId: "center_jets", visible: true, engineering: { jetHeightM: 2.2, flowLpm: 65, pressureBar: 2.8, designNote: "Water crown surrounding the central sculpture shown in the reference render" } });
  fixtures.push({ id: "lebu-center-hero", type: "nozzle_geyser", label: "Central Hero Jet", x: center.x, y: round(center.y - 0.92), z: 0.08, rotation: 0, zone: "center-feature", groupId: "center_jets", visible: true, engineering: { jetHeightM: 3.6, flowLpm: 82, pressureBar: 3.2 } });
  fixtures.push({ id: "lebu-center-light", type: "light_uw_rgb_54w", label: "Central RGB Feature Light", x: center.x, y: center.y, z: 0.1, rotation: 0, zone: "center-feature", groupId: "rgb_lights", visible: true, color: "#ffffff", engineering: { wattage: 54, beamRadiusM: 5.5, ipRating: "IP68" } });

  const ids = group => fixtures.filter(f => f.groupId === group).map(f => f.id);
  const groups = [
    { id: "group-perimeter", name: "Perimeter Jets", memberFixtureIds: ids("outer_ring_jets"), orderMode: "clockwise", color: "#32c8ff" },
    { id: "group-left", name: "Left Side Jets", memberFixtureIds: fixtures.filter(f => f.type.startsWith("nozzle_") && f.zone === "perimeter-left").map(f => f.id), orderMode: "front-to-back", color: "#65d9d0" },
    { id: "group-right", name: "Right Side Jets", memberFixtureIds: fixtures.filter(f => f.type.startsWith("nozzle_") && f.zone === "perimeter-right").map(f => f.id), orderMode: "front-to-back", color: "#65d9d0" },
    { id: "group-inner", name: "Inner Crown Arches", memberFixtureIds: ids("arch_jets"), orderMode: "clockwise", color: "#73b7ff" },
    { id: "group-center", name: "Center Feature", memberFixtureIds: ids("center_jets"), orderMode: "engineering", color: "#ffffff" },
    { id: "group-lights", name: "RGB Underwater Lights", memberFixtureIds: ids("rgb_lights"), orderMode: "clockwise", color: "#3b82f6" },
  ];
  const recipe = (id, groupId, name, effect, start, duration, cycles, intensity, color, order = "engineering", spread = 1) => ({ id, version: 1, groupId, name, effect, start, duration, cycles, spread, intensity, color, attribute: "level", order, seed: 7, muted: false, locked: false });
  const recipes = [
    recipe("r-intro-water", "group-perimeter", "Opening rise", "pulse", 0, 8, 1, 62, "#bfeaff", "center-out", 0.25),
    recipe("r-intro-light", "group-lights", "Moonlight opening", "static", 0, 8, 1, 55, "#dff7ff", "clockwise", 0),
    recipe("r-chase-water", "group-perimeter", "Triangular perimeter chase", "chase", 8, 12, 4, 92, "#4dc8ff", "clockwise", 1),
    recipe("r-chase-light", "group-lights", "Cyan light chase", "wave", 8, 12, 3, 88, "#25bfff", "clockwise", 1),
    recipe("r-left-wave", "group-left", "Mirrored left wave", "wave", 20, 12, 3, 86, "#76ddff", "front-to-back", 0.9),
    recipe("r-right-wave", "group-right", "Mirrored right wave", "wave", 20, 12, 3, 86, "#76ddff", "right-to-left", 0.9),
    recipe("r-inner", "group-inner", "Inner crown ripple", "ripple", 32, 12, 4, 78, "#b7e8ff", "center-out", 0.85),
    recipe("r-center", "group-center", "Center hero pulse", "pulse", 32, 12, 3, 100, "#ffffff", "engineering", 0),
    recipe("r-finale-water", "group-perimeter", "Blue-white finale chase", "chase", 44, 12, 6, 100, "#eaf8ff", "counter-clockwise", 1),
    recipe("r-finale-inner", "group-inner", "Crown sparkle", "sparkle", 44, 12, 6, 94, "#4aa8ff", "clockwise", 1),
    recipe("r-grand", "group-perimeter", "Grand final rise", "static", 56, 4, 1, 100, "#ffffff", "engineering", 0),
    recipe("r-grand-center", "group-center", "Hero finale", "static", 56, 4, 1, 100, "#ffffff", "engineering", 0),
    recipe("r-grand-lights", "group-lights", "White finale", "static", 56, 4, 1, 100, "#ffffff", "engineering", 0),
  ];

  const clip = (id, start, end, label, intensity, color) => ({ id, start, end, label, intensity, ...(color ? { color } : {}) });
  const timelineTracks = [
    { id: "track-perimeter", label: "Perimeter Jets · Pattern", color: "#32c8ff", type: "outer_ring_jets", muted: false, solo: false, clips: [clip("p1",0,8,"Opening Rise",62),clip("p2",8,20,"Clockwise Chase",92),clip("p3",20,32,"Mirrored Waves",86),clip("p4",32,44,"Low Frame",48),clip("p5",44,56,"Blue-White Finale",100),clip("p6",56,60,"Grand Rise",100)] },
    { id: "track-arches", label: "Inner Crown · Ripple", color: "#73b7ff", type: "arch_jets", muted: false, solo: false, clips: [clip("a1",0,8,"Soft Crown",35),clip("a2",8,20,"Following Ripple",58),clip("a3",20,32,"Side Support",64),clip("a4",32,44,"Crown Feature",88),clip("a5",44,56,"Crown Sparkle",94),clip("a6",56,60,"Full Crown",100)] },
    { id: "track-center", label: "Central Sculpture · Hero", color: "#ffffff", type: "center_jets", muted: false, solo: false, clips: [clip("c1",0,8,"Center Glow",42),clip("c2",8,20,"Center Hold",55),clip("c3",20,32,"Center Build",72),clip("c4",32,44,"Hero Pulse",100),clip("c5",44,56,"Hero Hold",82),clip("c6",56,60,"Hero Finale",100)] },
    { id: "track-lights", label: "RGB Underwater Lights", color: "#f59e0b", type: "rgb_lights", muted: false, solo: false, clips: [clip("l1",0,8,"Moon White",55,"#dff7ff"),clip("l2",8,20,"Cyan Chase",88,"#25bfff"),clip("l3",20,32,"Deep Blue",82,"#2266ff"),clip("l4",32,44,"Ice White",96,"#eaf8ff"),clip("l5",44,50,"Finale Blue",100,"#168cff"),clip("l6",50,56,"Finale White",100,"#ffffff"),clip("l7",56,60,"Grand White",100,"#ffffff")] },
    { id: "track-pump", label: "Master Water Level", color: "#00d4ff", type: "pump", muted: false, solo: false, clips: [clip("m1",0,8,"Safe Start",62),clip("m2",8,20,"Chase Pressure",88),clip("m3",20,32,"Wave Pressure",84),clip("m4",32,44,"Center Feature",96),clip("m5",44,56,"Finale Pressure",100),clip("m6",56,60,"Final Hold",100)] },
  ];

  const circle = (cx, cy, radius, count = 24) => Array.from({ length: count }, (_, i) => ({ x: round(cx + Math.cos(i * Math.PI * 2 / count) * radius), y: round(cy + Math.sin(i * Math.PI * 2 / count) * radius) }));
  const now = savedAt;
  const data = {
    aquaflow: "1.1", savedAt: now,
    show: { id: "lebu-fountain-show-v1", name: "Lebu Fountain · CAD Pattern Show", bpm: 120, duration: 60, sampleRate: 48000, loop: true },
    nodes: [], connections: [], timelineTracks, devices: [],
    engineering: {
      format: "AquaFlowPoolGeometry", version: "1.0", id: "lebu-fountain-cad-v1", name: "Lebu Fountain · CAD Design", pool_type: "freeform",
      params: { width: 16.8162, length: 9.9842, radius: 0, depth: 0.8, units: "m" },
      geometry: { type: "polygon", closed: true, points: geometryPoints, source: { file: "lebu fountain.dwg", layer: "Layer 06$fountain", dwgVersion: "AC1021", units: "meters", extents: { minX: -22.5578, minY: 17.9738, maxX: -5.7416, maxY: 27.9580 } } },
      fixtures,
      site_models: [],
      site_surfaces: [{ id: "central-sculpture-island", label: "Central circular sculpture island", type: "rock", color: "#888c92", elevation: 0.12, visible: true, points: circle(center.x, center.y, 1.45) }],
      layers: [
        { key: "pool_outline", label: "CAD Fountain Boundary", visible: true, locked: true, color: "#00aaff" },
        { key: "water_surface", label: "Water Surface", visible: true, locked: false, color: "#168dcc" },
        { key: "landscape", label: "Central Sculpture Island", visible: true, locked: false, color: "#888c92" },
        { key: "nozzles", label: "Nozzles", visible: true, locked: false, color: "#00ccaa" },
        { key: "lights", label: "RGB Lights", visible: true, locked: false, color: "#ffcc00" },
        { key: "measurements", label: "Measurements", visible: true, locked: false, color: "#ffcc00" },
        { key: "annotations", label: "Annotations", visible: true, locked: false, color: "#ffcc00" },
        { key: "pipework", label: "Pipework", visible: false, locked: false, color: "#ff8800" },
        { key: "equipment", label: "Equipment", visible: true, locked: false, color: "#888888" }
      ],
      measurements: [
        { id: "measure-width", x1: -22.5578, y1: 17.5, x2: -5.7416, y2: 17.5, label: "16.82 m overall width" },
        { id: "measure-depth", x1: -23.0, y1: 17.9738, x2: -23.0, y2: 27.9580, label: "9.98 m overall depth" }
      ],
      depth_zones: [{ id: "display", zone: "display", label: "Display Basin", depth: 0.8, color: "#168dcc", points: geometryPoints }],
      manualPipes: [], pipes: [], hydraulics: null, solved_hydraulics: null, bom: [],
      design_notes: ["Pool boundary reconstructed from the dedicated DWG fountain layer in metres.", "Jet and light placement interpreted from Scene 9_1.png because the DWG layer contains only the basin outline.", "Central rock surface represents the circular sculpture plinth; the custom metal orb itself is not embedded as a GLB asset."]
    },
    project: { id: "project-lebu-fountain-v1", name: "Lebu Fountain · CAD Pattern Show", schemaVersion: 2, revision: 1, createdAt: now, modifiedAt: now },
    workspace: { activePanel: "preview" },
    render: { environment: "night", cameraMode: "orbit", quality: "high", pattern: "none", lightColor: "#3aaeff", windX: 0, windZ: 0, waveResponse: 1, waveDamping: 0.985, waveBoundaryDamping: 0.82, reviewMode: true, reviewOverlays: false, showPerformance: true, sidebarOpen: true, sidebarTab: "render", editMode: false, exportResolution: "1080p", exportFps: 60, bakeStart: 0, bakeDuration: 60, bakeAudio: false },
    programmer: { studio: { version: 1, groups, recipes, presets: [], tempo: [{ time: 0, bpm: 120 }], legacyClips: [], markers: [{ id: "mk1", time: 0, name: "Opening" }, { id: "mk2", time: 8, name: "Perimeter chase" }, { id: "mk3", time: 20, name: "Mirrored waves" }, { id: "mk4", time: 32, name: "Center feature" }, { id: "mk5", time: 44, name: "Finale" }, { id: "mk6", time: 56, name: "Grand finish" }], layout: { preset: "Compose", left: 250, right: 292, timeline: 310, view: "plan" } }, timelineClips: [], cues: [], audioDuration: 60, notes: "CAD-derived triangular fountain with editable blue-white choreography." },
    integrations: { siemensSiteId: null },
    automation: { audioData: null, manualPatterns: null, manualPatternMeta: { name: "Lebu Triangular Crown", source: "CAD + Scene 9_1.png" }, manualPriority: false, manualPatternConfig: { patternType: "wave", intensity: 0.9, speed: 1.15, stepLength: 0.5, beatSync: true, steps: [0.35,0.55,0.75,1,0.75,0.55,0.35,0.55,0.75,1,0.75,0.55,0.35,0.55,0.75,1] }, generatedTracks: [] },
    ui: { timelineZoom: 8, showGrid: true, snapToGrid: true }
  };


  // ── AF-NEXT-002 additions ──────────────────────────────────────────────────
  data.show.name = "Lebu Fountain · Pilot";
  data.project.name = "Lebu Fountain · Pilot";
  data.project.id = "project-lebu-fountain-pilot";

  // Saved camera views, in 3D world metres (pool centred on the origin; world z =
  // engineering y − pool centre y — engineering/geometryContract.js).
  const c0 = poolCenter(data.engineering.geometry, data.engineering.params, data.engineering.pool_type);
  const w = (p) => ({ x: r2(p.x - c0.cx), z: r2(p.y - c0.cy) });
  const baseZ = w(point(0, 17.97376)).z;
  const feature = w(center);
  data.render = {
    ...data.render,
    editMode: false,
    cameraMode: "named",
    activeCameraView: "base-audience",
    cameraViews: [
      { id: "plan-top", name: "Plan · top-down", position: { x: 0, y: 22, z: 0.01 }, target: { x: 0, y: 0, z: 0 },
        note: "Plan view of the DWG basin outline and all fixtures." },
      { id: "base-audience", name: "Audience · base edge", position: { x: 0, y: 3.2, z: r2(baseZ - 11) }, target: { x: 0, y: 1.4, z: 0 },
        note: "Eye-level view across the straight base edge. Viewpoint is an assumption, not the render camera." },
      { id: "apex-three-quarter", name: "Three-quarter · apex side", position: { x: 9, y: 6.5, z: 12 }, target: { x: 0, y: 1, z: 0 },
        note: "Elevated overview from the curved apex side." },
      { id: "center-feature", name: "Center feature close-up", position: { x: feature.x, y: 2.4, z: r2(feature.z - 6.2) }, target: { x: feature.x, y: 1.6, z: feature.z },
        note: "Central crown, hero jet and RGB feature light." },
    ],
  };

  data.engineering.provenance = {
    package: "AF-NEXT-002 Lebu pilot",
    fromDrawing: {
      file: "lebu fountain.dwg",
      dwgVersion: "AC1021 (AutoCAD 2007)",
      insunits: "6 (metres)",
      layer: "Layer 06$fountain",
      entities: "3 rational quadratic SPLINE corners (handles 5F60E, 5F610, 5F612) joined by LINE edges (5F60F, 5F611, 5F613)",
      verifiedAgainst: "outputs/lebu_fountain_converted.dxf (LibreDWG dwg2dxf conversion; see manifest.json)",
      fields: ["engineering.geometry.points", "engineering.params.width", "engineering.params.length", "engineering.geometry.source.extents", "engineering.depth_zones[0].points", "engineering.measurements"],
      method: "Each SPLINE is sampled as two rational quadratic Bezier halves from the DXF control points and weights (6 segments per half).",
    },
    interpretedFromRender: {
      file: "Scene 9_1.png",
      status: "render image is not in the package; see manifest.json",
      fields: ["engineering.fixtures (all 39: positions, types, engineering data)", "engineering.site_surfaces (central sculpture island)", "programmer.studio (groups, recipes, markers)", "timelineTracks (pattern show)", "render.cameraViews"],
      note: "The DWG fountain layer contains only the basin outline; no nozzle or light blocks exist in the drawing.",
    },
    assumptions: [
      "Basin depth 0.8 m is a design assumption (not in the DWG layer).",
      "Nozzle/light engineering values (flow, pressure, jet height, wattage) are generic estimates, not manufacturer data.",
      "The show is an original pattern show, not a reproduction of any commissioned controller program.",
    ],
  };

  // Hardware: the Lebu site has no verified controller mapping. Record that
  // explicitly instead of inventing addresses (AQUAFLOW-AI-CODER-BUILD-PLAN: "Do not
  // imply the Lebu project's hardware is mapped or commissioned").
  data.devices = [];
  data.integrations = { siemensSiteId: null };
  data.hardware = {
    status: "unmapped",
    provisional: true,
    addresses: [],
    note: "No controller, DMX/I-CAN or Siemens addresses are assigned. Any address added here must carry provisional: true until site commissioning evidence exists.",
  };
  data.programmer.notes = "AF-NEXT-002 pilot: DWG-derived triangular basin with render-interpreted fixtures and an editable blue-white pattern show. Hardware unmapped.";
  return data;
}

const sha256File = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash("sha256");
  fs.createReadStream(file).on("data", (d) => hash.update(d)).on("error", reject).on("end", () => resolve(hash.digest("hex")));
});

/** Asset list for manifest.json. Paths are relative to the repository root. */
export const PILOT_ASSETS = [
  { path: "aquaflow/samples/lebu-pilot/Lebu_Fountain_Pilot.aqua", role: "project", required: true, committed: true,
    description: "The pilot project. Open it with the Show Browser (Open .aqua) in AquaFlow Studio." },
  { path: "aquaflow/tools/generate_lebu_fountain.mjs", role: "generator", required: false, committed: true,
    description: "Regenerates the .aqua and this manifest." },
  { path: "aquaflow/tools/validate_lebu_fountain.mjs", role: "validator", required: false, committed: true,
    description: "Loads the .aqua through the real loader and re-checks every asset below on this PC." },
  { path: "lebu fountain.dwg", role: "source-cad", required: false, committed: false, expectedLocation: "unknown: the original DWG was not found on the authoring PC",
    description: "Original drawing (AC1021, metres). Only the basin outline on 'Layer 06$fountain' is used." },
  { path: "outputs/lebu_fountain_converted.dxf", role: "derived-cad", required: false, committed: false, expectedLocation: "<repo>/outputs/ (gitignored)",
    description: "LibreDWG dwg2dxf conversion of the DWG; evidence for the basin coordinates. Needed only to re-import the CAD underlay." },
  { path: "outputs/lebu_fountain.min.json", role: "derived-cad-intermediate", required: false, committed: false, expectedLocation: "<repo>/outputs/ (gitignored)",
    description: "LibreDWG minified JSON dump used by .tools/analyze_libredwg_json.py to locate the fountain layer." },
  { path: "Scene 9_1.png", role: "reference-render", required: false, committed: false, expectedLocation: "unknown: the render image was not found on the authoring PC",
    description: "Visual reference from which fixture placement and colours were interpreted." },
];

/** Check each asset on THIS PC (presence, size, sha256). */
export async function scanAssets(assets = PILOT_ASSETS) {
  const out = [];
  for (const asset of assets) {
    const abs = path.resolve(REPO_ROOT, asset.path);
    const present = fs.existsSync(abs) && fs.statSync(abs).isFile();
    out.push({
      ...asset,
      sha256: present ? await sha256File(abs) : (asset.sha256 ?? null),
      size: present ? fs.statSync(abs).size : (asset.size ?? null),
      status: present ? "present" : "missing",
    });
  }
  return out;
}

export async function buildManifest({ recordedAt = PILOT_TIMESTAMP } = {}) {
  return {
    format: "AquaFlowPilotManifest",
    version: 1,
    ticket: "AF-NEXT-002",
    project: "aquaflow/samples/lebu-pilot/Lebu_Fountain_Pilot.aqua",
    statusRecordedAt: recordedAt,
    statusNote: "status/sha256/size were recorded on the authoring PC. Run `cd aquaflow/frontend && npx vite-node ../tools/validate_lebu_fountain.mjs` to re-check on this PC. Only role=project is required to open the pilot; everything else is optional provenance. Large CAD files are referenced by hash and expected location and are NOT committed.",
    hardware: { status: "unmapped", provisional: true, addresses: [] },
    assets: await scanAssets(),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const data = buildLebuPilot();
  fs.mkdirSync(PILOT_DIR, { recursive: true });
  const out = path.join(PILOT_DIR, PILOT_FILE);
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + "\n");
  const manifest = await buildManifest();
  fs.writeFileSync(path.join(PILOT_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const fixtures = data.engineering.fixtures;
  console.log(JSON.stringify({
    output: path.relative(REPO_ROOT, out),
    geometryPoints: data.engineering.geometry.points.length,
    fixtures: fixtures.length,
    waterFixtures: fixtures.filter(f => f.type.startsWith("nozzle_")).length,
    lightFixtures: fixtures.filter(f => f.type.startsWith("light_")).length,
    recipes: data.programmer.studio.recipes.length,
    tracks: data.timelineTracks.length,
    cameraViews: data.render.cameraViews.length,
    assets: manifest.assets.map(a => `${a.status.padEnd(7)} ${a.path}`),
  }, null, 2));
}
