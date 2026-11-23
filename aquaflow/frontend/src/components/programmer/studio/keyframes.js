// Keyframe diamonds for a pattern's level envelope (recipe.envelope, used by the Curve effect).
// Times are normalised to the clip (0 = start, 1 = end), the same space EnvelopeEditor edits.
import { envelopeValue } from './showModel';

export const DEFAULT_ENVELOPE = [{ time: 0, value: 0 }, { time: .5, value: 1 }, { time: 1, value: 0 }];
const NEAR = 0.01;

/** Playhead position inside the clip as 0..1, or null when the playhead is outside it. */
export function clipLocalTime(recipe, time) {
  const duration = Number(recipe?.duration) || 0;
  if (duration <= 0) return null;
  const u = (time - (Number(recipe.start) || 0)) / duration;
  return u < 0 || u > 1 ? null : Math.round(u * 1000) / 1000;
}

/** Index of the key at local time u (within ±1 %), or -1. */
export function keyIndexAt(envelope, u) {
  return (envelope || DEFAULT_ENVELOPE).findIndex(k => Math.abs(k.time - u) <= NEAR);
}

/**
 * Toggle a key at local time u. Adding holds the curve's current value there, so the shape does
 * not jump; removing deletes an inner key (the first and last keys always stay).
 */
export function toggleEnvelopeKey(envelope, u) {
  const keys = (envelope && envelope.length >= 2 ? envelope : DEFAULT_ENVELOPE).map(k => ({ ...k }));
  const at = keyIndexAt(keys, u);
  if (at >= 0) return at === 0 || at === keys.length - 1 ? keys : keys.filter((_, i) => i !== at);
  const value = Math.round(envelopeValue(keys, u) * 1000) / 1000;
  return [...keys, { time: u, value }].sort((a, b) => a.time - b.time);
}
