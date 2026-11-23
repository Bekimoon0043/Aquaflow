import { useMemo, useState } from 'react';
import { PATTERN_ASSETS, PATTERN_ASSET_DRAG_MIME, patternAssetCategories } from './patternAssets';

const targetLabel = target => ({ water: 'Water', lights: 'Lights', motion: 'Moving nozzles' }[target] || target);

export default function PatternAssetBrowser({ style, onUse, onCustomize }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const categories = useMemo(() => patternAssetCategories(), []);
  const assets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PATTERN_ASSETS.filter(asset => (category === 'all' || asset.category === category)
      && (!q || `${asset.name} ${asset.category} ${asset.targets.join(' ')}`.toLowerCase().includes(q)));
  }, [query, category]);
  return <div className="seq-assets" style={style} role="dialog" aria-label="Pattern assets" onPointerDown={e => e.stopPropagation()}>
    <div className="seq-assets-head"><strong>BELLAGIO · TIËSTO</strong><span>{PATTERN_ASSETS.length} reusable patterns</span></div>
    <div className="seq-assets-tools">
      <input autoFocus type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search pattern assets…" aria-label="Search pattern assets" />
      <select value={category} onChange={e => setCategory(e.target.value)} aria-label="Pattern asset category">
        <option value="all">All categories</option>
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
    <p className="seq-assets-hint">Drag or double-click to add. Choose ✎ to remix a copy in the pattern creator.</p>
    <div className="seq-assets-list">
      {assets.map(asset => <div key={asset.id} className="seq-asset" draggable tabIndex={0} role="button" aria-label={`Pattern asset ${asset.name}`}
        onDoubleClick={() => onUse(asset)} onKeyDown={e => { if (e.key === 'Enter' && e.target === e.currentTarget) onUse(asset); }}
        onDragStart={e => { e.dataTransfer.setData(PATTERN_ASSET_DRAG_MIME, asset.id); e.dataTransfer.setData('text/plain', asset.name); e.dataTransfer.effectAllowed = 'copy'; }}>
        <span className="seq-asset-swatch" style={{ '--asset-color': asset.color || '#65d9d0' }} />
        <span className="seq-asset-copy"><b>{asset.name}</b><small>{asset.category} · {asset.targets.map(targetLabel).join(' + ')}</small></span>
        <span className="seq-asset-time">{asset.duration.toFixed(1)} s</span>
        <span className="seq-asset-actions"><button title={`Customize ${asset.name}`} aria-label={`Customize ${asset.name}`} onClick={e => { e.stopPropagation(); onCustomize(asset); }}>✎</button>
          <button title={`Add ${asset.name} at the playhead`} onClick={e => { e.stopPropagation(); onUse(asset); }}>＋</button></span>
      </div>)}
      {!assets.length && <p className="seq-assets-hint">No pattern assets match this search.</p>}
    </div>
  </div>;
}
