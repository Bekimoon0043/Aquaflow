// Hardware follow — turn the nozzle levels of design-aware patterns into what the fountain's
// real outputs do, so the 3D preview and the PLC show the same water. Pure.
//
//   valves   a jet with its own solenoid opens where its pattern asks for water
//            ('hits': on each crest, 'open': whenever it is up) with ≥ MIN_ON_S on and
//            ≥ MIN_OFF_S off — the same rule the PLC enforces
//   caps     a recipe may carry `hardwareCap` (0..100): the highest level its jets may reach
//            (splash / wind). A shared pump never runs above the lowest cap of its open jets.
//   pumps    each pump runs at the highest level any of its open jets asks for, ramping no
//            faster than a VFD can (PUMP_UP / PUMP_DOWN % per second), and stops while all its
//            jets are closed (the PLC never pumps against closed valves)
//   preview  every routed nozzle clip is rewritten to the water it will really get
//            (valve open × its pump's speed). Jets with their own solenoid are marked
//            `asBuilt` — the PLC skips those and plays the valve and pump clips instead; a
//            valve-less jet keeps its clip, which opens its implied valve on the Siemens site
//   flow     no pump is ever asked for more than its rated flow × margin (pumpFlow.js): too
//            many open jets on one pump → some jets sit out a window (fixed-speed pumps), or a
//            VFD pump runs a little slower (its jets' flow falls with the speed) and only sits
//            jets out when slowing would cost more than VFD_MIN_SPEED of the asked speed.
//            The result's `flowCap` reports per pump the peak before / after and what changed.

import { readFountainDesign } from './fountainDesign';
import { MIN_OFF_S, MIN_ON_S } from './patternPresets';
import { DEFAULT_FLOW_MARGIN_PCT, isVfdPump, jetFlowLpm, pumpCapLpm } from '../../../engineering/pumpFlow';

export const DT = 0.1;
export const PUMP_UP = 40;      // % per second (0 → 100 % in 2.5 s)
export const PUMP_DOWN = 30;    // % per second
export const PRUNE_WINDOW_S = 6; // jets left out by the flow budget sit out a whole window
export const VFD_MIN_SPEED = 0.85; // a VFD pump may slow to 85 % of the asked speed to stay in its flow rating
const FLOW_HEADROOM = 0.99;        // the drive's ramp keys are simplified (±0.5 %): aim 1 % under
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

/**
 * Rate-limited pump speed: rises early enough to reach each target on time, falls slowly,
 * and (with `ceiling`) slows down early enough to be under each ceiling when it starts.
 */
export function pumpCurve(target, running, { dt = DT, up = PUMP_UP, down = PUMP_DOWN, ceiling = null } = {}) {
  const n = target.length, x = new Float32Array(n);
  const du = up * dt, dd = down * dt;
  // Backward pass: start the ramp up ahead of a rise (only while an outlet is open).
  for (let i = n - 1; i >= 0; i--) x[i] = Math.max(target[i], i < n - 1 && running[i] ? x[i + 1] - du : 0);
  // Forward pass: never fall faster than the drive ramps down, never jump up.
  for (let i = 1; i < n; i++) x[i] = running[i] ? Math.min(x[i - 1] + du, Math.max(x[i], x[i - 1] - dd)) : 0;
  if (n && !running[0]) x[0] = 0;
  if (ceiling) {
    const cb = new Float32Array(n);
    for (let i = n - 1; i >= 0; i--) cb[i] = Math.min(ceiling[i], i < n - 1 ? cb[i + 1] + dd : Infinity);
    for (let i = 0; i < n; i++) x[i] = Math.min(x[i], cb[i]);
    for (let i = 1; i < n; i++) x[i] = Math.min(x[i], x[i - 1] + du);
  }
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
export function followHardware(clips, items, modes, design = readFountainDesign(items), { marginPct = DEFAULT_FLOW_MARGIN_PCT } = {}) {
  if (!modes?.size || !design.connected) return { clips, valves: 0, pumps: 0 };
  const modeOf = (id) => { const m = modes.get(id); return typeof m === 'string' ? m : m?.mode; };
  const capOf = (id) => { const m = modes.get(id); return typeof m === 'object' && Number.isFinite(m?.cap) ? m.cap : 100; };
  const routed = new Map();             // nozzle id → its clips from hardware recipes
  for (const c of clips) {
    if (!modeOf(c.studioRecipeId) || !WATER.test(c.type)) continue;
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
    const jetCap = Math.min(100, ...list.map((c) => capOf(c.studioRecipeId)));
    for (const c of list) {
      const mode = modeOf(c.studioRecipeId), limit = capOf(c.studioRecipeId);
      const i0 = Math.max(0, Math.floor(c.startTime / DT)), i1 = Math.min(N - 1, Math.ceil((c.startTime + c.duration) / DT));
      const lv = [];
      for (let i = i0; i <= i1; i++) lv.push(clipLevel(c, i * DT));
      const hi = Math.max(0, ...lv), lo = Math.min(...lv);
      const thr = mode === 'hits' && hi - lo > 10 ? lo + 0.5 * (hi - lo) : 5;
      lv.forEach((v, k) => {
        if (v > thr && hi > 5) { open[i0 + k] = 1; height[i0 + k] = Math.max(height[i0 + k], Math.min(limit, mode === 'hits' ? hi : v)); }
      });
    }
    want.set(id, { open, height, cap: jetCap });
  }

  // 1b + 2. Valves with minimum on / off times, within each pump's flow budget. A pump cannot
  //     feed more than its rated flow: when too many of its jets would be open (counted on
  //     the valves' real open times, after the minimum on / off), some jets sit out a whole
  //     6 s window — long enough to survive the valve minimum on / off — in an order that
  //     rotates each window so no jet is always the one left out. Valve-less outlets on the
  //     pump are fed first. Repeats until every pump fits (a few passes at most).
  const isOpen = new Map(), spansOf = new Map();
  const rebuild = (id) => {
    const w = want.get(id), n = design.nozzleById.get(id);
    if (!n.valveId) { isOpen.set(id, w.open); return; }
    const spans = valveSpans(w.open);
    const grid = new Uint8Array(N);
    for (const [a, b] of spans) for (let i = Math.round(a / DT); i < Math.min(N, Math.round(b / DT)); i++) grid[i] = 1;
    spansOf.set(id, spans);
    isOpen.set(id, grid);
  };
  for (const id of want.keys()) rebuild(id);
  let pruned = 0;
  const W = Math.round(PRUNE_WINDOW_S / DT), early = Math.round(MIN_ON_S / DT);
  const flow = (id) => jetFlowLpm(design.nozzleById.get(id).item);
  const budgets = [];
  for (const pump of design.pumps.values()) {
    const qMax = pumpCapLpm(pump.item, marginPct) || 0;
    const mine = pump.nozzleIds.filter((id) => want.has(id));
    if (!(qMax > 0) || !mine.length) continue;
    const valved = mine.filter((id) => design.nozzleById.get(id).valveId);
    budgets.push({ pump, qMax, vfd: isVfdPump(pump.item), mine, valved, free: mine.filter((id) => !design.nozzleById.get(id).valveId) });
  }
  // Demand at sample i: Σ flow of the open jets; on a VFD pump × the speed the jets ask for.
  const demandAt = (b, i) => {
    let q = 0, speed = 0;
    for (const id of b.free) if (isOpen.get(id)[i] || want.get(id).height[i] > 0) { q += flow(id); speed = Math.max(speed, want.get(id).height[i]); }
    const open = b.valved.filter((id) => isOpen.get(id)[i]);
    for (const id of open) { q += flow(id); speed = Math.max(speed, want.get(id).height[i]); }
    return { q: b.vfd ? q * Math.min(100, speed) / 100 : q, full: q, speed, open };
  };
  const before = new Map(budgets.map((b) => {
    let worst = 0, at = 0;
    for (let i = 0; i < N; i++) { const d = demandAt(b, i).q; if (d > worst) { worst = d; at = i * DT; } }
    return [b.pump.id, { lpm: worst, t: at }];
  }));
  const skipped = new Map();
  for (let pass = 0; pass < 10; pass++) {
    const touched = new Set();
    for (const b of budgets) {
      if (!b.valved.length) continue;
      // A VFD pump may slow to VFD_MIN_SPEED of the asked speed: only beyond that do jets sit out.
      const limit = b.vfd ? b.qMax / VFD_MIN_SPEED : b.qMax;
      for (let w0 = 0; w0 < N; w0 += W) {
        const w1 = Math.min(N, w0 + W);
        // The window's worst moment decides how many jets sit out.
        let worst = 0, worstOpen = [], worstScale = 1;
        for (let i = w0; i < w1; i++) {
          const d = demandAt(b, i);
          if (d.q > worst) { worst = d.q; worstOpen = d.open; worstScale = d.full > 0 ? d.q / d.full : 1; }
        }
        if (worst <= limit * (1 + 1e-6)) continue;
        const rot = Math.floor(w0 / W) * 7;
        const order = [...worstOpen].sort((a, c) => ((b.valved.indexOf(a) + rot) % b.valved.length) - ((b.valved.indexOf(c) + rot) % b.valved.length));
        let total = worst;
        while (total > limit && order.length) {
          const id = order.pop();
          // Close a minimum-on time early too, so an opening just before cannot run on into the window.
          want.get(id).open.fill(0, Math.max(0, w0 - early), w1);
          touched.add(id);
          skipped.set(b.pump.id, (skipped.get(b.pump.id) || 0) + 1);
          total -= flow(id) * worstScale; pruned++;
        }
      }
    }
    if (!touched.size) break;
    for (const id of touched) rebuild(id);
  }

  // Valve clips from the final spans.
  const out = [], seenValves = new Set();
  for (const id of want.keys()) {
    const n = design.nozzleById.get(id);
    if (!n.valveId || seenValves.has(n.valveId)) continue;
    seenValves.add(n.valveId);
    const valve = design.valves.get(n.valveId);
    const track = valve?.item.tracks?.find((t) => t.type === 'solenoid_open');
    if (!track) continue;
    const first = routed.get(id)[0];
    spansOf.get(id).forEach(([a, b], k) => {
      const duration = r3(Math.min(600, b) - a);
      if (duration <= 0) return;
      const source = routed.get(id).find((c) => a >= c.startTime - 1e-6 && a < c.startTime + c.duration) || first;
      out.push({ id: `${source.studioRecipeId}:${valve.id}:hw:${k}`, studioRecipeId: source.studioRecipeId, patternBlockId: source.patternBlockId,
        fixtureId: valve.id, trackId: track.id, type: 'solenoid_open', name: `${source.name} · valve`, startTime: a, duration, value: 100,
        color: source.color, source: 'show-studio', hardware: true, ...(source.leadS > 0 ? { leadS: source.leadS } : {}) });
    });
  }

  // 3. Pumps: the highest open jet's level, rate-limited; idle while every outlet is closed.
  const pumpLevel = new Map();
  for (const [pumpId, pump] of design.pumps) {
    const mine = pump.nozzleIds.filter((id) => want.has(id));
    if (!mine.length) continue;
    const target = new Float32Array(N), running = new Uint8Array(N), ceiling = new Float32Array(N).fill(100);
    for (const id of mine) {
      const o = isOpen.get(id), w = want.get(id), h = w.height, valved = !!design.nozzleById.get(id).valveId;
      for (let i = 0; i < N; i++) {
        if (valved && !o[i]) continue;
        running[i] = running[i] || (o[i] || h[i] > 0) ? 1 : 0;
        if (o[i] || !valved) { target[i] = Math.max(target[i], h[i]); if (o[i] || h[i] > 0) ceiling[i] = Math.min(ceiling[i], w.cap); }
      }
    }
    // A VFD pump inside its flow rating: Σ open jets' flow × speed ≤ rated flow × margin.
    const b = budgets.find((x) => x.pump.id === pumpId);
    let slowed = 0;
    if (b?.vfd) for (let i = 0; i < N; i++) {
      const full = demandAt(b, i).full;
      if (full > 0 && full > b.qMax) { const lim = 100 * FLOW_HEADROOM * b.qMax / full; if (lim < ceiling[i]) { ceiling[i] = lim; if (target[i] > lim) slowed++; } }
    }
    if (b) b.slowedS = r2(slowed * DT);
    // A shared pump lifts every open jet together: never above the lowest cap among them.
    for (let i = 0; i < N; i++) target[i] = Math.min(target[i], ceiling[i]);
    // A valve-less jet (a basket on a shared pump) is an outlet that is open while it has a
    // clip (on a Siemens site it opens an implied valve): the pump may run then and ramps down
    // gently instead of stopping.
    for (const id of mine.filter((x) => !design.nozzleById.get(x).valveId)) {
      for (const c of routed.get(id)) {
        const i0 = Math.max(0, Math.floor(c.startTime / DT)), i1 = Math.min(N - 1, Math.floor((c.startTime + c.duration) / DT) - 1);
        for (let i = i0; i <= i1; i++) running[i] = 1;
      }
    }
    const speed = pumpCurve(target, running, { ceiling });
    pumpLevel.set(pumpId, speed);
    const track = pump.item.tracks?.find((t) => t.type === 'pump_speed');
    if (!track) continue;
    // The rise lead its jets' patterns were started early by (site sync must not add it again).
    const pumpLead = Math.max(0, ...mine.flatMap((id) => routed.get(id).map((c) => Number(c.leadS) || 0)));
    let i = 0, k = 0;
    while (i < N) {
      if (speed[i] <= 0.5) { i++; continue; }
      let j = i;
      while (j + 1 < N && speed[j + 1] > 0.5 && (j + 1 - i) * DT < PUMP_CLIP_S) j++;
      const keys = simplify(speed, i, j, DT);
      const duration = r3(Math.max(DT, (j + 1 - i) * DT));
      if (i * DT + duration <= 600) out.push({ id: `hw:${pumpId}:${k++}`, studioRecipeId: null, fixtureId: pumpId, trackId: track.id, type: 'pump_speed',
        name: `${pump.name} · follows the music`, startTime: r3(i * DT), duration, value: r2(Math.max(...speed.slice(i, j + 1))), keys, color: '#4f8cff',
        source: 'show-studio', hardware: true, ...(pumpLead > 0 ? { leadS: pumpLead } : {}) });
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

  // 5. Flow report: per pump the peak it is asked for before / after the cap.
  const flowCap = { marginPct, changed: false, pumps: [] };
  for (const b of budgets) {
    const speed = pumpLevel.get(b.pump.id);
    let worst = 0, at = 0;
    for (let i = 0; i < N; i++) {
      const d = demandAt(b, i);
      const q = b.vfd ? d.full * Math.min(100, speed ? speed[i] : d.speed) / 100 : d.full;
      if (q > worst) { worst = q; at = i * DT; }
    }
    const pre = before.get(b.pump.id);
    const row = { id: b.pump.id, name: b.pump.name, vfd: b.vfd, capLpm: Math.round(b.qMax), beforeLpm: Math.round(pre.lpm), beforeT: r2(pre.t),
      afterLpm: Math.round(worst), afterT: r2(at), skipped: skipped.get(b.pump.id) || 0, slowedS: b.slowedS || 0 };
    row.changed = row.skipped > 0 || row.slowedS > 0;
    flowCap.changed ||= row.changed;
    flowCap.pumps.push(row);
  }
  flowCap.text = flowCap.pumps.filter((p) => p.changed).map((p) => `${p.name}: asked up to ${p.beforeLpm} L/min of ${p.capLpm} — `
    + [p.skipped ? `jets sat out ${p.skipped} × ${PRUNE_WINDOW_S} s window${p.skipped === 1 ? '' : 's'}` : '', p.slowedS ? `pump slowed for ${p.slowedS} s` : ''].filter(Boolean).join(', ')
    + `; now at most ${p.afterLpm} L/min.`);
  return { clips: [...merged, ...out], valves: seenValves.size, pumps: pumpLevel.size, pruned, flowCap };
}
