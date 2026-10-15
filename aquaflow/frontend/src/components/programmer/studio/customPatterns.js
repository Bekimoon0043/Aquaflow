// "My patterns": pattern types made in the pattern creator. Saved with the project
// (studio.presets, kind 'field-type') and in this computer's library (localStorage), and
// exchanged as files ('aquaflow-pattern-types').
import { CUSTOM_KIND, DEFAULT_DRAWN } from './wavePatterns';

export const TYPES_FORMAT = 'aquaflow-pattern-types';
const LIBRARY_KEY = 'aquaflow.myPatternTypes.v1';
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** A clean, complete custom field from anything (unknown keys dropped, ranges clamped). */
export function cleanField(raw = {}) {
  const d = CUSTOM_KIND.defaults;
  const pick = (k, lo, hi) => Math.min(hi, Math.max(lo, num(raw[k], d[k] ?? lo)));
  const f = {
    kind: 'custom', shape: ['sine', 'bump', 'rise-fall', 'pulse', 'drawn'].includes(raw.shape) ? raw.shape : d.shape,
    path: ['together', 'around', 'from-point', 'alternate', 'random'].includes(raw.path) ? raw.path : d.path,
    motion: raw.motion === 'there-and-back' ? 'there-and-back' : 'repeat',
    period: pick('period', 0.5, 60), crests: pick('crests', 0, 12), width: pick('width', 0.02, 0.5), rise: pick('rise', 0.03, 0.6),
    spread: pick('spread', 0, 2), block: Math.round(pick('block', 1, 40)), drift: pick('drift', 0, 120),
    direction: num(raw.direction, 1) < 0 ? -1 : 1, origin: ['tip', 'top', 'bottom', 'left', 'right', 'first'].includes(raw.origin) ? raw.origin : 'tip',
    bothWays: !!raw.bothWays, grow: !!raw.grow, accel: pick('accel', 0, 0.05),
    low: pick('low', 0, 100), high: pick('high', 0, 100), ease: Math.min(5, Math.max(0, num(raw.ease, 1))),
  };
  if (raw.lowFar !== undefined) f.lowFar = Math.min(100, Math.max(0, num(raw.lowFar, f.low)));
  if (raw.highFar !== undefined) f.highFar = Math.min(100, Math.max(0, num(raw.highFar, f.high)));
  if (raw.stairs !== undefined) f.stairs = Math.round(Math.min(12, Math.max(0, num(raw.stairs, 0))));
  if (f.shape === 'drawn') {
    const pts = (Array.isArray(raw.points) ? raw.points : DEFAULT_DRAWN)
      .map(p => ({ time: Math.min(1, Math.max(0, num(p.time, 0))), value: Math.min(1, Math.max(0, num(p.value, 0))) }))
      .sort((a, b) => a.time - b.time);
    f.points = pts.length > 1 ? pts : DEFAULT_DRAWN;
  }
  return f;
}

export function cleanType(raw = {}) {
  const light = raw.light || {};
  return {
    id: String(raw.id || `type-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
    name: String(raw.name || 'My pattern').slice(0, 60),
    field: cleanField(raw.field),
    light: { color: /^#[0-9a-f]{6}$/i.test(light.color || '') ? light.color : '#4f8cff', colorMode: light.colorMode === 'rainbow' ? 'rainbow' : 'solid',
      low: Math.min(100, Math.max(0, num(light.low, 6))), high: Math.min(100, Math.max(0, num(light.high, 20))) },
  };
}

export function loadMyTypes() {
  try { const list = JSON.parse(globalThis.localStorage?.getItem(LIBRARY_KEY) || '[]'); return Array.isArray(list) ? list.map(cleanType) : []; }
  catch { return []; }
}
export function saveMyTypes(list) {
  try { globalThis.localStorage?.setItem(LIBRARY_KEY, JSON.stringify(list)); return true; } catch { return false; }
}
/** Replace a type with the same name (case-insensitive), else append. */
export function upsertType(list, type) {
  const key = type.name.trim().toLowerCase();
  return [...list.filter(t => t.name.trim().toLowerCase() !== key), type];
}
/** Project types first, then this computer's library (same name → the project's wins). */
export function myTypes(studio) {
  const project = (studio?.presets || []).filter(p => p.kind === 'field-type').map(cleanType);
  const names = new Set(project.map(t => t.name.toLowerCase()));
  return [...project.map(t => ({ ...t, source: 'project' })), ...loadMyTypes().filter(t => !names.has(t.name.toLowerCase())).map(t => ({ ...t, source: 'library' }))];
}
export function saveTypeToProject(studio, type) {
  const clean = { ...cleanType(type), kind: 'field-type' };
  const others = (studio.presets || []).filter(p => !(p.kind === 'field-type' && p.name.toLowerCase() === clean.name.toLowerCase()));
  return { ...studio, presets: [...others, clean] };
}
export function exportTypes(list) {
  return JSON.stringify({ format: TYPES_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    types: list.map(t => { const { source, kind, ...rest } = cleanType(t); return rest; }) }, null, 1);
}
export function importTypes(text) {
  const data = typeof text === 'string' ? JSON.parse(text) : text;
  if (data?.format !== TYPES_FORMAT || !Array.isArray(data.types)) throw new Error('This is not an AquaFlow pattern-type file.');
  return data.types.map(cleanType);
}

/**
 * How each built-in pattern is made from the basic pieces — the pattern creator's
 * examples (and the guide's recipes). Heights match the Lebu 160-second show.
 */
export const EXAMPLES = [
  { name: 'Rolling wave', field: { shape: 'sine', path: 'from-point', origin: 'tip', crests: 1.67, period: 6.67, low: 18, high: 42, lowFar: 32, highFar: 80, stairs: 6 }, light: { color: '#0000ff' } },
  { name: 'Travelling wave', field: { shape: 'sine', path: 'around', crests: 4, period: 5, direction: 1, low: 20, high: 75 }, light: { color: '#00ff00' } },
  { name: 'See-saw', field: { shape: 'sine', path: 'alternate', block: 4, drift: 10, period: 4, low: 22, high: 72 }, light: { color: '#ff0000' } },
  { name: 'Grand swell', field: { shape: 'sine', path: 'together', spread: 0.12, period: 5, low: 18, high: 80 }, light: { color: '#8cd9ff' } },
  { name: 'Converge & split', field: { shape: 'bump', width: 0.16, path: 'from-point', crests: 1, motion: 'there-and-back', period: 7.5, low: 18, high: 80 }, light: { color: '#ff00ff' } },
  { name: 'Crossing waves', field: { shape: 'bump', width: 0.24, path: 'around', crests: 2, bothWays: true, period: 5, low: 18, high: 78 }, light: { color: '#00ffb3' } },
  { name: 'Stadium wave', field: { shape: 'rise-fall', rise: 0.1, path: 'around', crests: 1, period: 7.5, direction: 1, low: 20, high: 82 }, light: { color: '#ff7300' } },
  { name: 'Rainbow finale', field: { shape: 'sine', path: 'around', crests: 3, period: 5, grow: true, accel: 0.00375, low: 20, high: 82 }, light: { colorMode: 'rainbow', color: '#ff66cc' } },
].map(e => cleanType({ ...e, id: `example-${e.name.toLowerCase().replace(/\W+/g, '-')}` }));
