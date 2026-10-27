// Green Dome — a tall centre bundle of clear vertical jets with five rings of arching jets opening
// outward round it, every arc landing on an oval near the coping, the whole dome lit green from the
// floor (traced from the user's reference photo: a symmetrical emerald "peacock dome" at night).
//   vite-node --root . scripts/build-green-dome.mjs <template.aquapkg> <out.aquapkg>
//
// Read from the photo (basin ≈ 14 m across the front, so ≈ 54 px/m):
//   dome 11.8 m wide × 7.6 m tall; all jets rise from a centre cluster r ≤ 1.4 m; the arches land
//   on an oval that reaches the coping at the sides (±5.9 m) and ≈ 4 m front/back; five arch layers
//   between the centre bundle and the low side arcs; a row of green floor lights along the front.
//
//   Core     9 vertical jets, the tallest (7.6 m centre, 7.2 m round it)
//   Ring A   12 jets on r 0.40 m, apex 6.8 m, landing at half the oval
//   Ring B   16 jets on r 0.65 m, apex 6.0 m, landing at 0.72 of the oval
//   Ring C   20 jets on r 0.90 m, apex 5.2 m, landing at 0.88 of the oval
//   Ring D   24 jets on r 1.15 m, apex 4.3 m, landing on the oval — the wide outer dome
//   Ring E   20 jets on r 1.40 m, apex 2.5 m, low side arcs landing just inside the oval
// Plan: x = across, y = depth (audience on +y), heights in m.
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";
import { solveReachSpeed } from "/src/components/preview/elevatedNozzles.js";
import { simulateFlight, RENDER_PHYSICS } from "/src/components/preview/designTrajectory.js";

const [tplPath, out] = process.argv.slice(2);
if (!tplPath || !out) { console.error("usage: vite-node --root . scripts/build-green-dome.mjs <template.aquapkg> <out.aquapkg>"); process.exit(1); }
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180, BAR = 10.197;
const GREEN = "#2bff5e", EDGE_GREEN = "#36ff80";
const JET = "nozzle_straight_jet_dn20";

const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
/** Pressure and flow for a jet reaching `reach` m along its aim (height efficiency + orifice law). */
function jetAt(reach) {
  const e = getDefaultEngineering(JET), eff = Number(e.heightEfficiency) || 0.75;
  const p = reach / (eff * BAR), p0 = Number(e.pressureBar) || p, q0 = Number(e.flowLpm) || 40;
  return { pressureBar: r3(p), flowLpm: r3(q0 * Math.sqrt(p / p0)) };
}
function jet(id, label, x, y, { tilt, azimuth, reach, pumpId, zone, group }) {
  add({ id, type: JET, label, x: r3(x), y: r3(y), zone, groupId: zone,
    engineering: { ...jetAt(reach), jetHeightM: reach, reachM: reach, aimDeg: tilt, aimAzimuthDeg: r3(((azimuth % 360) + 360) % 360),
      nozzleDiaMm: 8, exitTurbulence: 0.04, nozzleStyle: "smooth-bore clear jet on an adjustable ball joint",
      solenoidValveId: `${id}-valve`, pumpId, designStatus: "Green Dome concept — traced from the reference photo, verify with the supplier" } }, group);
  add({ id: `${id}-valve`, type: "valve_solenoid_dn15_24v", label: `Valve · ${label}`, x: r3(x), y: r3(y - 0.12), zone,
    engineering: { controlledFixtureId: id, pumpId } }, `${group} valves`);
  // Each jet's light sits just behind its nozzle and is aimed up along the jet, so the beam
  // follows the rising arc (the photo's threads are lit along their whole length).
  add({ id: `${id}-light`, type: "light_uw_rgb_18w", label: `Green light · ${label}`, x: r3(x), y: r3(y + 0.1), zone: "lights",
    engineering: { pairedNozzleId: id, defaultColor: GREEN, aimDeg: r3(Math.min(60, tilt + 6)), aimAzimuthDeg: r3(((azimuth % 360) + 360) % 360), beamAngleDeg: 15 } }, "Jet lights");
}

// ── Arc solver: tilt + reach for an arc of apex H (m) landing L (m) from its nozzle, flown with
// the renderer's own physics (gravity + drag), so what is drawn is what was designed. ─────────────
const flight = (tilt, reach) => { const v = solveReachSpeed(reach, tilt); return simulateFlight(v * Math.sin(tilt * DEG), v * Math.cos(tilt * DEG), RENDER_PHYSICS.water); };
const arcCache = new Map();
function arc(H, L) {
  const key = `${H.toFixed(2)}|${L.toFixed(2)}`;
  if (arcCache.has(key)) return arcCache.get(key);
  const reachFor = (tilt) => { let lo = 0.3, hi = 24; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (flight(tilt, m).apex < H) lo = m; else hi = m; } return hi; };
  let lo = 0.2, hi = 75;                                   // landing grows with tilt at a fixed apex
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (flight(m, reachFor(m)).range < L) lo = m; else hi = m; }
  const tilt = r3(hi), reach = r3(reachFor(hi)), f = flight(hi, reach);
  const res = { tilt, reach, apex: r3(f.apex), range: r3(f.range) };
  arcCache.set(key, res);
  return res;
}

// ── The dome: an oval footprint, wide across the front (the photo) and shallower front-to-back ───
const LX = 5.9, LY = 4.0;                                    // landing oval half-axes (ring D)
const ovalR = (aDeg) => { const c = Math.cos(aDeg * DEG), s = Math.sin(aDeg * DEG); return (LX * LY) / Math.sqrt((LY * c) ** 2 + (LX * s) ** 2); };

// Core bundle: the tallest jet in the middle, eight round it leaning 2° outward.
jet("core-1", "Core jet 1 (centre)", 0, 0, { tilt: 0, azimuth: 0, reach: 7.6, pumpId: "pump-core", zone: "core", group: "Core" });
for (let i = 0; i < 8; i++) {
  const a = i * 45, r = 0.22;
  jet(`core-${i + 2}`, `Core jet ${i + 2}`, r * Math.cos(a * DEG), r * Math.sin(a * DEG), { tilt: 2, azimuth: a, reach: 7.2, pumpId: "pump-core", zone: "core", group: "Core" });
}
// Rings: name, jets, nozzle radius, apex height, share of the landing oval, angular offset.
const RINGS = [
  ["A", 12, 0.40, 6.8, 0.50, 0],
  ["B", 16, 0.65, 6.0, 0.72, 11.25],
  ["C", 20, 0.90, 5.2, 0.88, 0],
  ["D", 24, 1.15, 4.3, 1.00, 7.5],
  ["E", 20, 1.40, 2.5, 0.96, 9],
];
const PUMP_OF = { A: "pump-core", B: "pump-inner", C: "pump-inner", D: "pump-outer", E: "pump-outer" };
for (const [name, n, r, H, share, offset] of RINGS) {
  for (let i = 0; i < n; i++) {
    const a = offset + (360 * i) / n, c = Math.cos(a * DEG), s = Math.sin(a * DEG);
    const L = Math.max(0.5, share * ovalR(a) - r);         // landing distance from this nozzle
    const { tilt, reach } = arc(H, L);
    jet(`ring${name}-${String(i + 1).padStart(2, "0")}`, `Ring ${name} jet ${i + 1}`, r * c, r * s,
      { tilt, azimuth: a, reach, pumpId: PUMP_OF[name], zone: `ring-${name.toLowerCase()}`, group: `Ring ${name}` });
  }
}
for (const [k, v] of arcCache) if ([...arcCache.keys()].indexOf(k) % 6 === 0) console.log(`arc ${k} → tilt ${v.tilt}° reach ${v.reach} m (apex ${v.apex}, lands ${v.range} m)`);
console.log(`${arcCache.size} arcs solved`);

// Floor light row along the front and back of the landing oval (the lit nozzle row in the photo):
// 36 W spots on the oval, aimed up and in toward the dome so the falling water is lit.
const EDGE = 26;
for (let i = 0; i < EDGE; i++) {
  const a = (360 * i) / EDGE + 360 / EDGE / 2, rr = ovalR(a) * 0.9, x = rr * Math.cos(a * DEG), y = rr * Math.sin(a * DEG);
  const toCentre = (Math.atan2(-y, -x) / DEG + 360) % 360;
  add({ id: `edge-light-${String(i + 1).padStart(2, "0")}`, type: "light_uw_rgb_36w", label: `Edge light ${i + 1} (dome skirt)`, x: r3(x), y: r3(y), zone: "edge-lights",
    engineering: { defaultColor: EDGE_GREEN, aimDeg: 35, aimAzimuthDeg: r3(toCentre), beamAngleDeg: 30 } }, "Edge lights");
}

// Pumps (VFD) sized from flow and head.
const pump = (id, label, members, x) => {
  const nz = members.map((m) => fixtures.find((f) => f.id === m));
  const flow = nz.reduce((s, f) => s + f.engineering.flowLpm, 0), head = Math.max(...nz.map((f) => f.engineering.pressureBar * BAR)) + 5;
  const kw = (flow / 60000) * 1000 * 9.81 * head / 0.65 / 1000;
  const sizes = [[0.75, "0_75"], [1.1, "1_1"], [1.5, "1_5"], [2.2, "2_2"], [3.0, "3_0"], [4.0, "4_0"], [5.5, "5_5"], [7.5, "7_5"]];
  const s = sizes.find(([k]) => k >= kw * 1.15);
  const type = s ? `pump_inline_vfd_pump_${s[1]}kw` : "pump_dry_centrifugal_15kw";
  add({ id, type, label, x, y: -7.5, zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(head) } }, "Pumps");
  console.log(`${label.padEnd(24)} ${String(nz.length).padStart(3)} jets · ${Math.round(flow)} L/min · head ${head.toFixed(1)} m · ~${kw.toFixed(1)} kW → ${type}`);
  return flow;
};
const G = (n) => groups.get(n) || [];
const total = pump("pump-core", "Core + ring A pump (VFD)", [...G("Core"), ...G("Ring A")], -3)
  + pump("pump-inner", "Rings B + C pump (VFD)", [...G("Ring B"), ...G("Ring C")], 0)
  + pump("pump-outer", "Rings D + E pump (VFD)", [...G("Ring D"), ...G("Ring E")], 3);
console.log(`total circulation ${(total * 0.06).toFixed(0)} m³/h`);

// Basin 14 × 10 m with a granite coping; plaza round it, trees behind (the photo's dark skyline).
const W = 14, D = 10;
const outline = [{ x: -W / 2, y: -D / 2 }, { x: W / 2, y: -D / 2 }, { x: W / 2, y: D / 2 }, { x: -W / 2, y: D / 2 }];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const site_surfaces = [
  { id: "plaza", label: "Plaza paving", type: "paving", color: "#8d8880", elevation: 0.02, visible: true, points: rect(-18, -13, 18, 20) },
  { id: "planting", label: "Trees and planting behind", type: "grass", color: "#2a4f26", elevation: 0.05, visible: true, points: rect(-18, -20, 18, -13) },
];

const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Green Dome — centre bundle and five rings of arches";
Object.assign(proj.engineering, {
  name: "Green Dome", id: "aquaflow-green-dome", projectName: NAME, pool_type: "rectangular",
  params: { width: W, length: D, radius: 0, depth: 0.5, units: "m", design_head_m: 20 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Green Dome basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  depth_zones: [{ id: "display", zone: "display", label: "Display basin (500 mm)", depth: 0.5, color: "#1f4d3a", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// Presentation show (60 s): the core rises, the dome opens ring by ring from the centre out,
// holds, breathes, and closes back in.
const items = inventory(fixtures);
const g = (name, color = GREEN) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Core"), g("Ring A"), g("Ring B"), g("Ring C"), g("Ring D"), g("Ring E"), g("Jet lights"), g("Edge lights", EDGE_GREEN)];
const rec = (group, name, effect, start, duration, extra = {}) => ({ ...newRecipe(SG.find((x) => x.name === group).id, start), name, effect, duration,
  cycles: 1, spread: 1, intensity: 100, order: "engineering", color: group === "Edge lights" ? EDGE_GREEN : GREEN, ...extra });
const END = 60;
const recipes = [
  rec("Jet lights", "Green glow", "static", 0, END),
  rec("Edge lights", "Skirt lights", "static", 0, END),
  rec("Core", "Core rises", "static", 0.5, END - 0.5),
  rec("Ring A", "Ring A opens", "static", 3, END - 3),
  rec("Ring B", "Ring B opens", "static", 5.5, END - 5.5),
  rec("Ring C", "Ring C opens", "static", 8, END - 8),
  rec("Ring D", "Ring D opens", "static", 10.5, END - 10.5),
  rec("Ring E", "Low arcs", "static", 13, 25),
  rec("Ring D", "Dome breathes", "wave", 24, 12, { cycles: 2 }),
  rec("Ring C", "Dome breathes", "wave", 24, 12, { cycles: 2 }),
  rec("Ring E", "Skirt ripples", "chase", 40, 8, { cycles: 2 }),
  rec("Ring E", "Finale", "static", 48, END - 48),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m1", name: "Core", time: 0, kind: "section" }, { id: "m2", name: "Dome opens", time: 3, kind: "section" },
    { id: "m3", name: "Full dome", time: 13, kind: "section" }, { id: "m4", name: "Breathing", time: 24, kind: "section" }, { id: "m5", name: "Finale", time: 40, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
console.log(readFountainDesign(items).summary);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END,
  audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-green-dome-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-green-dome", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0, activeCameraView: "front",
  cameraViews: [
    { id: "front", name: "Front (audience, 20 m)", position: { x: 0, y: 1.6, z: 20 }, target: { x: 0, y: 3.4, z: 0 }, fov: 32 },
    { id: "side", name: "Side view", position: { x: 17, y: 4, z: 10 }, target: { x: 0, y: 3.2, z: 0 } },
    { id: "angle", name: "Three-quarter", position: { x: -13, y: 2.5, z: 15 }, target: { x: 0, y: 3.4, z: 0 }, fov: 36 },
  ] };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest, null, 2) }]));
console.log(`→ ${out} · ${fixtures.length} fixtures · ${clips.length} cues · ${recipes.length} patterns`);
