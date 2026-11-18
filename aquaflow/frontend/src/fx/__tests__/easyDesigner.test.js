import { describe, it, expect } from "vitest";
import {
  assetsFor, roleOf, dropAsset, designLinks, replugLink, connectPair, liveJets, removeFixtures,
  autoConnectAll, setEngineeringField, modelKindOf, ASSET_GROUPS, afterMove, setFixtureFields, lightCoverage,
} from "../easyDesigner";
import { readConnections } from "../../engineering/connections";
import { buildEasyFountain } from "../easyFountain";

const PUMP = "pump_inline_vfd_pump_4_0kw";
const NOZZLE = "nozzle_straight_dn25";
const VALVE = "valve_solenoid_dn25_24v";
const LIGHT = "light_uw_rgb_36w";

function drop(fixtures, key, x, y) {
  return dropAsset(fixtures, key, { x, y });
}

describe("easy fountain designer", () => {
  it("lists assets per tray tab with the right roles", () => {
    for (const g of ASSET_GROUPS) expect(assetsFor(g.id).length).toBeGreaterThan(0);
    expect(roleOf(assetsFor("pumps", "4.0").find((a) => a.key === PUMP) || { key: PUMP })).toBe("pump");
    expect(roleOf({ key: NOZZLE })).toBe("nozzle");
    expect(roleOf({ key: VALVE })).toBe("valve");
    expect(roleOf({ key: LIGHT })).toBe("light");
    expect(assetsFor("nozzles", "straight dn25").some((a) => a.key === NOZZLE)).toBe(true);
  });

  it("auto-connects a nozzle to the pump already placed, and a pump to waiting nozzles", () => {
    let r = drop([], PUMP, 0, 0);
    const pumpId = r.id;
    r = drop(r.fixtures, NOZZLE, 2, 0);
    expect(designLinks(r.fixtures)).toEqual([{ id: `pump:${pumpId}>${r.id}`, kind: "pump", from: pumpId, to: r.id }]);

    let s = drop([], NOZZLE, 1, 0);
    s = drop(s.fixtures, NOZZLE, 2, 0);
    expect(designLinks(s.fixtures)).toHaveLength(0);
    s = drop(s.fixtures, PUMP, 0, 0);
    expect(designLinks(s.fixtures).filter((l) => l.kind === "pump")).toHaveLength(2);
  });

  it("puts a dropped valve between the pump and the nearest jet, and pairs a light", () => {
    let r = drop([], PUMP, 0, 0);
    const pumpId = r.id;
    r = drop(r.fixtures, NOZZLE, 3, 0);
    const jetId = r.id;
    r = drop(r.fixtures, VALVE, 2.8, 0);
    const valveId = r.id;
    const links = designLinks(r.fixtures);
    expect(links.map((l) => l.id).sort()).toEqual([`pump:${pumpId}>${valveId}`, `valve:${valveId}>${jetId}`].sort());
    r = drop(r.fixtures, LIGHT, 3.2, 0);
    expect(designLinks(r.fixtures).some((l) => l.kind === "light" && l.from === r.id && l.to === jetId)).toBe(true);
  });

  it("re-plugs a line into another item and unplugs it on empty space", () => {
    let r = drop([], PUMP, 0, 0);
    const p1 = r.id;
    r = drop(r.fixtures, PUMP, 10, 0);
    const p2 = r.id;
    r = drop(r.fixtures, NOZZLE, 1, 0);
    const jet = r.id;
    const link = designLinks(r.fixtures).find((l) => l.to === jet);
    expect(link.from).toBe(p1);
    const moved = replugLink(r.fixtures, link, "from", p2);
    expect(moved.ok).toBe(true);
    expect(readConnections(moved.fixtures).nozzleById.get(jet).pumpId).toBe(p2);
    const bad = replugLink(r.fixtures, link, "from", jet);
    expect(bad.ok).toBe(false);
    const off = replugLink(moved.fixtures, designLinks(moved.fixtures)[0], "to", null);
    expect(designLinks(off.fixtures)).toHaveLength(0);
  });

  it("makes jets react live to pump speed, power, valves and switches", () => {
    let r = drop([], PUMP, 0, 0);
    const pumpId = r.id;
    r = drop(r.fixtures, NOZZLE, 2, 0);
    const jetId = r.id;
    let fx = setEngineeringField(r.fixtures, jetId, "jetHeightM", 4);
    fx = setEngineeringField(fx, pumpId, "powerKw", 50);
    const full = liveJets(fx).jets[0];
    expect(full.heightM).toBeCloseTo(4, 5);
    const half = liveJets(setEngineeringField(fx, pumpId, "speedPct", 50)).jets[0];
    expect(half.heightM).toBeCloseTo(1, 5);
    const weak = liveJets(setEngineeringField(fx, pumpId, "powerKw", 0.05)).jets[0];
    expect(weak.heightM).toBeLessThan(4);
    expect(weak.reason).toMatch(/overloaded/);
    expect(liveJets(fx, { [pumpId]: { on: false } }).jets[0].heightM).toBe(0);
    expect(liveJets(fx, { [jetId]: { on: false } }).jets[0].heightM).toBe(0);
    const loose = drop([], NOZZLE, 0, 0);
    expect(liveJets(loose.fixtures).jets[0].reason).toMatch(/No pump/);
  });

  it("removes items together with their links, and auto-connects everything loose", () => {
    let r = drop([], NOZZLE, 1, 0);
    r = drop(r.fixtures, LIGHT, 1, 0.2);
    const withPump = { fixtures: [...r.fixtures, ...drop([], PUMP, 5, 5).fixtures] };
    const all = autoConnectAll(withPump.fixtures);
    expect(designLinks(all.fixtures).length).toBe(2);
    const pumpId = all.fixtures.find((f) => roleOf(f) === "pump").id;
    const gone = removeFixtures(all.fixtures, [pumpId]);
    expect(gone.some((f) => f.id === pumpId)).toBe(false);
    expect(designLinks(gone).filter((l) => l.kind === "pump")).toHaveLength(0);
  });

  it("picks a 3D model per role", () => {
    expect(modelKindOf({ type: PUMP })).toBe("pump");
    expect(modelKindOf({ type: VALVE })).toBe("valve");
    expect(modelKindOf({ type: LIGHT })).toBe("light");
    expect(modelKindOf({ type: NOZZLE })).toBe("jet");
  });

  it("shows the starter fountain fully connected, every item with a known role", () => {
    const { fixtures } = buildEasyFountain({ ringCount: 6 }).engineering;
    const roles = fixtures.map((f) => roleOf(f));
    expect(roles.filter((r) => r === "light")).toHaveLength(7);
    expect(roles.filter((r) => r === "effect")).toHaveLength(0);
    const links = designLinks(fixtures);
    expect(links.filter((l) => l.kind === "valve")).toHaveLength(6);
    expect(links.filter((l) => l.kind === "light")).toHaveLength(7);
    expect(liveJets(fixtures).jets.every((j) => j.heightM > 0)).toBe(true);
  });

  it("colours water only where a light's beam reaches it, also after the light is moved", () => {
    let r = drop([], PUMP, 0, 0);
    r = drop(r.fixtures, NOZZLE, 2, 0);
    const jetA = r.id;
    r = drop(r.fixtures, NOZZLE, 12, 0);
    const jetB = r.id;
    r = drop(r.fixtures, LIGHT, 2.2, 0);
    const light = r.id;
    let fx = setEngineeringField(r.fixtures, r.fixtures.find((f) => f.type === PUMP).id, "powerKw", 50);
    const color = (fixtures, id) => liveJets(fixtures).jets.find((j) => j.id === id).color;
    expect(color(fx, jetA)).not.toBeNull();
    expect(color(fx, jetB)).toBeNull();

    // Moved to an empty corner: no water is coloured, and the pairing is dropped.
    let moved = afterMove(setFixtureFields(fx, light, { x: 7, y: 8 }), light);
    expect(color(moved.fixtures, jetA)).toBeNull();
    expect(color(moved.fixtures, jetB)).toBeNull();
    expect(designLinks(moved.fixtures).some((l) => l.kind === "light")).toBe(false);

    // Moved beside the other jet: that jet takes the colour.
    moved = afterMove(setFixtureFields(moved.fixtures, light, { x: 12.2, y: 0 }), light);
    expect(color(moved.fixtures, jetB)).not.toBeNull();
    expect(color(moved.fixtures, jetA)).toBeNull();
    expect(designLinks(moved.fixtures).some((l) => l.kind === "light" && l.to === jetB)).toBe(true);

    // A light dropped far from every jet pairs with nothing.
    const far = drop(moved.fixtures, LIGHT, 30, 30);
    expect(designLinks(far.fixtures).filter((l) => l.from === far.id)).toHaveLength(0);
  });

  it("measures beam coverage from distance, beam angle and jet height", () => {
    const light = { x: 0, y: 0, engineering: { beamAngleDeg: 40 } };
    expect(lightCoverage(light, { x: 0.1, y: 0 }, 3)).toBe(1);
    expect(lightCoverage(light, { x: 5, y: 0 }, 3)).toBe(0);
    const mid = lightCoverage(light, { x: 0.6, y: 0 }, 3);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
