// Green Crown — a centre bouquet of clear jets opening outward in rings, framed by a ring of jets
// arching in toward it, every jet lit green from below (the user's reference photos).
//   vite-node build-green-crown.mjs <template.aquapkg> <out.aquapkg>
//
//   Core     5 vertical jets at the centre, the tallest (6.5 m)
//   Ring A   10 jets on r 0.35 m tilted 4° outward (apex 6.0 m)
//   Ring B   16 jets on r 0.60 m tilted 7.5° outward (apex 5.2 m)
//   Ring C   20 jets on r 0.85 m tilted 13° outward (apex 4.2 m) — the wide outer arches of the bouquet
//   Outer    20 jets on an oval round the basin, tilted 12° inward (apex 3.2 m) — arches leaning to the centre
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";
import { solveReachSpeed } from "/src/components/preview/elevatedNozzles.js";
import { simulateFlight, RENDER_PHYSICS } from "/src/components/preview/designTrajectory.js";

const [tplPath, out] = process.argv.slice(2);
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180, BAR = 10.197;
const GREEN = "#2bff6a";
const JET = "nozzle_straight_jet_dn20";

const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
/** Pressure and flow for a jet reaching `reach` m (height efficiency + orifice law). */
function jetAt(reach) {
  const e = getDefaultEngineering(JET), eff = Number(e.heightEfficiency) || 0.75;
  const p = reach / (eff * BAR), p0 = Number(e.pressureBar) || p, q0 = Number(e.flowLpm) || 40;
  return { pressureBar: r3(p), flowLpm: r3(q0 * Math.sqrt(p / p0)) };
}
function jet(id, label, x, y, { tilt, azimuth, reach, pumpId, zone, group }) {
  add({ id, type: JET, label, x: r3(x), y: r3(y), zone, groupId: zone,
    engineering: { ...jetAt(reach), jetHeightM: reach, reachM: reach, aimDeg: tilt, aimAzimuthDeg: r3(((azimuth % 360) + 360) % 360),
      solenoidValveId: `${id}-valve`, pumpId, designStatus: "Green Crown concept — verify with the supplier" } }, group);
  add({ id: `${id}-valve`, type: "valve_solenoid_dn15_24v", label: `Valve · ${label}`, x: r3(x), y: r3(y - 0.12), zone,
    engineering: { controlledFixtureId: id, pumpId } }, `${group} valves`);
  add({ id: `${id}-light`, type: "light_uw_rgb_18w", label: `Green light · ${label}`, x: r3(x), y: r3(y + 0.1), zone: "lights",
    engineering: { pairedNozzleId: id, defaultColor: GREEN } }, "Lights");
}

// ── Arc solver: tilt + reach for an arc of apex H (m) landing L (m) from its nozzle, flown with
// the renderer's own physics (gravity + drag), so what is drawn is what was designed. ─────────────
const flight = (tilt, reach) => { const v = solveReachSpeed(reach, tilt); return simulateFlight(v * Math.sin(tilt * DEG), v * Math.cos(tilt * DEG), RENDER_PHYSICS.water); };
const arcCache = new Map();
function arc(H, L) {
  const key = `${H.toFixed(2)}|${L.toFixed(2)}`;
  if (arcCache.has(key)) return arcCache.get(key);
  const reachFor = (tilt) => { let lo = 0.3, hi = 20; for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (flight(tilt, m).apex < H) lo = m; else hi = m; } return hi; };
  let lo = 0.2, hi = 70;                                   // landing grows with tilt at a fixed apex
  for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (flight(m, reachFor(m)).range < L) lo = m; else hi = m; }
  const tilt = r3(hi), out = { tilt, reach: r3(reachFor(hi)) };
  arcCache.set(key, out);
  return out;
}

// Centre bouquet: an oval crown, wide to the sides and shallow front-to-back like the photos.
// Each ring's arcs land on an oval (LX × LY at ring C) and get lower as they reach further.
const LX = 5.5, LY = 3.4;
for (let i = 0; i < 5; i++) {
  const a = i * 72, r = i ? 0.15 : 0;
  jet(`core-${i + 1}`, `Core jet ${i + 1}`, r * Math.cos(a * DEG), r * Math.sin(a * DEG), { tilt: 0, azimuth: 0, reach: 6.6, pumpId: "pump-bouquet", zone: "core", group: "Core" });
}
const RINGS = [["A", 12, 0.35, 6.0, 0.32, 0], ["B", 18, 0.6, 5.1, 0.64, 10], ["C", 24, 0.85, 4.1, 1.0, 3.75]];   // name, jets, r, apex, oval share, offset
for (const [name, n, r, H, share, offset] of RINGS) {
  for (let i = 0; i < n; i++) {
    const a = offset + (360 * i) / n, c = Math.cos(a * DEG), sn = Math.sin(a * DEG);
    const ovalR = (LX * LY) / Math.sqrt((LY * c) ** 2 + (LX * sn) ** 2);       // oval radius in this direction
    const { tilt, reach } = arc(H, Math.max(0.4, share * ovalR - r));
    jet(`ring${name}-${String(i + 1).padStart(2, "0")}`, `Ring ${name} jet ${i + 1}`, r * c, r * sn,
      { tilt, azimuth: a, reach, pumpId: "pump-bouquet", zone: `ring-${name.toLowerCase()}`, group: `Ring ${name}` });
  }
}
// Outer ring on an oval round the basin, arching up and in toward the bouquet.
const RX = 6.0, RY = 3.6, outerArc = arc(3.8, 2.6);
for (let i = 0; i < 24; i++) {
  const a = (360 * i) / 24 + 7.5, x = RX * Math.cos(a * DEG), y = RY * Math.sin(a * DEG);
  const toCentre = Math.atan2(-y, -x) / DEG;
  jet(`outer-${String(i + 1).padStart(2, "0")}`, `Outer arch jet ${i + 1}`, x, y, { ...outerArc, azimuth: toCentre, pumpId: "pump-outer", zone: "outer-ring", group: "Outer ring" });
}
console.log("arcs:", [...arcCache].map(([k, v]) => `${k}→${v.tilt}°/${v.reach}m`).slice(0, 6).join("  "), `… (${arcCache.size} solved)`);

// Pumps (VFD) sized from flow and head.
const pump = (id, label, group, x) => {
  const nz = groups.get(group).map((m) => fixtures.find((f) => f.id === m));
  const flow = nz.reduce((s, f) => s + f.engineering.flowLpm, 0), head = Math.max(...nz.map((f) => f.engineering.pressureBar * BAR)) + 5;
  const kw = (flow / 60000) * 1000 * 9.81 * head / 0.65 / 1000;
  const sizes = [[0.75, "0_75"], [1.1, "1_1"], [1.5, "1_5"], [2.2, "2_2"], [3.0, "3_0"], [4.0, "4_0"], [5.5, "5_5"], [7.5, "7_5"]];
  const s = sizes.find(([k]) => k >= kw * 1.15);
  const type = s ? `pump_inline_vfd_pump_${s[1]}kw` : "pump_dry_centrifugal_15kw";
  add({ id, type, label, x, y: -6.5, zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(head) } }, "Pumps");
  console.log(`${label.padEnd(24)} ${nz.length} jets · ${Math.round(flow)} L/min · head ${head.toFixed(1)} m · ~${kw.toFixed(1)} kW → ${type}`);
};
groups.set("Bouquet", [...groups.get("Core"), ...groups.get("Ring A"), ...groups.get("Ring B"), ...groups.get("Ring C")]);
pump("pump-bouquet", "Bouquet pump (VFD)", "Bouquet", -2);
pump("pump-outer", "Outer ring pump (VFD)", "Outer ring", 2);
groups.delete("Bouquet");

// Basin 14 × 9 m with a granite coping; plaza around it.
const W = 14, D = 9;
const outline = [{ x: -W / 2, y: -D / 2 }, { x: W / 2, y: -D / 2 }, { x: W / 2, y: D / 2 }, { x: -W / 2, y: D / 2 }];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const site_surfaces = [
  { id: "plaza", label: "Plaza paving", type: "paving", color: "#9c968c", elevation: 0.02, visible: true, points: rect(-16, -12, 16, 14) },
  { id: "hedge-back", label: "Hedges and planting", type: "grass", color: "#2f5d2a", elevation: 0.05, visible: true, points: rect(-16, -16, 16, -12) },
];

const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Green Crown — bouquet and arches";
Object.assign(proj.engineering, {
  name: "Green Crown", id: "aquaflow-green-crown", projectName: NAME, pool_type: "rectangular",
  params: { width: W, length: D, radius: 0, depth: 0.6, units: "m", design_head_m: 20 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Green Crown basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  depth_zones: [{ id: "display", zone: "display", label: "Display basin", depth: 0.6, color: "#3c8a5a", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// Presentation show (60 s): the bouquet opens ring by ring, the arches join, then it breathes.
const items = inventory(fixtures);
const g = (name, color = GREEN) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Core"), g("Ring A"), g("Ring B"), g("Ring C"), g("Outer ring"), g("Lights")];
const rec = (group, name, effect, start, duration, extra = {}) => ({ ...newRecipe(SG.find((x) => x.name === group).id, start), name, effect, duration,
  cycles: 1, spread: 1, intensity: 100, order: "engineering", color: GREEN, ...extra });
const END = 60;
const recipes = [
  rec("Lights", "Green glow", "static", 0, END),
  rec("Core", "Core rises", "static", 0.5, END - 0.5),
  rec("Ring A", "Ring A opens", "static", 3, END - 3),
  rec("Ring B", "Ring B opens", "static", 6, END - 6),
  rec("Ring C", "Ring C opens", "static", 9, END - 9),
  rec("Outer ring", "Arches run round", "chase", 13, 7, { cycles: 2 }),
  rec("Outer ring", "Full crown", "static", 20, 15),
  rec("Ring C", "Crown breathes", "wave", 35, 10, { cycles: 2, intensity: 100 }),
  rec("Outer ring", "Arches ripple", "wave", 35, 10, { cycles: 3 }),
  rec("Outer ring", "Finale", "static", 45, END - 45),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m1", name: "Bouquet opens", time: 0, kind: "section" }, { id: "m2", name: "Arches", time: 13, kind: "section" },
    { id: "m3", name: "Full crown", time: 20, kind: "section" }, { id: "m4", name: "Breathing", time: 35, kind: "section" }, { id: "m5", name: "Finale", time: 45, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
console.log(readFountainDesign(items).summary);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END,
  audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-green-crown-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-green-crown", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0 };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest, null, 2) }]));
console.log(`→ ${out} · ${fixtures.length} fixtures · ${clips.length} cues · ${recipes.length} patterns`);
