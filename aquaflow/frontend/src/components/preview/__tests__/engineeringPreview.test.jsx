// @vitest-environment jsdom
// AF-NEXT-007 — creative vs engineering preview: the toggle, the jet cap/gate and the
// physics-status panel.
import { describe, expect, it } from "vitest";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HydraulicPreviewPanel, { fmtTime } from "../HydraulicPreviewPanel.jsx";
import { applyEngineeringJets, engineeringPhysicsRecord, PREVIEW_MODES } from "../engineeringJets.js";
import { engineeringGate, launchSpeed } from "../jetPhysics.js";
import { SPLASH_DEFAULTS, splashAssumptions } from "../../../engineering/splashEnvelope.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const baseProps = {
  status: { state: "ready" }, diagnostics: [], pumps: null, physics: { basis: "CALCULATED", solvedNozzles: 3, overDemand: [] },
  splashOn: false, setSplashOn: () => {}, gustFactor: 1.4, setGustFactor: () => {}, uncertainty: 0.1, setUncertainty: () => {},
  regions: [], assumptions: splashAssumptions(SPLASH_DEFAULTS), tMs: 0, show: { clips: [] }, timeline: null,
};

function Harness() {
  const [mode, setMode] = useState(PREVIEW_MODES.CREATIVE);
  return <HydraulicPreviewPanel {...baseProps} mode={mode} setMode={setMode} engineering={mode === PREVIEW_MODES.ENGINEERING} />;
}

describe("preview mode toggle", () => {
  it("switches between creative (instant response) and engineering preview", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Harness />));
    const [creative, engineering] = host.querySelectorAll('[role="radio"]');
    expect(creative.textContent).toBe("Creative (instant response)");
    expect(engineering.textContent).toBe("Engineering preview");
    expect(creative.getAttribute("aria-checked")).toBe("true");
    act(() => engineering.click());
    expect(engineering.getAttribute("aria-checked")).toBe("true");
    expect(host.textContent).toContain("pump curves, valve states, ramps and pipe fill");
    act(() => creative.click());
    expect(creative.getAttribute("aria-checked")).toBe("true");
    act(() => root.unmount());
  });

  it("shows named diagnostics with their timestamp and the physics status", () => {
    const html = renderToStaticMarkup(<HydraulicPreviewPanel {...baseProps} mode="engineering" setMode={() => {}} engineering
      timeline={{ converged: true }} tMs={5000}
      pumps={{ P1: { speedEff: 0.98, drive: "implicit", flowLpm: 410, headM: 9.1 } }}
      diagnostics={[{ code: "PUMP_OVERLOAD", severity: "error", timeMs: 1200, endMs: 9000, fixtureId: "P1", message: "Pump P1 overloaded" }]} />);
    expect(html).toContain("PUMP_OVERLOAD");
    expect(html).toContain(fmtTime(1200));
    expect(html).toContain("ENGINEERING TIMELINE");
    expect(html).toContain("solved nozzles 3");
    expect(html).toContain("410 L/min");
  });

  it("splash section shows the advisory label and the assumptions", () => {
    const html = renderToStaticMarkup(<HydraulicPreviewPanel {...baseProps} mode="creative" setMode={() => {}} engineering={false}
      splashOn regions={[{ id: "A", clipId: "c", outside: true, distanceOutsideM: 1.2, heightM: 8, basis: "nominal" }]} />);
    expect(html).toContain("Advisory — not field calibrated");
    expect(html).toContain("Gust factor");
    expect(html).toContain("Nozzle uncertainty");
    expect(html).toContain("1 jet(s) land outside the basin");
  });
});

describe("engineering jets", () => {
  it("caps the launch speed at the delivered height and removes starved jets", () => {
    const rec = engineeringPhysicsRecord({ exitVelocityMs: 20 }, { renderSpeedMs: 5, nominalRenderSpeedMs: 13.9, removed: false });
    expect(launchSpeed(rec, 1, 99)).toBe(5);                    // overloaded pump: lower jet
    expect(launchSpeed(rec, 0.04, 99)).toBeCloseTo(13.9 * 0.2); // below the cap: creative level shape kept
    expect(engineeringGate(rec)).toBe(1);
    const closed = engineeringPhysicsRecord(null, { renderSpeedMs: 9, removed: true });
    expect(launchSpeed(closed, 1, 7)).toBe(0);                  // closed upstream valve: no jet
    expect(engineeringGate(closed)).toBe(0);
    expect(engineeringPhysicsRecord(null, { passthrough: true })).toBeNull();
    expect(engineeringGate(null)).toBe(1);                      // creative: untouched
  });

  it("applies and restores records on the scene nozzles", () => {
    const set = {};
    const nz = id => ({ config: { id }, setPhysics: rec => { set[id] = rec; } });
    const scene = { nozzles: [nz("A"), nz("B")], _nozzlePhysics: { A: { exitVelocityMs: 12 } }, _overDemand: {} };
    const n = applyEngineeringJets(scene, { A: { renderSpeedMs: 4, nominalRenderSpeedMs: 13, removed: false }, B: { removed: true, renderSpeedMs: 0 } });
    expect(n).toBe(2);
    expect(set.A.engineeringCapMs).toBe(4);
    expect(set.B.engineeringGate).toBe(0);
    applyEngineeringJets(scene, null);                          // back to creative
    expect(set.A).toEqual({ exitVelocityMs: 12 });
    expect(set.B).toBeNull();
  });
});
