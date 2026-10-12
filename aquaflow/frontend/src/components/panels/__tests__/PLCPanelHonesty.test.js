import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MONITOR_LIVE_WINDOW_MS,
  isReadOnlyTag,
  monitorIsLive,
  plcWriteOutcome,
} from "../PLCPanel.jsx";

// The PLC panel must never show invented values as live, and must surface the
// backend's write refusals instead of reporting success.

describe("Monitor live indicator", () => {
  it("is live only when values arrived within the window", () => {
    expect(monitorIsLive(0, 10_000)).toBe(false);
    expect(monitorIsLive(10_000, 10_000 + MONITOR_LIVE_WINDOW_MS)).toBe(true);
    expect(monitorIsLive(10_000, 10_000 + MONITOR_LIVE_WINDOW_MS + 1)).toBe(false);
  });

  it("has no hard-coded demo values left", () => {
    const src = readFileSync(new URL("../PLCPanel.jsx", import.meta.url), "utf8");
    expect(src).not.toMatch(/DEMO_VALUES/);
    expect(src).not.toMatch(/72\.5/);
  });
});

describe("Tag write outcome", () => {
  it("shows the safety-gate refusal (403) verbatim", () => {
    const out = plcWriteOutcome(false, 403, { detail: "write refused: safety permit not granted" });
    expect(out.ok).toBe(false);
    expect(out.msg).toContain("safety permit not granted");
  });

  it("shows the read-only refusal (400)", () => {
    const out = plcWriteOutcome(false, 400, { detail: "tag 'heartbeat' (DB1.DBW0) is read-only" });
    expect(out.ok).toBe(false);
    expect(out.msg).toContain("read-only");
  });

  it("a 200 with success:false is not a success", () => {
    expect(plcWriteOutcome(true, 200, { success: false }).ok).toBe(false);
    expect(plcWriteOutcome(true, 200, { success: true }).ok).toBe(true);
  });

  it("profile read tags are read-only, others writable", () => {
    expect(isReadOnlyTag({ access: "read" })).toBe(true);
    expect(isReadOnlyTag({ access: "write" })).toBe(false);
    expect(isReadOnlyTag({})).toBe(false);
  });
});
