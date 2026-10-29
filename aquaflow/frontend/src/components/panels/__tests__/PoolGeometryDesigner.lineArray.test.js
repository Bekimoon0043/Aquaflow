// @vitest-environment jsdom
// Array along any line: guide lines drawn with the shape engine, pipes and outlines.
// Default view: pan (60,60), zoom 30 px/m; default pool: 12 m × 8 m at (0,0)-(12,8).
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, mountDesigner, wait } from "./designerHarness";
import useProjectStore from "../../../store/projectStore";

// The command line only listens while the designer is the panel on screen.
const mount = async () => { useProjectStore.getState().setActivePanel("geometry"); return mountDesigner(); };

afterEach(() => cleanup());

const setField = (d, label, value) => act(() => {
  const el = d.container.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`field not found: ${label}`);
  fireEvent.change(el, { target: { value: String(value) } });
});
const typeKeys = async (d, keys) => { for (const k of keys) await d.key(k); };

describe("array along any line", () => {
  it("draws a guide line with L, 10 Enter, Enter and puts 5 nozzles on it", async () => {
    const d = await mount();
    await d.tool("Nozzle");
    await setField(d, "Array type", "pipe");
    await typeKeys(d, ["L", "Enter"]);
    await d.move(1, 4);
    await d.tap(1, 4);
    await d.move(6, 4);
    await typeKeys(d, ["1", "0", "Enter", "Enter"]);
    await d.settle();
    expect(d.store.getState().guidePaths).toHaveLength(1);
    const guide = d.store.getState().guidePaths[0];
    expect(guide.closed).toBe(false);
    expect(guide.points.at(-1)).toMatchObject({ x: 11, y: 4 });
    // The new guide line is chosen automatically and the nozzle tool is still active.
    expect(d.container.querySelector('[aria-label="Array line"]').value).toBe(guide.id);
    await setField(d, "Array count", 5);
    await setField(d, "Gap at pipe ends (m)", 0);
    await d.click("APPLY ARRAY ON LINE");
    await d.settle();
    const made = d.fixtures();
    expect(made).toHaveLength(5);
    expect(made.map((f) => f.x)).toEqual([1, 3.5, 6, 8.5, 11]);
    expect(made.every((f) => f.y === 4 && f.arraySourceId === guide.id)).toBe(true);
  });

  it("follows the pool's own outline all the way round", async () => {
    const d = await mount();
    await d.tool("Light");
    await setField(d, "Array type", "pipe");
    const select = d.container.querySelector('[aria-label="Array line"]');
    const basinOpt = [...select.options].find((o) => /outline/.test(o.textContent));
    await setField(d, "Array line", basinOpt.value);
    await setField(d, "Array count", 20);
    await d.click("APPLY ARRAY ON LINE");
    await d.settle();
    const made = d.fixtures();
    expect(made).toHaveLength(20);
    // 12 × 8 pool, perimeter 40 m → every 2 m, all on the edge.
    for (const f of made) {
      const onEdge = [f.x, 12 - f.x, f.y, 8 - f.y].some((v) => Math.abs(v) < 1e-6);
      expect(onEdge).toBe(true);
    }
  });

  it("a guide line can be selected on the canvas and deleted", async () => {
    const d = await mount();
    await d.tool("Nozzle");
    await setField(d, "Array type", "pipe");
    await act(() => { fireEvent.click(d.container.querySelector('[aria-label="Draw guide pline"]')); });
    await d.tap(2, 2);
    await d.tap(8, 2);
    await d.key("Enter");
    await d.settle();
    expect(d.store.getState().guidePaths).toHaveLength(1);
    await d.tool("Select");
    await d.tap(5, 2.05);
    await d.key("Delete");
    await d.settle();
    expect(d.store.getState().guidePaths).toHaveLength(0);
    await d.key("z", { ctrlKey: true });
    await wait(150);
    await d.settle();
    expect(d.store.getState().guidePaths).toHaveLength(1);
  });
});
