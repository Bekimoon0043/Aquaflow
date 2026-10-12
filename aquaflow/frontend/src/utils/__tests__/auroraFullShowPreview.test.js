import { describe, expect, it } from "vitest";
import { createAuroraDemoProject } from "../../data/auroraDemoProject";
import { fixturesToNozzleConfigs } from "../../hooks/fixtureTypeMap";
import { poolCenter, centerToWorld } from "../../engineering/geometryContract";
import { generateAutoTracks } from "../../runtime/autoTrackGenerator";
import { describeNozzleEmitters } from "../../components/preview/nozzleEmitters";
import { createAuroraDemoShow } from "../auroraDemoShow";
import { createFullShowPreview } from "../fullShowPreview";
import { createICANPreviewPlan, evaluateICANPreview } from "../icanPatternPreview";

const project = createAuroraDemoProject();
const show = createAuroraDemoShow(project);
const plan = createICANPreviewPlan(createFullShowPreview(show.clips, project.fixtures, "Aurora Theatre"));
const frame = time => evaluateICANPreview(plan, time, project.fixtures);

describe("Aurora full fountain design preview", () => {
  it("connects every show clip to an engineering fixture and a Show Programmer track", () => {
    const ids = new Set(project.fixtures.map(fixture => fixture.id));
    const trackIds = new Set(generateAutoTracks({ fixtures: project.fixtures }).tracks.map(track => track.id));
    expect([...new Set(show.clips.filter(clip => !ids.has(clip.fixtureId) || !trackIds.has(clip.trackId)).map(clip => `${clip.type}:${clip.trackId}`))]).toEqual([]);
    const render = fixturesToNozzleConfigs(project.fixtures);
    expect(render.nozzleConfigs).toHaveLength(56);
    expect(render.lightConfigs).toHaveLength(24);
    const center = poolCenter(project.geometry, project.params, project.pool_type);
    expect(center).toEqual({ cx: 10, cy: 10 });
    expect([...render.nozzleConfigs, ...render.lightConfigs].every(fixture => {
      const position = centerToWorld(fixture, center);
      return Math.hypot(position.x, position.z) < project.geometry.radius;
    })).toBe(true);
    expect(plan.duration).toBeCloseTo(22.7, 1);
  });

  it("shows the water chase, independent RGB lighting, and commanded moving jets", () => {
    const orbit = frame(0.6);
    expect(orbit.active).toBeGreaterThan(0);
    expect(orbit.lightsActive).toBeGreaterThan(0);
    expect(orbit.fixtureIntensities["aurora-outer-01"]).toBeGreaterThan(0);
    expect(orbit.fixtureIntensities["aurora-outer-20"]).toBe(0);

    const cross = frame(8.5);
    expect(cross.fixtureIntensities["aurora-motion-01"]).toBeGreaterThan(0);
    expect(cross.fixtureMotion["aurora-motion-01"].pan).not.toBe(0);
    expect(cross.fixtureLightStates["aurora-inner-light-01"].intensity).toBeGreaterThan(0);
    expect(frame(9.5).fixtureMotion["aurora-motion-01"].pan).not.toBe(cross.fixtureMotion["aurora-motion-01"].pan);

    const finale = frame(18);
    expect(finale.active).toBe(56);
    expect(finale.lightsActive).toBe(24);
    expect(frame(23).active).toBe(0);
    expect(frame(23).lightsActive).toBe(0);
  });

  it("sends commanded motion angles to the particle emitter rather than its idle sweep", () => {
    const left = describeNozzleEmitters({ type: "motion_2d", x: 0, z: 0, motionOverride: { pan: -30, tilt: 12 } }, 0.8, 8, { x: 0, z: 0 });
    const right = describeNozzleEmitters({ type: "motion_2d", x: 0, z: 0, motionOverride: { pan: 30, tilt: -12 } }, 0.8, 8, { x: 0, z: 0 });
    expect(left[0].dx).toBeLessThan(0);
    expect(right[0].dx).toBeGreaterThan(0);
    expect(left[0].dz).toBeGreaterThan(0);
    expect(right[0].dz).toBeLessThan(0);
  });

  it("keeps the preview blank when stopped and rejects missing fixtures", () => {
    const stopped = evaluateICANPreview(plan, 18, project.fixtures, true);
    expect(stopped.active).toBe(0);
    expect(stopped.lightsActive).toBe(0);
    expect(() => createFullShowPreview([{ ...show.clips[0], fixtureId: "missing" }], project.fixtures)).toThrow(/fixture is missing/);
  });
});
