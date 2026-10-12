import { createArrayPatternPlan, getArrayTargetFixtures } from "./arrayPatternEngine";
import { createSiteWaterTrack } from "./siteShowCompiler";

/** A visual example for the 4KILO layout. It never assigns pump or I-CAN commands. */
export function createFourKiloDemoShow(fixtures = []) {
  const counts = Object.fromEntries(
    ["running", "foam_all", "peacock"].map(target => [target, getArrayTargetFixtures(fixtures, target).length]),
  );
  if (counts.running !== 76 || counts.foam_all !== 16 || counts.peacock !== 8
    || getArrayTargetFixtures(fixtures, "foam_left").length !== 8
    || getArrayTargetFixtures(fixtures, "foam_right").length !== 8) {
    throw new Error("Load the 4KILO engineering layout (76 running, 16 foam, 8 peacock outlets) before creating this example.");
  }

  const tracks = fixtures.map(createSiteWaterTrack).filter(Boolean);
  const sections = [
    { target: "running", patternId: "section_chase", startTime: 0, stepDuration: 0.22, pulseDuration: 0.19, intensity: 80 },
    { target: "running", patternId: "alternating_sections", startTime: 4.4, stepDuration: 0.8, pulseDuration: 0.66, intensity: 85 },
    { target: "running", patternId: "mirrored_blocks", startTime: 6.2, stepDuration: 0.5, pulseDuration: 0.44, blockSize: 8, intensity: 90 },
    { target: "foam_left", patternId: "all_pulse", startTime: 9, pulseDuration: 0.9, intensity: 65 },
    { target: "foam_right", patternId: "all_pulse", startTime: 10, pulseDuration: 0.9, intensity: 65 },
    { target: "peacock", patternId: "all_pulse", startTime: 11, pulseDuration: 1, intensity: 70 },
    { target: "running", patternId: "all_pulse", startTime: 12.5, pulseDuration: 1.3, intensity: 80 },
    { target: "foam_all", patternId: "all_pulse", startTime: 12.5, pulseDuration: 1.3, intensity: 65 },
    { target: "peacock", patternId: "all_pulse", startTime: 12.5, pulseDuration: 1.3, intensity: 70 },
  ];
  const clips = sections.flatMap((section, sectionIndex) => {
    const plan = createArrayPatternPlan({ fixtures, tracks, ...section });
    if (plan.missingTrackFixtureIds.length) throw new Error("Some 4KILO outlets have no show track.");
    return plan.clips.map(clip => ({ ...clip, id: `4kilo-demo-${sectionIndex}-${clip.id}` }));
  });
  return { clips, duration: 13.8, counts };
}
