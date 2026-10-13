// AF-NEXT-013: GPU classification and starting tier.
import { describe, it, expect } from "vitest";
import { classifyGpu, pickStartTier, resolveStartTier, resolveTierLimit, tierCeiling, PROBE_THRESHOLDS } from "../gpuTier";

describe("classifyGpu", () => {
  const cases = [
    ["ANGLE (NVIDIA, NVIDIA GeForce GT 730 (0x00000F02) Direct3D11 vs_5_0 ps_5_0, D3D11)", "entry"],
    ["ANGLE (NVIDIA, NVIDIA GeForce GT 1030 Direct3D11 vs_5_0 ps_5_0, D3D11)", "entry"],
    ["ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)", "entry"],
    ["ANGLE (Intel, Intel(R) HD Graphics 520 Direct3D11 vs_5_0 ps_5_0, D3D11)", "entry"],
    ["ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "entry"],
    ["ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", "mid"],
    ["ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)", "mid"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Direct3D11 vs_5_0 ps_5_0, D3D11)", "mid"],
    ["ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)", "high"],
    ["ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)", "high"],
    ["ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)", "software"],
    ["", "unknown"],
    ["Some Future GPU 9000", "unknown"],
  ];
  for (const [s, cls] of cases) it(`${cls}: ${s || "(empty)"}`, () => expect(classifyGpu(s)).toBe(cls));
});

describe("starting tier", () => {
  it("weak and software GPUs start on eco; recognised GPUs keep medium", () => {
    expect(pickStartTier({ gpuClass: "entry" })).toBe("eco");
    expect(pickStartTier({ gpuClass: "software" })).toBe("eco");
    expect(pickStartTier({ gpuClass: "mid" })).toBe("medium");
    expect(pickStartTier({ gpuClass: "high" })).toBe("medium");
  });
  it("unknown GPUs are placed by the timed probe", () => {
    expect(pickStartTier({ gpuClass: "unknown", probeMs: PROBE_THRESHOLDS.eco + 1 })).toBe("eco");
    expect(pickStartTier({ gpuClass: "unknown", probeMs: PROBE_THRESHOLDS.low + 1 })).toBe("low");
    expect(pickStartTier({ gpuClass: "unknown", probeMs: 2 })).toBe("medium");
    expect(pickStartTier({ gpuClass: "unknown", probeMs: null })).toBe("medium");
  });
  it("auto uses the detection; explicit tiers are honoured; adaptive caps weak GPUs", () => {
    const weak = { gpuClass: "entry", tier: "eco" }, strong = { gpuClass: "high", tier: "medium" };
    expect(resolveStartTier({ quality: "auto", profile: weak })).toBe("eco");
    expect(resolveStartTier({ quality: "high", adaptive: true, profile: strong })).toBe("high");
    expect(resolveStartTier({ quality: "medium", adaptive: true, profile: weak })).toBe("eco");
    expect(resolveStartTier({ quality: "medium", adaptive: false, profile: weak })).toBe("medium");
    expect(tierCeiling("entry")).toBe("low");
    expect(tierCeiling("mid")).toBe("medium");
  });
  it("does not let saved high projects climb past low on an entry GPU", () => {
    const entry = { gpuClass: "entry", tier: "eco" };
    const slowUnknown = { gpuClass: "unknown", tier: "eco", probeMs: PROBE_THRESHOLDS.eco + 1 };
    const strong = { gpuClass: "high", tier: "medium" };

    expect(resolveTierLimit({ quality: "high", adaptive: true, profile: entry })).toBe("low");
    expect(resolveTierLimit({ quality: "high", adaptive: true, profile: slowUnknown })).toBe("low");
    expect(resolveTierLimit({ quality: "eco", adaptive: true, profile: entry })).toBe("eco");
    expect(resolveTierLimit({ quality: "high", adaptive: false, profile: entry })).toBe("high");
    expect(resolveTierLimit({ quality: "high", adaptive: true, profile: strong })).toBe("high");
  });
});
