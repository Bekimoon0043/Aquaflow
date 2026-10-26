import { describe, it, expect } from "vitest";
import { normalizeCameraViews, resolveCameraView } from "../cameraViews";

const view = (extra = {}) => ({ id: "eye", name: "Eye", position: { x: 0, y: 1.6, z: 18 }, target: { x: 0, y: 3, z: 0 }, ...extra });

describe("saved camera views — lens angle", () => {
  it("keeps a valid lens angle and clamps it to 8–90°", () => {
    expect(normalizeCameraViews([view({ fov: 26 })])[0].fov).toBe(26);
    expect(normalizeCameraViews([view({ fov: 2 })])[0].fov).toBe(8);
    expect(normalizeCameraViews([view({ fov: 140 })])[0].fov).toBe(90);
  });
  it("leaves views without a lens angle unchanged", () => {
    expect(normalizeCameraViews([view()])[0]).not.toHaveProperty("fov");
    expect(normalizeCameraViews([view({ fov: "wide" })])[0]).not.toHaveProperty("fov");
    expect(resolveCameraView({ cameraViews: [view({ fov: 30 })], activeCameraView: "eye" }).fov).toBe(30);
  });
});
