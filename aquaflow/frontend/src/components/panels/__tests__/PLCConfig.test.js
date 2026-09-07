import { describe, expect, it } from "vitest";
import {
  applyPlcPrefill,
  buildConnectBody,
  profileGateSatisfied,
  parseModbusPoints,
  verifyOutcomeStyle,
  verifySummary,
} from "../PLCPanel.jsx";

// AF-DISC — PLC panel Connect tab helpers: discovery prefill, explicit profile
// confirmation, operator-selected Modbus points, honest verification labels.

const base = { name: "My PLC", plc_type: "siemens_s7", ip: "192.168.1.100", port: 102, rack: 0, slot: 1, unit_id: 1 };

describe("discovery → PLC prefill", () => {
  it("fills IP, port, rack/slot, unit id and marks the source — nothing else changes", () => {
    const f = applyPlcPrefill(base, { plc_type: "siemens_s7", ip: "192.168.5.10", port: 102, rack: 0, slot: 2,
                                      unit_id: 1, vendor: "Siemens", model: "6ES7 215-1AG40-0XB0", discovery_id: "abc" });
    expect(f).toMatchObject({ plc_type: "siemens_s7", ip: "192.168.5.10", port: 102, rack: 0, slot: 2, unit_id: 1,
                              prefilled_from: "abc", prefill_vendor: "Siemens", prefill_model: "6ES7 215-1AG40-0XB0" });
    expect(f.name).toBe("My PLC");
  });
  it("a Modbus prefill carries the unit id", () => {
    const f = applyPlcPrefill(base, { plc_type: "modbus_tcp", ip: "192.168.5.30", port: 502, unit_id: 3 });
    expect(f.plc_type).toBe("modbus_tcp");
    expect(f.port).toBe(502);
    expect(f.unit_id).toBe(3);
  });
  it("ignores an empty or malformed prefill", () => {
    expect(applyPlcPrefill(base, null)).toBe(base);
    expect(applyPlcPrefill(base, {})).toBe(base);
  });
});

describe("Siemens profile is never sent silently", () => {
  it("connect body carries a profile only when one is selected, with the confirmation flag", () => {
    const none = buildConnectBody(base, "siemens_s7", {});
    expect(none.profile_id).toBeUndefined();
    expect(none.confirm_profile).toBeUndefined();
    const chosen = buildConnectBody(base, "siemens_s7", { profileId: "aquaflow-s7-1215c-v1", profileConfirmed: false });
    expect(chosen.profile_id).toBe("aquaflow-s7-1215c-v1");
    expect(chosen.confirm_profile).toBe(false);          // the backend refuses this — by design
    const confirmed = buildConnectBody(base, "siemens_s7", { profileId: "aquaflow-s7-1215c-v1", profileConfirmed: true });
    expect(confirmed.confirm_profile).toBe(true);
    expect(confirmed.rack).toBe(0);
    expect(confirmed.slot).toBe(1);
  });
  it("a Modbus connect never carries a Siemens profile", () => {
    const body = buildConnectBody({ ...base, plc_type: "delta", port: 502, unit_id: 5 }, "modbus_tcp",
                                  { profileId: "aquaflow-s7-1215c-v1", profileConfirmed: true });
    expect(body.plc_type).toBe("modbus_tcp");
    expect(body.profile_id).toBeUndefined();
    expect(body.unit_id).toBe(5);
  });
  it("the Connect gate requires confirmation once a profile is chosen", () => {
    expect(profileGateSatisfied("siemens_s7", "", false)).toBe(true);
    expect(profileGateSatisfied("siemens_s7", "aquaflow-s7-1215c-v1", false)).toBe(false);
    expect(profileGateSatisfied("siemens_s7", "aquaflow-s7-1215c-v1", true)).toBe(true);
    expect(profileGateSatisfied("modbus_tcp", "aquaflow-s7-1215c-v1", false)).toBe(true);
  });
});

describe("Modbus verification points are operator-selected", () => {
  it("parses one point per line and never invents any", () => {
    expect(parseModbusPoints("")).toEqual([]);
    expect(parseModbusPoints("30001 input_register\n%MW10, hr\n3 di 4\n40005")).toEqual([
      { id: "p1:30001", address: "30001", kind: "input_register", count: 1 },
      { id: "p2:%MW10", address: "%MW10", kind: "holding_register", count: 1 },
      { id: "p3:3", address: "3", kind: "discrete_input", count: 4 },
      { id: "p4:40005", address: "40005", kind: "input_register", count: 1 },
    ]);
  });
  it("bounds the count", () => {
    expect(parseModbusPoints("0 ir 999")[0].count).toBe(16);
    expect(parseModbusPoints("0 ir 0")[0].count).toBe(1);
  });
});

describe("verification outcomes are shown honestly", () => {
  it("heartbeat must change before the PLC is called verified", () => {
    expect(verifyOutcomeStyle("verified").label).toBe("VERIFIED");
    expect(verifyOutcomeStyle("heartbeat_static").label).toContain("NOT RUNNING");
    expect(verifyOutcomeStyle("heartbeat_static").color).not.toBe("var(--green)");
    expect(verifyOutcomeStyle("access_denied")).toEqual({ color: "var(--red)", label: "ACCESS DENIED" });
    expect(verifyOutcomeStyle("wrong_rack_slot").label).toBe("WRONG RACK SLOT");
  });
  it("summarises samples, fields and identity", () => {
    const s = verifySummary({ outcome: "heartbeat_static", heartbeat: { samples: [7, 7, 7], changed: false },
                              fields: [{ status: "ok" }, { status: "ok" }], identity: { order_number: "6ES7 215-1AG40-0XB0" } });
    expect(s).toContain("heartbeat 7 → 7 → 7 (static)");
    expect(s).toContain("2/2 fields read");
    expect(s).toContain("6ES7 215-1AG40-0XB0");
    expect(verifySummary(null)).toBe("");
  });
});
