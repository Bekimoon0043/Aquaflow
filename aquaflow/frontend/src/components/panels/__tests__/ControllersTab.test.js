import { describe, expect, it } from "vitest";
import {
  controllerTierBadge,
  confidenceLabel,
} from "../DeviceDiscoveryPanel.jsx";

// AF-CAT-001 — the Controllers tab's pure helpers.

describe("controller tier rendering", () => {
  it("only REAL earns green/DRIVABLE — identification is never drivability", () => {
    expect(controllerTierBadge("REAL")).toEqual({ color: "var(--green)", label: "DRIVABLE" });
    expect(controllerTierBadge("GATED").label).toBe("GATED");
    expect(controllerTierBadge("UNSUPPORTED").label).toBe("IDENTIFY-ONLY");
    expect(controllerTierBadge("UNSUPPORTED").color).toBe("var(--red)");
  });

  it("labels detection confidence honestly", () => {
    expect(confidenceLabel("confirmed")).toBe("protocol confirmed");
    expect(confidenceLabel("probable")).toBe("probable");
    expect(confidenceLabel("port_only")).toBe("port match only");
  });
});
