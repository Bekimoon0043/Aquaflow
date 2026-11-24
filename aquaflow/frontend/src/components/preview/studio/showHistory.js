// Show history for the Studio renderer: every fixture's level, pan/tilt/roll pose and light colour,
// sampled from the show frame (evaluateShowFrameAt) at a fixed rate and cached in a sliding
// window. The Studio renderer launches each water drop with the level and swing the nozzle had
// at the moment the drop left it, so it needs the recent past, not just "now".
//
// Deterministic: a value at time τ depends only on the show, never on the frame rate, so a
// baked video frame is the same however it is reached.

import { evaluateShowFrameAt } from "../../../show/evaluateShowFrame";

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));

/**
 * @param {{ fixtures: object[], clips: object[] }} project  show-frame project (clips with start/end)
 * @param {{ rate?: number, keepS?: number }} opts
 */
export function createShowHistory(project, { rate = 20, keepS = 12 } = {}) {
  const fixtures = project?.fixtures || [];
  const index = new Map(fixtures.map((f, i) => [f.id, i]));
  const n = fixtures.length;
  const samples = new Map();                 // sample index → { level, pan, tilt, color }
  let evaluations = 0;

  const sampleAt = (k) => {
    if (k < 0) k = 0;
    let s = samples.get(k);
    if (s) return s;
    const frame = evaluateShowFrameAt(project, k / rate);
    evaluations++;
    s = { level: new Float32Array(n), pan: new Float32Array(n), tilt: new Float32Array(n), roll: new Float32Array(n), fan: new Float32Array(n).fill(90), color: new Array(n).fill(null) };
    for (const [id, rec] of Object.entries(frame.fixtures || {})) {
      const i = index.get(id);
      if (i === undefined) continue;
      s.level[i] = clamp01(rec.level);
      if (rec.motion) {
        s.pan[i] = Number(rec.motion.pan) || 0; s.tilt[i] = Number(rec.motion.tilt) || 0; s.roll[i] = Number(rec.motion.roll) || 0;
        if (Number.isFinite(rec.motion.fan)) s.fan[i] = rec.motion.fan;
      }
      if (rec.color?.hex) s.color[i] = rec.color.hex;
    }
    samples.set(k, s);
    return s;
  };
  const lerpOf = (field) => (id, tau) => {
    const i = index.get(id);
    if (i === undefined) return 0;
    const x = Math.max(0, tau) * rate, k = Math.floor(x), u = x - k;
    const a = sampleAt(k)[field][i], b = sampleAt(k + 1)[field][i];
    return a + (b - a) * u;
  };

  return {
    rate,
    /** Level 0..1 of a fixture at show time τ. */
    level: lerpOf("level"),
    /** Swing pose (degrees) of a moving nozzle at τ. */
    pan: lerpOf("pan"),
    tilt: lerpOf("tilt"),
    roll: lerpOf("roll"),
    fan: lerpOf("fan"),
    /** Light colour (hex) at τ, or null. */
    color(id, tau) {
      const i = index.get(id);
      return i === undefined ? null : sampleAt(Math.round(Math.max(0, tau) * rate)).color[i];
    },
    /** Drop samples older than keepS before t (playback moves forward; a seek just re-samples). */
    prune(t) {
      const oldest = Math.floor((t - keepS) * rate), newest = Math.ceil((t + 2) * rate);
      for (const k of samples.keys()) if (k < oldest || k > newest + rate * 30) samples.delete(k);
    },
    stats: () => ({ samples: samples.size, evaluations }),
  };
}
