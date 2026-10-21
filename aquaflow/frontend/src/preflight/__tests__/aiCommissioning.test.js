import { describe, expect, it, vi } from "vitest";
import { LIMITS, activeFaults, commissioningInput, redactText, requestCommissioningHelp, siteSummary, slimPlcStatus } from "../aiCommissioning";

describe("AI commissioning input", () => {
  it("redacts keys, passwords, tokens and licences but keeps ordinary words", () => {
    const out = redactText("api_key=sk-ant-api03-XYZ password: 'p w' Authorization: Bearer abc.def licence_key=AAA-BBB licence expired 0123456789abcdef0123456789abcdef99");
    for (const s of ["sk-ant", "XYZ", "'p w'", "abc.def", "AAA-BBB", "0123456789abcdef0123456789abcdef99"]) expect(out).not.toContain(s);
    expect(out).toContain("licence expired");
  });

  it("caps every list and line, slims the PLC status and keeps the related ids", () => {
    const issues = Array.from({ length: 300 }, (_, i) => ({ code: `c${i}`, severity: "warning", message: "x ".repeat(1000), fixtureId: `jet${i}` }));
    const logs = Array.from({ length: 200 }, (_, i) => ({ level: "info", msg: `line ${i}` }));
    const body = commissioningInput({ issues, logs, faults: Array.from({ length: 90 }, (_, i) => ({ code: `F${i}`, message: "m" })),
      plc: { connection_state: "failed", error: "timeout token=abc", values: { ch1: 50 }, password: "x", feedback: { p1: { fault: true }, p2: {} } }, mode: "physical", site: "Lebu" });
    expect(body.preflight).toHaveLength(LIMITS.issues);
    expect(body.preflight[0]).toMatchObject({ code: "c0", fixtureId: "jet0" });
    expect(body.preflight[0].message.length).toBeLessThanOrEqual(LIMITS.line);
    expect(body.logs).toHaveLength(LIMITS.logs);
    expect(body.faults).toHaveLength(LIMITS.faults);
    expect(body.plc).toEqual({ connection_state: "failed", error: "timeout token=[redacted]", mode: "physical", feedback_faults: ["p1"] });
    expect(slimPlcStatus(null)).toBeNull();
    expect(slimPlcStatus(null, "plcsim")).toEqual({ mode: "plcsim", connection_state: "no status" });
  });

  it("summarises the site and reads faults read-only (empty when offline)", async () => {
    expect(siteSummary({ fixtures: [{ type: "nozzle_x" }, { type: "pump_y" }], target: "siemens" })).toBe("controller: siemens · 2 fixtures (1 nozzles, 0 valves, 1 pumps, 0 lights)");
    expect(await activeFaults({ get: async () => { throw new Error("offline"); } })).toEqual([]);
    const post = vi.fn(async () => ({}));
    await requestCommissioningHelp({ preflight: [] }, { post });
    expect(post).toHaveBeenCalledWith("/ai/commissioning-help", { preflight: [] });
  });
});
