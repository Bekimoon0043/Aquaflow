// @vitest-environment jsdom
// The Laser and Fireworks tools work like the Nozzle tool: their own catalogue in the sidebar,
// click placement (also on land outside the basin), arrays and their own layers.
// Default pool: 12 m × 8 m at (0,0)-(12,8); view pan (60,60), zoom 30 px/m.
import { describe, it, expect, afterEach } from "vitest";
import { mountDesigner, cleanup, wait, act, fireEvent } from "./designerHarness";

afterEach(() => cleanup());

const listed = (d) => [...d.container.querySelectorAll("button[aria-pressed]")].map((b) => b.textContent);

describe("Laser and Fireworks designer tools", () => {
  it("Laser tool: laser catalogue only, places in the pool and on land outside it", async () => {
    const d = await mountDesigner();
    await d.tool("Laser");
    await wait(60);
    expect(d.container.textContent).toContain("LASER CATALOGUE");
    expect(d.container.textContent).toContain("SKY / SEARCHLIGHT LASERS");
    const items = listed(d);
    expect(items.some((t) => /Water-screen graphics laser/.test(t))).toBe(true);
    expect(items.some((t) => /shell|Geyser|RGB Light/i.test(t))).toBe(false);
    await d.tap(6, 4);   // in the pool
    await d.tap(16, 4);  // on land beside it
    await wait(120);
    const placed = d.fixtures().filter((f) => String(f.type).startsWith("laser_"));
    expect(placed).toHaveLength(2);
    expect(placed[1].x).toBeCloseTo(16, 6);
  });

  it("Fireworks tool: fireworks catalogue only, places behind the pool", async () => {
    const d = await mountDesigner();
    await d.tool("Fireworks");
    await wait(60);
    expect(d.container.textContent).toContain("FIREWORKS CATALOGUE");
    expect(listed(d).every((t) => !/laser/i.test(t))).toBe(true);
    await d.tap(6, -6);
    await wait(120);
    expect(d.fixtures().filter((f) => String(f.type).startsWith("pyro_"))).toHaveLength(1);
  });

  it("Equipment no longer lists lasers or fireworks; Light lists no lasers", async () => {
    const d = await mountDesigner();
    await d.tool("Equipment");
    await wait(60);
    expect(listed(d).some((t) => /laser|shell|cake/i.test(t))).toBe(false);
    await d.tool("Light");
    await wait(60);
    expect(listed(d).some((t) => /laser/i.test(t))).toBe(false);
  });

  it("arrays work with the Laser tool", async () => {
    const d = await mountDesigner();
    await d.tool("Laser");
    await wait(60);
    const count = d.container.querySelector('input[aria-label="Array count"]');
    await act(async () => { fireEvent.change(count, { target: { value: "4" } }); });
    await d.click("APPLY ARRAY");
    await wait(120);
    expect(d.fixtures().filter((f) => String(f.type).startsWith("laser_"))).toHaveLength(4);
  });
});
