// liveValidation.js — AquaFlow Real-Time Validation (AQ-X-011)
//
// Pure, synchronous validation engine for live system monitoring. Given the current
// system state (designed fixtures + optional live safety status) it returns a
// prioritised list of errors/warnings that the UI renders in real time, each tagged
// with the target fixture id so it can be highlighted immediately.
//
// It reuses the equipment dependency graph (address/cycle/SPOF/orphan conflicts) and
// adds value-range and safety checks. Everything is O(n) over fixtures and runs well
// inside a 100 ms latency budget; `durationMs` is measured on every call.

import { buildDependencyGraph } from "../dependency/dependencyGraph";
// AF-HUB-004B — DMX patch reading + range limits come from the one canonical module,
// so this validator and the dependency graph resolve every fixture's patch identically.
import {
  readPatch,
  DMX_MAX_CHANNEL as DMX_MAX_CHANNEL_C,
  DMX_MAX_UNIVERSE as DMX_MAX_UNIVERSE_C,
} from "../runtime/dmxPatch";

// Re-exported from the canonical source (names kept for existing importers/tests).
export const DMX_MAX_CHANNEL = DMX_MAX_CHANNEL_C;
export const DMX_MAX_UNIVERSE = DMX_MAX_UNIVERSE_C;
export const LATENCY_BUDGET_MS = 100;

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

function nowMs() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

export function validateSystem(state = {}) {
  const t0 = nowMs();
  const fixtures = state.fixtures || [];
  const safety = state.safety || null;
  const results = [];
  const add = (severity, code, message, target = null) =>
    results.push({ id: `${code}:${target ?? results.length}`, severity, code, message, target });

  // 1. Fixture identity — missing / duplicate ids.
  const seen = new Set();
  for (const fx of fixtures) {
    const id = fx && (fx.id ?? fx.fixtureId);
    if (!id) { add("error", "missing_id", "A fixture has no id"); continue; }
    if (seen.has(id)) add("error", "duplicate_id", `Duplicate fixture id '${id}'`, id);
    seen.add(id);
  }

  // 2. Value ranges + placement completeness.
  for (const fx of fixtures) {
    if (!fx) continue;
    const id = fx.id ?? fx.fixtureId;
    if (!id) continue;
    const patch = readPatch(fx);
    const ch = patch.startChannel;
    if (ch !== null && (ch < 1 || ch > DMX_MAX_CHANNEL))
      add("error", "channel_range", `${id}: DMX channel ${ch} out of range 1–${DMX_MAX_CHANNEL}`, id);
    const uni = patch.universe;
    if (uni !== null && (uni < 0 || uni > DMX_MAX_UNIVERSE))
      add("error", "universe_range", `${id}: universe ${uni} out of range 0–${DMX_MAX_UNIVERSE}`, id);
    if (fx.intensity !== undefined && fx.intensity !== null &&
        (Number(fx.intensity) < 0 || Number(fx.intensity) > 1))
      add("warning", "intensity_range", `${id}: intensity ${fx.intensity} outside 0–1`, id);
    if (fx.x === undefined || fx.x === null || fx.y === undefined || fx.y === null)
      add("warning", "missing_coords", `${id}: no placement coordinates`, id);
  }

  // 3. Dependency-graph conflicts (address clashes, cycles, missing deps, SPOF, orphans).
  const graph = buildDependencyGraph(fixtures);
  for (const c of graph.conflicts) {
    add(c.severity === "critical" ? "error" : "warning", c.type, c.message,
        c.nodes && c.nodes[0]);
  }

  // 4. Live safety status (optional).
  if (safety) {
    const stateStr = String(safety.state || "").toUpperCase();
    if (safety.estop || stateStr.includes("EMERGENCY") || stateStr === "ESTOP")
      add("error", "estop", "Emergency stop active — all hardware output inhibited");
    if (safety.playing && safety.permit === false)
      add("error", "no_permit", "Playing without a safety permit");
    if ((safety.hardwareConflicts || 0) > 0)
      add("error", "hw_conflict", `${safety.hardwareConflicts} hardware conflict(s) block playback`);
    if (safety.plcOnline === false)
      add("warning", "plc_offline", "PLC heartbeat lost — communications degraded");
  }

  const errors = results.filter((r) => r.severity === "error");
  const warnings = results.filter((r) => r.severity === "warning");
  const sorted = results.slice().sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  const durationMs = nowMs() - t0;

  return {
    ok: errors.length === 0,
    results: sorted,
    errors,
    warnings,
    targetIds: [...new Set(results.map((r) => r.target).filter(Boolean))],
    counts: { error: errors.length, warning: warnings.length, total: results.length },
    checkedAt: Date.now(),
    durationMs,
    withinLatencyBudget: durationMs < LATENCY_BUDGET_MS,
  };
}

// Set of fixture ids that currently have an error — for immediate highlighting.
export function erroredTargets(validation) {
  return new Set((validation.errors || []).map((e) => e.target).filter(Boolean));
}
