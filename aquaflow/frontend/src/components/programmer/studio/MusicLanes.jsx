// Music lanes for the show timeline: one frequency-band graph per stem (and the whole mix),
// with bars, beats and sections over them — so a pattern can be placed by eye on a kick,
// a bass drop or a sung phrase. Drawn on one canvas that covers only the visible window,
// so a long song at high zoom stays fast.
import { useEffect, useMemo, useRef } from 'react';
import useProjectStore from '../../../store/projectStore';
import { BANDS, readBands } from './stemBands';
import { STEM_ROLES } from './stemAnalysis';
import { readMix, readStems } from './stemSync';
import { grid } from './beatSync';

export const MUSIC_LANE_H = 26;
const LABEL_W = 0;
const SECTION_COLORS = { intro: '#2f6bff', verse: '#35d0c0', chorus: '#ffb347', bridge: '#9b6bff', outro: '#2f6bff' };

const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const BAND_RGB = BANDS.map((b) => hexRgb(b.color));

/** Lanes to draw: the mix first, then each stem (drums, bass, vocals, …). */
export function musicLaneList(programmer) {
  const lanes = [];
  const mix = readMix(programmer);
  if (mix) lanes.push({ id: 'mix', label: 'Song', color: '#d8e6f0', analysis: mix.analysis });
  for (const s of readStems(programmer)) {
    if (s.analysis?.bands) lanes.push({ id: s.id, label: STEM_ROLES[s.role]?.label || s.role, color: STEM_ROLES[s.role]?.color || '#888', analysis: s.analysis });
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

/** Draw lanes for times [t0, t0 + width/pps] onto a 2D context. Pure drawing (testable). */
export function drawMusicLanes(ctx, { lanes, analysis, width, pps, scrollLeft, dpr = 1, laneH = MUSIC_LANE_H }) {
  const height = lanes.length * laneH;
  ctx.clearRect(0, 0, width * dpr, height * dpr);
  const timeAt = (x) => (scrollLeft + x - 12) / pps;
  const rowH = laneH / BANDS.length;
  lanes.forEach((lane, li) => {
    const bands = readBands(lane.analysis.bands);
    if (!bands) return;
    const y0 = li * laneH;
    ctx.fillStyle = 'rgba(8,16,24,0.85)';
    ctx.fillRect(0, y0 * dpr, width * dpr, (laneH - 1) * dpr);
    for (let x = 0; x < width; x++) {
      const ta = timeAt(x), tb = timeAt(x + 1);
      if (tb < 0) continue;
      const a = Math.max(0, Math.floor(ta * bands.rate)), b = Math.max(a + 1, Math.ceil(tb * bands.rate));
      if (a >= bands.frames) break;
      for (let k = 0; k < BANDS.length; k++) {
        if (!bands.present[k]) continue;
        // Peak and mean blended: zoomed out a whole song reads as shapes, not noise.
        let peak = 0, sum = 0, cnt = 0;
        for (let i = a; i < b && i < bands.frames; i++) { const u = bands.at(i, k); peak = Math.max(peak, u); sum += u; cnt++; }
        const v = cnt > 1 ? 0.5 * peak + 0.5 * (sum / cnt) : peak;
        if (v < 0.04) continue;
        const [r, g, bl] = BAND_RGB[k];
        ctx.fillStyle = `rgba(${r},${g},${bl},${(0.15 + 0.85 * v * v).toFixed(3)})`;
        // Low bands at the bottom of the lane, like a spectrogram.
        const y = y0 + laneH - 1 - (k + 1) * rowH;
        ctx.fillRect(x * dpr, y * dpr, dpr, rowH * dpr);
      }
    }
    // Kick / hat onsets as ticks on the drums lane.
    // Hit ticks only when zoomed in far enough to tell them apart (≥ 12 px per second).
    const hitsLists = pps >= 12 ? [[lane.analysis.kicks, '#ffffff', laneH - 4], [lane.analysis.hats, '#9fe8ff', 3]] : [];
    for (const [list, color, h] of hitsLists) {
      if (!Array.isArray(list)) continue;
      ctx.fillStyle = color;
      for (const hit of list) {
        const x = 12 + hit.t * pps - scrollLeft;
        if (x < 0 || x > width) continue;
        ctx.fillRect(Math.round(x) * dpr, (y0 + (h === 3 ? 0 : laneH - 1 - h)) * dpr, dpr, Math.max(1, h * hit.s) * dpr);
      }
    }
    ctx.font = `bold ${10 * dpr}px sans-serif`;
    const labelW = (ctx.measureText ? ctx.measureText(lane.label).width / dpr : lane.label.length * 6) + 8;
    ctx.fillStyle = 'rgba(4,10,16,0.85)';
    ctx.fillRect(0, y0 * dpr, labelW * dpr, 14 * dpr);
    ctx.fillStyle = lane.color;
    ctx.fillText(lane.label, (4 + LABEL_W) * dpr, (y0 + 11) * dpr);
  });
  // Bars and beats over every lane; section names on the first lane.
  const g = analysis ? grid(analysis) : null;
  if (g) {
    const t0 = Math.max(0, timeAt(0)), t1 = timeAt(width);
    const firstBeat = g.beatOrigin + Math.ceil((t0 - g.beatOrigin) / g.beatSec) * g.beatSec;
    if (g.beatSec * pps >= 4) {
      for (let t = firstBeat; t <= t1; t += g.beatSec) {
        const bar = Math.abs(((t - g.barOrigin) / g.barSec) - Math.round((t - g.barOrigin) / g.barSec)) < 1e-3;
        ctx.fillStyle = bar ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)';
        ctx.fillRect(Math.round(12 + t * pps - scrollLeft) * dpr, 0, dpr, height * dpr);
      }
    }
    for (const s of analysis.sections || []) {
      const x = 12 + s.start * pps - scrollLeft;
      if (x > width || 12 + s.end * pps - scrollLeft < 0) continue;
      ctx.fillStyle = SECTION_COLORS[s.label] || '#35d0c0';
      ctx.fillRect(Math.max(0, x) * dpr, 0, 2 * dpr, height * dpr);
      ctx.font = `bold ${9 * dpr}px sans-serif`;
      ctx.fillText(String(s.label).toUpperCase(), (Math.max(0, x) + 5) * dpr, (laneH - 4) * dpr);
    }
  }
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
      title="Music graph — each stem split into frequency bands (low at the bottom: sub, bass, low-mid, mid, high-mid, presence, brilliance). White ticks: kicks; blue ticks: hats; lines: bars and beats."
      onPointerDown={(e) => onSeek?.(e)}>
      <canvas ref={ref} style={{ position: 'sticky', left: 0, width: viewWidth, height, display: 'block' }} />
    </div>
  );
}
