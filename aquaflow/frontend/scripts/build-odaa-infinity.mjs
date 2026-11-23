// Odaa and Elder — two pillars, infinity presentation and 14 moving nozzles.
// Reuses the accurate traced portrait/sun from the supplied reference project, replacing the
// old staff/cup layout with the two-pillar annotated design. Concept only, not commissioned.
//   vite-node --root . scripts/build-odaa-infinity.mjs <reference.aquapkg> <out.aquapkg> [Bellagio.aquapkg]
import fs from "node:fs";
import path from "node:path";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { exportPatterns, showBlocks } from "/src/components/programmer/studio/showBlocks.js";
import { motionPatternRecipes } from "/src/components/programmer/studio/motionPatterns.js";

const [srcPath, out, bellagioArg] = process.argv.slice(2);
if (!srcPath || !out) { console.error("usage: vite-node --root . scripts/build-odaa-infinity.mjs <reference.aquapkg> <out.aquapkg> [Bellagio.aquapkg]"); process.exit(1); }
const r3 = v => Math.round(v * 1000) / 1000, DEG = Math.PI / 180;
const GREEN = "#92ff9d", WHITE = "#e4f7ff", BLUE = "#38c8ff", GOLD = "#d8ffb8";
const source = JSON.parse(zipText(readZip(fs.readFileSync(srcPath)).get("project.aqua")));
const bellagioPath = bellagioArg || path.join(path.dirname(srcPath), "Bellagio_Tiesto_Real_Layout.aquapkg");
const bellagio = JSON.parse(zipText(readZip(fs.readFileSync(bellagioPath)).get("project.aqua")));
const bellagioRecipes = bellagio.programmer?.studio?.recipes || [];
const sourceEng = source.engineering, sourceFixtures = sourceEng.fixtures, pipes = sourceEng.manualPipes || [];
const sourceJets = sourceFixtures.filter(f => f.type === "nozzle_straight_dn15");
const sourceLights = sourceFixtures.filter(f => f.type === "light_uw_rgb_36w");
const lightAt = new Map(sourceLights.map(f => [`${f.x},${f.y}`, f]));

const segDist = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const ownerPipe = jet => {
  let best = null;
  pipes.forEach((pipe, i) => {
    for (let k = 1; k < pipe.points.length; k++) {
      const d = segDist(jet, pipe.points[k - 1], pipe.points[k]);
      if (!best || d < best.d) best = { d, i };
    }
  });
  return best?.i;
};
const owners = new Map(sourceJets.map(j => [j.id, ownerPipe(j)]));
const counts = new Map();
for (const i of owners.values()) counts.set(i, (counts.get(i) || 0) + 1);
// Pipe 1 is the large circular RGB conduit. The traced moving-nozzle circle supplies the centre.
const ringPipe = 0, ringPoints = pipes[ringPipe].points;
const canopyCentre = sourceFixtures.filter(f => f.type === "motion_nozzle_1d_tilt_motor" && /^canopy-\d+$/.test(f.id));
const CX = canopyCentre.reduce((s, p) => s + p.x, 0) / canopyCentre.length, CY = canopyCentre.reduce((s, p) => s + p.y, 0) / canopyCentre.length;
const R = ringPoints.reduce((s, p) => s + Math.hypot(p.x - CX, p.y - CY), 0) / ringPoints.length;
const classify = (fixture, owner = owners.get(fixture.id)) => {
  const radius = Math.hypot(fixture.x - CX, fixture.y - CY);
  if (owner === ringPipe) return "ring";
  if (fixture.x < -11) return "staff";
  if (fixture.x > 10.2) return "cup";
  if (radius > R + 0.15) return "rays";
  if (fixture.x > -0.1 && fixture.x < 3.3 && fixture.y > -5.45 && fixture.y < -3.15) return "star";
  return radius > R * 0.62 ? "hair" : "face";
};
const parts = {};
for (const jet of sourceJets) (parts[classify(jet)] ||= []).push(jet);

const fixtures = [], roleMembers = new Map(), roleLabels = {};
const add = (fixture, role, label) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...fixture,
    engineering: { ...getDefaultEngineering(fixture.type), ...(fixture.engineering || {}) } });
  if (!roleMembers.has(role)) roleMembers.set(role, []);
  roleMembers.get(role).push(fixture.id); roleLabels[role] = label;
  return fixture.id;
};
const clone = (old, id, label, role, roleLabel, overrides = {}) => {
  const { x, y, z, rotation, ...engineering } = overrides;
  return add({ ...old, id, label, groupId: role,
    ...(x !== undefined ? { x } : {}), ...(y !== undefined ? { y } : {}), ...(z !== undefined ? { z } : {}), ...(rotation !== undefined ? { rotation } : {}),
    engineering: { ...old.engineering, ...engineering, dataSource: "Traced reference adapted to the two-pillar annotated drawing", designStatus: "Concept — supplier and site verification required" } }, role, roleLabel);
};
const colourFor = role => /outline|infinity/i.test(role) ? WHITE : /shooter|compressor/i.test(role) ? BLUE : /Vario/i.test(role) ? GOLD : GREEN;

// The accurate central traced artwork remains intact; the old cup is deliberately removed.
console.log("Traced source groups", Object.fromEntries(Object.entries(parts).map(([role, list]) => [role, list.length])), { CX, CY, R, ringPipe });
if (!parts.rays?.length) throw new Error("Traced sun-ray water group is missing");
for (const jet of parts.rays) clone(jet, jet.id, jet.label, "rays", "Central artwork · sun rays");
// The reference ring is light-only. Add an independent straight-jet ring for the water show.
for (let i = 0; i < 72; i++) {
  const angle = i / 72 * 2 * Math.PI;
  add({ id: `sun-ring-${String(i + 1).padStart(2, "0")}`, type: "nozzle_straight_dn15", label: `Oddaa sun-ring jet ${i + 1}`,
    x: r3(CX + R * Math.cos(angle)), y: r3(CY + R * Math.sin(angle)), groupId: "ring",
    engineering: { jetHeightM: 3, flowLpm: 24, pressureBar: 1.1, designStatus: "Concept ring — verify spacing and hydraulics" } }, "ring", "Central artwork · straight-jet ring");
}
// Portrait, hair and star are ground RGB artwork in the reference; keep every central light,
// including those with no water nozzle. Nearest traced pipe ownership preserves the sun rays.
for (const light of sourceLights) {
  if (/^(fans|arches)-/.test(light.id)) continue;
  const role = classify(light, ownerPipe(light));
  if (!["ring", "rays", "hair", "face", "star"].includes(role)) continue;
  clone(light, light.id, light.label, `${role}Light`, `Central artwork · ${role} lights`, { defaultColor: colourFor(role) });
}

// Two matching pillars: the right is the left reflected about the emblem centre.
for (const [side, sign] of [["left", 1], ["right", -1]]) {
  parts.staff.forEach((jet, i) => {
    const id = `pillar-${side}-${String(i + 1).padStart(3, "0")}`, x = sign === 1 ? jet.x : 2 * CX - jet.x;
    const light = lightAt.get(`${jet.x},${jet.y}`);
    clone(jet, id, `${side === "left" ? "Left" : "Right"} pillar jet ${i + 1}`, `pillar-${side}`, `${side} pillar · straight jets`, {
      x, jetHeightM: 3, flowLpm: 24, pressureBar: 1.1, pairedLightId: `pillar-${side}-light-${i + 1}` });
    if (light) clone(light, `pillar-${side}-light-${i + 1}`, `${side} pillar integrated light ${i + 1}`, `pillar-${side}-light`, `${side} pillar · integrated lights`, {
      x, pairedNozzleId: id, defaultColor: GREEN, mountHeightM: 0 });
  });
}

const resampleClosed = (points, spacing) => {
  const lengths = [], totalParts = [0];
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(length); totalParts.push(totalParts.at(-1) + length);
  }
  const total = totalParts.at(-1), count = Math.round(total / spacing), out = [];
  for (let k = 0; k < count; k++) {
    const target = k * total / count; let i = lengths.findIndex((_, n) => totalParts[n + 1] >= target); if (i < 0) i = lengths.length - 1;
    const u = (target - totalParts[i]) / Math.max(1e-9, lengths[i]), a = points[i], b = points[(i + 1) % points.length];
    out.push({ x: r3(a.x + (b.x - a.x) * u), y: r3(a.y + (b.y - a.y) * u) });
  }
  return out;
};
// Keep both traced pillar shapes inside the curved D-shaped pool: compress their height
// slightly and move them toward the audience, preserving an exact left/right mirror.
for (const fixture of fixtures) if (/^pillar-(left|right)(-light)?$/.test(fixture.groupId)) fixture.y = r3(fixture.y * 0.85 - 1);

// Red infinity line from the site drawing: a real figure-eight path of 1D moving nozzles.
const infinityDense = Array.from({ length: 721 }, (_, i) => {
  const a = i / 720 * 2 * Math.PI;
  return { x: r3(15 * Math.sin(a)), y: r3(5.2 * Math.sin(a) * Math.cos(a)) };
});
const infinityPoints = resampleClosed(infinityDense, 0.35);
infinityPoints.forEach((p, i) => {
  let nearest = 0, distance = Infinity;
  infinityDense.forEach((q, k) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < distance) { distance = d; nearest = k; } });
  const angle = nearest / 720 * 2 * Math.PI, tangent = Math.atan2(5.2 * Math.cos(2 * angle), 15 * Math.cos(angle)) / DEG;
  const id = `infinity-1d-${String(i + 1).padStart(3, "0")}`;
  add({ id, type: "motion_nozzle_1d_tilt_motor", label: `Infinity-path 1D nozzle ${i + 1}`, x: p.x, y: p.y, rotation: tangent, groupId: "infinity",
    engineering: { jetHeightM: 4.5, axisCount: 1, angleRangeDeg: 120, tiltRangeDeg: 120, speedDegSec: 90, aimAzimuthDeg: tangent,
      designStatus: "Infinity-path concept — tangent-aligned 1D drive" } }, "infinity", "Red infinity line · 1D nozzles");
  add({ id: `${id}-light`, type: "light_uw_rgb_36w", label: `Infinity-path paired light ${i + 1}`, x: p.x, y: p.y, groupId: "infinityLight",
    engineering: { pairedNozzleId: id, defaultColor: WHITE, beamAngleDeg: 35 } }, "infinityLight", "Infinity path · paired lights");
});

// The circle immediately around Old Man & Oddaa: all 28 traced positions are 1D nozzles.
const canopy = sourceFixtures.filter(f => f.type === "motion_nozzle_1d_tilt_motor" && /^canopy-\d+$/.test(f.id)).sort((a, b) => a.id.localeCompare(b.id));
if (canopy.length !== 28) throw new Error(`Expected 28 traced portrait-circle points, found ${canopy.length}`);
canopy.forEach((old, i) => {
  const id = `portrait-circle-1d-${String(i + 1).padStart(2, "0")}`;
  clone(old, id, `Portrait-circle 1D nozzle ${i + 1}`, "portraitCircle", "Circle around Old Man & Oddaa · 1D nozzles", {
    jetHeightM: 5.5, axisCount: 1, panRangeDeg: 120, tiltRangeDeg: 120, speedDegSec: 90, aimAzimuthDeg: old.engineering.aimAzimuthDeg });
  const oldLight = sourceFixtures.find(f => f.id === `canopy-rgb-${String(i).padStart(2, "0")}`);
  clone(oldLight, `${id}-light`, `Portrait-circle paired light ${i + 1}`, "portraitCircleLight", "Portrait circle · paired lights", { pairedNozzleId: id, defaultColor: GREEN });
});

// A separate, larger circle around the sun: exactly 14 radial 1D swinging nozzles.
for (let i = 0; i < 14; i++) {
  const angle = i / 14 * 2 * Math.PI, rotation = angle / DEG, id = `outer-1d-${String(i + 1).padStart(2, "0")}`;
  add({ id, type: "motion_nozzle_1d_tilt_motor", label: `Outer circle · 1D swing nozzle ${i + 1}`, rotation,
    x: r3(CX + 9 * Math.cos(angle)), y: r3(CY + 9 * Math.sin(angle)), groupId: "outerRing",
    engineering: { jetHeightM: 9, axisCount: 1, angleRangeDeg: 120, tiltRangeDeg: 120, speedDegSec: 88, aimAzimuthDeg: rotation,
      designStatus: "14-piece radial 1D circle — conservative 88 degree/second show limit for sampling headroom" } }, "outerRing", "Circle around the sun · 14 radial 1D nozzles");
  add({ id: `${id}-light`, type: "light_uw_rgb_36w", label: `Outer 1D circle light ${i + 1}`,
    x: r3(CX + 9 * Math.cos(angle)), y: r3(CY + 9 * Math.sin(angle)), groupId: "outerRingLight",
    engineering: { pairedNozzleId: id, defaultColor: GOLD, beamAngleDeg: 35 } }, "outerRingLight", "Outer 1D circle · paired lights");
}

// All nine blue dots: three in each lobe and three around the center crossing.
const shooterPositions = [[-11, -1.8], [-9.2, 0.2], [-11.2, 2.1], [11, -1.8], [9.2, 0.2], [11.2, 2.1], [-1.3, -0.9], [0, 0.5], [1.3, -0.9]];
shooterPositions.forEach(([x, y], i) => {
  const id = `compressor-50m-${i + 1}`;
  add({ id, type: "nozzle_air_shooter_50e_50m_oase", label: `Infinity blue dot ${i + 1} · 50 m compressor spray`, x, y, groupId: "compressors",
    engineering: { designStatus: "OASE 50 m catalogue concept; compressed-air plant and splash zone require site design" } }, "compressors", "Infinity blue dots · nine 50 m compressor sprays");
  add({ id: `${id}-light`, type: "light_uw_rgb_36w", label: `Compressor spray light ${i + 1}`, x, y, groupId: "compressorsLight",
    engineering: { pairedNozzleId: id, defaultColor: BLUE, beamAngleDeg: 40 } }, "compressorsLight", "Nine compressor sprays · blue lights");
});

// D-shaped concept basin: straight audience edge and a curved rear edge.
const W = 40, H = 20;
const basin = [{ x: -W / 2, y: -H / 2 }, { x: W / 2, y: -H / 2 }, { x: W / 2, y: 0 },
  ...Array.from({ length: 65 }, (_, i) => ({ x: r3(W / 2 * Math.cos(i / 64 * Math.PI)), y: r3(H / 2 * Math.sin(i / 64 * Math.PI)) })).slice(1),
  { x: -W / 2, y: -H / 2 }];

// Editable presentation groups.
const G = [], group = (id, name, members, color) => { G.push({ id, name, memberFixtureIds: members || [], orderMode: "engineering", color, muted: false, solo: false }); };
for (const [role, members] of roleMembers) group(role, roleLabels[role], members, colourFor(role));
const regularRoles = ["ring", "rays", "pillar-left", "pillar-right", "infinity", "portraitCircle", "outerRing"];
const allRegular = regularRoles.flatMap(role => roleMembers.get(role) || []);
const allLights = fixtures.filter(f => f.type.startsWith("light_")).map(f => f.id);
group("allRegular", "All regular water (no air shooters)", allRegular, WHITE);
group("allLights", "All integrated lights", allLights, GREEN);
const motionHalves = {}, motionParity = {};
for (const role of ["portraitCircle", "infinity"]) {
  const members = (roleMembers.get(role) || []).map(id => fixtures.find(f => f.id === id));
  const sorted = [...members].sort((a, b) => a.x - b.x), middle = Math.ceil(sorted.length / 2), halves = [sorted.slice(0, middle), sorted.slice(middle)];
  motionHalves[role] = halves.map((list, i) => `${role}${i ? "B" : "A"}`);
  group(motionHalves[role][0], `${roleLabels[role]} · left half`, halves[0].map(f => f.id), GREEN);
  group(motionHalves[role][1], `${roleLabels[role]} · right half`, halves[1].map(f => f.id), GREEN);
  motionParity[role] = [0, 1].map(parity => `${role}${parity ? "Odd" : "Even"}`);
  motionParity[role].forEach((target, parity) => group(target, `${roleLabels[role]} · ${parity ? "odd" : "even"} Bellagio cross`, members.filter((_, i) => i % 2 === parity).map(f => f.id), GREEN));
}

const BASE_END = 90, END = 240, STRETCH = 3;
const mapTime = time => time <= 15 ? time : 15 + (time - 15) * STRETCH;
const base = (groupId, name, start, duration, extra) => ({ ...newRecipe(groupId, start), name, start: r3(start), duration: r3(duration), cycles: 1, spread: 1,
  intensity: 100, order: G.find(g => g.id === groupId)?.orderMode || "engineering", color: G.find(g => g.id === groupId)?.color || GREEN, ...extra });
const hold = (g, name, s, d, level) => base(g, name, s, d, { effect: "static", intensity: level });
const vividPalette = { "#54d9ff": "#00bfff", "#76ff89": "#20ff45", "#ffe066": "#ffc400", "#ff66cc": "#ff168f",
  "#5aa7ff": "#1677ff", "#b48cff": "#8b24ff", "#ff5a5a": "#ff2020" };
const wave = (g, name, s, d, field, order = "engineering") => base(g, name, s, d, { effect: "field", order,
  field: { ease: 0.35, ...field, ...(field.colors ? { colors: field.colors.map(c => vividPalette[c] || c) } : {}) } });
const drawOn = (g, name, s, d, sweep, high, order = "engineering") => {
  const period = d * 2 + 2;
  return base(g, name, s, d, { effect: "field", order, field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period,
    crests: sweep / period, direction: 1, points: [{ time: 0, value: 0 }, { time: 1.2 / period, value: 1 }, { time: 0.56, value: 1 }, { time: 0.6, value: 0 }, { time: 1, value: 0 }],
    low: 0, high, ease: 0 } });
};
const ramp = (g, name, s, d, from, to) => base(g, name, s, d, { effect: "field", field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat",
  period: d * 2, spread: 0, points: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }, { time: 1, value: 1 }], low: from, high: to, ease: 0 } });
const recipes = [], importedDrives = [];
const addRecipe = (...list) => recipes.push(...list);
const pathOrder = role => role === "infinity" ? "engineering" : "clockwise";
const pairedWave = (role, lightRole, name, start, duration, field, colors, lightHigh = 30) => {
  const order = pathOrder(role);
  addRecipe(wave(role, name, start, duration, field, order),
    wave(lightRole, `${name} · synchronized light`, start, duration, { ...field, low: 3, high: lightHigh * 0.5, lowFar: 3, highFar: lightHigh * 0.5,
      colorMode: "sequence", colors }, order));
};

// The traced portrait remains readable underneath a much longer, layered presentation.
addRecipe(drawOn("faceLight", "Old Man portrait · light-green draw-on", 0, 5, 3.5, 40), drawOn("hairLight", "Oddaa hair · light trace", 1, 5, 3.5, 36), drawOn("starLight", "Small star · light", 3, 3, 1.5, 38));
for (const g of ["faceLight", "hairLight", "starLight"]) addRecipe(hold(g, "Portrait light green", 6, BASE_END - 6, 30));
addRecipe(drawOn("ring", "Oddaa ring draws clockwise", 3, 6, 4, 65), drawOn("ringLight", "Ring lights draw on", 3, 6, 4, 28));
addRecipe(drawOn("rays", "Sun rays open around the portrait", 6, 6, 4.5, 68), drawOn("raysLight", "Sun rays illuminate", 6, 6, 4.5, 28));
for (const side of ["left", "right"]) {
  addRecipe(drawOn(`pillar-${side}`, `${side} side shape · straight jets`, 10, 5, 3.5, 60), hold(`pillar-${side}-light`, `${side} inner shape · opening lights`, 10, 5, 28),
    hold(`pillar-${side}-light`, `${side} inner shape · quiet background lights`, 15, 72, 14), hold(`pillar-${side}`, `${side} pillar · wave-act background`, 15, 24, 20));
}
addRecipe(hold("ringLight", "Sun ring · restrained ambient", 12, 69, 10), hold("raysLight", "Sun rays · restrained ambient", 12, 69, 10),
  wave("ring", "Sun ring · slow supporting orbit", 15, 24, { kind: "travelling", period: 5, crests: 2, low: 10, high: 26 }, "clockwise"),
  wave("rays", "Sun rays · breathing backdrop", 15, 24, { kind: "swell", period: 4, low: 10, high: 26 }));

// Four long infinity-water acts, each with an explicit large swinging 1D layer.
const infinityActs = [
  { name: "Infinity · traveling wave + dancing swing", start: 15, amplitude: 44, field: { kind: "travelling", period: 1.2, crests: 5, direction: 1, low: 18, high: 88 }, colors: ["#54d9ff", "#f4f7ff"] },
  { name: "Infinity · stadium wave + sweeping dance", start: 21, amplitude: 48, swingShape: "rise-fall", field: { kind: "stadium", period: 1.6, width: 0.045, direction: 1, low: 12, high: 92 }, colors: ["#76ff89", "#ffe066"] },
  { name: "Infinity · pyramid wave + leaning dance", start: 27, amplitude: 50, swingShape: "triangle", field: { kind: "custom", shape: "triangle", path: "around", motion: "repeat", period: 1.6, crests: 2, direction: 1, low: 18, high: 90 }, colors: ["#ff66cc", "#5aa7ff"] },
  { name: "Infinity · double pyramid + crossing dance", start: 33, amplitude: 52, opposite: true, field: { kind: "custom", shape: "triangle", path: "around", motion: "repeat", period: 1.35, crests: 2, direction: 1, bothWays: true, low: 16, high: 88 }, colors: ["#b48cff", "#76ff89"] },
];
for (const act of infinityActs) {
  pairedWave("infinity", "infinityLight", act.name, act.start, 6, act.field, act.colors, 32);
  pairedWave("outerRing", "outerRingLight", `Outer ring · ${act.name.replace("Infinity · ", "")} response`, act.start, 6,
    { ...act.field, low: 16, high: 48 }, act.colors, 18);
  const swing = motionPatternRecipes({ start: act.start, duration: 6, name: `${act.name} · visible 1D motion`, groupId: "infinity", order: "engineering",
    field: { kind: "custom", shape: act.swingShape || "sine", path: "around", motion: "repeat", period: act.field.period,
      crests: Math.min(2, act.field.crests || 1), direction: act.field.direction || 1, opposite: !!act.opposite, low: 45, high: 82, ease: 0.2 },
    motion: { axes: 1, path: "sweep", amplitudeDeg: act.amplitude, centreDeg: 0, limitSpeed: true } });
  addRecipe(...swing.recipes.filter(r => r.effect === "motion"));
}
addRecipe(hold("portraitCircle", "Portrait circle · poised during infinity waves", 15, 24, 44), hold("portraitCircleLight", "Portrait circle · green wave backdrop", 15, 24, 20),
  hold("outerRing", "Outer ring · poised for the Bellagio dances", 39, 18, 40), hold("outerRingLight", "Outer ring · gold dance backdrop", 39, 18, 14));

// Retarget the actual Bellagio curve envelopes at their slower four-minute timing.
// Optional gain makes the swings clearly visible without exceeding 82 degrees/second.
const bellagioCurve = (sourceName, target, label, start, duration, cycles, spread, color, gain) => {
  const original = bellagioRecipes.find(r => r.name === sourceName && r.effect === "curve");
  if (!original) throw new Error(`Bellagio source curve is missing: ${sourceName}`);
  const centre = original.envelope[0].value, period = duration * STRETCH / cycles;
  const slope = Math.max(...original.envelope.slice(1).map((p, i) => Math.abs(p.value - original.envelope[i].value) / (p.time - original.envelope[i].time)));
  const peak = slope * 120 / period, positive = Math.max(1e-6, ...original.envelope.map(p => p.value - centre)), negative = Math.max(1e-6, ...original.envelope.map(p => centre - p.value));
  const scale = Math.min(gain, 82 / peak, 0.98 / positive, 0.98 / negative);
  const envelope = original.envelope.map(p => ({ time: p.time, value: r3(centre + (p.value - centre) * scale) }));
  importedDrives.push({ source: sourceName, target, period: r3(period), requestedPeak: r3(peak), appliedPeak: r3(peak * scale), amplitudeScale: r3(scale) });
  addRecipe(base(target, `Bellagio · ${label}`, start, duration, { effect: "curve", attribute: "motion_angle", cycles, spread, ease: 0, sampleRate: 25,
    order: pathOrder(target), envelope, color }));
};
const bellagioAct = ({ label, start, duration = 6, supportDuration = duration, sources, cycles, spread = 0, colors, fan = false, gain = 1 }) => {
  for (const role of ["infinity", "portraitCircle"]) {
    const targets = fan ? motionHalves[role] : sources.length === 1 ? [role] : motionParity[role];
    targets.forEach((target, i) => bellagioCurve(sources[Math.min(i, sources.length - 1)], target, `${label} · ${role}${targets.length > 1 ? ` ${i + 1}` : ""}`, start, duration, cycles, spread, colors[0], gain));
    pairedWave(role, `${role}Light`, `${label} · ${role} water`, start, supportDuration,
      { kind: "custom", shape: "sine", path: "around", motion: "repeat", period: 1.5, crests: 2, low: 52, high: 78, ease: 0.2 }, colors, 28);
  }
};
bellagioAct({ label: "X lattice cross", start: 39, cycles: 4, colors: ["#f4f7ff", "#54d9ff"], sources: ["Cross · X lattice along the line (even)", "Cross · X lattice along the line (odd)"] });
bellagioAct({ label: "High scissors dance", start: 45, cycles: 4, gain: 1.65, colors: ["#ff5a5a", "#76ff89"], sources: ["Scissors · neighbours snap past each other (even)", "Scissors · neighbours snap past each other (odd)"] });
bellagioAct({ label: "Traveling cross", start: 51, cycles: 4, spread: 1, colors: ["#ff66cc", "#76ff89"], sources: ["Travelling cross · X points run along the line (even)", "Travelling cross · X points run along the line (odd)"] });
bellagioAct({ label: "Opening and closing fan", start: 57, cycles: 4, colors: ["#5aa7ff", "#f4f7ff"], fan: true, sources: ["Fan · halves open out and close (north half)", "Fan · halves open out and close (south half)"] });
bellagioAct({ label: "Whole-path rowing", start: 69, cycles: 3, gain: 1.25, colors: ["#ffe066", "#5aa7ff"], sources: ["Rowing · the whole line leans together"] });
bellagioAct({ label: "Finale crossing sweeps", start: 75, duration: 12, supportDuration: 6, cycles: 12, gain: 1.5, spread: 1, colors: ["#ff5a5a", "#54d9ff"], sources: ["Finale · crossing sweeps (even)", "Finale · crossing sweeps (odd)"] });

// Tall radial dances: two inward breaths, alternating weave, high center convergence,
// a traveling inward swing and a final crown. Every act has generous reading time.
const outerActs = [
  { name: "Outer 14 · two high inward swings and return", start: 57, duration: 6, period: 3, amplitude: 50, path: "together", offset: 1.5, colors: ["#ffe066", "#76ff89"] },
  { name: "Outer 14 · alternating high radial weave", start: 63, duration: 3, period: 1.5, amplitude: 50, path: "around", opposite: true, crests: 1, colors: ["#ff66cc", "#54d9ff"] },
  { name: "Outer 14 · high arcs flow to the center", start: 66, duration: 3, period: 1.5, amplitude: 28, centre: -30, path: "together", offset: 0.4, colors: ["#ffc400", "#f4f7ff"] },
  { name: "Outer 14 · traveling inward swing", start: 69, duration: 6, period: 1.5, amplitude: 44, centre: -10, path: "around", crests: 1, offset: 0.75, colors: ["#76ff89", "#f4f7ff"] },
];
for (const act of outerActs) {
  const made = motionPatternRecipes({ start: act.start, duration: act.duration, name: act.name, groupId: "outerRing", lightGroupId: "outerRingLight", order: "clockwise",
    field: { kind: "custom", shape: "sine", path: act.path, motion: "repeat", period: act.period, crests: act.crests || 1, opposite: !!act.opposite,
      offset: act.offset || 0, low: 55, high: 92, ease: 0.2 },
    motion: { axes: 1, path: "sweep", amplitudeDeg: act.amplitude, centreDeg: act.centre || 0, limitSpeed: true },
    light: { color: act.colors[0], low: 10, high: 38, colorMode: "sequence", colors: act.colors } });
  addRecipe(...made.recipes);
}
const outerFinale = motionPatternRecipes({ start: 81, duration: 6, name: "Outer 14 · final high inward crown", groupId: "outerRing", order: "clockwise",
  field: { kind: "custom", shape: "sine", path: "together", period: 4, low: 60, high: 82, ease: 0.2 },
  motion: { axes: 1, path: "sweep", amplitudeDeg: 20, centreDeg: -35, limitSpeed: true } });
addRecipe(...outerFinale.recipes.filter(r => r.effect === "motion"));

const shotField = { kind: "custom", shape: "drawn", path: "together", motion: "repeat", period: 10, spread: 0,
  points: [{ time: 0, value: 0 }, { time: 0.06, value: 1 }, { time: 0.3, value: 1 }, { time: 1, value: 0 }], low: 0, high: 100, ease: 0 };
addRecipe(wave("compressors", "Nine blue dots · 50 m compressor sprays", 76, 5, shotField));
addRecipe(wave("compressorsLight", "Nine high sprays · blue-white sparkle", 75.8, 5.4, { kind: "custom", shape: "sine", path: "around", period: 1, crests: 2,
  low: 6, high: 14, colorMode: "sequence", colors: ["#54d9ff", "#f4f7ff"] }));
addRecipe(wave("allRegular", "Full emblem · traveling water-ribbon finale", 81, 6, { kind: "custom", shape: "sine", path: "around", motion: "repeat", period: 2, crests: 3,
  low: 24, high: 68 }, "clockwise"),
  wave("allLights", "Full emblem · color-ribbon finale", 81, 6, { kind: "custom", shape: "sine", path: "around", period: 2, crests: 2,
    low: 4, high: 12, colorMode: "sequence", colors: ["#ff5a5a", "#76ff89", "#5aa7ff", "#ffe066"] }, "clockwise"));
addRecipe(ramp("allRegular", "All regular water falls", 87, 3, 46, 0), ramp("allLights", "Lights fade with the water", 87, 3, 20, 0));

// Preserve the 15-second artwork opening, then expand every post-opening act 3x.
// Wave periods and motion offsets expand with the clips; curve cycles retain their
// editable count, so their actual period becomes slower without extra key density.
const stretchedFields = new Set();
for (const recipe of recipes) {
  const originalStart = recipe.start, start = mapTime(originalStart), end = mapTime(originalStart + recipe.duration);
  recipe.start = r3(start); recipe.duration = r3(end - start);
  if (originalStart >= 15 && recipe.field && !stretchedFields.has(recipe.field)) {
    stretchedFields.add(recipe.field);
    if (Number.isFinite(recipe.field.period)) recipe.field.period = r3(recipe.field.period * STRETCH);
    if (Number.isFinite(recipe.field.offset)) recipe.field.offset = r3(recipe.field.offset * STRETCH);
    if (Number.isFinite(recipe.field.ease)) recipe.field.ease = r3(recipe.field.ease * STRETCH);
  }
}

console.log("Generated roles", Object.fromEntries([...roleMembers].map(([role, list]) => [role, list.length])));
const items = inventory(fixtures);
const studio = { ...readStudio({}), groups: G, recipes, tempo: [{ time: 0, bpm: 120 }],
  markers: [[0, "Portrait"], [3, "Oddaa ring"], [6, "Sunburst"], [10, "Two side shapes"], [15, "Traveling wave + visible 1D dance"], [21, "Stadium wave + sweep"],
    [27, "Pyramid waves + leaning dance"], [33, "Double pyramid crossing dance"], [39, "Bellagio X lattice"], [45, "High scissors dance"], [51, "Traveling cross"],
    [57, "Fans + two high inward swings"], [63, "High radial weave"], [66, "High arcs flow to center"], [69, "Rowing + traveling inward swing"], [76, "Nine 50 m sprays"],
    [81, "United crossing finale"], [87, "Slow fade"]]
    .map(([time, name], i) => ({ id: `section-${i + 1}`, time: r3(mapTime(time)), name, kind: "section", color: GREEN })) };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) { console.error(issues.slice(0, 20)); throw new Error(`${issues.length} show compile issues`); }
if (roleMembers.get("outerRing")?.length !== 14 || roleMembers.get("outerRing").some(id => fixtures.find(f => f.id === id)?.type !== "motion_nozzle_1d_tilt_motor")) {
  throw new Error("The outer circle must contain exactly 14 radial 1D swinging nozzles");
}
if (roleMembers.get("portraitCircle")?.length !== 28) throw new Error("The portrait circle must contain 28 1D nozzles");
if (!roleMembers.get("infinity")?.length) throw new Error("The red infinity path has no 1D nozzles");
if (fixtures.filter(f => f.type === "nozzle_air_shooter_50e_50m_oase").length !== 9) throw new Error("The infinity shape must contain all nine 50 m compressor sprays");
if (new Set(fixtures.map(f => f.id)).size !== fixtures.length) throw new Error("Fixture IDs are not unique");
if (importedDrives.length !== 22 || importedDrives.some(d => d.appliedPeak > 82.001)) throw new Error("Bellagio curve import or drive-speed limiting failed");
let maxMotionSpeed = 0;
for (const clip of clips.filter(c => c.type === "motion_angle" && c.keys?.length > 3)) {
  for (let i = 2; i < clip.keys.length; i += 2) {
    const dt = clip.keys[i] - clip.keys[i - 2]; if (dt <= 0) continue;
    const degrees = k => clip.motionOffset === undefined ? -45 + clip.keys[k + 1] * 0.9 : clip.motionOffset + clip.motionScale * clip.keys[k + 1];
    maxMotionSpeed = Math.max(maxMotionSpeed, Math.abs(degrees(i) - degrees(i - 2)) / dt);
  }
}
if (maxMotionSpeed > 90.01) throw new Error(`Compiled motion exceeds the 90 degree/second drive limit: ${maxMotionSpeed}`);
for (const [leftRole, rightRole] of [["pillar-left", "pillar-right"], ["pillar-left-light", "pillar-right-light"]]) {
  const left = roleMembers.get(leftRole).map(id => fixtures.find(f => f.id === id));
  const right = roleMembers.get(rightRole).map(id => fixtures.find(f => f.id === id));
  if (left.length !== right.length) throw new Error("Both side shapes must have the same number of fixtures");
  left.forEach((f, i) => {
    if (Math.abs(f.x + right[i].x - 2 * CX) > 0.001 || Math.abs(f.y - right[i].y) > 0.001) {
      throw new Error("The right side shape must be an exact mirror of the left, not stacked on it");
    }
  });
}
const outsidePool = fixtures.filter(f => {
  const maxY = f.y >= 0 ? H / 2 * Math.sqrt(Math.max(0, 1 - (f.x / (W / 2)) ** 2)) : H / 2;
  return Math.abs(f.x) > W / 2 + 0.001 || f.y < -H / 2 - 0.001 || f.y > maxY + 0.001;
});
if (outsidePool.length) throw new Error(`Fixtures outside the D-shaped pool: ${outsidePool.slice(0, 5).map(f => f.id).join(", ")}`);
if (recipes.filter(r => r.groupId === "compressors").length !== 1) throw new Error("The nine air shooters must have only one shared shot");

const byTrack = new Map();
for (const clip of clips) (byTrack.get(clip.trackId) || byTrack.set(clip.trackId, []).get(clip.trackId)).push(clip);
const now = new Date().toISOString(), name = "Odaa and Elder — Infinity Pillars";
source.engineering = { ...sourceEng, name, id: "aquaflow-odaa-infinity", projectName: name, pool_type: "freeform",
  params: { width: W, length: H, depth: 0.65, units: "m", design_head_m: 55, fountainMode: "pool" },
  geometry: { type: "polygon", closed: true, points: basin, source: { units: "meters", status: "concept dimensions" } },
  basins: [{ type: "polygon", closed: true, id: "basin-d", name: "D-shaped basin", outer: basin, source: { units: "meters", status: "concept dimensions" } }],
  fixtures, groups: G.map(g => ({ id: `group-${g.id}`, uuid: `group-${g.id}`, owner: "model", name: g.name, members: g.memberFixtureIds })),
  site_models: [], site_surfaces: [], cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  guidePaths: ["infinity", "portraitCircle", "outerRing"].map(role => ({ id: `guide-${role}`, name: roleLabels[role], closed: true, visible: true,
    color: role === "outerRing" ? GOLD : role === "portraitCircle" ? GREEN : WHITE,
    points: fixtures.filter(f => f.groupId === role).map(f => ({ x: f.x, y: f.y })) })),
  depth_zones: [{ id: "basin-depth", zone: "display", label: "650 mm concept water level", depth: 0.65, color: "#5fb4d6", points: basin }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now };
source.devices = []; source.nodes = []; source.connections = [];
source.timelineTracks = items.flatMap(item => (item.tracks || []).map(track => ({ id: track.id, fixtureId: item.id, deviceId: item.id,
  label: `${item.label} · ${String(track.type).replaceAll("_", " ")}`, type: track.type, color: track.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(track.id) || [] })));
source.programmer = { ...source.programmer, studio, timelineClips: clips, cues: [], audioDuration: END, audioFileReference: null, musicCache: {}, stems: null,
  patternDefinitions: [{ id: "odaa-infinity-240s", name, duration: END }] };
source.show = { ...source.show, id: "aquaflow-odaa-infinity-show", name, bpm: 120, duration: END, loop: false };
source.project = { ...source.project, id: "aquaflow-odaa-infinity", name, revision: 1, createdAt: now, modifiedAt: now };
const camera = (t, position, target, fov = 42) => ({ id: `camera-${t}`, t, position: { x: position[0], y: position[1], z: position[2] }, target: { x: target[0], y: target[1], z: target[2] }, fov, roll: 0, ease: "smooth" });
source.render = { ...source.render, environment: "night", cameraMode: "animated", activeCameraView: null, realWorld: true, windX: 0, windZ: 0,
  cameraTrack: { enabled: true, keys: [camera(0, [0, 30, -43], [0, 1, 0]), camera(15, [0, 24, -35], [0, 2, 0]), camera(mapTime(39), [0, 22, -33], [0, 3, 0]),
    camera(mapTime(57), [0, 23, -34], [0, 3, 0]), camera(mapTime(66), [0, 20, -30], [0, 4, 0]), camera(mapTime(69), [0, 24, -35], [0, 3, 0]),
    camera(mapTime(76), [0, 31, -44], [0, 4, 0]), camera(mapTime(87), [0, 30, -43], [0, 1, 0]), camera(END, [0, 30, -43], [0, 1, 0])] },
  cameraViews: [{ id: "front", name: "Audience · front", position: { x: 0, y: 19, z: -35 }, target: { x: 0, y: 2, z: 0 }, fov: 45 },
    { id: "top", name: "Top · design plan", position: { x: 0, y: 52, z: -0.01 }, target: { x: 0, y: 0, z: 0 }, fov: 45 }] };
source.workspace = { activePanel: "preview" };
source.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
source.savedAt = now;
const notes = `${name}\n\nFOUR-MINUTE CHOREOGRAPHY EDITION\nD-shaped 40 x 20 m concept pool. The original 15-second artwork opening is retained; every later act is expanded threefold so viewers can read the formations. Red infinity line = ${infinityPoints.length} tangent-aligned 1D nozzles with 3.6-4.8 second traveling, stadium, pyramid and double-pyramid water waves plus large, explicit swinging dance layers. Nine blue dots = nine OASE 50 m compressor/air sprays. Old Man and Oddaa portrait = green light only. Portrait circle = 28 1D nozzles. Separate larger circle = exactly 14 radial 1D swinging nozzles with a 9 m nominal jet, two high inward/outward breaths, alternating high weave, high center-converging arcs, traveling inward swing and final crown.\n\nThe actual editable Bellagio curve envelopes from ${path.basename(bellagioPath)} drive X-lattice crosses, high scissors, traveling crosses, fans, rowing and finale crossing sweeps on the infinity path and portrait circle. Slower retiming and optional gain make the dance readable; imported curves remain limited to 82 degrees/second and all compiled 1D motion stays within the 90 degrees/second concept drive limit. Maximum compiled speed: ${r3(maxMotionSpeed)} degrees/second. Synchronized lighting uses formation-specific colour palettes.\n\nGeometry, hydraulic and compressed-air plant, electrical addresses, splash containment and drive mappings require site/supplier verification. The 50 m catalogue shooter has a 25 s refill cycle and fires only once in this 240 s show. The infinity sequence is original AquaFlow choreography. All presentation blocks are editable. No music, customer audio or external assets are embedded.\n`;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(source) }, { name: "manifest.json", data: JSON.stringify(source.assetManifest, null, 2) },
  { name: "design-notes.txt", data: notes }]));
const motionBlocks = showBlocks(studio).filter(block => block.type === "motion" || (block.water?.effect === "curve" && block.water?.attribute === "motion_angle"));
const motionFile = exportPatterns(studio, motionBlocks);
motionFile.pack = { id: "odaa-1d-choreography", name: "Odaa · Infinity and Bellagio 1D Choreography", version: 3,
  description: "Slow readable Bellagio-derived dances, explicit infinity swing layers and high radial inward/outward patterns for compatible 1D groups." };
const assetOut = path.resolve("../../outputs/Odaa_1D_Crossing_Assets.aqpattern.json");
fs.mkdirSync(path.dirname(assetOut), { recursive: true });
fs.writeFileSync(assetOut, `${JSON.stringify(motionFile, null, 2)}\n`);
console.log(JSON.stringify({ out, assetOut, motionAssets: motionBlocks.length, fixtures: fixtures.length, roles: Object.fromEntries([...roleMembers].map(([k, v]) => [k, v.length])),
  patterns: recipes.length, clips: clips.length, duration: END, maxMotionSpeed: r3(maxMotionSpeed), importedDrives, bytes: fs.statSync(out).size }, null, 2));
