// @vitest-environment jsdom
// Autosave hardening: no snapshot without a content change, one serialisation per snapshot
// (the JSON string goes to the backend as-is), large projects back off, and a clean
// save/open re-baselines without serialising.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAutoSave } from "../useAutoSave.js";
import { __resetSnapshotBackendForTests } from "../../utils/projectRecovery.js";
import {
  isContentChange, shouldWriteSnapshot, minSnapshotGapMs, LARGE_PROJECT_BYTES, LARGE_PROJECT_MIN_GAP_MS,
} from "../../utils/autosavePolicy.js";
import { useShowStore } from "../../store/showStore.js";

let backend;
beforeEach(() => {
  vi.useFakeTimers();
  backend = { kind: "test", write: vi.fn(async () => ({ id: "snap", savedAt: new Date().toISOString() })) };
  __resetSnapshotBackendForTests(backend);
});
afterEach(() => {
  vi.useRealTimers();
  __resetSnapshotBackendForTests(null);
});

const advance = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("autosave policy", () => {
  it("no change → no write; change → write", () => {
    expect(shouldWriteSnapshot({ revision: 4, savedRevision: 4 })).toBe(false);
    expect(shouldWriteSnapshot({ revision: 5, savedRevision: 4 })).toBe(true);
  });
  it("large projects back off between snapshots", () => {
    const base = { revision: 2, savedRevision: 1, lastBytes: LARGE_PROJECT_BYTES + 1, lastWriteAt: 1_000_000 };
    expect(minSnapshotGapMs(1024)).toBe(0);
    expect(shouldWriteSnapshot({ ...base, now: 1_000_000 + 60_000 })).toBe(false);
    expect(shouldWriteSnapshot({ ...base, now: 1_000_000 + LARGE_PROJECT_MIN_GAP_MS })).toBe(true);
  });
  it("playback, device health and UI-only updates are not content changes", () => {
    const prev = { isDirty: false, nodes: [], playhead: 0, devices: [], timelineZoom: 1 };
    expect(isContentChange("show", { ...prev, playhead: 3, devices: [{ health: 1 }], timelineZoom: 2 }, prev)).toBe(false);
    expect(isContentChange("show", { ...prev, nodes: [{ id: "n" }] }, prev)).toBe(true);
    expect(isContentChange("show", { ...prev, isDirty: true }, prev)).toBe(true);
    const fixtures = [];
    expect(isContentChange("engineering", { lastUpdated: 2, fixtures }, { lastUpdated: 1, fixtures })).toBe(false);
  });
});

describe("useAutoSave", () => {
  it("writes nothing while the project is unchanged (idle, playback, device polling)", async () => {
    const { unmount } = renderHook(() => useAutoSave());
    await advance(5 * 60_000);
    act(() => { useShowStore.getState().setPlayhead?.(12.5); });
    act(() => { useShowStore.getState().setPlayback?.("playing"); });
    await advance(2 * 60_000);
    expect(backend.write).not.toHaveBeenCalled();
    unmount();
  });

  it("an edit writes exactly one snapshot, as a JSON string; idle afterwards writes nothing", async () => {
    const { unmount } = renderHook(() => useAutoSave());
    act(() => { useShowStore.getState().setManualPriority(true); });
    await advance(5_000);
    expect(backend.write).toHaveBeenCalledTimes(1);
    const [, project, meta] = backend.write.mock.calls[0];
    expect(typeof project).toBe("string");
    expect(JSON.parse(project).aquaflow).toBeTruthy();
    expect(meta.bytes).toBe(project.length);
    await advance(10 * 60_000);
    expect(backend.write).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("a clean save/open baseline drops the pending edit without writing", async () => {
    const { unmount } = renderHook(() => useAutoSave());
    act(() => { useShowStore.getState().setManualPriority(false); });
    act(() => { window.dispatchEvent(new CustomEvent("aquaflow:project-baseline")); });
    await advance(5 * 60_000);
    expect(backend.write).not.toHaveBeenCalled();
    unmount();
  });

  it("a large project waits ≥ 3 min before the next snapshot", async () => {
    const { unmount } = renderHook(() => useAutoSave());
    act(() => { useShowStore.getState().setAudioData({ peaks: "x".repeat(LARGE_PROJECT_BYTES + 1024) }); });
    await advance(5_000);
    expect(backend.write).toHaveBeenCalledTimes(1);
    act(() => { useShowStore.getState().setManualPriority(true); });
    await advance(2 * 60_000);
    expect(backend.write).toHaveBeenCalledTimes(1);
    await advance(90_000);
    expect(backend.write).toHaveBeenCalledTimes(2);
    act(() => { useShowStore.getState().clearAudioData(); });
    unmount();
  });
});
