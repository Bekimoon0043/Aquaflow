// Site sync — sound ↔ fountain latency compensation. Pure.
//
// On the real site the audience must hear each beat at the moment it sees the water peak or the
// light hit. Every output has its own chain from "show time t" to "seen at the audience"; the
// music has one too (player buffer → DSP → amplifier → air). This module models those chains,
// works out how much earlier (or later) each output must fire, and shifts the compiled clips
// sent to the PLC accordingly. The 3D preview stays the ideal view (no control path, no audio
// chain): only the PLC / DMX export is shifted.
//
//   audio     player/output buffer + DSP/processor + amplifier (ms, user-set) + acoustic travel
//             from the nearest speaker to the listener at c = 331.3 + 0.606·T m/s
//   control   AquaFlow PC → PLC: the show frame is sampled every `frameMs` (≈ 100 ms sleep + the
//             S7 commit) and the PLC cyclic OB runs every `plcCycleMs`: on average half of each,
//             plus the S7 write (`networkMs`) and the output card (`outputMs`, relay ≈ 10 ms)
//   water     control + actuator (valve opening: calibrated `delayS` of the nozzle type when the
//             site was measured, else `valveMs`; VFD pump: `vfdMs` — its ramp is already started
//             early by hardwareFollow; swing motor: `motorMs`) + rise to the visible top
//             (waterPhysics.riseTime with the calibrated drag speed). Light travel time ≈ 0.
//   lights    control (lights on PLC bytes) or one Art-Net frame (lights from the PC) + DMX
//             frame + the fixture's own latency (latencyMs)
//
//   advance   per output = its chain − the audio chain to the listener (ms; negative = the
//             output must wait for the sound).
//
// Double counting. Generated patterns (planRender, musicPatterns, stem shows) already start
// early by the water's command → visible-top time and record it as `pattern.leadS`
// (compileStudio copies it onto every clip of that pattern — water, valves, pumps AND the
// pattern's lights, which were shifted with the water). Hand-made water clips are timed against
// the preview, which already shows the rise. So the extra shift applied at export is
//     extra = advance − covered,   covered = clip.leadS        (generated pattern)
//                                          = rise of the jet   (hand-made water clip)
//                                          = 0                 (hand-made light / other clip)
// i.e. a generated pattern's lights come back onto the beat, and the rise is never added twice.
//
// Show start. A clip that would have to fire before t = 0 cannot. The recommended audio start
// offset D (ms after the PLC show starts) is the largest such shortfall; every clip is then
// shifted by D − extra. With a fixed offset set by the user, clips that still fall before 0 are
// trimmed and reported.

import { COLUMN_VT, riseTime, visibleLead } from '../../preview/waterPhysics';
import { readFountainDesign } from './fountainDesign';
import { inferFront } from './siteCapability';
import { getFixtureInfo } from '../../../utils/fixtureTypeResolver';
import { isLightItem } from './patternPresets';

export const SYNC_VERSION = 1;
export const SYNC_DEFAULTS = Object.freeze({
  version: SYNC_VERSION,
  enabled: true,
  tempC: 25,
  audio: { playerMs: 50, dspMs: 5, ampMs: 0 },
  // Plan positions (m) of the speakers; empty → `speakerDistanceM` from the listener, or (null)
  // speakers at the fountain centre.
  speakers: [],
  speakerDistanceM: null,
  // Listener (plan m); null → the centre of the audience area.
  listener: null,
  // Audience area in front of the fountain: from `frontM` to `frontM + depthM` beyond its front
  // edge, `widthM` wide (null → the fountain's width). Seating / plaza scenery wins when present.
  audience: { frontM: 6, depthM: 20, widthM: null },
  control: { frameMs: 150, networkMs: 10, plcCycleMs: 100, outputMs: 10 },
  valveMs: 100,
  vfdMs: 100,
  motorMs: 50,
  lights: { via: 'plc', dmxMs: 25, fixtureMs: 20, artnetMs: 25 },
  // Ms after the PLC show starts that the music starts; null → recommended.
  audioStartMs: null,
  // Measured residual (sync test): + = the output was seen late → fire it this much earlier.
  correctionMs: { water: 0, lights: 0 },
  measurements: [],
  // "Preview as heard at the audience": the preview's song lags by previewDelayMs (the audio
  // chain to the listener, kept up to date by the Site sync panel).
  previewAsHeard: false,
  previewDelayMs: 0,
  test: { periodS: 2, durationS: 32 },
  // Play the music from the AquaFlow PC when "Play on PLC" starts the show (opt-in).
  playFromPc: false,
});

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const r1 = (v) => Math.round(v * 10) / 10;
const r3 = (v) => Math.round(v * 1000) / 1000;
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Speed of sound in air (m/s) at T °C. */
export function speedOfSound(tempC = 25) {
  return 331.3 + 0.606 * num(tempC, 25);
}

/** Settings stored in studio.site.sync, merged over the defaults. */
export function readSync(site) {
  const s = isObj(site?.sync) ? site.sync : {};
  const out = {};
  for (const [k, v] of Object.entries(SYNC_DEFAULTS)) {
    out[k] = isObj(v) ? { ...v, ...(isObj(s[k]) ? s[k] : {}) } : Array.isArray(v) ? (Array.isArray(s[k]) ? s[k] : []) : (s[k] !== undefined ? s[k] : v);
  }
  return out;
}

/** Patch studio.site.sync (returns a new site object). Nested groups merge one level deep. */
export function patchSync(site, patch) {
  const current = isObj(site?.sync) ? site.sync : {};
  const next = { ...current, version: SYNC_VERSION };
  for (const [k, v] of Object.entries(patch || {})) next[k] = isObj(v) && isObj(current[k]) ? { ...current[k], ...v } : v;
  return { ...(site || {}), sync: next };
}

/** Electronic + acoustic audio chain for a speaker → listener distance (m). */
export function audioChain(settings, distanceM) {
  const a = settings.audio || {};
  const c = speedOfSound(settings.tempC);
  const parts = [
    { key: 'player', label: 'Player / output buffer', ms: num(a.playerMs) },
    { key: 'dsp', label: 'DSP / processor', ms: num(a.dspMs) },
    { key: 'amp', label: 'Amplifier', ms: num(a.ampMs) },
    { key: 'air', label: `Sound travel ${r1(distanceM)} m at ${r1(c)} m/s`, ms: r1((1000 * Math.max(0, distanceM)) / c) },
  ];
  return { parts, totalMs: r1(parts.reduce((s, p) => s + p.ms, 0)), speedMs: c };
}

/** AquaFlow PC → PLC → output card, average (ms). */
export function controlPath(settings) {
  const c = settings.control || {};
  const parts = [
    { key: 'frame', label: `Show frame (every ${num(c.frameMs)} ms, ½ on average)`, ms: num(c.frameMs) / 2 },
    { key: 'network', label: 'Network / S7 write', ms: num(c.networkMs) },
    { key: 'plc', label: `PLC cycle (${num(c.plcCycleMs)} ms, ½ on average)`, ms: num(c.plcCycleMs) / 2 },
    { key: 'card', label: 'Output card', ms: num(c.outputMs) },
  ];
  return { parts, totalMs: r1(parts.reduce((s, p) => s + p.ms, 0)) };
}

/** Calibration of a nozzle (by type, then by kind) from studio.site.calibration. */
const calOf = (calibration, n) => (calibration && (calibration[n.item?.type] || calibration[n.kind])) || null;

/**
 * The chain of one output (ms). `actuator`: 'valve' | 'vfd' | 'servo' | 'light' | 'other'.
 * Water: { heightM, cal } for the rise and the calibrated valve delay.
 */
export function outputChain(settings, { actuator, heightM = 0, cal = null, fixtureMs = null }) {
  const control = controlPath(settings);
  const parts = [];
  let riseMs = 0;
  if (actuator === 'light') {
    const l = settings.lights || {};
    if (l.via === 'artnet') parts.push({ key: 'artnet', label: 'Art-Net from the PC (½ frame)', ms: num(l.artnetMs) / 2 });
    else parts.push({ key: 'control', label: 'PLC control path', ms: control.totalMs });
    parts.push({ key: 'dmx', label: 'DMX frame', ms: num(l.dmxMs) });
    parts.push({ key: 'fixture', label: 'Fixture latency', ms: fixtureMs === null || fixtureMs === undefined ? num(l.fixtureMs) : num(fixtureMs) });
    const corr = num(settings.correctionMs?.lights);
    if (corr) parts.push({ key: 'correction', label: 'Measured correction', ms: corr });
  } else {
    parts.push({ key: 'control', label: 'PLC control path', ms: control.totalMs });
    if (actuator === 'valve') parts.push({ key: 'valve', label: cal ? 'Valve opening (calibrated)' : 'Valve opening', ms: cal ? 1000 * num(cal.delayS) : num(settings.valveMs) });
    else if (actuator === 'vfd') parts.push({ key: 'vfd', label: 'VFD response (ramp started early by the show)', ms: num(settings.vfdMs) });
    else if (actuator === 'servo') parts.push({ key: 'motor', label: 'Swing motor response', ms: num(settings.motorMs) });
    if ((actuator === 'valve' || actuator === 'vfd') && heightM > 0) {
      riseMs = 1000 * riseTime(heightM, num(cal?.vtMs, COLUMN_VT) || COLUMN_VT);
      parts.push({ key: 'rise', label: `Rise to the top (${r1(heightM)} m)`, ms: r1(riseMs) });
    }
    const corr = num(settings.correctionMs?.water);
    if (corr && actuator !== 'other') parts.push({ key: 'correction', label: 'Measured correction', ms: corr });
  }
  return { parts, totalMs: r1(parts.reduce((s, p) => s + p.ms, 0)), riseMs: r1(riseMs) };
}

/** Fountain centre, front vector, half-depth along the front and width across it (plan m). */
function fountainFrame(items, design) {
  const pts = (design.nozzles.length ? design.nozzles.map((n) => n.item) : items.filter((i) => i.category !== 'scenery'))
    .map((i) => [num(i.x), num(i.y)]);
  const cx = mean(pts.map((p) => p[0])), cy = mean(pts.map((p) => p[1]));
  const front = inferFront(items, design.nozzles);
  const [fx, fy] = front.vector;
  const along = pts.map(([x, y]) => (x - cx) * fx + (y - cy) * fy), across = pts.map(([x, y]) => -(x - cx) * fy + (y - cy) * fx);
  return { cx, cy, fx, fy, front, frontEdge: Math.max(0, ...along), width: pts.length ? Math.max(...across) - Math.min(...across) : 0 };
}

/** Audience reference listener and sample seats (front / back rows, sides) in plan m. */
export function audienceArea(items, design, settings) {
  const f = fountainFrame(items, design);
  const a = settings.audience || {};
  const width = Math.max(4, num(a.widthM, 0) || f.width || 10);
  const seating = items.filter((i) => i.category === 'scenery' && /seat|stand|terrace|plaza|audience|bench|viewing|amphi/i.test(`${i.label} ${i.name || ''}`));
  let near = f.frontEdge + num(a.frontM, 6), far = near + Math.max(0, num(a.depthM, 20));
  if (seating.length) {
    const along = seating.map((s) => (num(s.x) - f.cx) * f.fx + (num(s.y) - f.cy) * f.fy);
    const m = mean(along);
    if (m > f.frontEdge) { const half = Math.max(2, num(a.depthM, 20) / 2); near = Math.max(f.frontEdge + 1, m - half); far = m + half; }
  }
  const at = (d, s) => ({ x: r3(f.cx + f.fx * d - f.fy * s), y: r3(f.cy + f.fy * d + f.fx * s) });
  const mid = (near + far) / 2;
  const centre = isObj(settings.listener) && Number.isFinite(Number(settings.listener.x)) && Number.isFinite(Number(settings.listener.y))
    ? { x: num(settings.listener.x), y: num(settings.listener.y) } : at(mid, 0);
  const seats = [
    { key: 'front-centre', label: 'Front row, centre', ...at(near, 0) },
    { key: 'front-left', label: 'Front row, left', ...at(near, -width / 2) },
    { key: 'front-right', label: 'Front row, right', ...at(near, width / 2) },
    { key: 'back-centre', label: 'Back row, centre', ...at(far, 0) },
    { key: 'back-left', label: 'Back row, left', ...at(far, -width / 2) },
    { key: 'back-right', label: 'Back row, right', ...at(far, width / 2) },
  ];
  return { listener: centre, seats, fountain: { x: r3(f.cx), y: r3(f.cy) }, front: f.front, near: r1(near), far: r1(far), width: r1(width) };
}

/** Distance (m) from the nearest speaker to a point (the first arrival sets the heard beat). */
export function speakerDistance(settings, point, fountain) {
  const sp = (settings.speakers || []).filter((s) => Number.isFinite(Number(s?.x)) && Number.isFinite(Number(s?.y)));
  if (sp.length) return Math.min(...sp.map((s) => Math.hypot(num(s.x) - point.x, num(s.y) - point.y, num(s.z) - num(point.z, 1.2))));
  return Math.hypot(fountain.x - point.x, fountain.y - point.y);
}

/**
 * The full model for a site: per-fixture output chains, the audio chain to the listener, the
 * breakdown rows per output kind and the spread across the audience.
 * @param {object[]} items  show inventory
 * @param {object} site     studio.site (sync settings in site.sync, calibration in site.calibration)
 */
export function buildSyncModel(items = [], site = {}, { design = readFountainDesign(items) } = {}) {
  const settings = readSync(site);
  const calibration = site?.calibration || {};
  const area = audienceArea(items, design, settings);
  // Only a distance given: one virtual speaker that far from the listener, towards the fountain.
  let speakerAt = area.fountain;
  if (!(settings.speakers || []).length && settings.speakerDistanceM !== null && settings.speakerDistanceM !== '' && Number.isFinite(Number(settings.speakerDistanceM))) {
    const dx = area.fountain.x - area.listener.x, dy = area.fountain.y - area.listener.y, l = Math.hypot(dx, dy) || 1, d = Math.max(0, num(settings.speakerDistanceM));
    speakerAt = { x: area.listener.x + (dx / l) * d, y: area.listener.y + (dy / l) * d };
  }
  const distanceTo = (p) => speakerDistance(settings, p, speakerAt);
  const listenerDistance = distanceTo(area.listener);
  const audio = audioChain(settings, listenerDistance);

  // Per fixture: what it is and its chain.
  const outputs = new Map();
  const nozzleOut = (n, actuator) => {
    const cal = calOf(calibration, n);
    const chain = outputChain(settings, { actuator, heightM: n.heightM, cal });
    return { kind: 'water', family: n.kind, familyLabel: n.kindLabel || n.kind, actuator, heightM: n.heightM, calibrated: !!cal, ...chain };
  };
  for (const n of design.nozzles) outputs.set(n.id, nozzleOut(n, n.valveId ? 'valve' : n.pumpId ? 'vfd' : 'valve'));
  const tallest = (ids) => ids.map((id) => design.nozzleById.get(id)).filter(Boolean).sort((a, b) => b.heightM - a.heightM)[0];
  for (const v of design.valves.values()) { const n = tallest(v.nozzleIds); outputs.set(v.id, n ? { ...nozzleOut(n, 'valve'), via: v.id } : { kind: 'water', family: 'valve', familyLabel: 'Valve', actuator: 'valve', heightM: 0, ...outputChain(settings, { actuator: 'valve' }) }); }
  for (const p of design.pumps.values()) { const n = tallest(p.nozzleIds); outputs.set(p.id, n ? { ...nozzleOut(n, 'vfd'), via: p.id } : { kind: 'water', family: 'pump', familyLabel: 'Pump', actuator: 'vfd', heightM: 0, ...outputChain(settings, { actuator: 'vfd' }) }); }
  for (const item of items) {
    if (outputs.has(item.id) || item.category === 'scenery') continue;
    if (isLightItem(item)) {
      const info = getFixtureInfo(item.type);
      const own = [item.engineering?.latencyMs, item.latencyMs, info?.latencyMs].map(Number).find((v) => Number.isFinite(v) && v > 0);
      outputs.set(item.id, { kind: 'light', family: 'light', familyLabel: 'Lights', actuator: 'light', ...outputChain(settings, { actuator: 'light', fixtureMs: own ?? null }) });
    } else outputs.set(item.id, { kind: 'other', family: 'other', familyLabel: item.label || 'Other', actuator: 'other', ...outputChain(settings, { actuator: 'other' }) });
  }
  for (const o of outputs.values()) o.advanceMs = r1(o.totalMs - audio.totalMs);

  // Breakdown rows: audio, each nozzle kind × actuator (its tallest jet), lights.
  const rows = [{ key: 'audio', label: 'Music at the listener', kind: 'audio', parts: audio.parts, totalMs: audio.totalMs, advanceMs: 0 }];
  const byKind = new Map();
  for (const n of design.nozzles) {
    const o = outputs.get(n.id), key = `${n.kind}:${o.actuator}`;
    if (!byKind.has(key) || byKind.get(key).heightM < n.heightM) byKind.set(key, { ...o, key, count: (byKind.get(key)?.count || 0) + 1 });
    else byKind.get(key).count++;
  }
  for (const o of [...byKind.values()].sort((a, b) => b.totalMs - a.totalMs)) {
    rows.push({ key: o.key, label: `${o.familyLabel} · ${o.actuator === 'vfd' ? 'pump-driven' : 'valve'}${o.heightM ? ` · ${r1(o.heightM)} m` : ''}${o.calibrated ? ' · calibrated' : ''}`,
      kind: 'water', count: o.count, parts: o.parts, totalMs: o.totalMs, advanceMs: o.advanceMs });
  }
  const lights = [...outputs.values()].filter((o) => o.kind === 'light');
  if (lights.length) { const l = lights.sort((a, b) => b.totalMs - a.totalMs)[0]; rows.push({ key: 'lights', label: 'Lights', kind: 'light', count: lights.length, parts: l.parts, totalMs: l.totalMs, advanceMs: l.advanceMs }); }

  // Spread across the audience: compensation is exact at the listener; elsewhere the sound
  // arrives earlier (+) or later (−) than the water by the difference in travel.
  const c = audio.speedMs;
  const seats = area.seats.map((s) => {
    const d = distanceTo(s);
    return { ...s, distanceM: r1(d), offsetMs: r1((1000 * (d - listenerDistance)) / c) };
  });
  const offsets = seats.map((s) => s.offsetMs);
  const spread = { seats, minMs: Math.min(0, ...offsets), maxMs: Math.max(0, ...offsets), spreadMs: r1(Math.max(0, ...offsets) - Math.min(0, ...offsets)) };

  return { settings, audio, listener: { ...area.listener, distanceM: r1(listenerDistance) }, area, outputs, rows, spread, control: controlPath(settings), design };
}

/** Drop the first `cut` seconds of a clip (keys are relative to its start). */
function trimHead(clip, cut) {
  const duration = r3(num(clip.duration) - cut);
  const out = { ...clip, startTime: 0, duration };
  const k = clip.keys;
  if (Array.isArray(k) && k.length >= 4) {
    const pts = [];
    for (let i = 0; i < k.length; i += 2) pts.push([k[i], k[i + 1]]);
    const at = (t) => { for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [a, va] = pts[i - 1], [b, vb] = pts[i]; return clip.keyMode === 'step' ? va : b > a ? va + (vb - va) * (t - a) / (b - a) : vb; } return pts.at(-1)[1]; };
    const keys = [0, r3(at(cut))];
    for (const [t, v] of pts) if (t > cut + 1e-6) keys.push(r3(t - cut), v);
    out.keys = keys.length >= 4 ? keys : [0, keys[1], duration, keys[1]];
  }
  if (out.fadeIn) out.fadeIn = Math.max(0, r3(out.fadeIn - cut));
  if ((out.fadeIn || 0) + (out.fadeOut || 0) > duration) out.fadeOut = Math.max(0, r3(duration - (out.fadeIn || 0)));
  return out;
}

const LIGHT_TYPE = /^lighting_|^color|^dmx_/;

/** The ms one compiled clip must fire earlier than its timeline time (before the start offset). */
export function clipExtraMs(clip, model) {
  let o = model.outputs.get(clip.fixtureId);
  if (!o) o = LIGHT_TYPE.test(String(clip.type)) ? { kind: 'light', actuator: 'light', ...outputChain(model.settings, { actuator: 'light' }) } : { kind: 'other', actuator: 'other', ...outputChain(model.settings, { actuator: 'other' }) };
  let chain = o.totalMs, rise = o.riseMs || 0;
  // A swing nozzle's pan / tilt moves with its motor: no valve, no rise.
  if (o.kind === 'water' && /^motion_(pan|tilt|angle)/.test(String(clip.type))) {
    const m = outputChain(model.settings, { actuator: 'servo' }); chain = m.totalMs; rise = 0;
  }
  const lead = Number(clip.leadS);
  const covered = Number.isFinite(lead) && lead > 0 ? 1000 * lead : (o.kind === 'water' ? rise : 0);
  return { extraMs: r1(chain - model.audio.totalMs - covered), kind: o.kind, chainMs: chain, coveredMs: r1(covered) };
}

/**
 * Shift compiled clips for the site. Returns the shifted clips, the audio start offset the
 * site player must use (ms after the PLC show starts), and a summary.
 * @param {object[]} clips  compiled clips (compileStudio)
 * @param {object} model    buildSyncModel(...)
 */
export function applySiteSync(clips = [], model) {
  const s = model?.settings;
  if (!s || s.enabled === false) return { clips, audioStartMs: 0, recommendedAudioStartMs: 0, trimmed: [], dropped: 0, byKind: {}, enabled: false };
  const plans = clips.map((c) => ({ c, ...clipExtraMs(c, model) }));
  // How far before t = 0 the earliest clip would have to fire.
  let need = 0;
  for (const p of plans) if (!(p.c.muted || p.c.disabled)) need = Math.max(need, p.extraMs - 1000 * num(p.c.startTime));
  const recommended = Math.ceil(Math.max(0, need));
  const audioStartMs = s.audioStartMs === null || s.audioStartMs === undefined || s.audioStartMs === '' ? recommended : Math.max(0, num(s.audioStartMs));
  const out = [], trimmed = [], byKind = {};
  let dropped = 0;
  for (const p of plans) {
    const shiftMs = audioStartMs - p.extraMs;
    const k = byKind[p.kind] || (byKind[p.kind] = { clips: 0, minShiftMs: Infinity, maxShiftMs: -Infinity });
    k.clips++; k.minShiftMs = Math.min(k.minShiftMs, r1(shiftMs)); k.maxShiftMs = Math.max(k.maxShiftMs, r1(shiftMs));
    const start = r3(num(p.c.startTime) + shiftMs / 1000);
    let clip = { ...p.c, startTime: start, siteShiftMs: r1(shiftMs) };
    if (start < 0) {
      if (num(p.c.duration) + start < 0.1) { dropped++; continue; }
      clip = { ...trimHead(clip, -start), siteShiftMs: r1(shiftMs) };
      trimmed.push({ id: p.c.id, lateMs: r1(-start * 1000) });
    }
    out.push(clip);
  }
  return { clips: out, audioStartMs, recommendedAudioStartMs: recommended, trimmed, dropped, byKind, enabled: true };
}

// ─── Sync test ──────────────────────────────────────────────────────────────────────────────

/** 16-bit mono PCM WAV with a short beep every `periodS` (first at `firstS`; the first is higher). */
export function clickTrackWav({ durationS = 32, periodS = 2, firstS = 2, freq = 1000, beepMs = 60, sampleRate = 48000 } = {}) {
  const n = Math.round(durationS * sampleRate);
  const data = new Int16Array(n);
  const beeps = clickTimes({ durationS, periodS, firstS });
  const len = Math.round((beepMs / 1000) * sampleRate);
  beeps.forEach((t, k) => {
    const i0 = Math.round(t * sampleRate), f = k === 0 ? freq * 1.5 : freq;
    for (let i = 0; i < len && i0 + i < n; i++) {
      const env = Math.min(1, i / 24, (len - i) / (0.3 * len));   // 0.5 ms attack: a sharp onset
      data[i0 + i] = Math.round(0.8 * 32767 * env * Math.sin((2 * Math.PI * f * i) / sampleRate));
    }
  });
  const bytes = new Uint8Array(44 + 2 * n), v = new DataView(bytes.buffer);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + 2 * n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, 2 * n, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + 2 * i, data[i], true);
  return bytes;
}

export function clickTimes({ durationS = 32, periodS = 2, firstS = 2 } = {}) {
  const out = [];
  for (let t = firstS; t < durationS - 0.5; t += periodS) out.push(r3(t));
  return out;
}

const LEVEL_TRACK = /^(device_intensity|solenoid_open|motion_intensity|pump_speed)$/;

/**
 * Test cues matching the click track: on each beep one jet group reaches its top (fired early by
 * its rise, tagged with leadS like a generated pattern) and every light flashes. Plain timeline
 * clips — nothing plays until the user presses Play on PLC.
 * @returns {{ clips, waterIds, lightIds, beeps, groupLabel }}
 */
export function syncTestClips(items = [], { site = {}, design = readFountainDesign(items), durationS = 32, periodS = 2, firstS = 2, nozzleIds = null, afterS = 0.3 } = {}) {
  const beeps = clickTimes({ durationS, periodS, firstS });
  let jets = nozzleIds ? nozzleIds.map((id) => design.nozzleById.get(id)).filter(Boolean) : null;
  let groupLabel = 'Selected jets';
  if (!jets?.length) {
    // The valve-driven area with the tallest jets: a sharp, clearly visible top.
    const areas = [...design.areas].filter((a) => a.nozzleIds.length).sort((a, b) => (b.control === 'switch') - (a.control === 'switch') || b.heightM - a.heightM);
    const a = areas[0];
    jets = a ? a.nozzleIds.map((id) => design.nozzleById.get(id)).filter(Boolean) : design.nozzles.slice(0, 4);
    groupLabel = a?.name || 'Jets';
  }
  const calibration = site?.calibration || {};
  const clips = [];
  for (const n of jets) {
    const track = (n.item.tracks || []).find((t) => LEVEL_TRACK.test(t.type));
    if (!track) continue;
    const cal = calOf(calibration, n);
    const lead = r3(visibleLead(n.heightM, { delayS: cal?.delayS ?? 0.1, vt: cal?.vtMs }));
    // Open from `lead` before the beep until `afterS` after it (at least the valve's 1 s minimum
    // on time), then at least 1 s closed: a tall jet pulses on every second (third…) beep.
    const on = Math.max(1, lead + afterS);
    const stride = Math.max(1, Math.ceil((on + 1) / periodS));
    beeps.forEach((b, k) => {
      if (k % stride) return;
      const start = r3(Math.max(0, b - lead));
      clips.push({ id: `synctest:${n.id}:${k}`, fixtureId: n.id, trackId: track.id, type: track.type, name: 'Sync test · jets', startTime: start,
        duration: r3(on - (lead - (b - start))), value: 100, fadeIn: 0, fadeOut: 0, color: '#ffffff', leadS: r3(b - start), syncTest: true, source: 'sync-test' });
    });
  }
  const lights = items.filter((i) => i.category !== 'scenery' && isLightItem(i));
  for (const l of lights) {
    const track = (l.tracks || []).find((t) => t.type === 'lighting_master') || (l.tracks || [])[0];
    if (!track) continue;
    beeps.forEach((b, k) => clips.push({ id: `synctest:${l.id}:${k}`, fixtureId: l.id, trackId: track.id, type: track.type, name: 'Sync test · lights', startTime: b,
      duration: 0.4, value: 100, fadeIn: 0, fadeOut: 0, color: '#ffffff', syncTest: true, source: 'sync-test' }));
  }
  return { clips, waterIds: jets.map((n) => n.id), lightIds: lights.map((l) => l.id), beeps, groupLabel };
}

/** Beep onsets (s) in a recording: energy rising above a threshold, at least `minGapS` apart. */
export function detectBeeps(samples, sampleRate, { minGapS = 1, windowMs = 2 } = {}) {
  const w = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const env = [];
  for (let i = 0; i + w <= samples.length; i += w) { let e = 0; for (let j = i; j < i + w; j++) e += samples[j] * samples[j]; env.push(Math.sqrt(e / w)); }
  if (!env.length) return [];
  const sorted = [...env].sort((a, b) => a - b);
  const floor = sorted[Math.floor(0.5 * sorted.length)], peak = sorted[Math.floor(0.995 * (sorted.length - 1))];
  const thr = floor + 0.35 * (peak - floor);
  if (!(peak > floor * 2)) return [];
  const out = [];
  let last = -Infinity;
  for (let k = 1; k < env.length; k++) {
    const t = (k * w) / sampleRate;
    if (env[k] >= thr && env[k - 1] < thr && t - last >= minGapS) { out.push(r3(t)); last = t; }
  }
  return out;
}

/**
 * Residual between what was heard and what was seen at the audience: pairs every seen event
 * with the nearest beep (within half a period). + = seen late → fire earlier.
 * @returns {{ residualMs, n, spreadMs, pairs }}
 */
export function measureResidual(beeps = [], events = [], { periodS = 2 } = {}) {
  const pairs = [];
  for (const e of events) {
    let best = null;
    for (const b of beeps) if (!best || Math.abs(e - b) < Math.abs(e - best)) best = b;
    if (best !== null && Math.abs(e - best) <= periodS / 2) pairs.push({ beep: best, event: e, ms: r1(1000 * (e - best)) });
  }
  if (!pairs.length) return { residualMs: null, n: 0, spreadMs: 0, pairs };
  const ms = pairs.map((p) => p.ms).sort((a, b) => a - b);
  const median = ms.length % 2 ? ms[(ms.length - 1) / 2] : (ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2;
  return { residualMs: r1(median), n: pairs.length, spreadMs: r1(ms.at(-1) - ms[0]), pairs };
}

/** Fold a measured residual into the stored correction (returns a sync patch). */
export function correctionPatch(settings, kind, residualMs, meta = {}) {
  const key = kind === 'lights' ? 'lights' : 'water';
  const current = num(settings.correctionMs?.[key]);
  return {
    correctionMs: { ...(settings.correctionMs || {}), [key]: r1(current + num(residualMs)) },
    measurements: [...(settings.measurements || []).slice(-19), { kind: key, residualMs: r1(num(residualMs)), at: Date.now(), ...meta }],
  };
}

/**
 * Tap tool: taps on the beeps heard (one pass) and on the water tops / light flashes seen
 * (another pass) of the same periodic test. Reaction time cancels between the passes; the
 * phases are compared modulo the beep period. + = seen late → fire earlier.
 */
export function tapResidual(heard = [], seen = [], periodS = 2) {
  if (heard.length < 3 || seen.length < 3) return { residualMs: null, n: Math.min(heard.length, seen.length), spreadMs: 0 };
  const t0 = heard[0];
  const phase = (t) => { let p = ((t - t0) % periodS + periodS) % periodS; if (p > periodS / 2) p -= periodS; return p; };
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  const h = heard.map(phase), v = seen.map(phase);
  const ph = med(h);
  // Seen phases relative to the heard phase, wrapped into ±period/2.
  const rel = v.map((p) => { let d = p - ph; if (d > periodS / 2) d -= periodS; if (d < -periodS / 2) d += periodS; return d; });
  const all = [...rel].sort((a, b) => a - b);
  return { residualMs: r1(1000 * med(rel)), n: Math.min(heard.length, seen.length), spreadMs: r1(1000 * (all.at(-1) - all[0])) };
}
