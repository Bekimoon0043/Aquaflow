/**
 * Fireworks catalogue for the designer's Fireworks tool (every entry has category "Pyro", grouped by
 * `family`). Two kinds of product:
 *
 *   - Real pyrotechnics (`pyro_*`, `pyro: true`): previewed, programmed as burst-time cues and
 *     EXPORTED as a firing script. AquaFlow never fires them: the operator arms and fires on the
 *     firing system. One `pyro_fire` cue channel.
 *   - Fireworks-like special effects (`sfx_*`, `pyro: false`): cold spark, flame, CO2, confetti and
 *     smoke machines. They are DMX/relay equipment with normal channels (resolverKey), go to the
 *     hardware outputs like lights do, and follow the existing interlock rules.
 *
 * Every number is an ESTIMATE from published rules of thumb, not a product data sheet:
 *   - Spectator distance, aerial display items: NFPA 1123 — 70 ft per inch of internal mortar /
 *     tube diameter ≈ 0.84 m per mm (75 mm → 63 m).
 *   - Burst height: about 100 ft per inch ≈ 1.2 m per mm. Burst diameter: about 70 ft per inch
 *     (radius 0.42 m per mm).
 *   - Lift time (ignition → burst): 1.8 s (50 mm) to 4 s (150 mm).
 *   - Proximate / close-proximity items (gerbs, flash pots, airbursts, stage gerbs): NFPA 1126 —
 *     at least 15 ft (4.6 m) from the audience, more than the effect's own spray or burst size.
 *   - Hazard class: UN 1.3G display articles, 1.4G (consumer / some proximate), 1.4S (theatrical).
 * Replace every value with the supplier's data sheet before a real display.
 */

const SAFETY_M_PER_MM = 0.84;
const HEIGHT_M_PER_MM = 1.2;
const BURST_RADIUS_M_PER_MM = 0.42;
const PROXIMATE_MIN_M = 4.6;
const ESTIMATE = "Estimate from rules of thumb (NFPA 1123: 70 ft/in spectator distance, ~100 ft/in height, ~70 ft/in burst diameter) — replace with the product data sheet";
const ESTIMATE_PROXIMATE = "Estimate (NFPA 1126 proximate pyrotechnics: ≥ 15 ft / 4.6 m from the audience and more than the effect's own size) — replace with the product data sheet";
const ESTIMATE_SFX = "Estimate from typical manufacturer ranges for this machine class — replace with the product data sheet";

const r1 = (v) => Math.round(v * 10) / 10;
const aerialSafety = (mm) => r1(mm * SAFETY_M_PER_MM);
const proximateSafety = (sizeM) => r1(Math.max(PROXIMATE_MIN_M, sizeM));

const LIFT_BY_CALIBRE = { 50: 1.8, 75: 2.4, 100: 3.0, 125: 3.5, 150: 4.0 };

// Shell effects: star duration (s), colours, and a burst-size factor (1 = the calibre rule).
const SHELL_EFFECTS = {
  peony:         { label: "Peony",                   durationS: 1.8, colors: ["#ff3040", "#ffd060"], size: 1 },
  chrysanthemum: { label: "Chrysanthemum",           durationS: 2.4, colors: ["#ffd27a", "#40a0ff"], size: 1 },
  dahlia:        { label: "Dahlia",                  durationS: 2.6, colors: ["#ff5a1f", "#ffe24a"], size: 1.05 },
  willow:        { label: "Willow",                  durationS: 5.5, colors: ["#ffb347"], size: 1.1 },
  kamuro:        { label: "Kamuro (gold brocade)",   durationS: 6.5, colors: ["#ffcc66"], size: 1.15 },
  palm:          { label: "Palm",                    durationS: 3.5, colors: ["#ffcf5a", "#30ff7a"], size: 0.9 },
  crossette:     { label: "Crossette",               durationS: 2.6, colors: ["#e8f0ff", "#ff5ad0"], size: 1 },
  strobe:        { label: "Strobe / glitter",        durationS: 3.0, colors: ["#ffffff"], size: 1 },
  ring:          { label: "Ring",                    durationS: 2.0, colors: ["#30d0ff", "#ffffff"], size: 0.9 },
  heart:         { label: "Heart pattern",           durationS: 2.0, colors: ["#ff2a6a"], size: 0.8 },
  star:          { label: "Star pattern",            durationS: 2.0, colors: ["#ffe24a"], size: 0.8 },
  smiley:        { label: "Smiley pattern",          durationS: 2.0, colors: ["#ffd400", "#ff6a00"], size: 0.8 },
  horsetail:     { label: "Horsetail",               durationS: 4.0, colors: ["#ffd27a"], size: 0.7 },
  crackling:     { label: "Crackling (dragon eggs)", durationS: 2.8, colors: ["#ffffff", "#ffe8b0"], size: 0.9 },
  salute:        { label: "Salute (report)",         durationS: 0.35, colors: ["#ffffff"], size: 0.4 },
  multibreak:    { label: "Multi-break (3 breaks)",  durationS: 1.6, colors: ["#ff3040", "#40ff70", "#4080ff"], size: 0.75, breaks: 3 },
  colorchange:   { label: "Colour-changing",         durationS: 2.6, colors: ["#ff2a2a", "#2a9bff"], size: 1 },
  comettail:     { label: "Comet-tail (rising tail)", durationS: 2.2, colors: ["#ffb347", "#ff3040"], size: 1 },
};

const entry = (key, family, label, color, data, extra = {}) => ({
  key, category: "Pyro", family, label, color, icon: "✷", pyro: true,
  engineering: { pyro: { dataSource: ESTIMATE, hazardClass: "1.3G", closeProximity: false, indoor: false, ...data }, controlProtocol: "Firing system (export only)" },
  tags: ["pyro", "fireworks", data.effect, data.kind, family.toLowerCase()],
  ...extra,
});

// ── Aerial shells: every effect in every common calibre ─────────────────────────
const shells = [];
for (const calibre of [50, 75, 100, 125, 150]) {
  for (const [effect, fx] of Object.entries(SHELL_EFFECTS)) {
    shells.push(entry(`pyro_shell_${calibre}_${effect}`, `Aerial shells ${calibre} mm`, `${calibre} mm ${fx.label} shell`, fx.colors[0], {
      kind: "shell", effect, calibreMm: calibre, colors: fx.colors,
      liftTimeS: LIFT_BY_CALIBRE[calibre], burstHeightM: r1(calibre * HEIGHT_M_PER_MM), burstRadiusM: r1(calibre * BURST_RADIUS_M_PER_MM * fx.size),
      durationS: fx.durationS, shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(calibre), aerial: true,
      ...(fx.breaks ? { breaks: fx.breaks } : {}),
    }));
  }
}

// ── Cakes (multi-shot batteries): straight, fans, zipper, finale ────────────────
const cake = (key, label, mm, shots, intervalS, pattern, effect, colors, fanDeg = 0) => entry(key, "Cakes", label, colors[0], {
  kind: "cake", effect, pattern, calibreMm: mm, colors, liftTimeS: r1(0.6 + mm * 0.03), burstHeightM: r1(mm * 1.15), burstRadiusM: r1(mm * 0.25),
  durationS: 1.4, shots, intervalS, fanDeg, safetyDistanceM: aerialSafety(mm), aerial: true, hazardClass: mm <= 30 ? "1.4G" : "1.3G",
});
const cakes = [
  cake("pyro_cake_25_30mm", "25-shot straight cake (30 mm)", 30, 25, 0.35, "straight", "peony", ["#ff6a3d", "#ffe066", "#60c0ff"]),
  cake("pyro_cake_49_30mm_fan", "49-shot fan cake (30 mm)", 30, 49, 0.25, "fan", "chrysanthemum", ["#ffd27a", "#ff3a6a"], 60),
  cake("pyro_cake_36_30mm_v", "36-shot V-fan cake (30 mm)", 30, 36, 0.3, "vfan", "peony", ["#40ff90", "#ffffff"], 50),
  cake("pyro_cake_36_30mm_w", "36-shot W-fan cake (30 mm)", 30, 36, 0.3, "wfan", "dahlia", ["#ff5a1f", "#ffe24a"], 60),
  cake("pyro_cake_100_20mm_zipper", "100-shot Z / zipper cake (20 mm)", 20, 100, 0.08, "zipper", "strobe", ["#ffffff", "#ffd94a"], 70),
  cake("pyro_cake_100_20mm", "100-shot straight cake (20 mm)", 20, 100, 0.12, "straight", "strobe", ["#ffffff", "#ffd94a"]),
  cake("pyro_cake_200_25mm_finale", "200-shot finale cake (25 mm)", 25, 200, 0.06, "fan", "peony", ["#ff3040", "#40ff70", "#4080ff", "#ffd060"], 45),
  cake("pyro_cake_500_20mm_finale", "500-shot finale cake (20 mm)", 20, 500, 0.03, "wfan", "crackling", ["#ffffff", "#ffd27a", "#ff4060"], 60),
  cake("pyro_cake_25_50mm_kamuro", "25-shot kamuro cake (50 mm)", 50, 25, 0.6, "straight", "kamuro", ["#ffcc66"]),
  cake("pyro_cake_30_30mm_willow", "30-shot willow fan cake (30 mm)", 30, 30, 0.4, "fan", "willow", ["#ffb347"], 40),
];

// ── Comets, roman candles, single shots, mines ─────────────────────────────────
const comets = [
  entry("pyro_comet_30mm", "Comets & candles", "30 mm comet (gold tail)", "#ffc04a", {
    kind: "comet", effect: "comet", calibreMm: 30, colors: ["#ffc04a"], liftTimeS: 1.8, burstHeightM: 40, burstRadiusM: 0, durationS: 1.8,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(30), aerial: true }),
  entry("pyro_comet_50mm_silver", "Comets & candles", "50 mm comet (silver tail)", "#e8ecff", {
    kind: "comet", effect: "comet", calibreMm: 50, colors: ["#e8ecff"], liftTimeS: 2.2, burstHeightM: 60, burstRadiusM: 0, durationS: 2.2,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(50), aerial: true }),
  entry("pyro_comet_50mm_crossette", "Comets & candles", "50 mm crossette comet", "#ffffff", {
    kind: "comet", effect: "crossettecomet", calibreMm: 50, colors: ["#ffffff", "#ffd27a"], liftTimeS: 2.0, burstHeightM: 55, burstRadiusM: 12, durationS: 2.6,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(50), aerial: true }),
  entry("pyro_candle_8ball_25mm", "Comets & candles", "8-ball roman candle (25 mm)", "#ff3a6a", {
    kind: "candle", effect: "candle", calibreMm: 25, colors: ["#ff3a6a", "#40ff90", "#4080ff", "#ffd060"], liftTimeS: 0, burstHeightM: 25, burstRadiusM: 0,
    durationS: 1.4, shots: 8, intervalS: 0.8, safetyDistanceM: aerialSafety(25), aerial: true, hazardClass: "1.4G" }),
  entry("pyro_candle_10ball_30mm_comet", "Comets & candles", "10-ball comet candle (30 mm)", "#ffc04a", {
    kind: "candle", effect: "candle", calibreMm: 30, colors: ["#ffc04a"], liftTimeS: 0, burstHeightM: 32, burstRadiusM: 0,
    durationS: 1.6, shots: 10, intervalS: 0.7, safetyDistanceM: aerialSafety(30), aerial: true }),
  entry("pyro_single_shot_30mm", "Comets & candles", "Single shot (30 mm, peony)", "#ff6a3d", {
    kind: "shot", effect: "peony", calibreMm: 30, colors: ["#ff6a3d", "#ffe066"], liftTimeS: 1.4, burstHeightM: 35, burstRadiusM: 8, durationS: 1.4,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(30), aerial: true, hazardClass: "1.4G" }),
];
const mines = [
  entry("pyro_mine_75mm", "Mines", "75 mm ground mine", "#ff4060", {
    kind: "mine", effect: "mine", calibreMm: 75, colors: ["#ff4060", "#ffe080"], liftTimeS: 0, burstHeightM: 30, burstRadiusM: 6, durationS: 1.6,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(75), aerial: true }),
  entry("pyro_mine_50mm_crackling", "Mines", "50 mm crackling mine", "#ffffff", {
    kind: "mine", effect: "mine", calibreMm: 50, colors: ["#ffffff", "#ffe8b0"], liftTimeS: 0, burstHeightM: 22, burstRadiusM: 5, durationS: 2.2,
    shots: 1, intervalS: 0, crackle: true, safetyDistanceM: aerialSafety(50), aerial: true }),
  entry("pyro_mine_100mm_aerial", "Mines", "100 mm aerial mine (bursts at 40 m)", "#40c0ff", {
    kind: "mine", effect: "mine", calibreMm: 100, colors: ["#40c0ff", "#ffffff"], liftTimeS: 1.6, burstHeightM: 45, burstRadiusM: 9, durationS: 1.8,
    shots: 1, intervalS: 0, fromHeightM: 40, safetyDistanceM: aerialSafety(100), aerial: true }),
];

// ── Ground effects: gerbs, waterfalls, wheels, lancework ───────────────────────
const gerb = (key, label, heightM, durationS, colors, extra = {}) => entry(key, "Gerbs & ground effects", label, colors[0], {
  kind: "gerb", effect: "gerb", calibreMm: 0, colors, liftTimeS: 0, burstHeightM: heightM, burstRadiusM: r1(heightM * 0.25), durationS,
  shots: 1, intervalS: 0, safetyDistanceM: proximateSafety(heightM * 2), aerial: false, hazardClass: "1.4G", dataSource: ESTIMATE_PROXIMATE, ...extra,
});
const ground = [
  gerb("pyro_gerb_1m_10s", "Gerb 1 m × 10 s (silver)", 1, 10, ["#e8ecff"]),
  gerb("pyro_gerb_3m_15s", "Gerb 3 m × 15 s (gold)", 3, 15, ["#ffd27a"]),
  gerb("pyro_gerb_6m_10s", "Gerb 6 m × 10 s (silver)", 6, 10, ["#e8ecff", "#ffd27a"]),
  gerb("pyro_gerb_8m_30s", "Gerb 8 m × 30 s (gold crackle)", 8, 30, ["#ffcc66", "#ffffff"], { crackle: true }),
  entry("pyro_waterfall_10m", "Gerbs & ground effects", "Waterfall / Niagara 10 m wide × 30 s", "#e8ecff", {
    kind: "waterfall", effect: "waterfall", calibreMm: 0, colors: ["#e8ecff", "#ffd27a"], liftTimeS: 0, burstHeightM: 8, burstRadiusM: 0, widthM: 10, durationS: 30,
    shots: 1, intervalS: 0, safetyDistanceM: 15, aerial: false, hazardClass: "1.3G" }),
  entry("pyro_waterfall_30m", "Gerbs & ground effects", "Waterfall / Niagara 30 m wide × 45 s", "#ffd27a", {
    kind: "waterfall", effect: "waterfall", calibreMm: 0, colors: ["#ffd27a"], liftTimeS: 0, burstHeightM: 12, burstRadiusM: 0, widthM: 30, durationS: 45,
    shots: 1, intervalS: 0, safetyDistanceM: 20, aerial: false, hazardClass: "1.3G" }),
  entry("pyro_wheel_1_5m", "Gerbs & ground effects", "Catherine wheel 1.5 m × 30 s", "#ffd27a", {
    kind: "wheel", effect: "wheel", calibreMm: 0, colors: ["#ffd27a", "#ff4060"], liftTimeS: 0, burstHeightM: 3, burstRadiusM: 0.75, diameterM: 1.5, durationS: 30,
    shots: 1, intervalS: 0, safetyDistanceM: 10, aerial: false, hazardClass: "1.4G" }),
  entry("pyro_wheel_3m", "Gerbs & ground effects", "Spinner wheel 3 m × 40 s", "#e8ecff", {
    kind: "wheel", effect: "wheel", calibreMm: 0, colors: ["#e8ecff", "#40c0ff"], liftTimeS: 0, burstHeightM: 4, burstRadiusM: 1.5, diameterM: 3, durationS: 40,
    shots: 1, intervalS: 0, safetyDistanceM: 15, aerial: false, hazardClass: "1.3G" }),
  // Lancework: the outline comes from engineering.lanceOutline ([[x, y], …] metres, x across, y up)
  // when the designer sets it; otherwise a 5-pointed star.
  entry("pyro_lancework_set_piece", "Gerbs & ground effects", "Lancework set piece (logo / text outline) × 40 s", "#ff3a3a", {
    kind: "lancework", effect: "lancework", calibreMm: 0, colors: ["#ff3a3a", "#ffffff"], liftTimeS: 0, burstHeightM: 4, burstRadiusM: 3, widthM: 6, durationS: 40,
    shots: 1, intervalS: 0, safetyDistanceM: 15, aerial: false, hazardClass: "1.4G" }),
];

// ── Close-proximity / stage pyrotechnics (NFPA 1126) ───────────────────────────
const prox = (key, label, effect, heightM, radiusM, durationS, colors, safety, hazardClass = "1.4G") => entry(key, "Close-proximity & stage", label, colors[0], {
  kind: "proximate", effect, calibreMm: 0, colors, liftTimeS: effect === "airburst" ? 0.25 : 0, burstHeightM: heightM, burstRadiusM: radiusM, durationS,
  shots: 1, intervalS: 0, safetyDistanceM: proximateSafety(safety), aerial: false, closeProximity: true, indoor: true, hazardClass, dataSource: ESTIMATE_PROXIMATE,
});
const proximate = [
  prox("pyro_flash_pot", "Flash pot (white flash, 3 m)", "flashpot", 3, 1.2, 0.5, ["#ffffff", "#fff2c0"], 4.6, "1.4S"),
  prox("pyro_concussion_mortar", "Concussion mortar (bang + flash)", "flashpot", 2, 1, 0.3, ["#ffffff"], 7.6, "1.4G"),
  prox("pyro_airburst_5m", "Airburst 5 m (silver)", "airburst", 5, 2.5, 0.8, ["#e8ecff"], 6),
  prox("pyro_airburst_10m_red", "Airburst 10 m (red)", "airburst", 10, 3.5, 1.0, ["#ff3040"], 8),
  prox("pyro_stage_gerb_3m_3s", "Stage gerb 3 m × 3 s", "gerb", 3, 0.5, 3, ["#e8ecff"], 6),
  prox("pyro_stage_gerb_5m_5s", "Stage gerb 5 m × 5 s (gold)", "gerb", 5, 0.8, 5, ["#ffd27a"], 10),
];

// ── Water-surface pyrotechnics ─────────────────────────────────────────────────
const water = [
  entry("pyro_water_shell_75mm", "Water-surface pyro", "75 mm water shell (half-sphere on the water)", "#40c0ff", {
    kind: "watershell", effect: "watershell", calibreMm: 75, colors: ["#40c0ff", "#ffffff"], onWater: true, liftTimeS: 0.8, burstHeightM: 0, burstRadiusM: r1(75 * 0.3), durationS: 1.8,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(75), aerial: false }),
  entry("pyro_water_shell_100mm", "Water-surface pyro", "100 mm water shell (gold)", "#ffd27a", {
    kind: "watershell", effect: "watershell", calibreMm: 100, colors: ["#ffd27a"], onWater: true, liftTimeS: 1.0, burstHeightM: 0, burstRadiusM: r1(100 * 0.3), durationS: 2.4,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(100), aerial: false }),
  entry("pyro_water_mine_50mm", "Water-surface pyro", "50 mm water mine", "#40c0ff", {
    kind: "mine", effect: "mine", calibreMm: 50, colors: ["#40c0ff", "#ffffff"], onWater: true, liftTimeS: 0, burstHeightM: 20, burstRadiusM: 4, durationS: 1.5,
    shots: 1, intervalS: 0, safetyDistanceM: aerialSafety(50), aerial: true }),
  entry("pyro_water_gerb_4m_15s", "Water-surface pyro", "Floating gerb 4 m × 15 s", "#ffd27a", {
    kind: "gerb", effect: "gerb", calibreMm: 0, colors: ["#ffd27a"], onWater: true, liftTimeS: 0, burstHeightM: 4, burstRadiusM: 1.2, durationS: 15,
    shots: 1, intervalS: 0, safetyDistanceM: 10, aerial: false, hazardClass: "1.4G", dataSource: ESTIMATE_PROXIMATE }),
  entry("pyro_water_comet_swimmer", "Water-surface pyro", "Water comet / swimmer (skims 40 m)", "#ffcc66", {
    kind: "swimmer", effect: "swimmer", calibreMm: 30, colors: ["#ffcc66"], onWater: true, liftTimeS: 0, burstHeightM: 0.5, burstRadiusM: 0, rangeM: 40, durationS: 5,
    shots: 1, intervalS: 0, safetyDistanceM: 25, aerial: false }),
  entry("pyro_water_fish_swarm", "Water-surface pyro", "Water fish swarm (20 skimmers)", "#ffffff", {
    kind: "swimmer", effect: "fish", calibreMm: 20, colors: ["#ffffff", "#ffd27a"], onWater: true, liftTimeS: 0, burstHeightM: 0.3, burstRadiusM: 0, rangeM: 12, durationS: 3,
    shots: 20, intervalS: 0.05, safetyDistanceM: 15, aerial: false }),
];

export const PYRO_PRODUCTS = [...shells, ...cakes, ...comets, ...mines, ...ground, ...proximate, ...water];

// ── Fireworks-like special effects (not pyrotechnics; DMX/relay controlled) ───────
// `resolverKey` picks the runtime template (fixtureTypeResolver) that gives the normal channels:
// sparkler/cryo/confetti → device_enable + device_intensity, flame → fire_trigger + fire_intensity,
// fog → fog_density. Intensity scales the effect (spark height, flame height, plume, output).
const sfx = (key, family, label, color, resolverKey, data, engineering = {}) => ({
  key, category: "Pyro", family, label, color, icon: "✦", pyro: false, resolverKey,
  engineering: { controlProtocol: "DMX512 (interlocked)", dmxChannels: 2, ...engineering,
    sfx: { dataSource: ESTIMATE_SFX, closeProximity: true, indoor: true, ...data } },
  tags: ["sfx", "fireworks", data.effect, family.toLowerCase()],
});
export const SFX_PRODUCTS = [
  sfx("sfx_cold_spark_3m", "Cold spark machines", "Cold spark machine 1–3 m", "#ffe8b0", "sparkler",
    { effect: "coldspark", controlChannel: "device_intensity", heightM: 3, colors: ["#fff6dc", "#ffcc66"], safetyDistanceM: 1.5 }, { wattage: 600, voltage: 220 }),
  sfx("sfx_cold_spark_5m", "Cold spark machines", "Cold spark machine 1–5 m (outdoor)", "#ffe8b0", "sparkler",
    { effect: "coldspark", controlChannel: "device_intensity", heightM: 5, colors: ["#fff6dc", "#ffcc66"], safetyDistanceM: 2 }, { wattage: 750, voltage: 220 }),
  sfx("sfx_cold_spark_waterfall", "Cold spark machines", "Cold spark waterfall (hung, 4 m drop)", "#ffe8b0", "sparkler",
    { effect: "coldsparkfall", controlChannel: "device_intensity", heightM: 4, colors: ["#fff6dc"], safetyDistanceM: 2 }, { wattage: 600, voltage: 220, mountHeightM: 4 }),
  sfx("sfx_flame_projector_8m", "Flame projectors", "Flame projector 8 m (as Single Flame Jet)", "#ff3300", "flame",
    { effect: "flame", controlChannel: "fire_intensity", heightM: 8, colors: ["#ff7a1a", "#ffd24a"], safetyDistanceM: 3, linkedProduct: "effect_flame_single" },
    { wattage: 80, voltage: 220, gasType: "LPG", gasFlow: 1.2, safetyZoneM: 3 }),
  sfx("sfx_flame_burst_10m", "Flame projectors", "Flame burst 10 m (as Flame Burst Module)", "#ff2200", "flame_burst",
    { effect: "flame", controlChannel: "fire_intensity", heightM: 10, colors: ["#ff6a10", "#ffcc40"], safetyDistanceM: 5, linkedProduct: "effect_flame_burst" },
    { wattage: 120, voltage: 220, gasType: "LPG", gasFlow: 2.5, safetyZoneM: 5 }),
  sfx("sfx_co2_jet_8m", "CO2 / cryo jets", "CO2 jet 8 m (vertical plume)", "#eef6ff", "cryo",
    { effect: "co2", controlChannel: "device_intensity", heightM: 8, colors: ["#f2f7ff"], safetyDistanceM: 2 }, { co2ConsumptionKgPerMin: 2 }),
  sfx("sfx_cryo_cannon_12m", "CO2 / cryo jets", "Cryo cannon 12 m", "#eef6ff", "cryo",
    { effect: "co2", controlChannel: "device_intensity", heightM: 12, colors: ["#f2f7ff"], safetyDistanceM: 3 }, { co2ConsumptionKgPerMin: 4 }),
  sfx("sfx_confetti_cannon", "Confetti & streamers", "Confetti cannon (15 m throw)", "#f472b6", "confetti",
    { effect: "confetti", controlChannel: "device_intensity", heightM: 15, colors: ["#ff3a6a", "#ffd400", "#30d0ff", "#40ff90", "#ffffff"], safetyDistanceM: 2 }),
  sfx("sfx_streamer_cannon", "Confetti & streamers", "Streamer cannon (gold, 20 m)", "#ffcc66", "confetti",
    { effect: "streamer", controlChannel: "device_intensity", heightM: 20, colors: ["#ffcc66", "#ffffff"], safetyDistanceM: 2 }),
  sfx("sfx_smoke_low_fog", "Smoke & haze", "Low fog / smoke machine", "#ccccff", "fog",
    { effect: "smoke", controlChannel: "fog_density", heightM: 1.5, colors: ["#9aa0b0"], safetyDistanceM: 0 }),
  sfx("sfx_haze_machine", "Smoke & haze", "Haze machine (for laser and light beams)", "#ccccff", "fog",
    { effect: "haze", controlChannel: "fog_density", heightM: 6, colors: ["#8890a0"], safetyDistanceM: 0 }),
];

export const PYRO_BY_KEY = new Map(PYRO_PRODUCTS.map((p) => [p.key, p]));
export const SFX_BY_KEY = new Map(SFX_PRODUCTS.map((p) => [p.key, p]));
/** Every product the Fireworks tool lists (real pyro first, then the special effects). */
export const FIREWORKS_CATALOGUE = [...PYRO_PRODUCTS, ...SFX_PRODUCTS];
