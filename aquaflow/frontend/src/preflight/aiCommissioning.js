// AI commissioning helper (optional) — the app side. Gathers what the engine's helper reads
// (backend/services/ai_commissioning.py): the current preflight issues, the PLC connection
// status, active faults and recent log lines, plus a short site summary. Secrets are redacted
// here too (the engine redacts again) and every list is capped. Read-only: gathering uses GET
// /api/faults/alerts and the in-app log; nothing here sends, arms, starts or pulses anything.

import { apiGet, apiPost } from '../utils/apiClient';

export const LIMITS = Object.freeze({ issues: 120, faults: 40, logs: 60, line: 400 });

const SECRET_WORD = String.raw`(?:api[_ -]?key|secret|passw(?:or)?d|pwd|token|licen[cs]e[_ -]?key|licen[cs]e|auth(?:orization)?|credentials?|private[_ -]?key)`;
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]+/g, '[redacted]'],
  [/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [new RegExp(String.raw`(\b${SECRET_WORD}\b["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}]+)`, 'gi'), '$1[redacted]'],
  [/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[redacted]'],
];
const SECRET_KEY = new RegExp(SECRET_WORD, 'i');

/** Free text with anything that looks like a key, password, token or licence replaced. */
export function redactText(text) {
  let s = String(text ?? '');
  for (const [re, rep] of PATTERNS) s = s.replace(re, rep);
  return s;
}

const line = (text) => redactText(text).replace(/\s+/g, ' ').trim().slice(0, LIMITS.line);

// The PLC status fields that explain a connection problem (no commanded values, no secrets).
const PLC_KEYS = ['connection_state', 'quality', 'running', 'armed', 'verified', 'hardware_verified', 'stop_confirmed', 'telemetry_fresh',
  'last_rx_age_seconds', 'contract_version', 'fault', 'error', 'plc_running', 'feedback_valid', 'mode'];

/** A slim, redacted PLC status (null when no site / no status). */
export function slimPlcStatus(status, mode = null) {
  if (!status || typeof status !== 'object') return mode ? { mode, connection_state: 'no status' } : null;
  const out = {};
  for (const k of PLC_KEYS) if (status[k] !== undefined && status[k] !== null && !SECRET_KEY.test(k)) out[k] = typeof status[k] === 'string' ? line(status[k]) : status[k];
  if (mode && out.mode === undefined) out.mode = mode;
  const faulted = Object.entries(status.feedback || {}).filter(([, v]) => v?.fault).map(([id]) => id);
  if (faulted.length) out.feedback_faults = faulted.slice(0, 20);
  return out;
}

/**
 * The request body for POST /api/ai/commissioning-help.
 * @param {object} o { issues (preflight Diagnostics), plc (status), mode, faults, logs (strings or {level,msg,ts}), site }
 */
export function commissioningInput({ issues = [], plc = null, mode = null, faults = [], logs = [], site = '' } = {}) {
  return {
    preflight: (issues || []).slice(0, LIMITS.issues).map((d) => ({
      code: String(d.code || 'diagnostic'), severity: d.severity || 'warning', message: line(d.message),
      ...(d.source ? { source: String(d.source) } : {}), ...(d.timeMs != null ? { timeMs: d.timeMs } : {}),
      ...(d.fixtureId ? { fixtureId: String(d.fixtureId) } : {}), ...(d.clipId ? { clipId: String(d.clipId) } : {}),
      ...(d.engineeringItemId ? { engineeringItemId: String(d.engineeringItemId) } : {}),
    })),
    plc: slimPlcStatus(plc, mode),
    faults: (faults || []).slice(0, LIMITS.faults).map((f) => ({ code: String(f.code || '?'), severity: f.severity || '', message: line(f.message),
      source: line(f.source || ''), ...(f.occurrences ? { occurrences: f.occurrences } : {}) })),
    logs: (logs || []).slice(0, LIMITS.logs).map((l) => line(typeof l === 'string' ? l : `${l.level || 'info'} ${l.msg || l.message || ''}`)).filter(Boolean),
    site: line(site).slice(0, 1000),
  };
}

/** A one-line site summary from the Engineering fixtures and the chosen controller. */
export function siteSummary({ fixtures = [], target = null, siteName = '' } = {}) {
  const count = (re) => fixtures.filter((f) => re.test(String(f.type || ''))).length;
  return [siteName && `Site ${siteName}`, target && `controller: ${target}`,
    `${fixtures.length} fixtures (${count(/nozzle|jet/i)} nozzles, ${count(/valve|solenoid/i)} valves, ${count(/pump/i)} pumps, ${count(/light/i)} lights)`]
    .filter(Boolean).join(' · ');
}

/** Read-only: the engine's active fault alerts (empty when the engine has none / is offline). */
export async function activeFaults({ get = apiGet } = {}) {
  try { return (await get('/faults/alerts'))?.alerts || []; } catch { return []; }
}

/** Ask the engine's commissioning helper. Throws with a readable message when unavailable. */
export async function requestCommissioningHelp(body, { post = apiPost } = {}) {
  return post('/ai/commissioning-help', body);
}
