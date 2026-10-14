// @vitest-environment jsdom
// ProjectRecoveryHost: (1) signals the desktop shell that OS-opened projects can now be
// delivered, only after its open-show handler is subscribed; (2) a fully verified asset
// report is a non-blocking toast, while missing/changed assets keep the blocking dialog.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";

const openProjectPath = vi.fn(() => Promise.resolve());
vi.mock("../../utils/projectPersistence", async () => {
  const notify = (text, level = "info") => window.dispatchEvent(new CustomEvent("aquaflow:project-status", { detail: { text, level } }));
  return {
    restoreSnapshot: vi.fn(), openProjectPath: (...a) => openProjectPath(...a), saveProject: vi.fn(() => Promise.resolve()),
    packageProject: vi.fn(() => Promise.resolve()), relinkAsset: vi.fn(), notify,
  };
});
vi.mock("../../utils/projectRecovery", () => ({
  findRecoveryCandidate: () => null,
  getSnapshotBackend: () => ({ recoveryInfo: () => Promise.resolve({ uncleanExit: false, snapshots: [] }), markClean: () => Promise.resolve() }),
  desktopProjectBridge: () => null,
}));

globalThis.React = React;
const { default: ProjectRecoveryHost } = await import("../ProjectRecoveryHost");

const report = (statuses) => ({
  projectPath: "C:\\shows\\Lebu.aquapkg", kind: "package",
  report: { total: statuses.length, items: statuses.map((status, i) => ({ id: `a${i}`, name: `asset${i}.wav`, role: "audio", status })) },
});
const dispatchReport = (detail) => act(() => { window.dispatchEvent(new CustomEvent("aquaflow:asset-report", { detail })); });

describe("ProjectRecoveryHost", () => {
  beforeEach(() => { openProjectPath.mockClear(); });
  afterEach(() => { cleanup(); delete window.aquaflow; });

  it("signals ready-for-open after subscribing to open-show, and opens what the shell delivers", async () => {
    const order = [];
    let openHandler = null;
    window.aquaflow = {
      onOpenShow: vi.fn((cb) => { order.push("subscribe"); openHandler = cb; return () => {}; }),
      signalReadyForOpen: vi.fn(() => order.push("ready")),
    };
    render(<ProjectRecoveryHost />);
    expect(order).toEqual(["subscribe", "ready"]);
    expect(window.aquaflow.signalReadyForOpen).toHaveBeenCalledTimes(1);
    openHandler("C:\\shows\\Lebu.aquapkg");
    expect(openProjectPath).toHaveBeenCalledWith("C:\\shows\\Lebu.aquapkg");
  });

  it("works with an older shell that has no ready signal", () => {
    window.aquaflow = { onOpenShow: () => () => {} };
    expect(() => render(<ProjectRecoveryHost />)).not.toThrow();
  });

  it("all assets OK: brief non-blocking status, no modal", () => {
    render(<ProjectRecoveryHost />);
    dispatchReport(report(["ok", "ok", "ok"]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("3 assets verified");
  });

  it("found-but-unhashed assets are not blocking either", () => {
    render(<ProjectRecoveryHost />);
    dispatchReport(report(["ok", "unverified"]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/1 asset verified · 1 found without a saved hash/);
  });

  it("missing or changed assets keep the blocking dialog", () => {
    render(<ProjectRecoveryHost />);
    dispatchReport(report(["ok", "missing", "changed"]));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/2 project assets need attention/);
    expect(screen.getByRole("button", { name: "Continue without these assets" })).toBeTruthy();
    // A later clean project replaces the stale dialog with a toast.
    dispatchReport(report(["ok"]));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("1 asset verified");
  });
});
