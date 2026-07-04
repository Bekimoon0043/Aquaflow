// customLibrary.js — AquaFlow user customization (AQ-S3-008)
//
// Persistent user presets on top of the built-in libraries: users save custom
// environments and materials (edited from the built-ins or from scratch). Values are
// validated/clamped to the allowed ranges; slot limits are enforced (50 custom
// environments, 100 custom materials). Backed by localStorage with an in-memory
// fallback so it works in tests / SSR.

import { ENV_PARAM_RANGES } from "./environments";
import { MATERIAL_PARAM_RANGES } from "./materials";

export const MAX_CUSTOM_ENVIRONMENTS = 50;
export const MAX_CUSTOM_MATERIALS = 100;
const ENV_KEY = "aquaflow.customEnvironments";
const MAT_KEY = "aquaflow.customMaterials";

// ── storage (localStorage with in-memory fallback) ──────────────────────────────
const _mem = new Map();
function store() {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch { /* access denied */ }
  return {
    getItem: (k) => (_mem.has(k) ? _mem.get(k) : null),
    setItem: (k, v) => _mem.set(k, v),
    removeItem: (k) => _mem.delete(k),
  };
}
function read(key) {
  try { return JSON.parse(store().getItem(key) || "[]"); } catch { return []; }
}
function write(key, list) { store().setItem(key, JSON.stringify(list)); }

function clampByRanges(params, ranges) {
  const out = {};
  for (const [k, r] of Object.entries(ranges)) {
    if (params[k] === undefined || params[k] === null || params[k] === "") continue;
    const n = Number(params[k]);
    out[k] = Number.isNaN(n) ? r.default : Math.min(r.max, Math.max(r.min, n));
  }
  return out;
}

let _seq = 0;
function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${(_seq++).toString(36)}`;
}

// ── Environments ────────────────────────────────────────────────────────────────
export function listCustomEnvironments() { return read(ENV_KEY); }

export function saveCustomEnvironment(env) {
  const list = read(ENV_KEY);
  const editingId = env.id && !env.builtin ? env.id : null;
  if (!editingId && list.length >= MAX_CUSTOM_ENVIRONMENTS)
    throw new Error(`Custom environment limit reached (${MAX_CUSTOM_ENVIRONMENTS}).`);
  const record = {
    id: editingId || newId("env-custom"),
    name: String(env.name || "Custom Environment"),
    time: env.time || "day",
    hdri: env.hdri !== undefined ? !!env.hdri : true,
    builtin: false,
    params: { ...clampByRanges(env.params || {}, ENV_PARAM_RANGES) },
  };
  const idx = list.findIndex((e) => e.id === record.id);
  if (idx >= 0) list[idx] = record; else list.push(record);
  write(ENV_KEY, list);
  return record;
}

export function deleteCustomEnvironment(id) {
  write(ENV_KEY, read(ENV_KEY).filter((e) => e.id !== id));
}

// ── Materials ───────────────────────────────────────────────────────────────────
export function listCustomMaterials() { return read(MAT_KEY); }

export function saveCustomMaterial(material) {
  const list = read(MAT_KEY);
  const editingId = material.id && !material.builtin ? material.id : null;
  if (!editingId && list.length >= MAX_CUSTOM_MATERIALS)
    throw new Error(`Custom material limit reached (${MAX_CUSTOM_MATERIALS}).`);
  const clamped = clampByRanges(material, MATERIAL_PARAM_RANGES);
  const record = {
    id: editingId || newId("mat-custom"),
    name: String(material.name || "Custom Material"),
    color: material.color || "#c8ccd0",
    builtin: false,
    roughness: clamped.roughness ?? 0.5,
    metalness: clamped.metalness ?? 0,
    ior: clamped.ior ?? 1.5,
    transmission: clamped.transmission ?? 0,
    clearcoat: clamped.clearcoat ?? 0,
    reflectivity: clamped.reflectivity ?? 0.5,
    normal_intensity: clamped.normal_intensity ?? 1,
    texture_scale: clamped.texture_scale ?? 1,
  };
  const idx = list.findIndex((m) => m.id === record.id);
  if (idx >= 0) list[idx] = record; else list.push(record);
  write(MAT_KEY, list);
  return record;
}

export function deleteCustomMaterial(id) {
  write(MAT_KEY, read(MAT_KEY).filter((m) => m.id !== id));
}

// Test / reset helper.
export function clearCustomLibrary() {
  write(ENV_KEY, []); write(MAT_KEY, []);
}
