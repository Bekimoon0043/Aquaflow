import { useMemo, useState } from 'react';

export default function ProjectPatternBrowser({ blocks, style, onSelect }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return blocks.filter(block => (type === 'all' || block.type === type)
      && (!q || `${block.name} ${block.kindLabel}`.toLowerCase().includes(q)));
  }, [blocks, query, type]);
  return <div className="seq-assets" style={style} role="dialog" aria-label="Project patterns" onPointerDown={e => e.stopPropagation()}>
    <div className="seq-assets-head"><strong>THIS SHOW</strong><span>{filtered.length} of {blocks.length} editable blocks</span></div>
    <div className="seq-assets-tools">
      <input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search this show…" aria-label="Search project patterns" />
      <select value={type} onChange={e => setType(e.target.value)} aria-label="Project pattern type">
        <option value="all">All pattern types</option>
        <option value="motion">Moving nozzles</option>
        <option value="field">Water and light waves</option>
        <option value="recipe">Curves and static cues</option>
        <option value="recorded">Recorded cues</option>
      </select>
    </div>
    <p className="seq-assets-hint">Choose a block to reveal it in the timeline and open its editor.</p>
    <div className="seq-assets-list">
      {filtered.map(block => <div key={block.id} className="seq-asset" tabIndex={0} role="button" aria-label={`Edit project pattern ${block.name}`}
        onClick={() => onSelect(block)} onKeyDown={e => { if (e.key === 'Enter') onSelect(block); }}>
        <span className="seq-asset-swatch" style={{ '--asset-color': block.color || '#65d9d0' }} />
        <span className="seq-asset-copy"><b>{block.name}</b><small>{block.kindLabel} · starts at {block.start.toFixed(2)} s</small></span>
        <span className="seq-asset-time">{block.duration.toFixed(1)} s</span>
      </div>)}
      {!filtered.length && <p className="seq-assets-hint">No project patterns match this search.</p>}
    </div>
  </div>;
}
