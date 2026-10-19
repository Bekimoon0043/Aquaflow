/**
 * pumpDuty.js — mirror of backend services/pump_duty.py.
 *
 * Duty point from Flow (m³/h, the designer's field — wins over library flowLpm) and
 * Head (m). When Power × Efficiency is below the duty's water power ρ·g·Q·H the pump
 * runs slower: speed ratio (η·P / ρgQH)^(1/3) (affinity laws, P ∝ N³), capped at 1.
 */
const RHO_G = 1000 * 9.81;
const BAR_TO_M = 10.197;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

export function efficiencyFraction(v) {
  const n = num(v);
  if (n == null || n <= 0) return null;
  return Math.min(1, n > 1 ? n / 100 : n);
}

export function pumpRating(e = {}) {
  const qM3h = num(e.flowM3Hr), qLpm = num(e.flowLpm);
  const q = qM3h > 0 ? qM3h / 3600 : qLpm > 0 ? qLpm / 60000 : 0;
  let h = num(e.headM);
  if (!(h > 0)) h = (num(e.pressureBar) || 0) * BAR_TO_M;
  const kw = num(e.powerKw), w = num(e.wattage) ?? num(e.powerW);
  const p = kw > 0 ? kw * 1000 : w > 0 ? w : null;
  const eta = efficiencyFraction(e.efficiency);
  const out = { flowM3s: q, headM: Math.max(0, h), powerW: p, efficiency: eta,
    requiredPowerW: null, speedRatio: 1, powerLimited: false };
  if (!(q > 0) || !(h > 0) || p == null || eta == null) return out;
  const water = RHO_G * q * h;
  out.requiredPowerW = water / eta;
  const ratio = (eta * p) / water;
  if (ratio < 1) {
    out.speedRatio = Math.cbrt(Math.max(0.05, ratio));
    out.powerLimited = true;
  }
  return out;
}

/** What the pump delivers at its (possibly power-limited) speed, on the duty line. */
export function deliveredDuty(e = {}) {
  const r = pumpRating(e);
  return { ...r, deliveredHeadM: r.headM * r.speedRatio ** 2, deliveredFlowM3h: r.flowM3s * 3600 * r.speedRatio };
}
