import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SiemensLinkStatus } from "./SiemensShowControls";

const render = (status, mode = "physical") => renderToStaticMarkup(<SiemensLinkStatus status={status} mode={mode} />);

describe("Siemens PLC link indicator", () => {
  it("animates only when a verified PLC has replied recently", () => {
    const live = render({ hardware_verified: true, telemetry_fresh: true, last_rx_age_seconds: 0.5, contract_version: 2 });
    expect(live).toContain("siemens-link--active");
    expect(live).toContain("PLC responding");
    expect(live).toContain("Contract v2");
    expect(render({ hardware_verified: true, telemetry_fresh: false, last_rx_age_seconds: 30 })).not.toContain("siemens-link--active");
  });

  it("never represents simulation or a fault as live PLC communication", () => {
    const simulation = render({ hardware_verified: true, telemetry_fresh: true, last_rx_age_seconds: 0.2 }, "simulated");
    expect(simulation).not.toContain("siemens-link--active");
    expect(simulation).toContain("Internal AquaFlow preview only");
    expect(simulation).toContain("TIA/PLCSIM DB100 will not change");
    const fault = render({ hardware_verified: true, telemetry_fresh: true, last_rx_age_seconds: 0.2, connection_state: "lost" });
    expect(fault).toContain("Communication fault");
    expect(fault).not.toContain("siemens-link--active");
  });
});
