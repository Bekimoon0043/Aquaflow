import { useEffect, useRef, useState } from 'react';

export default function VirtualList({ rows, renderRow, rowHeight = 32, label = 'Items' }) {
  const ref = useRef(null);
  const [viewport, setViewport] = useState({ top: 0, height: 400 });
  useEffect(() => {
    const element = ref.current;
    const observer = new ResizeObserver(() => { const height = element.clientHeight; setViewport(v => ({ ...v, height })); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const start = Math.max(0, Math.min(Math.max(0, rows.length - 1), Math.floor(viewport.top / rowHeight) - 4));
  const end = Math.min(rows.length, start + Math.ceil(viewport.height / rowHeight) + 8);
  return <div className="sp-virtual" ref={ref} aria-label={label} onScroll={e => { const top = e.currentTarget.scrollTop; setViewport(v => ({ ...v, top })); }}>
    <div style={{ height: rows.length * rowHeight, position: 'relative' }}>
      {rows.slice(start, end).map((row, i) => <div key={row.key || row.id} style={{ position: 'absolute', top: (start + i) * rowHeight, height: rowHeight, left: 0, right: 0 }}>{renderRow(row, start + i)}</div>)}
    </div>
    {!rows.length && <p className="sp-empty">No matching items.</p>}
  </div>;
}
