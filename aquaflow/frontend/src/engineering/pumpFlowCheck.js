// Preflight: pump flow limits (Diagnostic shape of preflight/preflight.js). Pure.
//   pump-flow-over     the show asks a pump for more than its rated flow × margin (error)
//   pump-flow-design   every jet of a pump open together would need more than its rating (info:
//                      the show compiler keeps the show inside it)
//   pump-head-low      the pump's head is below what its highest jet needs (warning)
import { readFountainDesign } from "../components/programmer/studio/fountainDesign";
import { pumpPeaks } from "../components/programmer/studio/showMetrics";
import { DEFAULT_FLOW_MARGIN_PCT, clockOf, pumpLoads } from "./pumpFlow";

/**
 * @param {{ fixtures: object[], clips?: object[] }} project  the preflight request project
 * @param {{ marginPct?: number }} opts
 */
export function pumpFlowDiagnostics(project, { marginPct = DEFAULT_FLOW_MARGIN_PCT } = {}) {
  const fixtures = (project?.fixtures || []).map((f) => ({ ...f, label: f.label || f.name || f.id }));
  const design = readFountainDesign(fixtures);
  if (!design.pumps.size) return [];
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  const peaks = clips.length ? pumpPeaks(clips, design, { marginPct }) : null;
  const out = [];
  for (const p of pumpLoads(design, { marginPct, peaks })) {
    const fix = { kind: "open_engineering_item", target: p.id };
    if (p.capLpm && p.peakLpm && p.peakLpm > p.capLpm * 1.02) {
      out.push({ code: "pump-flow-over", severity: "error", timeMs: Math.round((p.peakT || 0) * 1000), fixtureId: p.id, engineeringItemId: p.id, fix,
        message: `${p.name} is asked for ${p.peakLpm} L/min at ${clockOf(p.peakT)} — ${p.peakPct} % of its rated ${p.ratedLpm} L/min`
          + `${marginPct !== 100 ? ` (margin ${marginPct} %)` : ""}. Recompile the show (the compiler keeps every pump inside its rating) `
          + "or connect fewer jets to this pump in Engineering Tools → Connections." });
    }
    if (p.allOpenOver) {
      out.push({ code: "pump-flow-design", severity: "info", timeMs: null, fixtureId: p.id, engineeringItemId: p.id, fix,
        message: `${p.name}: all ${p.jets} jets open need ${p.allOpenLpm} L/min = ${p.allOpenPct} % of its rated ${p.ratedLpm} L/min. `
          + `The show is kept inside the rating (${p.vfd ? "the VFD slows the pump or " : ""}some jets sit out); a bigger pump or fewer jets on it keeps full height.` });
    }
    if (p.headOk === false) {
      out.push({ code: "pump-head-low", severity: "warning", timeMs: null, fixtureId: p.id, engineeringItemId: p.id, fix,
        message: `${p.name}: head ${Math.round(p.headM * 10) / 10} m is below the ${p.requiredHeadM} m its highest jet needs (nozzle head + pipe losses).` });
    }
  }
  return out;
}
