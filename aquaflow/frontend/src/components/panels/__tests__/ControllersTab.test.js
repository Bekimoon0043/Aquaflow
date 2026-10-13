import { describe, expect, it } from "vitest";
import {
  controllerTierBadge,
  confidenceLabel,
  stageLabel,
  discoveredDeviceProjection,
  plcPrefillFromDetection,
  isIcanGateway,
  buildDiscoverBody,
  adapterOptionLabel,
  discoveryStatusLine,
  describeHttpError,
  controllerVerificationBadge,
} from "../DeviceDiscoveryPanel.jsx";

// AF-CAT-001 / AF-DISC — the Controllers tab's pure helpers.

const s7 = {
  discovery_id: "abc123", ip: "192.168.5.10", port: 102, catalog_id: "siemens-s7-1200",
  protocol: "siemens_s7", tier: "REAL", drivable: true, confidence: "confirmed",
  stage: "identity_confirmed", vendor: "Siemens", model: "6ES7 215-1AG40-0XB0",
  configurable: true, status: "unverified", health: null,
  verification_level: "simulated", verification_summary: "PLCSIM only",
  plc_prefill: { plc_type: "siemens_s7", ip: "192.168.5.10", port: 102, rack: 0, slot: 1, unit_id: 1,
                 vendor: "Siemens", model: "6ES7 215-1AG40-0XB0", name: "Siemens @ 192.168.5.10",
                 profile_hint: "s7-1200-1500" },
};
const modbus = {
  discovery_id: "def456", ip: "192.168.5.30", port: 502, catalog_id: "advantech-adam-6000",
  protocol: "modbus_tcp", tier: "REAL", confidence: "confirmed", stage: "identity_confirmed",
  configurable: true, plc_prefill: { plc_type: "modbus_tcp", ip: "192.168.5.30", port: 502, unit_id: 3, vendor: "Advantech", model: "ADAM-6017" },
};
const ab = {
  discovery_id: "ab1", ip: "192.168.5.20", port: 44818, catalog_id: "allen-bradley-logix",
  protocol: "ethernet_ip", tier: "UNSUPPORTED", drivable: false, confidence: "confirmed",
  stage: "identity_confirmed", configurable: false, plc_prefill: {},
};
const portOnly = {
  discovery_id: "po1", ip: "192.168.5.40", port: 5007, catalog_id: "mitsubishi-melsec",
  protocol: "melsec_mc", tier: "GATED", confidence: "port_only", stage: "port_open", configurable: false, plc_prefill: {},
};
const ican = {
  discovery_id: "ic1", ip: "192.168.5.2", port: 200, catalog_id: "ican-music-fountain", protocol: "ican",
  tier: "REAL", confidence: "confirmed", stage: "protocol_confirmed", configurable: false, plc_prefill: {},
  identity: { interface: "Ethernet", signature: "07 00", latency_ms: 1.7 },
};

describe("controller tier rendering", () => {
  it("only REAL earns green/DRIVABLE — identification is never drivability", () => {
    expect(controllerTierBadge("REAL")).toEqual({ color: "var(--green)", label: "DRIVABLE" });
    expect(controllerTierBadge("GATED").label).toBe("GATED");
    expect(controllerTierBadge("UNSUPPORTED").label).toBe("IDENTIFY-ONLY");
    expect(controllerTierBadge("UNSUPPORTED").color).toBe("var(--red)");
  });

  it("a port-only hit reads UNVERIFIED even for a drivable family", () => {
    // An open 4840 on some Windows PC is not an OPC UA server until a session is
    // established; the family badge (DRIVABLE) must not be shown for it.
    const portHit = { tier: "REAL", confidence: "port_only", stage: "port_open" };
    expect(controllerTierBadge("REAL", portHit)).toEqual({ color: "#f59e0b", label: "UNVERIFIED" });
    expect(controllerTierBadge("REAL", { tier: "REAL", confidence: "confirmed", stage: "protocol_confirmed" }).label).toBe("DRIVABLE");
    expect(controllerTierBadge("REAL", { confidence: "confirmed", stage: "port_open" }).label).toBe("UNVERIFIED");
    expect(controllerTierBadge("UNSUPPORTED", portHit).label).toBe("UNVERIFIED");
  });

  it("labels detection confidence honestly", () => {
    expect(confidenceLabel("confirmed")).toBe("protocol confirmed");
    expect(confidenceLabel("probable")).toBe("probable");
    expect(confidenceLabel("port_only")).toBe("port match only");
  });

  it("a port-only stage is 'port match only' even if confidence lies", () => {
    expect(confidenceLabel("confirmed", "port_open")).toBe("port match only");
    expect(confidenceLabel("confirmed", "identity_confirmed")).toBe("identity confirmed");
    expect(confidenceLabel(undefined, undefined)).toBe("unverified service");
    expect(stageLabel("protocol_confirmed")).toBe("protocol confirmed");
    expect(stageLabel("nonsense")).toBe("unverified");
  });
});

describe("commissioning evidence rendering", () => {
  it("keeps driver support separate from physical verification", () => {
    expect(controllerVerificationBadge("simulated")).toEqual({ color: "#f59e0b", label: "SIMULATED" });
    expect(controllerVerificationBadge("bench_verified").label).toBe("BENCH VERIFIED");
    expect(controllerVerificationBadge("site_commissioned").label).toBe("SITE COMMISSIONED");
    expect(controllerVerificationBadge("unsupported").label).toBe("UNSUPPORTED");
    expect(controllerVerificationBadge(undefined).label).toBe("UNSUPPORTED");
  });
});

describe("PLC configuration prefill", () => {
  it("pre-fills IP, port, rack/slot, unit id, vendor and model for Siemens", () => {
    const p = plcPrefillFromDetection(s7);
    expect(p).toMatchObject({ plc_type: "siemens_s7", ip: "192.168.5.10", port: 102, rack: 0, slot: 1,
                              unit_id: 1, vendor: "Siemens", model: "6ES7 215-1AG40-0XB0", discovery_id: "abc123" });
    expect(p.profile_hint).toBe("s7-1200-1500");
  });

  it("pre-fills unit id for Modbus", () => {
    expect(plcPrefillFromDetection(modbus)).toMatchObject({ plc_type: "modbus_tcp", port: 502, unit_id: 3, vendor: "Advantech" });
  });

  it("unsupported and port-only controllers stay identify-only (no prefill)", () => {
    expect(plcPrefillFromDetection(ab)).toBeNull();
    expect(plcPrefillFromDetection(portOnly)).toBeNull();
    expect(plcPrefillFromDetection(ican)).toBeNull();     // configured in Fountain Control, not the PLC panel
    expect(plcPrefillFromDetection(null)).toBeNull();
  });

  it("recognises the validated I-CAN gateway", () => {
    expect(isIcanGateway(ican)).toBe(true);
    expect(isIcanGateway(s7)).toBe(false);
  });
});

describe("no fake online/health assignment", () => {
  it("projects every discovered device as unverified with no health value", () => {
    for (const d of [s7, modbus, ab, portOnly, ican, { ip: "10.0.0.1", port: 80, label: "x", status: "online", health: 85 }]) {
      const proj = discoveredDeviceProjection(d);
      expect(proj.status).toBe("unverified");
      expect(proj.health).toBeNull();
      expect(["port_open", "protocol_confirmed", "identity_confirmed"]).toContain(proj.stage);
    }
  });
});

describe("scan request building", () => {
  it("an explicit CIDR wins over an adapter and nothing else is added", () => {
    expect(buildDiscoverBody({ adapter: "Ethernet", cidr: " 192.168.5.0/24 ", unitIds: "1, 3" }))
      .toEqual({ include_ican: true, include_virtual: false, unit_ids: [1, 3], subnet: "192.168.5.0/24" });
  });
  it("an adapter alone scans that adapter's subnet", () => {
    expect(buildDiscoverBody({ adapter: "Ethernet", cidr: "", unitIds: "" }))
      .toEqual({ include_ican: true, include_virtual: false, unit_ids: [1], adapter: "Ethernet" });
  });
  it("unit ids are bounded, de-duplicated and default to 1", () => {
    expect(buildDiscoverBody({ unitIds: "1 1 2 300 -4 x 9;10" }).unit_ids).toEqual([1, 2, 9, 10]);
    expect(buildDiscoverBody({ unitIds: "1,2,3,4,5,6,7,8,9,10" }).unit_ids).toHaveLength(8);
    expect(buildDiscoverBody({ includeIcan: false }).include_ican).toBe(false);
  });
});

describe("operator-facing lines", () => {
  it("adapter labels show the real mask and kind", () => {
    expect(adapterOptionLabel({ name: "Ethernet", ip: "192.168.5.200", prefix: 22, subnet: "192.168.4.0/22", kind: "physical" }))
      .toBe("Ethernet — 192.168.5.200/22 (192.168.4.0/22)");
    expect(adapterOptionLabel({ name: "vEthernet (WSL)", ip: "172.20.0.1", prefix: 20, subnet: "172.20.0.0/20", kind: "virtual" }))
      .toContain("· virtual");
  });
  it("status line flags partial results", () => {
    const line = discoveryStatusLine({ hosts_scanned: 40, subnets: ["192.168.5.0/24"], tcp_ports: [102, 502], duration_s: 3.2, cancelled: true });
    expect(line).toContain("40 hosts");
    expect(line).toContain("CANCELLED");
    expect(discoveryStatusLine({ deadline_hit: true })).toContain("time budget");
  });
  it("non-2xx backend responses are described explicitly", () => {
    expect(describeHttpError(new Error("HTTP 400 — 10.0.0.0/8 is too large"))).toBe("rejected: 10.0.0.0/8 is too large");
    expect(describeHttpError(new Error("HTTP 409 — busy"))).toContain("already running");
    expect(describeHttpError(new Error("HTTP 500 — boom"))).toBe("HTTP 500 — boom");
    expect(describeHttpError(new TypeError("Failed to fetch"))).toBe("backend unreachable");
  });
});
