import { useEffect, useRef, useState } from 'react';

const DEFAULT = [{ time: 0, value: 0 }, { time: .5, value: 1 }, { time: 1, value: 0 }];
export default function EnvelopeEditor({ value, onChange }) {
  const [points, setPoints] = useState(value || DEFAULT), [selected, setSelected] = useState(1);
  const svg = useRef(null), dragging = useRef(null), latest = useRef(points);
  latest.current = points;
  useEffect(() => setPoints(value || DEFAULT), [value]);
  const coords = event => {
    const rect = svg.current.getBoundingClientRect();
    return { time: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), value: Math.max(0, Math.min(1, 1 - (event.clientY - rect.top) / rect.height)) };
  };
  const edit = (index, patch) => points.map((point, i) => i === index ? { ...point, ...patch, time: index === 0 ? 0 : index === points.length - 1 ? 1 : Math.max(points[index - 1].time + .01, Math.min(points[index + 1].time - .01, patch.time ?? point.time)) } : point);
  const move = event => {
    if (dragging.current === null) return;
    setPoints(edit(dragging.current, coords(event)));
  };
  return <div className="sp-envelope"><strong>Level envelope</strong><svg ref={svg} viewBox="0 0 240 110" preserveAspectRatio="none" aria-label="Editable pattern curve" onPointerMove={move}
    onPointerUp={() => { if (dragging.current !== null) onChange(latest.current); dragging.current = null; }}
    onPointerCancel={() => { dragging.current = null; setPoints(value || DEFAULT); }}
    onDoubleClick={event => { if (points.length >= 16) return; const point = coords(event); if (points.some(p => Math.abs(p.time - point.time) < .02)) return; const next = [...points, point].sort((a, b) => a.time - b.time); setPoints(next); onChange(next); }}>
    {[.25,.5,.75].map(n => <path key={n} d={`M${n * 240},0V110 M0,${n * 110}H240`} stroke="#304650" />)}
    <polyline points={points.map(p => `${p.time * 240},${(1 - p.value) * 110}`).join(' ')} stroke="#8af1db" strokeWidth="2" fill="none" />
    {points.map((p, i) => <circle key={i} cx={p.time * 240} cy={(1 - p.value) * 110} r="5" fill={i === selected ? '#ffe5a0' : '#6dd8c3'} onPointerDown={event => { event.stopPropagation(); svg.current.setPointerCapture(event.pointerId); dragging.current = i; setSelected(i); }} />)}
  </svg><p className="sp-help">Drag points or double-click the curve to add a point. Each cycle follows this envelope.</p>
    {points[selected] && <div className="sp-fields"><label>Point time (%)<input type="number" min={0} max={100} value={Math.round(points[selected].time * 100)} onChange={e => { const next = edit(selected, { time: Number(e.target.value) / 100 }); setPoints(next); onChange(next); }} /></label><label>Point level (%)<input type="number" min={0} max={100} value={Math.round(points[selected].value * 100)} onChange={e => { const next = edit(selected, { value: Math.max(0, Math.min(1, Number(e.target.value) / 100)) }); setPoints(next); onChange(next); }} /></label></div>}
    <button disabled={selected === 0 || selected >= points.length - 1} onClick={() => { const next = points.filter((_, i) => i !== selected); setSelected(0); setPoints(next); onChange(next); }}>Remove selected point</button>
  </div>;
}
