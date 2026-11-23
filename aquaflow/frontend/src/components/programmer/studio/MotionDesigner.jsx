import { useEffect, useMemo, useRef, useState } from 'react';
import CurveGraph from './CurveGraph';
import { Choice, Slider } from './patternControls';
import { MOTION_PATHS, cleanMotion, motionPoint, motionSpeedReport } from './motionPatterns';
import { ORIGINS, PATHS, SHAPES, memberGeometry } from './wavePatterns';

const TAU = Math.PI * 2;
const useTime = () => {
  const [time, setTime] = useState(0);
  useEffect(() => {
    let alive = true, last = performance.now(), handle;
    const raf = globalThis.requestAnimationFrame || (fn => setTimeout(() => fn(performance.now()), 50));
    const cancel = globalThis.cancelAnimationFrame || clearTimeout;
    const tick = now => { if (!alive) return; setTime(t => t + (now - last) / 1000); last = now; handle = raf(tick); };
    handle = raf(tick);
    return () => { alive = false; cancel(handle); };
  }, []);
  return time;
};

function SpatialPathEditor({ motion, field, onChange }) {
  const [selected, setSelected] = useState(0), drag = useRef(null);
  const time = useTime();
  const m = cleanMotion(motion, Math.max(2, motion.axes));
  const pointAt = u => motionPoint(m, { ...field, spread: 0, opposite: false }, { i: 0, n: 1, p: 0, s: 0 }, u * Math.max(0.2, field.period || 5));
  const path = Array.from({ length: 101 }, (_, i) => pointAt(i / 100));
  const xy = p => [150 + clamp(p.pan - m.centrePanDeg, -m.panAmplitudeDeg, m.panAmplitudeDeg) / Math.max(1, m.panAmplitudeDeg) * 120,
    110 - clamp(p.tilt - m.centreTiltDeg, -m.tiltAmplitudeDeg, m.tiltAmplitudeDeg) / Math.max(1, m.tiltAmplitudeDeg) * 88];
  const pathText = path.map((p, i) => `${i ? 'L' : 'M'}${xy(p).join(',')}`).join(' ');
  const current = pointAt((time / Math.max(0.2, field.period || 5)) % 1), dot = xy(current);
  const move = e => {
    if (drag.current === null) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (e.clientX - r.left - 30) / 120));
    const y = Math.max(-1, Math.min(1, (110 - (e.clientY - r.top)) / 88));
    onChange({ points: m.points.map((p, i) => i === drag.current ? { x, y } : p) });
  };
  return <div className="pc-spatial">
    <svg viewBox="0 0 300 220" role="img" aria-label="Spatial nozzle path" onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerLeave={() => { drag.current = null; }}>
      <rect x="30" y="22" width="240" height="176" className="pc-spatial-frame" />
      <line x1="150" y1="22" x2="150" y2="198" className="pc-axis" /><line x1="30" y1="110" x2="270" y2="110" className="pc-axis" />
      <path d={pathText} className="pc-spatial-path" />
      <circle cx={dot[0]} cy={dot[1]} r="5" className="pc-spatial-playhead" />
      {m.path === 'custom' && m.points.map((p, i) => <circle key={i} cx={150 + p.x * 120} cy={110 - p.y * 88} r={i === selected ? 7 : 6}
        className={`pc-handle${i === selected ? ' selected' : ''}`} onPointerDown={e => {
          e.currentTarget.ownerSVGElement?.setPointerCapture?.(e.pointerId); drag.current = i; setSelected(i);
        }} />)}
    </svg>
    <div className="pc-spatial-label"><span>← Pan</span><span>Tilt ↑</span></div>
    {m.path === 'custom' && <div className="pc-curve-tools">
      <select aria-label="Spatial interpolation" value={m.interpolation} onChange={e => onChange({ interpolation: e.target.value })}>
        <option value="smooth">Smooth path</option><option value="linear">Straight segments</option><option value="hold">Hold each point</option>
      </select>
      <button onClick={() => {
        const next = [...m.points]; next.splice(selected + 1, 0, { ...next[selected] }); onChange({ points: next }); setSelected(selected + 1);
      }}>＋ Point</button>
      <button disabled={m.points.length <= 2} onClick={() => { onChange({ points: m.points.filter((_, i) => i !== selected) }); setSelected(Math.max(0, selected - 1)); }}>Remove</button>
      <label className="pc-check"><input type="checkbox" checked={m.closed} onChange={e => onChange({ closed: e.target.checked })} /> Close path</label>
    </div>}
  </div>;
}

function MotionPreview({ motion, field, members }) {
  const time = useTime(), m = cleanMotion(motion);
  const geo = useMemo(() => memberGeometry(members.length ? members : Array.from({ length: 16 }, (_, i) => ({ id: i, x: Math.cos(i / 16 * TAU), y: Math.sin(i / 16 * TAU) })),
    { origin: field.origin || 'tip', ring: true }), [members, field.origin]);
  const points = geo.map(g => ({ g, p: motionPoint(m, field, g, time) }));
  return <div className="pc-preview"><svg viewBox="0 0 300 150" role="img" aria-label="Live motion pattern preview">
    <text x="12" y="18" fill="#8ba3b8" fontSize="10">{m.axes}D · live schematic</text>
    {points.map(({ g, p }, i) => {
      const x = m.axes === 1 ? 35 + i * 230 / Math.max(1, points.length - 1) : 150 + g.nx * 92;
      const y = m.axes === 1 ? 118 : 78 + g.ny * 48;
      const dx = m.axes === 1 ? Math.sin(p.pan * Math.PI / 180) * 32 : (p.pan - m.centrePanDeg) / Math.max(1, m.panAmplitudeDeg) * 18;
      const dy = m.axes === 1 ? -Math.cos(p.pan * Math.PI / 180) * 32 : -(p.tilt - m.centreTiltDeg) / Math.max(1, m.tiltAmplitudeDeg) * 18;
      return <g key={g.id}><circle cx={x} cy={y} r="3" fill="#70879a" />
        <line x1={x} y1={y} x2={x + dx} y2={y + dy} stroke="#65d9d0" strokeWidth="2.5" strokeLinecap="round" />
        {m.axes === 3 && <circle cx={x + dx} cy={y + dy} r={3 + Math.sin(p.roll * Math.PI / 180)} fill="none" stroke="#c4b5fd" />}</g>;
    })}
  </svg><small>Every nozzle has its own phase. The real 3D preview runs after adding the pattern.</small></div>;
}

export default function MotionDesigner({ motion, field, duration, members, onMotion, onField, onDuration }) {
  const m = cleanMotion(motion), axes = m.axes;
  const speed = useMemo(() => motionSpeedReport(m, field, members), [m, field, members]);
  const set = patch => onMotion(cleanMotion({ ...m, ...patch }, axes));
  return <>
    <section><h4>1 · {axes === 1 ? 'How one nozzle swings' : 'Shape of the aim path'}</h4>
      {axes === 1 ? <>
        <Choice label="Swing shape" options={SHAPES} value={field.shape} onChange={shape => onField(shape === 'drawn' && !field.points ? { shape, points: [{ time: 0, value: 0.5 }, { time: 0.25, value: 1 }, { time: 0.75, value: 0 }, { time: 1, value: 0.5 }] } : { shape })} />
        <CurveGraph field={field} onDraw={points => onField({ points })} />
        <Slider label="Swing amplitude" value={m.amplitudeDeg} min={1} max={120} suffix="°" onChange={amplitudeDeg => set({ amplitudeDeg })} />
        <Slider label="Swing centre" value={m.centreDeg} min={-90} max={90} suffix="°" onChange={centreDeg => set({ centreDeg })} />
      </> : <>
        <Choice label="Spatial path" options={MOTION_PATHS.filter(p => p.axes <= axes).map(p => [p.id, p.label, p.hint])} value={m.path} onChange={path => set({ path })} />
        <SpatialPathEditor motion={m} field={field} onChange={set} />
        {m.path === 'spiral' && <Slider label="Turns per spiral" value={m.turns} min={0.25} max={8} step={0.25} onChange={turns => set({ turns })} />}
        <div className="pc-two-col"><Slider label="Pan amplitude" value={m.panAmplitudeDeg} min={1} max={180} suffix="°" onChange={panAmplitudeDeg => set({ panAmplitudeDeg })} />
          <Slider label="Tilt amplitude" value={m.tiltAmplitudeDeg} min={1} max={120} suffix="°" onChange={tiltAmplitudeDeg => set({ tiltAmplitudeDeg })} />
          <Slider label="Pan centre" value={m.centrePanDeg} min={-180} max={180} suffix="°" onChange={centrePanDeg => set({ centrePanDeg })} />
          <Slider label="Tilt centre" value={m.centreTiltDeg} min={-90} max={90} suffix="°" onChange={centreTiltDeg => set({ centreTiltDeg })} /></div>
      </>}
    </section>
    <section><h4>2 · How the group moves</h4>
      <Choice label="Group phase path" options={PATHS} value={field.path} onChange={path => onField({ path })} />
      {['around', 'from-point'].includes(field.path) && <Slider label="Phase waves" value={field.crests} min={field.path === 'from-point' ? 0.25 : 1} max={12} step={field.path === 'from-point' ? 0.25 : 1} onChange={crests => onField({ crests })} />}
      {['from-point', 'together'].includes(field.path) && <label className="pc-field"><span>Starts from</span><select aria-label="Motion starts from" value={field.origin} onChange={e => onField({ origin: e.target.value })}>{ORIGINS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
      {field.path === 'together' && <Slider label="Phase delay" value={field.spread} min={0} max={2} step={0.05} onChange={spread => onField({ spread })} />}
      {field.path === 'around' && <label className="pc-field"><span>Direction</span><select aria-label="Motion direction" value={field.direction} onChange={e => onField({ direction: Number(e.target.value) })}><option value={1}>Forward</option><option value={-1}>Reverse</option></select></label>}
      <Slider label="Nozzles per group" value={field.group} min={1} max={20} onChange={group => onField({ group })} />
      <label className="pc-check"><input type="checkbox" checked={field.opposite} onChange={e => onField({ opposite: e.target.checked })} /> Every other group opposite</label>
    </section>
    <section><h4>3 · Timing and drive limits</h4>
      <Slider label="Pattern length" value={duration} min={1} max={120} step={0.5} suffix="s" onChange={onDuration} />
      <Slider label="Seconds per cycle" value={field.period} min={0.5} max={60} step={0.1} suffix="s" onChange={period => onField({ period })} />
      <Slider label="Start point in cycle" value={Math.min(field.offset || 0, field.period)} min={0} max={field.period} step={0.05} suffix="s" onChange={offset => onField({ offset })} />
      <label className="pc-check"><input type="checkbox" checked={m.limitSpeed} onChange={e => set({ limitSpeed: e.target.checked })} /> Slow the whole group to the nozzles' rated speed</label>
      <p className={`pc-speed${speed.limited ? ' limited' : ''}`}>Estimated peak: {speed.limitedPeak.toFixed(0)}°/s · rated {speed.drive.toFixed(0)}°/s{speed.limited ? ` · slowed ${Math.round((1 - speed.scale) * 100)}%` : ' · within limit'}</p>
    </section>
    {axes === 3 && <section><h4>4 · Third axis · nozzle head</h4>
      <Choice label="Head rotation" value={m.rollMode} onChange={rollMode => set({ rollMode })} options={[
        ['hold', 'Hold angle', 'Keep the head at one rotation'], ['spin', 'Continuous spin', 'Turn continuously in either direction'], ['sway', 'Oscillate', 'Turn back and forth around a centre'],
      ]} />
      {m.rollMode === 'spin' && <><Slider label="Head speed" value={Math.abs(m.rollRpm)} min={1} max={120} suffix="rpm" onChange={rpm => set({ rollRpm: rpm * m.rollDirection })} />
        <Choice label="Spin direction" value={String(m.rollDirection)} onChange={v => set({ rollDirection: Number(v), rollRpm: Math.abs(m.rollRpm) * Number(v) })} options={[['1', 'Clockwise', 'Positive rotation'], ['-1', 'Counter-clockwise', 'Reverse rotation']]} /></>}
      {m.rollMode === 'sway' && <Slider label="Rotation amplitude" value={m.rollAmplitudeDeg} min={1} max={360} suffix="°" onChange={rollAmplitudeDeg => set({ rollAmplitudeDeg })} />}
      <Slider label="Head centre" value={m.centreRollDeg} min={-180} max={180} suffix="°" onChange={centreRollDeg => set({ centreRollDeg })} />
      <label className="pc-check"><input type="checkbox" checked={m.rollFollowGroup} onChange={e => set({ rollFollowGroup: e.target.checked })} /> Offset head rotation around the group</label>
    </section>}
    <div className="pc-motion-preview"><MotionPreview motion={m} field={field} members={members} /></div>
  </>;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
