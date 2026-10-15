// The 3D preview's show timeline: the patterns as they play, one block per pattern.
// Drag a block to move it, drag its right edge to change its length, click it to edit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_CONTROLS, FIELD_KINDS, ORIGINS, fieldKind } from './wavePatterns';
import { builderGroups } from './patternPresets';
import {
  defaultFieldGroups, deleteBlock, duplicateBlock, fieldUnitRecipes, moveBlock, resizeBlock, showBlocks, updateFieldUnit,
} from './showBlocks';

const SNAP = 0.25;
const LANE_H = 46;
const snap = v => Math.round(v / SNAP) * SNAP;
const fmt = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function Num({ label, value, min, max, step = 1, onChange, suffix }) {
  const [draft, setDraft] = useState(null); // typed text until it is a valid number
  const commit = (raw, live) => {
    const v = Number(raw);
    if (raw === '' || !Number.isFinite(v)) return;
    onChange(Math.min(max, Math.max(min, v)), live);
  };
  return <label className="seq-field"><span>{label}</span>
    <span className="seq-num"><input type="range" min={min} max={max} step={step} value={value ?? min}
      onChange={e => commit(e.target.value, true)} onPointerUp={e => commit(e.target.value, false)} />
    <input type="number" min={min} max={max} step={step} value={draft ?? value ?? ''}
      onChange={e => { setDraft(e.target.value); const v = Number(e.target.value); if (e.target.value !== '' && v >= min && v <= max) commit(e.target.value, false); }}
      onBlur={e => { commit(e.target.value, false); setDraft(null); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
    {suffix && <small>{suffix}</small>}</span>
  </label>;
}

function FieldInspector({ block, studio, items, onPatch, onPatchLive }) {
  const f = block.water.field || {};
  const lightField = block.lights?.field || {};
  const controls = new Set(FIELD_CONTROLS[f.kind] || []);
  const set = (key, live) => v => (live ? onPatchLive : onPatch)({ field: { [key]: v } });
  const num = (key, label, min, max, step, suffix) => <Num key={key} label={label} value={f[key]} min={min} max={max} step={step} suffix={suffix}
    onChange={(v, live) => (live ? onPatchLive : onPatch)({ field: { [key]: v } })} />;
  const groups = builderGroups(studio, items);
  return <>
    <label className="seq-field"><span>Name</span><input value={block.name} onChange={e => onPatch({ name: e.target.value })} /></label>
    <label className="seq-field"><span>Pattern</span>
      <select value={f.kind} onChange={e => onPatch({ kind: e.target.value })}>
        {FIELD_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
      </select></label>
    <p className="seq-hint">{fieldKind(f.kind).hint}</p>
    <div className="seq-section">Water height</div>
    {num('low', 'Lowest', 0, 100, 1, '%')}
    {num('high', 'Highest', 0, 100, 1, '%')}
    {controls.has('ramp') && <>
      {num('lowFar', 'Lowest at far end', 0, 100, 1, '%')}
      {num('highFar', 'Highest at far end', 0, 100, 1, '%')}
      {num('stairs', 'Stair steps (0 = smooth slope)', 0, 12, 1)}
    </>}
    <div className="seq-section">Movement</div>
    {controls.has('period') && num('period', f.kind === 'stadium' ? 'Seconds per lap' : f.kind === 'sweep' ? 'Seconds per trip' : 'Seconds per wave', 0.5, 30, 0.1, 's')}
    {controls.has('crests') && num('crests', 'Waves', 1, 12, f.kind === 'rolling' ? 0.01 : 1)}
    {controls.has('block') && num('block', 'Jets per block', 1, 20, 1)}
    {controls.has('drift') && num('drift', 'Drift (seconds per step, 0 = still)', 0, 60, 0.5, 's')}
    {controls.has('lag') && num('lag', 'Front-to-back delay', 0, 3, 0.05, 's')}
    {controls.has('width') && num('width', 'Crest width', 0.02, 0.4, 0.01)}
    {controls.has('direction') && <label className="seq-field"><span>Direction</span>
      <select value={f.direction < 0 ? -1 : 1} onChange={e => set('direction')(Number(e.target.value))}>
        <option value={1}>Clockwise</option><option value={-1}>Counter-clockwise</option></select></label>}
    {controls.has('origin') && <label className="seq-field"><span>Starts from</span>
      <select value={f.origin || 'tip'} onChange={e => set('origin')(e.target.value)}>
        {ORIGINS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
    {num('ease', 'Soft start / stop', 0, 5, 0.1, 's')}
    <div className="seq-section">Lights</div>
    {block.lights ? <>
      <label className="seq-field"><span>Colour</span>
        <span className="seq-num"><input type="color" value={block.lights.color || '#4f8cff'} onChange={e => onPatchLive({ light: { color: e.target.value } })}
          onBlur={e => onPatch({ light: { color: e.target.value } })} />
          <select value={lightField.colorMode || 'solid'} onChange={e => onPatch({ light: { colorMode: e.target.value } })}>
            <option value="solid">Solid colour</option><option value="rainbow">Moving rainbow</option></select></span></label>
      <Num label="Lights lowest" value={lightField.low} min={0} max={100} suffix="%" onChange={(v, live) => (live ? onPatchLive : onPatch)({ light: { low: v } })} />
      <Num label="Lights highest" value={lightField.high} min={0} max={100} suffix="%" onChange={(v, live) => (live ? onPatchLive : onPatch)({ light: { high: v } })} />
    </> : <p className="seq-hint">This pattern has no light layer.</p>}
    <p className="seq-hint">Water group: {groups.find(g => g.id === block.water.groupId)?.name || block.water.groupId}
      {block.lights ? ` · Lights: ${groups.find(g => g.id === block.lights.groupId)?.name || block.lights.groupId}` : ''}</p>
  </>;
}

export default function PreviewSequence({ studio, items, definitions, time, playing, showLength, onSeek, onChange, onChangeLive, onEditInBuilder, onPatternBuilder, onProgrammingView, extras = null }) {
  const blocks = useMemo(() => showBlocks(studio, definitions), [studio, definitions]);
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(0); // 0 = fit the whole show
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState(null);
  const [context, setContext] = useState(null); // { id, x, y }
  const scroller = useRef(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const length = Math.max(10, showLength, ...blocks.map(b => b.start + b.duration));
  const pps = zoom > 0 ? zoom : Math.max(2, (width - 24) / length);
  const lanes = Math.max(1, ...blocks.map(b => b.lane + 1));
  const selected = blocks.find(b => b.id === selectedId) || null;
  useEffect(() => { if (selectedId && !selected) setSelectedId(null); }, [selectedId, selected]);
  // Keep the playhead in view while playing when zoomed in.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing || zoom === 0) return;
    const x = time * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 80);
  }, [time, playing, pps, zoom]);

  const seekAt = e => {
    const el = scroller.current, rect = el.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(length, (e.clientX - rect.left + el.scrollLeft - 12) / pps)));
  };
  const startDrag = (e, block, mode) => {
    e.stopPropagation();
    setSelectedId(block.id);
    if (mode === 'resize' && block.type === 'recorded') return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: block.id, mode, x: e.clientX, start: block.start, duration: block.duration, moved: false });
  };
  const preview = drag && blocks.find(b => b.id === drag.id);
  const dragged = block => {
    if (!drag || drag.id !== block.id) return block;
    return { ...block, start: drag.newStart ?? block.start, duration: drag.newDuration ?? block.duration };
  };
  const onMove = e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) / pps;
    if (Math.abs(e.clientX - drag.x) > 3) drag.moved = true;
    setDrag(d => d && (d.mode === 'move' ? { ...d, moved: drag.moved, newStart: Math.max(0, snap(d.start + dx)) }
      : { ...d, moved: drag.moved, newDuration: Math.max(1, snap(d.duration + dx)) }));
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.moved && preview) {
      if (drag.mode === 'move' && drag.newStart !== undefined) onChange(s => moveBlock(s, preview, drag.newStart));
      if (drag.mode === 'resize' && drag.newDuration !== undefined) onChange(s => resizeBlock(s, preview, drag.newDuration));
    }
    setDrag(null);
  };

  const add = kind => {
    setMenu(false);
    const groups = defaultFieldGroups(studio, items);
    if (!groups.water) return;
    const end = Math.max(0, ...blocks.filter(b => !b.background).map(b => b.start + b.duration));
    const start = Math.min(590, snap(end));
    const { recipes, unitId } = fieldUnitRecipes({ kind, start, duration: 15, waterGroupId: groups.water.id, lightGroupId: groups.lights?.id,
      order: groups.water.orderMode === 'counter-clockwise' ? 'counter-clockwise' : 'clockwise' });
    const missing = [groups.water, groups.lights].filter(g => g && !studio.groups.some(x => x.id === g.id)).map(({ source, quick, ...g }) => g);
    onChange(s => ({ ...s, groups: [...s.groups, ...missing], recipes: [...s.recipes, ...recipes] }));
    setSelectedId(`unit:${unitId}`);
  };
  const patch = (p, live = false) => selected && (live ? onChangeLive : onChange)(s => updateFieldUnit(s, selected, p));

  const ticks = [];
  const every = pps > 40 ? 1 : pps > 16 ? 5 : pps > 6 ? 10 : 30;
  for (let t = 0; t <= length; t += every) ticks.push(t);

  return <div className="seq">
    <div className="seq-bar">
      <strong>SHOW</strong>
      <span className="seq-muted">{blocks.filter(b => !b.background).length} patterns · {fmt(length)}</span>
      <div className="seq-add">
        <button className="sp-primary" onClick={() => setMenu(m => !m)} aria-expanded={menu}>+ Add pattern</button>
        {menu && <div className="seq-menu" role="menu">
          {FIELD_KINDS.map(k => <button key={k.id} role="menuitem" onClick={() => add(k.id)}><b>{k.label}</b><small>{k.hint}</small></button>)}
          <button role="menuitem" onClick={() => { setMenu(false); onPatternBuilder(); }}><b>Pattern builder…</b><small>Chase, ripple, sparkle, pulse and music-synced patterns</small></button>
        </div>}
      </div>
      <button onClick={onPatternBuilder} title="Chase, ripple, sparkle, pulse and music-synced patterns">✦ Pattern builder</button>
      {extras}
      <span className="sp-grow" />
      <button onClick={() => setZoom(0)} aria-pressed={zoom === 0} title="Fit the whole show">Fit</button>
      <button onClick={() => setZoom(z => Math.max(2, (z || pps) / 1.5))} title="Zoom out">−</button>
      <button onClick={() => setZoom(z => Math.min(200, (z || pps) * 1.5))} title="Zoom in">+</button>
      <button onClick={onProgrammingView} title="Show the group / channel rows used in Show Programming">Programming view</button>
    </div>
    <div className="seq-body">
      <div className="seq-scroll" ref={scroller} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className="seq-canvas" style={{ width: length * pps + 24, height: 26 + lanes * LANE_H + 8 }}>
          <div className="seq-ruler" onPointerDown={seekAt}>
            {ticks.map(t => <span key={t} style={{ left: 12 + t * pps }}>{fmt(t)}</span>)}
            {(studio.markers || []).map(m => <i key={m.id} className="seq-marker" style={{ left: 12 + m.time * pps }} title={m.name} />)}
          </div>
          <div className="seq-lanes" onPointerDown={e => { if (e.target === e.currentTarget) { setSelectedId(null); seekAt(e); } }}>
            {blocks.map(raw => { const b = dragged(raw); return <div key={b.id}
              className={`seq-block ${b.type}${b.id === selectedId ? ' selected' : ''}${b.background ? ' background' : ''}${b.muted ? ' muted' : ''}`}
              style={{ left: 12 + b.start * pps, width: Math.max(6, b.duration * pps), top: b.lane * LANE_H + 4, '--block': b.color }}
              role="button" tabIndex={0} aria-label={b.name} aria-pressed={b.id === selectedId}
              onPointerDown={e => { if (e.button === 0) startDrag(e, raw, 'move'); }}
              onKeyDown={e => { if (e.key === 'Enter') setSelectedId(b.id); if (e.key === 'Delete') { onChange(s => deleteBlock(s, raw)); setSelectedId(null); } }}
              onContextMenu={e => { e.preventDefault(); setSelectedId(b.id); setContext({ id: b.id, x: e.clientX, y: e.clientY }); }}
              onDoubleClick={() => b.type === 'builder' && onEditInBuilder(b.recipeIds[0])}
              title={`${b.name} — ${b.kindLabel} · ${fmt(b.start)}–${fmt(b.start + b.duration)}`}>
              <b>{b.name}</b><small>{b.kindLabel} · {b.duration.toFixed(1)} s</small>
              {b.type !== 'recorded' && <span className="seq-handle" onPointerDown={e => startDrag(e, raw, 'resize')} title="Drag to change the length" />}
            </div>; })}
          </div>
          <div className="seq-playhead" style={{ left: 12 + time * pps }} />
        </div>
      </div>
      {selected && <aside className="seq-inspector">
        <div className="seq-inspector-head"><strong>{selected.name}</strong><button onClick={() => setSelectedId(null)} title="Close">✕</button></div>
        <div className="seq-inspector-body">
          <Num label="Start" value={selected.start} min={0} max={Math.max(0, 600 - selected.duration)} step={SNAP} suffix="s"
            onChange={(v, live) => (live ? onChangeLive : onChange)(s => moveBlock(s, selected, v))} />
          {selected.type !== 'recorded' && <Num label="Length" value={selected.duration} min={1} max={Math.max(1, 600 - selected.start)} step={SNAP} suffix="s"
            onChange={(v, live) => (live ? onChangeLive : onChange)(s => resizeBlock(s, selected, v))} />}
          {selected.type === 'field' && <FieldInspector block={selected} studio={studio} items={items}
            onPatch={p => patch(p)} onPatchLive={p => patch(p, true)} />}
          {selected.type === 'builder' && <button onClick={() => onEditInBuilder(selected.recipeIds[0])}>✦ Edit in builder</button>}
          {selected.type === 'recipe' && <p className="seq-hint">Hand-made pattern — edit its details in Show Programming.</p>}
          {selected.type === 'recorded' && <p className="seq-hint">Recorded pattern ({selected.legacyIds.length} cues). You can move or delete it.
            To change its shape, add a new pattern with “+ Add pattern”.</p>}
          <div className="seq-actions">
            <button onClick={() => { let id = null; onChange(s => { const r = duplicateBlock(s, selected); id = r.blockId; return r.studio; }); setTimeout(() => id && setSelectedId(id)); }}>Duplicate</button>
            <button onClick={() => { onChange(s => deleteBlock(s, selected)); setSelectedId(null); }}>Delete</button>
          </div>
        </div>
      </aside>}
    </div>
    {context && (() => { const b = blocks.find(x => x.id === context.id); if (!b) return null; const close = () => setContext(null);
      return <div className="seq-context" role="menu" style={{ left: context.x, top: context.y }} onPointerLeave={close}>
        {b.type === 'builder' && <button role="menuitem" onClick={() => { close(); onEditInBuilder(b.recipeIds[0]); }}>✦ Edit in builder</button>}
        <button role="menuitem" onClick={() => { close(); onChange(s => duplicateBlock(s, b).studio); }}>Duplicate</button>
        <button role="menuitem" onClick={() => { close(); onChange(s => deleteBlock(s, b)); setSelectedId(null); }}>Delete</button>
      </div>; })()}
  </div>;
}
