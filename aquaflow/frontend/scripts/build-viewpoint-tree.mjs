// Viewpoint-illusion tree — rows of vertical clear jets whose lit tops line up into a tree only from
// one marked spot ("STAND HERE"), per the user's preliminary layout:
//   pool 8 × 8 m (X −4…+4, Y 0…8 into the pool from its front inside edge), eye 14 m in front at
//   1.60 m, drawing plane 4 m behind the front edge; 42 canopy jets in rows A–F, 5 trunk jets.
//   Perspective: s = (14 + Y) / 18,  X = s·u,  H = 1.60 + s·(v − 1.60)   (u, v on the drawing plane)
//   vite-node build-viewpoint-tree.mjs <template.aquapkg> <out.aquapkg>
//
// AquaFlow plan: x = X, plan y = 4 − Y (the audience is on +y; front edge at y = +4, back at −4).
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";

const [tplPath, out] = process.argv.slice(2);
const r3 = (v) => Math.round(v * 1000) / 1000;
const BAR = 10.197, DEG = 180 / Math.PI;
const EYE = { d: 14, h: 1.6 }, PLANE_Y = 4;
const planY = (Y) => r3(4 - Y);
const GREEN = "#2bff4a", TRUNK_GREEN = "#1fd65a";
const JET = "nozzle_straight_jet_dn15";              // stands in for a 12 mm adjustable lance jet

// ── The layout (metres) ──────────────────────────────────────────────────────────────────
const ROWS = [
  ["A", 1.5, 2.55, [-2.41, -1.81, -1.21, -0.60, 0, 0.60, 1.21, 1.81, 2.41]],
  ["B", 2.5, 3.07, [-2.57, -1.92, -1.28, -0.64, 0, 0.64, 1.28, 1.92, 2.57]],
  ["C", 3.5, 3.64, [-2.72, -2.04, -1.36, -0.68, 0, 0.68, 1.36, 2.04, 2.72]],
  ["D", 4.5, 4.27, [-2.16, -1.44, -0.72, 0, 0.72, 1.44, 2.16]],
  ["E", 5.5, 4.90, [-1.52, -0.76, 0, 0.76, 1.52]],
  ["F", 6.5, 5.47, [-0.80, 0, 0.80]],
];
const TRUNK = { Y: 0.8, jets: [[-0.45, 1.70], [-0.23, 2.10], [0, 2.35], [0.23, 2.10], [0.45, 1.70]] };

// Lance-jet hydraulics: ~69 L/min at 5 m for a 12 mm lance (SafeRain data), flow ∝ √height.
const lance = (H) => {
  const e = getDefaultEngineering(JET), eff = Number(e.heightEfficiency) || 0.75;
  return { jetHeightM: H, pressureBar: r3(H / (eff * BAR)), flowLpm: r3(69 * Math.sqrt(H / 5)), nozzleDiaMm: 12,
    designStatus: "Viewpoint tree — preliminary test layout; confirm with the lance-jet datasheet" };
};
// Where a jet top appears on the drawing plane, seen from the eye (inverse of the user's formula).
const apparent = (X, Y, H) => { const s = (EYE.d + Y) / (EYE.d + PLANE_Y); return { u: r3(X / s), v: r3(EYE.h + (H - EYE.h) / s) }; };

const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
const canopyApparent = [];
for (const [row, Y, H, xs] of ROWS) {
  xs.forEach((X, i) => {
    const id = `${row}${i + 1}`, pumpId = `pump-row-${row.toLowerCase()}`, y = planY(Y);
    add({ id, type: JET, label: `Canopy ${id}`, x: X, y, zone: `row-${row.toLowerCase()}`, groupId: `row_${row.toLowerCase()}`,
      engineering: { ...lance(H), solenoidValveId: `${id}-valve`, pumpId, aimDeg: 0, aimAzimuthDeg: 0 } }, `Row ${row}`);
    add({ id: `${id}-valve`, type: "valve_solenoid_dn15_24v", label: `Balancing + solenoid valve ${id}`, x: X, y: r3(y - 0.15), zone: `row-${row.toLowerCase()}`,
      engineering: { controlledFixtureId: id, pumpId } }, `Row ${row} valves`);
    // Spotlight 1.2 m toward the viewer, aimed up the jet at its top: the lit top, not the column.
    const dist = 1.2, tiltFromVertical = r3(Math.atan2(dist, H) * DEG);
    add({ id: `${id}-spot`, type: "light_uw_rgb_18w", label: `Narrow spot → ${id} top`, x: X, y: r3(y + dist), zone: "canopy-lights",
      engineering: { pairedNozzleId: id, defaultColor: GREEN, aimDeg: tiltFromVertical, aimAzimuthDeg: 270, beamAngleDeg: 11, beamRadiusM: 1.0 } }, "Canopy spots");
    canopyApparent.push({ id, ...apparent(X, Y, H) });
  });
}
TRUNK.jets.forEach(([X, H], i) => {
  const id = `T${i + 1}`, pumpId = "pump-trunk", y = planY(TRUNK.Y);
  add({ id, type: JET, label: `Trunk ${id}`, x: X, y, zone: "trunk", groupId: "trunk",
    engineering: { ...lance(H), solenoidValveId: `${id}-valve`, pumpId } }, "Trunk");
  add({ id: `${id}-valve`, type: "valve_solenoid_dn15_24v", label: `Balancing + solenoid valve ${id}`, x: X, y: r3(y - 0.15), zone: "trunk",
    engineering: { controlledFixtureId: id, pumpId } }, "Trunk valves");
  add({ id: `${id}-light`, type: "light_uw_rgb_18w", label: `Trunk light ${id}`, x: X, y: r3(y + 0.12), zone: "trunk-lights",
    engineering: { pairedNozzleId: id, defaultColor: TRUNK_GREEN } }, "Trunk lights");
});

// ── Pumps: seven independently adjustable groups (rows A–F + trunk), each on its own VFD ───────
const pumpOf = (id, label, group, x) => {
  const nz = groups.get(group).map((m) => fixtures.find((f) => f.id === m));
  const flow = nz.reduce((s, f) => s + f.engineering.flowLpm, 0), head = Math.max(...nz.map((f) => f.engineering.pressureBar * BAR)) + 6;
  const kw = (flow / 60000) * 1000 * 9.81 * head / 0.65 / 1000;
  const sizes = [[0.75, "0_75"], [1.1, "1_1"], [1.5, "1_5"], [2.2, "2_2"], [3.0, "3_0"], [4.0, "4_0"], [5.5, "5_5"], [7.5, "7_5"]];
  const s = sizes.find(([k]) => k >= kw * 1.15);
  add({ id, type: s ? `pump_inline_vfd_pump_${s[1]}kw` : "pump_dry_centrifugal_15kw", label, x, y: -6.5, zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(head) } }, "Pumps");
  return { label, n: nz.length, flow, head, kw };
};
const pumps = [...ROWS.map(([row], i) => pumpOf(`pump-row-${row.toLowerCase()}`, `Row ${row} pump (VFD)`, `Row ${row}`, -4.5 + i * 1.5)),
  pumpOf("pump-trunk", "Trunk pump (VFD)", "Trunk", 4.5)];
for (const p of pumps) console.log(`${p.label.padEnd(20)} ${String(p.n).padStart(2)} jets · ${Math.round(p.flow)} L/min · head ${p.head.toFixed(1)} m · ~${p.kw.toFixed(1)} kW`);
const totalM3h = pumps.reduce((s, p) => s + p.flow, 0) * 60 / 1000;
console.log(`total circulation ${totalM3h.toFixed(0)} m³/h (user's allowance 150–170 m³/h)`);
// Sanity: where each row's tops appear on the drawing plane (u across, v up), seen from the eye.
for (const [row] of ROWS) {
  const pts = canopyApparent.filter((p) => p.id.startsWith(row));
  console.log(`row ${row} appears at v ${pts[0].v} m, u ${pts[0].u} … ${pts.at(-1).u} m`);
}

// ── Site: 8 × 8 m basin, plaza, the STAND HERE disc ──────────────────────────────────────────
const outline = [{ x: -4, y: -4 }, { x: 4, y: -4 }, { x: 4, y: 4 }, { x: -4, y: 4 }];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const disc = (cx, cy, r, n = 24) => Array.from({ length: n }, (_, i) => ({ x: r3(cx + r * Math.cos((2 * Math.PI * i) / n)), y: r3(cy + r * Math.sin((2 * Math.PI * i) / n)) }));
const eyePlanY = 4 + EYE.d;
const site_surfaces = [
  { id: "plaza", label: "Plaza", type: "paving", color: "#8f8a82", elevation: 0.02, visible: true, points: rect(-14, -12, 14, eyePlanY + 4) },
  { id: "stand-here", label: "STAND HERE — design viewpoint (eye 1.60 m)", type: "rock", color: "#2c3440", elevation: 0.04, visible: true, points: disc(0, eyePlanY, 0.6) },
  { id: "planting", label: "Planting behind", type: "grass", color: "#2f5d2a", elevation: 0.05, visible: true, points: rect(-14, -16, 14, -12) },
];

const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Viewpoint Tree — illusion from the STAND HERE spot";
Object.assign(proj.engineering, {
  name: "Viewpoint Tree", id: "aquaflow-viewpoint-tree", projectName: NAME, pool_type: "rectangular",
  params: { width: 8, length: 8, radius: 0, depth: 0.45, units: "m", design_head_m: 20 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Viewpoint basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  depth_zones: [{ id: "display", zone: "display", label: "Display basin (450 mm)", depth: 0.45, color: "#25476a", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// ── Show (45 s): the trunk, then the canopy builds row by row front to back, holds, fades ────
const items = inventory(fixtures);
const g = (name, color = GREEN) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Trunk", TRUNK_GREEN), ...ROWS.map(([row]) => g(`Row ${row}`)), g("Canopy spots"), g("Trunk lights", TRUNK_GREEN)];
const rec = (group, name, effect, start, duration, extra = {}) => ({ ...newRecipe(SG.find((x) => x.name === group).id, start), name, effect, duration,
  cycles: 1, spread: 1, intensity: 100, order: "engineering", color: group === "Trunk" || group === "Trunk lights" ? TRUNK_GREEN : GREEN, ...extra });
const END = 45;
const recipes = [
  rec("Trunk lights", "Trunk glow", "static", 0, END), rec("Trunk", "Trunk", "static", 0.5, END - 1.5),
  ...ROWS.map(([row], i) => rec(`Row ${row}`, `Row ${row} rises`, "static", 3 + i * 1.5, END - 4 - i * 1.5)),
  rec("Canopy spots", "Canopy tops lit", "static", 3, END - 3.5),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m1", name: "Trunk", time: 0, kind: "section" }, { id: "m2", name: "Canopy builds", time: 3, kind: "section" }, { id: "m3", name: "Full tree", time: 12, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
console.log(readFountainDesign(items).summary);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END,
  audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-viewpoint-tree-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-viewpoint-tree", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
// Cameras: the design eye (STAND HERE, 1.60 m) looking at the drawing plane, and a side view.
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0, activeCameraView: "stand-here",
  cameraViews: [
    { id: "stand-here", name: "STAND HERE (illusion)", position: { x: 0, y: EYE.h, z: eyePlanY }, target: { x: 0, y: 3.3, z: 4 - PLANE_Y } },
    { id: "side", name: "Side view (rows revealed)", position: { x: 11, y: 5.5, z: 9 }, target: { x: 0, y: 1.8, z: 0 } },
    { id: "plan", name: "Plan (nozzle grid)", position: { x: 0, y: 16, z: 0.01 }, target: { x: 0, y: 0, z: 0 } },
  ] };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest, null, 2) }]));
console.log(`→ ${out} · ${fixtures.length} fixtures · ${clips.length} cues · ${recipes.length} patterns`);
