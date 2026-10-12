import { describe, expect, it } from "vitest";
import {
  createICANSiteEngineeringProject,
  getICANSiteWaterFixtures,
  ICAN_SITE_LAYOUT_SUMMARY,
} from "../icanSiteEngineeringProject";
import { fixturesToNozzleConfigs } from "../../hooks/fixtureTypeMap";

describe("4KILO site engineering project", () => {
  it("models the confirmed 100 water outlets and seven physical pumps", () => {
    const project = createICANSiteEngineeringProject();
    const water = getICANSiteWaterFixtures(project);
    const pumps = project.fixtures.filter(fixture => fixture.type === "pump");

    expect(ICAN_SITE_LAYOUT_SUMMARY.totalWaterNozzles).toBe(100);
    expect(water).toHaveLength(100);
    expect(pumps).toHaveLength(7);
    expect(pumps.filter(fixture => fixture.engineering?.siteFunction === "foam")).toHaveLength(2);
    expect(new Set(project.fixtures.map(fixture => fixture.id)).size).toBe(project.fixtures.length);
  });

  it("keeps 76 running jets in 19 ordered sections of four", () => {
    const project = createICANSiteEngineeringProject();
    const running = project.fixtures.filter(
      fixture => fixture.engineering?.siteFunction === "running-fountain" && fixture.type === "nozzle_running",
    );
    expect(running).toHaveLength(76);

    const sections = Map.groupBy
      ? Map.groupBy(running, fixture => fixture.engineering.sectionIndex)
      : running.reduce((map, fixture) => {
          const key = fixture.engineering.sectionIndex;
          map.set(key, [...(map.get(key) || []), fixture]);
          return map;
        }, new Map());
    expect(sections.size).toBe(19);
    expect([...sections.values()].every(items => items.length === 4)).toBe(true);
  });

  it("maps only the first 64 running valves to capture-derived I-CAN addresses", () => {
    const project = createICANSiteEngineeringProject();
    const running = project.fixtures.filter(fixture => fixture.type === "nozzle_running");
    const mapped = running.filter(fixture => fixture.engineering.icanGroup !== null);
    const pending = running.filter(fixture => fixture.engineering.icanGroup === null);

    expect(mapped).toHaveLength(64);
    expect(pending).toHaveLength(12);
    expect(mapped[0].engineering).toMatchObject({ legacyValveIndex: 1, icanGroup: 1, icanChannel: 9 });
    expect(mapped[31].engineering).toMatchObject({ legacyValveIndex: 32, icanGroup: 1, icanChannel: 40 });
    expect(mapped[32].engineering).toMatchObject({ legacyValveIndex: 33, icanGroup: 9, icanChannel: 9 });
    expect(mapped[63].engineering).toMatchObject({ legacyValveIndex: 64, icanGroup: 9, icanChannel: 40 });
  });

  it("uses shared logical controls for foam and peacock outlets", () => {
    const project = createICANSiteEngineeringProject();
    const water = getICANSiteWaterFixtures(project);
    const foam = water.filter(fixture => fixture.engineering.siteFunction === "foam");
    const peacock = water.filter(fixture => fixture.engineering.siteFunction === "peacock");

    expect(foam).toHaveLength(16);
    expect(foam.filter(fixture => fixture.engineering.side === "left")).toHaveLength(8);
    expect(foam.filter(fixture => fixture.engineering.side === "right")).toHaveLength(8);
    expect(new Set(foam.map(fixture => fixture.groupId))).toEqual(new Set(["foam_jets"]));
    expect(peacock).toHaveLength(8);
    expect(new Set(peacock.map(fixture => fixture.groupId))).toEqual(new Set(["peacock_jets"]));
  });

  it("bridges every water outlet into the 3D renderer with its site control group", () => {
    const water = getICANSiteWaterFixtures();
    const { nozzleConfigs, lightConfigs } = fixturesToNozzleConfigs(water);

    expect(nozzleConfigs).toHaveLength(100);
    expect(lightConfigs).toHaveLength(0);
    expect(nozzleConfigs.filter(nozzle => nozzle.groupId === "running_fountain_jets")).toHaveLength(76);
    expect(nozzleConfigs.filter(nozzle => nozzle.groupId === "foam_jets")).toHaveLength(16);
    expect(nozzleConfigs.filter(nozzle => nozzle.groupId === "peacock_jets")).toHaveLength(8);
  });
});
