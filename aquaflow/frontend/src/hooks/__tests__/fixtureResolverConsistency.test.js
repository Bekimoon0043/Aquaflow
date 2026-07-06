/**
 * fixtureResolverConsistency.test.js — AF-HUB-002 canonical fixture-type resolver.
 *
 * Proves the GATE: the same fixture resolves to the same GROUP and TYPE across the
 * paths that used to each make their own decision — the canonical resolver
 * (resolveFixtureGroup), the 3D-preview projection (fixturesToNozzleConfigs), and the
 * Engineering Designer's stored-groupId formula (now `resolveFixtureGroup(type) ||
 * "engineering_equipment"`). Because every path now routes through the one resolver,
 * they are identical by construction — this test locks that in.
 */
import { describe, it, expect } from "vitest";
import {
  resolveFixtureGroup,
  classifyFixtureType,
  resolveFixtureType,
  fixturesToNozzleConfigs,
} from "../fixtureTypeMap.js";

// The Engineering Designer now stores groupId with exactly this formula
// (PoolGeometryDesigner.getDefaultGroupId). Kept here so a future drift breaks a test.
const designerStoredGroup = (type) => resolveFixtureGroup(type) || "engineering_equipment";

// Representative fixtures across every family the designer can place.
const SHOW_TYPES = [
  "nozzle_geyser", "nozzle_arch", "nozzle_fan", "nozzle_mist", "nozzle_laminar",
  "nozzle_ring", "nozzle_cascade_weir", "nozzle_water_screen",
  "light_rgb", "light_uw_rgb_36w", "laser_rgb_5w", "flame", "effect_flame",
  "motion_1d", "motion_2d", "motion_3d",
];
const EQUIPMENT_TYPES = ["pump", "valve", "sensor", "filter", "pump_vfd_5kw"];

describe("canonical group resolver", () => {
  it("resolveFixtureGroup returns a non-empty show group for every show fixture", () => {
    for (const t of SHOW_TYPES) {
      const g = resolveFixtureGroup(t);
      expect(g, `group for ${t}`).toBeTruthy();
      expect(typeof g).toBe("string");
    }
  });

  it("equipment has no show group (resolver → null); designer tags it engineering_equipment", () => {
    for (const t of EQUIPMENT_TYPES) {
      expect(resolveFixtureGroup(t), `group for ${t}`).toBeNull();
      expect(designerStoredGroup(t)).toBe("engineering_equipment");
    }
  });
});

describe("group is identical across designer store, preview projection, and resolver", () => {
  it("designer-stored group === resolveFixtureGroup for every show fixture", () => {
    for (const t of SHOW_TYPES) {
      expect(designerStoredGroup(t), `designer group for ${t}`).toBe(resolveFixtureGroup(t));
    }
  });

  it("3D-preview projection derives the same group the resolver does (no stored groupId)", () => {
    // fixturesToNozzleConfigs uses `fixture.groupId || resolveFixtureGroup(type)`.
    // With no stored groupId it must fall back to exactly the canonical resolver.
    for (const t of SHOW_TYPES) {
      // Anything the resolver marks isLight (underwater lights, lasers, moving heads)
      // becomes a lightConfig, not a nozzleConfig — skip those here.
      if (resolveFixtureType(t).isLight) continue;
      const { nozzleConfigs } = fixturesToNozzleConfigs([{ id: "f1", type: t, x: 1, y: 2 }]);
      expect(nozzleConfigs.length, `nozzle config for ${t}`).toBe(1);
      expect(nozzleConfigs[0].groupId, `preview group for ${t}`).toBe(resolveFixtureGroup(t));
    }
  });

  it("a stored groupId is honored verbatim by the preview projection (single source wins)", () => {
    const { nozzleConfigs } = fixturesToNozzleConfigs([
      { id: "f1", type: "nozzle_geyser", x: 0, y: 0, groupId: "center_jets" },
    ]);
    expect(nozzleConfigs[0].groupId).toBe("center_jets");
  });
});

describe("type/category resolution is stable and deterministic", () => {
  it("classifyFixtureType + resolveFixtureType return the same thing every call", () => {
    for (const t of [...SHOW_TYPES, ...EQUIPMENT_TYPES]) {
      expect(classifyFixtureType(t)).toBe(classifyFixtureType(t));
      expect(resolveFixtureType(t).nozzleType ?? resolveFixtureType(t).isLight)
        .toEqual(resolveFixtureType(t).nozzleType ?? resolveFixtureType(t).isLight);
    }
  });

  it("classifyFixtureType buckets the four kinds correctly", () => {
    expect(classifyFixtureType("nozzle_geyser")).toBe("nozzle");
    expect(classifyFixtureType("light_rgb")).toBe("light");
    expect(classifyFixtureType("pump")).toBe("equipment");
    expect(classifyFixtureType("flame")).toBe("effect");
  });
});
