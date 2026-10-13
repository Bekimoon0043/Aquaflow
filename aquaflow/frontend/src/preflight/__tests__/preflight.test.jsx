import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PREVIEW_ONLY_LABEL, buildPreflightProject, groupBySeverity, loadShowDiagnostics, mergeDiagnostics,
  normalizeDiagnostic, openDiagnosticFix, runPreflight, takePendingFocus, timelineItemId,
} from "../preflight";
import { PreflightIssueList, issueAction, selectLegacyClip } from "../../components/panels/PreflightPanel";
import { compileShow } from "../../utils/runtimeEventCompiler";

globalThis.React = React;

const SHAPE = ["code", "severity", "timeMs", "fixtureId", "clipId", "engineeringItemId", "message", "fix", "source"];
const d = (code, severity, extra = {}) => ({ code, severity, timeMs: null, fixtureId: null, clipId: null,
  engineeringItemId: null, message: code, fix: null, source: "preflight", ...extra });

describe("AF-NEXT-009 diagnostic merge", () => {
  it("normalizes to the shared Diagnostic shape", () => {
    const n = normalizeDiagnostic({ code: "x", severity: "warn", timeMs: "1500.4", fix: { kind: "bogus", target: "a" } }, "splash");
    expect(Object.keys(n).sort()).toEqual([...SHAPE].sort());
    expect(n).toMatchObject({ severity: "warning", timeMs: 1500, fix: null, source: "splash" });
  });

  it("merges backend, hydraulic and splash lists, de-duplicates and sorts errors first by time", () => {
    const backend = [d("pump-deadhead", "error", { timeMs: 4000 }), d("overlap", "warning", { timeMs: 0 })];
    const hydraulics = [d("low-pressure", "error", { timeMs: 1000, source: "hydraulics" }), d("pump-deadhead", "error", { timeMs: 4000 })];
    const merged = mergeDiagnostics(backend, hydraulics, null);
    expect(merged.map(i => i.code)).toEqual(["low-pressure", "pump-deadhead", "overlap"]);
    expect(groupBySeverity(merged).error).toHaveLength(2);
  });

  it("loads engineering/showDiagnostics.js when present and tolerates its absence", async () => {
    const getHydraulicDiagnostics = vi.fn(async () => [{ ...d("hyd", "warning"), source: undefined }]);
    const getSplashDiagnostics = vi.fn(async () => [d("splash-deck", "error", { source: "splash", fix: { kind: "open_engineering_item", target: "N1" } })]);
    const modules = { "../engineering/showDiagnostics.js": async () => ({ getHydraulicDiagnostics, getSplashDiagnostics }) };
    const out = await loadShowDiagnostics({ clips: [] }, { clips: [] }, {}, modules);
    expect(out.map(i => [i.code, i.source])).toEqual([["hyd", "hydraulics"], ["splash-deck", "splash"]]);
    expect(getSplashDiagnostics).toHaveBeenCalledWith({ clips: [] }, { clips: [] }, {});
    expect(await loadShowDiagnostics({}, {}, {}, {})).toEqual([]);
    const broken = { x: async () => { throw new Error("nope"); } };
    expect((await loadShowDiagnostics({}, {}, {}, broken))[0].code).toBe("diagnostics-failed");
  });

  it("runPreflight merges the backend result with local diagnostics and recomputes ok", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, issues: [d("preview-only", "info")],
      summary: { errors: 0 }, resolved_revision: "pf-1", hardware: false, label: PREVIEW_ONLY_LABEL }) }));
    const modules = { m: async () => ({ getHydraulicDiagnostics: () => [d("dry-nozzle", "error")], getSplashDiagnostics: () => [] }) };
    const result = await runPreflight({ fixtures: [], clips: [] }, { kind: "preview" }, { fetchImpl, modules });
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/preflight$/);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).target).toEqual({ kind: "preview" });
    expect(result.ok).toBe(false);
    expect(result.summary).toMatchObject({ errors: 1, infos: 1 });
    expect(result.label).toBe(PREVIEW_ONLY_LABEL);
  });

  it("builds the request project from Engineering fixtures and the resolved Studio clips", () => {
    const project = buildPreflightProject({
      fixtures: [{ id: "V1", type: "valve", supplyingPumpId: "P1", x: 3, mesh: { big: true } }],
      programmer: { timelineClips: [{ id: "r1:V1:0" }], studio: { recipes: [{ id: "r1" }], groups: [{ id: "g" }] } },
    });
    expect(project.fixtures).toEqual([{ id: "V1", type: "valve", supplyingPumpId: "P1", x: 3 }]);   // AF-NEXT-008: plan position kept for splash
    expect(project.clips).toHaveLength(1);
    expect(project.recipes[0].id).toBe("r1");
  });
});

describe("AF-NEXT-009 fix navigation", () => {
  it("open_clip opens Show Programming, focuses the owning recipe and the legacy timeline", () => {
    const events = [], selectLegacy = vi.fn();
    const issue = d("valve-close-against-pump", "error", { timeMs: 6000, fixtureId: "V1", fix: { kind: "open_clip", target: "r1:V1:0" } });
    const nav = openDiagnosticFix(issue, { dispatch: (name, detail) => events.push([name, detail]), selectLegacyClip: selectLegacy });
    expect(events[0]).toEqual(["aquaflow:open-panel", { panel: "show_programmer" }]);
    expect(events[1]).toEqual(["aquaflow:open-clip", { clipId: "r1:V1:0", itemId: "r1", timeMs: 6000, fixtureId: "V1" }]);
    expect(selectLegacy).toHaveBeenCalledWith("r1:V1:0");
    expect(nav.panel).toBe("show_programmer");
    // A Studio that mounts after the event still receives the request once.
    expect(takePendingFocus("clip")).toMatchObject({ itemId: "r1" });
    expect(takePendingFocus("clip")).toBeNull();
    expect(timelineItemId("legacy-7")).toBe("legacy-7");
  });

  it("open_engineering_item opens the designer and requests the selection; open_panel opens a panel", () => {
    const events = [];
    const dispatch = (name, detail) => events.push([name, detail]);
    openDiagnosticFix(d("valve-without-pump", "error", { fix: { kind: "open_engineering_item", target: "V3" } }), { dispatch });
    expect(events).toEqual([["aquaflow:open-panel", { panel: "geometry" }], ["aquaflow:select-engineering-item", { id: "V3", timeMs: null }]]);
    expect(takePendingFocus("engineering")).toEqual({ id: "V3", timeMs: null });
    events.length = 0;
    openDiagnosticFix(d("site-invalid", "error", { fix: { kind: "open_panel", target: "plc" } }), { dispatch });
    expect(events).toEqual([["aquaflow:open-panel", { panel: "plc" }]]);
    expect(openDiagnosticFix(d("x", "info"), { dispatch })).toBeNull();
  });

  it("selects a legacy timeline clip only when a track holds it", () => {
    const selectClip = vi.fn();
    const store = { getState: () => ({ timelineTracks: [{ id: "t1", clips: [{ id: "c1" }] }], selectClip }) };
    expect(selectLegacyClip("c1", store)).toBe(true);
    expect(selectClip).toHaveBeenCalledWith("t1", "c1");
    expect(selectLegacyClip("nope", store)).toBe(false);
  });

  it("issueAction routes through the same navigation", () => {
    const events = [];
    issueAction(d("x", "error", { fix: { kind: "open_panel", target: "devices" } }), { dispatch: (n, v) => events.push([n, v]) });
    expect(events).toEqual([["aquaflow:open-panel", { panel: "devices" }]]);
  });

  it("renders issues grouped by severity, each with its fix location", () => {
    const html = renderToStaticMarkup(<PreflightIssueList issues={mergeDiagnostics([
      d("flame-duration", "error", { timeMs: 1000, fix: { kind: "open_clip", target: "c1" } }),
      d("overlap", "warning", { fix: { kind: "open_engineering_item", target: "L1" } }),
      d("preview-only", "info"),
    ])} />);
    expect(html.indexOf('data-severity="error"')).toBeLessThan(html.indexOf('data-severity="warning"'));
    expect(html).toContain('data-fix-kind="open_clip"');
    expect(html).toContain('data-fix-kind="open_engineering_item"');
    expect(html).toContain("Errors — block hardware output (1)");
    expect(html).toContain("@ 1.00s");
  });
});

describe("AF-NEXT-009 runtimeEventCompiler safety on the canonical frame", () => {
  const registry = {
    F1: { deviceId: "F1", deviceType: "flame" },
    P1: { deviceId: "P1", deviceType: "pump" },
    V1: { deviceId: "V1", deviceType: "valve", pumpId: "P1" },
  };
  const clip = (id, fixtureId, type, startTime, duration, value = 100) => ({ id, trackId: fixtureId, fixtureId, type, startTime, duration, value });

  it("tracks continuous flame on-time across back-to-back clips", () => {
    const { errors } = compileShow({ timelineClips: [clip("a", "F1", "device_intensity", 0, 6), clip("b", "F1", "device_intensity", 6, 6)],
      deviceRegistry: registry, options: { ignoreSafetyErrors: true } });
    expect(errors.some(e => /SAFETY: Device F1 fire continuously on 12000ms/.test(e))).toBe(true);
  });

  it("warns about a valve open while its pump is stopped and a pump dead-heading", () => {
    const { warnings } = compileShow({ timelineClips: [clip("v", "V1", "solenoid_open", 0, 2), clip("p", "P1", "pump_speed", 3, 2, 40)],
      deviceRegistry: registry });
    expect(warnings.some(w => /Valve V1 is open at 0.00s while pump P1 is stopped/.test(w))).toBe(true);
    expect(warnings.some(w => /Pump P1 runs at 3.00s with every linked valve closed/.test(w))).toBe(true);
  });
});
