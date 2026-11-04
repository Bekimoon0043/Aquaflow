/**
 * camera/cameraTrack.js — keyframed camera animation for the 3D preview and video bake.
 *
 * Pure: plain {x,y,z} objects, three.js world frame (y up), metres and seconds.
 *
 * A track is { enabled, keys:[{ id, t, position, target, fov, roll, ease, label? }] }.
 * Position and target each follow a centripetal Catmull-Rom spline through the keys, so a
 * move through 3+ keys is smooth with no overshoot loops. Each segment is timed by the
 * OUTGOING key's ease:
 *   smooth   — eases in at the start of a run of smooth keys and out at its end, constant
 *              speed through the keys in between (an 8-key orbit glides instead of stopping
 *              at every key)
 *   linear   — constant speed
 *   easeIn / easeOut — accelerate / decelerate over the segment
 *   hold, cut — stay on the key, then jump to the next key at its time
 */

export const DEFAULT_FOV = 50;
export const EASES = ["smooth", "linear", "easeIn", "easeOut", "hold", "cut"];
const SAME_T = 1e-3;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const vec = (v, d = { x: 0, y: 0, z: 0 }) => {
  if (!v || typeof v !== "object") return null;
  const x = Number(v.x), y = Number(v.y), z = Number(v.z ?? d.z);
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
};
const lerp = (a, b, u) => a + (b - a) * u;
const lerpV = (a, b, u) => ({ x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), z: lerp(a.z, b.z, u) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

let idSeq = 0;
const newId = () => `ck-${Date.now().toString(36)}-${(idSeq++).toString(36)}`;

function normalizeKey(k) {
  if (!k || typeof k !== "object") return null;
  const t = Number(k.t);
  const position = vec(k.position);
  const target = vec(k.target);
  if (!Number.isFinite(t) || t < 0 || !position || !target) return null;
  const fov = Math.min(150, Math.max(5, num(k.fov, DEFAULT_FOV)));
  const out = { id: k.id ? String(k.id) : newId(), t, position, target, fov, roll: num(k.roll, 0), ease: EASES.includes(k.ease) ? k.ease : "smooth" };
  if (k.label) out.label = String(k.label);
  return out;
}

/** Sorted, defaulted, valid keys with unique ids; keys at the same time keep the last one. */
export function normalizeCameraTrack(track) {
  const raw = Array.isArray(track?.keys) ? track.keys : [];
  const keys = [];
  const ids = new Set();
  for (const k of raw.map(normalizeKey).filter(Boolean)) {
    if (ids.has(k.id)) k.id = newId();
    ids.add(k.id);
    const same = keys.findIndex((o) => Math.abs(o.t - k.t) <= SAME_T);
    if (same >= 0) keys[same] = k; else keys.push(k);
  }
  keys.sort((a, b) => a.t - b.t);
  return { enabled: track?.enabled === undefined ? keys.length > 0 : Boolean(track.enabled), keys };
}

export function addCameraKey(track, key) {
  const base = normalizeCameraTrack(track);
  const k = normalizeKey(key);
  if (!k) return base;
  const keys = base.keys.filter((o) => Math.abs(o.t - k.t) > SAME_T && o.id !== k.id);
  return normalizeCameraTrack({ ...base, enabled: track?.enabled ?? true, keys: [...keys, k] });
}

export function updateCameraKey(track, id, patch = {}) {
  const base = normalizeCameraTrack(track);
  return normalizeCameraTrack({ ...base, keys: base.keys.map((k) => (k.id === id ? { ...k, ...patch, id } : k)) });
}

export function removeCameraKey(track, id) {
  const base = normalizeCameraTrack(track);
  return normalizeCameraTrack({ ...base, keys: base.keys.filter((k) => k.id !== id) });
}

export function moveCameraKey(track, id, t) {
  const base = normalizeCameraTrack(track);
  const key = base.keys.find((k) => k.id === id);
  if (!key || !Number.isFinite(Number(t))) return base;
  const nt = Math.max(0, Number(t));
  const keys = base.keys.filter((k) => k.id !== id && Math.abs(k.t - nt) > SAME_T);
  return normalizeCameraTrack({ ...base, keys: [...keys, { ...key, t: nt }] });
}

export function cameraKeyAt(track, t, tol = 0.05) {
  const keys = normalizeCameraTrack(track).keys;
  let best = null;
  for (const k of keys) {
    const d = Math.abs(k.t - t);
    if (d <= tol && (!best || d < Math.abs(best.t - t))) best = k;
  }
  return best;
}

// ── interpolation ───────────────────────────────────────────────────────────

/** Centripetal Catmull-Rom (Barry–Goldman) between p1 and p2, u in [0,1]. */
function catmullRom(p0, p1, p2, p3, u) {
  const knot = (a, b) => Math.max(Math.sqrt(dist(a, b)), 1e-4);
  const t0 = 0, t1 = t0 + knot(p0, p1), t2 = t1 + knot(p1, p2), t3 = t2 + knot(p2, p3);
  const t = lerp(t1, t2, u);
  const mix = (a, b, ta, tb) => lerpV(a, b, (t - ta) / (tb - ta));
  const a1 = mix(p0, p1, t0, t1), a2 = mix(p1, p2, t1, t2), a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, t0, t2), b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

const reflect = (a, b) => ({ x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * a.z - b.z });

function splineAt(points, i, u) {
  const p1 = points[i], p2 = points[i + 1];
  if (dist(p1, p2) < 1e-9) return { ...p1 };
  const p0 = i > 0 ? points[i - 1] : reflect(p1, p2);
  const p3 = i + 2 < points.length ? points[i + 2] : reflect(p2, p1);
  return catmullRom(p0, p1, p2, p3, u);
}

const smoothstep = (u) => u * u * (3 - 2 * u);
const easeInQ = (u) => u * u;
const easeOutQ = (u) => 1 - (1 - u) * (1 - u);

function easedU(keys, i, u) {
  const ease = keys[i].ease;
  if (ease === "hold" || ease === "cut") return 0;
  if (ease === "linear") return u;
  if (ease === "easeIn") return easeInQ(u);
  if (ease === "easeOut") return easeOutQ(u);
  // smooth: ease only where the smooth run starts / ends.
  const startsRun = i === 0 || keys[i - 1].ease !== "smooth";
  const endsRun = i + 1 >= keys.length - 1 || keys[i + 1].ease !== "smooth";
  if (startsRun && endsRun) return smoothstep(u);
  if (startsRun) return easeInHalf(u);
  if (endsRun) return easeOutHalf(u);
  return u;
}

// Cubic halves of smoothstep rescaled so the speed matches the linear middle at the join (C1).
const easeInHalf = (u) => u * u * (2 - u);       // slope 0 at 0, slope 1 at 1
const easeOutHalf = (u) => u * (1 + u - u * u);  // slope 1 at 0, slope 0 at 1

/** Camera at time t, or null when the track has no keys. */
export function sampleCameraTrack(track, t) {
  const keys = normalizeCameraTrack(track).keys;
  if (!keys.length) return null;
  const time = Number(t) || 0;
  const pick = (k, i) => ({ position: { ...k.position }, target: { ...k.target }, fov: k.fov, roll: k.roll, keyIndex: i });
  if (keys.length === 1 || time <= keys[0].t) return pick(keys[0], 0);
  const last = keys.length - 1;
  if (time >= keys[last].t) return pick(keys[last], last);
  let i = 0;
  while (i < last - 1 && time >= keys[i + 1].t) i += 1;
  const a = keys[i], b = keys[i + 1];
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (time - a.t) / span)) : 1;
  const e = easedU(keys, i, u);
  const positions = keys.map((k) => k.position), targets = keys.map((k) => k.target);
  return {
    position: splineAt(positions, i, e),
    target: splineAt(targets, i, e),
    fov: lerp(a.fov, b.fov, e),
    roll: lerp(a.roll, b.roll, e),
    keyIndex: i,
  };
}

/** Dense polyline of the camera path, for drawing it in the 3D view. */
export function cameraPathPolyline(track, { samplesPerSegment = 24 } = {}) {
  const keys = normalizeCameraTrack(track).keys;
  if (keys.length < 2) return keys.map((k) => ({ ...k.position }));
  const positions = keys.map((k) => k.position);
  const n = Math.max(1, Math.round(samplesPerSegment));
  const out = [];
  for (let i = 0; i < keys.length - 1; i += 1) {
    for (let s = 0; s < n; s += 1) out.push(splineAt(positions, i, s / n));
  }
  out.push({ ...positions.at(-1) });
  return out;
}

// ── preset moves ────────────────────────────────────────────────────────────

/** Centre, size and radius of a set of points (radius at least 2 m). */
export function siteBounds(points = []) {
  const pts = (points || []).map((p) => vec(p, { z: 0 })).filter(Boolean);
  if (!pts.length) return { center: { x: 0, y: 0, z: 0 }, radius: 2, size: { x: 0, y: 0, z: 0 }, min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of pts) for (const a of ["x", "y", "z"]) { min[a] = Math.min(min[a], p[a]); max[a] = Math.max(max[a], p[a]); }
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  const center = { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 };
  return { center, radius: Math.max(2, Math.hypot(size.x, size.y, size.z) / 2), size, min, max };
}

export const CAMERA_MOVES = [
  { key: "orbit", label: "Orbit 360°" },
  { key: "dollyIn", label: "Zoom in (dolly)" },
  { key: "dollyOut", label: "Zoom out (reveal)" },
  { key: "crane", label: "Crane up" },
  { key: "flyby", label: "Fly-by" },
  { key: "push", label: "Push to centre" },
  { key: "lensZoom", label: "Lens zoom (FOV)" },
  { key: "topDown", label: "Rise to top view" },
];

/**
 * Keys for a preset camera move sized to the site. The audience side is +z (front view).
 * `direction` −1 reverses orbit / fly-by direction.
 */
export function buildCameraMove(moveKey, { bounds, start = 0, duration = 10, from = null, eyeHeight = 1.6, direction = 1 } = {}) {
  const b = bounds?.center ? bounds : siteBounds([]);
  const R = Math.max(2, Number(b.radius) || 2);
  const c = b.center;
  const baseY = Number.isFinite(b.min?.y) ? b.min.y : c.y - (b.size?.y || 0) / 2;
  const target = { x: c.x, y: baseY + 0.4 * Math.max(b.size?.y || 0, 1.5), z: c.z };
  const dir = direction < 0 ? -1 : 1;
  const T = Math.max(0.1, Number(duration) || 10);
  const t0 = Math.max(0, Number(start) || 0);
  const fromPos = vec(from?.position);
  const fromTarget = vec(from?.target) || target;
  const fromFov = num(from?.fov, DEFAULT_FOV);
  // Azimuth of the start (0 = straight in front on +z), from the current camera when given.
  const az0 = fromPos ? Math.atan2(fromPos.x - c.x, fromPos.z - c.z) : 0;
  const around = (az, d, h) => ({ x: c.x + Math.sin(az) * d, y: baseY + h, z: c.z + Math.cos(az) * d });
  const key = (u, position, tgt = target, fov = DEFAULT_FOV, ease = "smooth", label) => ({ id: newId(), t: Number((t0 + u * T).toFixed(4)), position, target: { ...tgt }, fov, roll: 0, ease, ...(label ? { label } : {}) });

  switch (moveKey) {
    case "orbit": {
      // A key every 30° keeps the spline within ~0.5 % of a true circle.
      const d = 2.2 * R, h = 0.6 * R + eyeHeight, n = 12;
      return Array.from({ length: n + 1 }, (_, i) => key(i / n, around(az0 + dir * (i / n) * 2 * Math.PI, d, h), target, DEFAULT_FOV, "smooth", i === 0 ? "Orbit" : undefined));
    }
    case "dollyIn":
      return [
        key(0, around(az0, 3 * R, 0.5 * R + eyeHeight), target, DEFAULT_FOV, "smooth", "Zoom in"),
        key(1, around(az0, 1.2 * R, 0.25 * R + eyeHeight), target, DEFAULT_FOV),
      ];
    case "dollyOut":
      return [
        key(0, around(az0, 1.2 * R, 0.25 * R + eyeHeight), target, DEFAULT_FOV, "smooth", "Zoom out"),
        key(1, around(az0, 3.2 * R, R), target, DEFAULT_FOV),
      ];
    case "crane":
      return [
        key(0, around(az0, 2 * R, eyeHeight), { ...target, y: baseY + 0.5 }, DEFAULT_FOV, "smooth", "Crane up"),
        key(1, around(az0, 2 * R, 1.5 * R), target, DEFAULT_FOV),
      ];
    case "flyby": {
      const h = 0.35 * R + eyeHeight, side = (x) => ({ x: c.x + dir * x, y: baseY + h, z: c.z + 1.4 * R });
      return [
        key(0, side(-2 * R), target, DEFAULT_FOV, "smooth", "Fly-by"),
        key(0.5, { ...side(0), z: c.z + 1.0 * R }, target, DEFAULT_FOV),
        key(1, side(2 * R), target, DEFAULT_FOV),
      ];
    }
    case "push": {
      const p0 = fromPos || around(az0, 2.6 * R, 0.5 * R + eyeHeight);
      const toward = (u) => lerpV(p0, target, u);
      return [
        key(0, p0, fromTarget, fromFov, "smooth", "Push in"),
        key(1, { ...toward(0.55), y: Math.max(baseY + eyeHeight, toward(0.55).y) }, target, Math.max(30, fromFov - 10)),
      ];
    }
    case "lensZoom": {
      const p = fromPos || around(az0, 2.5 * R, 0.4 * R + eyeHeight);
      return [
        key(0, p, fromTarget, Math.max(40, fromFov), "smooth", "Lens zoom"),
        key(1, { ...p }, fromTarget, 22),
      ];
    }
    case "topDown":
      return [
        key(0, around(az0, 2.2 * R, 0.5 * R + eyeHeight), target, DEFAULT_FOV, "smooth", "Rise to top"),
        key(1, { x: c.x + Math.sin(az0) * 0.01, y: baseY + 3 * R, z: c.z + Math.cos(az0) * 0.01 }, { x: c.x, y: baseY, z: c.z }, DEFAULT_FOV),
      ];
    default:
      return [];
  }
}
