// AF-NEXT-012 — fixture-type replacement recomputes dependants and flags control
// footprint changes; addresses are never silently reassigned.
import { describe, expect, it } from "vitest";
import { getDefaultEngineering } from "../../data/fixtureLibrary.js";
import { acknowledgeControlReview, controlFootprint, replaceFixtureType } from "../fixtureTypeReplacement.js";
import { generateBOM } from "../bomEngine.js";
import { calculateEquipmentTotals } from "../hydraulicEngine.js";
import { buildHydraulicPreviewPayload } from "../hydraulicAdapter.js";

const place = (id, type, eng = {}) => ({ id, type, label: `${type} ${id}`, x: 0, y: 0, engineering: { ...getDefaultEngineering(type), ...eng } });

describe("control footprint", () => {
  it("distinguishes DMX lights from valve-driven nozzles", () => {
    const light = controlFootprint("light_underwater_par_rgbw_36w");
    expect(light).toMatchObject({ needsDmx: true, dmxChannels: 4 });
    const jet = controlFootprint("nozzle_straight_dn25");
    expect(jet).toMatchObject({ needsDmx: false, needsValve: true, needsPlc: true });
  });
});

describe("replaceFixtureType", () => {
  it("same-footprint nozzle swap: recomputes hydraulics/BOM inputs, no control review", () => {
    const fixtures = [place("n1", "nozzle_straight_dn15", { plcChannel: "Q0.3" }), place("n2", "nozzle_straight_dn15")];
    const { fixtures: next, report } = replaceFixtureType(fixtures, "n1", "nozzle_straight_dn25");
    expect(next[0].type).toBe("nozzle_straight_dn25");
    expect(next[0].engineering.flowLpm).toBe(getDefaultEngineering("nozzle_straight_dn25").flowLpm);
    expect(next[0].engineering.plcChannel).toBe("Q0.3");             // address kept verbatim
    expect(report.footprintChanged).toBe(false);
    expect(next[0].controlReview).toBeUndefined();
    expect(report.recompute).toEqual(expect.arrayContaining(["bom", "hydraulicSummary", "solvedHydraulics"]));
    expect(report.valueChanges.map((v) => v.field)).toContain("flowLpm");
    expect(fixtures[0].type).toBe("nozzle_straight_dn15");           // input not mutated
    // Dependent calculations read the new type.
    const bom = generateBOM(next);
    expect(bom.find((b) => b.type === "nozzle_straight_dn25").quantity).toBe(1);
    const payload = buildHydraulicPreviewPayload({ fixtures: next });
    expect(payload.nozzles[0].type).toBe("nozzle_straight_dn25");
    expect(payload.nozzles[0].provenance.source).toBe("generic_estimate");
    expect(calculateEquipmentTotals(next)).toBeTruthy();
  });

  it("RGB → RGBW light: DMX address kept, channel-count change flagged, overlap detected", () => {
    const fixtures = [
      place("l1", "light_underwater_par_rgb_18w", { dmxUniverse: 1, dmxAddress: 10, dmxChannels: 3 }),
      place("l2", "light_underwater_par_rgb_18w", { dmxUniverse: 1, dmxAddress: 13, dmxChannels: 3 }),
    ];
    const { fixtures: next, report } = replaceFixtureType(fixtures, "l1", "light_underwater_par_rgbw_36w");
    expect(next[0].engineering.dmxAddress).toBe(10);
    expect(next[0].engineering.dmxUniverse).toBe(1);
    expect(report.footprintChanged).toBe(true);
    expect(report.changes.find((c) => c.field === "dmxChannels")).toMatchObject({ from: 3, to: 4 });
    const dmx = report.affectedItems.find((a) => a.kind === "dmx");
    expect(dmx.status).toBe("conflict");
    expect(dmx.overlaps).toEqual(["l2"]);
    expect(next[0].controlReview.required).toBe(true);
    expect(next[1]).toBe(fixtures[1]);                               // neighbour untouched
  });

  it("never applies the new type's library default address", () => {
    // Curated UW lights ship default dmxUniverse/dmxAddress; a nozzle has none.
    const fixtures = [place("n1", "nozzle_straight_dn15")];
    const { fixtures: next, report } = replaceFixtureType(fixtures, "n1", "light_uw_rgb_18w");
    expect(next[0].engineering.dmxAddress).toBeUndefined();
    expect(next[0].engineering.dmxUniverse).toBeUndefined();
    expect(report.warnings.join(" ")).toMatch(/NOT applied/);
    expect(report.affectedItems.find((a) => a.kind === "dmx").status).toBe("unassigned");
    expect(report.changes.map((c) => c.field)).toEqual(expect.arrayContaining(["needsDmx", "needsValve"]));
    expect(next[0].controlReview.required).toBe(true);
  });

  it("lists Siemens I/O points and drops the old type's linked model", () => {
    const fx = { ...place("n1", "nozzle_straight_dn15"), provenance: { source: "user_measured", model: "Jet A", date: "2026-10-01" } };
    const io = [{ device_id: "n1", plc_tag: "JET_1", address: "%Q0.1" }];
    const { fixtures: next, report } = replaceFixtureType([fx], "n1", "light_uw_rgb_18w", { ioPoints: io });
    expect(report.affectedItems.find((a) => a.kind === "siemens_io").message).toMatch(/%Q0.1/);
    expect(next[0].provenance).toBeUndefined();
    expect(report.provenance.source).toBe("generic_estimate");
    expect(report.warnings.join(" ")).toMatch(/linked equipment data/);
  });

  it("refuses unknown types and is a no-op for the same type; review can be acknowledged", () => {
    const fixtures = [place("n1", "nozzle_straight_dn15")];
    expect(() => replaceFixtureType(fixtures, "n1", "no_such_type")).toThrow(/Unknown fixture type/);
    expect(() => replaceFixtureType(fixtures, "zz", "nozzle_straight_dn25")).toThrow(/not found/);
    expect(replaceFixtureType(fixtures, "n1", "nozzle_straight_dn15").report.changed).toBe(false);
    const { fixtures: next } = replaceFixtureType(fixtures, "n1", "light_uw_rgb_18w");
    const ack = acknowledgeControlReview(next[0]);
    expect(ack.controlReview.required).toBe(false);
    expect(ack.controlReview.reviewedAt).toBeTruthy();
  });
});
