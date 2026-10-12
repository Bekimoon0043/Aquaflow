import { AURORA_DEMO_ID } from "../data/auroraDemoProject";
import { getEquipmentCategory } from "../runtime/autoTrackGenerator";

/** Editable Show Programmer clips for the separate Aurora demonstration project. */
export function createAuroraDemoShow(project) {
  if (project?.id !== AURORA_DEMO_ID) throw new Error("Load the Aurora demo engineering project first.");
  const fixtures = project.fixtures || [];
  const zone = name => fixtures.filter(fixture => fixture.engineering?.demoZone === name);
  const clips = [];
  const add = (fixture, channel, type, startTime, duration, value, extra = {}) => {
    const fade = Math.min(0.18, duration / 4);
    clips.push({
      id: `aurora-clip-${clips.length + 1}`,
      trackId: `${fixture.id}-${channel}`,
      fixtureId: fixture.id,
      name: `${fixture.label} · ${channel}`,
      type,
      startTime: Number(startTime.toFixed(3)),
      duration: Number(duration.toFixed(3)),
      value,
      color: extra.color || "#76d7ff",
      fadeIn: fade,
      fadeOut: fade,
      curveType: "linear",
      parameter: "intensity",
      source: "aurora-demo",
      effects: [{ type: "basic", startTime: 0, duration, params: { value } }],
      ...extra,
    });
  };
  const water = (fixturesToUse, start, duration, value) => fixturesToUse.forEach(f => {
    const category = getEquipmentCategory(f.type);
    const channel = category === "pump" ? "speed" : "intensity";
    const type = category === "pump" ? "pump_speed" : category === "motion_2d" ? "motion_intensity" : "device_intensity";
    add(f, channel, type, start, duration, value);
  });
  const lights = (fixturesToUse, start, duration, value, color) => fixturesToUse.forEach(f => add(f, "master", "lighting_master", start, duration, value, { color }));
  const outer = zone("outer"), inner = zone("inner"), arches = zone("arch"), fans = zone("fan"), motion = zone("motion");
  const outerLights = zone("outer-light"), innerLights = zone("inner-light");
  if ([outer.length, inner.length, arches.length, fans.length, motion.length, outerLights.length, innerLights.length]
    .some((count, index) => count !== [24, 12, 8, 8, 4, 16, 8][index])) {
    throw new Error("The Aurora fixture layout has changed. Reload the demo project to regenerate this show.");
  }

  // A bright orbit: four jets and adjacent RGB lamps advance around the rim.
  for (let step = 0; step < 6; step += 1) {
    const start = 0.3 + step * 0.58;
    water(outer.slice(step * 4, step * 4 + 4), start, 0.54, 80);
    lights(outerLights.slice(step * 2, step * 2 + 4), start, 0.54, 90, step % 2 ? "#10d9ff" : "#265cff");
  }

  // Center builds outward, followed by alternating arch pairs.
  for (let step = 0; step < 4; step += 1) {
    const start = 4.2 + step * 0.7;
    water(inner.slice(step * 3, step * 3 + 3), start, 0.62, 85);
    water(arches.filter((_, index) => index % 4 === step), start + 0.15, 0.48, 70);
    lights(innerLights.slice(step * 2, step * 2 + 2), start, 0.65, 90, "#a340ff");
  }

  // Moving jets cross over the central fans. Pan and tilt are visible in 3D.
  for (let step = 0; step < 4; step += 1) {
    const start = 7.3 + step * 0.95;
    water(fans.filter((_, index) => index % 4 === step), start, 0.84, 85);
    motion.forEach((f, index) => add(f, "intensity", "motion_intensity", start, 0.84, 92, {
      pan: [-30, -12, 12, 30][(step + index) % 4],
      tilt: [10, 22, -22, -10][(step + index) % 4],
    }));
    lights(innerLights, start, 0.84, 78, step % 2 ? "#ff398e" : "#00f0c8");
  }

  // A return wave with warm light moving opposite the water.
  for (let step = 0; step < 6; step += 1) {
    const start = 11.4 + step * 0.52;
    water(outer.slice((5 - step) * 4, (6 - step) * 4), start, 0.48, 95);
    lights(outerLights.slice((step * 2) % 16, ((step * 2) % 16) + 4), start, 0.48, 95, "#ff8a24");
  }

  // Full water and three deliberate lighting looks, then a clean blackout.
  water([...outer, ...inner, ...arches, ...fans, ...motion], 15, 5.2, 75);
  ["#00cfff", "#a244ff", "#ffcc36"].forEach((color, step) => {
    lights([...outerLights, ...innerLights], 15 + step * 1.7, 1.65, 100, color);
  });
  water([...inner, ...motion], 20.5, 2.2, 62);
  lights([...outerLights, ...innerLights], 20.5, 2.2, 55, "#3568ff");
  zone("pump").forEach((pump, index) => add(pump, "speed", "pump_speed", index * 1.1, 21.8 - index * 1.1, 70));

  return { clips: clips.sort((a, b) => a.startTime - b.startTime), duration: 22.7 };
}
