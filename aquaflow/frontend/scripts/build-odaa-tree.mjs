// Odaa tree in the sun — a front-facing water emblem: a green tree (canopy of round lobes on a
// widening trunk) in front of a yellow 24-ray sun, standing as a stainless sculpture in a basin.
// Geometry is traced from the reference emblem (scratchpad tree/*.json): 1 px = SCALE m.
//   vite-node build-odaa-tree.mjs <template.aquapkg> <shape-dir> <out.aquapkg>
//
// How the water draws the picture (seen from the audience, +y):
//   Sun rays   24 flat fans on a ring at the ray tips, each aimed at the centre: one triangle each.
//   Sun disc   24 fans on a hub at the centre, aimed outward, 15° each: together a full disc.
//   Canopy     28 dandelion (crystal-ball) spheres where the emblem's lobes are, plus green mist.
//   Trunk      3 fans aimed down from under the canopy, widening to the trunk's base, caught by a
//              stainless tray at the trunk's foot so the water stops where the trunk ends.
import fs from "node:fs";
import path from "node:path";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";

const [tplPath, shapeDir, out] = process.argv.slice(2);
const r3 = (v) => Math.round(v * 1000) / 1000;
const DEG = Math.PI / 180;

// ── Field names of the elevated / aimed nozzle model (one place to match the engine) ─────────
const F = { mount: "mountHeightM", aim: "aimDeg", azimuth: "aimAzimuthDeg", fan: "fanAngleDeg", fanPlane: "fanPlane",
  reach: "reachM", sphere: "sphereRadiusM", catchAt: "catchAtM", support: "support", tubes: "tubes", frameType: "steel_frame" };
// Azimuth of the emblem's plane: +x (east) and −x (west).
const AZ_EAST = 0, AZ_WEST = 180;                              // engine: plan degrees from +x toward +y

// ── The emblem, traced from the image ────────────────────────────────────────────────────────
const sun = JSON.parse(fs.readFileSync(path.join(shapeDir, "sun.json"), "utf8"));
const canopy = JSON.parse(fs.readFileSync(path.join(shapeDir, "canopy.json"), "utf8"));
const SCALE = Number(process.env.SCALE || 0.016);              // m per image pixel
const TIP_R = sun.tipR * SCALE, RAY_R = sun.valleyR * SCALE;   // ray tips / ray bases (m)
const ZC = r3(TIP_R + 0.45);                                   // sun centre height above the water
const X = (px) => r3((px - sun.cx) * SCALE), Z = (py) => r3(ZC - (py - sun.cy) * SCALE);
const Y_SUN = -0.8, Y_TREE = 0.6;                              // depth: the tree stands in front
const TRUNK = { topPy: 572, botPy: 637, topHalfPx: 92, botHalfPx: 140 };
const trunkTop = Z(TRUNK.topPy), trunkBot = Z(TRUNK.botPy);
const SUN_YELLOW = "#ffe600", TREE_GREEN = "#00a44a";

// In-plane direction (angle from +x, counter-clockwise, as seen from the audience) → aim fields.
function aimAlong(thetaDeg) {
  const dx = Math.cos(thetaDeg * DEG), dz = Math.sin(thetaDeg * DEG);
  return { [F.aim]: r3(Math.acos(Math.max(-1, Math.min(1, dz))) / DEG), [F.azimuth]: dx >= 0 ? AZ_EAST : AZ_WEST };
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────
const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
const pad = (i) => String(i + 1).padStart(2, "0");
const valveFor = (nozzleId, x, y, pumpId, zone, group) => add({ id: `${nozzleId}-valve`, type: "valve_solenoid_dn25_24v", label: `Valve · ${nozzleId}`, x, y: r3(y - 0.25), zone,
  engineering: { controlledFixtureId: nozzleId, pumpId } }, group);
const lightFor = (nozzleId, x, y, z, color, zone, group, aim = {}) => add({ id: `${nozzleId}-light`, type: "light_uw_rgb_18w", label: `RGB light · ${nozzleId}`, x, y: r3(y + 0.15), zone,
  engineering: { pairedNozzleId: nozzleId, [F.mount]: r3(Math.max(0, z - 0.25)), defaultColor: color, ...aim } }, group);

// A. Sun rays: 24 fans at the ray tips, aimed at the centre.
const rayHalf = Math.atan((RAY_R * Math.sin(Math.PI / sun.tips.length)) / (TIP_R - RAY_R)) / DEG;
const rays = sun.tips.map((a) => a).sort((a, b) => ((90 - a + 360) % 360) - ((90 - b + 360) % 360)); // clockwise from the top
rays.forEach((a, i) => {
  const id = `sun-ray-${pad(i)}`, x = r3(TIP_R * Math.cos(a * DEG)), z = r3(ZC + TIP_R * Math.sin(a * DEG));
  const pumpId = Math.sin(a * DEG) >= 0 ? "pump-sun-rays-upper" : "pump-sun-rays-lower";
  add({ id, type: "nozzle_fan_spray_dn32", label: `Sun ray ${i + 1}`, x, y: Y_SUN, zone: "sun-rays", groupId: "sun_rays",
    engineering: { ...aimAlong(a + 180), [F.mount]: z, [F.fan]: r3(2 * rayHalf), [F.fanPlane]: "aim", [F.reach]: r3(TIP_R - RAY_R), [F.support]: "none",
      solenoidValveId: `${id}-valve`, pumpId, designStatus: "Odaa tree concept — verify with the supplier" } }, "Sun rays");
  valveFor(id, x, Y_SUN, pumpId, "sun-rays", "Sun ray valves");
  lightFor(id, x, Y_SUN, z, SUN_YELLOW, "sun-lights", "Sun lights", aimAlong(a + 180));
});

// B. Sun disc: a rain curtain falling from the disc's upper arc, caught by a curved gutter on its
//    lower arc — water cannot stop in mid-air, so fans aimed outward would fly past the disc edge.
const CURTAIN_STEP = 0.3, curtainN = Math.floor((2 * RAY_R) / CURTAIN_STEP);
for (let i = 0; i <= curtainN; i++) {
  const x = r3(-RAY_R + 0.15 + i * ((2 * RAY_R - 0.3) / curtainN)), half = Math.sqrt(Math.max(0, RAY_R * RAY_R - x * x));
  const id = `sun-disc-${String(i + 1).padStart(2, "0")}`, pumpId = "pump-sun-disc";
  add({ id, type: "nozzle_cascade_jet_dn25", label: `Sun disc curtain ${i + 1}`, x, y: r3(Y_SUN - 0.15), zone: "sun-disc", groupId: "sun_disc",
    engineering: { [F.mount]: r3(ZC + half), [F.catchAt]: r3(ZC - half), [F.support]: "none",
      solenoidValveId: `${id}-valve`, pumpId, designStatus: "Odaa tree concept — verify with the supplier" } }, "Sun disc");
  valveFor(id, x, r3(Y_SUN - 0.15), pumpId, "sun-disc", "Sun disc valves");
}
// The disc is lit from its header (top arc), aimed down the curtain — never onto the tree in front.
for (let i = 0; i < 6; i++) {
  const a = 30 + i * 24, x = r3(RAY_R * Math.cos(a * DEG)), z = r3(ZC + RAY_R * Math.sin(a * DEG));
  add({ id: `sun-disc-light-${i + 1}`, type: "light_uw_rgb_36w", label: `Sun disc light ${i + 1}`, x, y: r3(Y_SUN - 0.35), zone: "sun-lights",
    engineering: { [F.mount]: z, defaultColor: SUN_YELLOW, [F.aim]: 180, [F.azimuth]: AZ_EAST, pairedNozzleId: `sun-disc-${String(1 + Math.round(((x + RAY_R) / (2 * RAY_R)) * 30)).padStart(2, "0")}` } }, "Sun lights");
}

// C. Canopy: 28 dandelions where the emblem's lobes are (bottom → top), one pump per quarter.
const canopyPump = (l) => `pump-canopy-${l.x < 0 ? "west" : "east"}-${l.z < canopyCentreZ ? "low" : "high"}`;
const LOBE_GROW = 1.15;                                         // lobes touch, like the emblem's scallops
const lobes = canopy.disks.map(([px, py, pr]) => ({ x: X(px), z: Z(py), r: r3(pr * SCALE * LOBE_GROW) })).sort((a, b) => a.z - b.z || a.x - b.x);
const canopyCentreZ = lobes[Math.floor(lobes.length / 2)].z;
lobes.forEach((l, i) => {
  const id = `tree-lobe-${pad(i)}`, pumpId = canopyPump(l);
  add({ id, type: "nozzle_dandelion_dn40", label: `Canopy lobe ${i + 1}`, x: l.x, y: Y_TREE, zone: "canopy", groupId: "canopy",
    engineering: { [F.mount]: l.z, [F.sphere]: l.r, [F.support]: "none", solenoidValveId: `${id}-valve`, pumpId,
      designStatus: "Odaa tree concept — verify with the supplier" } }, "Canopy lobes");
  valveFor(id, l.x, Y_TREE, pumpId, "canopy", "Canopy valves");
  lightFor(id, l.x, Y_TREE, l.z, TREE_GREEN, "tree-lights", "Tree lights", { [F.aim]: 0 });
});
// Green mist inside the canopy: fills the gaps between the lobes.
const mistPts = [[-1.6, 1.2], [0, 1.4], [1.6, 1.2], [-2.2, 0], [-0.75, 0.2], [0.75, 0.2], [2.2, 0], [-1.2, -1.1], [1.2, -1.1]];
const canopyMid = (Math.max(...lobes.map((l) => l.z)) + Math.min(...lobes.map((l) => l.z))) / 2;
mistPts.forEach(([dx, dz], i) => {
  add({ id: `tree-mist-${pad(i)}`, type: "nozzle_mist_jet_dn15", label: `Canopy mist ${i + 1}`, x: r3(dx), y: r3(Y_TREE - 0.2), zone: "canopy-mist", groupId: "canopy_mist",
    engineering: { [F.mount]: r3(canopyMid + dz), [F.support]: "none", solenoidValveId: "tree-mist-valve", pumpId: "pump-mist" } }, "Canopy mist");
});
add({ id: "tree-mist-valve", type: "valve_solenoid_dn15_24v", label: "Canopy mist valve", x: 0, y: r3(Y_TREE - 0.6), zone: "canopy-mist",
  engineering: { controlledFixtureId: "tree-mist-01", pumpId: "pump-mist" } }, "Canopy valves");

// D. Trunk: three fans aimed down from under the canopy, caught by the tray at its foot.
const topHalf = TRUNK.topHalfPx * SCALE, botHalf = TRUNK.botHalfPx * SCALE, trunkH = trunkTop - trunkBot;
[-1, 0, 1].forEach((k, i) => {
  const x0 = r3(k * (2 * topHalf) / 3), x1 = r3(k * (2 * botHalf) / 3);
  const lean = Math.atan2(x1 - x0, trunkH) / DEG;              // + leans east
  const id = `tree-trunk-${pad(i)}`, pumpId = "pump-trunk";
  const spread = 2 * Math.atan(((2 * botHalf) / 3 / 2 + 0.08) / trunkH) / DEG;
  add({ id, type: "nozzle_fan_spray_dn40", label: `Trunk fan ${i + 1}`, x: x0, y: Y_TREE, zone: "trunk", groupId: "trunk",
    engineering: { ...aimAlong(-90 + lean), [F.mount]: trunkTop, [F.fan]: r3(spread), [F.fanPlane]: "aim", [F.reach]: r3(trunkH / Math.cos(lean * DEG)),
      [F.catchAt]: trunkBot, [F.support]: "none", solenoidValveId: `${id}-valve`, pumpId } }, "Trunk");
  valveFor(id, x0, Y_TREE, pumpId, "trunk", "Trunk valves");
  lightFor(id, x0, Y_TREE, trunkBot + 0.3, TREE_GREEN, "tree-lights", "Tree lights", { [F.aim]: 0 });
  add({ id: `${id}-uplight`, type: "light_uw_rgb_36w", label: `Trunk uplight ${i + 1}`, x: x1, y: r3(Y_TREE + 0.4), zone: "tree-lights",
    engineering: { pairedNozzleId: id, [F.mount]: r3(trunkBot + 0.05), defaultColor: TREE_GREEN, [F.aim]: 0 } }, "Tree lights");
});

// E. Pumps (VFD), sized from the outlets they feed (flow) and the highest mount + nozzle head.
const BAR = 10.197;
const pumpFor = (id, label, members, x) => {
  const nz = members.map((m) => fixtures.find((f) => f.id === m));
  const flow = nz.reduce((s, f) => s + (Number(f.engineering.flowLpm) || 0), 0);
  const head = Math.max(...nz.map((f) => (Number(f.engineering[F.mount]) || 0) + (Number(f.engineering.pressureBar) || 1) * BAR)) + 6;
  const kw = (flow / 60000) * 1000 * 9.81 * head / 0.65 / 1000;
  const sizes = [0.75, 1.1, 1.5, 2.2, 3.0, 4.0, 5.5, 7.5];
  const pick = sizes.find((s) => s >= kw * 1.15);
  const ids = { 0.75: "0_75", 1.1: "1_1", 1.5: "1_5", 2.2: "2_2", 3.0: "3_0", 4.0: "4_0", 5.5: "5_5", 7.5: "7_5" };
  const type = pick ? `pump_inline_vfd_pump_${ids[pick]}kw` : "pump_dry_centrifugal_15kw";
  add({ id, type, label, x, y: -5, zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId).filter(Boolean), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(head) } }, "Pumps");
  console.log(`${label.padEnd(26)} ${String(nz.length).padStart(3)} outlets · ${Math.round(flow)} L/min · head ${head.toFixed(1)} m · ~${kw.toFixed(1)} kW → ${type}${kw > 15 ? "  (×" + Math.ceil(kw / 15) + " in parallel on site)" : ""}`);
};
for (const [level, x] of [["upper", -7], ["lower", -5]])
  pumpFor(`pump-sun-rays-${level}`, `Sun rays ${level} pump (VFD)`, groups.get("Sun rays").filter((id) => fixtures.find((f) => f.id === id).engineering.pumpId === `pump-sun-rays-${level}`), x);
pumpFor("pump-sun-disc", "Sun disc pump (VFD)", groups.get("Sun disc"), -3);
for (const [k, side, level, x] of [[0, "west", "low", -1.5], [1, "west", "high", 0], [2, "east", "low", 1.5], [3, "east", "high", 3]])
  pumpFor(`pump-canopy-${side}-${level}`, `Canopy ${side} ${level === "low" ? "lower" : "upper"} pump (VFD)`, groups.get("Canopy lobes").filter((id) => fixtures.find((f) => f.id === id).engineering.pumpId === `pump-canopy-${side}-${level}`), x);
pumpFor("pump-trunk", "Trunk pump (VFD)", groups.get("Trunk"), 6);
add({ id: "pump-mist", type: "pump_high_pressure_mist_2_2kw", label: "Canopy mist pump", x: 8, y: -5, zone: "plant-room", groupId: "pumps",
  engineering: { servesValveIds: ["tree-mist-valve"] } }, "Pumps");

// F. The stainless sculpture that carries everything.
const ring = (r, cz, y, n = 96) => Array.from({ length: n }, (_, i) => [0, y, 0]).map((_, i) => [r3(r * Math.cos(2 * Math.PI * i / n)), y, r3(cz + r * Math.sin(2 * Math.PI * i / n))]);
const tubes = [
  { points: ring(TIP_R, ZC, Y_SUN), diameterMm: 114, closed: true },                         // ray-tip ring
  { points: ring(0.35, ZC, Y_SUN - 0.15, 24), diameterMm: 168, closed: true },               // hub
  ...[45, 135, 225, 315].map((a) => ({ points: [[r3(0.35 * Math.cos(a * DEG)), Y_SUN, r3(ZC + 0.35 * Math.sin(a * DEG))], [r3(TIP_R * Math.cos(a * DEG)), Y_SUN, r3(ZC + TIP_R * Math.sin(a * DEG))]], diameterMm: 60 })),
  ...[235, 305].map((a) => ({ points: [[r3(TIP_R * Math.cos(a * DEG)), Y_SUN, r3(ZC + TIP_R * Math.sin(a * DEG))], [r3(TIP_R * Math.cos(a * DEG) * 1.15), Y_SUN, 0]], diameterMm: 168 })), // legs
  { points: [[0, Y_TREE, 0], [0, Y_TREE, r3(canopyMid)]], diameterMm: 219 },                  // tree spine
  ...lobes.map((l) => ({ points: [[0, Y_TREE, r3(canopyMid)], [l.x, Y_TREE, l.z]], diameterMm: 48 })), // branches
  { points: [[-topHalf, Y_TREE, trunkTop], [topHalf, Y_TREE, trunkTop]], diameterMm: 89 },    // trunk header
  { points: [[-botHalf - 0.15, Y_TREE - 0.35, trunkBot], [botHalf + 0.15, Y_TREE - 0.35, trunkBot], [botHalf + 0.15, Y_TREE + 0.35, trunkBot], [-botHalf - 0.15, Y_TREE + 0.35, trunkBot]], diameterMm: 76, closed: true }, // catch tray rim
  { points: [[0, Y_SUN, 0], [0, Y_TREE, 0]], diameterMm: 168 },                               // base tie
  { points: Array.from({ length: 49 }, (_, i) => { const a = Math.PI + (Math.PI * i) / 48; return [r3(RAY_R * Math.cos(a)), r3(Y_SUN - 0.15), r3(ZC + RAY_R * Math.sin(a))]; }), diameterMm: 140 }, // disc gutter
  { points: Array.from({ length: 49 }, (_, i) => { const a = (Math.PI * i) / 48; return [r3(RAY_R * Math.cos(a)), r3(Y_SUN - 0.15), r3(ZC + RAY_R * Math.sin(a))]; }), diameterMm: 60 },  // curtain header
];
add({ id: "odaa-sculpture", type: F.frameType, label: "Odaa sun sculpture (stainless)", x: 0, y: 0, zone: "sculpture",
  engineering: { [F.tubes]: tubes.map((t) => ({ ...t, points: t.points.map((p) => p.map(r3)) })) } });

// ── Basin, surfaces, pipes ──────────────────────────────────────────────────────────────────
const W = 26, D = 13, R = 3;
function roundedRect(w, d, r, step = 10) {
  const pts = [], hw = w / 2, hd = d / 2;
  for (const [cx, cy, a0] of [[hw - r, hd - r, 0], [-hw + r, hd - r, 90], [-hw + r, -hd + r, 180], [hw - r, -hd + r, 270]])
    for (let a = a0; a <= a0 + 90; a += step) pts.push({ x: r3(cx + r * Math.cos(a * DEG)), y: r3(cy + r * Math.sin(a * DEG)) });
  return pts;
}
const outline = roundedRect(W, D, R);
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const site_surfaces = [
  { id: "plaza", label: "Plaza (audience)", type: "paving", color: "#b3a58f", elevation: 0.02, visible: true, points: rect(-24, 6.5, 24, 22) },
  { id: "steps", label: "Seating steps", type: "rock", color: "#8b8f96", elevation: 0.06, visible: true, points: rect(-12, 14, 12, 19) },
  { id: "lawn", label: "Lawn behind", type: "grass", color: "#3d7a2e", elevation: 0.02, visible: true, points: rect(-24, -20, 24, -6.5) },
  { id: "bed-west", label: "Planting west", type: "soil", color: "#6d4a33", elevation: 0.05, visible: true, points: rect(-24, -6.5, -13, 6.5) },
  { id: "bed-east", label: "Planting east", type: "soil", color: "#6d4a33", elevation: 0.05, visible: true, points: rect(13, -6.5, 24, 6.5) },
];
const pipe = (id, label, d, pts) => ({ id, label, pipeType: "supply", diameterMm: d, closed: false, layer: "pipework", points: pts.map(([x, y]) => ({ x, y })) });
const pipes = [pipe("sun-feed", "Sun feed DN100 (rays + disc)", 100, [[-6, -5], [0, Y_SUN]]), pipe("tree-feed", "Canopy feed DN125", 125, [[1.5, -5], [0, Y_TREE]]),
  pipe("trunk-feed", "Trunk feed DN65", 65, [[6, -5], [0, Y_TREE]]), pipe("mist-feed", "Mist line 12 mm HP", 12, [[8, -5], [0, Y_TREE - 0.2]])];

// ── Project ─────────────────────────────────────────────────────────────────────────────────
const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Odaa Tree in the Sun — front water emblem";
Object.assign(proj.engineering, {
  name: "Odaa Tree in the Sun", id: "aquaflow-odaa-tree", projectName: NAME, pool_type: "freeform",
  params: { width: W, length: D, radius: R, depth: 0.9, units: "m", design_head_m: 30 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Odaa basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes,
  depth_zones: [{ id: "display", zone: "display", label: "Display basin", depth: 0.9, color: "#5fb4d6", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// ── Presentation show (75 s, no music needed): the tree grows, the sun rises behind it ──────
const items = inventory(fixtures);
const g = (name, color) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Sun rays", SUN_YELLOW), g("Sun disc", "#ffd23f"), g("Canopy lobes", TREE_GREEN), g("Canopy mist", "#7fd19b"), g("Trunk", "#2e7d32"),
  g("Sun lights", SUN_YELLOW), g("Tree lights", TREE_GREEN)];
const rec = (group, name, effect, start, duration, extra = {}) => ({ ...newRecipe(SG.find((x) => x.name === group).id, start), name, effect, duration, cycles: 1, spread: 1,
  intensity: 100, order: "engineering", color: group.includes("Sun") ? SUN_YELLOW : TREE_GREEN, ...extra });
const END = 75;
const recipes = [
  rec("Tree lights", "Tree glow", "static", 0, END, { intensity: 95 }),
  rec("Trunk", "Trunk rises", "static", 0.5, END - 0.5),
  rec("Canopy lobes", "Canopy grows from the bottom", "staircase", 3, 10),
  rec("Canopy lobes", "Full canopy", "static", 13, 37),
  rec("Canopy mist", "Canopy mist", "static", 8, END - 8, { intensity: 80 }),
  rec("Sun lights", "Sunrise", "static", 13, END - 13, { intensity: 70 }),
  rec("Sun disc", "Sun disc opens across", "staircase", 13, 7),
  rec("Sun disc", "Sun disc", "static", 20, END - 20, { intensity: 75 }),
  rec("Sun rays", "Rays run round", "chase", 20, 10, { cycles: 2 }),
  rec("Sun rays", "Full sun", "static", 30, 20),
  rec("Sun rays", "Rays twinkle", "wave", 50, 12, { cycles: 3, intensity: 100 }),
  rec("Canopy lobes", "Leaves shimmer", "sparkle", 50, 12, { intensity: 100 }),
  rec("Sun rays", "Finale · full emblem", "static", 62, END - 62),
  rec("Canopy lobes", "Finale · full canopy", "static", 62, END - 62),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m-tree", name: "The tree grows", time: 0, kind: "section" }, { id: "m-sun", name: "Sunrise", time: 13, kind: "section" },
    { id: "m-full", name: "Full emblem", time: 30, kind: "section" }, { id: "m-fin", name: "Finale", time: 62, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
const design = readFountainDesign(items);
console.log(`\n${design.summary}`);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END,
  audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-odaa-tree-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-odaa-tree", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0,
  savedViews: [{ id: "front", name: "Front · audience", position: [0, 1.7, 24], target: [0, ZC, 0], fov: 45 }] };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest, null, 2) }]));
console.log(`\nemblem ${r3(2 * TIP_R)} m across, centre ${ZC} m, top ${r3(ZC + TIP_R)} m · canopy ${lobes.length} lobes (r ${lobes[0].r} m) · trunk ${r3(trunkH)} m tall, tray at ${trunkBot} m`);
console.log(`→ ${out} · ${(fs.statSync(out).size / 1e6).toFixed(1)} MB · ${fixtures.length} fixtures · ${clips.length} cues · ${recipes.length} patterns`);
