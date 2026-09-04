import { describe, expect, it } from "vitest";
import {
  PLC_TYPES,
  plcConnectAs,
  plcConnectable,
  plcTypeSubLabel,
} from "../PLCPanel.jsx";

// All PLC families visible (operator request), honesty preserved: a selection
// either uses a REAL wire protocol out loud, or cannot connect at all.

describe("full PLC type list, honestly labeled", () => {
  it("shows all 8 families", () => {
    expect(PLC_TYPES.map(t => t.id).sort()).toEqual([
      "allen_bradley", "beckhoff", "delta", "mitsubishi",
      "modbus_tcp", "omron", "opc_ua", "siemens_s7",
    ]);
  });

  it("Modbus-speaking families connect via modbus_tcp, said out loud", () => {
    for (const id of ["delta", "mitsubishi", "omron"]) {
      const t = PLC_TYPES.find(x => x.id === id);
      expect(plcConnectable(t)).toBe(true);
      expect(plcConnectAs(t)).toBe("modbus_tcp");
      expect(plcTypeSubLabel(t)).toBe("via Modbus TCP");
    }
  });

  it("driverless families are visible but never connectable", () => {
    for (const id of ["allen_bradley", "beckhoff", "opc_ua"]) {
      const t = PLC_TYPES.find(x => x.id === id);
      expect(plcConnectable(t)).toBe(false);
      expect(plcTypeSubLabel(t)).toBe("no driver");
      expect(t.reason).toBeTruthy();
    }
  });

  it("REAL families connect as themselves with no sub-label", () => {
    for (const id of ["siemens_s7", "modbus_tcp"]) {
      const t = PLC_TYPES.find(x => x.id === id);
      expect(plcConnectable(t)).toBe(true);
      expect(plcConnectAs(t)).toBe(id);
      expect(plcTypeSubLabel(t)).toBe("");
    }
  });
});
