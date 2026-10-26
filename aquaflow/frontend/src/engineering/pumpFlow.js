// Pump flow limits — what each pump can give against what its jets ask for. Pure.
//
//   rated     the pump's datasheet duty flow (pumpDuty.pumpRating: Flow m³/h wins over L/min)
//   jet flow  the nozzle's flowLpm, else the orifice law from its k-factor and pressure
//             (Q = k·√p, L/min with p in bar)
//   VFD       a pump on a variable-speed drive slows down: its jets' flow falls with the speed
//             (Q ∝ n), so a VFD pump can stay inside its rating by lowering the height a little
//             instead of closing jets
//   margin    the share of the rated flow a show may ask for (default 100 %)
//   head      pump head against the highest jet's nozzle head + an allowance for pipe and valve losses

import { pumpRating } from "./pumpDuty";

export const DEFAULT_FLOW_MARGIN_PCT = 100;
const BAR_TO_M = 10.197;
const LOSS_FACTOR = 1.15;   // pipe / fitting losses on top of the nozzle head (estimate)
const LOSS_EXTRA_M = 1;     // valve + manifold allowance (estimate)

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** True when the pump runs on a variable-speed drive. */
export const isVfdPump = (item) => /vfd|variable|inverter/i.test(`${item?.engineering?.controlType || ""} ${item?.type || ""} ${item?.label || ""}`);

/** Rated flow of a pump (L/min) from its datasheet fields, or null when unknown. */
export function pumpRatedLpm(item) {
  const r = pumpRating(item?.engineering || {});
  return r.flowM3s > 0 ? Math.round(r.flowM3s * 60000 * 100) / 100 : null;
}

/** A jet's flow (L/min) at full height: flowLpm, else k-factor × √pressure. 0 when unknown. */
export function jetFlowLpm(item) {
  const e = item?.engineering || {};
  if (num(e.flowLpm) > 0) return num(e.flowLpm);
  if (num(e.kFactor) > 0 && num(e.pressureBar) > 0) return num(e.kFactor) * Math.sqrt(num(e.pressureBar));
  if (num(e.flowM3Hr) > 0) return num(e.flowM3Hr) * 1000 / 60;
  return 0;
}

/** Head (m) a jet needs at its nozzle. */
export function jetHeadM(item) {
  const e = item?.engineering || {};
  if (num(e.pressureBar) > 0) return num(e.pressureBar) * BAR_TO_M;
  const h = num(e.jetHeightM);
  if (!(h > 0)) return 0;
  return h / (num(e.heightEfficiency) > 0 ? Math.min(1, num(e.heightEfficiency)) : 0.8);
}

/** Per-pump cap (L/min) for a margin in percent; null when the pump has no rating. */
export function pumpCapLpm(item, marginPct = DEFAULT_FLOW_MARGIN_PCT) {
  const rated = pumpRatedLpm(item);
  return rated ? rated * (Math.max(10, num(marginPct) || DEFAULT_FLOW_MARGIN_PCT) / 100) : null;
}

/**
 * Load of every pump in a fountain design (fountainDesign.readFountainDesign):
 * rated flow vs all jets open, head check, VFD, and (optional) the show's peak.
 * @param {object} design
 * @param {{ marginPct?: number, peaks?: Map<string,{lpm:number,t:number}> }} opts
 */
export function pumpLoads(design, { marginPct = DEFAULT_FLOW_MARGIN_PCT, peaks = null } = {}) {
  return [...design.pumps.values()].map((p) => {
    const e = p.item.engineering || {};
    const rated = pumpRatedLpm(p.item);
    const cap = rated ? rated * (Math.max(10, num(marginPct) || DEFAULT_FLOW_MARGIN_PCT) / 100) : null;
    const jets = p.nozzleIds.map((id) => design.nozzleById.get(id)?.item).filter(Boolean);
    const flows = jets.map(jetFlowLpm);
    const allOpen = flows.reduce((a, b) => a + b, 0);
    const missingFlow = flows.filter((q) => !(q > 0)).length;
    const headM = pumpRating(e).headM || null;
    const needM = jets.length ? Math.max(0, ...jets.map(jetHeadM)) : 0;
    const requiredHeadM = needM > 0 ? needM * LOSS_FACTOR + LOSS_EXTRA_M : null;
    const peak = peaks?.get(p.id) || null;
    return {
      id: p.id, name: p.name, vfd: isVfdPump(p.item), ratedLpm: rated ? Math.round(rated) : null, capLpm: cap ? Math.round(cap) : null,
      allOpenLpm: Math.round(allOpen), allOpenPct: cap && allOpen ? Math.round((100 * allOpen) / cap) : null,
      jets: p.nozzleIds.length, valves: p.valveIds.length, missingFlow,
      headM, requiredHeadM: requiredHeadM ? Math.round(requiredHeadM * 10) / 10 : null,
      headOk: headM && requiredHeadM ? headM >= requiredHeadM : null,
      peakLpm: peak ? Math.round(peak.lpm) : null, peakT: peak ? peak.t : null,
      peakPct: peak && cap ? Math.round((100 * peak.lpm) / cap) : null,
      over: !!(cap && peak ? peak.lpm > cap * 1.01 : false),
      allOpenOver: !!(cap && allOpen > cap * 1.001),
    };
  });
}

/** "2:37" from seconds. */
export const clockOf = (t) => {
  const s = Math.max(0, Math.round(Number(t) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
