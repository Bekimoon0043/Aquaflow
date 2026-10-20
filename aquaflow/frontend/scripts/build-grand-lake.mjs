// AquaFlow Grand Lake — a new showpiece site designed from scratch, then programmed to the
// song with the automatic show planner and saved as an .aquapkg.
//   vite-node build_site.mjs <template.aquapkg> <deep.json> <song.mp3> <out.aquapkg> [--seed N]
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering, getFixtureType } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, readStudio } from "/src/components/programmer/studio/showModel.js";
import { builderGroups } from "/src/components/programmer/studio/patternPresets.js";
import { designGroups, readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";
import { buildSiteModel } from "/src/components/programmer/studio/siteCapability.js";
import { bestOf } from "/src/components/programmer/studio/autoShow.js";
import { measureShow } from "/src/components/programmer/studio/showMetrics.js";
import { SECTION_NAMES } from "/src/components/programmer/studio/beatSync.js";

const [tplPath, deepPath, songPath, out] = process.argv.slice(2);
const seedArg = process.argv.indexOf("--seed");
const SEED = seedArg > 0 ? Number(process.argv[seedArg + 1]) : 0;
const r3 = (v) => Math.round(v * 1000) / 1000;
const BAR = 10.197;                                    // m of head per bar

// ── Basin: 72 × 36 m rounded rectangle (8 m corners), front (+y) faces the promenade ────────
const W = 72, D = 36, R = 8;
function roundedRect(w, d, r, step = 8) {
  const pts = [], hw = w / 2, hd = d / 2;
  const corners = [[hw - r, hd - r, 0], [-hw + r, hd - r, 90], [-hw + r, -hd + r, 180], [hw - r, -hd + r, 270]];
  for (const [cx, cy, a0] of corners) for (let a = a0; a <= a0 + 90; a += step) {
    const t = (a * Math.PI) / 180;
    pts.push({ x: r3(cx + r * Math.cos(t)), y: r3(cy + r * Math.sin(t)) });
  }
  return pts;
}
const outline = roundedRect(W, D, R);

// ── Fixtures ────────────────────────────────────────────────────────────────────────────
const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
};
/** Nozzle engineering at a design height: pressure from the height efficiency, flow by the orifice law. */
function nozzleAt(type, heightM) {
  const e = getDefaultEngineering(type);
  const eff = Number(e.heightEfficiency) || 0.7;
  const p = heightM / (eff * BAR), p0 = Number(e.pressureBar) || p, q0 = Number(e.flowLpm) || 50;
  return { jetHeightM: heightM, pressureBar: r3(p), flowLpm: r3(q0 * Math.sqrt(p / p0)), designStatus: "AquaFlow Grand Lake concept — verify with the supplier datasheet" };
}
const pump = (id, label, type, x, y, extra = {}) => add({ id, type, label, x, y, zone: "plant-room", groupId: "pumps", engineering: { ...extra } }, "Pumps");
const light = (id, nozzleId, x, y, type = "light_uw_rgb_36w", zone = "lights") =>
  add({ id, type, label: `${type.includes("rgbw") ? "RGBW" : "RGB"} light ${id.split("-").pop()}`, x, y, zone, groupId: zone, engineering: { pairedNozzleId: nozzleId } }, "Lights");

// A. Front line — 32 comet jets, 5 m, solenoid each, two shared pumps.
const front = [];
for (let i = 0; i < 32; i++) {
  const x = r3(-31 + i * 2), y = 12, id = `front-comet-${String(i + 1).padStart(2, "0")}`, v = `front-valve-${String(i + 1).padStart(2, "0")}`;
  const p = i < 16 ? "pump-front-left" : "pump-front-right";
  add({ id, type: "nozzle_comet_jet_dn15", label: `Front comet jet ${i + 1}`, x, y, zone: "front-line", groupId: "front_comets", engineering: { ...nozzleAt("nozzle_comet_jet_dn15", 5), solenoidValveId: v, pumpId: p } }, "Front comet line");
  add({ id: v, type: "valve_solenoid_dn15_24v", label: `Front valve ${i + 1}`, x, y: y + 0.35, zone: "front-line", groupId: "front_valves", engineering: { controlledFixtureId: id, pumpId: p } }, "Front solenoids");
  light(`front-light-${String(i + 1).padStart(2, "0")}`, id, x, y - 0.3);
  front.push({ id, v, p });
}
// B. Swing line — 16 Huaxin 2D swing nozzles at 9 m (own drives).
for (let i = 0; i < 16; i++) {
  const x = r3(-30 + i * 4), y = 5, id = `swing-${String(i + 1).padStart(2, "0")}`;
  add({ id, type: "motion_nozzle_2d_swing_huaxin", label: `2D swing nozzle ${i + 1}`, x, y, zone: "swing-line", groupId: "swing_nozzles", engineering: { jetHeightM: 9, panRangeDeg: 130, tiltRangeDeg: 135 } }, "2D swing line");
  light(`swing-light-${String(i + 1).padStart(2, "0")}`, id, x, y - 0.4, "light_uw_rgbw_72w", "swing-lights");
}
// C. Centre geysers — grand 14 m + two 10 m, each on its own VFD pump.
const geysers = [["geyser-grand", 0, -2, "nozzle_geyser_jet_dn80", 14, "pump-geyser-grand", "pump_dry_centrifugal_15kw"],
  ["geyser-left", -16, -2, "nozzle_geyser_jet_dn50", 10, "pump-geyser-left", "pump_submersible_5_5kw"],
  ["geyser-right", 16, -2, "nozzle_geyser_jet_dn50", 10, "pump-geyser-right", "pump_submersible_5_5kw"]];
for (const [id, x, y, type, h, p, pt] of geysers) {
  add({ id, type, label: id === "geyser-grand" ? "Grand geyser" : `Side geyser ${x < 0 ? "left" : "right"}`, x, y, zone: id === "geyser-grand" ? "centre-geyser" : `geyser-${x < 0 ? "left" : "right"}`, groupId: "geysers", engineering: { ...nozzleAt(type, h), pumpId: p } }, "Geysers");
  pump(p, `${id === "geyser-grand" ? "Grand geyser" : "Side geyser"} pump${x ? (x < 0 ? " L" : " R") : ""}`, pt, x, -24);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * 2 * Math.PI + Math.PI / 4; light(`${id}-light-${k + 1}`, id, r3(x + 1.3 * Math.cos(a)), r3(y + 1.3 * Math.sin(a)), "light_uw_rgbw_72w", "geyser-lights"); }
}
// D. Peacock crowns — 8 peacock fans (7 m) round each side geyser, each ring on one pump, no valves.
for (const side of [-1, 1]) {
  const cx = 16 * side, cy = -2, p = `pump-peacock-${side < 0 ? "left" : "right"}`;
  pump(p, `Peacock crown pump ${side < 0 ? "L" : "R"}`, "pump_submersible_3kw", cx, -26);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI, x = r3(cx + 3.5 * Math.cos(a)), y = r3(cy + 3.5 * Math.sin(a)), id = `peacock-${side < 0 ? "L" : "R"}${k + 1}`;
    add({ id, type: "nozzle_peacock_jet_dn25", label: `Peacock fan ${side < 0 ? "L" : "R"}${k + 1}`, x, y, rotation: r3((a * 180) / Math.PI), zone: `peacock-${side < 0 ? "left" : "right"}`, groupId: "peacock_crowns", engineering: { ...nozzleAt("nozzle_peacock_jet_dn25", 7), pumpId: p } }, "Peacock crowns");
    light(`${id}-light`, id, r3(cx + 3.1 * Math.cos(a)), r3(cy + 3.1 * Math.sin(a)));
  }
}
// E. Back row — 24 comet jets at 9 m, solenoid each, two shared pumps.
const back = [];
for (let i = 0; i < 24; i++) {
  const x = r3(-34.5 + i * 3), y = -12, id = `back-comet-${String(i + 1).padStart(2, "0")}`, v = `back-valve-${String(i + 1).padStart(2, "0")}`;
  const p = i < 12 ? "pump-back-left" : "pump-back-right";
  add({ id, type: "nozzle_comet_jet_dn25", label: `Back comet jet ${i + 1}`, x, y, zone: "back-row", groupId: "back_comets", engineering: { ...nozzleAt("nozzle_comet_jet_dn25", 9), solenoidValveId: v, pumpId: p } }, "Back comet row");
  add({ id: v, type: "valve_solenoid_dn25_24v", label: `Back valve ${i + 1}`, x, y: y - 0.35, zone: "back-row", groupId: "back_valves", engineering: { controlledFixtureId: id, pumpId: p } }, "Back solenoids");
  light(`back-light-${String(i + 1).padStart(2, "0")}`, id, x, y + 0.3);
  back.push({ id, v, p });
}
// F. Hero — 5 OASE air shooters (30 m).
for (let i = 0; i < 5; i++) {
  const x = -24 + i * 12, y = -7, id = `shooter-${i + 1}`;
  add({ id, type: "nozzle_air_shooter_24e_30m_oase", label: `Air shooter ${i + 1}`, x, y, zone: "shooters", groupId: "air_shooters", engineering: { jetHeightM: 30 } }, "Air shooters");
  light(`shooter-light-${i + 1}`, id, x, y + 0.6, "light_uw_rgbw_72w", "shooter-lights");
}
// Shared pumps for the solenoid rows (sized above the open-all flow of each half).
const flowOf = (list) => list.reduce((s, n) => s + fixtures.find((f) => f.id === n.id).engineering.flowLpm, 0);
for (const [p, label, type, list, x] of [["pump-front-left", "Front line pump L", "pump_submersible_3kw", front.slice(0, 16), -20],
  ["pump-front-right", "Front line pump R", "pump_submersible_3kw", front.slice(16), 20],
  ["pump-back-left", "Back row pump L", "pump_submersible_5_5kw", back.slice(0, 12), -10],
  ["pump-back-right", "Back row pump R", "pump_submersible_5_5kw", back.slice(12), 10]]) {
  pump(p, label, type, x, -22, { servesValveIds: list.map((n) => n.v) });
  console.log(`${label}: ${list.length} jets need ${Math.round(flowOf(list))} L/min of ${getDefaultEngineering(type).flowLpm} L/min`);
}

// ── Pipes, surfaces, depth ─────────────────────────────────────────────────────────────
const pipe = (id, label, d, pts) => ({ id, label, pipeType: "supply", diameterMm: d, closed: false, layer: "pipework", points: pts.map(([x, y]) => ({ x, y })) });
const pipes = [
  pipe("front-header-L", "Front line header L DN65", 65, [[-31, 12.6], [-1, 12.6]]), pipe("front-header-R", "Front line header R DN65", 65, [[1, 12.6], [31, 12.6]]),
  pipe("back-header-L", "Back row header L DN80", 80, [[-34.5, -12.6], [-1.5, -12.6]]), pipe("back-header-R", "Back row header R DN80", 80, [[1.5, -12.6], [34.5, -12.6]]),
  pipe("grand-feed", "Grand geyser feed DN150", 150, [[0, -18], [0, -2]]),
  pipe("left-feed", "Left geyser + crown feed DN100", 100, [[-16, -18], [-16, -2]]), pipe("right-feed", "Right geyser + crown feed DN100", 100, [[16, -18], [16, -2]]),
];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const site_surfaces = [
  { id: "promenade", label: "Promenade (audience)", type: "paving", color: "#a59c8c", elevation: 0.02, visible: true, points: rect(-52, 19.5, 52, 34) },
  { id: "steps", label: "Seating steps", type: "rock", color: "#8b8f96", elevation: 0.06, visible: true, points: rect(-30, 34, 30, 40) },
  { id: "lawn-back", label: "Lawn behind the lake", type: "grass", color: "#3d7a2e", elevation: 0.02, visible: true, points: rect(-52, -40, 52, -19.5) },
  { id: "planter-left", label: "Planting bed west", type: "soil", color: "#6d4a33", elevation: 0.05, visible: true, points: rect(-52, -19.5, -37.5, 19.5) },
  { id: "planter-right", label: "Planting bed east", type: "soil", color: "#6d4a33", elevation: 0.05, visible: true, points: rect(37.5, -19.5, 52, 19.5) },
];

// ── Project ────────────────────────────────────────────────────────────────────────────
const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "AquaFlow Grand Lake · DJ Milla Mashup Vol 4";
const eng = proj.engineering;
Object.assign(eng, {
  name: "AquaFlow Grand Lake", id: "aquaflow-grand-lake", projectName: NAME, pool_type: "freeform",
  params: { width: W, length: D, radius: R, depth: 0.8, units: "m", design_head_m: 30 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Grand Lake", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes,
  depth_zones: [{ id: "display", zone: "display", label: "Display lake", depth: 0.8, color: "#5fb4d6", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// Song: the stored analysis + stems of the DJ Milla mashup, and the deep analysis.
const tplProg = proj.programmer;
const analysis0 = Object.values(tplProg.musicCache)[0];
const deep = JSON.parse(fs.readFileSync(deepPath, "utf8"));
const analysis = { ...analysis0, deep };
const stems = tplProg.stems.items;

const items = inventory(fixtures);
const design = readFountainDesign(items);
const basin = outline.map((p) => [p.x, p.y]);
const studio0 = { ...readStudio({}), site: { basin, windMs: 0 } };
const allGroups = [...designGroups(design), ...builderGroups(studio0, items)];
const scm = buildSiteModel(items, { design, overrides: studio0.site });
console.log(`\n${design.summary}`);
for (const a of scm.areas) console.log(`  ${a.name.padEnd(34)} ${String(a.size).padStart(3)} · ${a.control.padEnd(6)} · ${a.role.padEnd(7)} · ${a.heightM} m × ${a.heightScale} · lead ${a.leadS}s${a.mirrorArea ? " · mirrored" : ""}${a.hero ? " · HERO" : ""}`);
for (const t of scm.tips) console.log("  tip:", t);

const ctx = { analysis, stems, items, groups: allGroups, design, site: studio0.site };
const t0 = Date.now();
const { best, ranked } = bestOf(studio0, ctx, { n: 6, from: SEED });
console.log(`\nbest of 6 in ${((Date.now() - t0) / 1000).toFixed(1)} s:`, ranked.map((r) => `seed ${r.seed}${"AB"[r.variant]} ${r.score}${r.pass ? "" : " FAIL"}`).join(" · "));
const studio = { ...best.studio, markers: best.plan.sections.map((s) => ({ id: `marker-${s.id}`, name: `${s.role[0].toUpperCase()}${s.role.slice(1)} · ${SECTION_NAMES[s.label] || s.label}`, time: s.start, kind: "section" })) };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 5));
const m = measureShow({ clips, items, analysis, studio, design, basin, windMs: 0 });
console.log(`score ${m.score} · ${m.pass ? "PASS all hard gates" : "FAIL " + JSON.stringify(m.gates.counts)} · ${JSON.stringify(m.metrics)}`);
console.log("plan:", best.plan.sections.map((s) => `${s.role}@${Math.floor(s.start / 60)}:${String(Math.round(s.start % 60)).padStart(2, "0")}`).join(" → "));

// Timeline tracks for every channel of every fixture, with its clips.
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
const songBytes = fs.readFileSync(songPath);
const sha = crypto.createHash("sha256").update(songBytes).digest("hex");
const stat = fs.statSync(songPath), songName = path.basename(songPath);
const duration = Math.min(600, Math.round(analysis.duration * 1000) / 1000);
proj.programmer = { ...tplProg, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: duration,
  audioFileReference: { name: songName, size: stat.size, type: "audio/mpeg", lastModified: Math.round(stat.mtimeMs), path: songPath },
  musicCache: { [`sha256:${sha}`]: { ...analysis, hash: `sha256:${sha}`, name: songName, analyzedAt: Date.now(), cachedAt: Date.now() } }, stems: tplProg.stems };
proj.show = { ...proj.show, id: "aquaflow-grand-lake-milla", name: NAME, bpm: Math.round(analysis.bpm), duration: Math.ceil(duration) };
proj.project = { ...proj.project, id: "aquaflow-grand-lake", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0 };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out,
  assets: [{ id: "audio:programmer", role: "audio", source: "file", name: songName, type: "audio/mpeg", path: songPath, size: stat.size, sha256: sha, relativePath: null, locator: { field: "programmer.audioFileReference" } }] };
proj.savedAt = now;
const manifest = JSON.stringify(proj.assetManifest, null, 2);
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: manifest }]));
console.log(`\n→ ${out} · ${(fs.statSync(out).size / 1e6).toFixed(1)} MB · ${fixtures.length} fixtures · ${clips.length} cues · ${studio.recipes.length} recipes`);
