/**
 * fixtureProjection.js — AF-HUB-004 fixture store unification + projection.
 *
 * engineeringStore.fixtures is the SINGLE MASTER source of designed fixtures. This
 * module is the one deterministic projection of that master into the three consumer
 * shapes, so they can never diverge:
 *
 *   master fixtures ──► timelineTracks   (Show Programmer / timeline)
 *                   ──► backend payload  (fixtures + groups sent to the runtime)
 *                   ──► runtime registry (hardware device map)
 *
 * Before this, showStore.engineeringFixtures was a parallel mirror that was never
 * written (setEngineeringFixtures had no callers), yet the backend sync payload read
 * that empty mirror — so designed fixtures never reached the backend. Everything now
 * flows from the master through projectFixtures(), and assertFixtureConsistency() is a
 * loud guard against any future divergence.
 *
 * Pure + deterministic: same fixtures in → same projection out (no timestamps, no
 * store reads), so it is fully unit-testable.
 */

import { generateAutoTracks } from "./autoTrackGenerator.js";
import { buildRuntimeDeviceGraph } from "./runtimeDeviceGraph.js";
import { resolveFixtureGroup } from "../hooks/fixtureTypeMap.js";

/** The group a fixture belongs to — stored groupId wins, else the canonical resolver. */
export function fixtureGroupId(fixture) {
  return fixture?.groupId || resolveFixtureGroup(fixture?.type) || null;
}

/**
 * A stable, order-sensitive fingerprint of the identity-relevant fixture fields
 * (id, type, plan x/y, group). Two fixture lists with the same fingerprint project
 * identically; a difference means the stores have diverged.
 */
export function fixtureFingerprint(fixtures = []) {
  const list = Array.isArray(fixtures) ? fixtures : [];
  return JSON.stringify(
    list.map((f) => ({
      id: f?.id ?? null,
      type: f?.type ?? null,
      x: Number(f?.x) || 0,
      y: Number(f?.y) || 0,
      group: fixtureGroupId(f),
    }))
  );
}

/** The distinct, ordered list of show groups present in the master fixtures. */
export function projectGroups(fixtures = []) {
  const seen = [];
  for (const f of Array.isArray(fixtures) ? fixtures : []) {
    const g = fixtureGroupId(f);
    if (g && !seen.includes(g)) seen.push(g);
  }
  return seen;
}

/**
 * projectFixtures(fixtures, devices) — the single deterministic projection of the
 * master into every consumer shape. Returns:
 *   { fixtures, groups, timelineTracks, runtimeRegistry, fingerprint }
 */
export function projectFixtures(fixtures = [], devices = []) {
  const list = Array.isArray(fixtures) ? fixtures : [];
  const tracks = generateAutoTracks({ fixtures: list, devices }).tracks || [];
  const graph = buildRuntimeDeviceGraph(list);
  return {
    fixtures: list,
    groups: projectGroups(list),
    timelineTracks: tracks,
    // Registry: keep only the deterministic parts (buildRuntimeDeviceGraph stamps a
    // non-deterministic generatedAt/Maps — we surface the stable identity fields).
    runtimeRegistry: {
      fixtureCount: graph.fixtureCount,
      runtimeIds: graph.runtimeIds,
      byGroupId: graph.byGroupId instanceof Map ? Object.fromEntries(graph.byGroupId) : (graph.byGroupId || {}),
    },
    fingerprint: fixtureFingerprint(list),
  };
}

/**
 * assertFixtureConsistency(master, other, opts) — the divergence guard.
 *
 * Compares two fixture lists by fingerprint. If they differ it FAILS LOUD: throws when
 * opts.throwOnError is set (used in tests and dev-hard mode), otherwise logs a console
 * error. Returns true when consistent. Divergence must be impossible in normal flow —
 * this catches a regression the moment a second, out-of-sync fixture path appears.
 */
export function assertFixtureConsistency(master, other, opts = {}) {
  const { label = "engineeringFixtures", throwOnError = false } = opts;
  const a = fixtureFingerprint(master);
  const b = fixtureFingerprint(other);
  if (a === b) return true;
  const msg = `[AF-HUB-004] fixture divergence: '${label}' does not match the master engineering store`;
  if (throwOnError) throw new Error(msg);
  // eslint-disable-next-line no-console
  console.error(msg, { masterCount: (master || []).length, otherCount: (other || []).length });
  return false;
}
