// bakeSignalSampler.js - show state at an exact virtual time (AF-3D-VID-001)
//
// The live preview derives signals from a wall-clock playhead that React updates
// every ~50 ms. A baked render needs the state at precise sub-frame times instead,
// so this builds a pure (t) => signals function from the same selectors the
// preview uses. Sources mirror PreviewPanel: site design preview > timeline.

import { deriveRuntimeSignals } from "../utils/runtimeSignalSelector";
import { evaluateICANPreview } from "../utils/icanPatternPreview";

/**
 * @param {object} ctx
 * @param {object|null} ctx.sitePreview  { active, plan } from icanPreviewStore
 * @param {Array}  ctx.fixtures          engineering fixtures
 * @param {object} ctx.timeline          deriveRuntimeSignals inputs (minus playhead)
 * @param {Function} [ctx.evaluateSite]  injectable for tests
 * @param {Function} [ctx.deriveTimeline] injectable for tests
 */
export function createBakeSampler({
  sitePreview = null, fixtures = [], timeline = {},
  timelinePreviewPlan = null,
  evaluateSite = evaluateICANPreview, deriveTimeline = deriveRuntimeSignals,
} = {}) {
  if (sitePreview?.active && sitePreview.plan) {
    const plan = sitePreview.plan;
    return {
      source: "site-preview",
      defaultDurationS: Number(plan.duration) || 10,
      sample: (t) => {
        const s = evaluateSite(plan, Math.min(t, plan.duration), fixtures, false) || {};
        return {
          ...s,
          fixtureIntensities: s.fixtureIntensities || null,
          fixtureLightStates: s.fixtureLightStates || null,
          fixtureMotion: s.fixtureMotion || null,
        };
      },
    };
  }
  if (timelinePreviewPlan) {
    const plan = timelinePreviewPlan;
    return {
      source: "full-show-timeline",
      defaultDurationS: Number(plan.duration) || Number(timeline.showDuration) || 0,
      sample: (t) => {
        const s = evaluateSite(plan, Math.min(t, plan.duration), fixtures, false) || {};
        return {
          ...s,
          fixtureIntensities: s.fixtureIntensities || null,
          fixtureLightStates: s.fixtureLightStates || null,
          fixtureMotion: s.fixtureMotion || null,
        };
      },
    };
  }
  return {
    source: "timeline",
    defaultDurationS: Number(timeline.showDuration) || 0,
    sample: (t) => ({
      ...deriveTimeline({ ...timeline, playhead: t, playbackState: "playing" }),
      fixtureIntensities: null, fixtureLightStates: null, fixtureMotion: null,
    }),
  };
}
