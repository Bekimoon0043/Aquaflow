import { describe, expect, it } from "vitest";
import { buildDesignedDeviceSummaries, mergeDevicePanelEntries } from "../projectDevicePanel";

describe("project device sidebar projection", () => {
  it("summarizes engineering fixtures without claiming hardware is online", () => {
    const result = buildDesignedDeviceSummaries([
      { id: "j1", type: "nozzle_geyser", groupId: "center_jets" },
      { id: "j2", type: "nozzle_geyser", groupId: "center_jets" },
      { id: "l1", type: "light_rgb", groupId: "rgb_lights" },
    ]);
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.type === "nozzle")).toMatchObject({
      label: "Center water outlets (2)", status: "designed", protocol: "design", health: null,
    });
    expect(result.every((item) => item.status !== "online")).toBe(true);
  });

  it("preserves measured runtime truth and keeps it separate from design assets", () => {
    const result = mergeDevicePanelEntries([
      { id: "plc", label: "PLC", type: "equipment", protocol: "s7comm", status: "online", health: 100 },
      { id: "seen", label: "Seen host", type: "equipment", protocol: "unknown", status: "unverified" },
    ], [{ id: "j1", type: "nozzle_fan", groupId: "center_jets" }]);
    expect(result.find((item) => item.id === "plc").health).toBe(100);
    expect(result.find((item) => item.id === "seen").health).toBeNull();
    expect(result.find((item) => item.source === "engineering").status).toBe("designed");
  });
});

