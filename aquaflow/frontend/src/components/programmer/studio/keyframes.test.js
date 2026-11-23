import { describe, expect, it } from 'vitest';
import { DEFAULT_ENVELOPE, clipLocalTime, keyIndexAt, toggleEnvelopeKey } from './keyframes';

describe('level envelope keyframes', () => {
  it('maps the playhead into the clip and rejects times outside it', () => {
    expect(clipLocalTime({ start: 10, duration: 4 }, 11)).toBe(.25);
    expect(clipLocalTime({ start: 10, duration: 4 }, 9)).toBeNull();
    expect(clipLocalTime({ start: 10, duration: 4 }, 15)).toBeNull();
    expect(clipLocalTime({ start: 0, duration: 0 }, 0)).toBeNull();
  });

  it('adds a key that holds the current curve value, keeping keys sorted', () => {
    const next = toggleEnvelopeKey(DEFAULT_ENVELOPE, .25);
    expect(next.map(k => k.time)).toEqual([0, .25, .5, 1]);
    expect(next[1].value).toBe(.5); // halfway up the 0→1 ramp: the shape does not change
    expect(DEFAULT_ENVELOPE).toHaveLength(3); // input untouched
  });

  it('removes an inner key on a second click but never the end keys', () => {
    const added = toggleEnvelopeKey(DEFAULT_ENVELOPE, .25);
    expect(toggleEnvelopeKey(added, .251).map(k => k.time)).toEqual([0, .5, 1]);
    expect(toggleEnvelopeKey(added, 0)).toHaveLength(4);
    expect(toggleEnvelopeKey(added, 1)).toHaveLength(4);
    expect(keyIndexAt(added, .5)).toBe(2);
  });

  it('starts from the default curve when the recipe has no envelope yet', () => {
    expect(toggleEnvelopeKey(undefined, .75).map(k => k.time)).toEqual([0, .5, .75, 1]);
  });
});
