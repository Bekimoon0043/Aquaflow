// Fountains of Bellagio · Tiësto (2014 medley: Footprints / Rocky / Red Lights), rebuilt on the real layout.
//   vite-node --root . scripts/build-bellagio-tiesto.mjs <template.aquapkg (with the song)> <out.aquapkg>
//
// Layout, read from the official Bellagio film of this show (YouTube iNQpcDuE6e4, drone shots 0:15–0:33,
// top-down at 2:42) and the front-view film (DS_Z432yaiE): one long curved line of nozzles across the lake,
// a big double ring and a small ring, both tangent to the front of the line, white light only, fog.
// Equipment counts are Bellagio's published ones (Wikipedia, Fountains of Bellagio): 208 oarsmen,
// 798 mini-shooters, 192 super-shooters, 16 extreme-shooters = 1,214 nozzles; reach 100 / 240 / 460 ft.
// Oarsmen are modelled as 1D swing nozzles (one axis): along the line they swing along the line, on the
// rings they swing radially (inward = dome, outward = crown).
// Timing: the song (identical to the film's soundtrack, lag 0.0 s) is 128.02 BPM, first beat 0.239 s;
// section times and hits come from its energy curve and from what the film shows at the same moment.
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) { console.error("usage: vite-node --root . scripts/build-bellagio-tiesto.mjs <template.aquapkg> <out.aquapkg>"); process.exit(1); }

const zip = readZip(fs.readFileSync(srcPath));
const proj = JSON.parse(zipText(zip.get("project.aqua")));
const END = Math.round(Number(proj.show?.duration || 293.15) * 100) / 100;
const BPM = 128.02, BEAT0 = 0.239, BAR = 4 * 60 / BPM;
const bar = (n) => Math.round((BEAT0 + n * BAR) * 100) / 100;

// ─── site ───────────────────────────────────────────────────────────────────
const r2 = (v) => Math.round(v * 100) / 100;
const deg = (rad) => r2((rad * 180) / Math.PI);
// The lake (plan metres; +y = the Strip / audience, −y = the hotel).
const LAKE = [[-170, -30], [-165, 10], [-150, 32], [-110, 42], [-60, 48], [0, 52], [60, 48], [110, 40], [150, 28], [168, 5], [170, -30],
  [150, -60], [90, -78], [40, -70], [0, -82], [-50, -74], [-110, -80], [-155, -62]].map(([x, y]) => ({ x, y }));
// The main line: a 300 m curve, the ends bending back toward the hotel.
const lineY = (x) => -12 - 26 * (x / 148) ** 2;
const LINE = [];
for (let x = -148; x <= 148.0001; x += 0.25) LINE.push({ x, y: lineY(x) });
const cum = [0];
for (let i = 1; i < LINE.length; i++) cum.push(cum[i - 1] + Math.hypot(LINE[i].x - LINE[i - 1].x, LINE[i].y - LINE[i - 1].y));
const LINE_LEN = cum.at(-1);
/** Point, tangent angle and normal at arc length s along the line. */
const along = (s) => {
  let i = cum.findIndex((c) => c >= s); if (i <= 0) i = 1;
  const a = LINE[i - 1], b = LINE[i], u = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, ang, nx: -Math.sin(ang), ny: Math.cos(ang) };
};
const RING = { cx: 0, cy: lineY(0) + 24, R: 24, Rin: 15 };            // tangent to the line's front
const SMALL = { cx: 96, cy: lineY(96) + 11, R: 11 };

const fixtures = [];
const add = (id, type, label, x, y, eng = {}, extra = {}) => {
  fixtures.push({ id, type, label, x: r2(x), y: r2(y), z: 0, rotation: 0, visible: true, owner: "model",
    engineering: { ...getDefaultEngineering(type), ...eng }, ...extra });
  return id;
};
const pad = (n) => String(n).padStart(3, "0");
const OAR = "motion_nozzle_1d_tilt_motor", MINI = "nozzle_comet_jet_dn25", SUPER = "nozzle_comet_jet_dn80", LIGHT = "light_uw_rgb_54w", FOG = "effect_fog_machine";
const oarEng = { jetHeightM: 22, flowLpm: 420, pressureBar: 2.7, angleRangeDeg: 120, tiltRangeDeg: 120, speedDegSec: 90, axisCount: 1,
  equipmentModel: "Oarsman (1D swing jet)" };
const miniEng = { jetHeightM: 30, flowLpm: 520, pressureBar: 3.6, equipmentModel: "Mini-shooter (100 ft)" };
const superEng = { jetHeightM: 73, flowLpm: 2600, pressureBar: 8.5, equipmentModel: "Super-shooter (240 ft)" };
const xtEng = { jetHeightM: 140, flowLpm: 5200, pressureBar: 16, equipmentModel: "Extreme-shooter (460 ft)" };
const WARM = "#ffd9a6";
const ids = {};
const put = (k, id) => (ids[k] ||= []).push(id);

// Line: 128 oarsmen (swing along the line), 508 mini-shooters a metre in front, 136 super-shooters a metre behind.
for (let i = 0; i < 128; i++) {
  const p = along(((i + 0.5) / 128) * LINE_LEN);
  put("lineOar", add(`oar-L-${pad(i + 1)}`, OAR, `Oarsman · line ${i + 1}`, p.x, p.y, oarEng, { rotation: deg(p.ang), groupId: "line_oarsmen" }));
  put("lineLight", add(`light-L-${pad(i + 1)}`, LIGHT, `Light · line ${i + 1}`, p.x + p.nx * 0.4, p.y + p.ny * 0.4,
    { pairedNozzleId: `oar-L-${pad(i + 1)}`, beamAngleDeg: 40 }, { color: WARM, groupId: "line_lights" }));
}
for (let i = 0; i < 508; i++) {
  const p = along(((i + 0.5) / 508) * LINE_LEN);
  put("lineMini", add(`mini-L-${pad(i + 1)}`, MINI, `Mini-shooter · line ${i + 1}`, p.x + p.nx * 1, p.y + p.ny * 1, miniEng, { groupId: "line_mini" }));
}
for (let i = 0; i < 136; i++) {
  const p = along(((i + 0.5) / 136) * LINE_LEN);
  put("lineSuper", add(`super-L-${pad(i + 1)}`, SUPER, `Super-shooter · line ${i + 1}`, p.x - p.nx * 1, p.y - p.ny * 1, superEng, { groupId: "line_super" }));
}
// Line ends: 3 extreme-shooters each.
[[0, "N"], [LINE_LEN, "S"]].forEach(([s, end]) => {
  const p = along(Math.min(LINE_LEN - 0.01, Math.max(0.01, s)));
  for (let k = 0; k < 3; k++) put("xtEnds", add(`xt-${end}-${k + 1}`, SUPER, `Extreme-shooter · ${end === "N" ? "north" : "south"} end ${k + 1}`,
    p.x - p.nx * (2 + k * 1.6), p.y - p.ny * (2 + k * 1.6), xtEng, { groupId: "extreme" }));
});
// Rings. Oarsmen swing radially: rotation = their angle round the ring (positive swing = outward).
const ring = (prefix, c, R, n, type, eng, key, label, extra = {}) => {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    put(key, add(`${prefix}-${pad(i + 1)}`, type, `${label} ${i + 1}`, c.cx + R * Math.cos(a), c.cy + R * Math.sin(a), eng,
      { rotation: deg(a), ...extra }));
  }
};
ring("oar-R", RING, RING.R, 48, OAR, oarEng, "ringOar", "Oarsman · big ring", { groupId: "ring_oarsmen" });
ring("light-R", RING, RING.R - 0.5, 48, LIGHT, { beamAngleDeg: 40 }, "ringLight", "Light · big ring", { color: WARM, groupId: "ring_lights" });
ring("mini-R", RING, RING.R + 1, 96, MINI, miniEng, "ringMini", "Mini-shooter · big ring", { groupId: "ring_mini" });
ring("super-R", RING, RING.R - 1.5, 32, SUPER, superEng, "ringSuper", "Super-shooter · big ring", { groupId: "ring_super" });
ring("mini-I", RING, RING.Rin, 130, MINI, miniEng, "innerMini", "Mini-shooter · inner ring", { groupId: "inner_mini" });
ring("super-I", RING, RING.Rin - 1.5, 8, SUPER, superEng, "innerSuper", "Super-shooter · inner ring", { groupId: "inner_super" });
ring("xt-R", RING, 3, 6, SUPER, xtEng, "xtRing", "Extreme-shooter · big ring centre", { groupId: "extreme" });
ring("oar-S", SMALL, SMALL.R, 32, OAR, oarEng, "smallOar", "Oarsman · small ring", { groupId: "small_oarsmen" });
ring("light-S", SMALL, SMALL.R - 0.5, 32, LIGHT, { beamAngleDeg: 40 }, "smallLight", "Light · small ring", { color: WARM, groupId: "small_lights" });
ring("mini-S", SMALL, SMALL.R + 1, 64, MINI, miniEng, "smallMini", "Mini-shooter · small ring", { groupId: "small_mini" });
ring("super-S", SMALL, SMALL.R - 1.5, 16, SUPER, superEng, "smallSuper", "Super-shooter · small ring", { groupId: "small_super" });
ring("xt-S", SMALL, 2, 4, SUPER, xtEng, "xtSmall", "Extreme-shooter · small ring centre", { groupId: "extreme" });
// Fog: Bellagio's fog system along the line and round the big ring.
// No fog: the user does not want it for this show (Bellagio's fog system is left out).
ids.fogLine = []; ids.fogRing = [];

const count = (k) => ids[k]?.length || 0;
const census = {
  oarsmen: count("lineOar") + count("ringOar") + count("smallOar"),
  mini: count("lineMini") + count("ringMini") + count("innerMini") + count("smallMini"),
  super: count("lineSuper") + count("ringSuper") + count("innerSuper") + count("smallSuper"),
  extreme: count("xtEnds") + count("xtRing") + count("xtSmall"),
};
census.nozzles = census.oarsmen + census.mini + census.super + census.extreme;
if (census.oarsmen !== 208 || census.mini !== 798 || census.super !== 192 || census.extreme !== 16) throw new Error(`census ${JSON.stringify(census)}`);

// ─── groups ─────────────────────────────────────────────────────────────────
const G = [];
const group = (id, name, members, color = WARM) => { G.push({ id, name, memberFixtureIds: members, orderMode: "engineering", color, muted: false, solo: false }); return id; };
const halves = (list) => [list.filter((_, i) => i % 2 === 0), list.filter((_, i) => i % 2 === 1)];
const [superA, superB] = halves(ids.lineSuper);
group("lineOar", "Line · oarsmen (water)", ids.lineOar);
group("lineOarSwing", "Line · oarsmen (swing)", ids.lineOar);
const [oarOdd, oarEven] = halves(ids.lineOar);
const xOf = new Map(fixtures.map((f) => [f.id, f.x]));
group("lineOarOdd", "Line · oarsmen odd (swing)", oarOdd);
group("lineOarEven", "Line · oarsmen even (swing)", oarEven);
const centreMini = ids.lineMini.filter((id) => Math.abs(xOf.get(id)) < 40);
group("lineCentreMini", "Line · centre mini-shooters (singer)", centreMini);
group("lineCentreLight", "Line · centre lights (singer)", ids.lineLight.filter((id) => Math.abs(xOf.get(id)) < 40));
group("lineOarLeft", "Line · oarsmen north half (swing)", ids.lineOar.filter((id) => xOf.get(id) < 0));
group("lineOarRight", "Line · oarsmen south half (swing)", ids.lineOar.filter((id) => xOf.get(id) >= 0));
group("lineMini", "Line · mini-shooters", ids.lineMini);
group("lineSuper", "Line · super-shooters", ids.lineSuper);
group("lineSuperA", "Line · super-shooters A (odd)", superA);
group("lineSuperB", "Line · super-shooters B (even)", superB);
group("ringOar", "Big ring · oarsmen (water)", ids.ringOar);
group("ringOarSwing", "Big ring · oarsmen (swing)", ids.ringOar);
group("ringMini", "Big ring · outer mini-shooters", ids.ringMini);
group("innerMini", "Big ring · inner mini-shooters", ids.innerMini);
group("ringSuper", "Big ring · super-shooters", [...ids.ringSuper, ...ids.innerSuper]);
group("smallOar", "Small ring · oarsmen (water)", ids.smallOar);
group("smallOarSwing", "Small ring · oarsmen (swing)", ids.smallOar);
group("smallMini", "Small ring · mini-shooters", ids.smallMini);
group("smallSuper", "Small ring · super-shooters", ids.smallSuper);
group("xtRing", "Extreme · big ring centre", ids.xtRing);
group("xtSmall", "Extreme · small ring centre", ids.xtSmall);
group("xtEnds", "Extreme · line ends", ids.xtEnds);
group("xtAll", "Extreme · all 16", [...ids.xtRing, ...ids.xtSmall, ...ids.xtEnds]);
group("allMini", "All mini-shooters", [...ids.lineMini, ...ids.ringMini, ...ids.innerMini, ...ids.smallMini]);
group("allSuper", "All super-shooters", [...ids.lineSuper, ...ids.ringSuper, ...ids.innerSuper, ...ids.smallSuper]);
group("allOar", "All oarsmen (water)", [...ids.lineOar, ...ids.ringOar, ...ids.smallOar]);
group("lineLight", "Line · lights", ids.lineLight);
group("ringLight", "Big ring · lights", ids.ringLight);
group("smallLight", "Small ring · lights", ids.smallLight);
group("allLight", "All lights", [...ids.lineLight, ...ids.ringLight, ...ids.smallLight]);


// ─── pattern helpers (all editable in Show Programming) ────────────────────
const base = (groupId, name, start, duration, extra) => ({ ...newRecipe(groupId, start), name, start: r2(start), duration: r2(duration), cycles: 1, spread: 1,
  intensity: 100, order: "engineering", color: G.find((g) => g.id === groupId)?.color || "#cbd5e1", ...extra });
const hold = (g, name, s, d, level) => base(g, name, s, d, { effect: "static", intensity: level });
const field = (g, name, s, d, f, order = "engineering") => base(g, name, s, d, { effect: "field", order, field: { ease: 0.6, ...f } });
const ramp = (g, name, s, d, from, to) => base(g, name, s, d, { effect: "field", field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat",
  period: d * 2, spread: 0, points: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }, { time: 1, value: 1 }], low: from, high: to, ease: 0 } });
const travel = (dir, crests, period, low, high) => ({ kind: "travelling", crests, period, direction: dir, low, high });
const swell = (period, low, high) => ({ kind: "swell", period, lag: 0, low, high });
const stadium = (period, low, high, dir = 1) => ({ kind: "stadium", period, width: 0.06, direction: dir, low, high });
const converge = (period, low, high) => ({ kind: "sweep", period, width: 0.14, origin: "tip", low, high });
const crossing = (period, low, high) => ({ kind: "crossing", period, crests: 2, width: 0.1, low, high });
const finale = (period, low, high) => ({ kind: "finale", period, crests: 3, accel: 0.004, direction: 1, low, high });
/** The water draws itself along the group over `sweep` s, then holds (each jet rises in `rise` s). */
const drawOn = (g, name, s, d, sweep, high, rise = 1.2) => {
  const P = d * 2 + 2;
  return base(g, name, s, d, { effect: "field", field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period: P, crests: sweep / P, direction: 1,
    points: [{ time: 0, value: 0 }, { time: rise / P, value: 1 }, { time: 0.56, value: 1 }, { time: 0.6, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
};
/**
 * Shooter shot: each jet fires once (fast rise, short top, fall), chased across the group over `sweep` s.
 * An air shooter cannot refire until its receiver refills, so one shot per jet per pattern.
 */
const shot = (g, name, s, sweep, high, top = 0.6) => {
  const d = sweep + 3.2, P = d * 2 + 2;
  return base(g, name, s, d, { effect: "field", field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period: P, crests: sweep / P, direction: 1,
    points: [{ time: 0, value: 0 }, { time: 0.35 / P, value: 1 }, { time: (0.35 + top) / P, value: 1 }, { time: (0.35 + top + 2.2) / P, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
};
const fall = (g, name, s, d, from) => ramp(g, name, s, d, from, 0);
// Oarsman swing (motion_angle): 0..100 → −45°..+45°. Sweeps are keyed curves; spread phases them along the group.
const A = (degrees) => r2((degrees + 45) / 0.9);
const swing = (g, name, s, d, cycles, amp, spread = 1, centre = 0) => base(g, name, s, d, { effect: "curve", attribute: "motion_angle", cycles, spread, intensity: 100, ease: 0,
  envelope: [{ time: 0, value: A(centre) / 100 }, { time: 0.25, value: A(centre + amp) / 100 }, { time: 0.5, value: A(centre) / 100 },
    { time: 0.75, value: A(centre - amp) / 100 }, { time: 1, value: A(centre) / 100 }] });
const lean = (g, name, s, d, degrees) => base(g, name, s, d, { effect: "static", attribute: "motion_angle", intensity: A(degrees) });
/**
 * 1D oarsman dances along the line (one swing axis each, along the line):
 *   cross     odd and even jets swing in mirror image, so neighbours cross into an X lattice
 *   fan       the two halves open outward together and close back to the centre
 *   scissors  mirror-image pairs snapping past each other on the beat
 *   rowing    the whole line leans together, back and forth, like oars
 */
const cross = (name, s, d, cycles, amp, spread = 0) => [swing("lineOarOdd", `${name} (odd)`, s, d, cycles, amp, spread), swing("lineOarEven", `${name} (even)`, s, d, cycles, -amp, spread)];
const fan = (name, s, d, cycles, amp) => [swing("lineOarLeft", `${name} (north half)`, s, d, cycles, -amp / 2, 0, -amp / 2), swing("lineOarRight", `${name} (south half)`, s, d, cycles, amp / 2, 0, amp / 2)];
const scissors = (name, s, d, cycles, amp) => cross(name, s, d, cycles, amp, 0);
const rowing = (name, s, d, cycles, amp) => [swing("lineOarSwing", name, s, d, cycles, amp, 0)];
const LAMP = 85;

const R = [];
const sec = (...list) => R.push(...list);

// 0 – 6.2  · the lake waits; the rings glow
sec(hold("ringLight", "Ring glows in the dark", 0, 6.2, 18), hold("smallLight", "Small ring glows", 0, 6.2, 12));
// 6.2 hit · two columns: the ring and small-ring extremes (film: two tall columns from the air)
sec(shot("xtRing", "Opening hit · big ring column", 6.24, 0.2, 100, 1.2), shot("xtSmall", "Opening hit · small ring column", 6.24, 0.2, 90, 1.2),
  hold("ringLight", "Columns lit", 6.2, 6.8, 70), hold("smallLight", "Columns lit", 6.2, 6.8, 60));
// 13 – 24 · the big ring draws itself clockwise, inner ring rises; second column on the 12.96 hit
sec(drawOn("ringMini", "Ring draws clockwise", 12.96, 11, 4.5, 38), shot("xtRing", "Second column", 12.96, 0.2, 75, 1),
  drawOn("innerMini", "Inner ring rises", 16.97, 7, 3, 30), drawOn("ringLight", "Ring lights draw on", 12.96, 11, 4.5, LAMP));
// 24 – 37 · crown: ring oarsmen lean out; the line draws from the north end to the ring and on
sec(lean("ringOarSwing", "Crown: ring oarsmen lean out", 24.36, 12.8, 28), drawOn("ringOar", "Crown rises", 24.36, 12.8, 2.5, 72),
  drawOn("lineOar", "Line draws north → south", 27.2, 9.9, 7, 45), drawOn("lineLight", "Line lights draw on", 27.2, 9.9, 7, LAMP),
  ramp("innerMini", "Inner ring settles", 24, 2, 30, 18), hold("innerMini", "Inner ring low", 26, 11, 18));
// 37 – 60 · build: X-crossing on the ring, rotating crown, small ring and shooters wake (44.7, 56.7 hits)
sec(swing("ringOarSwing", "Ring oarsmen cross (X)", 37.1, 7.5, 2, 30, 0.5), field("ringOar", "Ring swells", 37.1, 7.5, swell(3.75, 40, 70)),
  field("ringMini", "Crown rotates clockwise", 44.6, 12, travel(1, 4, 3.75, 15, 70)), swing("ringOarSwing", "Ring oarsmen roll", 44.6, 12, 3, 22, 1),
  field("ringOar", "Ring oarsmen roll", 44.6, 12, travel(1, 2, 3.75, 35, 75)),
  field("lineOar", "Oarsmen full for the cross", 37.1, 19.5, swell(7.5, 65, 85)), ...cross("Cross · X lattice along the line", 37.1, 19.5, 4, 42),
  drawOn("smallMini", "Small ring draws on", 44.71, 12, 3, 45), drawOn("smallOar", "Small ring oarsmen", 44.71, 12, 3, 60),
  lean("smallOarSwing", "Small ring crown", 44.71, 12, 25), hold("smallLight", "Small ring lit", 44.71, 27.3, LAMP),
  shot("smallSuper", "Small ring shooters", 56.72, 1.2, 80), shot("ringSuper", "Big ring shooters", 56.72, 1.5, 70),
  hold("ringLight", "Ring lit", 24, 48, LAMP), hold("lineLight", "Line lit", 37.1, 35, LAMP * 0.8));
// 60 – 72 · the line becomes a curtain (film 1:00–1:12)
sec(drawOn("lineMini", "Curtain rises along the line", 59.9, 12, 3.5, 70), field("lineOar", "Oarsmen inside the curtain", 59.9, 12, swell(3.75, 55, 75)),
  swing("lineOarSwing", "Oarsmen comb the curtain", 59.9, 12, 4, 18, 0.25), field("ringMini", "Ring holds high", 59.9, 12, swell(3.75, 45, 70)));
// 72 – 76 · IMPACT: every super-shooter and the ring extremes, fog rolls in (film 1:12)
sec(shot("allSuper", "Impact · all super-shooters", 71.9, 1.4, 92), shot("xtRing", "Impact · ring extremes", 72.05, 0.2, 100, 1.5),
  shot("xtEnds", "Impact · end extremes", 72.2, 0.4, 95, 1.2), fall("lineMini", "Curtain drops for the shot", 71.9, 1.5, 70),
  hold("fogAll", "Fog rolls in", 72, 12, 70), hold("allLight", "Impact light", 71.9, 4, 100));
// 76 – 120 · Footprints groove: oarsmen sweep in waves, curtains chase (hits 75.9, 80.5, 110, 114.1)
sec(field("lineOar", "Oarsmen waves along the line", 75.85, 22.5, travel(1, 3, 3.75, 30, 75)),
  swing("lineOarSwing", "Leaning arcs travel south", 75.85, 22.5, 6, 32, 1),
  shot("lineSuperA", "Accent · odd line shooters", 80.54, 2.5, 70), shot("lineSuperB", "Accent · even line shooters", 88.1, 2.5, 70),
  field("lineMini", "Curtain chase", 95.9, 14, stadium(3.75, 12, 72)), field("lineOar", "Oarsmen high for the scissors", 98.35, 21.6, swell(3.75, 60, 85)),
  ...scissors("Scissors · neighbours snap past each other", 98.35, 21.6, 11, 26),
  field("ringMini", "Ring ripples", 75.85, 34, travel(-1, 2, 7.5, 18, 55)), lean("ringOarSwing", "Ring dome (oarsmen lean in)", 75.85, 34, -30),
  field("ringOar", "Ring dome breathes", 75.85, 34, swell(7.5, 40, 70)),
  hold("fogRing", "Fog round the ring", 109.9, 10, 80), shot("ringSuper", "Ring shooters in the fog", 110, 1.5, 80),
  shot("smallSuper", "Small ring answers", 114.06, 1, 80), hold("allLight", "Groove light", 75.9, 44, LAMP));
// 120 – 134 · DROP: everything on the beat; shooters fire in alternating halves (receivers refill)
sec(field("lineMini", "Drop · line pumps on the beat", 119.9, 14, travel(1, 8, 1.875, 25, 85)),
  field("lineOar", "Drop · oarsmen full", 119.9, 14, swell(0.94, 60, 90)), ...scissors("Drop · scissors on the beat", 119.9, 14, 7, 26),
  shot("lineSuperA", "Drop shot · odd shooters", 121.77, 0.8, 90), shot("lineSuperB", "Drop shot · even shooters", 125.5, 0.8, 90),
  shot("lineSuperA", "Drop shot · odd shooters", 129.25, 0.8, 90), shot("xtEnds", "Drop · end extremes", 127.4, 0.4, 100, 1),
  field("ringMini", "Drop · ring spins", 119.9, 14, travel(1, 6, 1.875, 25, 85)), field("innerMini", "Drop · inner ring counter-spins", 119.9, 14, travel(-1, 6, 1.875, 20, 80)),
  swing("ringOarSwing", "Drop · ring breathes in and out", 119.9, 14, 7, 25, 0), field("ringOar", "Drop · ring oarsmen", 119.9, 14, swell(1.875, 55, 85)),
  field("smallMini", "Drop · small ring", 119.9, 14, swell(0.94, 30, 80)), hold("allLight", "Drop light", 119.9, 14, 100));
// 134 – 150 · breakdown: fog over the lake, the ring alone, slow columns in the haze
sec(hold("fogAll", "Breakdown fog", 133.9, 16, 90), fall("lineMini", "Line falls", 133.9, 2, 60), fall("lineOar", "Line oarsmen fall", 133.9, 3, 70),
  field("ringOar", "Ring low in the fog", 133.9, 16, swell(7.5, 18, 40)), lean("ringOarSwing", "Ring dome in the fog", 133.9, 16, -35),
  drawOn("innerMini", "Inner ring columns in the haze", 137.6, 12.4, 6, 55), ramp("allLight", "Light dims to the ring", 133.9, 2, 100, 30),
  hold("ringLight", "Ring glows in the fog", 135.9, 14, 70));
// 150 – 180 · walls and tall shooters (film 2:24–3:00); hits 149.5, 157.4
sec(drawOn("lineMini", "The wall rises", 149.5, 22.5, 2, 80), field("lineOar", "Leaning arcs on the wall", 150.5, 21.5, travel(1, 2, 7.5, 50, 80)),
  ...fan("Fan · halves open out and close", 150.5, 21.5, 3, 44), shot("lineSuper", "Shooters race the line", 157.4, 5, 85),
  field("ringMini", "Ring wall", 149.5, 22.5, swell(3.75, 50, 80)), field("ringOar", "Ring crown high", 149.5, 22.5, swell(3.75, 60, 85)),
  lean("ringOarSwing", "Crown out", 149.5, 22.5, 25), hold("allLight", "Wall light", 149.5, 30.5, LAMP),
  shot("lineSuperA", "Tall shooters behind the wall", 172, 3, 90), shot("lineSuperB", "Tall shooters behind the wall", 176, 3, 90),
  hold("lineMini", "Wall holds", 172, 7.9, 80), fall("lineMini", "Wall falls", 179.9, 2.5, 80));
// 180 – 196 · quiet bass section: fog, dome, a slow swell on the line (film top-down shots)
sec(hold("fogAll", "Fog bank", 179.9, 15.7, 85), lean("ringOarSwing", "Deep dome", 179.9, 15.7, -38), field("ringOar", "Dome breathes with the bass", 179.9, 15.7, swell(3.75, 35, 65)),
  field("lineOar", "Line ripples slowly", 182, 13.6, travel(1, 1.5, 7.5, 15, 40)), swing("lineOarSwing", "Slow rocking", 182, 13.6, 2, 20, 0.5),
  drawOn("innerMini", "Inner ring rises in the fog", 187.5, 8, 4, 45), hold("allLight", "Low light", 179.9, 15.7, 45));
// 195.6 BIG HIT · then build and drop (hits 204.1, 209.7, 216.2 flash, 222.8, 227.2)
sec(shot("allSuper", "Big hit · all super-shooters", 195.63, 1.6, 95), shot("xtAll", "Big hit · all extremes", 195.75, 0.8, 100, 1.3),
  hold("allLight", "Big hit light", 195.6, 2, 100),
  field("lineOar", "Arcs across the line", 197.8, 18.4, travel(1, 3, 3.75, 40, 85)), swing("lineOarSwing", "Arcs swing across", 197.8, 18.4, 5, 38, 1),
  field("lineMini", "Line pulses", 197.8, 18.4, travel(-1, 4, 1.875, 20, 70)),
  shot("lineSuperA", "Chase · odd shooters", 204.09, 2.5, 85), shot("lineSuperB", "Chase · even shooters", 209.69, 2.5, 85),
  hold("fogAll", "Fog before the flash", 207, 9, 80), field("ringMini", "Ring builds", 197.8, 18.4, finale(3.75, 25, 80)),
  hold("allLight", "Build light", 197.6, 18.6, LAMP), hold("allLight", "FLASH", 216.24, 0.35, 100),
  shot("xtAll", "Flash · extremes", 216.24, 0.3, 100, 0.8), ramp("allLight", "After the flash", 216.6, 1, 100, LAMP),
  field("allMini", "Converge & split", 216.6, 10.7, converge(5.6, 15, 80)),
  ...rowing("Rowing · the whole line leans together", 216.6, 10.7, 4, 36), field("lineOar", "Oarsmen high", 216.6, 10.7, swell(1.875, 60, 90)),
  shot("ringSuper", "Ring shooters", 222.78, 1.5, 90), shot("smallSuper", "Small ring shooters", 227.24, 1, 90));
// 227 – 250 · the double ring (film 3:51–4:06), then the dip with fog
sec(field("ringMini", "Outer ring spins", 227.2, 10, travel(1, 3, 3.75, 30, 85)), field("innerMini", "Inner ring spins the other way", 227.2, 10, travel(-1, 3, 3.75, 30, 85)),
  lean("ringOarSwing", "Tall crown", 227.2, 10, 18), field("ringOar", "Tall crown", 227.2, 10, swell(3.75, 65, 92)),
  field("lineMini", "Line under the rings", 227.2, 10, swell(3.75, 15, 45)), fall("lineOar", "Line oarsmen rest", 227.2, 3, 80),
  hold("fogRing", "Fog in the ring", 237.1, 13, 85), ramp("ringMini", "Ring settles", 237.1, 3, 85, 30), field("ringOar", "Ring low", 237.1, 13, swell(7.5, 20, 45)),
  lean("ringOarSwing", "Ring dome", 237.1, 13, -30), hold("allLight", "Rings lit", 227.2, 22.9, LAMP));
// 250 – 270 · Red Lights: the line rises again, rings with shooters, a finale build
sec(drawOn("lineOar", "Line returns", 250, 20.4, 5, 80), ...cross("Travelling cross · X points run along the line", 250, 20.4, 5, 42, 1),
  field("lineMini", "Finale build", 255.6, 14.8, finale(3.75, 15, 75)), shot("ringSuper", "Rings with shooters", 255.6, 1.5, 80),
  shot("smallSuper", "Small ring shooters", 258, 1, 80), field("smallMini", "Small ring", 255.6, 14.8, swell(3.75, 30, 70)),
  hold("allLight", "Red Lights", 250, 20.4, LAMP));
// 270.5 FINALE · everything, shooters in waves, peak 286, last shot 289.2, then the lake goes still
sec(shot("allSuper", "Finale · super-shooter wave", 270.49, 4, 95), shot("xtAll", "Finale · extremes", 270.6, 1.2, 100, 1.5),
  field("lineMini", "Finale · full line", 270.4, 18.7, travel(1, 6, 1.875, 45, 92)), field("lineOar", "Finale · oarsmen", 270.4, 18.7, swell(0.94, 70, 95)),
  ...cross("Finale · crossing sweeps", 270.4, 18.7, 9, 28, 1),
  field("ringMini", "Finale · ring", 270.4, 18.7, travel(1, 6, 1.875, 45, 92)), field("innerMini", "Finale · inner ring", 270.4, 18.7, travel(-1, 6, 1.875, 40, 90)),
  lean("ringOarSwing", "Finale crown", 270.4, 18.7, 25), field("ringOar", "Finale crown", 270.4, 18.7, swell(0.94, 70, 95)),
  field("smallMini", "Finale · small ring", 270.4, 18.7, swell(0.94, 50, 90)), field("smallOar", "Finale · small oarsmen", 270.4, 18.7, swell(0.94, 60, 90)),
  shot("lineSuperB", "Peak · even shooters", 280.2, 1.5, 95), shot("lineSuperA", "Peak · odd shooters", 285.8, 1, 100),
  shot("xtAll", "Last shot", 289.18, 0.6, 100, 1.4), hold("fogAll", "Finale fog", 280, 9, 75), hold("allLight", "Finale light", 270.4, 18.8, 100),
  fall("lineMini", "Line falls", 289.1, 2.5, 92), fall("lineOar", "Oarsmen fall", 289.1, 2.5, 95), fall("ringMini", "Ring falls", 289.1, 2.5, 92),
  fall("innerMini", "Inner ring falls", 289.1, 2.5, 90), fall("ringOar", "Ring oarsmen fall", 289.1, 2.5, 95), fall("smallMini", "Small ring falls", 289.1, 2.5, 90),
  fall("smallOar", "Small oarsmen fall", 289.1, 2.5, 90), ramp("allLight", "Lights fade", 289.2, 3.5, 100, 0));
// ─── the water sings: one pattern per sung phrase, a pulse on every sung word ──
// Phrases and word onsets: scripts/data/bellagio-tiesto-vocals.json (estimated from the song's
// centre channel, 250–3500 Hz voiced frames). The film starts its ring and crown on the vocal
// entries (12.7 s, 24.4 s), so the singer groups follow the words.
const VOCALS = JSON.parse(fs.readFileSync("scripts/data/bellagio-tiesto-vocals.json", "utf8")).phrases;
const singerFor = (t) => t < 60 ? { water: "innerMini", light: "ringLight", high: 62, glow: 22 }
  : t < 160 ? { water: t < 100 ? "smallMini" : "lineCentreMini", light: t < 100 ? "smallLight" : "lineCentreLight", high: 70, glow: 25 }
    : { water: "lineCentreMini", light: "lineCentreLight", high: 78, glow: 28 };
/** A drawn level curve over one phrase: each word spikes, settles to a glow, the phrase end falls. */
const sungCurve = (phrase, P) => {
  const pts = [{ time: 0, value: 0 }];
  for (const w of phrase.words) {
    const u = (w - phrase.start) / P;
    const prev = pts.at(-1);
    if (u - 0.0005 > prev.time) pts.push({ time: u - 0.0005, value: Math.max(0.36, Math.min(prev.value, 0.36)) });
    pts.push({ time: u + 0.08 / P, value: 1 }, { time: u + 0.32 / P, value: 0.38 });
  }
  const end = (phrase.end - phrase.start) / P;
  pts.push({ time: Math.max(pts.at(-1).time + 0.001, end), value: 0.36 }, { time: end + 0.6 / P, value: 0 }, { time: 1, value: 0 });
  // Round, then keep strictly increasing times inside the pattern (the compiler requires it).
  const out = [];
  for (const p of pts) {
    const time = Math.min(1, Math.round(p.time * 10000) / 10000);
    if (!out.length || time > out.at(-1).time) out.push({ time, value: r2(Math.max(0, Math.min(1, p.value))) });
  }
  return out;
};
VOCALS.forEach((phrase, i) => {
  // Keyed curves sampled 20×/s (a field pattern this long would be sampled only every 0.25 s and
  // blur the words); a small spread ripples each word out from the group's centre.
  const d = phrase.end - phrase.start + 0.8, who = singerFor(phrase.start);
  const envelope = sungCurve(phrase, d);
  const sing = (g, high, label) => base(g, `${label} ${i + 1} · ${phrase.words.length} words`, phrase.start, d,
    { effect: "curve", envelope, intensity: high, sampleRate: 20, spread: 0.03, order: "center-out", ease: 0 });
  R.push(sing(who.water, who.high, "Sung line"), sing(who.light, 100, "Sung line light"));
});
// Light level: 208 lights at full output wash the water into solid white bands in the 3D view;
// the film's base glow is a warm, modest light under each jet.
const LIGHT_SCALE = 0.45;
for (const r of R) {
  if (!r || !/Light$/.test(r.groupId)) continue;
  if (r.effect === "field" && r.field) { r.field.high = r2(r.field.high * LIGHT_SCALE); r.field.low = r2((r.field.low || 0) * LIGHT_SCALE); }
  else r.intensity = r2(r.intensity * LIGHT_SCALE);
}
const recipes = R.filter((r) => r && r.groupId && r.duration > 0 && !/^fog/.test(r.groupId));

const markers = [[0, "Intro · the lake waits"], [6.24, "Opening columns"], [12.96, "Ring draws on"], [24.36, "Crown · line draws on"], [37.1, "Build"],
  [59.9, "Curtain"], [71.9, "Impact"], [75.85, "Footprints groove"], [119.9, "Drop"], [133.9, "Breakdown · fog"], [149.5, "Walls"],
  [179.9, "Bass section"], [195.63, "Big hit"], [216.24, "Flash"], [227.2, "Double ring"], [250, "Red Lights"], [270.49, "Finale"], [289.18, "Last shot"]]
  .map(([time, name], i) => ({ id: `m${i + 1}`, name, label: name, time, kind: "section", color: "#ffd9a6" }));

// ─── compile + checks ───────────────────────────────────────────────────────
const items = inventory(fixtures);
const silent = items.filter((i) => !(i.tracks || []).length);
if (silent.length) throw new Error(`${silent.length} fixtures have no channels: ${silent.slice(0, 3).map((i) => i.type)}`);
const prev = proj.programmer?.studio || {};
const studio = { ...readStudio({}), version: prev.version, groups: G, recipes, tempo: [{ time: 0, bpm: BPM }], markers, layout: { ...(prev.layout || {}) } };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) { console.log("issues:", issues.slice(0, 12)); throw new Error("compile issues"); }

// Shooter refill rule: a super / extreme shooter may not fire again within 3.5 s of its last shot.
const shots = new Map();
for (const c of clips) {
  if (!/^(super|xt)-/.test(c.fixtureId) || !c.keys) continue;
  for (let k = 1; k < c.keys.length; k += 2) if (c.keys[k] >= 50 && (k < 2 || c.keys[k - 2] < 50)) {
    const t = c.startTime + c.keys[k - 1];
    const list = shots.get(c.fixtureId) || shots.set(c.fixtureId, []).get(c.fixtureId);
    list.push(t);
  }
}
let refillViolations = 0;
for (const list of shots.values()) { list.sort((a, b) => a - b); for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] < 3.5) refillViolations++; }
// Swing drive limit: no oarsman may be asked to turn faster than its drive (90°/s).
let worstSwing = 0, worstSwingAt = "";
for (const c of clips) {
  if (c.type !== "motion_angle" || !c.keys) continue;
  for (let k = 2; k < c.keys.length; k += 2) {
    const dt = c.keys[k] - c.keys[k - 2];
    if (dt <= 0) continue;
    const rate = (0.9 * Math.abs(c.keys[k + 1] - c.keys[k - 1])) / dt;
    if (rate > worstSwing) { worstSwing = rate; worstSwingAt = `${c.name} @ ${r2(c.startTime + c.keys[k])} s`; }
  }
}
console.log("fastest swing", Math.round(worstSwing), "°/s", worstSwingAt);
if (worstSwing > 90 * 1.05) throw new Error(`swing faster than the 90°/s drive: ${Math.round(worstSwing)}°/s (${worstSwingAt})`);
console.log("census", census, "fixtures", fixtures.length, "groups", G.length, "patterns", recipes.length, "clips", clips.length, "refill violations", refillViolations);

// ─── write the project ──────────────────────────────────────────────────────
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#ffd9a6", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
const xs = LAKE.map((p) => p.x), ys = LAKE.map((p) => p.y);
proj.engineering = {
  ...proj.engineering, name: "Fountains of Bellagio · Tiësto", pool_type: "freeform",
  params: { width: Math.max(...xs) - Math.min(...xs), length: Math.max(...ys) - Math.min(...ys), radius: 170, depth: 4.5, units: "m" },
  geometry: { type: "polygon", closed: true, points: LAKE }, basins: [], fixtures, manualPipes: [], pipes: [], groups: [],
  site_surfaces: [], guide_paths: [],
};
const name = "Fountains of Bellagio · Tiësto (Footprints / Rocky / Red Lights)";
const now = new Date().toISOString();
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioDuration: END, patternDefinitions: [{ id: "bellagio-tiesto", name, duration: END }] };
proj.show = { ...proj.show, name, bpm: 128, duration: END, loop: false };
proj.project = { ...proj.project, name, modifiedAt: now };
// Cameras (world: x = plan x, z = plan y − centre; the audience on the Strip is +z). Keys follow the film's angles.
const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
const W = (x, y, h) => ({ x, y: h, z: y - cy });
const key = (t, pos, tgt, fov, ease = "smooth") => ({ id: `cam-${t}`, t, position: pos, target: tgt, fov, roll: 0, ease });
const RINGC = W(RING.cx, RING.cy, 8), LINEC = W(0, -15, 10), SM = W(SMALL.cx, SMALL.cy, 8);
// Shot list: close and low like the film's audience and drone shots, chosen per section so each
// pattern is readable (along the line for crossings and waves, close for ring domes and crowns).
const ALONG = W(-150, 6, 5), ALONG_T = W(0, -18, 9);
const cameraKeys = [
  key(0, W(150, 120, 80), W(0, -10, 0), 45), key(10, W(70, 75, 38), RINGC, 45), key(22, W(32, 52, 9), RINGC, 50),
  key(34, W(-40, 45, 6), W(-60, -20, 9), 55), key(56, W(30, 55, 6), W(10, -14, 11), 55),
  key(70, W(0, 115, 6), W(0, -15, 30), 62), key(76, ALONG, ALONG_T, 45), key(98, W(-95, 30, 5), W(-20, -15, 10), 50),
  key(119, W(0, 105, 5), W(0, -15, 18), 62), key(133, W(30, 60, 12), RINGC, 48), key(149, W(0, 100, 5), W(0, -15, 14), 60),
  key(172, W(60, 95, 6), W(0, -15, 30), 60), key(180, W(0, -10, 210), W(0, -10.01, 0), 55), key(194, W(0, 100, 5), W(0, -15, 25), 62),
  key(214, W(150, 4, 5), W(0, -16, 9), 45), key(226, W(-32, 58, 14), RINGC, 48), key(249, W(-70, 70, 6), W(-20, -15, 10), 52),
  key(269, W(0, 115, 6), W(0, -15, 30), 64), key(END, W(0, 150, 24), W(0, -15, 15), 60),
];
proj.render = { ...proj.render, environment: "night", cameraMode: "animated", activeCameraView: null, laserHaze: 0.35,
  cameraTrack: { enabled: true, keys: cameraKeys },
  cameraViews: [
    { id: "strip", name: "From the Strip (front)", position: W(0, 125, 6), target: W(0, -15, 18), fov: 60 },
    { id: "drone", name: "Drone · south-east (film 0:22)", position: W(150, 120, 80), target: W(0, -10, 0), fov: 45 },
    { id: "ring", name: "Big ring close", position: W(30, 75, 20), target: RINGC, fov: 45 },
    { id: "top", name: "Top view", position: W(0, -10, 320), target: W(0, -10.01, 0), fov: 55 },
  ] };
proj.savedAt = now;
const entries = [{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest || {}, null, 2) }];
for (const [k, v] of zip) if (k.startsWith("assets/")) entries.push({ name: k, data: v });
fs.writeFileSync(out, createZip(entries));
console.log(`→ ${out} · ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
