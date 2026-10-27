// Green Tree Fountain — 65 vertical clear jets on a 13 × 5 grid (0.50 m across × 0.75 m deep,
// 6.00 × 3.00 m footprint) whose heights taper from 4.5 m at the centre to 0.36 m at the corners,
// coloured like the user's concept sheet: yellow tips, green canopy, orange edge, purple trunk.
//   vite-node --root . scripts/build-green-tree.mjs <template.aquapkg> <out.aquapkg>
//
// Source: scripts/data/green-tree-nozzles.csv (the user's nozzle schedule, copied verbatim) and the
// concept plan PDF: centre row 100 % of the front profile, inner rows 82 %, outer rows 60 %.
// Colour regions (see band()): yellow centre peak, orange side edges, green canopy.
// The schedule has no trunk jets, so the purple trunk is a light layer: three 30° spots behind the
// centre, aimed toward the audience at the lower columns (forward scatter).
// Each jet has its own solenoid; three VFD zones (centre row, inner rows, outer rows) as the PDF's
// commissioning note asks. Plan: x across, y depth, audience on +y.
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";

const [tplPath, out] = process.argv.slice(2);
if (!tplPath || !out) { console.error("usage: vite-node --root . scripts/build-green-tree.mjs <template.aquapkg> <out.aquapkg>"); process.exit(1); }
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = 180 / Math.PI, BAR = 10.197;
const YELLOW = "#ffe23a", GREEN = "#3dff4f", ORANGE = "#ffa21f", PURPLE = "#9a5bff";
const JET = "nozzle_straight_jet_dn15";

const csv = fs.readFileSync(new URL("./data/green-tree-nozzles.csv", import.meta.url), "utf8").trim().split(/\r?\n/);
const head = csv.shift().split(",");
const nozzles = csv.map((line) => Object.fromEntries(line.split(",").map((v, i) => [head[i], v])))
  .map((r) => ({ id: r.Nozzle_ID, x: Number(r.X_m), y: Number(r.Y_m), h: Number(r.Target_jet_height_m), row: r.Row_from_center }));
if (nozzles.length !== 65) throw new Error(`expected 65 nozzles, got ${nozzles.length}`);

const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
/** Pressure and flow for a vertical jet of height h (height efficiency + orifice law). */
function jetAt(h) {
  const e = getDefaultEngineering(JET), eff = Number(e.heightEfficiency) || 0.75;
  const p = h / (eff * BAR), p0 = Number(e.pressureBar) || p, q0 = Number(e.flowLpm) || 30;
  return { pressureBar: r3(p), flowLpm: r3(q0 * Math.sqrt(p / p0)) };
}
const ZONE = { center: ["Centre row", "pump-centre"], inner: ["Inner rows", "pump-inner"], outer: ["Outer rows", "pump-outer"] };
// Colour regions. The legend colours by height, but at 0.5 m pitch a spot's field (2 × the beam angle)
// reaches the neighbouring jets, so per-jet colours mix (green + orange reads yellow). The colours
// therefore follow coherent regions that give the sheet's front view: yellow on the centre peak
// (centre row, |x| <= 0.5, 4.2–4.5 m), orange on the low side edges (|x| >= 2.5), green elsewhere.
const band = (n) => (n.row === "center" && Math.abs(n.x) <= 0.5 ? ["Tip lights (yellow)", YELLOW, "Tip"]
  : Math.abs(n.x) >= 2.5 ? ["Edge lights (orange)", ORANGE, "Edge"] : ["Canopy lights (green)", GREEN, "Canopy"]);

for (const n of nozzles) {
  const [group, pumpId] = ZONE[n.row];
  add({ id: n.id, type: JET, label: `${n.id} · ${n.h} m (${n.row})`, x: n.x, y: n.y, zone: n.row, groupId: n.row,
    engineering: { ...jetAt(n.h), jetHeightM: n.h, aimDeg: 0, aimAzimuthDeg: 0, solenoidValveId: `${n.id}-valve`, pumpId,
      nozzleStyle: "vertical clear jet", designStatus: "Concept only - verify hydraulics and site conditions" } }, group);
  add({ id: `${n.id}-valve`, type: "valve_solenoid_dn15_24v", label: `Valve · ${n.id}`, x: n.x, y: r3(n.y - 0.15), zone: n.row,
    engineering: { controlledFixtureId: n.id, pumpId } }, `${group} valves`);
  // Narrow 8° spot 50 mm behind the jet, tipped 1° toward the audience: the beam runs up its own
  // column only. Wider beams spill onto neighbours 0.5 m away and green + orange mixes to yellow.
  const [lg, color, short] = band(n);
  add({ id: `${n.id}-light`, type: "light_uw_rgb_18w", label: `${short} light · ${n.id}`, x: n.x, y: r3(n.y - 0.05), zone: "lights",
    engineering: { pairedNozzleId: n.id, defaultColor: color, aimDeg: 1, aimAzimuthDeg: 90, beamAngleDeg: 8 } }, lg);
}
// Purple trunk: three 30° spots behind the centre, aimed toward the audience at ~0.9 m on the centre row.
[-0.75, 0, 0.75].forEach((x, i) => {
  const ly = -2.2, aim = r3(Math.atan2(-ly, 0.9) * DEG);
  add({ id: `trunk-wash-${i + 1}`, type: "light_uw_rgb_36w", label: `Trunk wash ${i + 1} (purple, 30°)`, x, y: ly, zone: "trunk-lights",
    engineering: { defaultColor: PURPLE, aimDeg: aim, aimAzimuthDeg: 90, beamAngleDeg: 30 } }, "Trunk wash (purple)");
});

// The full-show preview tints all water with the FIRST lit light's colour (fullShowPreview.js,
// "representative"), so list the green canopy lights first: the wash then matches the tree's main colour.
{ const canopy = new Set(groups.get("Canopy lights (green)"));
  const first = fixtures.filter((f) => canopy.has(f.id)), rest = fixtures.filter((f) => !canopy.has(f.id));
  fixtures.length = 0; fixtures.push(...first, ...rest); }

// Pumps (VFD), one per zone.
const pump = (id, label, group, x) => {
  const nz = groups.get(group).map((m) => fixtures.find((f) => f.id === m));
  const flow = nz.reduce((s, f) => s + f.engineering.flowLpm, 0), headM = Math.max(...nz.map((f) => f.engineering.pressureBar * BAR)) + 5;
  const kw = (flow / 60000) * 1000 * 9.81 * headM / 0.65 / 1000;
  const sizes = [[0.75, "0_75"], [1.1, "1_1"], [1.5, "1_5"], [2.2, "2_2"], [3.0, "3_0"], [4.0, "4_0"], [5.5, "5_5"], [7.5, "7_5"]];
  const s = sizes.find(([k]) => k >= kw * 1.15);
  const type = s ? `pump_inline_vfd_pump_${s[1]}kw` : "pump_dry_centrifugal_15kw";
  add({ id, type, label, x, y: -5.5, zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(headM) } }, "Pumps");
  console.log(`${label.padEnd(24)} ${String(nz.length).padStart(2)} jets · ${Math.round(flow)} L/min · head ${headM.toFixed(1)} m · ~${kw.toFixed(2)} kW → ${type}`);
  return flow;
};
const total = pump("pump-centre", "Centre row pump (VFD)", "Centre row", -2) + pump("pump-inner", "Inner rows pump (VFD)", "Inner rows", 0)
  + pump("pump-outer", "Outer rows pump (VFD)", "Outer rows", 2);
console.log(`total circulation ${(total * 0.06).toFixed(1)} m³/h`);

// Basin 9 × 6 m (1.5 m splash margin round the 6 × 3 m array), plaza, planting behind.
const W = 9, D = 6;
const outline = [{ x: -W / 2, y: -D / 2 }, { x: W / 2, y: -D / 2 }, { x: W / 2, y: D / 2 }, { x: -W / 2, y: D / 2 }];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const site_surfaces = [
  { id: "plaza", label: "Plaza paving", type: "paving", color: "#8d8880", elevation: 0.02, visible: true, points: rect(-14, -9, 14, 16) },
  { id: "planting", label: "Trees and planting behind", type: "grass", color: "#2a4f26", elevation: 0.05, visible: true, points: rect(-14, -15, 14, -9) },
];

const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Green Tree Fountain — 65 jets, 6 × 3 m";
Object.assign(proj.engineering, {
  name: "Green Tree Fountain", id: "aquaflow-green-tree", projectName: NAME, pool_type: "rectangular",
  params: { width: W, length: D, radius: 0, depth: 0.4, units: "m", design_head_m: 12 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Green Tree basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  depth_zones: [{ id: "display", zone: "display", label: "Display basin (400 mm)", depth: 0.4, color: "#1f4d3a", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// Show (60 s): lights up, the tree grows from the edge rows in to the centre, the crown breathes,
// a chase runs along the outer rows, then the full tree holds.
const items = inventory(fixtures);
const g = (name, color) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Outer rows", ORANGE), g("Inner rows", GREEN), g("Centre row", YELLOW),
  g("Tip lights (yellow)", YELLOW), g("Canopy lights (green)", GREEN), g("Edge lights (orange)", ORANGE), g("Trunk wash (purple)", PURPLE)];
const rec = (group, name, effect, start, duration, extra = {}) => { const sg = SG.find((x) => x.name === group);
  return { ...newRecipe(sg.id, start), name, effect, duration, cycles: 1, spread: 1, intensity: 100, order: "engineering", color: sg.color, ...extra }; };
const END = 60, LIGHT_LEVEL = Number(process.env.LIGHT_LEVEL) || 35;
const recipes = [
  // Jet lights at LIGHT_LEVEL % (35): at full output the 8° beams overexpose and the tone mapping drifts green to yellow.
  rec("Edge lights (orange)", "Orange edge", "static", 0, END, { intensity: LIGHT_LEVEL }), rec("Canopy lights (green)", "Green canopy", "static", 0, END, { intensity: LIGHT_LEVEL }),
  rec("Tip lights (yellow)", "Yellow tips", "static", 0, END, { intensity: LIGHT_LEVEL }), rec("Trunk wash (purple)", "Purple trunk", "static", 0, END),
  rec("Outer rows", "Outer rows rise", "static", 0.5, 25.5), rec("Inner rows", "Inner rows rise", "static", 3, 23), rec("Centre row", "Centre row rises", "static", 6, 8),
  rec("Centre row", "Crown breathes", "wave", 14, 12, { cycles: 2 }),
  rec("Outer rows", "Edge chase", "chase", 26, 10, { cycles: 2 }), rec("Inner rows", "Canopy wave", "wave", 26, 10, { cycles: 2 }), rec("Centre row", "Crown holds", "static", 26, 33.5),
  rec("Outer rows", "Full tree", "static", 36, 23.5), rec("Inner rows", "Full tree", "static", 36, 23.5),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m1", name: "Tree grows", time: 0, kind: "section" }, { id: "m2", name: "Crown breathes", time: 14, kind: "section" },
    { id: "m3", name: "Chase and wave", time: 26, kind: "section" }, { id: "m4", name: "Full tree", time: 36, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
console.log(readFountainDesign(items).summary);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END,
  audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-green-tree-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-green-tree", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0, cameraMode: "named", activeCameraView: "front",
  cameraViews: [
    { id: "front", name: "Front (main viewing direction, 13 m)", position: { x: 0, y: 1.6, z: 13 }, target: { x: 0, y: 2.1, z: 0 }, fov: 34 },
    { id: "angle", name: "Angled view (left)", position: { x: -9, y: 2.4, z: 9 }, target: { x: 0, y: 2.0, z: 0 }, fov: 38 },
    { id: "side", name: "Side view", position: { x: 12, y: 1.8, z: 0.01 }, target: { x: 0, y: 2.1, z: 0 }, fov: 36 },
    { id: "top", name: "Top view", position: { x: 0, y: 14, z: 4 }, target: { x: 0, y: 0, z: 0 }, fov: 40 },
  ] };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest, null, 2) }]));
console.log(`→ ${out} · ${fixtures.length} fixtures · ${clips.length} cues · ${recipes.length} patterns`);
