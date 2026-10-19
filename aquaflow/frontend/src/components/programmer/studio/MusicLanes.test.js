import { describe, it, expect } from 'vitest';
import { drawMusicLanes, musicLaneList, MUSIC_LANE_H } from './MusicLanes';
import { analyzeStem, drumTrack } from './stemAnalysis';
import { withStems } from './stemSync';
import { analyzeSamples, clickTrack } from './musicAnalysis';

const rate = 22050;
const drums = analyzeStem(drumTrack({ seconds: 8, rate, kicks: [1, 2, 3, 4, 5, 6], hats: [1.5, 2.5, 3.5] }), rate, 'drums');
const programmer = withStems(null, [{ id: 'd', role: 'drums', name: 'Drums.wav', analysis: drums }], { name: 'song', analysis: drums });

function fakeCtx() {
  const calls = { rects: [], text: [], lines: [], strokes: 0, fills: 0 };
  return { calls, globalAlpha: 1, lineWidth: 1, strokeStyle: '', font: '',
    clearRect() {}, fillRect(x, y, w, h) { calls.rects.push([x, y, w, h, this.fillStyle]); }, fillText(t) { calls.text.push(t); },
    beginPath() { calls.path = []; }, moveTo(x, y) { calls.path.push([x, y]); }, lineTo(x, y) { calls.path.push([x, y]); }, closePath() {},
    fill() { calls.fills++; }, stroke() { calls.strokes++; calls.lines.push(calls.path); },
    set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; } };
}

describe('music lanes', () => {
  it('lists the song line first, then each stem', () => {
    const lanes = musicLaneList(programmer);
    expect(lanes.map(l => l.label)).toEqual(['Song', 'Drums']);
  });

  it('draws one loudness line per lane that is high on hits and low between them', () => {
    const lanes = musicLaneList(programmer);
    const analysis = analyzeSamples(clickTrack({ bpm: 120, bars: 4, rate: 11025 }), 11025).analysis;
    const ctx = fakeCtx();
    drawMusicLanes(ctx, { lanes, analysis, width: 400, pps: 50, scrollLeft: 0 });
    expect(ctx.calls.strokes).toBe(2);
    expect(ctx.calls.fills).toBe(2);
    const drumsLine = ctx.calls.lines[1];
    const ys = drumsLine.map(([, y]) => y);
    // Lane 2 spans y 32…64: the line reaches near the top on kicks and the bottom between.
    expect(Math.min(...ys)).toBeLessThan(32 + 12);
    expect(Math.max(...ys)).toBeGreaterThan(64 - 6);
    // A kick at 1 s (x = 62) is higher than the gap at 0.75 s (x ≈ 49).
    const at = x => drumsLine.find(([px]) => px === x)[1];
    expect(at(62)).toBeLessThan(at(49));
    expect(ctx.calls.text).toEqual(expect.arrayContaining(['Song', 'Drums']));
    expect(MUSIC_LANE_H).toBe(32);
    // Scrolled past the song: no line.
    const late = fakeCtx();
    drawMusicLanes(late, { lanes, analysis, width: 400, pps: 50, scrollLeft: 100000 });
    expect(late.calls.strokes).toBe(0);
  });
});

import { snapToMusic } from './PreviewSequence';
describe('snapping to the music', () => {
  it('moves a time to the nearest beat when the song has a grid, else to 0.25 s', () => {
    const g = { beatOrigin: 0.1, beatSec: 0.5 };
    expect(snapToMusic(1.33, g)).toBeCloseTo(1.1);
    expect(snapToMusic(1.4, g)).toBeCloseTo(1.6);
    expect(snapToMusic(1.33, null)).toBeCloseTo(1.25);
  });
});
