import { useRef, useState } from 'react';
import { shapeValue } from './wavePatterns';

export default function CurveGraph({ field, onDraw }) {
  const W = 260, H = 84, pad = 6;
  const pts = Array.from({ length: 81 }, (_, i) => { const x = i / 80; return [pad + x * (W - 2 * pad), H - pad - shapeValue(field, x) * (H - 2 * pad)]; });
  const dragging = useRef(null);
  const [selected, setSelected] = useState(0);
  const drawn = field.shape === 'drawn' ? field.points : null;
  const move = e => {
    if (dragging.current === null || !drawn) return;
    const r = e.currentTarget.getBoundingClientRect();
    const value = Math.min(1, Math.max(0, 1 - (e.clientY - r.top - pad) / (r.height - 2 * pad)));
    onDraw(drawn.map((p, i) => i === dragging.current ? { ...p, value: Math.round(value * 100) / 100 } : p));
  };
  const add = e => {
    if (!drawn) return;
    const r = e.currentTarget.getBoundingClientRect();
    const time = Math.min(1, Math.max(0, (e.clientX - r.left - pad) / (r.width - 2 * pad)));
    const value = Math.min(1, Math.max(0, 1 - (e.clientY - r.top - pad) / (r.height - 2 * pad)));
    const next = [...drawn, { time, value, ease: 'smooth' }].sort((a, b) => a.time - b.time);
    onDraw(next); setSelected(next.findIndex(p => p.time === time && p.value === value));
  };
  const current = drawn?.[selected];
  return <div className="pc-curve-editor">
    <svg className="pc-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Movement of one jet over one cycle"
      onPointerMove={move} onPointerUp={() => { dragging.current = null; }} onPointerLeave={() => { dragging.current = null; }} onDoubleClick={add}>
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="pc-axis" />
      <polyline points={pts.map(p => p.join(',')).join(' ')} className="pc-line" />
      {drawn && drawn.map((p, i) => <circle key={i} cx={pad + p.time * (W - 2 * pad)} cy={H - pad - p.value * (H - 2 * pad)} r={i === selected ? 7 : 6}
        className={`pc-handle${i === selected ? ' selected' : ''}`} onPointerDown={e => {
          e.currentTarget.ownerSVGElement?.setPointerCapture?.(e.pointerId); dragging.current = i; setSelected(i);
        }} />)}
    </svg>
    {drawn && <div className="pc-curve-tools">
      <span>Key {selected + 1}</span>
      <select aria-label="Key interpolation" value={current?.ease || 'linear'} onChange={e => onDraw(drawn.map((p, i) => i === selected ? { ...p, ease: e.target.value } : p))}>
        <option value="linear">Linear</option><option value="smooth">Smooth</option><option value="in">Ease in</option>
        <option value="out">Ease out</option><option value="hold">Hold previous</option>
      </select>
      <button disabled={drawn.length <= 2 || selected === 0 || selected === drawn.length - 1} onClick={() => {
        onDraw(drawn.filter((_, i) => i !== selected)); setSelected(Math.max(0, selected - 1));
      }}>Remove key</button>
    </div>}
  </div>;
}
