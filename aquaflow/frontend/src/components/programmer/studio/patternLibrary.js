// Saved pattern-builder presets: builder options only (never fixture or group ids),
// kept in the project (studio.presets, kind 'pattern') and in a per-user library
// (localStorage, export/import as JSON). One built-in example ships with the app.
import { PATTERN_PRESETS, presetById } from './patternPresets';
import { uid } from './showModel';

export const LIBRARY_KEY = 'aquaflow.patternPresets.v1';
export const LIBRARY_FORMAT = 'aquaflow-pattern-presets';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, fallback) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const ORDERS = ['clockwise', 'counter-clockwise', 'left-to-right', 'right-to-left', 'front-to-back', 'center-out', 'engineering', 'inward', 'outward'];
const COLOR = /^#[0-9a-f]{6}$/i;

export const BUILTIN_PRESETS = Object.freeze([{
  id: 'builtin:lebu-wave', name: 'Lebu wave', kind: 'pattern', builtin: true, preset: 'wave',
  options: { lapSeconds: 10, duration: 30, minLevel: 35, maxLevel: 100, order: 'clockwise', crests: 1, smoothness: 'smooth', color: '#65d9d0' },
  lights: { enabled: true, level: 30, color: '#4f8cff' },
}]);

/** Keep only builder options; drop anything that names fixtures, groups or timing position. */
export function sanitizePreset(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = String(raw.name || '').trim().slice(0, 60);
  if (!name || !PATTERN_PRESETS.some(p => p.id === raw.preset)) return null;
  const d = presetById(raw.preset).defaults;
  const o = raw.options || {};
  const maxLevel = clamp(Math.round(num(o.maxLevel, d.maxLevel)), 5, 100);
  const options = {
    lapSeconds: clamp(num(o.lapSeconds, d.lapSeconds), 0.5, 120),
    minLevel: clamp(Math.round(num(o.minLevel, d.minLevel)), 0, maxLevel), maxLevel,
    order: ORDERS.includes(o.order) ? o.order : d.order,
    crests: clamp(Math.round(num(o.crests, d.crests)), 1, 8),
    smoothness: ['smooth', 'medium', 'sharp'].includes(o.smoothness) ? o.smoothness : d.smoothness,
  };
  if (Number.isFinite(Number(o.duration))) options.duration = clamp(num(o.duration, 30), 1, 600);
  if (COLOR.test(o.color || '')) options.color = o.color;
  if (o.axis === 'front-back' || o.axis === 'sides') options.axis = o.axis;
  if (['in', 'out'].includes(o.fade)) options.fade = o.fade;
  const l = raw.lights || {};
  const lights = { enabled: !!l.enabled, level: clamp(Math.round(num(l.level, 30)), 5, 100), color: COLOR.test(l.color || '') ? l.color : '#4f8cff' };
  return { id: typeof raw.id === 'string' && raw.id ? raw.id : uid('preset'), name, kind: 'pattern', preset: raw.preset, options, lights };
}

/** A preset from the builder's current form. */
export function presetFromBuilder(name, { preset, options, lights }) {
  return sanitizePreset({ id: uid('preset'), name, preset, options, lights });
}

/** Builder form values for a preset (start stays where the user is). */
export function builderValuesFromPreset(saved, current = {}) {
  const p = sanitizePreset(saved);
  if (!p) return null;
  return {
    preset: p.preset,
    options: { ...presetById(p.preset).defaults, ...current, ...p.options, start: current.start ?? 0, seed: current.seed ?? 1 },
    lights: p.lights,
  };
}

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function loadUserLibrary() {
  try {
    const raw = storage()?.getItem(LIBRARY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(sanitizePreset).filter(Boolean) : [];
  } catch { return []; }
}

export function saveUserLibrary(list) {
  try { storage()?.setItem(LIBRARY_KEY, JSON.stringify(list.map(sanitizePreset).filter(Boolean))); return true; }
  catch { return false; }
}

/** Add or replace (same name) a preset in a list. */
export function upsertPreset(list, preset) {
  const clean = sanitizePreset(preset);
  if (!clean) return list;
  const key = clean.name.toLowerCase();
  return [...list.filter(p => p.name.toLowerCase() !== key), clean];
}

export function exportLibrary(list) {
  return JSON.stringify({ format: LIBRARY_FORMAT, version: 1, presets: list.map(sanitizePreset).filter(Boolean) }, null, 2);
}

/** Parse an exported file (or a bare array). Invalid entries are skipped. */
export function importLibrary(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('Not a preset file'); }
  const list = Array.isArray(data) ? data : data?.format === LIBRARY_FORMAT ? data.presets : null;
  if (!Array.isArray(list)) throw new Error('Not a preset file');
  return list.map(p => sanitizePreset({ ...p, id: undefined })).filter(Boolean);
}

/** Cards shown in the builder: built-in, project, then user library (deduplicated by name). */
export function presetCards(projectPresets = [], userPresets = []) {
  const seen = new Set(), out = [];
  const add = (p, source) => {
    const clean = p.builtin ? p : sanitizePreset(p);
    if (!clean || seen.has(clean.name.toLowerCase())) return;
    seen.add(clean.name.toLowerCase());
    out.push({ ...clean, source });
  };
  BUILTIN_PRESETS.forEach(p => add(p, 'built-in'));
  projectPresets.filter(p => p?.kind === 'pattern').forEach(p => add(p, 'project'));
  userPresets.forEach(p => add(p, 'library'));
  return out;
}
