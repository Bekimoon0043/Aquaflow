// Rain Tree — the green tree of the reference render, built so it works from every side, not only
// from one marked spot: the canopy is made where it is seen, up in the air, every head on its own
// thin dark riser (the faint columns under the canopy).
//   • Scalloped edge: 13 dandelion (crystal-ball) nozzles on the outline traced from the reference
//     front view (scripts/data/rain-tree-layout.json), each a real ~1.6 m water ball.
//   • Fluffy interior: 39 level-independent foam nozzles on the frame inside the outline, in two
//     depth layers, each a short white frothy plume.
//   • Faint columns below the canopy: the water falling back from every head rains into the pool.
//   • Trunk: 4 foam jets round the frame's spine; green spots under every head and two green
//     framing projectors behind the tree, lighting toward the audience (forward scatter).
//   vite-node build-rain-tree.mjs <template.aquapkg> <out.aquapkg>
// Plan: x = across, plan y = depth (audience on +y), z = height (m).
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";

const [tplPath, out] = process.argv.slice(2);
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = 180 / Math.PI, BAR = 10.197;
const L = JSON.parse(fs.readFileSync(new URL("./data/rain-tree-layout.json", import.meta.url), "utf8"));
const GREEN = "#2bff4a", TRUNK_GREEN = "#3dff7a";
const LOBE = "nozzle_dandelion_dn40", FOAM = "nozzle_foam_jet_dn25";
const Y_LOBES = 0.3, FOAM_LAYERS = [0.0, -0.6], PLUME_H = 1.2;
const SPINE_TOP = 3.4;                                        // where the branches leave the spine

const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
const valve = (id, x, y, pumpId, zone, group) => add({ id: `${id}-valve`, type: "valve_solenoid_dn25_24v", label: `Valve · ${id}`, x, y: r3(y - 0.2), zone,
  engineering: { controlledFixtureId: id, pumpId } }, group);
// A green spot on the frame just under a head, aimed up into it.
const spotUnder = (id, x, y, zHead, group, beam = 25) => add({ id: `${id}-spot`, type: "light_uw_rgb_18w", label: `Green spot under ${id}`, x, y: r3(y + 0.15), zone: "tree-lights",
  engineering: { pairedNozzleId: id, defaultColor: GREEN, mountHeightM: r3(Math.max(0, zHead)), aimDeg: 0, beamAngleDeg: beam } }, group);
const foamFlow = (h) => { const e = getDefaultEngineering(FOAM); return { flowLpm: r3(Number(e.flowLpm) * Math.sqrt(h / Number(e.jetHeightM))), pressureBar: r3(h / ((Number(e.heightEfficiency) || 0.6) * BAR)) }; };

// Lobes: dandelion balls on the outline (bottom → top so the show can grow the canopy upward).
// Two extra balls fill the canopy centre just above the trunk (foam there would rain white over it).
const lobes = [...L.lobes, { x: -0.55, z: 2.35 }, { x: 0.55, z: 2.35 }].sort((a, b) => a.z - b.z || a.x - b.x);
lobes.forEach((l, i) => {
  const id = `lobe-${String(i + 1).padStart(2, "0")}`, pumpId = l.z < 3.6 ? "pump-lobes-low" : "pump-lobes-high";
  add({ id, type: LOBE, label: `Canopy lobe ${i + 1} (dandelion)`, x: l.x, y: Y_LOBES, zone: "lobes", groupId: "lobes",
    engineering: { mountHeightM: l.z, sphereRadiusM: L.lobeR, solenoidValveId: `${id}-valve`, pumpId,
      designStatus: "Rain tree — verify ball size and flow with the dandelion supplier" } }, "Canopy lobes");
  valve(id, l.x, Y_LOBES, pumpId, "lobes", "Lobe valves");
  spotUnder(id, l.x, Y_LOBES, l.z - L.lobeR - 0.25, "Tree lights", 40);
});
// Interior: foam plumes in two depth layers (alternating), mounted on the frame.
const foam = L.foam.filter((f) => f.z >= 2.6).sort((a, b) => a.z - b.z || a.x - b.x);
foam.forEach((f, i) => {
  const id = `plume-${String(i + 1).padStart(2, "0")}`, y = FOAM_LAYERS[i % 2], pumpId = f.z < 3.4 ? "pump-foam-low" : "pump-foam-high";
  add({ id, type: FOAM, label: `Canopy foam plume ${i + 1}`, x: f.x, y, zone: "foam", groupId: "foam",
    engineering: { mountHeightM: f.z, jetHeightM: PLUME_H, ...foamFlow(PLUME_H), aimDeg: 0, aimAzimuthDeg: 0,
      nozzleStyle: "level-independent foam nozzle (works on a riser above the water)", solenoidValveId: `${id}-valve`, pumpId } }, "Canopy foam");
  valve(id, f.x, y, pumpId, "foam", "Foam valves");
  spotUnder(id, f.x, y, f.z - 0.15, "Tree lights", 30);
});
// Trunk: four foam jets round the spine at water level.
[[-0.45, 1.15], [-0.15, 1.4], [0.15, 1.4], [0.45, 1.15]].forEach(([x, h], i) => {
  const id = `trunk-${i + 1}`;
  add({ id, type: FOAM, label: `Trunk foam jet ${i + 1}`, x, y: 0.2, zone: "trunk", groupId: "trunk",
    engineering: { jetHeightM: h, ...foamFlow(h), solenoidValveId: `${id}-valve`, pumpId: "pump-trunk" } }, "Trunk");
  valve(id, x, 0.2, "pump-trunk", "trunk", "Trunk valves");
});
[-0.6, 0.6].forEach((x, i) => add({ id: `trunk-spot-${i + 1}`, type: "light_uw_rgb_36w", label: `Trunk spot ${i + 1}`, x, y: -0.3, zone: "trunk-lights",
  engineering: { pairedNozzleId: `trunk-${i ? 4 : 1}`, defaultColor: TRUNK_GREEN, aimDeg: 30, aimAzimuthDeg: 90, beamAngleDeg: 25 } }, "Trunk lights"));
// Key light: two green framing projectors behind the tree, at the sides, aimed at the canopy toward the audience.
for (const side of [-1, 1]) {
  const X = 9 * side, Y = -7, z = 3.0, t = { x: 0, y: 0, z: 3.8 };
  const dx = t.x - X, dy = t.y - Y, dz = t.z - z;
  add({ id: `projector-${side < 0 ? "west" : "east"}`, type: "light_projector_framing_5200lm", label: `Framing projector ${side < 0 ? "west" : "east"} (green)`, x: X, y: Y, zone: "key-light",
    engineering: { mountHeightM: z, defaultColor: GREEN, lumens: 5200, beamAngleDeg: 40, aimDeg: r3(Math.atan2(Math.hypot(dx, dy), dz) * DEG), aimAzimuthDeg: r3(((Math.atan2(dy, dx) * DEG) + 360) % 360),
      // Lower blade: no light below the canopy floor (keeps the falling rain and the audience dark).
      framing: { blades: [{ point: [0, 0, r3(L.canopyBottom + 0.3)], normal: [0, 0, 1] }], softnessM: 0.15 } } }, "Key light");
}

// Pumps: VFD groups sized from flow and the highest mount + nozzle head.
const pumpOf = (id, label, test, x) => {
  const nz = fixtures.filter((f) => f.engineering.pumpId === id && /^(lobe|plume|trunk)-\d+$/.test(f.id));
  const flow = nz.reduce((s, f) => s + (Number(f.engineering.flowLpm) || 0), 0);
  const head = Math.max(...nz.map((f) => (Number(f.engineering.mountHeightM) || 0) + (Number(f.engineering.pressureBar) || 1) * BAR)) + 6;
  const kw = (flow / 60000) * 1000 * 9.81 * head / 0.65 / 1000;
  const sizes = [[0.75, "0_75"], [1.1, "1_1"], [1.5, "1_5"], [2.2, "2_2"], [3.0, "3_0"], [4.0, "4_0"], [5.5, "5_5"], [7.5, "7_5"]];
  const s = sizes.find(([k]) => k >= kw * 1.15);
  add({ id, type: s ? `pump_inline_vfd_pump_${s[1]}kw` : "pump_dry_centrifugal_15kw", label, x, y: -8.5, zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(head) } }, "Pumps");
  return { label, n: nz.length, flow, head, kw };
};
const pumps = [pumpOf("pump-lobes-low", "Lobes lower pump (VFD)", null, -4), pumpOf("pump-lobes-high", "Lobes upper pump (VFD)", null, -2),
  pumpOf("pump-foam-low", "Foam lower pump (VFD)", null, 0), pumpOf("pump-foam-high", "Foam upper pump (VFD)", null, 2), pumpOf("pump-trunk", "Trunk pump (VFD)", null, 4)];
for (const p of pumps) console.log(`${p.label.padEnd(24)} ${String(p.n).padStart(2)} outlets · ${Math.round(p.flow)} L/min · head ${p.head.toFixed(1)} m · ~${p.kw.toFixed(1)} kW`);
console.log(`total circulation ${(pumps.reduce((s, p) => s + p.flow, 0) * 0.06).toFixed(0)} m³/h`);

// No branch frame: every head stands on its own thin dark riser from the pool floor (drawn by
// AquaFlow as the support pipe) — from the front these read as the faint columns under the canopy.

// Basin 14 × 12 m (splash from 6 m heads), plaza, viewing steps.
const W = 14, D = 12;
const outline = [{ x: -W / 2, y: -D / 2 }, { x: W / 2, y: -D / 2 }, { x: W / 2, y: D / 2 }, { x: -W / 2, y: D / 2 }];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const site_surfaces = [
  { id: "plaza", label: "Plaza", type: "paving", color: "#8f8a82", elevation: 0.02, visible: true, points: rect(-18, -14, 18, 26) },
  { id: "planting", label: "Planting behind", type: "grass", color: "#2f5d2a", elevation: 0.05, visible: true, points: rect(-18, -20, 18, -14) },
];

const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Rain Tree — canopy of dandelions and foam on a dark frame";
Object.assign(proj.engineering, {
  name: "Rain Tree", id: "aquaflow-rain-tree", projectName: NAME, pool_type: "rectangular",
  params: { width: W, length: D, radius: 0, depth: 0.6, units: "m", design_head_m: 30 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Rain tree basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  depth_zones: [{ id: "display", zone: "display", label: "Display basin", depth: 0.6, color: "#1d3b55", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// Show (45 s): the trunk, the canopy grows from the bottom, fills, holds, falls back.
const items = inventory(fixtures);
const g = (name, color = GREEN) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Trunk", TRUNK_GREEN), g("Canopy lobes"), g("Canopy foam"), g("Tree lights"), g("Trunk lights", TRUNK_GREEN), g("Key light")];
const rec = (group, name, effect, start, duration, extra = {}) => ({ ...newRecipe(SG.find((x) => x.name === group).id, start), name, effect, duration,
  cycles: 1, spread: 1, intensity: 100, order: "engineering", color: group.startsWith("Trunk") ? TRUNK_GREEN : GREEN, ...extra });
const END = 45;
const recipes = [
  rec("Trunk lights", "Trunk glow", "static", 0, END), rec("Trunk", "Trunk", "static", 0.5, END - 1.5),
  rec("Tree lights", "Canopy lights", "static", 2, END - 2.5), rec("Key light", "Projectors", "static", 2, END - 2.5),
  rec("Canopy lobes", "Lobes grow from the bottom", "staircase", 2, 8), rec("Canopy lobes", "Full lobes", "static", 10, END - 11),
  rec("Canopy foam", "Foam fills the canopy", "staircase", 6, 8), rec("Canopy foam", "Full canopy", "static", 14, END - 15),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m1", name: "Trunk", time: 0, kind: "section" }, { id: "m2", name: "Canopy grows", time: 2, kind: "section" }, { id: "m3", name: "Full tree", time: 14, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
console.log(readFountainDesign(items).summary);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END, audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-rain-tree-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-rain-tree", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0, activeCameraView: "front",
  cameraViews: [
    { id: "front", name: "Front (audience, 18 m)", position: { x: 0, y: 1.6, z: 18 }, target: { x: 0, y: 3.0, z: 0 }, fov: 30 },
    { id: "side", name: "Side view", position: { x: 15, y: 5, z: 12 }, target: { x: 0, y: 2.8, z: 0 } },
    { id: "angle", name: "Three-quarter", position: { x: -12, y: 2.2, z: 14 }, target: { x: 0, y: 3.0, z: 0 }, fov: 35 },
  ] };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest, null, 2) }]));
console.log(`→ ${out} · ${fixtures.length} fixtures · ${clips.length} cues · ${recipes.length} patterns`);
