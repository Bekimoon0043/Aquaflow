// Odaa & Elder · 3Obsa — a music-programmed water, light and air-blast show on the existing design.
//   vite-node --root . scripts/build-odaa-3obsa.mjs <design.aquapkg (with the song)> <out.aquapkg>
//
// Takes ONLY the fountain design from the source package (engineering: basin, the 1,816 fixtures,
// their groups and settings) and the embedded song; every pattern, light cue and camera is new.
//
// The design (DWG-derived, 70 × 25 m D-shaped basin, audience on the straight front edge):
//   · ∞ infinity: 240 1D swing nozzles (4.5 m) on one path — nozzle 1 at the centre crossing,
//     1–120 round the right lobe, 121–240 round the left lobe; each swings along the path;
//   · a 22-nozzle 1D circle (5.5 m jets, r 5.5 m) round the portrait, swinging in (dome) and out;
//   · a 22-jet Vario solenoid ring (7 m, r 10.3 m) that can pop up to 20 × a second;
//   · 130 straight "rays" (3 m): 22 sun-ray chevrons round the portrait;
//   · two sword-shaped pillars of 128 straight jets inside the lobes; 6 diagonal jets at the front;
//   · air cannons: 5 × 20 m in a circle in each lobe, 5 × 50 m at the centre;
//   · 691 RGB lights under the nozzles, and 434 light-only fixtures drawing the Elder's face, the
//     Odaa tree (hair) and a star on the pool floor (kept green, as approved).
// Song: Yosan Getahun – 3Obsa (YouTube 8zlm6JVbi2U, embedded in the package), 328.14 s, about
// 75 BPM (beat 0.80 s, bar 3.2 s); music 7.59–320.3 s, then a hard stop. Map in
// scripts/data/odaa-3obsa-music.json (beats, energy, hits, sung phrases), measured from the audio.
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { poolCenter } from "/src/engineering/geometryContract.js";

const [srcPath, out] = process.argv.slice(2);
if (!srcPath || !out) { console.error("usage: vite-node --root . scripts/build-odaa-3obsa.mjs <design.aquapkg> <out.aquapkg>"); process.exit(1); }
const zip = readZip(fs.readFileSync(srcPath));
const proj = JSON.parse(zipText(zip.get("project.aqua")));
const MUSIC = JSON.parse(fs.readFileSync("scripts/data/odaa-3obsa-music.json", "utf8"));
const r2 = (v) => Math.round(v * 100) / 100;
const END = r2(MUSIC.duration);
const BPM = MUSIC.bpm, BEAT = 60 / BPM, BAR = 4 * BEAT, BEAT0 = MUSIC.beat0;
const STOP = 320.3;                                     // the song's hard stop
const bt = (t) => r2(BEAT0 + Math.round((t - BEAT0) / BEAT) * BEAT);   // nearest beat

// ─── the design (unchanged) ─────────────────────────────────────────────────
const fixtures = proj.engineering.fixtures;
const byGroup = (g) => fixtures.filter((f) => f.groupId === g && !String(f.type).startsWith("light"));
const INF = byGroup("infinity"), PC = byGroup("portraitCircle"), RING = byGroup("outerRing"), RAYS = byGroup("rays");
const PL = byGroup("pillar-left"), PR = byGroup("pillar-right"), DIAG = byGroup("diagonalRainbow");
const CMP = byGroup("compressors");
const A20L = CMP.filter((f) => /20m-left/.test(f.id)), A20R = CMP.filter((f) => /20m-right/.test(f.id)), A50 = CMP.filter((f) => /50m-center/.test(f.id));
const LAMPS = fixtures.filter((f) => String(f.type).startsWith("light"));
const lampOf = new Map(LAMPS.filter((l) => l.engineering?.pairedNozzleId).map((l) => [l.engineering.pairedNozzleId, l.id]));
const portrait = (g) => LAMPS.filter((l) => l.groupId === g).map((l) => l.id);
// Details read from the client's reference renders of this design (Downloads/qXsjNI.mp4, BgQpGF.mp4):
//   · the Vario ring heads throw mushroom bells (~2.5 m), not straight jets;
//   · the portrait circle's 1D jets are tall (they open into a wide crown and close into a funnel
//     meeting above the portrait);
//   · the six diagonal "rainbow" nozzles shoot long arcs from the front row that cross over the
//     centre (the outer pair highest, the inner pair lowest).
const CENTRE = { x: 35.06, y: 13.2 };
for (const f of RING) f.engineering = { ...f.engineering, nozzleStyle: "mushroom bell (Vario)", jetHeightM: 2.6 };
for (const f of PC) f.engineering = { ...f.engineering, jetHeightM: 9 };
/** Jet height (vertical equivalent) that lands a 45° arc just past the centre, with air drag. */
const arcHeight = (dist) => {
  const reach = (H) => { const v = Math.sqrt(2 * 9.81 * H), vy = v * Math.SQRT1_2, T = (vy + Math.sqrt(vy * vy + 2 * 9.81 * 0.15)) / 9.81;
    return v * Math.SQRT1_2 * (1 - Math.exp(-0.35 * T)) / 0.35; };
  let lo = 0.5, hi = 120;
  for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (reach(mid) < dist + 1.2) lo = mid; else hi = mid; }
  return r2(lo);
};
for (const f of DIAG) {
  const dx = CENTRE.x - f.x, dy = CENTRE.y - f.y;
  f.rotation = r2((Math.atan2(dy, dx) * 180) / Math.PI);
  f.engineering = { ...f.engineering, aimTiltDeg: 45, jetHeightM: arcHeight(Math.hypot(dx, dy)) };
}
const census = { infinity: INF.length, circle1D: PC.length, vario: RING.length, rays: RAYS.length, pillars: PL.length + PR.length, diagonal: DIAG.length,
  air20: A20L.length + A20R.length, air50: A50.length, lights: LAMPS.length };
if (INF.length !== 240 || PC.length !== 22 || RING.length !== 22 || RAYS.length !== 130 || A50.length !== 5 || A20L.length !== 5 || A20R.length !== 5)
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
group("pc", "Portrait circle · 22 1D", PC);
group("pcSwing", "Portrait circle · swing", PC);
group("pcOddSwing", "Portrait circle odd · swing", odd(PC));
group("pcEvenSwing", "Portrait circle even · swing", even(PC));
group("ring", "Vario ring · 22", RING);
group("rays", "Sun rays · 130", RAYS);
group("pillarL", "Left pillar · 128", PL);
group("pillarR", "Right pillar · 128", PR);
group("pillars", "Both pillars", [...PL, ...PR]);
group("pillarsBeat", "Both pillars · every second jet (beat stabs)", [...odd(PL), ...odd(PR)]);
group("diag", "Front diagonal rainbow jets · 6", DIAG);
const DIAG_X = DIAG.slice().sort((a, b) => a.x - b.x);
group("diagOuter", "Diagonal rainbows · outer pair", [DIAG_X[0], DIAG_X[5]]);
group("diagMid", "Diagonal rainbows · middle pair", [DIAG_X[1], DIAG_X[4]]);
group("diagInner", "Diagonal rainbows · inner pair", [DIAG_X[2], DIAG_X[3]]);
const PCC = { x: PC.reduce((a, f) => a + f.x, 0) / PC.length, y: PC.reduce((a, f) => a + f.y, 0) / PC.length };
group("pcFrontSwing", "Portrait circle · front half (swing)", PC.filter((f) => f.y < PCC.y));
group("pcBackSwing", "Portrait circle · back half (swing)", PC.filter((f) => f.y >= PCC.y));
group("pcLeftSwing", "Portrait circle · left half (swing)", PC.filter((f) => f.x < PCC.x));
group("pcRightSwing", "Portrait circle · right half (swing)", PC.filter((f) => f.x >= PCC.x));
const RC = { x: RING.reduce((a, f) => a + f.x, 0) / RING.length };
group("ringL", "Vario ring · left half", RING.filter((f) => f.x < RC.x));
group("ringR", "Vario ring · right half", RING.filter((f) => f.x >= RC.x));
group("ringOdd", "Vario ring · odd", odd(RING));
group("ringEven", "Vario ring · even", even(RING));
A20L.forEach((f, i) => group(`a20L${i + 1}`, `Left 20 m air cannon ${i + 1}`, [f]));
A20R.forEach((f, i) => group(`a20R${i + 1}`, `Right 20 m air cannon ${i + 1}`, [f]));
A50.forEach((f, i) => group(`a50${i + 1}`, `Centre 50 m air cannon ${i + 1}`, [f]));
const lampsOf = (list) => list.map((f) => lampOf.get(f.id)).filter(Boolean);
group("infLight", "∞ lights", lampsOf(INF));
group("infRLight", "∞ right lobe lights", lampsOf(INF.slice(0, 120)));
group("infLLight", "∞ left lobe lights", lampsOf(INF.slice(120)));
group("ringLight", "Vario ring lights", lampsOf(RING));
group("pillarsLight", "Pillar lights", lampsOf([...PL, ...PR]));
group("raysLight", "Sun ray lights", lampsOf(RAYS));
group("waterLights", "All lights under water", lampsOf([...INF, ...PC, ...RING, ...RAYS, ...PL, ...PR, ...DIAG, ...CMP]));
group("face", "Portrait · the Elder's face (green)", portrait("faceLight"), "#33e07a");
group("hair", "Portrait · the Odaa tree (green)", portrait("hairLight"), "#33e07a");
group("star", "Portrait · star (green)", portrait("starLight"), "#33e07a");

// ─── pattern helpers (all editable in Show Programming) ────────────────────
const C = { gold: "#ffc44d", warm: "#ffd9a6", green: "#33e07a", red: "#ff3b30", blue: "#3d7bff", cyan: "#38d6ff", magenta: "#ff4fb8",
  white: "#f4f8ff", purple: "#9b5cff", orange: "#ff8a1f" };
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
/** The water draws itself along the group (path order) over `sweep` s, then holds. */
const drawOn = (g, name, s, d, sweep, high, extra = {}, rise = 0.8) => {
  const P = d * 2 + 2;
  return base(g, name, s, d, { effect: "field", ...extra, field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period: P, crests: sweep / P, direction: 1,
    points: [{ time: 0, value: 0 }, { time: rise / P, value: 1 }, { time: 0.56, value: 1 }, { time: 0.6, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
};
/** A repeating shape on every member together (beat pulses, strobes, on/off answers). */
const together = (g, name, s, d, period, points, high = 100, low = 0, extra = {}) => base(g, name, s, d, { effect: "field", ...extra,
  field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat", period, spread: 0, points, low, high, ease: 0 } });
/** A band of light (or water) running round the group's path; `offset` shifts it (colour bands). */
const band = (g, name, s, d, period, high, offset = 0, extra = {}, width = 0.22) => base(g, name, s, d, { effect: "field", ...extra,
  field: { kind: "custom", shape: "drawn", path: "around", motion: "repeat", period, crests: 1, direction: 1, offset,
    points: [{ time: 0, value: 0 }, { time: 0.06, value: 1 }, { time: width, value: 1 }, { time: width + 0.08, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
const PULSE = [{ time: 0, value: 1 }, { time: 0.18, value: 1 }, { time: 0.5, value: 0.15 }, { time: 1, value: 0.15 }];
const POP = [{ time: 0, value: 1 }, { time: 0.4, value: 1 }, { time: 0.45, value: 0 }, { time: 1, value: 0 }];
const ALT_A = [{ time: 0, value: 1 }, { time: 0.45, value: 1 }, { time: 0.5, value: 0 }, { time: 0.95, value: 0 }, { time: 1, value: 1 }];
const ALT_B = [{ time: 0, value: 0 }, { time: 0.45, value: 0 }, { time: 0.5, value: 1 }, { time: 0.95, value: 1 }, { time: 1, value: 0 }];
const STROBE = [{ time: 0, value: 1 }, { time: 0.25, value: 1 }, { time: 0.3, value: 0 }, { time: 1, value: 0 }];
// 1D swing (motion_angle 0..100 → −45°..+45°). The drives turn at most 88°/s (checked below).
const A = (degrees) => r2((degrees + 45) / 0.9);
const swingRate = (period) => Math.round(Math.min(10, Math.max(1.5, 8 / period)) * 10) / 10;   // ~8 keys per swing
const swing = (g, name, s, d, cycles, amp, spread = 1, centre = 0) => base(g, name, s, d, { effect: "curve", attribute: "motion_angle", cycles, spread, intensity: 100, ease: 0,
  sampleRate: swingRate(d / cycles),
  envelope: [{ time: 0, value: A(centre) / 100 }, { time: 0.25, value: A(centre + amp) / 100 }, { time: 0.5, value: A(centre) / 100 },
    { time: 0.75, value: A(centre - amp) / 100 }, { time: 1, value: A(centre) / 100 }] });
const lean = (g, name, s, d, degrees) => base(g, name, s, d, { effect: "static", attribute: "motion_angle", intensity: A(degrees) });
const cyclesFor = (d, period) => Math.max(1, Math.round(d / period));
/** ∞ X lattice: odd and even nozzles swing in mirror image, neighbours cross into an X. */
const cross = (name, s, d, period, amp, spread = 0) => [
  base("infOdd", `${name} (odd)`, s, d, { effect: "curve", attribute: "motion_angle", cycles: cyclesFor(d, period), spread, intensity: 100, ease: 0, sampleRate: swingRate(period),
    envelope: swing("infOdd", "", 0, 1, 1, amp).envelope }),
  base("infEven", `${name} (even)`, s, d, { effect: "curve", attribute: "motion_angle", cycles: cyclesFor(d, period), spread, intensity: 100, ease: 0, sampleRate: swingRate(period),
    envelope: swing("infEven", "", 0, 1, 1, -amp).envelope })];
// Air cannons: a blast is a burst (fast rise, short top, fall). Refill rules from the design:
// a 20 m cannon may not fire again within 6 s, a 50 m cannon within 25 s.
const lastShot = new Map();
const blast = (side, t, high = 100) => {
  const pool = side === "L" ? A20L.map((_, i) => `a20L${i + 1}`) : side === "R" ? A20R.map((_, i) => `a20R${i + 1}`) : A50.map((_, i) => `a50${i + 1}`);
  const limit = side === "C" ? 25 : 6;
  const g = pool.slice().sort((a, b) => (lastShot.get(a) ?? -1e9) - (lastShot.get(b) ?? -1e9))[0];
  if (t - (lastShot.get(g) ?? -1e9) < limit) return null;
  lastShot.set(g, t);
  const top = side === "C" ? 0.7 : 0.45, d = 3.4, P = d * 2 + 2;
  return base(g, side === "C" ? "50 m air blast" : `20 m air blast · ${side === "L" ? "left" : "right"}`, t, d, { effect: "field", field: { kind: "custom",
    shape: "drawn", path: "around", motion: "repeat", period: P, crests: 0.01, direction: 1,
    points: [{ time: 0, value: 0 }, { time: 0.25 / P, value: 1 }, { time: (0.25 + top) / P, value: 1 }, { time: (0.25 + top + 2.2) / P, value: 0 }, { time: 1, value: 0 }], low: 0, high, ease: 0 } });
};
const R = [];
const sec = (...list) => R.push(...list.flat().filter(Boolean));
const hitsIn = (a, b, minGap = 0) => {
  const out = [];
  for (const h of MUSIC.hits) if (h >= a && h < b && (!out.length || h - out.at(-1) >= minGap)) out.push(h);
  return out;
};

// ─── the dance ──────────────────────────────────────────────────────────────
// 0 – 7.59 · silence: only light. The Odaa tree grows from its trunk, the Elder's face appears,
// the star twinkles; a comet of light runs round the dark ∞.
sec(drawOn("hair", "The Odaa tree grows", 0.4, 7.2, 5.2, 70, { order: "front-to-back", color: C.green }),
  ramp("face", "The Elder appears", 1.5, 6.09, 0, 60, { color: C.green }),
  field("star", "The star twinkles", 4, 3.59, swell(1.6, 20, 100), { color: C.green }),
  band("infLight", "Light only · a comet round the dark ∞", 0.8, 6.79, 4.8, 45, 0, { color: C.gold }));

// 7.59 – 23 · first pulse: the drums wake the ∞, the swords pulse on the beat, rays ripple out.
const S1 = 7.59, S2 = 23.0;
sec(drawOn("inf", "The ∞ draws itself from the centre", S1, S2 - S1, 6.4, 72),
  together("pillarsBeat", "Swords pulse on the drum", bt(8.2), S2 - bt(8.2), BEAT, PULSE, 78, 25),
  field("rays", "Sun rays ripple out every bar", bt(11.4), S2 - bt(11.4), travel(1, 1, BAR, 0, 65), { order: "center-out" }),
  field("ring", "Vario ring chases on the eighths", bt(14.6), S2 - bt(14.6), travel(1, 2, BAR, 0, 100), { order: "counter-clockwise" }),
  drawOn("pc", "Portrait circle rises", bt(19.4), S2 - bt(19.4), 1.6, 60),
  field("diag", "Front jets breathe", S1, S2 - S1, swell(BAR, 20, 70)));

// 23 – 44.2 · horn drop: centre 50 m blast, the ∞ crosses into an X lattice, rays burst on the beat,
// 20 m cannons answer the horn stabs.
const S2e = 44.2;
sec(blast("C", 23.0), blast("L", 23.4), blast("R", 23.4),
  ...cross("Horn drop · X lattice round the ∞", S2, S2e - S2, BAR, 40),
  field("inf", "∞ swells on the beat", S2, S2e - S2, swell(2 * BEAT, 55, 92)),
  field("ring", "Vario ring spins", S2, S2e - S2, travel(1, 2, 2 * BEAT, 25, 100), { order: "counter-clockwise" }),
  together("rays", "Sunburst on every beat", S2, S2e - S2, BEAT, PULSE, 100, 30),
  field("pillars", "Stadium chase up the swords", S2, S2e - S2, stadium(BAR, 20, 90), { order: "front-to-back" }),
  lean("pcSwing", "Portrait circle crown (lean out)", S2, S2e - S2, -30), hold("pc", "Crown high", S2, S2e - S2, 70),
  field("diag", "Front jets pulse", S2, S2e - S2, swell(BEAT, 30, 90)));
hitsIn(25, 44, 2.6).forEach((h, i) => sec(blast(i % 2 ? "R" : "L", h, 90)));
// 44.2 – 46 · the break: the water drops, a white comet of light runs the still ∞.
sec(band("infLight", "Light only · white comet on the break", 44.2, 1.8, 1.6, 100, 0, { color: C.white }));

// 46 – 67 · verse 1 (the voice enters): a slow travelling wave round the ∞, the whole ∞ rows
// gently; the swords glow; the portrait circle rises with each sung line.
const S3 = 46.0, S4 = 67.0;
sec(field("inf", "Verse · slow wave round the ∞", S3, S4 - S3, travel(1, 3, 2 * BAR, 25, 72)),
  swing("infSwing", "Verse · the ∞ rows gently", S3, S4 - S3, cyclesFor(S4 - S3, 2 * BAR), 25, 0),
  hold("pillars", "Swords glow low", S3, S4 - S3, 28),
  field("ring", "Vario ring breathes", S3, S4 - S3, swell(2 * BAR, 0, 55), { order: "counter-clockwise" }),
  field("diag", "Front jets glow", S3, S4 - S3, swell(2 * BAR, 15, 40)));

// 67 – 90 · build: the lobes fan out against each other, the swords draw hilt to tip, the ring
// spins faster, 20 m cannons punctuate the climb.
const S5 = 90.0;
sec(field("inf", "Build · the ∞ climbs", S4, S5 - S4, finale(BAR, 30, 95)),
  swing("infRSwing", "Build · right lobe fans", S4, S5 - S4, cyclesFor(S5 - S4, BAR), 32, 0, 0),
  swing("infLSwing", "Build · left lobe fans the other way", S4, S5 - S4, cyclesFor(S5 - S4, BAR), -32, 0, 0),
  field("pillars", "Build · swords draw hilt to tip", S4, S5 - S4, travel(1, 1, 2 * BAR, 10, 90), { order: "front-to-back" }),
  field("ring", "Build · ring spins faster", S4, S5 - S4, finale(2 * BEAT, 20, 100), { order: "counter-clockwise" }),
  field("rays", "Build · rays ripple every half bar", S4, S5 - S4, travel(1, 1, 2 * BEAT, 0, 85), { order: "center-out" }),
  hold("pc", "Portrait circle steady", S4, S5 - S4, 45), lean("pcSwing", "Portrait circle upright", S4, S5 - S4, 0));
hitsIn(75, 89, 2.4).forEach((h, i) => sec(blast(i % 2 ? "R" : "L", h, 85)));

// 90 – 109 · call and response: the left lobe calls (red), the right answers (blue), two bars each.
const S6 = 109.0;
for (let k = 0, t = S5; t < S6 - 0.5; k++, t += 2 * BAR) {
  const d = Math.min(2 * BAR, S6 - t), side = k % 2 ? "R" : "L";
  const lobe = side === "L" ? "infL" : "infR", sw = side === "L" ? "infLSwing" : "infRSwing", pillar = side === "L" ? "pillarL" : "pillarR";
  const color = side === "L" ? C.red : C.blue;
  sec(field(lobe, `${side === "L" ? "Call · left lobe" : "Response · right lobe"}`, t, d, swell(BEAT, 60, 95), { color }),
    swing(sw, `${side === "L" ? "Call" : "Response"} · lobe sweeps`, t, d, cyclesFor(d, BAR), 35, 0),
    hold(pillar, `${side === "L" ? "Call" : "Response"} · sword`, t, d, 85, { color }),
    blast(side, t, 95));
}
sec(together("rays", "Rays keep the beat", S5, S6 - S5, BEAT, PULSE, 75, 20),
  field("ring", "Ring circles", S5, S6 - S5, travel(1, 1, BAR, 20, 80), { order: "counter-clockwise" }));

// 109 – 127 · the crown: the centre 50 m blast, the portrait circle opens into a crown, every
// jet high, the ∞ crosses.
const S7 = 127.0;
sec(blast("C", S6), blast("L", 109.3), blast("R", 109.6), blast("L", 110.0), blast("R", 110.4),
  lean("pcSwing", "Crown · portrait circle opens wide", S6, S7 - S6, -38), hold("pc", "Crown · full height", S6, S7 - S6, 100),
  field("inf", "Crown · the ∞ pulses high", S6, 11, swell(2 * BEAT, 70, 100)), ...cross("Crown · X lattice", S6, 11, BAR, 35),
  field("inf", "Crown · ripples run the ∞", 120, S7 - 120, travel(1, 4, BAR, 40, 95)),
  hold("ring", "Crown · ring full", S6, S7 - S6, 100), together("rays", "Crown · sunburst", S6, S7 - S6, BEAT, PULSE, 100, 45),
  field("pillars", "Crown · swords blaze", S6, S7 - S6, swell(2 * BEAT, 60, 100)), hold("diag", "Crown · front jets", S6, S7 - S6, 85));

// 127 – 136 · guitar weave: the ∞ weaves (odd and even half a cycle apart, rippling along the
// path) under bands of purple, magenta and cyan light running round it.
const S8a = 136.0;
sec(...cross("Weave · odd and even weave along the path", S7, S8a - S7, 2 * BAR, 25, 1),
  hold("inf", "Weave · steady water", S7, S8a - S7, 55), hold("pillars", "Weave · swords low", S7, S8a - S7, 30),
  band("infLight", "Light dance · purple band", S7, S8a - S7, 4.8, 100, 0, { color: C.purple }, 0.3),
  band("infLight", "Light dance · magenta band", S7, S8a - S7, 4.8, 100, 1.6, { color: C.magenta }, 0.3),
  band("infLight", "Light dance · cyan band", S7, S8a - S7, 4.8, 100, 3.2, { color: C.cyan }, 0.3),
  band("pillarsLight", "Light dance · green runs up the swords", S7, S8a - S7, BAR, 100, 0, { color: C.green, order: "front-to-back" }, 0.35));
// 136 – 139 · the break: water down; white light runs the ∞, the ring's lamps spin.
const S8 = 139.0;
sec(band("infLight", "Light only · white comet", S8a, S8 - S8a, 1.6, 100, 0, { color: C.white }),
  band("ringLight", "Light only · ring lamps spin", S8a, S8 - S8a, BEAT, 100, 0, { color: C.gold, order: "counter-clockwise" }));

// 139 – 158 · verse 2: a travelling cross runs round the ∞, the swords stab on every beat, the
// Vario ring pops on the eighths.
const S9 = 158.0;
sec(...cross("Verse 2 · travelling cross", S8, S9 - S8, BAR, 35, 1), field("inf", "Verse 2 · ∞ water", S8, S9 - S8, swell(2 * BEAT, 50, 85)),
  together("pillarsBeat", "Verse 2 · swords stab on the beat", S8, S9 - S8, BEAT, PULSE, 95, 10),
  together("ring", "Verse 2 · Vario pops on the eighths", S8, S9 - S8, BEAT / 2, POP, 90, 0),
  field("rays", "Verse 2 · rays ripple", S8, S9 - S8, travel(1, 1, BAR, 0, 80), { order: "center-out" }),
  hold("pc", "Verse 2 · circle", S8, S9 - S8, 50));

// 158 – 199 · gallop: the whole ∞ rows on every two beats, the swords answer left/right, the ring
// gallops round, 20 m blasts on every bar.
const S10 = 199.0;
sec(swing("infSwing", "Gallop · the whole ∞ rows", S9, S10 - S9, cyclesFor(S10 - S9, 2 * BEAT), 28, 0),
  field("inf", "Gallop · ∞ pumps", S9, S10 - S9, swell(2 * BEAT, 60, 95)),
  together("pillarL", "Gallop · left sword", S9, S10 - S9, 2 * BEAT, ALT_A, 90, 15), together("pillarR", "Gallop · right sword answers", S9, S10 - S9, 2 * BEAT, ALT_B, 90, 15),
  field("ring", "Gallop · the ring gallops", S9, S10 - S9, travel(1, 3, 2 * BEAT, 15, 100), { order: "counter-clockwise" }),
  together("rays", "Gallop · rays on the beat", S9, S10 - S9, BEAT, PULSE, 80, 20));
for (let k = 0, t = bt(160); t < S10 - 3; k++, t = r2(t + BAR)) sec(blast(k % 2 ? "R" : "L", t, 90));

// 199 – 246 · Geerarsa (the heroic chant): the 50 m blasts, a wide X lattice, the portrait circle
// breathes dome ↔ crown, every strong hit fires a 20 m cannon.
const S11 = 246.0;
sec(blast("C", S10), blast("C", 224.6),
  ...cross("Geerarsa · wide X lattice", S10, S11 - S10, BAR, 42), field("inf", "Geerarsa · ∞ high", S10, S11 - S10, swell(2 * BEAT, 65, 100)),
  swing("pcSwing", "Geerarsa · dome ↔ crown", S10, S11 - S10, cyclesFor(S11 - S10, 2 * BAR), 35, 0), hold("pc", "Geerarsa · circle high", S10, S11 - S10, 85),
  together("ring", "Geerarsa · Vario pops on the beat", S10, S11 - S10, BEAT, POP, 100, 20),
  together("rays", "Geerarsa · sunburst", S10, S11 - S10, BEAT, PULSE, 100, 35),
  field("pillars", "Geerarsa · stadium up the swords", S10, S11 - S10, stadium(BAR, 25, 95), { order: "front-to-back" }),
  field("diag", "Geerarsa · front jets", S10, S11 - S10, swell(BEAT, 30, 90)));
hitsIn(200, 245, 3.2).forEach((h, i) => sec(blast(i % 2 ? "R" : "L", h, 100)));

// 246 – 281 · Bulloo: a comet of water loops the ∞ with sweeping swings, rainbow bands of light
// chase it, the swords and ring breathe.
const S12 = 281.0;
sec(field("inf", "Bulloo · a comet of water loops the ∞", S11, S12 - S11, travel(1, 1, 2 * BAR, 20, 95)),
  swing("infSwing", "Bulloo · sweeps travel round", S11, S12 - S11, cyclesFor(S12 - S11, 2 * BAR), 35, 1),
  band("infLight", "Light dance · cyan band", S11, 24, 6.4, 100, 0, { color: C.cyan }, 0.3),
  band("infLight", "Light dance · green band", S11, 24, 6.4, 100, 2.13, { color: C.green }, 0.3),
  band("infLight", "Light dance · gold band", S11, 24, 6.4, 100, 4.27, { color: C.gold }, 0.3),
  field("pillars", "Bulloo · swords breathe", S11, S12 - S11, swell(2 * BAR, 20, 75)),
  field("ring", "Bulloo · ring flows", S11, S12 - S11, travel(1, 1, 2 * BAR, 10, 80), { order: "counter-clockwise" }),
  hold("pc", "Bulloo · circle", S11, S12 - S11, 45));

// 281 – 288 · the Odaa canopy: the 50 m blast, the portrait circle opens wide, the tree blooms.
const S13 = 288.0;
sec(blast("C", S12), lean("pcSwing", "Canopy · the circle opens", S12, S13 - S12, -40), hold("pc", "Canopy · full", S12, S13 - S12, 100),
  hold("rays", "Canopy · rays full", S12, S13 - S12, 90), hold("ring", "Canopy · ring full", S12, S13 - S12, 100),
  hold("inf", "Canopy · ∞ glows low", S12, S13 - S12, 35),
  field("hair", "Canopy · the tree blooms upward", S12, S13 - S12, travel(1, 1, BAR, 40, 100), { order: "front-to-back", color: C.green }));

// 288 – 304 · finale: crossing sweeps, the circle beats dome/crown, swords blaze, cannons alternate.
const S14a = 304.0;
sec(...cross("Finale · crossing sweeps", S13, S14a - S13, 2 * BEAT, 30), field("inf", "Finale · ∞ full", S13, S14a - S13, swell(2 * BEAT, 75, 100)),
  swing("pcSwing", "Finale · circle beats", S13, S14a - S13, cyclesFor(S14a - S13, 2 * BEAT), 30, 0), hold("pc", "Finale · circle", S13, S14a - S13, 90),
  together("ring", "Finale · Vario pops", S13, S14a - S13, BEAT / 2, POP, 100, 20), together("rays", "Finale · sunburst", S13, S14a - S13, BEAT, PULSE, 100, 40),
  field("pillars", "Finale · stadium", S13, S14a - S13, stadium(2 * BEAT, 30, 100), { order: "front-to-back" }), hold("diag", "Finale · front jets", S13, S14a - S13, 90));
for (let k = 0, t = bt(289); t < S14a - 2; k++, t = r2(t + 2 * BEAT)) sec(blast(k % 2 ? "R" : "L", t, 95));
// 304 – 307.5 · the last break: the water drops and every lamp strobes on the eighths.
const S14b = 307.5;
sec(together("waterLights", "Light only · strobe on the break", S14a, S14b - S14a, BEAT / 2, STROBE, 100, 0, { color: C.white }));
// 307.5 – 320.3 · the last climb to the hard stop: everything, faster, the final blasts.
sec(field("inf", "Last climb · the ∞", S14b, STOP - S14b, finale(BAR, 50, 100)), ...cross("Last climb · X lattice", S14b, STOP - S14b, 2 * BEAT, 30),
  lean("pcSwing", "Last climb · crown", S14b, STOP - S14b, -35), hold("pc", "Last climb · circle", S14b, STOP - S14b, 100),
  field("ring", "Last climb · ring spins", S14b, STOP - S14b, finale(BEAT, 30, 100), { order: "counter-clockwise" }),
  together("rays", "Last climb · sunburst", S14b, STOP - S14b, BEAT, PULSE, 100, 50),
  field("pillars", "Last climb · swords", S14b, STOP - S14b, swell(2 * BEAT, 60, 100)), hold("diag", "Last climb · front jets", S14b, STOP - S14b, 100),
  blast("C", 316.4), blast("L", 318.0), blast("R", 318.0), blast("L", 319.6), blast("R", 319.6));
for (let k = 0, t = bt(309); t < 316; k++, t = r2(t + BAR)) sec(blast(k % 2 ? "R" : "L", t, 95));

// The voice: each sung phrase lifts the portrait circle and makes the Elder's face glow.
const sung = (p) => {
  const d = r2(p[1] - p[0] + 0.6), rise = Math.min(0.3, 0.4 / d);
  return [{ time: 0, value: 0 }, { time: r2(rise), value: 1 }, { time: r2(Math.max(rise + 0.01, (p[1] - p[0]) / d)), value: 0.85 }, { time: 1, value: 0 }];
};
const voice = [{ time: 0, value: 0 }];
for (const p of MUSIC.phrases) {
  if (p[0] < S1 || p[1] > STOP) continue;
  const d = r2(p[1] - p[0] + 0.6), env = sung(p);
  R.push(base("pc", "Sung line · the circle rises", p[0], d, { effect: "curve", envelope: env, intensity: 90, sampleRate: 10, ease: 0 }));
  const span = STOP - S1, at = (t) => Math.round(((t - S1) / span) * 10000) / 10000;
  for (const [t, v] of [[p[0] - 0.05, 0], [p[0] + 0.35, 1], [p[1], 0.85], [p[1] + 0.6, 0]]) if (at(t) > voice.at(-1).time) voice.push({ time: at(t), value: v });
}
if (voice.at(-1).time < 1) voice.push({ time: 1, value: 0 });
R.push(base("face", "The Elder's face glows with the voice", S1, r2(STOP - S1), { effect: "curve", envelope: voice, intensity: 100, sampleRate: 1.3, ease: 0, color: C.green }));

// ─── the portrait circle, the Vario mushrooms and the diagonal rainbows ──────
// (their own choreography, after the reference renders; earlier generic patterns on them removed)
for (let i = R.length - 1; i >= 0; i--) if (/^(pc|ring|diag)/.test(R[i].groupId)) R.splice(i, 1);
// Tall water on the circle through the music, rests on the breaks.
for (const [a, b] of [[15.4, 44.2], [46, S8a], [S8, S14a], [S14b, STOP]]) R.push(hold("pc", "Circle · tall jets", a, b - a, 100));
const env = (pts) => pts.map(([time, deg]) => ({ time, value: A(deg) / 100 }));
const motion = (g, name, s, d, cycles, envelope) => base(g, name, s, d, { effect: "curve", attribute: "motion_angle", cycles, spread: 0, intensity: 100, ease: 0,
  sampleRate: swingRate(d / cycles), envelope });
/** Crown → upright → funnel (all jets meet above the portrait) → upright → crown. */
const funnel = (name, s, d, period, amp = 40) => motion("pcSwing", name, s, d, cyclesFor(d, period), env([[0, -amp], [0.5, amp], [1, -amp]]));
/** The crown tilts round the circle (front → right → back → left): each jet's phase follows its angle. */
const wobble = (name, s, d, period, amp) => swing("pcSwing", name, s, d, cyclesFor(d, period), amp, 1);
/** The whole crown sways front ↔ back (or left ↔ right): opposite halves lean in mirror image. */
const sway = (axis, name, s, d, period, amp) => axis === "fb"
  ? [swing("pcFrontSwing", `${name} (front half)`, s, d, cyclesFor(d, period), amp, 0), swing("pcBackSwing", `${name} (back half)`, s, d, cyclesFor(d, period), -amp, 0)]
  : [swing("pcLeftSwing", `${name} (left half)`, s, d, cyclesFor(d, period), amp, 0), swing("pcRightSwing", `${name} (right half)`, s, d, cyclesFor(d, period), -amp, 0)];
const pcCross = (name, s, d, period, amp) => [swing("pcOddSwing", `${name} (odd)`, s, d, cyclesFor(d, period), amp, 0), swing("pcEvenSwing", `${name} (even)`, s, d, cyclesFor(d, period), -amp, 0)];
sec(lean("pcSwing", "Circle rises upright", 15.4, S2 - 15.4, 0),
  funnel("Horn drop · crown opens and closes into a funnel", S2, S2e - S2, 2 * BAR),
  wobble("Verse · the crown tilts round the circle", S3, S4 - S3, 2 * BAR, 30),
  ...sway("fb", "Build · the crown sways front and back", S4, S5 - S4, BAR, 35));
for (let k = 0, t = S5; t < S6 - 0.5; k++, t = r2(t + 2 * BAR)) {
  const d = Math.min(2 * BAR, S6 - t), tilt = k % 2 ? -32 : 32;               // calls lean the crown left, responses right
  const what = `${k % 2 ? "Response" : "Call"} · the crown leans ${k % 2 ? "right" : "left"}`;
  sec(motion("pcLeftSwing", what, t, d, 1, env([[0, 0], [0.25, tilt], [0.75, tilt], [1, 0]])),
    motion("pcRightSwing", `${what} (right half)`, t, d, 1, env([[0, 0], [0.25, -tilt], [0.75, -tilt], [1, 0]])));
}
sec(lean("pcSwing", "Crown · the circle opens wide", S6, 120 - S6, -40), funnel("Crown · closes into a funnel and opens again", 120, S7 - 120, 2 * BAR),
  ...pcCross("Weave · odd and even cross", S7, S8a - S7, 2 * BAR, 25),
  wobble("Verse 2 · the crown spins its tilt", S8, S9 - S8, BAR, 35),
  ...sway("fb", "Gallop · front and back on two beats", S9, 178.7 - S9, 2 * BEAT, 28),
  ...sway("lr", "Gallop · left and right on two beats", 178.7, S10 - 178.7, 2 * BEAT, 28),
  funnel("Geerarsa · dome and crown breathe", S10, 222.7 - S10, 2 * BAR, 42),
  wobble("Geerarsa · the crown spins its tilt", 222.7, S11 - 222.7, BAR, 38),
  wobble("Bulloo · slow tilt round the circle", S11, S12 - S11, 2 * BAR, 35),
  lean("pcSwing", "Canopy · the circle opens wide", S12, S13 - S12, -42),
  ...pcCross("Finale · odd and even cross on two beats", S13, S14a - S13, 2 * BEAT, 30),
  funnel("Last climb · crown and funnel", S14b, STOP - S14b, BAR, 40));

// Vario mushrooms: chases, blooms on the beat, answers, pops. A Vario head is a solenoid nozzle
// (it switches on and off up to 20 × a second), so it is driven by keyed on/off curves — wave
// patterns only drive proportional jets. `spread` makes a curve travel round the ring.
const vcurve = (g, name, s, d, period, pts, spread = 0, high = 100) => {
  // A curve pattern holds at most 32 cycles: longer runs continue in consecutive parts.
  const n = cyclesFor(d, period), parts = Math.ceil(n / 32);
  return Array.from({ length: parts }, (_, k) => {
    const c = Math.round(n / parts), ps = r2(s + (k * d) / parts), pd = r2(k === parts - 1 ? s + d - ps : d / parts);
    return base(g, parts > 1 ? `${name} (${k + 1}/${parts})` : name, ps, pd, { effect: "curve", cycles: Math.max(1, Math.min(32, c)), spread,
      intensity: high, ease: 0, order: "counter-clockwise", sampleRate: Math.min(25, Math.max(4, Math.round(16 / period))),
      envelope: pts.map(([time, value]) => ({ time, value })) });
  });
};
const V_POP = [[0, 0], [0.04, 1], [0.42, 1], [0.48, 0], [1, 0]];            // switch on, hold, off
const V_BEAT = [[0, 1], [0.38, 1], [0.44, 0.2], [0.96, 0.2], [1, 1]];      // bloom on the beat over a low bell
const V_CHASE = [[0, 0], [0.04, 1], [0.26, 1], [0.3, 0], [1, 0]];          // a lit block running round
const V_BREATHE = [[0, 0.25], [0.5, 0.9], [1, 0.25]];
/** n lit blocks evenly round the ring (with spread 1 they all travel round together). */
const vBlocks = (n) => { const out = [[0, 0]]; for (let k = 0; k < n; k++) { const o = k / n, w = 0.26 / n;
  out.push([r2(o + 0.01), 1], [Math.round((o + w) * 1000) / 1000, 1], [Math.round((o + w + 0.04 / n) * 1000) / 1000, 0]); } out.push([1, 0]); return out; };
const V_A = [[0, 1], [0.46, 1], [0.5, 0.1], [0.96, 0.1], [1, 1]], V_B = [[0, 0.1], [0.46, 0.1], [0.5, 1], [0.96, 1], [1, 0.1]];
sec(vcurve("ring", "Mushrooms bloom round the ring", bt(14.6), S2 - bt(14.6), BAR, V_CHASE, 1),
  vcurve("ring", "Horn drop · every mushroom blooms on the beat", S2, S2e - S2, BEAT, V_BEAT),
  vcurve("ring", "Verse · the mushrooms breathe", S3, S4 - S3, 2 * BAR, V_BREATHE),
  vcurve("ring", "Build · bloom chase", S4, 78 - S4, BAR, V_CHASE, 1), vcurve("ring", "Build · bloom chase faster", 78, 86 - 78, 2 * BEAT, V_CHASE, 1),
  vcurve("ring", "Build · bloom chase fastest", 86, S5 - 86, 2 * BEAT, vBlocks(2), 1));
for (let k = 0, t = S5; t < S6 - 0.5; k++, t = r2(t + 2 * BAR)) {
  const d = Math.min(2 * BAR, S6 - t);
  sec(vcurve(k % 2 ? "ringR" : "ringL", `${k % 2 ? "Response" : "Call"} · that side's mushrooms bloom on the beat`, t, d, BEAT, V_BEAT));
}
sec(hold("ring", "Crown · every mushroom full", S6, S7 - S6, 100),
  vcurve("ringOdd", "Weave · odd mushrooms", S7, S8a - S7, 2 * BEAT, V_A), vcurve("ringEven", "Weave · even mushrooms answer", S7, S8a - S7, 2 * BEAT, V_B),
  vcurve("ring", "Verse 2 · mushrooms pop on the eighths", S8, S9 - S8, BEAT / 2, V_POP),
  vcurve("ring", "Gallop · three blooms gallop round", S9, S10 - S9, 2 * BAR, vBlocks(3), 1),
  vcurve("ringOdd", "Geerarsa · odd mushrooms on the beat", S10, S11 - S10, 2 * BEAT, V_A), vcurve("ringEven", "Geerarsa · even mushrooms answer", S10, S11 - S10, 2 * BEAT, V_B),
  vcurve("ring", "Bulloo · a bloom flows round the ring", S11, S12 - S11, 2 * BAR, V_CHASE, 1),
  hold("ring", "Canopy · mushrooms full", S12, S13 - S12, 100),
  vcurve("ring", "Finale · mushrooms pop on the eighths", S13, S14a - S13, BEAT / 2, V_POP),
  vcurve("ring", "Last climb · two blooms race round", S14b, STOP - S14b, BAR, vBlocks(2), 1));

// Diagonal rainbows: arcs flow into the centre — outer pair, then middle, then inner, each bar —
// and all six cross over the portrait on the big moments.
const flow = (name, s, d, period) => [["diagOuter", 0], ["diagMid", 0.35], ["diagInner", 0.7]].map(([g, delay]) => base(g, `${name} · ${g.replace("diag", "").toLowerCase()} pair`, s, d,
  { effect: "field", field: { kind: "custom", shape: "drawn", path: "together", motion: "repeat", period, spread: 0, offset: -delay,
    points: [{ time: 0, value: 0 }, { time: 0.05, value: 1 }, { time: 0.6, value: 1 }, { time: 0.7, value: 0 }, { time: 1, value: 0 }], low: 0, high: 100, ease: 0 } }));
sec(...flow("First pulse · rainbows flow into the centre", bt(15.4), S2 - bt(15.4), BAR),
  hold("diag", "Horn drop · all six rainbows cross over the portrait", S2, S2e - S2, 100),
  ...flow("Build · rainbows flow in on every bar", S4, S5 - S4, BAR),
  hold("diag", "Crown · rainbows cross", S6, S7 - S6, 100),
  ...flow("Verse 2 · rainbows flow in", S8, S9 - S8, BAR),
  ...flow("Gallop · rainbows flow in on two beats", S9, S10 - S9, 2 * BEAT),
  hold("diag", "Geerarsa · rainbows cross", S10, S11 - S10, 100),
  ...flow("Bulloo · rainbows flow in slowly", S11, S12 - S11, 2 * BAR),
  hold("diag", "Canopy and finale · rainbows cross", S12, S14a - S12, 100),
  hold("diag", "Last climb · rainbows cross", S14b, STOP - S14b, 100));

// ─── lighting ────────────────────────────────────────────────────────────────
// Under water every lamp burns only while its own jet runs (plus the time its water is still in
// the air), in the colour of the section; cannon lamps blast white. Light-dance windows above
// take over the lamps of their groups. The portrait stays green: a base glow, the face lifting
// with the voice, the tree blooming at the canopy, a long fade after the hard stop.
const PALETTE = [
  [0, { all: C.gold }], [S2, { all: C.gold, ring: C.red, rays: C.orange }], [S3, { all: C.cyan, pillarL: C.green, pillarR: C.green, pc: C.gold }],
  [S4, { all: C.cyan, ring: C.gold }], [78, { all: C.gold, ring: C.orange }], [S5, { infL: C.red, pillarL: C.red, infR: C.blue, pillarR: C.blue, all: C.gold }],
  [S6, { all: C.white, pc: C.gold, rays: C.gold }], [S7, { all: C.purple, pillarL: C.green, pillarR: C.green }],
  [S8, { all: C.green, ring: C.gold, rays: C.gold }], [S9, { all: C.red, rays: C.gold, ring: C.gold }], [178.7, { all: C.gold, ring: C.red, rays: C.red }],
  [S10, { all: C.gold, ring: C.orange, pc: C.red, rays: C.orange }], [222.7, { all: C.orange, pc: C.gold, ring: C.gold }],
  [S11, { all: C.cyan, pillarL: C.green, pillarR: C.green, ring: C.green }], [S12, { all: C.green, rays: C.gold }],
  [S13, { all: C.white, ring: C.gold, rays: C.gold }], [S14b, { all: C.gold, rays: C.white, ring: C.white }]];
const HOUSE = [[0, 85], [S2, 100], [S3, 70], [S4, 85], [S5, 95], [S6, 100], [S7, 70], [S8, 85], [S9, 95], [S10, 100], [S11, 80], [S12, 90], [S13, 100]];
const family = new Map();
INF.forEach((f, i) => family.set(f.id, i < 120 ? "infR" : "infL"));
for (const [list, fam] of [[PC, "pc"], [RING, "ring"], [RAYS, "rays"], [PL, "pillarL"], [PR, "pillarR"], [DIAG, "diag"], [CMP, "air"]]) list.forEach((f) => family.set(f.id, fam));
DIAG_X.forEach((f, i) => family.set(f.id, `diag${i}`));
const RAINBOW = [C.red, C.orange, C.gold, C.green, C.cyan, C.purple];
// Colour that changes on the music (as in the reference renders): [from, to, families, colours, bars per colour].
const CYCLES = [[S2, S2e, ["ring"], [C.blue, C.magenta, C.cyan, C.purple], 1], [S8, S9, ["ring", "rays"], [C.gold, C.green, C.cyan, C.orange], 2],
  [S9, S10, ["ring", "pillarL", "pillarR", "rays"], [C.red, C.gold, C.blue, C.orange, C.green, C.magenta], 2],
  [S10, S11, ["ring"], [C.blue, C.purple, C.magenta, C.cyan], 1], [S13, STOP, ["ring", "pillarL", "pillarR", "rays"], [C.magenta, C.gold, C.blue, C.orange, C.green, C.red], 2]];
const colourAt = (t, fam) => {
  if (fam === "air") return C.white;
  if (fam.startsWith("diag")) return RAINBOW[Number(fam.slice(4))];
  for (const [a, b, fams, cols, bars] of CYCLES) if (t >= a && t < b && fams.includes(fam)) return cols[Math.floor((t - a) / (bars * BAR)) % cols.length];
  let p = PALETTE[0][1]; for (const [s, v] of PALETTE) if (t >= s - 0.01) p = v; return p[fam] || p.all;
};
const houseAt = (t) => { let h = 85; for (const [s, v] of HOUSE) if (t >= s - 0.01) h = v; return h; };
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
  if (!nozzles.has(c.fixtureId) || /motion_(angle|pan|tilt|roll|position)|solenoid|enable/.test(c.type)) continue;
  const arr = waterLevel.get(c.fixtureId) || waterLevel.set(c.fixtureId, new Float32Array(NS)).get(c.fixtureId);
  for (let i = Math.max(0, Math.floor(c.startTime / STEP)); i < NS && i * STEP <= c.startTime + c.duration; i++) {
    const v = levelAt(c, i * STEP - c.startTime) / 100;
    if (v > arr[i]) arr[i] = v;
  }
}
const WINDOWS = [[0, 7.59, ["infLight"]], [44.2, 46, ["infLight"]], [S7, S8a, ["infLight", "pillarsLight"]], [S8a, S8, ["infLight", "ringLight"]],
  [S11, S11 + 24, ["infLight"]], [S14a, S14b, ["waterLights"]]];
const inWindow = new Map();
for (const [s, e, gs] of WINDOWS) for (const g of gs) for (const id of G.find((x) => x.id === g).memberFixtureIds) (inWindow.get(id) || inWindow.set(id, []).get(id)).push([s, e]);
const COLOURS = Object.values(C);
const signature = new Map();
for (const [nid, noz] of nozzles) {
  const lamp = lampOf.get(nid), w = waterLevel.get(nid);
  if (!lamp || !w) continue;
  const fam = family.get(nid), H = Number(noz.engineering?.jetHeightM) || 4;
  const tail = Math.round((2 * Math.sqrt((2 * H) / 9.81)) / STEP);
  const code = new Int32Array(NS);           // level × 100 + colour index (0 = off)
  let last = -1e9;
  for (let i = 0; i < NS; i++) {
    if (w[i] > 0.03) last = i;
    if (i - last <= tail) {
      const t = i * STEP;
      code[i] = (fam === "air" ? 100 : houseAt(t)) * 100 + COLOURS.indexOf(colourAt(t, fam)) + 1;
    }
  }
  for (const [s, e] of inWindow.get(lamp) || []) for (let i = Math.floor(s / STEP); i < Math.min(NS, Math.ceil(e / STEP)); i++) code[i] = 0;
  const segs = [];
  for (let i = 0; i < NS;) {
    let j = i;
    while (j < NS && code[j] === code[i]) j++;
    if (code[i]) segs.push([r2(Math.floor(i * STEP * 2) / 2), r2(Math.min(END, Math.ceil(j * STEP * 2) / 2)), code[i]]);
    i = j;
  }
  for (let k = segs.length - 1; k > 0; k--) {
    if (segs[k][0] - segs[k - 1][1] < 1.5 && segs[k][2] === segs[k - 1][2]) { segs[k - 1][1] = segs[k][1]; segs.splice(k, 1); }
    else if (segs[k][0] < segs[k - 1][1]) segs[k][0] = segs[k - 1][1];
  }
  for (let k = segs.length - 1; k >= 0; k--) if (segs[k][1] - segs[k][0] < 0.05) segs.splice(k, 1);
  const key = JSON.stringify(segs);
  (signature.get(key) || signature.set(key, { segs, lamps: [], fam }).get(key)).lamps.push(lamp);
}
let follow = 0;
for (const { segs, lamps, fam } of signature.values()) {
  const gid = group(`lit${++follow}`, `Lit with its water · ${fam} (${lamps.length})`, lamps.map((id) => ({ id })));
  for (const [s, e, code] of segs) R.push(hold(gid, fam === "air" ? "Cannon lamps blast" : "Lamps follow their water", s, e - s, Math.floor(code / 100),
    { color: COLOURS[(code % 100) - 1] }));
}
// The portrait (green): base glow through the music, flashes on the big hits, fade after the stop.
sec(hold("face", "The Elder's face glows", 7.59, STOP - 7.59, 45, { color: C.green }), hold("hair", "The Odaa tree glows", 7.59, STOP - 7.59, 55, { color: C.green }),
  field("star", "The star twinkles", 7.59, STOP - 7.59, swell(2 * BEAT, 30, 100), { color: C.green }),
  ramp("face", "After the stop · the face fades", STOP, END - STOP - 0.3, 100, 0, { color: C.green }),
  ramp("hair", "After the stop · the tree fades", STOP, END - STOP - 0.6, 90, 0, { color: C.green }),
  ramp("star", "After the stop · the star fades last", STOP, END - STOP, 100, 0, { color: C.green }));
for (const h of [S2, S6, S10, S12, 319.6]) sec(hold("waterLights", "Light blast · every lamp flashes white", h, 0.35, 100, { color: C.white }),
  hold("face", "Light blast · the portrait flashes", h, 0.35, 100, { color: C.green }), hold("hair", "Light blast", h, 0.35, 100, { color: C.green }));

const recipes = R.filter((r) => r && r.groupId && r.duration > 0);
const markers = [[0, "Silence · the portrait appears"], [S1, "First pulse"], [S2, "Horn drop · 50 m blast"], [44.2, "Break"], [S3, "Verse 1"], [S4, "Build"],
  [S5, "Call and response"], [S6, "Crown · 50 m blast"], [S7, "Guitar weave"], [S8a, "Break · light only"], [S8, "Verse 2"], [S9, "Gallop"],
  [S10, "Geerarsa · 50 m blast"], [S11, "Bulloo"], [S12, "Odaa canopy · 50 m blast"], [S13, "Finale"], [S14a, "Break · strobe"], [S14b, "Last climb"], [STOP, "Hard stop"]]
  .map(([time, name], i) => ({ id: `m${i + 1}`, name, label: name, time, kind: "section", color: "#33e07a" }));

// ─── compile + checks ───────────────────────────────────────────────────────
const studio = { ...readStudio({}), groups: G, recipes, tempo: [{ time: 0, bpm: r2(BPM) }], markers, layout: {} };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) { console.log("issues:", issues.slice(0, 12)); throw new Error("compile issues"); }
// Air refill: 20 m cannons ≥ 6 s apart, 50 m ≥ 25 s.
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

// ─── write the project: the same design, a new show ─────────────────────────
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#33e07a", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
const name = "Odaa & Elder · 3Obsa (Yosan Getahun) — water, light and air dance";
const now = new Date().toISOString();
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioDuration: END, patternDefinitions: [{ id: "odaa-3obsa-dance", name, duration: END }] };
proj.show = { ...proj.show, id: "aquaflow-odaa-3obsa-dance", name, bpm: r2(BPM), duration: END, loop: false };
proj.project = { ...proj.project, name, modifiedAt: now };
// Cameras: world x = plan x − centre, z = plan y − centre; the audience stands on the straight
// front edge (plan y < 2), looking at the portrait. A film edit: one moving shot per section,
// cut on the music, never lower than 3 m.
const { cx, cy } = poolCenter(proj.engineering.geometry, proj.engineering.params, proj.engineering.pool_type);
const W = (x, y, h) => ({ x: r2(x - cx), y: h, z: r2(y - cy) });
const MID = W(35.1, 13.2, 2);
const cameraKeys = [];
const camShot = (t0, t1, frames) => frames.forEach(([pos, tgt, fov], i) => {
  const t = r2(t0 + ((t1 - t0 - 0.04) * i) / Math.max(1, frames.length - 1));
  cameraKeys.push({ id: `cam-${cameraKeys.length + 1}`, t, position: pos, target: tgt, fov, roll: 0, ease: i === frames.length - 1 && t1 < END ? "cut" : "smooth" });
});
camShot(0, S1, [[W(35, -32, 26), W(35, 13, 0), 50], [W(35, -15, 14), W(35, 13.5, 0), 50]]);                // the portrait appears in the dark
camShot(S1, S2, [[W(18, -13, 3), W(32, 13, 3), 55], [W(52, -13, 3.5), W(38, 13, 3), 55]]);                // low glide as the ∞ draws on
camShot(S2, S2e, [[W(48, -20, 10), W(35, 13, 4), 58], [W(22, -22, 16), W(35, 13, 2), 58]]);              // horn drop: high three-quarter arc over the lattice
camShot(S2e, S3, [[W(35, 13.6, 46), W(35, 13, 0), 55], [W(35, 13.4, 42), W(35, 13, 0), 55]]);              // the break from above: the white comet
camShot(S3, S4, [[W(-4, 3, 6), W(30, 12, 2), 50], [W(6, -13, 7), W(36, 12, 2), 50]]);                     // verse: slow arc from the left
camShot(S4, S5, [[W(35, -30, 18), W(35, 13, 3), 55], [W(35, -9, 6), W(35, 13, 3), 55]]);                  // build: push in
for (let k = 0, t = S5; t < S6 - 0.5; k++, t = r2(t + 2 * BAR)) {
  const e = Math.min(S6, r2(t + 2 * BAR)), left = k % 2 === 0;                                           // call and response: cut to who sings
  camShot(t, e, left ? [[W(10, -7, 4), W(20, 12, 3), 55], [W(14, -9, 5), W(22, 12, 3), 55]] : [[W(60, -7, 4), W(50, 12, 3), 55], [W(56, -9, 5), W(48, 12, 3), 55]]);
}
camShot(S6, S7, [[W(35, -10, 3), W(35, 13, 18), 66], [W(35, -20, 9), W(35, 13, 5), 60]]);                  // crown: look up at the 50 m blast, then settle
camShot(S7, S8, [[W(35, 14, 44), W(35, 13, 0), 55], [W(46, 2, 34), W(35, 13, 0), 55]]);                    // weave and break: the light dance from above
camShot(S8, S9, [[W(57, -10, 4), W(45, 12, 3), 55], [W(15, -10, 4), W(25, 12, 3), 55]]);                   // verse 2: tracking along the front
camShot(S9, 178.7, [[W(72, 6, 8), W(48, 12, 3), 55], [W(62, -12, 6), W(40, 12, 3), 55]]);                   // gallop: round the right lobe
camShot(178.7, S10, [[W(35, -33, 10), W(35, 13, 5), 60], [W(35, -21, 5), W(35, 13, 5), 60]]);              // gallop: the whole fountain
camShot(S10, 215, [[W(35, -9, 3), W(35, 13, 7), 62], [W(25, -12, 5), W(35, 13, 5), 60]]);                  // Geerarsa: hero low angle
camShot(215, 230, [[W(-2, -15, 20), W(35, 12, 0), 55], [W(18, -21, 22), W(35, 12, 0), 55]]);               // Geerarsa: high arc
camShot(230, S11, [[W(76, 0, 4), W(30, 12, 4), 55], [W(72, -11, 5), W(32, 12, 4), 55]]);                   // Geerarsa: from the right
camShot(S11, 263, [[W(35, -6, 48), W(35, 13, 0), 55], [W(30, 0, 30), W(35, 13, 0), 55]]);                   // Bulloo: the rainbow comet from above
camShot(263, S12, [[W(56, -16, 6), W(35, 12, 4), 55], [W(14, -16, 6), W(35, 12, 4), 55]]);                  // Bulloo: front glide
camShot(S12, S13, [[W(35, 0, 15), W(35, 14, 0), 55], [W(35, 3, 11), W(35, 14, 0), 55]]);                    // canopy: over the portrait
camShot(S13, S14a, [[W(8, -25, 8), W(35, 12, 6), 58], [W(62, -25, 8), W(35, 12, 6), 58]]);                  // finale: wide sweep
camShot(S14a, S14b, [[W(35, 13.6, 55), W(35, 13, 0), 55], [W(35, 13.6, 50), W(35, 13, 0), 55]]);             // the strobe from above
camShot(S14b, END, [[W(35, -30, 4), W(35, 13, 10), 62], [W(35, -15, 6), W(35, 13, 7), 60], [W(35, -22, 24), W(35, 13.5, 0), 55]]); // last climb, then rise over the portrait
if (cameraKeys.some((k) => k.position.y < 3)) throw new Error("camera key below 3 m");
proj.render = { ...proj.render, environment: "night", cameraMode: "animated", activeCameraView: null, studioLook: true, studioMist: false,
  cameraTrack: { enabled: true, keys: cameraKeys },
  cameraViews: [
    { id: "front", name: "Audience · front", position: W(35, -28, 8), target: W(35, 13, 4), fov: 55 },
    { id: "low", name: "Front · low", position: W(35, -10, 3), target: W(35, 13, 8), fov: 62 },
    { id: "top", name: "Top · the portrait", position: W(35, 13.6, 60), target: W(35, 13, 0), fov: 50 },
    { id: "left", name: "Left lobe", position: W(8, -10, 6), target: W(22, 12, 3), fov: 55 },
  ] };
proj.savedAt = now;
const entries = [{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest || {}, null, 2) }];
for (const [k, v] of zip) if (k.startsWith("assets/")) entries.push({ name: k, data: v });
entries.push({ name: "design-notes.txt", data: [
  name, "",
  "Design: taken unchanged from the source package (1,816 fixtures: 240 ∞ 1D, 22 circle 1D, 22 Vario, 130 rays, 2 × 128 pillar jets, 6 diagonal jets,",
  "15 air cannons, 691 lights under nozzles, 434 portrait lights). Show, lights and cameras are new.",
  `Song: Yosan Getahun - 3Obsa, ${END} s, ${r2(BPM)} BPM (beat ${r2(BEAT)} s); music 7.59 to ${STOP} s, then a hard stop.`,
  `Air: ${blasts} blasts, 20 m cannons at least 6 s apart, 50 m at least 25 s. Fastest 1D swing ${Math.round(worst)} deg/s (drives 88 deg/s).`,
  `${recipes.length} editable patterns, ${clips.length} clips. Simulated concept, not commissioned hardware.`].join("\n") });
fs.writeFileSync(out, createZip(entries));
console.log(`→ ${out} · ${(fs.statSync(out).size / 1048576).toFixed(1)} MB`);
