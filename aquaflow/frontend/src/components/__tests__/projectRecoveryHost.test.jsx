// @vitest-environment jsdom
// ProjectRecoveryHost: (1) signals the desktop shell that OS-opened projects can now be
// delivered, only after its open-show handler is subscribed; (2) a fully verified asset
// report is a non-blocking toast, while missing/changed assets keep the blocking dialog.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const openProjectPath = vi.fn(() => Promise.resolve());
const relinkAsset = vi.fn(() => Promise.resolve(null));
let songPrompt = null;
const recoveryState = { info: { uncleanExit: false, snapshots: [] }, candidate: null, bridge: null };
vi.mock("../../utils/projectPersistence", async () => {
  const notify = (text, level = "info") => window.dispatchEvent(new CustomEvent("aquaflow:project-status", { detail: { text, level } }));
  return {
    restoreSnapshot: vi.fn(), openProjectPath: (...a) => openProjectPath(...a), saveProject: vi.fn(() => Promise.resolve()),
    packageProject: vi.fn(() => Promise.resolve()), relinkAsset: (...a) => relinkAsset(...a), notify,
    setSongPrompt: (fn) => { songPrompt = fn; return () => { if (songPrompt === fn) songPrompt = null; }; },
  };
});
vi.mock("../../utils/projectRecovery", () => ({
  findRecoveryCandidate: () => recoveryState.candidate,
  getSnapshotBackend: () => ({ recoveryInfo: () => Promise.resolve(recoveryState.info), markClean: () => Promise.resolve() }),
  desktopProjectBridge: () => recoveryState.bridge,
}));

globalThis.React = React;
const { default: ProjectRecoveryHost } = await import("../ProjectRecoveryHost");

const report = (statuses) => ({
  projectPath: "C:\\shows\\Lebu.aquapkg", kind: "package",
  report: { total: statuses.length, items: statuses.map((status, i) => ({ id: `a${i}`, name: `asset${i}.wav`, role: "audio", status })) },
});
const dispatchReport = (detail) => act(() => { window.dispatchEvent(new CustomEvent("aquaflow:asset-report", { detail })); });

describe("ProjectRecoveryHost", () => {
  beforeEach(() => { openProjectPath.mockClear(); relinkAsset.mockClear(); });
  afterEach(() => {
    cleanup(); delete window.aquaflow;
    Object.assign(recoveryState, { info: { uncleanExit: false, snapshots: [] }, candidate: null, bridge: null });
    window.sessionStorage.clear();
  });

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

  it("missing song: says which song is missing and offers Locate the file…", async () => {
    render(<ProjectRecoveryHost />);
    dispatchReport({ projectPath: "D:/Copied/Lebu.aqua", kind: "aqua", report: { total: 2, items: [
      { id: "model:custom:x", name: "Scene.glb", role: "site_model", status: "ok" },
      { id: "audio:programmer", name: "6493786.mp3", role: "audio", source: "file", status: "missing", sha256: "ab" },
    ] } });
    expect(screen.getByRole("dialog").textContent).toMatch(/The song 6493786\.mp3 is missing/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Locate the file…" })); });
    expect(relinkAsset).toHaveBeenCalledWith(expect.objectContaining({ id: "audio:programmer" }), expect.anything());
  });

  it("asks 'Keep the song inside the project file?' for Save and answers with the choice", async () => {
    render(<ProjectRecoveryHost />);
    expect(typeof songPrompt).toBe("function");
    let answer;
    act(() => { songPrompt({ song: { name: "song.mp3" }, projectKey: "p1" }).then((a) => { answer = a; }); });
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toMatch(/Keep the song inside the project file\?/);
    expect(dialog.textContent).toMatch(/song\.mp3/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Keep the song inside (.aquapkg)" })); });
    expect(answer).toBe("embed");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("after the window crashed and reloaded, the recovery prompt is offered again in the same session", async () => {
    recoveryState.bridge = {};
    recoveryState.candidate = { snapshot: { id: "s1", name: "Lebu", savedAt: "2026-10-22T08:00:00Z", projectKey: "p1" }, lastCleanSaveAt: null };
    recoveryState.info = { uncleanExit: true, snapshots: [], rendererCrashAt: "2026-10-22T08:05:00Z" };
    window.sessionStorage.setItem("aquaflow.recoveryPromptHandled", "1"); // handled before the crash
    render(<ProjectRecoveryHost />);
    await act(async () => {});
    expect(screen.getByRole("dialog").textContent).toMatch(/did not close normally/);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard" })); });
    expect(window.sessionStorage.getItem("aquaflow.recoveryPromptHandled")).toBe("2026-10-22T08:05:00Z");
    cleanup();
    render(<ProjectRecoveryHost />); // same crash again (e.g. a plain reload): not offered twice
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
