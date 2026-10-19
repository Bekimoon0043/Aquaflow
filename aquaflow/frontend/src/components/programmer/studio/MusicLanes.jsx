// Music lanes for the show timeline: one loudness line per stem (and the whole song) that
// rises and falls with the music, with bars, beats and sections behind it — so a pattern can be placed by eye on a kick,
// a bass drop or a sung phrase. Drawn on one canvas that covers only the visible window,
// so a long song at high zoom stays fast.
import { useEffect, useMemo, useRef } from 'react';
import useProjectStore from '../../../store/projectStore';
import { STEM_ROLES } from './stemAnalysis';
import { readMix, readStems } from './stemSync';
import { grid } from './beatSync';

export const MUSIC_LANE_H = 32;
const SECTION_COLORS = { intro: '#2f6bff', verse: '#35d0c0', chorus: '#ffb347', bridge: '#9b6bff', outro: '#2f6bff' };


/** Lanes to draw: the mix first, then each stem (drums, bass, vocals, …). */
export function musicLaneList(programmer) {
  const lanes = [];
  const mix = readMix(programmer);
  if (mix?.analysis?.level?.length) lanes.push({ id: 'mix', label: 'Song', color: '#d8e6f0', analysis: mix.analysis });
  for (const s of readStems(programmer)) {
    if (s.analysis?.level?.length) lanes.push({ id: s.id, label: STEM_ROLES[s.role]?.label || s.role, color: STEM_ROLES[s.role]?.color || '#888', analysis: s.analysis });
  }
  return lanes;
}

/** Hook: lanes + song analysis from the project (cached beats). */
export function useMusicLanes() {
  const programmer = useProjectStore((s) => s.programmer);
  const lanes = useMemo(() => musicLaneList(programmer), [programmer]);
  const analysis = useMemo(() => {
    const cache = programmer?.musicCache || {};
    const name = programmer?.audioFileReference?.name;
    const entries = Object.values(cache).filter((e) => e?.bpm);
    return entries.find((e) => e.name === name) || entries.sort((a, b) => (b.cachedAt || 0) - (a.cachedAt || 0))[0] || null;
  }, [programmer]);
  return { lanes, analysis };
}

/**
 * Draw lanes for the visible window onto a 2D context: each lane is a line that rises and
 * falls with that part's loudness (light fill underneath), with bars, beats and section
 * names behind it. Pure drawing (testable with a fake context).
 */
export function drawMusicLanes(ctx, { lanes, analysis, width, pps, scrollLeft, dpr = 1, laneH = MUSIC_LANE_H }) {
  const height = lanes.length * laneH;
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  const timeAt = (x) => (scrollLeft + x - 12) / pps;
  // Bars, beats and sections first, so the lines sit on top.
  const g = analysis ? grid(analysis) : null;
  ctx.fillStyle = 'rgba(8,16,24,0.9)';
  ctx.fillRect(0, 0, width * dpr, height * dpr);
  if (g) {
    const t0 = Math.max(0, timeAt(0)), t1 = timeAt(width);
    const firstBeat = g.beatOrigin + Math.ceil((t0 - g.beatOrigin) / g.beatSec) * g.beatSec;
    if (g.beatSec * pps >= 6) {
      for (let t = firstBeat; t <= t1; t += g.beatSec) {
        const bar = Math.abs(((t - g.barOrigin) / g.barSec) - Math.round((t - g.barOrigin) / g.barSec)) < 1e-3;
        ctx.fillStyle = bar ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
        ctx.fillRect(Math.round(12 + t * pps - scrollLeft) * dpr, 0, dpr, height * dpr);
      }
    }
    for (const s of analysis.sections || []) {
      const x = 12 + s.start * pps - scrollLeft;
      if (x > width || 12 + s.end * pps - scrollLeft < 0) continue;
      ctx.fillStyle = SECTION_COLORS[s.label] || '#35d0c0';
      ctx.fillRect(Math.max(0, x) * dpr, 0, dpr, height * dpr);
      ctx.font = `bold ${9 * dpr}px sans-serif`;
      ctx.fillText(String(s.label).toUpperCase(), (Math.max(0, x) + 4) * dpr, (height - 3) * dpr);
    }
  }
  lanes.forEach((lane, li) => {
    const level = lane.analysis.level;
    if (!Array.isArray(level) || !level.length) return;
    const y0 = li * laneH, top = y0 + 3, bottom = y0 + laneH - 2;
    const yOf = (v) => bottom - Math.max(0, Math.min(1, v)) * (bottom - top);
    // One point per pixel column: the loudest moment in that column, so hits stay visible.
    const pts = [];
    for (let x = 0; x <= width; x++) {
      const ta = timeAt(x), tb = timeAt(x + 1);
      if (tb < 0) continue;
      const a = Math.max(0, Math.floor(ta * 20)), b = Math.max(a + 1, Math.ceil(tb * 20));
      if (a >= level.length) break;
      let v = 0;
      for (let i = a; i < b && i < level.length; i++) v = Math.max(v, level[i]);
      pts.push([x, yOf(v)]);
    }
    if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * dpr, bottom * dpr);
      for (const [x, y] of pts) ctx.lineTo(x * dpr, y * dpr);
      ctx.lineTo(pts[pts.length - 1][0] * dpr, bottom * dpr);
      ctx.closePath();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = lane.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      pts.forEach(([x, y], k) => (k ? ctx.lineTo(x * dpr, y * dpr) : ctx.moveTo(x * dpr, y * dpr)));
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, (y0 + laneH - 1) * dpr, width * dpr, dpr);
    ctx.font = `bold ${10 * dpr}px sans-serif`;
    const labelW = (ctx.measureText ? ctx.measureText(lane.label).width / dpr : lane.label.length * 6) + 8;
    ctx.fillStyle = 'rgba(4,10,16,0.85)';
    ctx.fillRect(0, y0 * dpr, labelW * dpr, 14 * dpr);
    ctx.fillStyle = lane.color;
    ctx.fillText(lane.label, 4 * dpr, (y0 + 11) * dpr);
  });
}

/**
 * The lanes, positioned inside the timeline's scrolling canvas. The <canvas> itself is
 * sticky (it moves with the scroll position) so only the visible window is ever drawn.
 */
export default function MusicLanes({ lanes, analysis, pps, scrollLeft, viewWidth, onSeek }) {
  const ref = useRef(null);
  const height = lanes.length * MUSIC_LANE_H;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !lanes.length) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(viewWidth * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    if (/jsdom/i.test(globalThis.navigator?.userAgent || '')) return;   // no canvas in the test DOM
    const ctx = canvas.getContext?.('2d');
    if (ctx) drawMusicLanes(ctx, { lanes, analysis, width: viewWidth, pps, scrollLeft, dpr });
  }, [lanes, analysis, pps, scrollLeft, viewWidth, height]);
  if (!lanes.length) return null;
  return (
    <div className="seq-music" style={{ height }} aria-label="Music graph"
      title="Music graph — one line per part of the music: high = loud, low = quiet. Song, then drums, bass and vocals. Faint lines: bars and beats; coloured lines: sections."
      onPointerDown={(e) => onSeek?.(e)}>
      <canvas ref={ref} style={{ position: 'sticky', left: 0, width: viewWidth, height, display: 'block' }} />
    </div>
  );
}
