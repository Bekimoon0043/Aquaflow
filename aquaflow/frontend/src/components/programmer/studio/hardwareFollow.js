// Hardware follow — turn the nozzle levels of design-aware patterns into what the fountain's
// real outputs do, so the 3D preview and the PLC show the same water. Pure.
//
//   valves   a jet with its own solenoid opens where its pattern asks for water
//            ('hits': on each crest, 'open': whenever it is up) with ≥ MIN_ON_S on and
//            ≥ MIN_OFF_S off — the same rule the PLC enforces
//   pumps    each pump runs at the highest level any of its open jets asks for, ramping no
//            faster than a VFD can (PUMP_UP / PUMP_DOWN % per second), and stops while all its
//            jets are closed (the PLC never pumps against closed valves)
//   preview  every routed nozzle clip is rewritten to the water it will really get
//            (valve open × its pump's speed). Jets with their own solenoid are marked
//            `asBuilt` — the PLC skips those and plays the valve and pump clips instead; a
//            valve-less jet keeps its clip, which opens its implied valve on the Siemens site

import { readFountainDesign } from './fountainDesign';
import { MIN_OFF_S, MIN_ON_S } from './patternPresets';

export const DT = 0.1;
export const PUMP_UP = 40;      // % per second (0 → 100 % in 2.5 s)
export const PUMP_DOWN = 30;    // % per second
export const PRUNE_WINDOW_S = 6; // jets left out by the flow budget sit out a whole window
const PUMP_CLIP_S = 30;
const WATER = /^(pump_speed|pump_pressure|device_intensity|motion_intensity)$/;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;

/** Level 0..100 of a compiled clip at absolute time t (keys, else flat value with fades). */
export function clipLevel(clip, t) {
  const t0 = Number(clip.startTime) || 0, d = Number(clip.duration) || 0;
  if (t < t0 || t >= t0 + d) return 0;
  const local = t - t0;
  const k = clip.keys;
  if (Array.isArray(k) && k.length >= 4) {
    if (local <= k[0]) return k[1];
    for (let i = 2; i < k.length; i += 2) {
      if (local <= k[i]) {
        if (clip.keyMode === 'step') return k[i - 1];
        const a = k[i - 2], span = k[i] - a;
        return span > 1e-9 ? k[i - 1] + (k[i + 1] - k[i - 1]) * (local - a) / span : k[i + 1];
      }
    }
    return k[k.length - 1];
  }
  let g = 1;
  if (clip.fadeIn > 0) g = Math.min(g, local / clip.fadeIn);
  if (clip.fadeOut > 0) g = Math.min(g, (d - local) / clip.fadeOut);
  return (Number(clip.value) || 0) * Math.max(0, Math.min(1, g));
}

/** Open spans [a, b) (seconds) from a boolean grid, with minimum on and off times. */
export function valveSpans(open, { dt = DT, minOn = MIN_ON_S, minOff = MIN_OFF_S } = {}) {
  const raw = [];
  let s = -1;
  for (let i = 0; i <= open.length; i++) {
    const on = i < open.length && open[i];
    if (on && s < 0) s = i;
    if (!on && s >= 0) { raw.push([s * dt, i * dt]); s = -1; }
  }
  const out = [];
  for (const [a, b0] of raw) {
    const b = Math.max(b0, a + minOn);
    if (out.length && a - out.at(-1)[1] < minOff - 1e-6) out.at(-1)[1] = Math.max(out.at(-1)[1], b);
    else out.push([a, b]);
  }
  return out.map(([a, b]) => [r3(a), r3(b)]);
}

/** Rate-limited pump speed: rises early enough to reach each target on time, falls slowly. */
export function pumpCurve(target, running, { dt = DT, up = PUMP_UP, down = PUMP_DOWN } = {}) {
  const n = target.length, x = new Float32Array(n);
  const du = up * dt, dd = down * dt;
  // Backward pass: start the ramp up ahead of a rise (only while an outlet is open).
  for (let i = n - 1; i >= 0; i--) x[i] = Math.max(target[i], i < n - 1 && running[i] ? x[i + 1] - du : 0);
  // Forward pass: never fall faster than the drive ramps down, never jump up.
  for (let i = 1; i < n; i++) x[i] = running[i] ? Math.min(x[i - 1] + du, Math.max(x[i], x[i - 1] - dd)) : 0;
  if (n && !running[0]) x[0] = 0;
  return x;
}

/** Keys [t, v, …] that keep the shape of a sampled curve (linear-interpolation tolerance). */
function simplify(values, i0, i1, dt, tolerance = 0.5) {
  const pts = [];
  for (let i = i0; i <= i1; i++) pts.push([r2((i - i0) * dt), r2(values[Math.min(i, values.length - 1)])]);
  const keep = [pts[0]];
  let anchor = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const a = pts[anchor], c = pts[k + 1];
    let ok = true;
    for (let m = anchor + 1; m <= k && ok; m++) ok = Math.abs(a[1] + (c[1] - a[1]) * (pts[m][0] - a[0]) / (c[0] - a[0]) - pts[m][1]) <= tolerance;
    if (!ok) { keep.push(pts[k]); anchor = k; }
  }
  if (pts.length > 1) keep.push(pts.at(-1));
  return keep.filter((p, k) => k === 0 || p[0] > keep[k - 1][0]).flat();
}

/**
 * @param {object[]} clips   compiled clips
 * @param {object[]} items   show inventory
 * @param {Map<string,string>} modes  recipe id → 'hits' | 'open' (recipes that follow the hardware)
 * @returns {{ clips, valves: number, pumps: number }}
 */
export function followHardware(clips, items, modes, design = readFountainDesign(items)) {
  if (!modes?.size || !design.connected) return { clips, valves: 0, pumps: 0 };
  const routed = new Map();             // nozzle id → its clips from hardware recipes
  for (const c of clips) {
    if (!modes.has(c.studioRecipeId) || !WATER.test(c.type)) continue;
    const n = design.nozzleById.get(c.fixtureId);
    if (!n || (!n.valveId && !n.pumpId) || n.control === 'height') continue;
    if (!routed.has(n.id)) routed.set(n.id, []);
    routed.get(n.id).push(c);
  }
  if (!routed.size) return { clips, valves: 0, pumps: 0 };
  const end = Math.min(600, Math.max(...[...routed.values()].flat().map((c) => c.startTime + c.duration)));
  const N = Math.ceil(end / DT) + 1;

  // 1. What each jet asks for: open? and how high while open.
  const want = new Map();
  for (const [id, list] of routed) {
    const open = new Uint8Array(N), height = new Float32Array(N);
    for (const c of list) {
      const mode = modes.get(c.studioRecipeId);
      const i0 = Math.max(0, Math.floor(c.startTime / DT)), i1 = Math.min(N - 1, Math.ceil((c.startTime + c.duration) / DT));
      const lv = [];
      for (let i = i0; i <= i1; i++) lv.push(clipLevel(c, i * DT));
      const hi = Math.max(0, ...lv), lo = Math.min(...lv);
      const thr = mode === 'hits' && hi - lo > 10 ? lo + 0.5 * (hi - lo) : 5;
      lv.forEach((v, k) => {
        if (v > thr && hi > 5) { open[i0 + k] = 1; height[i0 + k] = Math.max(height[i0 + k], mode === 'hits' ? hi : v); }
      });
    }
    want.set(id, { open, height });
  }

  // 1b. Flow budget: a pump cannot feed more than its rated flow. When too many of its jets
  //     would be open, some sit out a whole 6 s window (long enough to survive the valve
  //     minimum on / off), in an order that rotates each window so no jet is always the one
  //     left out. Valve-less outlets on the pump are fed first.
  let pruned = 0;
  for (const pump of design.pumps.values()) {
    const qMax = Number(pump.item.engineering?.flowLpm) || 0;
    const mine = pump.nozzleIds.filter((id) => want.has(id));
    const valved = mine.filter((id) => design.nozzleById.get(id).valveId);
    if (!(qMax > 0) || !valved.length) continue;
    const flow = (id) => Number(design.nozzleById.get(id).item.engineering?.flowLpm) || 0;
    const free = mine.filter((id) => !design.nozzleById.get(id).valveId);
    const W = Math.round(PRUNE_WINDOW_S / DT);
    for (let w0 = 0; w0 < N; w0 += W) {
      const w1 = Math.min(N, w0 + W);
      // The window's worst moment decides how many jets sit out.
      let worst = 0, worstOpen = [];
      for (let i = w0; i < w1; i++) {
        let total = 0;
        for (const id of free) if (want.get(id).open[i] || want.get(id).height[i] > 0) total += flow(id);
        const open = valved.filter((id) => want.get(id).open[i]);
        for (const id of open) total += flow(id);
        if (total > worst) { worst = total; worstOpen = open; }
      }
      if (worst <= qMax) continue;
      const rot = Math.floor(w0 / W) * 7;
      const order = [...worstOpen].sort((a, b) => ((valved.indexOf(a) + rot) % valved.length) - ((valved.indexOf(b) + rot) % valved.length));
      let total = worst;
      while (total > qMax && order.length) {
        const id = order.pop();
        want.get(id).open.fill(0, w0, w1);
        total -= flow(id); pruned++;
      }
    }
  }

  // 2. Valves with minimum on / off times; the effective open grid follows the spans.
  const out = [], seenValves = new Set();
  const isOpen = new Map();
  for (const [id, w] of want) {
    const n = design.nozzleById.get(id);
    if (!n.valveId) { isOpen.set(id, w.open); continue; }
    const spans = valveSpans(w.open);
    const grid = new Uint8Array(N);
    for (const [a, b] of spans) for (let i = Math.round(a / DT); i < Math.min(N, Math.round(b / DT)); i++) grid[i] = 1;
    isOpen.set(id, grid);
    if (seenValves.has(n.valveId)) continue;
    seenValves.add(n.valveId);
    const valve = design.valves.get(n.valveId);
    const track = valve?.item.tracks?.find((t) => t.type === 'solenoid_open');
    if (!track) continue;
    const first = routed.get(id)[0];
    spans.forEach(([a, b], k) => {
      const duration = r3(Math.min(600, b) - a);
      if (duration <= 0) return;
      const source = routed.get(id).find((c) => a >= c.startTime - 1e-6 && a < c.startTime + c.duration) || first;
      out.push({ id: `${source.studioRecipeId}:${valve.id}:hw:${k}`, studioRecipeId: source.studioRecipeId, patternBlockId: source.patternBlockId,
        fixtureId: valve.id, trackId: track.id, type: 'solenoid_open', name: `${source.name} · valve`, startTime: a, duration, value: 100,
        color: source.color, source: 'show-studio', hardware: true });
    });
  }

  // 3. Pumps: the highest open jet's level, rate-limited; idle while every outlet is closed.
  const pumpLevel = new Map();
  for (const [pumpId, pump] of design.pumps) {
    const mine = pump.nozzleIds.filter((id) => want.has(id));
    if (!mine.length) continue;
    const target = new Float32Array(N), running = new Uint8Array(N);
    for (const id of mine) {
      const o = isOpen.get(id), h = want.get(id).height, valved = !!design.nozzleById.get(id).valveId;
      for (let i = 0; i < N; i++) {
        if (valved && !o[i]) continue;
        running[i] = running[i] || (o[i] || h[i] > 0) ? 1 : 0;
        if (o[i] || !valved) target[i] = Math.max(target[i], h[i]);
      }
    }
    // A valve-less jet (a basket on a shared pump) is an outlet that is open while it has a
    // clip (on a Siemens site it opens an implied valve): the pump may run then and ramps down
    // gently instead of stopping.
    for (const id of mine.filter((x) => !design.nozzleById.get(x).valveId)) {
      for (const c of routed.get(id)) {
        const i0 = Math.max(0, Math.floor(c.startTime / DT)), i1 = Math.min(N - 1, Math.floor((c.startTime + c.duration) / DT) - 1);
        for (let i = i0; i <= i1; i++) running[i] = 1;
      }
    }
    const speed = pumpCurve(target, running);
    pumpLevel.set(pumpId, speed);
    const track = pump.item.tracks?.find((t) => t.type === 'pump_speed');
    if (!track) continue;
    let i = 0, k = 0;
    while (i < N) {
      if (speed[i] <= 0.5) { i++; continue; }
      let j = i;
      while (j + 1 < N && speed[j + 1] > 0.5 && (j + 1 - i) * DT < PUMP_CLIP_S) j++;
      const keys = simplify(speed, i, j, DT);
      const duration = r3(Math.max(DT, (j + 1 - i) * DT));
      if (i * DT + duration <= 600) out.push({ id: `hw:${pumpId}:${k++}`, studioRecipeId: null, fixtureId: pumpId, trackId: track.id, type: 'pump_speed',
        name: `${pump.name} · follows the music`, startTime: r3(i * DT), duration, value: r2(Math.max(...speed.slice(i, j + 1))), keys, color: '#4f8cff',
        source: 'show-studio', hardware: true });
      i = j + 1;
    }
  }

  // 4. Nozzle clips → the water each jet will really get (preview only; the PLC skips them).
  const rewritten = new Map();
  for (const [id, list] of routed) {
    const n = design.nozzleById.get(id), o = isOpen.get(id), speed = n.pumpId ? pumpLevel.get(n.pumpId) : null, h = want.get(id).height;
    for (const c of list) {
      const i0 = Math.max(0, Math.round(c.startTime / DT)), i1 = Math.min(N - 1, Math.round((c.startTime + c.duration) / DT));
      const v = new Float32Array(i1 - i0 + 1);
      for (let i = i0; i <= i1; i++) v[i - i0] = o[i] ? (speed ? speed[i] : h[i]) : 0;
      const keys = simplify(v, 0, v.length - 1, DT);
      rewritten.set(c.id, { ...c, keys, keyMode: undefined, value: r2(Math.max(0, ...v)), fadeIn: 0, fadeOut: 0, ...(n.valveId ? { asBuilt: true } : { routed: true }) });
    }
  }
  const merged = clips.map((c) => rewritten.get(c.id) || c);
  return { clips: [...merged, ...out], valves: seenValves.size, pumps: pumpLevel.size, pruned };
}
