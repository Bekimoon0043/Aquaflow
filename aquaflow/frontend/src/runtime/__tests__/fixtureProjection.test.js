/**
 * fixtureProjection.test.js — AF-HUB-004 fixture store unification + projection.
 *
 * Proves the GATE: the master fixtures project deterministically and identically into
 * the timeline tracks, the backend payload, and the runtime registry; a fixture edit
 * shows up in all three; and the divergence guard fails loud.
 */
import { describe, it, expect, vi } from "vitest";
import {
  projectFixtures, projectGroups, fixtureFingerprint, assertFixtureConsistency, fixtureGroupId,
} from "../fixtureProjection.js";
import { buildRuntimePayload } from "../../utils/runtimeSync.js";

const MASTER = [
  { id: "g1", type: "nozzle_geyser", x: 0, y: 0 },
  { id: "a1", type: "nozzle_arch", x: 3, y: 1 },
  { id: "a2", type: "nozzle_arch", x: -3, y: 1 },
  { id: "l1", type: "light_rgb", x: 0, y: 2 },
  { id: "p1", type: "pump", x: -6, y: -6 },
];

describe("projection is deterministic", () => {
  it("same fixtures in → identical projection out (no timestamps / randomness)", () => {
    const a = projectFixtures(MASTER);
    const b = projectFixtures(MASTER);
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.groups).toEqual(b.groups);
    expect(a.timelineTracks.length).toBe(b.timelineTracks.length);
    expect(a.runtimeRegistry.runtimeIds).toEqual(b.runtimeIds ?? b.runtimeRegistry.runtimeIds);
  });

  it("projectGroups returns the distinct show groups (equipment has none)", () => {
    const groups = projectGroups(MASTER);
    expect(groups).toContain("center_jets");   // geyser
    expect(groups).toContain("arch_jets");      // arch
    expect(groups).toContain("rgb_lights");     // light
    expect(fixtureGroupId({ type: "pump" })).toBeNull(); // equipment → no show group
  });
});

describe("GATE — master projects identically to timeline, backend payload, and runtime registry", () => {
  it("all three consumers see the same fixtures as the master", () => {
    const p = projectFixtures(MASTER);
    // backend payload (what useServerShowSync sends) is fed the master fixtures.
    const payload = buildRuntimePayload({ fixtures: MASTER, groups: p.groups });

    const masterFp = fixtureFingerprint(MASTER);
    // 1) backend payload fixtures === master
    expect(fixtureFingerprint(payload.fixtures)).toBe(masterFp);
    expect(payload.fixtures.length).toBe(MASTER.length);
    expect(payload.groups).toEqual(p.groups);
    // 2) runtime registry covers exactly the master fixtures
    expect(p.runtimeRegistry.fixtureCount).toBe(MASTER.length);
    expect(p.runtimeRegistry.runtimeIds.length).toBe(MASTER.length);
    // 3) timeline tracks were generated from the master (non-empty; every track's
    //    fixtureId is one of the master fixtures)
    expect(p.timelineTracks.length).toBeGreaterThan(0);
    const masterIds = new Set(MASTER.map((f) => f.id));
    for (const t of p.timelineTracks) {
      if (t.fixtureId) expect(masterIds.has(t.fixtureId)).toBe(true);
    }
  });

  it("editing a fixture changes every projection consistently", () => {
    const edited = [...MASTER, { id: "a3", type: "nozzle_arch", x: 4, y: 0 }];
    const before = projectFixtures(MASTER);
    const after = projectFixtures(edited);
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.runtimeRegistry.fixtureCount).toBe(before.runtimeRegistry.fixtureCount + 1);
    expect(after.timelineTracks.length).toBeGreaterThanOrEqual(before.timelineTracks.length);
    // backend payload reflects the edit too
    expect(buildRuntimePayload({ fixtures: edited }).fixtures.length).toBe(edited.length);
  });
});

describe("divergence guard fails loud", () => {
  it("returns true when master and other match", () => {
    expect(assertFixtureConsistency(MASTER, MASTER)).toBe(true);
    expect(assertFixtureConsistency(MASTER, [...MASTER])).toBe(true); // same identity, new array
  });

  it("throws when divergent and throwOnError is set", () => {
    expect(() => assertFixtureConsistency(MASTER, MASTER.slice(0, 2), { throwOnError: true })).toThrow(/divergence/);
  });

  it("logs a loud error (and returns false) when divergent without throwOnError", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(assertFixtureConsistency(MASTER, [], { label: "showStore.engineeringFixtures" })).toBe(false);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[AF-HUB-004]"), expect.anything());
    spy.mockRestore();
  });

  it("fingerprint is order-sensitive (a reordered store is a divergence)", () => {
    const reordered = [MASTER[1], MASTER[0], ...MASTER.slice(2)];
    expect(fixtureFingerprint(reordered)).not.toBe(fixtureFingerprint(MASTER));
  });
});
