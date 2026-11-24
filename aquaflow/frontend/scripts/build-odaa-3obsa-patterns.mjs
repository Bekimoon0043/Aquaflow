// Odaa & Gadaa · 3Obsa — the client's ten-pattern show, on the same site and song.
//   vite-node --root . scripts/build-odaa-3obsa-patterns.mjs <design.aquapkg (with the song)> <out.aquapkg>
//
// The client's running order (one pattern per music section):
//   1  light only: the sun (ray lamps), the Odaa tree and Gadaa (the Elder's face);
//   2  the six diagonal rainbows draw the client's sketch seen from the front: low shoulders, higher
//      shoulders and a tall arch in the middle (each arc jumps from one nozzle to the next);
//   3  the 1D circle crosses (odd and even swing through each other), the Varios low (1 m), wide and
//      thick, and the two "bokku" (the straight-jet sword shapes, left and right) in waves;
//   4  the ∞ alone, warm colours;  5  the ∞ swinging waves with the 1D circle;
//   6  the ∞ in another wave with different kinds of lighting, and the bokku moving;
//   7  the ∞ with Odaa and Gadaa;  8  the ∞ dancing in warm colours;
//   9  the camera at 27°: the ∞ with Odaa and Gadaa;  10  the sun, Gadaa, Odaa and the bokku together;
//   then the last climb with everything.
// Whenever the camera looks from the front (audience eye level), the rainbows draw the sketch.
// The 50 m and 20 m air blasts are kept as they were; the water is raised to sit in proportion with them.
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { poolCenter } from "/src/engineering/geometryContract.js";

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) { console.error("usage: vite-node --root . scripts/build-odaa-3obsa-patterns.mjs <design.aquapkg> <out.aquapkg>"); process.exit(1); }
const zip = readZip(fs.readFileSync(srcPath));
const proj = JSON.parse(zipText(zip.get("project.aqua")));
const MUSIC = JSON.parse(fs.readFileSync("scripts/data/odaa-3obsa-music.json", "utf8"));
const r2 = (v) => Math.round(v * 100) / 100;
const END = r2(MUSIC.duration);
const BPM = MUSIC.bpm, BEAT = 60 / BPM, BAR = 4 * BEAT, BEAT0 = MUSIC.beat0;
const STOP = 320.3;
const bt = (t) => r2(BEAT0 + Math.round((t - BEAT0) / BEAT) * BEAT);

// ─── the design (same site; 10 cannons per circle as in the third pass) ─────
const fixtures = proj.engineering.fixtures;
const pad2 = (n) => String(n).padStart(2, "0");
const r4 = (v) => Math.round(v * 10000) / 10000;
for (const tag of ["20m-left", "20m-right", "50m-center"]) {
  const orig = fixtures.filter((f) => f.groupId === "compressors" && f.id.includes(tag));
  if (orig.length !== 5) continue;
  const cx = orig.reduce((a, f) => a + f.x, 0) / 5, cy = orig.reduce((a, f) => a + f.y, 0) / 5;
  const rad = orig.reduce((a, f) => a + Math.hypot(f.x - cx, f.y - cy), 0) / 5;
  orig.forEach((f, k) => {
    const a = Math.atan2(f.y - cy, f.x - cx) + Math.PI / 5, id = f.id.replace(/\d+$/, pad2(k + 6));
    const x = r4(cx + rad * Math.cos(a)), y = r4(cy + rad * Math.sin(a));
    fixtures.push({ ...f, id, label: String(f.label || id).replace(/\d+ of 5/, `${k + 6} of 10`), x, y,
      engineering: { ...f.engineering, designStatus: "Added for the 3Obsa dance: 10 cannons per circle — verify plant, refill and splash containment" } });
    const lamp = fixtures.find((l) => l.engineering?.pairedNozzleId === f.id);
    if (lamp) fixtures.push({ ...lamp, id: `${id}-light`, label: String(lamp.label || "").replace(/\d+$/, String(k + 6)), x, y,
      engineering: { ...lamp.engineering, pairedNozzleId: id } });
    f.label = String(f.label || f.id).replace(/of 5/, "of 10");
  });
}
const byGroup = (g) => fixtures.filter((f) => f.groupId === g && !String(f.type).startsWith("light"));
const INF = byGroup("infinity"), PC = byGroup("portraitCircle"), RING = byGroup("outerRing"), RAYS = byGroup("rays");
const PL = byGroup("pillar-left"), PR = byGroup("pillar-right"), DIAG = byGroup("diagonalRainbow");
const CMP = byGroup("compressors");
const byAngle = (list) => { const cx = list.reduce((a, f) => a + f.x, 0) / list.length, cy = list.reduce((a, f) => a + f.y, 0) / list.length;
  return list.slice().sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)); };
const A20L = byAngle(CMP.filter((f) => /20m-left/.test(f.id))), A20R = byAngle(CMP.filter((f) => /20m-right/.test(f.id))), A50 = byAngle(CMP.filter((f) => /50m-center/.test(f.id)));
const LAMPS = fixtures.filter((f) => String(f.type).startsWith("light"));
const lampOf = new Map(LAMPS.filter((l) => l.engineering?.pairedNozzleId).map((l) => [l.engineering.pairedNozzleId, l.id]));
const portrait = (g) => LAMPS.filter((l) => l.groupId === g).map((l) => l.id);

// Heights in proportion with the 20 m and 50 m blasts (the blasts stay as they are).
const HEIGHT = { inf: 9, pc: 14, ring: 12, rays: 7, pillars: 8 };
for (const f of INF) f.engineering = { ...f.engineering, jetHeightM: HEIGHT.inf };
for (const f of PC) f.engineering = { ...f.engineering, jetHeightM: HEIGHT.pc };
for (const f of RAYS) f.engineering = { ...f.engineering, jetHeightM: HEIGHT.rays };
for (const f of [...PL, ...PR]) f.engineering = { ...f.engineering, jetHeightM: HEIGHT.pillars };
// Vario jets: a cone that opens to an 80° V (fan_angle 100), so they can stand low, wide and thick.
for (const f of RING) { f.type = "nozzle_vario_jet"; f.engineering = { ...f.engineering, nozzleStyle: "Vario jet (variable cone)", jetHeightM: HEIGHT.ring, sprayAngleDeg: 0, varioSpanDeg: 80 }; }

// The rainbow sketch, seen from the front: every arc jumps sideways from one nozzle to the next one
// in — the outer pair to the middle nozzles (low shoulders), the middle pair to the inner nozzles
// (high shoulders), and the inner pair to each other (the tall arch in the middle). For each arc the
// launch angle and jet height are solved for the landing point and the apex height, with the same
// air drag the 3D Preview uses (horizontal speed decays at 0.35 / s).
const DIAG_X = DIAG.slice().sort((a, b) => a.x - b.x);
const PEAK = [9, 15, 22];                       // outer, middle, inner pair apex (m)
const solveArc = (R, P, y0 = 0.15) => {
  const reach = (e) => { const H = (P - y0) / Math.sin(e) ** 2, v = Math.sqrt(2 * 9.81 * H), vy = v * Math.sin(e);
    const T = (vy + Math.sqrt(vy * vy + 2 * 9.81 * y0)) / 9.81; return { x: (v * Math.cos(e) * (1 - Math.exp(-0.35 * T))) / 0.35, H }; };
  let lo = (40 * Math.PI) / 180, hi = (89.5 * Math.PI) / 180;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (reach(mid).x > R) lo = mid; else hi = mid; }
  return { elev: (lo * 180) / Math.PI, H: reach(lo).H };
};
/** The tall arch: the inner pair reach their apex exactly over the middle, so the two jets meet at the top. */
const solveApex = (D, P, y0 = 0.15) => {
  const apexX = (e) => { const H = (P - y0) / Math.sin(e) ** 2, v = Math.sqrt(2 * 9.81 * H), tp = (v * Math.sin(e)) / 9.81;
    return { x: (v * Math.cos(e) * (1 - Math.exp(-0.35 * tp))) / 0.35, H }; };
  let lo = (40 * Math.PI) / 180, hi = (89.5 * Math.PI) / 180;
  for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (apexX(mid).x > D) lo = mid; else hi = mid; }
  return { elev: (lo * 180) / Math.PI, H: apexX(lo).H };
};

const ARCS = [];
DIAG_X.forEach((f, i) => {
  const left = i < 3, pair = left ? i : 5 - i;                          // 0 outer, 1 middle, 2 inner
  // As drawn: the outer and middle arcs top out right over the next nozzle in and fall on past it,
  // crossing that nozzle's jet; the inner pair land on each other's nozzle, crossing into the tall arch.
  const to = pair < 2 ? DIAG_X[left ? i + 1 : i - 1] : DIAG_X[left ? 3 : 2];
  const R = Math.abs(to.x - f.x), { elev, H } = pair < 2 ? solveApex(R, PEAK[pair]) : solveArc(R, PEAK[pair]);
  const az = left ? 0 : 180, tilt = r2(90 - elev);
  f.rotation = az;
  f.engineering = { ...f.engineering, jetHeightM: r2(H), aimTiltDeg: tilt, aimDeg: tilt, aimAzimuthDeg: az, diagonalAngleDeg: tilt,
    designStatus: "Aimed sideways for the client's front-view rainbow sketch — verify nozzle model, pressure and splash containment" };
  ARCS.push({ id: f.id, x: r2(f.x), lands: r2(to.x), apex: PEAK[pair], tiltFromVertical: tilt, jetHeightM: r2(H) });
});
console.log("rainbow arcs", JSON.stringify(ARCS));
const census = { infinity: INF.length, circle1D: PC.length, vario: RING.length, rays: RAYS.length, pillars: PL.length + PR.length, diagonal: DIAG.length,
  air20: A20L.length + A20R.length, air50: A50.length, lights: LAMPS.length };
if (INF.length !== 240 || PC.length !== 22 || RING.length !== 22 || RAYS.length !== 130 || DIAG.length !== 6 || A50.length !== 10 || A20L.length !== 10 || A20R.length !== 10)
  throw new Error(`unexpected design ${JSON.stringify(census)}`);

// ─── groups ─────────────────────────────────────────────────────────────────
const G = [];
const ids = (list) => list.map((f) => f.id ?? f);
const group = (id, name, members, color = "#ffc44d") => { G.push({ id, name, memberFixtureIds: ids(members), orderMode: "engineering", color, muted: false, solo: false }); return id; };
const odd = (l) => l.filter((_, i) => i % 2 === 0), even = (l) => l.filter((_, i) => i % 2 === 1);
group("inf", "∞ infinity · 240 1D (path order)", INF);
group("infR", "∞ right lobe", INF.slice(0, 120));
group("infL", "∞ left lobe", INF.slice(120));
group("infOdd", "∞ odd (cross)", odd(INF));
group("infEven", "∞ even (cross)", even(INF));
group("infSwing", "∞ infinity · swing", INF);
group("infRSwing", "∞ right lobe · swing", INF.slice(0, 120));
group("infLSwing", "∞ left lobe · swing", INF.slice(120));
group("pc", "1D circle · 22", PC);
group("pcSwing", "1D circle · swing", PC);
group("pcOddSwing", "1D circle odd · swing", odd(PC));
group("pcEvenSwing", "1D circle even · swing", even(PC));
group("ring", "Vario jets · 22", RING);
group("rays", "Sun rays · 130", RAYS);
group("pillarL", "Left bokku · 128", PL);
group("pillarR", "Right bokku · 128", PR);
group("pillars", "Both bokku", [...PL, ...PR]);
group("diag", "Diagonal rainbows · 6", DIAG);
group("diagOuter", "Rainbow sketch · outer pair (low shoulders)", [DIAG_X[0], DIAG_X[5]]);
group("diagMid", "Rainbow sketch · middle pair (high shoulders)", [DIAG_X[1], DIAG_X[4]]);
group("diagInner", "Rainbow sketch · inner pair (the tall arch)", [DIAG_X[2], DIAG_X[3]]);
A20L.forEach((f, i) => group(`a20L${i + 1}`, `Left 20 m air cannon ${i + 1}`, [f]));
A20R.forEach((f, i) => group(`a20R${i + 1}`, `Right 20 m air cannon ${i + 1}`, [f]));
A50.forEach((f, i) => group(`a50${i + 1}`, `Centre 50 m air cannon ${i + 1}`, [f]));
const lampsOf = (list) => list.map((f) => lampOf.get(f.id)).filter(Boolean);
group("infLight", "∞ lights", lampsOf(INF));
group("infOddLight", "∞ lights · odd", lampsOf(odd(INF)));
group("infEvenLight", "∞ lights · even", lampsOf(even(INF)));
group("ringLight", "Vario lights", lampsOf(RING));
group("pcLight", "1D circle lights", lampsOf(PC));
group("pillarsLight", "Bokku lights", lampsOf([...PL, ...PR]));
group("raysLight", "The sun · ray lights", lampsOf(RAYS));
group("waterLights", "All lights under water", lampsOf([...INF, ...PC, ...RING, ...RAYS, ...PL, ...PR, ...DIAG, ...CMP]));
group("face", "Gadaa · the Elder's face", portrait("faceLight"), "#33e07a");
group("hair", "Odaa · the tree", portrait("hairLight"), "#33e07a");
group("star", "The star", portrait("starLight"), "#33e07a");

// ─── pattern helpers (all editable in Show Programming) ────────────────────
const C = { gold: "#ffc44d", warm: "#ffd9a6", green: "#33e07a", red: "#ff3b30", blue: "#3d7bff", cyan: "#38d6ff", magenta: "#ff4fb8",
  white: "#f4f8ff", purple: "#9b5cff", orange: "#ff8a1f", amber: "#ffa200", ember: "#ff5a1f" };
const WARM = [C.gold, C.orange, C.red, C.amber, C.ember, C.warm];
const base = (g, name, start, duration, extra) => ({ ...newRecipe(g, start), name, start: r2(start), duration: r2(duration), cycles: 1, spread: 1,
  intensity: 100, order: "engineering", color: G.find((x) => x.id === g)?.color || C.gold, ...extra });
const hold = (g, name, s, d, level, extra = {}) => base(g, name, s, d, { effect: "static", intensity: level, ...extra });
const field = (g, name, s, d, f, extra = {}) => base(g, name, s, d, { effect: "field", field: { ease: 0.6, ...f }, ...extra });
const ramp = (g, name, s, d, from, to, extra = {}) => base(g, name, s, d, { effect: "field", ...extra, field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat",
  period: d * 2, spread: 0, points: [{ time: 0, value: 0 }, { time: 0.5, value: 1 }, { time: 1, value: 1 }], low: from, high: to, ease: 0 } });
const travel = (dir, crests, period, low, high) => ({ kind: "travelling", crests, period, direction: dir, low, high });
const swell = (period, low, high) => ({ kind: "swell", period, lag: 0, low, high });
const stadium = (period, low, high, dir = 1) => ({ kind: "stadium", period, width: 0.08, direction: dir, low, high });
const crossing = (period, low, high) => ({ kind: "crossing", period, crests: 2, width: 0.1, low, high });
const finale = (period, low, high) => ({ kind: "finale", period, crests: 3, accel: 0.004, direction: 1, low, high });
const drawOn = (g, name, s, d, sweep, high, extra = {}, rise = 0.8) => {
  const P = d * 2 + 2;
  return base(g, name, s, d, { effect: "field", ...extra, field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period: P, crests: sweep / P, direction: 1,
    points: [{ time: 0, value: 0 }, { time: rise / P, value: 1 }, { time: 0.56, value: 1 }, { time: 0.6, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
};
const together = (g, name, s, d, period, points, high = 100, low = 0, extra = {}) => base(g, name, s, d, { effect: "field", ...extra,
  field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat", period, spread: 0, points, low, high, ease: 0 } });
const band = (g, name, s, d, period, high, offset = 0, extra = {}, width = 0.22) => base(g, name, s, d, { effect: "field", ...extra,
  field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period, crests: 1, direction: 1, offset,
    points: [{ time: 0, value: 0 }, { time: 0.06, value: 1 }, { time: width, value: 1 }, { time: width + 0.08, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
/** Waves that travel along the ∞ path: only the nozzles inside a crest are up, the rest are down, so
 *  the shape reads (never the whole ∞ at once). `crests` = how many waves are on the path together. */
const pathWave = (g, name, s, d, period, crests, points, high = 100, dir = 1, extra = {}) => base(g, name, s, d, { effect: "field", ...extra,
  field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period, crests, direction: dir,
    points: points.map(([time, value]) => ({ time, value })), low: 0, high, ease: 0 } });
const W_STADIUM = [[0, 0], [0.04, 1], [0.22, 1], [0.28, 0], [1, 0]];          // a block of jets up, travelling
const W_PYRAMID = [[0, 0], [0.18, 1], [0.36, 0], [1, 0]];                     // a pyramid: rising to a peak and down again
const W_COMET = [[0, 0], [0.03, 1], [0.3, 0.25], [0.4, 0], [1, 0]];          // a tall head with a falling tail
const rainbowLights = (g, name, s, d, period, points, turn, high = 100, low = 0) => base(g, name, s, d, { effect: "field",
  field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat", period, spread: 0, points, low, high, ease: 0, colorMode: "rainbow", rainbowPeriod: turn } });
const PULSE = [{ time: 0, value: 1 }, { time: 0.18, value: 1 }, { time: 0.5, value: 0.15 }, { time: 1, value: 0.15 }];
const ALT_A = [{ time: 0, value: 1 }, { time: 0.45, value: 1 }, { time: 0.5, value: 0 }, { time: 0.95, value: 0 }, { time: 1, value: 1 }];
const ALT_B = [{ time: 0, value: 0 }, { time: 0.45, value: 0 }, { time: 0.5, value: 1 }, { time: 0.95, value: 1 }, { time: 1, value: 0 }];
const STROBE = [{ time: 0, value: 1 }, { time: 0.25, value: 1 }, { time: 0.3, value: 0 }, { time: 1, value: 0 }];
const STEADY = [{ time: 0, value: 1 }, { time: 1, value: 1 }];
// 1D swing (motion_angle 0..100 → −45°..+45°); the drives turn at most 88°/s (checked below).
const A = (degrees) => r2((degrees + 45) / 0.9);
const swingRate = (period) => Math.round(Math.min(10, Math.max(1.5, 8 / period)) * 10) / 10;
const cyclesFor = (d, period) => Math.max(1, Math.min(32, Math.round(d / period)));
const swing = (g, name, s, d, cycles, amp, spread = 1, centre = 0) => base(g, name, s, d, { effect: "curve", attribute: "motion_angle", cycles, spread, intensity: 100, ease: 0,
  sampleRate: swingRate(d / cycles),
  envelope: [{ time: 0, value: A(centre) / 100 }, { time: 0.25, value: A(centre + amp) / 100 }, { time: 0.5, value: A(centre) / 100 },
    { time: 0.75, value: A(centre - amp) / 100 }, { time: 1, value: A(centre) / 100 }] });
const lean = (g, name, s, d, degrees) => base(g, name, s, d, { effect: "static", attribute: "motion_angle", intensity: A(degrees) });
const cross = (name, s, d, period, amp, spread = 0) => [
  swing("infOdd", `${name} (odd)`, s, d, cyclesFor(d, period), amp, spread),
  swing("infEven", `${name} (even)`, s, d, cyclesFor(d, period), -amp, spread)];
const env = (pts) => pts.map(([time, deg]) => ({ time, value: A(deg) / 100 }));
const motion = (g, name, s, d, cycles, envelope, spread = 0) => base(g, name, s, d, { effect: "curve", attribute: "motion_angle", cycles, spread, intensity: 100, ease: 0,
  sampleRate: swingRate(d / cycles), envelope });
const funnel = (name, s, d, period, amp = 40, spread = 0) => motion("pcSwing", name, s, d, cyclesFor(d, period), env([[0, -amp], [0.5, amp], [1, -amp]]), spread);
const pcCross = (name, s, d, period, amp) => [swing("pcOddSwing", `${name} (odd)`, s, d, cyclesFor(d, period), amp, 0), swing("pcEvenSwing", `${name} (even)`, s, d, cyclesFor(d, period), -amp, 0)];
// Vario curves (level or cone), split into ≤ 32-cycle parts.
const vcurve = (g, name, s, d, period, pts, spread = 0, high = 100, attribute = null) => {
  const n = Math.max(1, Math.round(d / period)), parts = Math.ceil(n / 32);
  return Array.from({ length: parts }, (_, k) => {
    const c = Math.round(n / parts), ps = r2(s + (k * d) / parts), pd = r2(k === parts - 1 ? s + d - ps : d / parts);
    return base(g, parts > 1 ? `${name} (${k + 1}/${parts})` : name, ps, pd, { effect: "curve", cycles: Math.max(1, Math.min(32, c)), spread,
      intensity: high, ease: 0, order: "counter-clockwise", sampleRate: Math.min(25, Math.max(4, Math.round(16 / period))),
      envelope: pts.map(([time, value]) => ({ time, value })), ...(attribute ? { attribute } : {}) });
  });
};
const vfan = (g, name, s, d, period, pts, spread = 0, high = 100) => vcurve(g, `${name} · cone`, s, d, period, pts, spread, high, "fan_angle");
const vhold = (g, name, s, d, deg) => base(g, `${name} · cone`, s, d, { effect: "static", attribute: "fan_angle", intensity: deg });
const F_BLOOM = [[0, 0.03], [0.15, 0.2], [0.45, 1], [0.68, 0.9], [0.9, 0.08], [1, 0.03]];

// Air cannons (unchanged): a blast is a fast rise, a short top and a fall. Refill: a 20 m cannon may
// not fire again within 6 s, a 50 m cannon within 25 s.
const POOL = { L: A20L.map((_, i) => `a20L${i + 1}`), R: A20R.map((_, i) => `a20R${i + 1}`), C: A50.map((_, i) => `a50${i + 1}`) };
const shotsOf = new Map();
const fire = (side, g, t, high, name) => {
  const limit = side === "C" ? 25 : 6, list = shotsOf.get(g) || shotsOf.set(g, []).get(g);
  if (list.some((s) => Math.abs(s - t) < limit)) return null;
  list.push(t);
  const top = side === "C" ? 0.7 : 0.45, d = 3.4, P = d * 2 + 2;
  return base(g, name, r2(t), d, { effect: "field", field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period: P, crests: 0.01, direction: 1,
    points: [{ time: 0, value: 0 }, { time: 0.25 / P, value: 1 }, { time: (0.25 + top) / P, value: 1 }, { time: (0.25 + top + 2.2) / P, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
};
const sideName = { L: "left 20 m", R: "right 20 m", C: "centre 50 m" };
const free = (side, t) => POOL[side].filter((g) => !(shotsOf.get(g) || []).some((s) => Math.abs(s - t) < (side === "C" ? 25 : 6)));
const blast = (side, t, high = 100, n = 2) => {
  const ok = free(side, t);
  if (!ok.length) return null;
  const pick = [];
  for (let k = 0; k < Math.min(n, ok.length); k++) pick.push(ok[Math.floor((k * ok.length) / Math.min(n, ok.length))]);
  return pick.map((g) => fire(side, g, t, high, `${sideName[side]} air blast${pick.length > 1 ? ` ×${pick.length}` : ""}`));
};
const volley = (side, t, high = 100) => POOL[side].map((g) => fire(side, g, t, high, `${sideName[side]} circle volley · all ${POOL[side].length}`));
const spin = (side, t, step, high = 100, dir = 1) => (dir > 0 ? POOL[side] : POOL[side].slice().reverse())
  .map((g, k) => fire(side, g, r2(t + k * step), high, `${sideName[side]} spinning blast`));
const R = [];
const sec = (...list) => R.push(...list.flat().filter(Boolean));
const hitsIn = (a, b, minGap = 0) => {
  const outH = [];
  for (const h of MUSIC.hits) if (h >= a && h < b && (!outH.length || h - outH.at(-1) >= minGap)) outH.push(h);
  return outH;
};
/** The face follows the sung phrases inside [a, b). */
const voiceCurve = (g, name, a, b, high = 100) => {
  const pts = [{ time: 0, value: 0.25 }], span = b - a, at = (t) => Math.round(((t - a) / span) * 10000) / 10000;
  for (const p of MUSIC.phrases) {
    if (p[0] < a || p[1] > b) continue;
    for (const [t, v] of [[p[0] - 0.05, 0.25], [p[0] + 0.35, 1], [p[1], 0.85], [p[1] + 0.6, 0.25]]) if (at(t) > pts.at(-1).time && at(t) < 1) pts.push({ time: at(t), value: v });
  }
  pts.push({ time: 1, value: 0.25 });
  return base(g, name, a, r2(span), { effect: "curve", envelope: pts, intensity: high, sampleRate: 4, ease: 0, color: C.green });
};

// ─── the running order ──────────────────────────────────────────────────────
const S1 = 7.59, P2 = 23.0, BRK1 = 44.2, P3 = 46.0, P4 = 67.0, P5 = 90.0, P6 = 109.0, P6b = 118.0, P6c = 127.0, BRK2 = 136.0,
  P7 = 139.0, P8 = 158.0, P8b = 178.7, P9 = 199.0, P9b = 222.7, P10 = 246.0, P10b = 263.0, CANOPY = 281.0, FIN = 288.0, BRK3 = 304.0, LAST = 307.5;
// Camera windows that look from the front at audience eye level: the rainbows draw the sketch.
const FRONT = [[P2, BRK1], [268.4, CANOPY], [LAST, STOP]];

// Pattern 1 · 0 – 23 · light only: the sun, Odaa and Gadaa.
sec(drawOn("hair", "P1 · Odaa · the tree grows from its trunk", 0.4, S1 - 0.4, 5.2, 75, { order: "front-to-back", color: C.green }),
  ramp("face", "P1 · Gadaa · the Elder appears", 1.5, S1 - 1.5, 0, 65, { color: C.green }),
  field("raysLight", "P1 · the sun rises from the centre", 0.8, S1 - 0.8, travel(1, 1, 3.4, 0, 70), { order: "center-out", color: C.gold }),
  field("raysLight", "P1 · sun rays ripple out on the drum", S1, bt(15.4) - S1, travel(1, 1, BAR, 15, 100), { order: "center-out", color: C.gold }),
  together("raysLight", "P1 · the sun bursts on every beat", bt(15.4), P2 - bt(15.4), BEAT, PULSE, 100, 20, { color: C.orange }),
  field("hair", "P1 · Odaa · the tree breathes upward", S1, P2 - S1, travel(1, 1, 2 * BAR, 35, 100), { order: "front-to-back", color: C.green }),
  together("face", "P1 · Gadaa · the face glows on the bar", S1, P2 - S1, BAR, [{ time: 0, value: 1 }, { time: 0.3, value: 0.85 }, { time: 1, value: 0.5 }], 100, 25, { color: C.green }));

// Pattern 2 · 23 – 44.2 · the rainbow sketch (front camera), with all 30 cannons on the horn drop.
const rainbowSketch = (s, e, tag) => {
  const rise = 1.4;
  return [["diagOuter", 0], ["diagMid", 0.9], ["diagInner", 1.8]].flatMap(([g, delay]) => {
    const a = r2(s + delay), what = { diagOuter: "low shoulders", diagMid: "high shoulders", diagInner: "the tall arch" }[g];
    if (e - a < rise + 0.2) return [];
    return [ramp(g, `${tag} · rainbow sketch · ${what} rise`, a, rise, 0, 100), hold(g, `${tag} · rainbow sketch · ${what}`, r2(a + rise), r2(e - a - rise), 100)];
  });
};
sec(...rainbowSketch(P2, BRK1, "P2"));
sec(band("infLight", "Break · light only · a white comet round the dark ∞", BRK1, P3 - BRK1, 1.6, 100, 0, { color: C.white }));

// Pattern 3 · 46 – 67 · the 1D circle crosses, the Varios low (1 m), wide and thick, the bokku waves.
const P3b = r2(P3 + 3 * 2 * BAR);
sec(hold("pc", "P3 · 1D circle tall", P3, P4 - P3, 100),
  ...pcCross("P3 · odd and even jets swing through each other (cross)", P3, P3b - P3, 2 * BAR, 40),
  ...pcCross("P3 · the cross on every bar", P3b, P4 - P3b, BAR, 38),
  hold("ring", "P3 · Varios low: 1 m", P3, P4 - P3, r2((100 * 1) / HEIGHT.ring)),
  vcurve("ring", "P3 · Varios wide and thick, breathing on the bar", P3, P4 - P3, BAR, [[0, 1], [0.5, 0.78], [1, 1]], 0, 100, "fan_angle"),
  field("pillarL", "P3 · left bokku · waves run round the sword", P3, P3b - P3, travel(1, 2, BAR, 10, 100)),
  field("pillarR", "P3 · right bokku · waves run the other way", P3, P3b - P3, travel(-1, 2, BAR, 10, 100)),
  field("pillars", "P3 · bokku · a wave climbs hilt to tip", P3b, 60.4 - P3b, stadium(BAR, 15, 100), { order: "front-to-back" }),
  field("pillars", "P3 · bokku · waves cross on two beats", 60.4, P4 - 60.4, crossing(2 * BEAT, 10, 100), { order: "front-to-back" }));

// Pattern 4 · 67 – 90 · the ∞ alone, warm colours.
sec(pathWave("inf", "P4 · a travelling stadium wave runs round the ∞", P4, 78 - P4, 2 * BAR, 2, W_STADIUM),
  swing("infRSwing", "P4 · right lobe fans", P4, 78 - P4, cyclesFor(78 - P4, BAR), 30, 0), swing("infLSwing", "P4 · left lobe fans the other way", P4, 78 - P4, cyclesFor(78 - P4, BAR), -30, 0),
  pathWave("inf", "P4 · three pyramid waves travel the ∞", 78, P5 - 78, BAR, 3, W_PYRAMID), ...cross("P4 · X lattice", 78, P5 - 78, BAR, 32));

// Pattern 5 · 90 – 109 · the ∞ swinging waves with the 1D circle (the call-and-response spins blast).
sec(pathWave("inf", "P5 · three pyramid waves travel the ∞", P5, 99.6 - P5, 2 * BAR, 3, W_PYRAMID),
  pathWave("inf", "P5 · four pyramid waves, faster", 99.6, P6 - 99.6, BAR, 4, W_PYRAMID),
  swing("infSwing", "P5 · a swinging wave runs round the ∞", P5, 99.6 - P5, cyclesFor(99.6 - P5, BAR), 35, 1),
  swing("infSwing", "P5 · the swinging wave runs faster", 99.6, P6 - 99.6, cyclesFor(P6 - 99.6, 2 * BEAT), 26, 1),
  field("pc", "P5 · a high half travels round the circle", P5, P6 - P5, travel(1, 1, 2 * BAR, 45, 100)),
  funnel("P5 · the circle twists with the ∞ wave (spiral)", P5, 99.6 - P5, BAR, 38, 1),
  funnel("P5 · the circle spiral faster", 99.6, P6 - 99.6, 2 * BEAT, 26, 1));

// Pattern 6 · 109 – 136 · the ∞ in another wave, different kinds of lighting, the bokku moving.
sec(  pathWave("inf", "P6 · two stadium waves run backwards round the ∞", P6, P6b - P6, BAR, 2, W_STADIUM, 100, -1), ...cross("P6 · X lattice", P6, P6b - P6, BAR, 38),
  pathWave("inf", "P6 · a long stadium wave runs the ∞", P6b, P6c - P6b, BAR, 1, [[0, 0], [0.04, 1], [0.4, 1], [0.46, 0], [1, 0]]), swing("infSwing", "P6 · the swing follows the stadium wave", P6b, P6c - P6b, cyclesFor(P6c - P6b, BAR), 30, 1),
  pathWave("inf", "P6 · four pyramid waves under the weave", P6c, BRK2 - P6c, 2 * BAR, 4, W_PYRAMID), ...cross("P6 · odd and even weave along the path", P6c, BRK2 - P6c, 2 * BAR, 28, 1),
  together("pillarL", "P6 · bokku gallop · left", P6, P6b - P6, 2 * BEAT, ALT_A, 100, 15), together("pillarR", "P6 · bokku gallop · right answers", P6, P6b - P6, 2 * BEAT, ALT_B, 100, 15),
  field("pillars", "P6 · bokku · two waves cross", P6b, P6c - P6b, crossing(BAR, 15, 100), { order: "front-to-back" }),
  field("pillarL", "P6 · left bokku · three waves run round", P6c, BRK2 - P6c, travel(1, 3, BAR, 10, 100)),
  field("pillarR", "P6 · right bokku · three waves the other way", P6c, BRK2 - P6c, travel(-1, 3, BAR, 10, 100)),
  // Lighting types: a turning rainbow (every lamp its own hue), colour bands chasing, a two-colour strobe.
  rainbowLights("infLight", "P6 lights · a rainbow turns round the ∞", P6, P6b - P6, BEAT, PULSE, 2 * BAR, 100, 45),
  band("infLight", "P6 lights · red band chases", P6b, P6c - P6b, 2 * BAR, 100, 0, { color: C.red }, 0.3),
  band("infLight", "P6 lights · gold band chases", P6b, P6c - P6b, 2 * BAR, 100, 2.13, { color: C.gold }, 0.3),
  band("infLight", "P6 lights · magenta band chases", P6b, P6c - P6b, 2 * BAR, 100, 4.27, { color: C.magenta }, 0.3),
  together("infOddLight", "P6 lights · odd lamps strobe white", P6c, BRK2 - P6c, BEAT, ALT_A, 100, 10, { color: C.white }),
  together("infEvenLight", "P6 lights · even lamps answer in cyan", P6c, BRK2 - P6c, BEAT, ALT_B, 100, 10, { color: C.cyan }),
  band("infLight", "Break · light only · white comet", BRK2, P7 - BRK2, 1.6, 100, 0, { color: C.white }),
  band("pillarsLight", "Break · light only · the bokku light up hilt to tip", BRK2, P7 - BRK2, BEAT, 100, 0, { color: C.gold, order: "front-to-back" }, 0.35));

// Pattern 7 · 139 – 158 · the ∞ with Odaa and Gadaa.
sec(pathWave("inf", "P7 · a comet of water runs round the portrait", P7, 6.4, 2 * BAR, 1, W_COMET),
  pathWave("inf", "P7 · two pyramid waves travel round the ∞", r2(P7 + 6.4), P8 - P7 - 6.4, 2 * BAR, 2, W_PYRAMID),
  swing("infSwing", "P7 · the ∞ sways with the waves", r2(P7 + 6.4), P8 - P7 - 6.4, cyclesFor(P8 - P7 - 6.4, 2 * BAR), 25, 1),
  field("hair", "P7 · Odaa · the tree blooms upward every two bars", P7, 148.6 - P7, travel(1, 1, 2 * BAR, 20, 100), { order: "front-to-back", color: C.green }),
  voiceCurve("face", "P7 · Gadaa · the face sings with the voice", P7, 148.6),
  together("hair", "P7 · Odaa answers on beats 1 and 2", 148.6, P8 - 148.6, 2 * BEAT, ALT_A, 100, 25, { color: C.green }),
  together("face", "P7 · Gadaa on beats 3 and 4", 148.6, P8 - 148.6, 2 * BEAT, ALT_B, 100, 25, { color: C.green }));

// Pattern 8 · 158 – 199 · the ∞ dancing in warm colours.
sec(swing("infSwing", "P8 · the whole ∞ rows on two beats", P8, P8b - P8, cyclesFor(P8b - P8, 2 * BEAT), 28, 0),
  pathWave("inf", "P8 · two stadium waves travel on the bar", P8, P8b - P8, BAR, 2, W_STADIUM),
  pathWave("infL", "P8 · a pyramid wave round the left lobe", P8b, P9 - P8b, BAR, 1, W_PYRAMID), pathWave("infR", "P8 · the right lobe mirrors it", P8b, P9 - P8b, BAR, 1, W_PYRAMID, 100, -1),
  ...cross("P8 · a travelling cross", P8b, P9 - P8b, BAR, 32, 1));

// Pattern 9 · 199 – 246 · camera at 27°: the ∞ with Odaa and Gadaa.
sec(  ...cross("P9 · wide X lattice", P9, P9b - P9, BAR, 40), pathWave("inf", "P9 · two pyramid waves travel the ∞", P9, P9b - P9, BAR, 2, W_PYRAMID),
  pathWave("inf", "P9 · two comets of water loop the ∞", P9b, P10 - P9b, 2 * BAR, 2, W_COMET), swing("infSwing", "P9 · sweeps travel round", P9b, P10 - P9b, cyclesFor(P10 - P9b, BAR), 35, 1),
  field("hair", "P9 · Odaa · the tree swells", P9, P9b - P9, swell(2 * BEAT, 30, 100), { color: C.green }),
  voiceCurve("face", "P9 · Gadaa · the face sings", P9, P9b),
  field("hair", "P9 · Odaa · the tree climbs on every bar", P9b, P10 - P9b, travel(1, 1, BAR, 25, 100), { order: "front-to-back", color: C.green }),
  voiceCurve("face", "P9 · Gadaa · the face sings", P9b, P10));

// Pattern 10 · 246 – 304 · the sun, Gadaa, Odaa and the bokku together.
sec(  field("rays", "P10 · the sun · rays ripple out", P10, P10b - P10, travel(1, 1, BAR, 0, 100), { order: "center-out" }),
  together("rays", "P10 · the sun bursts on the beat", P10b, CANOPY - P10b, BEAT, PULSE, 100, 30),
  field("pillarL", "P10 · left bokku · waves run round", P10, P10b - P10, travel(1, 2, 2 * BAR, 10, 100)),
  field("pillarR", "P10 · right bokku · waves the other way", P10, P10b - P10, travel(-1, 2, 2 * BAR, 10, 100)),
  field("pillars", "P10 · bokku · stadium hilt to tip", P10b, CANOPY - P10b, stadium(BAR, 20, 100), { order: "front-to-back" }),
  field("hair", "P10 · Odaa · the tree climbs", P10, CANOPY - P10, travel(1, 1, 2 * BAR, 40, 100), { order: "front-to-back", color: C.green }),
  field("face", "P10 · Gadaa · the face glows", P10, CANOPY - P10, swell(2 * BAR, 45, 100), { color: C.green }),
  // Canopy
  hold("rays", "Canopy · the sun full", CANOPY, FIN - CANOPY, 100), hold("pillars", "Canopy · bokku full", CANOPY, FIN - CANOPY, 90),
  field("hair", "Canopy · Odaa blooms", CANOPY, FIN - CANOPY, travel(1, 1, BAR, 50, 100), { order: "front-to-back", color: C.green }), hold("face", "Canopy · Gadaa", CANOPY, FIN - CANOPY, 100, { color: C.green }),
  // Finale of pattern 10
  together("rays", "P10 finale · sunburst on the beat", FIN, BRK3 - FIN, BEAT, PULSE, 100, 40),
  field("pillars", "P10 finale · bokku stadium on two beats", FIN, BRK3 - FIN, stadium(2 * BEAT, 25, 100), { order: "front-to-back" }),
  together("hair", "P10 finale · Odaa on the beat", FIN, BRK3 - FIN, BEAT, PULSE, 100, 40, { color: C.green }),
  together("face", "P10 finale · Gadaa on the off-beat", FIN, BRK3 - FIN, 2 * BEAT, ALT_B, 100, 40, { color: C.green }));
sec(together("waterLights", "Break · light only · every lamp strobes on the eighths", BRK3, LAST - BRK3, BEAT / 2, STROBE, 100, 0, { color: C.white }));

// The last climb · 307.5 – 320.3 · everything.
sec(  pathWave("inf", "Last climb · three stadium waves race round the ∞", LAST, STOP - LAST, BAR, 3, W_STADIUM), ...cross("Last climb · X lattice", LAST, STOP - LAST, 2 * BEAT, 28),
  hold("pc", "Last climb · circle", LAST, STOP - LAST, 100), funnel("Last climb · the circle spiral", LAST, STOP - LAST, BAR, 40, 1),
  hold("ring", "Last climb · Varios tall", LAST, STOP - LAST, 100), vfan("ring", "Last climb · Varios bloom on the bar", LAST, STOP - LAST, BAR, F_BLOOM, 0, 50),
  together("rays", "Last climb · sunburst", LAST, STOP - LAST, BEAT, PULSE, 100, 50),
  field("pillars", "Last climb · bokku", LAST, STOP - LAST, swell(2 * BEAT, 60, 100)),
  hold("hair", "Last climb · Odaa", LAST, STOP - LAST, 100, { color: C.green }), hold("face", "Last climb · Gadaa", LAST, STOP - LAST, 100, { color: C.green }),
  hold("star", "Last climb · the star", LAST, STOP - LAST, 100, { color: C.green }));
// Air blasts: never one cannon alone. Every blast fires both 20 m circles together (all 20 cannons);
// on the big moments the 50 m circle joins, so all 30 fire as one. Two bars apart at least
// (20 m refill 6 s); the 50 m circle only where it has refilled (25 s).
const allBlast = (t, withCentre = false) => [...volley("L", t), ...volley("R", t), ...(withCentre ? volley("C", t) : [])];
const BIG = [P2, 48.6, 74.2, P6, 134.6, 160.2, P9, P10, CANOPY, 313.9];   // the 50 m circle joins (all 30), >= 25 s apart
const BLAST_AT = [P2, 29.4, 35.8, 42.2, 48.6, 74.2, P5, 96.4, 102.8, P6, 115.4, 121.8, 134.6, 160.2,
  P9, 205.4, 211.8, 218.2, 224.6, 231.0, 237.4, P10, 262.0, 268.4, 274.8, CANOPY, 288.6, 295.0, 301.4, LAST, 313.9, 320.0];
for (const t of BLAST_AT) {
  const shots = allBlast(t, BIG.includes(t)).filter(Boolean), want = BIG.includes(t) ? 30 : 20;
  if (shots.length !== want) throw new Error(`blast at ${t} s fires ${shots.length} of ${want} cannons (refill)`);
  sec(shots);
}
// After the hard stop: the portrait fades, the star last.
sec(ramp("face", "After the stop · Gadaa fades", STOP, END - STOP - 0.3, 100, 0, { color: C.green }),
  ramp("hair", "After the stop · Odaa fades", STOP, END - STOP - 0.6, 100, 0, { color: C.green }),
  ramp("star", "After the stop · the star fades last", STOP, END - STOP, 100, 0, { color: C.green }));
// Front camera → the rainbow sketch (pattern 2 already has it).
for (const [a, b] of FRONT.slice(1)) sec(...rainbowSketch(a, b, "Front view"));
// The Vario cone holds a thin column wherever nothing else sets it.
{
  const covered = R.filter((r) => /^ring/.test(r.groupId) && r.attribute === "fan_angle").map((r) => [r.start, r.start + r.duration]).sort((a, b) => a[0] - b[0]);
  let at = 0;
  for (const [a, b] of covered) { if (a - at > 0.1) R.push(vhold("ring", "Vario · thin column (rest)", r2(at), r2(a - at), 3)); at = Math.max(at, b); }
  if (END - at > 0.1) R.push(vhold("ring", "Vario · thin column (rest)", r2(at), r2(END - at), 3));
}
// Circle and Vario lamps: a turning rainbow while their water runs.
for (const [g, a, b, period, pts, turn] of [["pcLight", P3, P4, BAR, PULSE, 2 * BAR], ["ringLight", P3, P4, BAR, STEADY, 4 * BAR],
  ["pcLight", P5, P6, BEAT, PULSE, 2 * BAR], ["pcLight", LAST, STOP, BEAT, PULSE, 2 * BEAT], ["ringLight", LAST, STOP, BEAT, PULSE, 2 * BEAT]])
  sec(rainbowLights(g, `${g === "pcLight" ? "Circle" : "Vario"} lights · a rainbow turns round`, a, b - a, period, pts, turn, 100, 35));

// ─── lamps that follow their water ──────────────────────────────────────────
const PCC = { x: PC.reduce((a, f) => a + f.x, 0) / PC.length, y: PC.reduce((a, f) => a + f.y, 0) / PC.length };
const P = (all, extra = {}) => ({ all, ...extra });
const PALETTE = [
  [0, P([C.gold])],
  [P3, P([C.cyan, C.blue, C.purple, C.magenta])],
  [P4, P(WARM)],
  [P5, P([C.cyan, C.blue, C.purple, C.magenta, C.white])],
  [P6, P([C.gold], { pillarL: [C.green, C.gold, C.cyan], pillarR: [C.green, C.gold, C.cyan] })],
  [P7, P([C.green, C.gold, C.warm])],
  [P8, P(WARM)],
  [P9, P([C.gold, C.green, C.cyan, C.white])],
  [P10, P([C.gold], { rays: [C.gold, C.orange, C.amber, C.red], pillarL: [C.cyan, C.magenta, C.purple, C.blue], pillarR: [C.cyan, C.magenta, C.purple, C.blue] })],
  [CANOPY, P([C.gold], { rays: [C.gold, C.amber], pillarL: [C.green, C.gold], pillarR: [C.green, C.gold] })],
  [FIN, P([C.gold], { rays: [C.gold, C.orange, C.red, C.magenta], pillarL: [C.white, C.cyan, C.magenta, C.gold], pillarR: [C.white, C.cyan, C.magenta, C.gold] })],
  [LAST, P([C.gold, C.red, C.magenta, C.cyan, C.green, C.orange])]];
const DIAG_PAL = [C.cyan, C.magenta, C.gold];                 // outer, middle, inner pair (turning on the bar)
const RAINBOW = [C.red, C.orange, C.gold, C.green, C.cyan, C.purple];
const family = new Map(), slot = new Map();
INF.forEach((f, i) => { family.set(f.id, i < 120 ? "infR" : "infL"); slot.set(f.id, Math.floor(i / 8)); });
for (const [list, fam] of [[PC, "pc"], [RING, "ring"], [RAYS, "rays"], [PL, "pillarL"], [PR, "pillarR"], [CMP, "air"]]) list.forEach((f) => family.set(f.id, fam));
RAYS.forEach((f) => slot.set(f.id, Math.round(((Math.atan2(f.y - PCC.y, f.x - PCC.x) + Math.PI) / (2 * Math.PI)) * 22) % 22));
PL.forEach((f, i) => slot.set(f.id, Math.floor(i / 16))); PR.forEach((f, i) => slot.set(f.id, Math.floor(i / 16) + 1));
DIAG_X.forEach((f, i) => { family.set(f.id, "diag"); slot.set(f.id, Math.min(i, 5 - i)); });
[A20L, A20R, A50].forEach((list) => list.forEach((f, i) => slot.set(f.id, i)));
// Colours turning on the music: [from, to, families, bars per step].
const CYCLES = [[P4, P5, ["infR", "infL"], 1], [P8, P9, ["infR", "infL"], 1], [P10, BRK3, ["rays"], 1], [LAST, STOP, ["infR", "infL", "rays", "pillarL", "pillarR"], 1],
  ...FRONT.map(([a, b]) => [a, b, ["diag"], 1])];
const colourAt = (t, fam, k = 0) => {
  let shift = 0;
  for (const [a, b, fams, bars] of CYCLES) if (t >= a && t < b && fams.includes(fam)) shift = Math.floor((t - a) / (bars * BAR));
  if (fam === "air") return RAINBOW[k % RAINBOW.length];
  if (fam === "diag") return DIAG_PAL[(k + shift) % DIAG_PAL.length];
  let p = PALETTE[0][1]; for (const [s0, v] of PALETTE) if (t >= s0 - 0.01) p = v;
  const pal = p[fam] || p.all;
  return pal[(k + shift) % pal.length];
};
const items = inventory(fixtures);
const STEP = 0.1, NS = Math.ceil(END / STEP) + 1;
const waterRecipes = R.filter((r) => r.duration > 0 && !/Light$|^face$|^hair$|^star$/.test(r.groupId) && r.groupId !== "waterLights");
const waterClips = compileStudio({ ...readStudio({}), groups: G, recipes: waterRecipes, tempo: [{ time: 0, bpm: BPM }] }, items).clips;
const nozzles = new Map(fixtures.filter((f) => family.has(f.id)).map((f) => [f.id, f]));
const levelAt = (c, t) => {
  if (!c.keys) return Number(c.value) || 0;
  const k = c.keys;
  if (t <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) if (t <= k[i]) return k[i - 1] + ((k[i + 1] - k[i - 1]) * (t - k[i - 2])) / Math.max(1e-6, k[i] - k[i - 2]);
  return k[k.length - 1];
};
const waterLevel = new Map();
for (const c of waterClips) {
  if (!nozzles.has(c.fixtureId) || /motion_(angle|pan|tilt|roll|position)|solenoid|enable|fan_angle/.test(c.type)) continue;
  const arr = waterLevel.get(c.fixtureId) || waterLevel.set(c.fixtureId, new Float32Array(NS)).get(c.fixtureId);
  for (let i = Math.max(0, Math.floor(c.startTime / STEP)); i < NS && i * STEP <= c.startTime + c.duration; i++) {
    const v = levelAt(c, i * STEP - c.startTime) / 100;
    if (v > arr[i]) arr[i] = v;
  }
}
// Windows where an explicit light pattern owns the lamps.
const WINDOWS = [[BRK1, P3, ["infLight"]], [P6, BRK2, ["infLight"]], [BRK2, P7, ["infLight", "pillarsLight"]], [BRK3, LAST, ["waterLights"]]];
const inWindow = new Map();
for (const [s, e, gs] of WINDOWS) for (const g of gs) for (const id of G.find((x) => x.id === g).memberFixtureIds) (inWindow.get(id) || inWindow.set(id, []).get(id)).push([s, e]);
const COLOURS = Object.values(C);
const signature = new Map();
for (const [nid, noz] of nozzles) {
  const lamp = lampOf.get(nid), w = waterLevel.get(nid);
  if (!lamp || !w) continue;
  const fam = family.get(nid), H = Number(noz.engineering?.jetHeightM) || 4, k = slot.get(nid) || 0;
  if (fam === "ring" || fam === "pc") continue;
  const tail = Math.round((2 * Math.sqrt((2 * H) / 9.81)) / STEP);
  const code = new Int32Array(NS);
  let last = -1e9;
  for (let i = 0; i < NS; i++) {
    if (w[i] > 0.03) last = i;
    if (i - last <= tail) code[i] = 100 * 100 + COLOURS.indexOf(colourAt(i * STEP, fam, k)) + 1;
  }
  for (const [s, e] of inWindow.get(lamp) || []) for (let i = Math.floor(s / STEP); i < Math.min(NS, Math.ceil(e / STEP)); i++) code[i] = 0;
  const segs = [];
  for (let i = 0; i < NS;) {
    let j = i;
    while (j < NS && code[j] === code[i]) j++;
    if (code[i]) segs.push([r2(Math.floor(i * STEP * 2) / 2), r2(Math.min(END, Math.ceil(j * STEP * 2) / 2)), code[i]]);
    i = j;
  }
  for (let q = segs.length - 1; q > 0; q--) {
    if (segs[q][0] - segs[q - 1][1] < 1.5 && segs[q][2] === segs[q - 1][2]) { segs[q - 1][1] = segs[q][1]; segs.splice(q, 1); }
    else if (segs[q][0] < segs[q - 1][1]) segs[q][0] = segs[q - 1][1];
  }
  for (let q = segs.length - 1; q >= 0; q--) if (segs[q][1] - segs[q][0] < 0.05) segs.splice(q, 1);
  const key = JSON.stringify(segs);
  (signature.get(key) || signature.set(key, { segs, lamps: [], fam }).get(key)).lamps.push(lamp);
}
let follow = 0;
for (const { segs, lamps, fam } of signature.values()) {
  const gid = group(`lit${++follow}`, `Lit with its water · ${fam} (${lamps.length})`, lamps.map((id) => ({ id })));
  for (const [s, e, code] of segs) R.push(hold(gid, fam === "air" ? "Cannon lamps blast" : "Lamps follow their water", s, e - s, Math.floor(code / 100),
    { color: COLOURS[(code % 100) - 1] }));
}

const recipes = R.filter((r) => r && r.groupId && r.duration > 0);
const markers = [[0, "Pattern 1 · light only: the sun, Odaa, Gadaa"], [P2, "Pattern 2 · the rainbow sketch (front) · all 30 blasts"], [BRK1, "Break"],
  [P3, "Pattern 3 · 1D circle cross · Varios 1 m · bokku waves"], [P4, "Pattern 4 · the ∞ in warm colours"], [P5, "Pattern 5 · ∞ swinging waves with the 1D circle"],
  [P6, "Pattern 6 · ∞ wave, light types, bokku"], [BRK2, "Break · light only"], [P7, "Pattern 7 · ∞ with Odaa and Gadaa"], [P8, "Pattern 8 · the ∞ dancing warm"],
  [P9, "Pattern 9 · camera 27° · ∞ with Odaa and Gadaa"], [P10, "Pattern 10 · the sun, Gadaa, Odaa, bokku"], [CANOPY, "Canopy"], [FIN, "Pattern 10 finale"],
  [BRK3, "Break · strobe"], [LAST, "Last climb · everything"], [STOP, "Hard stop"]]
  .map(([time, name], i) => ({ id: `m${i + 1}`, name, label: name, time, kind: "section", color: "#33e07a" }));

// ─── compile + checks ───────────────────────────────────────────────────────
const studio = { ...readStudio({}), groups: G, recipes, tempo: [{ time: 0, bpm: r2(BPM) }], markers, layout: {} };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) { console.log("issues:", issues.slice(0, 12)); throw new Error("compile issues"); }
const shotTimes = new Map();
for (const c of clips) {
  if (!/^air-/.test(c.fixtureId) || /light/i.test(c.fixtureId) || !c.keys) continue;
  for (let k = 1; k < c.keys.length; k += 2) if (c.keys[k] >= 50 && (k < 2 || c.keys[k - 2] < 50)) (shotTimes.get(c.fixtureId) || shotTimes.set(c.fixtureId, []).get(c.fixtureId)).push(c.startTime + c.keys[k - 1]);
}
let refill = 0, blasts = 0;
for (const [id, list] of shotTimes) { list.sort((a, b) => a - b); blasts += list.length; for (let i = 1; i < list.length; i++) if (list[i] - list[i - 1] < (/50m/.test(id) ? 25 : 6) - 0.01) refill++; }
let worst = 0, worstAt = "";
for (const c of clips) {
  if (c.type !== "motion_angle" || !c.keys) continue;
  for (let k = 2; k < c.keys.length; k += 2) {
    const dt = c.keys[k] - c.keys[k - 2];
    if (dt <= 0) continue;
    const rate = (0.9 * Math.abs(c.keys[k + 1] - c.keys[k - 1])) / dt;
    if (rate > worst) { worst = rate; worstAt = `${c.name} @ ${r2(c.startTime + c.keys[k])} s`; }
  }
}
console.log("fastest swing", Math.round(worst), "°/s", worstAt, "· air blasts", blasts, "· refill violations", refill);
if (worst > 88 * 1.05) throw new Error(`swing faster than the 88°/s drive: ${Math.round(worst)}°/s (${worstAt})`);
if (refill) throw new Error(`${refill} air cannon refill violations`);
console.log("design", census, "groups", G.length, "patterns", recipes.length, "clips", clips.length);

// ─── write the project ──────────────────────────────────────────────────────
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#33e07a", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
const name = "Odaa & Gadaa · 3Obsa — ten patterns";
const now = new Date().toISOString();
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioDuration: END, patternDefinitions: [{ id: "odaa-3obsa-ten-patterns", name, duration: END }] };
proj.show = { ...proj.show, id: "aquaflow-odaa-3obsa-ten-patterns", name, bpm: r2(BPM), duration: END, loop: false };
proj.project = { ...proj.project, name, modifiedAt: now };
// Cameras: world x = plan x − centre, z = plan y − centre. Front shots stand on the rainbow axis
// (x 33.86) at eye level, far enough back to hold all six arcs.
const { cx, cy } = poolCenter(proj.engineering.geometry, proj.engineering.params, proj.engineering.pool_type);
const W = (x, y, h) => ({ x: r2(x - cx), y: h, z: r2(y - cy) });
const AX = r2((DIAG_X[0].x + DIAG_X[5].x) / 2);
const cameraKeys = [];
const camShot = (t0, t1, frames) => frames.forEach(([pos, tgt, fov], i) => {
  const t = r2(t0 + ((t1 - t0 - 0.04) * i) / Math.max(1, frames.length - 1));
  cameraKeys.push({ id: `cam-${cameraKeys.length + 1}`, t, position: pos, target: tgt, fov, roll: 0, ease: i === frames.length - 1 && t1 < END ? "cut" : "smooth" });
});
// Pattern 9: 27° above the horizon, orbiting across the front.
const at27 = (deg, D = 44) => { const a = (deg * Math.PI) / 180; return [W(35 + D * Math.sin(a), 13 - D * Math.cos(a), r2(D * Math.tan((27 * Math.PI) / 180))), W(35, 13, 0), 50]; };
// The shot list, as a camera operator would plan it: every shot is built around what that pattern
// shows, the cuts land on the bars, a 50 m blast always gets a wide frame that holds its full height,
// and the eye-level front axis is used only while the rainbows draw the sketch.
//   · floor light (the sun, Odaa, Gadaa) reads from above, so those shots are high and look down;
//   · the ∞ waves read as travelling shapes, so they are shot high and wide or tracked from the side;
//   · the 1D circle and the Varios are shot low and close, at the height of the water;
//   · the bokku run front to back, so they are shot from three-quarter angles, never head-on.
const BLAST_WIDE = (x0, x1) => [[W(x0, -26, 4), W(35, 13, 21), 60], [W(x1, -32, 6), W(35, 13, 22), 60]];   // full 50 m in frame
// Pattern 1 · light only: a slow descent onto the portrait, the sun opening out, then a drift across it.
camShot(0, S1, [[W(35, 14.2, 52), W(35, 14, 0), 48], [W(35, 9, 36), W(35, 14, 0), 48]]);                         // straight down: the sun, Odaa, Gadaa as one mandala
camShot(S1, bt(15.4), [[W(35, -3, 20), W(35, 14, 0), 50], [W(35, 1, 14), W(35, 14.5, 0), 48]]);                 // tilt down and push in as the rays ripple
camShot(bt(15.4), P2, [[W(52, 2, 16), W(35, 14, 0), 50], [W(47, -2, 12), W(35, 14, 0), 50]]);                   // three-quarter drift on the sunbursts
// Pattern 2 · the rainbow sketch, front axis only: a wide frame for the all-30 blast, a push in on the
// sketch, then a low crane rising.
camShot(P2, 29.4, [[W(AX, -54, 5), W(AX, 8, 17), 48], [W(AX, -47, 5), W(AX, 8, 14), 46]]);
camShot(29.4, 37.0, [[W(AX, -42, 5), W(AX, 8, 11), 40], [W(AX, -33, 5), W(AX, 8, 11), 40]]);
camShot(37.0, BRK1, [[W(AX, -27, 3.5), W(AX, 8, 12), 48], [W(AX, -31, 9), W(AX, 8, 12), 46]]);
camShot(BRK1, P3, [[W(35, 13.6, 48), W(35, 13, 0), 55], [W(35, 13.4, 44), W(35, 13, 0), 55]]);                   // the break from above: the white comet
// Pattern 3 · the circle crossing (low, beside it), all 30 at 0:48 (wide), the low Varios (a glide at
// their height), then each bokku from three-quarters.
camShot(P3, 48.6, [[W(27, -1, 4), W(35, 14, 7), 52], [W(28, 0, 4), W(35, 14, 7), 52]]);
camShot(48.6, 52.4, BLAST_WIDE(62, 64));
camShot(52.4, 58.8, [[W(21, 3, 3), W(35, 12, 1.5), 56], [W(49, 3, 3), W(35, 12, 1.5), 56]]);                    // along the Varios at 3 m, the crossing circle behind
camShot(58.8, 62.0, [[W(3, -6, 12), W(20, 12, 3), 55], [W(7, -9, 10), W(21, 12, 3), 55]]);                       // left bokku, three-quarter
camShot(62.0, P4, [[W(67, -6, 12), W(50, 12, 3), 55], [W(63, -9, 10), W(49, 12, 3), 55]]);                       // right bokku answers
// Pattern 4 · the ∞ alone: high enough to read the travelling waves as shapes, the all-30 blast wide,
// then a tracking shot along the front with the pyramid waves.
camShot(P4, 74.2, [[W(10, -10, 30), W(35, 13, 0), 54], [W(26, -14, 27), W(35, 13, 0), 54]]);
camShot(74.2, 78.0, BLAST_WIDE(60, 63));
camShot(78.0, P5, [[W(10, -9, 6), W(24, 12, 3), 56], [W(60, -9, 6), W(46, 12, 3), 56]]);
// Pattern 5 · the ∞ swinging waves with the circle: cut side to side on the blasts, then over the spiral.
camShot(P5, 96.4, [[W(8, -7, 8), W(30, 13, 5), 55], [W(12, -9, 8), W(31, 13, 5), 55]]);
camShot(96.4, 102.8, [[W(62, -7, 8), W(40, 13, 5), 55], [W(58, -9, 8), W(39, 13, 5), 55]]);
camShot(102.8, P6, [[W(35, -1, 22), W(35, 14, 3), 55], [W(45, 4, 19), W(35, 14, 3), 55]]);
// Pattern 6 · up from the water into the all-30 blast, a wide sweep with the rainbow ∞ and the bokku,
// the strobe weave from straight above, then the 2:14 blast wide.
camShot(P6, 115.4, [[W(30, -7, 3), W(35, 13, 24), 72], [W(26, -12, 5), W(35, 13, 16), 64]]);
camShot(115.4, P6c, [[W(4, -16, 18), W(35, 12, 2), 52], [W(66, -16, 18), W(35, 12, 2), 52]]);
camShot(P6c, 134.6, [[W(35, 14, 44), W(35, 13, 0), 55], [W(42, 8, 38), W(35, 13, 0), 55]]);
camShot(134.6, P7, BLAST_WIDE(8, 6));
// Pattern 7 · Odaa and Gadaa are floor light: high over the portrait, closer on the face as it sings,
// then rising away as the two answer each other.
camShot(P7, 145.4, [[W(35, -6, 26), W(35, 14, 0), 52], [W(35, -1, 24), W(35, 14, 0), 52]]);
camShot(145.4, 151.8, [[W(35, 4, 17), W(35, 15, 0), 46], [W(38, 6, 14), W(35, 15, 0), 46]]);
camShot(151.8, P8, [[W(44, 2, 18), W(35, 14, 0), 52], [W(48, -4, 24), W(35, 14, 0), 52]]);
// Pattern 8 · the warm ∞: a short lead-in, the all-30 blast wide, round each lobe, then a high finish.
camShot(P8, 160.2, [[W(20, -10, 10), W(35, 12, 3), 55], [W(22, -11, 10), W(35, 12, 3), 55]]);
camShot(160.2, 166.6, BLAST_WIDE(10, 8));
camShot(166.6, P8b, [[W(72, 6, 9), W(48, 12, 3), 55], [W(62, -12, 7), W(42, 12, 3), 55]]);
camShot(P8b, 188.3, [[W(-2, 6, 9), W(22, 12, 3), 55], [W(8, -12, 7), W(28, 12, 3), 55]]);
camShot(188.3, P9, [[W(14, -14, 24), W(35, 13, 0), 54], [W(56, -14, 20), W(35, 13, 0), 54]]);
// Pattern 9 · 27° throughout (the client's angle): a wide orbit, then a closer one the other way.
camShot(P9, P9b, [-35, -20, -5, 10].map((d) => at27(d, 46)));
camShot(P9b, P10, [25, 12, 0, -12, -25].map((d) => at27(d, 36)));
// Pattern 10 · the all-30 blast wide, high over the sun, Odaa and Gadaa, the sketch from the front,
// down onto the canopy, then each bokku from three-quarters with the sun beyond.
camShot(P10, 252.4, BLAST_WIDE(62, 64));
camShot(252.4, 268.4, [[W(35, -6, 30), W(35, 14, 0), 52], [W(35, 3, 24), W(35, 14, 0), 52]]);
camShot(268.4, CANOPY, [[W(AX, -40, 5), W(AX, 8, 11), 40], [W(AX, -31, 5), W(AX, 8, 11), 40]]);
camShot(CANOPY, FIN, [[W(30, -16, 8), W(35, 13, 18), 60], [W(35, 2, 14), W(35, 14, 0), 55]]);
camShot(FIN, 296.0, [[W(4, -9, 10), W(28, 12, 3), 55], [W(10, -13, 9), W(30, 12, 3), 55]]);
camShot(296.0, BRK3, [[W(66, -9, 10), W(42, 12, 3), 55], [W(60, -13, 9), W(40, 12, 3), 55]]);
camShot(BRK3, LAST, [[W(35, 13.6, 55), W(35, 13, 0), 55], [W(35, 13.6, 50), W(35, 13, 0), 55]]);                  // the strobe from above
// Last climb · front axis: push in on the sketch, then pull back wide so the final all-30 blast shows whole.
camShot(LAST, 313.9, [[W(AX, -36, 5), W(AX, 8, 11), 42], [W(AX, -31, 5), W(AX, 8, 11), 42]]);
camShot(313.9, STOP, [[W(AX, -46, 5), W(AX, 8, 16), 46], [W(AX, -64, 7), W(AX, 8, 21), 48]]);
camShot(STOP, END, [[W(AX, -30, 6), W(AX, 10, 6), 45], [W(35, -6, 26), W(35, 14, 0), 52]]);                       // rise over the portrait
if (cameraKeys.some((k) => k.position.y < 3)) throw new Error("camera key below 3 m");
proj.render = { ...proj.render, environment: "night", cameraMode: "animated", activeCameraView: null, studioLook: true, studioMist: false,
  cameraTrack: { enabled: true, keys: cameraKeys },
  cameraViews: [
    { id: "front", name: "Front · the rainbow sketch", position: W(AX, -36, 5), target: W(AX, 8, 11), fov: 40 },
    { id: "deg27", name: "27° · the ∞", position: at27(0)[0], target: W(35, 13, 0), fov: 50 },
    { id: "top", name: "Top · the portrait", position: W(35, 13.6, 60), target: W(35, 13, 0), fov: 50 },
  ] };
proj.savedAt = now;
const entries = [{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest || {}, null, 2) }];
for (const [k, v] of zip) if (k.startsWith("assets/")) entries.push({ name: k, data: v });
entries.push({ name: "design-notes.txt", data: [
  name, "",
  "Same site as Odaa_3Obsa_Show (10 cannons per circle). Heights raised to sit with the blasts: ∞ 9 m, circle 14 m, Vario 12 m, rays 7 m, bokku 8 m.",
  `Rainbow sketch (front view): ${ARCS.map((a) => `${a.id} ${a.x}→${a.lands} m, apex ${a.apex} m, ${a.tiltFromVertical}° from vertical, ${a.jetHeightM} m jet`).join("; ")}.`,
  `Song: Yosan Getahun - 3Obsa, ${END} s, ${r2(BPM)} BPM. Air: ${blasts} blasts, refill rules kept. Fastest 1D swing ${Math.round(worst)} deg/s.`,
  `${recipes.length} editable patterns, ${clips.length} clips. Simulated concept, not commissioned hardware.`].join("\n") });
fs.writeFileSync(out, createZip(entries));
console.log(`→ ${out} · ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
