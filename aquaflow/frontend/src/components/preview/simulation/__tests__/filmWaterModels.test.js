import { describe, expect, it } from "vitest";
import { describeRadialFilm, describeFallingWater, sampleRadialFilm, sampleFallingWater } from "../filmWaterModels.js";
import { filmKindFor, isFilmNozzle } from "../../filmWaterLayer.js";

describe("thin film and falling water", () => {
  it("builds a radial bell that expands and breaks up deterministically", () => {
    const film = describeRadialFilm("bell", { intensity: 1 });
    const start = sampleRadialFilm(film, 0);
    const early = sampleRadialFilm(film, 0.2);
    const late = sampleRadialFilm(film, 2);
    expect(film.model).toBe("thin-radial-film");
    expect(early.radiusM).toBeGreaterThan(start.radiusM);
    expect(late.breakup).toBeGreaterThan(early.breakup);
    expect(late.thicknessM).toBeGreaterThan(0);
    expect(sampleRadialFilm(film, 2)).toEqual(late);
  });

  it("scales launch speed and thickness with demand", () => {
    const low = describeRadialFilm("mushroom", { intensity: 0.25 });
    const full = describeRadialFilm("mushroom", { intensity: 1 });
    expect(low.trajectory.radialSpeedMs).toBeCloseTo(full.trajectory.radialSpeedMs * 0.5, 8);
    expect(low.thickness.startM).toBeLessThan(full.thickness.startM);
  });

  it("supports spherical stream distributions", () => {
    const film = describeRadialFilm("dandelion");
    const top = sampleRadialFilm(film, 0.3, 0, 0);
    const rim = sampleRadialFilm(film, 0.3, 0, 1);
    expect(top.position).not.toEqual(rim.position);
    expect(film.type).toBe("dandelion");
  });

  it("keeps waterwall flow attached before detaching under gravity", () => {
    const wall = describeFallingWater("waterwall");
    const attached = sampleFallingWater(wall, 0.1);
    const detached = sampleFallingWater(wall, 10);
    expect(attached.attached).toBe(true);
    expect(detached.attached).toBe(false);
    expect(detached.position[1]).toBeLessThan(attached.position[1]);
  });

  it("models stepped falls and per-step breakup", () => {
    const fall = describeFallingWater("stepped_fall");
    const sample = sampleFallingWater(fall, 20);
    expect(fall.steps.length).toBeGreaterThan(1);
    expect(sample.stepIndex).toBeGreaterThan(0);
    expect(sample.breakup).toBeGreaterThan(0);
  });

  it("uses a line source for cascade and weir descriptors", () => {
    for (const type of ["cascade", "weir"]) {
      const fall = describeFallingWater(type, { widthM: 3 });
      const left = sampleFallingWater(fall, 0.2, 0);
      const right = sampleFallingWater(fall, 0.2, 1);
      expect(left.position).not.toEqual(right.position);
      expect(fall.model).toBe("line-source-falling-water");
    }
  });

  it("selects dedicated film geometry only for matching fixture families", () => {
    expect(filmKindFor({ fixtureType: "nozzle_mushroom_g2_saferain" })).toBe("mushroom");
    expect(filmKindFor({ fixtureType: "nozzle_cascade_curtain" })).toBe("cascade");
    expect(filmKindFor({ fixtureType: "nozzle_straight_dn25" })).toBeNull();
    expect(isFilmNozzle({ fixtureType: "nozzle_mushroom_g2_saferain" })).toBe(true);
  });
});
