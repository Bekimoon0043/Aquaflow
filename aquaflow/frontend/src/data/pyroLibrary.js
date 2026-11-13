/**
 * Pyrotechnic firing positions (category "Pyro"). AquaFlow previews, programs and exports pyro;
 * it never fires it — the operator arms and fires on the firing system from the exported script.
 *
 * Every number is an ESTIMATE from published rules of thumb, not a product datasheet:
 *   - Spectator distance: NFPA 1123 (outdoor display) — 70 ft per inch of shell diameter
 *     ≈ 0.84 m per mm (75 mm → 63 m). Ground items use the larger of that and their own rule.
 *   - Burst height: about 100 ft per inch of shell diameter ≈ 1.2 m per mm.
 *   - Burst diameter: about 70 ft per inch ≈ 0.84 m per mm (radius 0.42 m per mm).
 *   - Lift time (ignition → burst): 1.5–3.5 s, growing with calibre.
 * Replace with the supplier's data sheet values before a real display.
 */

const SAFETY_M_PER_MM = 0.84;
const HEIGHT_M_PER_MM = 1.2;
const BURST_RADIUS_M_PER_MM = 0.42;
const ESTIMATE = "Estimate from rules of thumb (NFPA 1123 70 ft/in spectator distance; ~100 ft/in height; ~70 ft/in burst) — replace with the product data sheet";

const LIFT_BY_CALIBRE = { 50: 1.8, 75: 2.4, 100: 3.0, 125: 3.5 };
const SHELL_EFFECTS = {
  peony:         { label: "Peony",         durationS: 1.8, colors: ["#ff3040", "#ffd060"] },
  chrysanthemum: { label: "Chrysanthemum", durationS: 2.4, colors: ["#ffd27a", "#40a0ff"] },
  willow:        { label: "Willow",        durationS: 5.5, colors: ["#ffb347"] },
  palm:          { label: "Palm",          durationS: 3.5, colors: ["#ffcf5a", "#30ff7a"] },
  crossette:     { label: "Crossette",     durationS: 2.6, colors: ["#e8f0ff", "#ff5ad0"] },
  strobe:        { label: "Strobe",        durationS: 3.0, colors: ["#ffffff"] },
};

const r1 = (v) => Math.round(v * 10) / 10;

const entry = (key, family, label, color, pyro) => ({
  key, category: "Pyro", family, label, color, icon: "✷",
  engineering: { pyro: { ...pyro, dataSource: ESTIMATE }, controlProtocol: "Firing system (export only)" },
  tags: ["pyro", "fireworks", pyro.effect, pyro.kind],
});

const shells = [];
for (const calibre of [50, 75, 100, 125]) {
  for (const [effect, fx] of Object.entries(SHELL_EFFECTS)) {
    shells.push(entry(`pyro_shell_${calibre}_${effect}`, "Aerial shells", `${calibre} mm ${fx.label} shell`, fx.colors[0], {
      kind: "shell", effect, calibreMm: calibre, colors: fx.colors,
      liftTimeS: LIFT_BY_CALIBRE[calibre], burstHeightM: r1(calibre * HEIGHT_M_PER_MM), burstRadiusM: r1(calibre * BURST_RADIUS_M_PER_MM),
      durationS: fx.durationS, shots: 1, intervalS: 0, safetyDistanceM: r1(calibre * SAFETY_M_PER_MM), aerial: true,
    }));
  }
}

export const PYRO_PRODUCTS = [
  ...shells,
  entry("pyro_cake_25_30mm", "Cakes", "25-shot cake (30 mm)", "#ff6a3d", {
    kind: "cake", effect: "peony", calibreMm: 30, colors: ["#ff6a3d", "#ffe066", "#60c0ff"],
    liftTimeS: 1.4, burstHeightM: 35, burstRadiusM: 8, durationS: 1.4, shots: 25, intervalS: 0.35, fanDeg: 30,
    safetyDistanceM: r1(30 * SAFETY_M_PER_MM), aerial: true,
  }),
  entry("pyro_cake_100_20mm", "Cakes", "100-shot cake (20 mm)", "#ffd94a", {
    kind: "cake", effect: "strobe", calibreMm: 20, colors: ["#ffffff", "#ffd94a"],
    liftTimeS: 1.0, burstHeightM: 25, burstRadiusM: 5, durationS: 1.2, shots: 100, intervalS: 0.12, fanDeg: 45,
    safetyDistanceM: r1(20 * SAFETY_M_PER_MM), aerial: true,
  }),
  entry("pyro_comet_30mm", "Comets", "30 mm comet (gold tail)", "#ffc04a", {
    kind: "comet", effect: "comet", calibreMm: 30, colors: ["#ffc04a"],
    liftTimeS: 1.8, burstHeightM: 40, burstRadiusM: 0, durationS: 1.8, shots: 1, intervalS: 0,
    safetyDistanceM: r1(30 * SAFETY_M_PER_MM), aerial: true,
  }),
  entry("pyro_mine_75mm", "Mines", "75 mm mine", "#ff4060", {
    kind: "mine", effect: "mine", calibreMm: 75, colors: ["#ff4060", "#ffe080"],
    liftTimeS: 0, burstHeightM: 30, burstRadiusM: 6, durationS: 1.6, shots: 1, intervalS: 0,
    safetyDistanceM: r1(75 * SAFETY_M_PER_MM), aerial: true,
  }),
  // Ground fountains (gerbs): proximate-type devices — 2 × the spray height, at least 10 m here.
  entry("pyro_gerb_6m_10s", "Gerbs / fountains", "Gerb 6 m × 10 s (silver)", "#e8ecff", {
    kind: "gerb", effect: "gerb", calibreMm: 0, colors: ["#e8ecff", "#ffd27a"],
    liftTimeS: 0, burstHeightM: 6, burstRadiusM: 1.5, durationS: 10, shots: 1, intervalS: 0,
    safetyDistanceM: 12, aerial: false,
  }),
  entry("pyro_water_gerb_4m_15s", "Water effects", "Floating gerb 4 m × 15 s", "#ffd27a", {
    kind: "gerb", effect: "gerb", calibreMm: 0, colors: ["#ffd27a"], onWater: true,
    liftTimeS: 0, burstHeightM: 4, burstRadiusM: 1.2, durationS: 15, shots: 1, intervalS: 0,
    safetyDistanceM: 10, aerial: false,
  }),
  entry("pyro_water_mine_50mm", "Water effects", "50 mm water mine", "#40c0ff", {
    kind: "mine", effect: "mine", calibreMm: 50, colors: ["#40c0ff", "#ffffff"], onWater: true,
    liftTimeS: 0, burstHeightM: 20, burstRadiusM: 4, durationS: 1.5, shots: 1, intervalS: 0,
    safetyDistanceM: r1(50 * SAFETY_M_PER_MM), aerial: true,
  }),
];

export const PYRO_BY_KEY = new Map(PYRO_PRODUCTS.map((p) => [p.key, p]));
