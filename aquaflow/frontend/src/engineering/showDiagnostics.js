/**
 * showDiagnostics.js — AF-NEXT-007 / AF-NEXT-008 shared Diagnostic producer.
 *
 * Diagnostic shape (consumed by the AF-NEXT-009 preflight gate — do not change):
 *   {
 *     code: string,
 *     severity: "error" | "warning" | "info",
 *     timeMs: number | null,
 *     fixtureId: string | null,
 *     clipId: string | null,
 *     engineeringItemId: string | null,
 *     message: string,
 *     fix: { kind: "open_clip" | "open_engineering_item" | "open_panel", target: string } | null,
 *     source: "hydraulics" | "splash",
 *   }
 *
 * Inputs:
 *   project — engineering project { fixtures (with engineering: flowLpm, pressureBar,
 *             jetHeightM, pumpId, valveId, ...), basins | geometry, params, hydraulic_network? }
 *   show    — { clips (the flat clips evaluateShowFrame reads), duration?, groups?, recipes?,
 *             tempo?, sections?, frameOpts? }
 *
 * getHydraulicDiagnostics calls POST /api/hydraulics/show-timeline (cached per revision).
 * getSplashDiagnostics uses that timeline's delivered heights when it can be fetched and
 * falls back to nominal heights (labelled by an info diagnostic) when it cannot.
 * Splash results are ADVISORY until field calibration verifies them.
 */
import { fetchShowTimeline, sampleHydraulicTimeline } from "./showHydraulicsClient.js";
import { ADVISORY_LABEL, computeSplashEnvelope } from "./splashEnvelope.js";

export const DIAGNOSTIC_KEYS = Object.freeze(["code", "severity", "timeMs", "fixtureId", "clipId",
  "engineeringItemId", "message", "fix", "source"]);
const SEVERITIES = new Set(["error", "warning", "info"]);
const FIX_KINDS = new Set(["open_clip", "open_engineering_item", "open_panel"]);

const str = v => (v == null ? null : String(v));

/** Coerce any record to exactly the shared Diagnostic shape. */
export function toDiagnostic(d, source) {
  const fix = d?.fix && FIX_KINDS.has(d.fix.kind) && d.fix.target != null
    ? { kind: d.fix.kind, target: String(d.fix.target) } : null;
  const t = Number(d?.timeMs);
  return {
    code: String(d?.code || "UNKNOWN"),
    severity: SEVERITIES.has(d?.severity) ? d.severity : "warning",
    timeMs: d?.timeMs == null || !Number.isFinite(t) ? null : t,
    fixtureId: str(d?.fixtureId),
    clipId: str(d?.clipId),
    engineeringItemId: str(d?.engineeringItemId),
    message: String(d?.message || ""),
    fix,
    source,
  };
}

/** Diagnostics from an already-fetched AF-NEXT-007 timeline. */
export function hydraulicDiagnosticsFromTimeline(timeline) {
  return (timeline?.diagnostics || []).map(d => toDiagnostic(d, "hydraulics"));
}

/** Diagnostics from a computed splash envelope (computeSplashEnvelope result). */
export function splashDiagnosticsFromEnvelope(envelope) {
  return (envelope?.report || []).map(r => toDiagnostic({
    code: "SPLASH_OUTSIDE_BASIN",
    severity: r.distanceOutsideM >= 1.0 ? "error" : "warning",
    timeMs: r.timeMs,
    fixtureId: r.nozzleId,
    clipId: r.clipId,
    engineeringItemId: r.nozzleId,
    message: `${ADVISORY_LABEL}. Jet ${r.nozzleId} (${r.heightM.toFixed(2)} m, ${r.heightBasis}) lands up to `
      + `${r.distanceOutsideM.toFixed(2)} m outside the basin at ${(r.worstTimeMs / 1000).toFixed(2)} s `
      + `(landing ${r.landingPoint.x.toFixed(2)}, ${r.landingPoint.y.toFixed(2)}; until ${(r.endMs / 1000).toFixed(2)} s). `
      + r.recommendation,
    fix: r.clipId ? { kind: "open_clip", target: r.clipId } : { kind: "open_engineering_item", target: r.nozzleId },
  }, "splash"));
}

/** AF-NEXT-007: named hydraulic diagnostics for the show (calls the backend). */
export async function getHydraulicDiagnostics(project, show, opts = {}) {
  try {
    const timeline = await fetchShowTimeline(project || {}, show || {}, opts.options || {}, opts.post ? { post: opts.post } : {});
    return hydraulicDiagnosticsFromTimeline(timeline);
  } catch (err) {
    return [toDiagnostic({
      code: "HYDRAULICS_UNAVAILABLE", severity: "warning", timeMs: null,
      message: `Time-dependent hydraulics could not be evaluated (${err?.message || err}); pump, valve and nozzle limits are unchecked.`,
      fix: { kind: "open_panel", target: "hydraulics" },
    }, "hydraulics")];
  }
}

/**
 * AF-NEXT-008: overspray diagnostics. opts = { wind, gustFactor, nozzleUncertainty,
 * coupling, sampleStepMs, useHydraulics (default true), timeline, post }.
 */
export async function getSplashDiagnostics(project, show, opts = {}) {
  const extra = [];
  let timeline = opts.timeline || null;
  if (!timeline && opts.useHydraulics !== false) {
    try {
      timeline = await fetchShowTimeline(project || {}, show || {}, opts.options || {}, opts.post ? { post: opts.post } : {});
    } catch {
      timeline = null;
    }
  }
  if (!timeline) {
    extra.push(toDiagnostic({
      code: "SPLASH_NOMINAL_HEIGHTS", severity: "info", timeMs: null,
      message: `${ADVISORY_LABEL}. Splash envelope uses nominal jet heights (level × design height); `
        + "the engineering hydraulic timeline was not available.",
      fix: { kind: "open_panel", target: "splash" },
    }, "splash"));
  }
  const envelope = computeSplashEnvelope(project || {}, show || {}, {
    ...opts,
    sampleTimeline: timeline ? tMs => sampleHydraulicTimeline(timeline, tMs) : null,
    durationS: opts.durationS ?? (timeline?.durationMs ? timeline.durationMs / 1000 : undefined),
  });
  return [...extra, ...splashDiagnosticsFromEnvelope(envelope)];
}
