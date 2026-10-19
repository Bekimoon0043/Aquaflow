import { describe, it, expect } from 'vitest';
import { drawMusicLanes, musicLaneList, MUSIC_LANE_H } from './MusicLanes';
import { analyzeStem, drumTrack } from './stemAnalysis';
import { withStems } from './stemSync';
import { analyzeSamples, clickTrack } from './musicAnalysis';

const rate = 22050;
const drums = analyzeStem(drumTrack({ seconds: 8, rate, kicks: [1, 2, 3, 4, 5, 6], hats: [1.5, 2.5, 3.5] }), rate, 'drums');
const programmer = withStems(null, [{ id: 'd', role: 'drums', name: 'Drums.wav', analysis: drums }], { name: 'song', analysis: drums });

function fakeCtx() {
  const calls = { rects: [], text: [] };
  return { calls, clearRect() {}, fillRect(x, y, w, h) { calls.rects.push([x, y, w, h, this.fillStyle]); }, fillText(t) { calls.text.push(t); }, set fillStyle(v) { this._f = v; }, get fillStyle() { return this._f; }, font: '' };
}

describe('music lanes', () => {
  it('lists the song graph first, then each stem with bands', () => {
    const lanes = musicLaneList(programmer);
    expect(lanes.map(l => l.label)).toEqual(['Song', 'Drums']);
  });

  it('draws bands, kick ticks, bar lines and section names inside the visible window', () => {
    const lanes = musicLaneList(programmer);
    const analysis = analyzeSamples(clickTrack({ bpm: 120, bars: 4, rate: 11025 }), 11025).analysis;
    const ctx = fakeCtx();
    drawMusicLanes(ctx, { lanes, analysis, width: 400, pps: 50, scrollLeft: 0 });
    const far = fakeCtx(); drawMusicLanes(far, { lanes, analysis, width: 400, pps: 5, scrollLeft: 0 });
    expect(far.calls.rects.filter(r => r[4] === '#ffffff')).toHaveLength(0);   // no ticks when zoomed out
    const bandRects = ctx.calls.rects.filter(r => /^rgba\((255|109|59|91|199),/.test(r[4]) && r[2] === 1 && r[3] < MUSIC_LANE_H);
    expect(bandRects.length).toBeGreaterThan(100);
    const kickTicks = ctx.calls.rects.filter(r => r[4] === '#ffffff');
    expect(kickTicks.length).toBeGreaterThanOrEqual(4);              // kicks at 1..6 s → x = 62…312 px
    expect(ctx.calls.rects.some(r => r[4] === 'rgba(255,255,255,0.35)')).toBe(true);   // bar lines
    expect(ctx.calls.text).toEqual(expect.arrayContaining(['Song', 'Drums']));
    // Scrolled past the song: nothing but backgrounds and labels.
    const late = fakeCtx();
    drawMusicLanes(late, { lanes, analysis, width: 400, pps: 50, scrollLeft: 100000 });
    expect(late.calls.rects.filter(r => r[4] === '#ffffff')).toHaveLength(0);
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
