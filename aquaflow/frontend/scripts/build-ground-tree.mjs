// Collision-canopy tree — every jet rises from the pool floor. Each canopy lobe is a point in the air
// where three jets from the ground meet at the top of their arcs; colliding there, at their slowest,
// they burst into a soft spray (the bushy lobe). The rising jets are the faint columns under the
// canopy. A narrow spot on the floor under each meeting point aims straight up: low down the three
// jets are ~1.2 m away, outside the beam, so only the bloom is lit. Trunk: 4 foam jets.
// Lobe points come from the reference canopy outline (scripts/data/rain-tree-layout.json).
//   vite-node build-ground-tree.mjs <template.aquapkg> <out.aquapkg>
// Plan: x = across, plan y = depth (audience on +y), heights in m.
// Note: AquaFlow's preview does not simulate jet-on-jet collision, so it shows the three jet heads
// overlapping at each point; the real bloom from the collision is larger and softer.
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";
import { solveReachSpeed } from "/src/components/preview/elevatedNozzles.js";
import { simulateFlight, RENDER_PHYSICS } from "/src/components/preview/designTrajectory.js";

const [tplPath, out] = process.argv.slice(2);
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = 180 / Math.PI, RAD = Math.PI / 180, BAR = 10.197;
const L = JSON.parse(fs.readFileSync(new URL("./data/rain-tree-layout.json", import.meta.url), "utf8"));
const GREEN = "#2bff4a", TRUNK_GREEN = "#3dff7a";
const JET = "nozzle_straight_jet_dn20", FOAM = "nozzle_foam_jet_dn25";
const FOOT_R = 1.2;                                   // nozzles this far (plan) from below their point

// ── Arc solver: tilt + reach whose apex is at height h, d metres sideways (renderer physics) ─────
const flight = (tilt, reach) => { const v = solveReachSpeed(reach, tilt); return simulateFlight(v * Math.sin(tilt * RAD), v * Math.cos(tilt * RAD), RENDER_PHYSICS.water); };
function apexAt(h, d) {
  const reachFor = (tilt) => { let lo = 0.3, hi = 25; for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (flight(tilt, m).apex < h) lo = m; else hi = m; } return hi; };
  let lo = 0.1, hi = 60;                              // the apex moves sideways as the tilt grows
  for (let i = 0; i < 32; i++) { const m = (lo + hi) / 2; if (flight(m, reachFor(m)).xApex < d) lo = m; else hi = m; }
  const reach = reachFor(hi), f = flight(hi, reach);
  return { tilt: r3(hi), reach: r3(reach), apex: r3(f.apex), xApex: r3(f.xApex), land: r3(f.range) };
}

// Meeting points: the outline lobes plus the interior points (thinned), in the front plane (y = 0).
const points = [
  ...L.lobes.map((p) => ({ ...p, kind: "lobe" })),
  ...L.foam.filter((p, i) => p.z >= 2.6 && i % 2 === 0).map((p) => ({ x: p.x, z: r3(p.z + 0.6), kind: "inner" })),
  { x: -0.55, z: 2.35, kind: "inner" }, { x: 0.55, z: 2.35, kind: "inner" },
].sort((a, b) => a.z - b.z || a.x - b.x);

const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
const flowFor = (h) => { const e = getDefaultEngineering(JET); const p = h / ((Number(e.heightEfficiency) || 0.75) * BAR); return { pressureBar: r3(p), flowLpm: r3(Number(e.flowLpm) * Math.sqrt(p / Number(e.pressureBar))) }; };
const solved = new Map();
points.forEach((pt, k) => {
  const pid = `P${String(k + 1).padStart(2, "0")}`, pumpId = pt.z < 3.6 ? "pump-canopy-low" : "pump-canopy-high";
  const arc = solved.get(pt.z) || apexAt(pt.z, FOOT_R);
  solved.set(pt.z, arc);
  // Three feet round the point: one behind, two in front-sides (120° apart), each aimed at the point.
  [90, 210, 330].forEach((a, j) => {
    const fx = r3(pt.x + FOOT_R * Math.cos(a * RAD)), fy = r3(FOOT_R * Math.sin(a * RAD));
    const azimuth = r3((((a + 180) % 360) + 360) % 360);
    const id = `${pid}-${"abc"[j]}`;
    add({ id, type: JET, label: `Canopy point ${pid} jet ${"abc"[j]}`, x: fx, y: fy, zone: pt.kind === "lobe" ? "lobes" : "inner", groupId: pt.kind === "lobe" ? "lobes" : "inner",
      engineering: { jetHeightM: pt.z, reachM: arc.reach, aimDeg: arc.tilt, aimAzimuthDeg: azimuth, ...flowFor(pt.z), nozzleDiaMm: 16, exitTurbulence: 0.06,
        nozzleStyle: "plain smooth-bore jet on an adjustable ball joint", solenoidValveId: `${id}-valve`, pumpId,
        designStatus: "Collision canopy — set each jet on site so the three tops meet" } }, pt.kind === "lobe" ? "Canopy lobes" : "Canopy inner");
    add({ id: `${id}-valve`, type: "valve_solenoid_dn25_24v", label: `Valve · ${id}`, x: fx, y: r3(fy - 0.15), zone: "valves",
      engineering: { controlledFixtureId: id, pumpId } }, "Canopy valves");
  });
  // Narrow spot on the floor straight under the meeting point, aimed up into the bloom.
  add({ id: `${pid}-spot`, type: "light_uw_rgb_36w", label: `10° spot under ${pid}`, x: pt.x, y: 0, zone: "canopy-lights",
    engineering: { pairedNozzleId: `${pid}-a`, defaultColor: GREEN, aimDeg: 0, beamAngleDeg: 10 } }, "Canopy spots");
});
console.log(`meeting points ${points.length} → ${points.length * 3} jets; arcs:`, [...solved.values()].slice(0, 4).map((a) => `${a.apex} m @ ${a.tilt}° (reach ${a.reach})`).join(" · "));

// Trunk: four foam jets at the front centre, lit by two 25° spots.
const foamFlow = (h) => { const e = getDefaultEngineering(FOAM); return { flowLpm: r3(Number(e.flowLpm) * Math.sqrt(h / Number(e.jetHeightM))), pressureBar: r3(h / ((Number(e.heightEfficiency) || 0.6) * BAR)) }; };
[[-0.45, 1.15], [-0.15, 1.4], [0.15, 1.4], [0.45, 1.15]].forEach(([x, h], i) => {
  const id = `trunk-${i + 1}`;
  add({ id, type: FOAM, label: `Trunk foam jet ${i + 1}`, x, y: 0.6, zone: "trunk", groupId: "trunk",
    engineering: { jetHeightM: h, ...foamFlow(h), solenoidValveId: `${id}-valve`, pumpId: "pump-trunk" } }, "Trunk");
  add({ id: `${id}-valve`, type: "valve_solenoid_dn25_24v", label: `Valve · ${id}`, x, y: 0.45, zone: "valves", engineering: { controlledFixtureId: id, pumpId: "pump-trunk" } }, "Trunk valves");
});
[-0.6, 0.6].forEach((x, i) => add({ id: `trunk-spot-${i + 1}`, type: "light_uw_rgb_36w", label: `Trunk spot ${i + 1}`, x, y: 0.25, zone: "trunk-lights",
  engineering: { pairedNozzleId: `trunk-${i ? 4 : 1}`, defaultColor: TRUNK_GREEN, aimDeg: 25, aimAzimuthDeg: 90, beamAngleDeg: 25 } }, "Trunk lights"));
// Two green framing projectors behind, out of the audience's view, lower blade at the canopy floor.
for (const side of [-1, 1]) {
  const X = 15 * side, Y = -11, z = 3.5, t = { x: 0, y: 0, z: 4.0 };     // outside the 30° front view
  const dx = t.x - X, dy = t.y - Y, dz = t.z - z;
  add({ id: `projector-${side < 0 ? "west" : "east"}`, type: "light_projector_framing_5200lm", label: `Framing projector ${side < 0 ? "west" : "east"} (green)`, x: X, y: Y, zone: "key-light",
    engineering: { mountHeightM: z, defaultColor: GREEN, lumens: 5200, beamAngleDeg: 35, aimDeg: r3(Math.atan2(Math.hypot(dx, dy), dz) * DEG), aimAzimuthDeg: r3(((Math.atan2(dy, dx) * DEG) + 360) % 360),
      framing: { blades: [{ point: [0, 0, 2.0], normal: [0, 0, 1] }], softnessM: 0.2 } } }, "Key light");
}

// Pumps (VFD).
const pumpOf = (id, label, x) => {
  const nz = fixtures.filter((f) => f.engineering.pumpId === id && !/-valve$/.test(f.id));
  const flow = nz.reduce((s, f) => s + (Number(f.engineering.flowLpm) || 0), 0);
  const head = Math.max(...nz.map((f) => (Number(f.engineering.pressureBar) || 1) * BAR)) + 6;
  const kw = (flow / 60000) * 1000 * 9.81 * head / 0.65 / 1000;
  const sizes = [[0.75, "0_75"], [1.1, "1_1"], [1.5, "1_5"], [2.2, "2_2"], [3.0, "3_0"], [4.0, "4_0"], [5.5, "5_5"], [7.5, "7_5"]];
  const s = sizes.find(([k]) => k >= kw * 1.15);
  add({ id, type: s ? `pump_inline_vfd_pump_${s[1]}kw` : "pump_dry_centrifugal_15kw", label, x, y: -9, zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(head) } }, "Pumps");
  console.log(`${label.padEnd(24)} ${String(nz.length).padStart(2)} jets · ${Math.round(flow)} L/min · head ${head.toFixed(1)} m · ~${kw.toFixed(1)} kW`);
  return flow;
};
const total = pumpOf("pump-canopy-low", "Canopy lower pump (VFD)", -3) + pumpOf("pump-canopy-high", "Canopy upper pump (VFD)", 0) + pumpOf("pump-trunk", "Trunk pump (VFD)", 3);
console.log(`total circulation ${(total * 0.06).toFixed(0)} m³/h`);

// Basin 16 × 12 m (splash), plaza.
const W = 16, D = 12;
const outline = [{ x: -W / 2, y: -D / 2 }, { x: W / 2, y: -D / 2 }, { x: W / 2, y: D / 2 }, { x: -W / 2, y: D / 2 }];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const site_surfaces = [
  { id: "plaza", label: "Plaza", type: "paving", color: "#8f8a82", elevation: 0.02, visible: true, points: rect(-20, -14, 20, 26) },
  { id: "planting", label: "Planting behind", type: "grass", color: "#2f5d2a", elevation: 0.05, visible: true, points: rect(-20, -20, 20, -14) },
];

const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Collision Canopy Tree — every jet from the ground";
Object.assign(proj.engineering, {
  name: "Collision Canopy Tree", id: "aquaflow-ground-tree", projectName: NAME, pool_type: "rectangular",
  params: { width: W, length: D, radius: 0, depth: 0.6, units: "m", design_head_m: 20 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Tree basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  depth_zones: [{ id: "display", zone: "display", label: "Display basin", depth: 0.6, color: "#1d3b55", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

const items = inventory(fixtures);
const g = (name, color = GREEN) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Trunk", TRUNK_GREEN), g("Canopy lobes"), g("Canopy inner"), g("Canopy spots"), g("Trunk lights", TRUNK_GREEN), g("Key light")];
const rec = (group, name, effect, start, duration, extra = {}) => ({ ...newRecipe(SG.find((x) => x.name === group).id, start), name, effect, duration,
  cycles: 1, spread: 1, intensity: 100, order: "engineering", color: group.startsWith("Trunk") ? TRUNK_GREEN : GREEN, ...extra });
const END = 45;
const recipes = [
  rec("Trunk lights", "Trunk glow", "static", 0, END), rec("Trunk", "Trunk", "static", 0.5, END - 1.5),
  rec("Canopy spots", "Blooms lit", "static", 2, END - 2.5), rec("Key light", "Projectors", "static", 2, END - 2.5),
  rec("Canopy inner", "Inner canopy rises", "static", 2, END - 3), rec("Canopy lobes", "Lobes grow from the bottom", "staircase", 4, 8),
  rec("Canopy lobes", "Full canopy", "static", 12, END - 13),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m1", name: "Trunk", time: 0, kind: "section" }, { id: "m2", name: "Canopy grows", time: 2, kind: "section" }, { id: "m3", name: "Full tree", time: 12, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
console.log(readFountainDesign(items).summary);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END, audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-ground-tree-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-ground-tree", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
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
