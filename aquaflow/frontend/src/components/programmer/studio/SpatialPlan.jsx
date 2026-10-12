import { useEffect, useMemo, useRef, useState } from 'react';
import useEngineeringStore from '../../../store/engineeringStore';

export default function SpatialPlan({ items, selected, onSelect, levels, matrix = false, frame = 0 }) {
  const canvas = useRef(null), drag = useRef(null), points = useRef([]);
  const [box, setBox] = useState(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const geometry = useEngineeringStore(s => s.geometry), params = useEngineeringStore(s => s.params), surfaces = useEngineeringStore(s => s.siteSurfaces);
  useEffect(() => setView({ zoom: 1, x: 0, y: 0 }), [frame, matrix]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const latest = useRef(null);
  latest.current = { items, levels, selectedSet, box, view, matrix, geometry, params, surfaces };
  useEffect(() => {
    const element = canvas.current, context = element.getContext('2d');
    let animation;
    const draw = () => {
      const { items, levels, selectedSet, box, view, matrix, geometry, params, surfaces } = latest.current;
      const { width, height } = element.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (element.width !== Math.round(width * dpr) || element.height !== Math.round(height * dpr)) {
        element.width = Math.round(width * dpr); element.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = '#0c1720'; context.fillRect(0, 0, width, height);
      context.strokeStyle = '#1b2c36'; context.lineWidth = 1;
      for (let x = 0; x < width; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
      for (let y = 0; y < height; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
      const poolPoints = geometry?.points || [];
      const xs = [...items.map(f => Number(f.x) || 0), ...poolPoints.map(p => p.x)], ys = [...items.map(f => Number(f.y) || 0), ...poolPoints.map(p => p.y)];
      const minX = Math.min(0, ...xs), maxX = Math.max(1, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
      const scale = Math.min((width - 80) / (maxX - minX), (height - 80) / (maxY - minY)) * view.zoom;
      const project = p => ({ x: width / 2 + (p.x - (minX + maxX) / 2) * scale + view.x, y: height / 2 + (p.y - (minY + maxY) / 2) * scale + view.y });
      const polygon = (vertices, color, fill) => {
        if (vertices.length < 3) return;
        context.beginPath(); vertices.forEach((p, i) => { const v = project(p); i ? context.lineTo(v.x, v.y) : context.moveTo(v.x, v.y); });
        context.closePath(); context.fillStyle = fill; context.fill(); context.strokeStyle = color; context.lineWidth = 2; context.stroke();
      };
      if (!matrix) {
        surfaces.filter(s => s.visible !== false).forEach(s => polygon(s.points || [], s.color || '#487c57', `${s.color || '#487c57'}22`));
        if (poolPoints.length) polygon(poolPoints, '#488496', '#183b4944');
        else if (geometry?.type === 'circle' || geometry?.type === 'ellipse') {
          const center = project(geometry.center || { x: 0, y: 0 });
          context.beginPath(); context.ellipse(center.x, center.y, (geometry.radius || geometry.rx || params.radius || 6) * scale, (geometry.radius || geometry.ry || params.radius || 6) * scale, 0, 0, Math.PI * 2);
          context.fillStyle = '#183b4944'; context.fill(); context.strokeStyle = '#488496'; context.stroke();
        }
      }
      const columns = Math.max(1, Math.floor((width - 40) / 42));
      points.current = items.map((item, i) => ({ item,
        x: matrix ? 30 + (i % columns) * 42 : width / 2 + ((Number(item.x) || 0) - (minX + maxX) / 2) * scale + view.x,
        y: matrix ? 30 + Math.floor(i / columns) * 38 + view.y : height / 2 + ((Number(item.y) || 0) - (minY + maxY) / 2) * scale + view.y }));
      points.current.forEach(({ item, x, y }, i) => {
        if (x < -30 || y < -30 || x > width + 30 || y > height + 30) return;
        const level = levels[item.id]?.value || 0, active = selectedSet.has(item.id);
        context.fillStyle = level > 0 ? levels[item.id].color : item.status === 'Scenery' ? '#556574' : '#426979';
        context.beginPath(); context.arc(x, y, 5 + level * 5, 0, Math.PI * 2); context.fill();
        if (active) { context.strokeStyle = '#ffe39b'; context.lineWidth = 2; context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.stroke(); }
        if (matrix || active || items.length < 70) { context.fillStyle = active ? '#fff0bc' : '#b5c8d2'; context.font = '10px sans-serif'; context.textAlign = 'center'; context.fillText(matrix ? `${i + 1}` : item.label, x, y + 24); }
      });
      if (box) { context.fillStyle = '#65d9d022'; context.strokeStyle = '#65d9d0'; context.fillRect(box.x, box.y, box.w, box.h); context.strokeRect(box.x, box.y, box.w, box.h); }
      animation = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animation);
  }, []);
  const position = e => { const rect = canvas.current.getBoundingClientRect(); return { x: e.clientX - rect.left, y: e.clientY - rect.top }; };
  return <canvas className="sp-plan" ref={canvas} aria-label="Engineering spatial selection. Drag to box select; Shift adds; middle drag pans; wheel zooms." tabIndex={0}
    onWheel={e => setView(v => matrix ? { ...v, y: v.y - e.deltaY } : { ...v, zoom: Math.max(.2, Math.min(8, v.zoom * (e.deltaY > 0 ? .9 : 1.1))) })}
    onPointerDown={e => { e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { ...position(e), pan: e.button === 1 || e.altKey, base: view, add: e.shiftKey || e.ctrlKey }; }}
    onPointerMove={e => { const d = drag.current; if (!d) return; const p = position(e); if (d.pan) setView({ ...d.base, x: d.base.x + p.x - d.x, y: d.base.y + p.y - d.y }); else setBox({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) }); }}
    onPointerUp={e => { const d = drag.current; if (!d) return; const p = position(e); if (!d.pan) {
      const small = Math.hypot(p.x - d.x, p.y - d.y) < 5;
      const found = small ? points.current.filter(q => Math.hypot(q.x - p.x, q.y - p.y) < 14).slice(-1)
        : points.current.filter(q => q.x >= Math.min(d.x, p.x) && q.x <= Math.max(d.x, p.x) && q.y >= Math.min(d.y, p.y) && q.y <= Math.max(d.y, p.y));
      onSelect(found.map(q => q.item.id), d.add);
    } drag.current = null; setBox(null); }} onPointerCancel={() => { drag.current = null; setBox(null); }} />;
}
