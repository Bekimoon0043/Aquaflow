// Water physics for planning and checking shows — one ground truth for the generator's
// timing, the wind-safe heights and the splash check (Phase 4 of
// reports/Automatic fountain shows for any site.md). Pure, SI units, plan coordinates (x, y).
//
//   drops     quadratic air drag with the drop's terminal speed:  a = g − g·|v−w|(v−w)/vt²
//             vt(d) ≈ 9.65 − 10.3·e^(−0.6 d)  (Atlas et al. 1973 fit, d in mm — approximate)
//   column    a jet rises as a coherent column (effective terminal speed COLUMN_VT, calibratable)
//             and breaks into drops near its top: closed-form rise with quadratic drag,
//             apex = vt²/2g · ln(1 + v0²/vt²),  t_rise = vt/g · atan(v0/vt)
//   launch    the speed whose apex (with drag) is the commanded height
//   footprint where drops of a jet land, with wind, and the share that leaves the basin
//   wind-safe the highest share of design height whose 95th-percentile landing stays inside
//   timing    command → visible top = valve delay + rise time with drag (calibrated per nozzle)
//   calibrate fit delay, launch speed and drag from jet-tip points measured on video

export const G = 9.81;
/** Effective terminal speed of a rising coherent jet column (m/s) — default until calibrated. */
export const COLUMN_VT = 30;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Terminal speed (m/s) of a water drop of diameter d (mm). Approximation; 0.1–6 mm. */
export function terminalSpeed(dMm) {
  const d = clamp(Number(dMm) || 1, 0.1, 6);
  return Math.max(0.3, 9.65 - 10.3 * Math.exp(-0.6 * d));
}

/** Drop sizes (mm) and weights a jet breaks into: mostly ~1.9× bore (capped), some spray. */
export function dropSpectrum(nozzleDiaMm = 10, aerated = false) {
  const main = clamp(1.9 * (Number(nozzleDiaMm) || 10) / 10, 1, 5);   // coarse: the column breaks into large drops (unverified)
  if (aerated) return [[0.6, 0.4], [1.2, 0.4], [main, 0.2]];
  return [[main, 0.55], [main * 0.6, 0.25], [0.8, 0.15], [0.4, 0.05]];
}

/** RK4 flight of one drop: start (x, y, z), velocity, wind (wx, wy) m/s. Returns landing + apex. */
export function flyDrop({ x = 0, y = 0, z = 0, vx = 0, vy = 0, vz = 0, vt = 9, wind = [0, 0], dt = 0.01, maxT = 30 }) {
  let s = [x, y, z, vx, vy, vz];
  const k = G / (vt * vt);
  const f = (q) => {
    const rx = q[3] - wind[0], ry = q[4] - wind[1], rz = q[5];
    const sp = Math.hypot(rx, ry, rz);
    return [q[3], q[4], q[5], -k * sp * rx, -k * sp * ry, -G - k * sp * rz];
  };
  let t = 0, apex = z, tApex = 0;
  while (t < maxT) {
    const a = f(s), b = f(s.map((v, i) => v + 0.5 * dt * a[i])), c = f(s.map((v, i) => v + 0.5 * dt * b[i])), d = f(s.map((v, i) => v + dt * c[i]));
    const n = s.map((v, i) => v + (dt / 6) * (a[i] + 2 * b[i] + 2 * c[i] + d[i]));
    t += dt;
    if (n[2] > apex) { apex = n[2]; tApex = t; }
    if (n[2] < 0 && n[5] < 0) {
      const u = s[2] / (s[2] - n[2]);
      return { x: s[0] + u * (n[0] - s[0]), y: s[1] + u * (n[1] - s[1]), t: t - dt + u * dt, apex, tApex };
    }
    s = n;
  }
  return { x: s[0], y: s[1], t, apex, tApex };
}

/** Launch speed whose drag-limited apex is `h` (vertical, terminal speed vt) — closed form. */
export function launchForApex(h, vt = COLUMN_VT) {
  if (!(h > 0)) return 0;
  const x = (2 * G * h) / (vt * vt);
  return x > 60 ? Infinity : vt * Math.sqrt(Math.expm1(x));
}

/** Time from launch to the top for a vertical jet of apex h (with drag) — closed form. */
export function riseTime(h, vt = COLUMN_VT) {
  if (!(h > 0)) return 0;
  return (vt / G) * Math.atan(launchForApex(h, vt) / vt);
}

/** Fall time of a drop from height h at rest (terminal speed vt) — closed form. */
export function fallTime(h, vt) {
  return h > 0 ? (vt / G) * Math.acosh(Math.exp((G * h) / (vt * vt))) : 0;
}

/**
 * Landing points of one nozzle's water.
 * @param {object} n { x, y, heightM, sprayAngleDeg?, tiltDeg?, azimuthDeg?, nozzleDiaMm?, aerated? }
 * @param {object} o { windMs, windDirDeg (direction the wind blows TO; plan degrees from +x), scale }
 */
export function footprint(n, { windMs = 0, windDirDeg = 0, scale = 1, samples = 8, columnVt = COLUMN_VT } = {}) {
  const h = Math.max(0, (Number(n.heightM) || 0) * scale);
  if (!(h > 0.05)) return [];
  const wr = (windDirDeg * Math.PI) / 180;
  const wind = [windMs * Math.cos(wr), windMs * Math.sin(wr)];
  const half = ((Number(n.sprayAngleDeg) || 6) / 2) * Math.PI / 180;
  const tilt = ((Number(n.tiltDeg) || 0) * Math.PI) / 180, az = ((Number(n.azimuthDeg) || 0) * Math.PI) / 180;
  // Column phase: rises to h in t_rise; it leans with its tilt / spray cone and drifts a little
  // with the wind (a coherent column is hard to push: 30 % of the wind speed).
  const tr = riseTime(h, columnVt), v0 = launchForApex(h, columnVt);
  const pts = [];
  for (let k = 0; k < samples; k++) {
    const phi = (2 * Math.PI * k) / samples, cone = half * (k % 2 ? 1 : 0.5);
    const ex = Math.sin(tilt) * Math.cos(az) + Math.sin(cone) * Math.cos(phi);
    const ey = Math.sin(tilt) * Math.sin(az) + Math.sin(cone) * Math.sin(phi);
    const ez = Math.cos(tilt) * Math.cos(cone);
    const l = Math.hypot(ex, ey, ez);
    const vh = (v0 * Math.hypot(ex, ey)) / l;
    // Horizontal travel during the rise (drag slows it like the vertical part).
    const reach = vh > 0 ? (columnVt * columnVt / G) * Math.log(1 + (G * vh * tr) / (columnVt * columnVt)) : 0;
    const hx = vh > 0 ? ex / Math.hypot(ex, ey) : 0, hy = vh > 0 ? ey / Math.hypot(ex, ey) : 0;
    const ax = n.x + reach * hx + 0.3 * wind[0] * tr, ay = n.y + reach * hy + 0.3 * wind[1] * tr;
    // Drop phase: from the top, each drop size falls and drifts with the wind.
    for (const [d, w] of dropSpectrum(n.nozzleDiaMm, n.aerated)) {
      const land = flyDrop({ x: ax, y: ay, z: h, vx: 0.4 * vh * hx, vy: 0.4 * vh * hy, vz: 0, vt: terminalSpeed(d), wind, dt: 0.04 });
      pts.push({ x: land.x, y: land.y, w: w / samples, d });
    }
  }
  return pts;
}

/** Point in polygon (plan), polygon as [{x, y}] or [[x, y]]. */
export function insidePolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = Array.isArray(poly[i]) ? { x: poly[i][0], y: poly[i][1] } : poly[i];
    const b = Array.isArray(poly[j]) ? { x: poly[j][0], y: poly[j][1] } : poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Weighted share of a nozzle's water that lands outside the basin (worst wind direction when unknown). */
export function oversprayShare(n, basin, { windMs = 0, windDirDeg = null, scale = 1 } = {}) {
  if (!basin?.length) return 0;
  // Unknown direction: the wind that pushes this jet's water out of the basin (away from its centre) ± 45°.
  let dirs = [windDirDeg ?? 0];
  if (windDirDeg == null && windMs > 0) {
    const pts = basin.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const out = (Math.atan2(n.y - cy, n.x - cx) * 180) / Math.PI;
    dirs = [out - 45, out, out + 45];
  }
  let worst = 0;
  for (const dir of dirs) {
    const pts = footprint(n, { windMs, windDirDeg: dir, scale });
    const total = pts.reduce((s, p) => s + p.w, 0) || 1;
    const out = pts.filter((p) => !insidePolygon(p.x, p.y, basin)).reduce((s, p) => s + p.w, 0) / total;
    worst = Math.max(worst, out);
  }
  return worst;
}

/** Highest share of design height (0..1, step 0.05) whose overspray stays ≤ `limit`. */
export function windSafeScale(n, basin, { windMs = 0, windDirDeg = null, limit = 0.05 } = {}) {
  if (!basin?.length || !(n.heightM > 0)) return 1;
  if (oversprayShare(n, basin, { windMs, windDirDeg, scale: 1 }) <= limit) return 1;
  let lo = 0, hi = 1;
  for (let i = 0; i < 6; i++) {
    const mid = (lo + hi) / 2;
    if (oversprayShare(n, basin, { windMs, windDirDeg, scale: mid }) <= limit) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 20) / 20;
}

/**
 * Command → visible top for a nozzle: valve / drive delay + rise time with drag.
 * Calibration (fitted from video) wins over the defaults.
 */
export function visibleLead(heightM, { delayS = 0.1, vt = COLUMN_VT } = {}) {
  return Math.min(4, delayS + riseTime(Number(heightM) || 0, vt || COLUMN_VT));
}

/**
 * Fit a nozzle from jet-tip heights measured on video: points [{ t, h }] (seconds from the
 * valve command, metres). Model: nothing until `delay`, then a vertical drag flight.
 * Returns { delayS, launchMs, apexM, vtMs, eta (apex / ideal apex for the launch speed), rms }.
 */
export function calibrateFromTrack(points) {
  const pts = (points || []).filter((p) => Number.isFinite(p.t) && Number.isFinite(p.h)).sort((a, b) => a.t - b.t);
  if (pts.length < 4) throw new Error('Mark the jet tip on at least 4 frames');
  const apexM = Math.max(...pts.map((p) => p.h));
  let best = null;
  for (let vt = 6; vt <= 80; vt *= 1.08) {
    const v0 = launchForApex(apexM, vt);
    // Height-vs-time curve of this flight (rise only matters for timing).
    const curve = [];
    let s = { z: 0, vz: v0 }, t = 0;
    const k = G / (vt * vt);
    while (s.vz > 0 || t === 0) { curve.push([t, s.z]); const a = -G - k * Math.abs(s.vz) * s.vz; s = { z: s.z + s.vz * 0.005, vz: s.vz + a * 0.005 }; t += 0.005; }
    const hAt = (tt) => { if (tt <= 0) return 0; const i = Math.min(curve.length - 1, Math.round(tt / 0.005)); return curve[i][1]; };
    // Delay: least squares over a grid.
    for (let delay = 0; delay <= 2; delay += 0.01) {
      const err = pts.reduce((sum, p) => sum + (hAt(p.t - delay) - p.h) ** 2, 0);
      if (!best || err < best.err) best = { err, delay, vt, v0 };
    }
  }
  const ideal = (best.v0 * best.v0) / (2 * G);
  return { delayS: Math.round(best.delay * 1000) / 1000, launchMs: Math.round(best.v0 * 100) / 100, apexM: Math.round(apexM * 100) / 100,
    vtMs: Math.round(best.vt * 10) / 10, eta: Math.round((apexM / ideal) * 1000) / 1000, rms: Math.round(Math.sqrt(best.err / pts.length) * 1000) / 1000 };
}
