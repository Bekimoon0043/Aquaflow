import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SiemensReadinessReport } from "./SiemensReadiness";

const report = {
  revision: 3, mode: "simulated", status: "BLOCKED",
  checks: [{ code: "analog", state: "review", title: "1212C analog output", detail: "An AO module is required." }],
  support_matrix: [{ family: "S7-1500", status: "Not validated" }],
};
describe("Siemens commissioning readiness", () => {
  it("distinguishes simulation from hardware and shows unresolved requirements", () => {
    const html = renderToStaticMarkup(<SiemensReadinessReport report={report} dirty />);
    expect(html).toContain("Action required");
    expect(html).toContain("no physical commissioning");
    expect(html).toContain("Unsaved edits");
    expect(html).toContain("AO module is required");
    expect(html).toContain("Not validated");
  });
  it("does not call a completed mapping hardware ready", () => {
    const html = renderToStaticMarkup(<SiemensReadinessReport report={{ ...report, mode: "physical", status: "HARDWARE_VALIDATION_REQUIRED" }} />);
    expect(html).toContain("Hardware validation required");
    expect(html).toContain("connection alone does not prove equipment readiness");
    expect(html).not.toContain("Unsaved edits");
  });
});
