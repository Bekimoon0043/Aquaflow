// @vitest-environment jsdom
/**
 * AF-NEXT-009 ↔ designer: a preflight "fix" selects the responsible engineering item and
 * centres the view on it — live (window event) or after mounting (pending focus).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mountDesigner, cleanup, act, wait } from "./designerHarness";
import { openDiagnosticFix } from "../../../preflight/preflight";

afterEach(() => cleanup());

const PROJECT = {
  params: { width: 20, length: 8, radius: 6, depth: 0.8 },
  fixtures: [
    { id: "N-A", type: "nozzle_geyser", label: "Nozzle A", x: 2, y: 2 },
    { id: "N-B", type: "nozzle_geyser", label: "Nozzle B", x: 14.5, y: 6 },
  ],
  manualPipes: [{ id: "P-1", type: "manual_pipe", points: [{ x: 0, y: 0 }, { x: 4, y: 0 }], diameterMm: 50 }],
};
const readout = (d) => d.container.textContent.match(/SELECTED ([^\n]*)$/)?.[1] || "";
const fire = (target) => act(() => { window.dispatchEvent(new CustomEvent("aquaflow:select-engineering-item", { detail: { target } })); });

describe("preflight → designer focus (aquaflow:select-engineering-item)", () => {
  it("selects a fixture by id and centres the view on it", async () => {
    const d = await mountDesigner({ project: PROJECT });
    await fire("N-B");
    await wait(20);
    expect(readout(d)).toContain("Nozzle B");
    expect(d.container.textContent).toContain("Delete fixture");
    // Centred: the fixture is now at the canvas centre (jsdom canvas falls back to 320×240).
    const canvas = d.canvas;
    await act(async () => { canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 160, clientY: 120 })); });
    expect(d.container.textContent).toMatch(/X 14\.500 m\s+Y 6\.000 m/);
  });

  it("selects a pipe and a basin by id (detail.id form is accepted too)", async () => {
    const d = await mountDesigner({ project: PROJECT });
    await fire("P-1");
    await wait(20);
    expect(d.container.textContent).toContain("DN50");
    await wait(150);
    const basinId = d.store.getState().basins[0]?.id;
    expect(basinId).toBeTruthy();
    await act(() => { window.dispatchEvent(new CustomEvent("aquaflow:select-engineering-item", { detail: { id: basinId } })); });
    await wait(20);
    expect(readout(d)).toContain("POOL");
  });

  it("a fix issued before the designer mounts is picked up from the pending focus", async () => {
    openDiagnosticFix({ fix: { kind: "open_engineering_item", target: "N-A" } }, { dispatch: () => {} });
    const d = await mountDesigner({ project: PROJECT });
    await wait(30);
    expect(readout(d)).toContain("Nozzle A");
  });
});
