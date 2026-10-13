/**
 * preflight.js — AF-NEXT-009 preflight gate, frontend side.
 *
 * The backend (POST /api/preflight, services/preflight.py) is the authoritative gate: it
 * resolves the show once and returns every Diagnostic. This module
 *   - builds the request project from the stores (no new store, no new clock),
 *   - merges the backend issues with the AF-NEXT-007/008 hydraulic and splash diagnostics
 *     (engineering/showDiagnostics.js, loaded only when that module is present),
 *   - groups issues by severity, and
 *   - performs the "fix" navigation: open the timeline clip, select the Engineering item,
 *     or open a panel. Navigation only — nothing here sends, arms or starts anything.
 *
 * Diagnostic: { code, severity: "error"|"warning"|"info", timeMs|null, fixtureId|null,
 *   clipId|null, engineeringItemId|null, message, fix: {kind, target}|null, source }
 */
import { API_BASE_URL } from "../config";

export const PREVIEW_ONLY_LABEL = "PREVIEW ONLY — not sent to hardware";
export const SEVERITIES = Object.freeze(["error", "warning", "info"]);
export const FIX_KINDS = Object.freeze(["open_clip", "open_engineering_item", "open_panel"]);

const toId = value => (value === undefined || value === null || value === "" ? null : String(value));

/** Coerce anything diagnostic-like into the shared shape (unknown severities become warnings). */
export function normalizeDiagnostic(raw, source = "preflight") {
  const d = raw && typeof raw === "object" ? raw : { message: String(raw ?? "") };
  const severity = SEVERITIES.includes(d.severity) ? d.severity : d.severity === "warn" ? "warning" : "warning";
  const timeMs = Number.isFinite(Number(d.timeMs)) && d.timeMs !== null && d.timeMs !== "" ? Math.round(Number(d.timeMs)) : null;
  const fix = d.fix && FIX_KINDS.includes(d.fix.kind) && toId(d.fix.target) ? { kind: d.fix.kind, target: String(d.fix.target) } : null;
  return {
    code: String(d.code || "diagnostic"), severity, timeMs,
    fixtureId: toId(d.fixtureId), clipId: toId(d.clipId), engineeringItemId: toId(d.engineeringItemId),
    message: String(d.message || d.code || ""), fix, source: String(d.source || source),
  };
}

const keyOf = d => [d.code, d.severity, d.timeMs, d.fixtureId, d.clipId, d.engineeringItemId, d.message].join("|");
const ORDER = { error: 0, warning: 1, info: 2 };

/** Merge diagnostic lists (backend + hydraulics + splash), de-duplicated and sorted by severity then time. */
export function mergeDiagnostics(...lists) {
  const seen = new Set(), out = [];
  for (const list of lists) {
    for (const raw of Array.isArray(list) ? list : []) {
      const d = normalizeDiagnostic(raw);
      const key = keyOf(d);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(d);
    }
  }
  return out.sort((a, b) => (ORDER[a.severity] - ORDER[b.severity]) || ((a.timeMs ?? -1) - (b.timeMs ?? -1)) || a.code.localeCompare(b.code));
}

export function groupBySeverity(issues) {
  const groups = { error: [], warning: [], info: [] };
  for (const issue of issues || []) (groups[issue.severity] || groups.warning).push(issue);
  return groups;
}

export function summarizeDiagnostics(issues) {
  const g = groupBySeverity(issues);
  return { errors: g.error.length, warnings: g.warning.length, infos: g.info.length, total: (issues || []).length };
}

// AF-NEXT-007/008 own engineering/showDiagnostics.js. A glob (not a static import) keeps this
// module building and testable whether or not that file exists yet.
const optionalModules = import.meta.glob("../engineering/showDiagnostics.js");

export async function loadShowDiagnostics(project, show, opts = {}, modules = optionalModules) {
  const loader = Object.values(modules || {})[0];
  if (!loader) return [];
  try {
    const mod = await loader();
    const [hydraulics, splash] = await Promise.all([
      typeof mod.getHydraulicDiagnostics === "function" ? mod.getHydraulicDiagnostics(project, show, opts) : [],
      typeof mod.getSplashDiagnostics === "function" ? mod.getSplashDiagnostics(project, show, opts) : [],
    ]);
    return [
      ...(Array.isArray(hydraulics) ? hydraulics : []).map(d => normalizeDiagnostic(d, "hydraulics")),
      ...(Array.isArray(splash) ? splash : []).map(d => normalizeDiagnostic(d, "splash")),
    ];
  } catch (error) {
    return [normalizeDiagnostic({ code: "diagnostics-failed", severity: "warning",
      message: `Hydraulic/splash diagnostics could not run: ${error?.message || error}`, source: "hydraulics" })];
  }
}

const FIXTURE_KEYS = ["id", "type", "fixtureType", "kind", "label", "name", "groupId", "engineering", "supplyingPumpId",
  "linkedValveId", "pumpId", "valveId", "bypass", "hasBypass", "dependsOn", "universe", "dmxUniverse", "dmxAddress",
  "dmxChannel", "dmxFootprint", "channel", "register", "plcRegister", "plcChannel", "plcHost", "unitId", "output",
  "plcOutput", "ican_group", "ican_channel", "icanGroup", "icanChannel", "maxIntensity", "max_percent", "maxPercent",
  "min_on_ms", "min_off_ms", "minOnMs", "minOffMs", "safety_max", "siemensSiteId",
  // AF-NEXT-007/008: plan position, aim and equipment data source for hydraulics and splash.
  "x", "y", "rotation", "provenance"];

/** The request project: Engineering fixtures + the resolved Show Studio clips (+ recipes/groups for mute/solo). */
export function buildPreflightProject({ fixtures = [], programmer = {}, hydraulicNetwork = null, site = null } = {}) {
  const studio = programmer?.studio || {};
  const slim = (fixtures || []).filter(f => f && f.id != null).map(f => Object.fromEntries(
    FIXTURE_KEYS.filter(k => f[k] !== undefined).map(k => [k, f[k]])));
  return {
    fixtures: slim,
    clips: Array.isArray(programmer?.timelineClips) ? programmer.timelineClips : [],
    recipes: studio.recipes || [], groups: studio.groups || [],
    ...(studio.tempo ? { tempo: studio.tempo } : {}),
    ...(hydraulicNetwork ? { hydraulic_network: hydraulicNetwork } : {}),
    // AF-NEXT-008: basin outlines (islands as holes) for the splash envelope.
    ...(site?.basins?.length ? { basins: site.basins } : {}),
    ...(site?.geometry ? { geometry: site.geometry, poolType: site.poolType, params: site.params || {} } : {}),
  };
}

/** Run the backend gate and merge the hydraulic/splash diagnostics. */
export async function runPreflight(project, target = { kind: "preview" }, { fetchImpl = fetch, modules } = {}) {
  const [response, local] = await Promise.all([
    fetchImpl(`${API_BASE_URL}/preflight`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project, target }),
    }),
    // The project carries clips + recipes/groups/tempo (mute/solo): the same show the backend
    // gate hands services/show_hydraulics, so identical findings de-duplicate.
    loadShowDiagnostics(project, project, {}, modules),
  ]);
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data?.detail === "string" ? data.detail : data?.detail?.message || "Preflight failed");
  const issues = mergeDiagnostics(data.issues || [], local);
  const summary = summarizeDiagnostics(issues);
  return { ...data, issues, summary, ok: summary.errors === 0 };
}

// ─── fix navigation ─────────────────────────────────────────────────────

const pending = { clip: null, engineering: null };

/** A view that mounts after the navigation event can still pick up the request. */
export function takePendingFocus(kind) {
  const value = pending[kind];
  pending[kind] = null;
  return value;
}

/** Resolved Studio clip ids are `${recipeId}:${fixtureId}:${n}`; the editable item is the recipe. */
export function timelineItemId(clipId) {
  if (!clipId) return null;
  return String(clipId).split(":")[0];
}

/**
 * Perform an issue's fix. Returns {panel, event, detail} describing the navigation.
 * `env` is injectable for tests: {dispatch, selectLegacyClip}.
 */
export function openDiagnosticFix(issue, env = {}) {
  const fix = issue?.fix;
  if (!fix) return null;
  const dispatch = env.dispatch || ((name, detail) => {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
  });
  if (fix.kind === "open_clip") {
    const detail = { clipId: fix.target, itemId: timelineItemId(fix.target), timeMs: issue.timeMs ?? null, fixtureId: issue.fixtureId ?? null };
    pending.clip = detail;
    dispatch("aquaflow:open-panel", { panel: "show_programmer" });
    dispatch("aquaflow:open-clip", detail);
    env.selectLegacyClip?.(fix.target);
    return { panel: "show_programmer", event: "aquaflow:open-clip", detail };
  }
  if (fix.kind === "open_engineering_item") {
    const detail = { id: fix.target, timeMs: issue.timeMs ?? null };
    pending.engineering = detail;
    dispatch("aquaflow:open-panel", { panel: "geometry" });
    dispatch("aquaflow:select-engineering-item", detail);
    return { panel: "geometry", event: "aquaflow:select-engineering-item", detail };
  }
  if (fix.kind === "open_panel") {
    dispatch("aquaflow:open-panel", { panel: fix.target });
    return { panel: fix.target, event: "aquaflow:open-panel", detail: { panel: fix.target } };
  }
  return null;
}

export function fixLabel(fix) {
  if (!fix) return "";
  if (fix.kind === "open_clip") return "Open clip";
  if (fix.kind === "open_engineering_item") return "Select in Engineering";
  return `Open ${fix.target}`;
}

/**
 * AF-NEXT-014: share a finished preflight with the workspace guidance (errors count, issue
 * list). Event only — the result is still owned by whoever ran it.
 */
export function publishPreflightResult(result, target = null) {
  if (!result || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("aquaflow:preflight-result", {
    detail: { ...result, target: result.target || target || null, at: new Date().toISOString() },
  }));
}
