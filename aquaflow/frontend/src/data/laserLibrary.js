/**
 * Laser projectors for fountain and water shows (category "Laser", grouped by `family`).
 *
 * Numbers are TYPICAL MANUFACTURER RANGES for each class of product (show-laser makers' spec
 * sheets: optical power, scan speed at ILDA 8°, divergence, aperture beam diameter, mains power),
 * not one product's datasheet — replace them with the chosen projector's datasheet.
 *
 * NOHD (nominal ocular hazard distance) is estimated for a static beam, IEC 60825-1 / ANSI Z136.1:
 *   NOHD = (√(4P / (π · MPE)) − a) / φ,  MPE = 25.4 W/m² (visible CW, 0.25 s aversion response),
 *   P optical power (W), a beam diameter at the aperture (m), φ full-angle divergence (rad).
 * Scanned beams expose the eye for far less time, so the real hazard of a moving look is lower; the
 * static figure is what a laser safety officer starts from.
 *
 * Every projector here is class 3B (≤ 0.5 W) or class 4: it needs an emergency stop, a key switch
 * and, in most countries, a show-laser variance or permit. AquaFlow never arms a laser.
 */

export const MPE_VISIBLE_W_M2 = 25.4;
const SPEC_BASIS = "Typical manufacturer ranges for this class of projector — verify against the chosen product's datasheet";

/** Static-beam NOHD in metres (0 when the beam is eye-safe at the aperture). */
export function nohdEstimateM(powerW, beamDiameterMm, divergenceMrad) {
  const a = beamDiameterMm / 1000, phi = divergenceMrad / 1000;
  const d = Math.sqrt((4 * powerW) / (Math.PI * MPE_VISIBLE_W_M2));
  return phi > 0 ? Math.max(0, Math.round((d - a) / phi)) : 0;
}

/** Laser class from optical power (visible CW): ≤ 5 mW 3R, ≤ 0.5 W 3B, above that class 4. */
export const laserClassFor = (powerW) => (powerW <= 0.005 ? "3R" : powerW <= 0.5 ? "3B" : "4");

const RGB = [638, 520, 450];
const ILDA_DMX = "ILDA / DMX512 / Art-Net (interlocked)";
const PRO = "ILDA / DMX512 / Art-Net / Pangolin FB4 (interlocked)";

/**
 * Engineering block shared by every laser: optics, control, safety and the look the 3D preview
 * gives it (laserKind → laser/laserRig.js KIND_PATTERN).
 */
export function laserSpec({ kind = "beam", powerW, wavelengthsNm = RGB, kpps = 30, divergenceMrad = 1.2, beamMm = 5, control = ILDA_DMX,
  ip = "IP65", mount = "Ground / truss", mainsW, dmx = 16, pan = 180, tilt = 180, mountHeightM = 0.5, rangeM = 150, extra = {} }) {
  return {
    laserKind: kind,
    opticalPowerW: powerW,
    wavelengthsNm,
    scanSpeedKpps: kpps,
    divergenceMrad,
    beamDiameterMm: beamMm,
    controlProtocol: control,
    ipRating: ip,
    laserClass: laserClassFor(powerW),
    nohdM: nohdEstimateM(powerW, beamMm, divergenceMrad),
    mountType: mount,
    wattage: mainsW,
    voltage: 230,
    dmxChannels: dmx,
    panRangeDeg: pan,
    tiltRangeDeg: tilt,
    mountHeightM,
    minBeamHeightM: 3,
    rangeM,
    interlock: "Key switch + emergency stop (class 3B/4)",
    specBasis: SPEC_BASIS,
    dataSource: SPEC_BASIS,
    ...extra,
  };
}

const COLOR_OF = { 532: "#3dff4f", 520: "#22ff88", 445: "#3d6bff", 450: "#3d6bff", 638: "#ff3040" };
const product = (key, family, label, color, spec, tags = []) => ({
  key, category: "Laser", family, label, color, icon: "◆",
  summary: `${spec.opticalPowerW >= 1 ? `${spec.opticalPowerW} W` : `${Math.round(spec.opticalPowerW * 1000)} mW`} · class ${spec.laserClass} · ${spec.ipRating}`,
  engineering: spec,
  tags: ["laser", spec.laserKind, ...tags],
});

const rgbShow = (w, ip, kpps, mainsW, extra = {}) => product(
  `laser_rgb_${w}w${ip === "IP65" ? "_ip65" : ""}`, "RGB show / beam lasers",
  `RGB show laser ${w} W (${ip === "IP65" ? "outdoor IP65" : "indoor IP20"})`, "#ff00cc",
  laserSpec({ powerW: w, kpps, mainsW, ip, control: w >= 20 ? PRO : ILDA_DMX, divergenceMrad: w >= 20 ? 1.0 : 1.2, beamMm: w >= 20 ? 7 : 5,
    mount: ip === "IP65" ? "Outdoor ground / pool edge (IP65 housing)" : "Indoor truss — needs a weather housing outdoors", rangeM: w >= 20 ? 400 : 150, ...extra }),
  ["rgb", ip.toLowerCase()]);

export const LASER_PRODUCTS = [
  // RGB show / beam lasers (the 5 W indoor and 20 W outdoor units are the long-standing library items).
  rgbShow(1, "IP20", 25, 60), rgbShow(1, "IP65", 25, 70),
  rgbShow(3, "IP20", 30, 150), rgbShow(3, "IP65", 30, 170),
  rgbShow(5, "IP65", 30, 270),
  rgbShow(10, "IP20", 40, 450), rgbShow(10, "IP65", 40, 480),
  rgbShow(30, "IP65", 60, 1200), rgbShow(60, "IP65", 60, 2200),

  // Single-colour beam lasers: brightest per watt (green), deep blue, red accents.
  product("laser_green_532_5w", "Single-colour beam lasers", "Green beam laser 532 nm 5 W (IP65)", COLOR_OF[532],
    laserSpec({ powerW: 5, wavelengthsNm: [532], kpps: 30, divergenceMrad: 1.0, beamMm: 4, mainsW: 200, rangeM: 300 }), ["green"]),
  product("laser_blue_445_10w", "Single-colour beam lasers", "Blue beam laser 445 nm 10 W (IP65)", COLOR_OF[445],
    laserSpec({ powerW: 10, wavelengthsNm: [445], kpps: 30, divergenceMrad: 1.5, beamMm: 6, mainsW: 300, rangeM: 250 }), ["blue"]),
  product("laser_red_638_3w", "Single-colour beam lasers", "Red beam laser 638 nm 3 W (IP65)", COLOR_OF[638],
    laserSpec({ powerW: 3, wavelengthsNm: [638], kpps: 30, divergenceMrad: 1.5, beamMm: 6, mainsW: 150, rangeM: 200 }), ["red"]),

  // Graphics on a water screen / mist curtain: text, logos and animations scanned onto the sheet.
  product("laser_graphics_waterscreen_10w", "Water-screen graphics lasers", "Water-screen graphics laser RGB 10 W (FB4)", "#33d6ff",
    laserSpec({ kind: "graphics", powerW: 10, kpps: 40, divergenceMrad: 0.8, beamMm: 5, control: PRO, mainsW: 500, mount: "Platform ≥ 3.5 m behind/beside the water screen, aimed at the sheet", mountHeightM: 3.5,
      rangeM: 120, extra: { graphic: "logo", projection: { target: "screen", distanceM: 25, centerHeightM: 8, widthM: 18, heightM: 9 } } }), ["graphics", "water screen", "logo", "text"]),
  product("laser_graphics_waterscreen_30w", "Water-screen graphics lasers", "Water-screen graphics laser RGB 30 W (FB4)", "#33d6ff",
    laserSpec({ kind: "graphics", powerW: 30, kpps: 60, divergenceMrad: 0.6, beamMm: 6, control: PRO, mainsW: 1300, mount: "Projection tower / platform", mountHeightM: 5,
      rangeM: 250, extra: { graphic: "logo", projection: { target: "screen", distanceM: 40, centerHeightM: 10, widthM: 26, heightM: 13 } } }), ["graphics", "water screen", "logo", "text"]),

  // Line generators (cylindrical optics) and liquid sky over a low fog layer.
  product("laser_fan_sheet_green_5w", "Fan / sheet & liquid-sky lasers", "Fan / sheet effect laser green 5 W (line generator)", COLOR_OF[532],
    laserSpec({ kind: "fan", powerW: 5, wavelengthsNm: [532], kpps: 0, divergenceMrad: 1.0, beamMm: 4, mainsW: 200, rangeM: 120,
      extra: { fanAngleDeg: 60 } }), ["fan", "sheet"]),
  product("laser_liquid_sky_rgb_10w", "Fan / sheet & liquid-sky lasers", "Liquid-sky laser RGB 10 W (low-fog layer)", "#ff00cc",
    laserSpec({ kind: "liquidsky", powerW: 10, kpps: 40, divergenceMrad: 1.2, beamMm: 5, mainsW: 450, mountHeightM: 3.5, rangeM: 80,
      mount: "Above head height (≥ 3.5 m), aimed level across the site; needs a low-fog layer" }), ["liquid sky", "fog"]),

  // Sky beams: long-range narrow beams seen for kilometres — aviation clearance required.
  product("laser_sky_green_10w", "Sky / searchlight lasers", "Sky beam laser green 532 nm 10 W", COLOR_OF[532],
    laserSpec({ kind: "sky", powerW: 10, wavelengthsNm: [532], kpps: 0, divergenceMrad: 0.5, beamMm: 6, mainsW: 400, rangeM: 3000, mountHeightM: 6,
      mount: "Roof / tower, vertical or near-vertical", extra: { aviation: true } }), ["sky", "searchlight", "aviation"]),
  product("laser_sky_rgb_30w", "Sky / searchlight lasers", "Sky searchlight laser RGB 30 W", "#ffffff",
    laserSpec({ kind: "sky", powerW: 30, kpps: 0, divergenceMrad: 0.4, beamMm: 8, control: PRO, mainsW: 1200, rangeM: 5000, mountHeightM: 6,
      mount: "Roof / tower, vertical or near-vertical", extra: { aviation: true } }), ["sky", "searchlight", "aviation"]),

  // Firefly / star-field: diffraction gratings split one beam into hundreds of weak dots.
  product("laser_firefly_gr_300mw", "Firefly / star-field lasers", "Firefly twinkle laser green-red 300 mW (IP65)", "#a8ff3a",
    laserSpec({ kind: "firefly", powerW: 0.3, wavelengthsNm: [532, 638], kpps: 0, divergenceMrad: 1.5, beamMm: 3, dmx: 4, mainsW: 25, rangeM: 40,
      mount: "Ground stake among planting / under trees", extra: { points: 300 } }), ["firefly", "garden", "twinkle"]),
  product("laser_starfield_rgb_2w", "Firefly / star-field lasers", "Star-field laser RGB 2 W (gobo grating)", "#ffffff",
    laserSpec({ kind: "firefly", powerW: 2, kpps: 0, divergenceMrad: 1.5, beamMm: 4, dmx: 8, mainsW: 90, rangeM: 60,
      mount: "Ground or pool edge, aimed over water / trees", extra: { points: 500 } }), ["star field", "twinkle"]),

  // Moving-head lasers: a beam laser on a pan/tilt yoke.
  product("laser_moving_head_rgb_3w", "Moving-head lasers", "Moving-head beam laser RGB 3 W", "#ff00cc",
    laserSpec({ kind: "movinghead", powerW: 3, kpps: 30, divergenceMrad: 1.2, beamMm: 5, dmx: 20, mainsW: 220, pan: 540, tilt: 270, rangeM: 150,
      mount: "Pool edge or truss (moving yoke)" }), ["moving head"]),

  // Façade mapping: outline graphics on buildings behind the fountain.
  product("laser_mapping_rgb_30w", "Architectural / mapping lasers", "Façade mapping laser RGB 30 W (FB4)", "#33d6ff",
    laserSpec({ kind: "mapping", powerW: 30, kpps: 60, divergenceMrad: 0.6, beamMm: 6, control: PRO, mainsW: 1300, rangeM: 300, mountHeightM: 5, mount: "Projection tower facing the façade",
      extra: { graphic: "logo", projection: { target: "plane", distanceM: 45, centerHeightM: 14, widthM: 34, heightM: 18 } } }), ["mapping", "facade", "architectural"]),
];

/**
 * Extra fields for the two long-standing laser keys (laser_rgb_5w indoor, laser_rgb_20w outdoor),
 * which stay in the curated library so existing projects keep working.
 */
export const LEGACY_LASER_SPECS = {
  laser_rgb_5w: { family: "RGB show / beam lasers", label: "RGB show laser 5 W (indoor IP20)",
    engineering: laserSpec({ powerW: 5, kpps: 30, mainsW: 250, ip: "IP20", mount: "Indoor truss — needs a weather housing outdoors", rangeM: 150 }) },
  laser_rgb_20w: { family: "RGB show / beam lasers", label: "RGB show laser 20 W (outdoor IP65)",
    engineering: laserSpec({ powerW: 20, kpps: 40, mainsW: 800, ip: "IP65", control: PRO, divergenceMrad: 1.0, beamMm: 7, mount: "Outdoor ground / pool edge (IP65 housing)", rangeM: 400 }) },
};
