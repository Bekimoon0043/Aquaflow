import { describe, expect, it } from "vitest";
import { WaterHeightField } from "../waterHeightField";

describe("WaterHeightField", () => {
  it("turns a real impact into a propagating, coupled wave", () => {
    const field = new WaterHeightField({ extent: 12, resolution: 48, damping: 0.99 });
    field.setPool({ type: "rect", width: 10, length: 8 });
    expect(field.disturb(0, 0, 0.06, 0.3)).toBe(true);
    const initial = field.energy();
    for (let i = 0; i < 20; i++) field.advance(1 / 60);
    expect(initial).toBeGreaterThan(0);
    expect(Math.abs(field.sample(0.7, 0))).toBeGreaterThan(0.00001);
  });

  it("masks cells outside a circular basin", () => {
    const field = new WaterHeightField({ extent: 12, resolution: 48 });
    field.setPool({ type: "circular", radius: 3 });
    expect(field.disturb(5, 0, 0.05)).toBe(false);
    expect(field.disturb(0, 0, 0.05)).toBe(true);
  });

  it("damps wave energy and produces a shader-ready texture", () => {
    const field = new WaterHeightField({ extent: 10, resolution: 32, damping: 0.96 });
    field.setPool({ type: "rect", width: 8, length: 6 });
    field.disturb(0, 0, 0.08);
    for (let i = 0; i < 30; i++) field.advance(1 / 60);
    const activeEnergy = field.energy();
    for (let i = 0; i < 500; i++) field.advance(1 / 60);
    expect(field.energy()).toBeLessThan(activeEnergy);
    const pixels = field.writeRGBA(new Uint8Array(32 * 32 * 4));
    expect(pixels).toHaveLength(32 * 32 * 4);
    expect(Math.max(...pixels)).toBe(255);
  });
});
