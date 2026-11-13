// Emblem fountain: 30 s client show written onto an existing emblem pipe .aquapkg. The design is left
// untouched; only the show changes. Every moment is a named, editable pattern on an element group.
//   vite-node --root . scripts/build-emblem-show.mjs <source.aquapkg> <out.aquapkg> [schedule.tsv]
//
// Elements are found from the traced pipes: sun ring (the largest loop), rays (outside the ring),
// staff (far left), right-hand item (far right: crescent below, stem and cup above), small star
// under the chin, hair (the scalloped outline) and the face (everything else inside the ring).
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";

const [srcPath, out, schedulePath] = process.argv.slice(2);
if (!srcPath || !out) { console.error("usage: vite-node --root . scripts/build-emblem-show.mjs <source.aquapkg> <out.aquapkg> [schedule.tsv]"); process.exit(1); }

const END = 30;
const GOLD = "#ffb400", RED = "#f01428", ORANGE = "#ff6400", WHITE = "#fff3dc", GREEN = "#14d84a";

const proj = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get("project.aqua")));
const eng = proj.engineering, pipes = eng.manualPipes;
const jets = eng.fixtures.filter((f) => /^nozzle/.test(f.type));
const lightOf = new Map(eng.fixtures.filter((f) => /^light/.test(f.type)).map((f) => [`${f.x},${f.y}`, f]));

const segDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const ownerPipe = (j) => {
  let best = null;
  pipes.forEach((pipe, i) => {
    for (let k = 1; k < pipe.points.length; k++) {
      const d = segDist(j, pipe.points[k - 1], pipe.points[k]);
      if (!best || d < best.d) best = { d, i };
    }
  });
  return best.i;
};

// The sun ring is the traced loop with the most jets inside the central column.
const counts = new Map();
const owners = new Map(jets.map((j) => { const i = ownerPipe(j); counts.set(i, (counts.get(i) || 0) + 1); return [j.id, i]; }));
const central = [...counts].filter(([i]) => Math.abs(pipes[i].points.reduce((s, p) => s + p.x, 0) / pipes[i].points.length) < 3);
const ringPipe = central.sort((a, b) => b[1] - a[1])[0][0];
const ringPts = pipes[ringPipe].points;
const CX = ringPts.reduce((s, p) => s + p.x, 0) / ringPts.length, CY = ringPts.reduce((s, p) => s + p.y, 0) / ringPts.length;
const R = ringPts.reduce((s, p) => s + Math.hypot(p.x - CX, p.y - CY), 0) / ringPts.length;

const classify = (j) => {
  const r = Math.hypot(j.x - CX, j.y - CY);
  if (owners.get(j.id) === ringPipe) return "ring";
  if (j.x < -11) return "staff";
  if (j.x > 10.2 && j.y > 2) return j.y < 4.35 ? "crescent" : "cup";
  if (r > R + 0.15) return "rays";
  // Small star under the chin: a tight cluster below the centre on the right of the axis.
  if (j.x > -0.1 && j.x < 3.3 && j.y > -5.45 && j.y < -3.15) return "star";
  if (r > R * 0.62) return "hair";
  return "face";
};
const parts = {};
for (const j of jets) (parts[classify(j)] ||= []).push(j);
const lightsFor = (list) => list.map((j) => lightOf.get(`${j.x},${j.y}`)?.id).filter(Boolean);
// Rays alternate gold and red, one colour per ray.
const rayIndex = (j) => Math.floor((((Math.atan2(j.y - CY, j.x - CX) / (2 * Math.PI)) + 1) % 1) * 20);
const raysA = parts.rays.filter((j) => rayIndex(j) % 2 === 0), raysB = parts.rays.filter((j) => rayIndex(j) % 2 === 1);

const group = (id, name, memberFixtureIds, color) => ({ id, name, memberFixtureIds, orderMode: "engineering", color, muted: false, solo: false });
const G = [
  group("w-ring", "Sun ring · water", parts.ring.map((j) => j.id), GOLD), group("l-ring", "Sun ring · lights", lightsFor(parts.ring), GOLD),
  group("w-rays", "Sun rays · water", parts.rays.map((j) => j.id), GOLD),
  group("l-rays-a", "Sun rays · gold lights", lightsFor(raysA), GOLD), group("l-rays-b", "Sun rays · red lights", lightsFor(raysB), RED),
  group("w-hair", "Hair · water", parts.hair.map((j) => j.id), ORANGE), group("l-hair", "Hair · lights", lightsFor(parts.hair), ORANGE),
  group("w-face", "Face · water", parts.face.map((j) => j.id), WHITE), group("l-face", "Face · lights", lightsFor(parts.face), WHITE),
  group("w-star", "Small star · water", parts.star.map((j) => j.id), WHITE), group("l-star", "Small star · lights", lightsFor(parts.star), WHITE),
  group("w-staff", "Staff · water", parts.staff.map((j) => j.id), GREEN), group("l-staff", "Staff · lights", lightsFor(parts.staff), GREEN),
  group("w-cres", "Crescent · water", parts.crescent.map((j) => j.id), RED), group("l-cres", "Crescent · lights", lightsFor(parts.crescent), RED),
  group("w-cup", "Cup · water", parts.cup.map((j) => j.id), GOLD), group("l-cup", "Cup · lights", lightsFor(parts.cup), GOLD),
  group("w-all", "Whole emblem · water", jets.map((j) => j.id), WHITE),
];

const LAMP = Number(process.env.LAMP) || 20;  // at full output the lights wash the floor white in the 3D view
const base = (groupId, name, start, duration, extra) => ({ ...newRecipe(groupId, start), name, start, duration, cycles: 1, spread: 1, intensity: 100,
  color: G.find((g) => g.id === groupId).color, ...extra });

// Lines draw on: each jet rises `rise` s after the one before it, the sweep takes `sweep` s, then holds.
const drawOn = (groupId, name, start, duration, sweep, order, high, rise = 1) => {
  const P = duration * 2 + 2, r = rise / P;
  return base(groupId, name, start, duration, { effect: "field", order, field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period: P, crests: sweep / P, direction: 1,
    points: [{ time: 0, value: 0 }, { time: r, value: 1 }, { time: 0.56, value: 1 }, { time: 0.6, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
};
// Drawn over half a cycle so the level never wraps back to its start (a `curve` recipe does, on its last frame).
const ramp = (groupId, name, start, duration, from, to, points = [{ time: 0, value: 0 }, { time: 0.5, value: 1 }, { time: 1, value: 1 }]) => base(groupId, name, start, duration,
  { effect: "field", order: "engineering", field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat", period: duration * 2, spread: 0, points, low: from, high: to, ease: 0 } });
const hold = (groupId, name, start, duration, level) => base(groupId, name, start, duration, { effect: "static", intensity: level });
const wave = (groupId, name, start, duration, order, field) => base(groupId, name, start, duration, { effect: "field", order, field: { ease: 0.8, ...field } });
const travel = (dir, crests, period, low, high) => ({ kind: "travelling", crests, period, direction: dir, low, high });
const breathe = (period, low, high) => ({ kind: "swell", period, lag: 0, low, high });
const ripple = (period, low, high) => ({ kind: "custom", shape: "bump", path: "around", motion: "repeat", period, crests: 1, width: 0.2, direction: 1, low, high });

const lamp = (v) => Math.round(v * LAMP / 100);
const R0 = 65;  // every element meets at this level at 25 s, so the whole-emblem patterns take over without a jump

const recipes = [
  // 0–3.5 s  sunrise: the ring draws itself clockwise
  drawOn("w-ring", "Sunrise: ring draws clockwise", 0, 3.5, 2.5, "clockwise", 80), drawOn("l-ring", "Sunrise: ring lights", 0, 3.5, 2.5, "clockwise", lamp(90)),
  hold("w-ring", "Ring holds", 3.5, 4.5, 80), hold("l-ring", "Ring holds", 3.5, 4.5, lamp(90)),
  // 3–8 s  the rays burst out around the ring
  drawOn("w-rays", "Sun rays burst round the ring", 3, 5, 3.5, "clockwise", 72), drawOn("l-rays-a", "Rays light gold", 3, 5, 3.5, "clockwise", lamp(100)), drawOn("l-rays-b", "Rays light red", 3, 5, 3.5, "clockwise", lamp(100)),
  // 8–11 s  sun steps back, hair traced round the head
  ramp("w-ring", "Ring steps back", 8, 1.5, 80, 45), hold("w-ring", "Ring low", 9.5, 10.5, 45), ramp("w-ring", "Ring gathers", 20, 1, 45, 65), ramp("l-ring", "Ring steps back", 8, 1.5, lamp(90), lamp(50)), hold("l-ring", "Ring low", 9.5, 10.5, lamp(50)), ramp("l-ring", "Ring gathers", 20, 1, lamp(50), lamp(72.5)),
  ramp("w-rays", "Rays step back", 8, 1.5, 72, 40), hold("w-rays", "Rays low", 9.5, 10.5, 40), ramp("w-rays", "Rays gather", 20, 1, 40, 62.5),
  ramp("l-rays-a", "Rays step back", 8, 1.5, lamp(100), lamp(45)), hold("l-rays-a", "Rays low", 9.5, 10.5, lamp(45)), ramp("l-rays-a", "Rays gather", 20, 1, lamp(45), lamp(62.5)),
  ramp("l-rays-b", "Rays step back", 8, 1.5, lamp(100), lamp(45)), hold("l-rays-b", "Rays low", 9.5, 10.5, lamp(45)), ramp("l-rays-b", "Rays gather", 20, 1, lamp(45), lamp(62.5)),
  drawOn("w-hair", "Hair traced round the head", 8, 3, 2, "clockwise", 60), drawOn("l-hair", "Hair lights", 8, 3, 2, "clockwise", lamp(85)),
  hold("w-hair", "Hair holds", 11, 10, 60), hold("l-hair", "Hair holds", 11, 10, lamp(85)),
  // 11–14 s  the face appears from its centre, the small star sparkles
  drawOn("w-face", "Face rises from its centre", 11, 3, 1.9, "center-out", 82.5), drawOn("l-face", "Face lights", 11, 3, 1.9, "center-out", lamp(100)),
  drawOn("w-star", "Small star appears", 12.5, 1.5, 0.4, "center-out", 82.5), drawOn("l-star", "Small star lights", 12.5, 1.5, 0.4, "center-out", lamp(100)),
  // 14–21 s  the portrait breathes while the two items rise beside it
  wave("w-face", "Portrait breathes", 14, 7, "engineering", breathe(3.5, 65, 100)), hold("l-face", "Portrait lit", 14, 7, lamp(100)),
  wave("w-star", "Star breathes", 14, 7, "engineering", breathe(3.5, 65, 100)), hold("l-star", "Star lit", 14, 7, lamp(100)),
  drawOn("w-staff", "Staff rises from foot to head", 14, 4, 2.5, "front-to-back", 77.5), drawOn("l-staff", "Staff lights", 14, 4, 2.5, "front-to-back", lamp(100)),
  drawOn("w-cres", "Crescent drawn left to right", 16, 2.5, 1.5, "left-to-right", 77.5), drawOn("l-cres", "Crescent lights", 16, 2.5, 1.5, "left-to-right", lamp(100)),
  drawOn("w-cup", "Cup fills from stem to rim", 17, 3, 2, "front-to-back", 77.5), drawOn("l-cup", "Cup lights", 17, 3, 2, "front-to-back", lamp(100)),
  // 18–21 s  call and answer between the staff and the cup
  wave("w-staff", "Staff calls", 18, 3, "engineering", { ...breathe(3, 55, 100), ease: 0.5 }), hold("l-staff", "Staff lit", 18, 7, lamp(100)),
  wave("w-cres", "Crescent answers", 18.5, 2.5, "engineering", { ...breathe(2.5, 55, 100), ease: 0.5 }), hold("l-cres", "Crescent lit", 18.5, 6.5, lamp(100)),
  wave("w-cup", "Cup answers", 20, 1, "engineering", { ...breathe(1, 60, 95), ease: 0.4 }), hold("l-cup", "Cup lit", 20, 5, lamp(100)),
  // 21–25 s  the star circles him: two crests race clockwise round the rays, the ring runs the other way
  wave("w-rays", "Star circles clockwise", 21, 4, "clockwise", travel(1, 2, 2, 25, 100)), wave("w-ring", "Ring counter-rotates", 21, 4, "clockwise", travel(-1, 3, 2.4, 35, 95)),
  wave("l-rays-a", "Gold chases round", 21, 4, "clockwise", travel(1, 2, 2, lamp(25), lamp(100))), wave("l-rays-b", "Red chases round", 21, 4, "clockwise", travel(1, 2, 2, lamp(25), lamp(100))),
  wave("l-ring", "Ring lights counter-rotate", 21, 4, "clockwise", travel(-1, 3, 2.4, lamp(45), lamp(100))),
  wave("w-hair", "Hair swells", 21, 4, "engineering", breathe(4, 40, 80)), hold("l-hair", "Hair lit", 21, 4, lamp(85)),
  ramp("w-face", "Face settles", 21, 1, 82.5, 65), wave("w-face", "Face holds strong", 22, 3, "engineering", breathe(3, 50, 80)), hold("l-face", "Face lit", 21, 4, lamp(100)),
  ramp("w-star", "Star settles", 21, 1, 82.5, 65), wave("w-star", "Star holds strong", 22, 3, "engineering", breathe(3, 50, 80)), hold("l-star", "Star lit", 21, 4, lamp(100)),
  ramp("w-staff", "Staff settles", 21, 1, 77.5, 65), ramp("w-cres", "Crescent settles", 21, 1, 77.5, 65), ramp("w-cup", "Cup settles", 21, 1, 77.5, 65),
  wave("w-staff", "Staff and cup sway", 22, 3, "engineering", breathe(2, 45, 85)), wave("w-cres", "Staff and cup sway", 22, 3, "engineering", breathe(2, 45, 85)), wave("w-cup", "Staff and cup sway", 22, 3, "engineering", breathe(2, 45, 85)),
  // 25–27.5 s  a ring of water spreads from the centre through the whole emblem, twice
  wave("w-all", "Ripple from the centre", 25, 2.5, "center-out", { ...ripple(1.25, 30, 100), ease: 0.5 }),
  ...["l-ring", "l-rays-a", "l-rays-b", "l-hair", "l-face", "l-star", "l-staff", "l-cres", "l-cup"].map((g) => hold(g, "Colours hold through the ripple", 25, 2.5, lamp(100))),
  // 27.5–29 s  full emblem, every colour home
  ramp("w-all", "Full emblem rises", 27.5, 0.5, R0, 100), hold("w-all", "Full emblem", 28, 1, 100),
  hold("l-ring", "Finale gold", 27.5, 1.5, lamp(100)), ramp("l-ring", "Light fades", 29, 1, lamp(100), 0), hold("l-rays-a", "Finale gold", 27.5, 1.5, lamp(100)), ramp("l-rays-a", "Light fades", 29, 1, lamp(100), 0), hold("l-rays-b", "Finale red", 27.5, 1.5, lamp(100)), ramp("l-rays-b", "Light fades", 29, 1, lamp(100), 0),
  hold("l-hair", "Finale orange", 27.5, 1.5, lamp(100)), ramp("l-hair", "Light fades", 29, 1, lamp(100), 0), hold("l-face", "Finale white", 27.5, 1.5, lamp(100)), ramp("l-face", "Light fades", 29, 1, lamp(100), 0), hold("l-star", "Finale white", 27.5, 1.5, lamp(100)), ramp("l-star", "Light fades", 29, 1, lamp(100), 0),
  hold("l-staff", "Finale green", 27.5, 1.5, lamp(100)), ramp("l-staff", "Light fades", 29, 1, lamp(100), 0), hold("l-cres", "Finale red", 27.5, 1.5, lamp(100)), ramp("l-cres", "Light fades", 29, 1, lamp(100), 0), hold("l-cup", "Finale gold", 27.5, 1.5, lamp(100)), ramp("l-cup", "Light fades", 29, 1, lamp(100), 0),
  // 29–30 s  the water falls, the light goes with it
  ramp("w-all", "Water falls", 29, 1, 100, 0),
];
const markers = [[0, "Sunrise"], [3, "Sun rays burst"], [8, "Hair traced"], [11, "Face appears"], [14, "Staff rises"], [16, "Crescent and cup"], [18, "Call and answer"],
  [21, "Star circles him"], [25, "Ripple from the centre"], [27.5, "Full emblem"], [29, "Water falls"]]
  .map(([time, name], i) => ({ id: `m${i + 1}`, name, label: name, time, kind: "section", color: "#ffb400" }));

const items = inventory(eng.fixtures);
const unprogrammable = items.filter((i) => !(i.tracks || []).length).length;
if (unprogrammable) throw new Error(`${unprogrammable} fixtures have no channels in the library`);

const prev = proj.programmer?.studio || {};
const studio = { ...readStudio({}), version: prev.version, groups: G, recipes, tempo: [{ time: 0, bpm: 120 }], markers, layout: { ...(prev.layout || {}) } };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) { console.log("issues:", issues.slice(0, 10)); throw new Error("compile issues"); }

// Every jet's level over the show: nothing may jump faster than water can follow, and no jet may be
// left running at the end. Levels are sampled through the same keyed curves the show frame uses.
const clipsOf = new Map();
for (const c of clips) (clipsOf.get(c.fixtureId) || clipsOf.set(c.fixtureId, []).get(c.fixtureId)).push(c);
const at = (list, t) => {
  let v = 0;
  for (const c of list) {
    if (t < c.startTime || t >= c.startTime + c.duration) continue;
    if (!c.keys) { v = Math.max(v, c.value); continue; }
    const u = t - c.startTime; let k = 0;
    while (k + 2 < c.keys.length && c.keys[k + 2] <= u) k += 2;
    const a = c.keys[k + 2] === undefined ? c.keys[k + 1] : c.keys[k + 1] + (c.keys[k + 3] - c.keys[k + 1]) * (u - c.keys[k]) / (c.keys[k + 2] - c.keys[k]);
    v = Math.max(v, a);
  }
  return v;
};
let worstSlew = 0, worstAt = null, peakFlow = 0, peakAt = 0;
const MAX_SLEW = 200, jumps = new Map();  // % of full height per second
const DT = 0.05, flowOf = (f) => Number(f.engineering?.flowLpm) || 0;
for (let t = 0; t <= END - DT; t += DT) {
  let flow = 0;
  for (const j of jets) {
    const list = clipsOf.get(j.id) || [], a = at(list, t), b = at(list, t + DT);
    const slew = Math.abs(b - a) / DT;
    if (slew > worstSlew) { worstSlew = slew; worstAt = { t: Math.round(t * 100) / 100, id: j.id, a, b }; }
    if (slew > MAX_SLEW) { const k = `${Math.round(t * 20) / 20} ${classify(j)}`; jumps.set(k, Math.max(jumps.get(k) || 0, Math.round(slew))); }
    flow += flowOf(j) * Math.sqrt(a / 100);
  }
  if (flow > peakFlow) { peakFlow = flow; peakAt = t; }
}
const clipEnd = Math.max(...clips.map((c) => c.startTime + c.duration));
console.log("parts:", Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v.length])), `ring centre (${CX.toFixed(2)}, ${CY.toFixed(2)}) R ${R.toFixed(2)}`);
console.log("recipes", recipes.length, "clips", clips.length, "end", clipEnd);
console.log("worst slew %/s", Math.round(worstSlew), worstAt, "peak flow m3/h", Math.round(peakFlow * 0.06), "at", Math.round(peakAt * 10) / 10);
console.log("jumps over", MAX_SLEW, "%/s:", jumps.size, [...jumps].slice(0, 24).join(" | "));

const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
const now = new Date().toISOString();
const name = "Emblem Fountain · 30 s Client Show";
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioDuration: END, patternDefinitions: [{ id: "emblem-30s", name, duration: END }] };
proj.show = { ...proj.show, name, duration: END, loop: false };
proj.project = { ...proj.project, name, modifiedAt: now };
// The emblem reads upright from the curved side of the pool (world -z), so the camera stays on that side.
const key = (t, pos, tgt, fov, ease = "smooth") => ({ id: `cam-${t}`, t, position: { x: pos[0], y: pos[1], z: pos[2] }, target: { x: tgt[0], y: tgt[1], z: tgt[2] }, fov, roll: 0, ease });
const SUN = [-0.2, 0.5, 0.2], STAFF = [-12.7, 1, 1.5], CUP = [13.8, 1, 5];
const cameraKeys = [
  key(0, [0, 31, -35], [0, 0, -1], 38), key(3, [0, 27, -31], [0, 0, 0], 38), key(8, [0, 23, -27], SUN, 38),
  key(11, [-0.2, 15, -18], SUN, 36), key(14, [-0.2, 14, -16.5], SUN, 36),
  key(15.5, [-9.5, 12, -15], STAFF, 36), key(17, [-10, 12, -15], STAFF, 36),
  key(18.5, [10, 12, -13], CUP, 36), key(20, [10.5, 12, -13], CUP, 36),
  key(21.5, [-11, 19, -24], SUN, 38), key(25, [11, 19, -24], SUN, 38),
  key(27.5, [0, 27, -31], [0, 0, 0], 38), key(30, [0, 33, -35], [0, 0, 0], 38),
];
proj.render = { ...proj.render, cameraMode: "animated", activeCameraView: null, cameraTrack: { enabled: true, keys: cameraKeys },
  cameraViews: [{ id: "client", name: "Client view (curved side)", position: { x: 0, y: 24, z: -30 }, target: { x: 0, y: 0, z: 0 }, fov: 40 },
    { id: "top", name: "Top view", position: { x: 0, y: 46, z: -0.01 }, target: { x: 0, y: 0, z: 0 }, fov: 40 }] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest || {}, null, 2) }]));
console.log(`→ ${out} · ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);

if (schedulePath) {
  const rows = [["Start s", "End s", "Pattern", "Group"].join("\t"), ...[...recipes].sort((a, b) => a.start - b.start || a.groupId.localeCompare(b.groupId))
    .map((r) => [r.start, r.start + r.duration, r.name, G.find((g) => g.id === r.groupId).name].join("\t"))];
  fs.writeFileSync(schedulePath, rows.join("\n"));
}
