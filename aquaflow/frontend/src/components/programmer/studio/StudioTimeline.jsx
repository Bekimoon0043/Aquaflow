import { useMemo, useRef, useState, useEffect } from 'react';
import { groupFlag, snapBeat } from './showModel';
import { deviceRows, worstLevel } from './plcLimits';

const ROW = 42, HEADER = 32, LABEL = 205;
function Waveform({ buffer, zoom, offset, width }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas.getContext('2d');
    canvas.width = Math.max(1, Math.ceil(width)); canvas.height = 44;
    ctx.fillStyle = '#142c36'; ctx.fillRect(0, 0, width, 44);
    const data = buffer.getChannelData(0), samplesPerPixel = buffer.sampleRate / zoom;
    ctx.fillStyle = '#79b8cb';
    for (let x = 0; x < width; x++) {
      const start = Math.floor((offset + x) * samplesPerPixel), end = Math.min(data.length, Math.ceil(start + samplesPerPixel));
      let peak = 0;
      for (let i = Math.max(0, start); i < end; i += Math.max(1, Math.floor(samplesPerPixel / 16))) peak = Math.max(peak, Math.abs(data[i]));
      ctx.fillRect(x, 22 - peak * 20, 1, Math.max(1, peak * 40));
    }
  }, [buffer, zoom, offset, width]);
  return <canvas ref={ref} style={{ position: 'absolute', top: HEADER, left: LABEL + offset, height: 44, pointerEvents: 'none' }} aria-label="Music waveform" />;
}
export default function StudioTimeline({ studio, items, time, audioBuffer, selectedIds, onSelect, onSelectMany, onMoveSelection, onCopy, onPaste, onDuplicate, onDelete, onChangeRecipe, onChangeLegacy, onSeek, onDropGroup, onGroupPatch, onMarker, plcIssues = new Map(), plcCheck = null, plcSiteName = '', onFocusIssue, onAddPattern, onPatternBuilder, onEditPattern, stripExtras = null }) {
  const ref = useRef(null), drag = useRef(null);
  const [zoom, setZoom] = useState(32), [scroll, setScroll] = useState({ x: 0, y: 0, width: 800, height: 300 });
  const [collapsed, setCollapsed] = useState(new Set()), [ghost, setGhost] = useState(null);
  // One row per device channel is the default; the single combined row stays available.
  const [details, setDetails] = useState(true);
  const [issueList, setIssueList] = useState(false);
  const [beatSnap, setBeatSnap] = useState(false);
  const [marquee, setMarquee] = useState(null);
  const [menu, setMenu] = useState(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', close); };
  }, [menu]);
  const selection = useMemo(() => new Set(selectedIds), [selectedIds]);
  const rowTop = HEADER + (audioBuffer ? 44 : 0);
  const end = Math.max(30, audioBuffer?.duration || 0, ...studio.recipes.map(r => r.start + r.duration), ...studio.legacyClips.map(c => c.startTime + c.duration));
  const duration = Math.ceil((end + 5) / 10) * 10;
  const groupById = useMemo(() => new Map(studio.groups.map(g => [g.id, g])), [studio.groups]);
  const rows = useMemo(() => {
    const result = [], visited = new Set();
    const visit = (group, depth = 0) => {
      if (visited.has(group.id)) return;
      visited.add(group.id);
      result.push({ ...group, key: group.id, depth, clips: studio.recipes.filter(r => r.groupId === group.id), group: true });
      if (!collapsed.has(group.id)) studio.groups.filter(g => g.parentId === group.id).forEach(g => visit(g, depth + 1));
    };
    studio.groups.filter(g => !groupById.has(g.parentId)).forEach(g => visit(g));
    const hidden = group => {
      const seen = new Set(); let parent = groupById.get(group.parentId);
      while (parent && !seen.has(parent.id)) {
        if (collapsed.has(parent.id)) return true;
        seen.add(parent.id); parent = groupById.get(parent.parentId);
      }
      return false;
    };
    studio.groups.forEach(g => { if (!visited.has(g.id) && !hidden(g)) visit(g); });
    if (studio.legacyClips.length) {
      result.push({ key: 'legacy', name: details ? `Fixture clips (${studio.legacyClips.length}) · one row per device` : `Fixture clips (${studio.legacyClips.length})`, clips: details ? [] : studio.legacyClips, legacy: true, heading: details });
      if (details) for (const row of deviceRows(studio.legacyClips, items)) result.push({ ...row, legacy: true, depth: 1 });
    }
    return result;
  }, [studio, collapsed, details, items, groupById]);
  useEffect(() => { const o = new ResizeObserver(() => setScroll(s => ({ ...s, width: ref.current.clientWidth, height: ref.current.clientHeight }))); o.observe(ref.current); return () => o.disconnect(); }, []);
  const start = Math.max(0, Math.floor((scroll.y - rowTop) / ROW) - 2);
  const visible = rows.slice(start, start + Math.ceil(scroll.height / ROW) + 5);
  const snap = value => beatSnap ? snapBeat(Math.max(0, value), studio.tempo) : Math.max(0, Math.round(value * 10) / 10);
  const timeAt = e => Math.max(0, (e.clientX - ref.current.getBoundingClientRect().left + ref.current.scrollLeft - LABEL) / zoom);
  const pointAt = e => ({ x: e.clientX - ref.current.getBoundingClientRect().left + ref.current.scrollLeft, y: e.clientY - ref.current.getBoundingClientRect().top + ref.current.scrollTop });
  const move = e => {
    const d = drag.current; if (!d) return;
    if (d.marquee) { setMarquee({ from: d.from, to: pointAt(e) }); return; }
    const delta = (e.clientX - d.x) / zoom;
    const offset = Math.max(d.minDelta, Math.min(d.maxDelta, snap(d.start + delta) - d.start));
    setGhost({ id: d.id, ids: d.ids, delta: offset, resize: d.resize, start: d.resize ? d.start : d.start + offset, duration: d.resize ? Math.max(.1, snap(d.start + d.duration + delta) - d.start) : d.duration });
  };
  const finish = () => {
    const d = drag.current;
    if (d?.marquee && marquee) {
      const left = Math.min(marquee.from.x, marquee.to.x), right = Math.max(marquee.from.x, marquee.to.x);
      const top = Math.min(marquee.from.y, marquee.to.y), bottom = Math.max(marquee.from.y, marquee.to.y);
      const ids = rows.flatMap((row, index) => {
        if (rowTop + index * ROW > bottom || rowTop + (index + 1) * ROW < top) return [];
        return row.clips.filter(c => LABEL + (c.start ?? c.startTime) * zoom <= right && LABEL + ((c.start ?? c.startTime) + c.duration) * zoom >= left).map(c => c.id);
      });
      onSelectMany(ids, d.additive);
    } else if (d && ghost && !d.resize) onMoveSelection(d.ids, ghost.delta);
    else if (d && ghost) {
      if (d.legacy) onChangeLegacy(d.id, { startTime: ghost.start, duration: ghost.duration });
      else onChangeRecipe(d.id, { start: ghost.start, duration: ghost.duration });
    }
    drag.current = null; setGhost(null); setMarquee(null);
  };
  const interval = [1, 2, 5, 10, 30, 60].find(n => n * zoom >= 70) || 60;
  return <section className="sp-timeline" aria-label="Show timeline">
    <div className="sp-strip"><strong>ARRANGEMENT</strong><span>{studio.recipes.length} patterns</span>
      <button onClick={() => setDetails(!details)} aria-pressed={details} title="Show each pump, jet and light channel on its own row">One row per device</button>
      {plcCheck && plcSiteName && <span className="sp-plc-chip-wrap"><button className={`sp-plc-chip ${plcCheck.counts.error ? 'error' : plcCheck.counts.warn ? 'warn' : 'ok'}`} aria-expanded={issueList} onClick={() => setIssueList(v => !v)} title={`Checked live against the PLC limits of ${plcSiteName}`}>
        {plcCheck.counts.error ? `⛔ ${plcCheck.counts.error} PLC error${plcCheck.counts.error > 1 ? 's' : ''}` : plcCheck.counts.warn ? `⚠ ${plcCheck.counts.warn} PLC warning${plcCheck.counts.warn > 1 ? 's' : ''}` : '✓ PLC limits OK'}</button>
        {issueList && <div className="sp-plc-list" role="dialog" aria-label="PLC limit issues"><strong>{plcSiteName}</strong>
          {!plcCheck.list.filter(i => i.level !== 'info').length && <p>Every clip fits this PLC: valve on/off times, pump ceiling and outputs all OK.</p>}
          {plcCheck.list.filter(i => i.level !== 'info').slice(0, 60).map((issue, n) => <button key={n} className={issue.level} onClick={() => { setIssueList(false); onFocusIssue?.(issue.clipId, issue.time); }}>
            <b>{issue.time.toFixed(1)} s</b> {issue.text}</button>)}
          {plcCheck.counts.info > 0 && <p>{plcCheck.counts.info} note(s) about clips the PLC skips or simplifies are shown on the clips.</p>}
        </div>}</span>}
      <button onClick={() => setBeatSnap(!beatSnap)} aria-pressed={beatSnap}>Beat snap</button>
      <button onClick={() => onMarker(time)}>+ Marker</button>
      {onPatternBuilder && <button className="sp-pattern-builder-open" onClick={onPatternBuilder} title="Build a wave, chase, ripple… with live 3D preview">✦ Pattern builder</button>}{stripExtras}
      <span>{selectedIds.length} selected</span><button disabled={!selectedIds.length} onClick={onCopy}>Copy</button><button onClick={onPaste}>Paste</button><button disabled={!selectedIds.length} onClick={onDuplicate}>Duplicate</button><button disabled={!selectedIds.length} onClick={onDelete}>Delete</button>
      <span className="sp-grow" /><button onClick={() => setZoom(Math.max(2, zoom / 1.4))}>−</button><span>{zoom.toFixed(0)} px/s</span><button onClick={() => setZoom(Math.min(180, zoom * 1.4))}>+</button>
      <button onClick={() => { setZoom(Math.max(2, (scroll.width - LABEL - 20) / duration)); if (ref.current) ref.current.scrollLeft = 0; }}>Fit show</button>
    </div>
    <div className="sp-timeline-scroll" ref={ref} tabIndex={0} onScroll={e => { const { scrollLeft: x, scrollTop: y } = e.currentTarget; setScroll(s => ({ ...s, x, y })); }}
      onPointerDown={e => {
        if (e.button !== 0 || e.target.closest('button,.sp-track-label,.sp-ruler,input')) return;
        const point = pointAt(e); if (point.x < LABEL + ref.current.scrollLeft) return;
        e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { marquee: true, from: point, additive: e.shiftKey || e.ctrlKey || e.metaKey }; setMarquee({ from: point, to: point });
      }}
      onPointerMove={move} onPointerUp={finish} onPointerCancel={() => { drag.current = null; setGhost(null); setMarquee(null); }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('application/aquaflow-group'); if (id) onDropGroup(id, snap(timeAt(e))); }}>
      <div style={{ width: LABEL + duration * zoom, height: Math.max(scroll.height, rowTop + rows.length * ROW), position: 'relative' }}>
        <div className="sp-ruler" style={{ width: LABEL + duration * zoom }} onClick={e => onSeek(Math.min(duration, timeAt(e)))}>
          <span className="sp-ruler-label" style={{ left: scroll.x, width: LABEL }}>GROUP / CHANNEL</span>
          {Array.from({ length: Math.ceil(duration / interval) + 1 }, (_, n) => n * interval).filter(t => t * zoom + LABEL >= scroll.x && t * zoom < scroll.x + scroll.width).map(t => <span className="sp-tick" key={t} style={{ left: LABEL + t * zoom }}>{t.toFixed(0)}s</span>)}
        </div>
        {audioBuffer && <Waveform buffer={audioBuffer} zoom={zoom} offset={Math.max(0, scroll.x - LABEL)} width={scroll.width} />}
        {visible.map((row, offset) => <div key={row.key} className={`sp-track ${row.group ? 'sp-track-group' : ''}`} style={{ top: rowTop + (start + offset) * ROW, height: ROW, width: LABEL + duration * zoom }}
          onDoubleClick={e => { if (!row.group || !onAddPattern || e.target.closest('.sp-clip,.sp-track-label')) return; onAddPattern(row.id, snap(timeAt(e))); }}>
          <div className="sp-track-label" style={{ left: scroll.x, width: LABEL, paddingLeft: 8 + (row.depth || 0) * 12 }}>
            {row.group && <button aria-label={`Fold ${row.name}`} onClick={() => setCollapsed(old => { const s = new Set(old); s.has(row.id) ? s.delete(row.id) : s.add(row.id); return s; })}>{collapsed.has(row.id) ? '▸' : '▾'}</button>}
            <span title={row.name}>{row.name}</span>
            {row.group && onAddPattern && <button className="sp-track-add" aria-label={`Add a pattern to ${row.name}`} title="Add a pattern for this group at the playhead (or double-click the row)" onClick={() => onAddPattern(row.id, snap(time))}>＋</button>}
            {row.group && <div className="sp-track-toggles">{[['muted', 'M'], ['solo', 'S'], ['locked', 'L']].map(([key, label]) => <button key={key} aria-label={`${key} ${row.name}`} aria-pressed={!!row[key]} onClick={() => onGroupPatch(row.id, { [key]: !row[key] })}>{label}</button>)}</div>}
          </div>
          {row.group && !row.clips.length && <span className="sp-track-hint" style={{ left: Math.max(LABEL + 8, scroll.x + LABEL + 8) }}>Double-click here or press ＋ to add a pattern for this group</span>}
          {row.clips.filter(c => {
            const t = c.start ?? c.startTime, d = c.duration;
            return (t + d) * zoom >= scroll.x - LABEL && t * zoom <= scroll.x + scroll.width;
          }).map(clip => {
            const locked = clip.locked || groupFlag(studio.groups, row.id, 'locked');
            const state = ghost?.resize && ghost.id === clip.id ? ghost : { start: (clip.start ?? clip.startTime) + (!locked && !ghost?.resize && ghost?.ids?.includes(clip.id) ? ghost.delta : 0), duration: clip.duration };
            const issues = plcIssues.get(clip.id) || [], level = worstLevel(issues);
            const tip = [`${clip.name} · ${state.start}s · ${state.duration}s`, ...issues.map(i => `${i.level === 'error' ? '⛔' : i.level === 'warn' ? '⚠' : 'ℹ'} ${i.text}`),
              ...(clip.pattern && onEditPattern ? ['Double-click to edit in the pattern builder'] : [])].join('\n');
            return <button key={clip.id} className={`sp-clip ${selection.has(clip.id) ? 'selected' : ''} ${level ? `plc-${level}` : ''}`} title={tip}
              style={{ left: LABEL + state.start * zoom, width: Math.max(5, state.duration * zoom), opacity: clip.muted || row.muted ? .35 : 1, '--clip-color': clip.color || '#65d9d0' }}
              onClick={e => { if (e.detail === 0) onSelect(clip.id, row.legacy, e.shiftKey || e.ctrlKey || e.metaKey); }}
              onDoubleClick={e => { if (!clip.pattern || !onEditPattern) return; e.stopPropagation(); onEditPattern(clip.id); }}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onSelect(clip.id, row.legacy, false); setMenu({ x: e.clientX, y: e.clientY, id: clip.id, pattern: !!clip.pattern && !row.legacy }); }}
              onPointerDown={e => {
                if (e.button !== 0) return;
                e.stopPropagation(); const additive = e.shiftKey || e.ctrlKey || e.metaKey; onSelect(clip.id, row.legacy, additive);
                if (locked || additive) return; e.currentTarget.setPointerCapture(e.pointerId);
                const ids = selection.has(clip.id) ? selectedIds : [clip.id];
                const movable = [...studio.recipes, ...studio.legacyClips].filter(c => ids.includes(c.id) && !c.locked && !groupFlag(studio.groups, c.groupId, 'locked'));
                drag.current = { id: clip.id, ids, minDelta: -Math.min(...movable.map(c => c.start ?? c.startTime)), maxDelta: 600 - Math.max(...movable.map(c => (c.start ?? c.startTime) + c.duration)), x: e.clientX, start: state.start, duration: state.duration, legacy: row.legacy, resize: e.target.dataset.resize === 'true' };
              }}><span>{level === 'error' ? '⛔ ' : level === 'warn' ? '⚠ ' : ''}{clip.name || clip.effect || 'Clip'}</span><i data-resize="true" title="Drag to resize" /></button>;
          })}
        </div>)}
        {studio.markers.map(m => <button className={`sp-marker ${m.kind === 'section' ? 'section' : ''}`} key={m.id} style={{ left: LABEL + m.time * zoom }} title={m.name} onClick={() => onSeek(m.time)}>{m.name}</button>)}
        <div className="sp-playhead" style={{ left: LABEL + time * zoom }} />
        {marquee && <div className="sp-timeline-marquee" style={{ left: Math.min(marquee.from.x, marquee.to.x), top: Math.min(marquee.from.y, marquee.to.y), width: Math.abs(marquee.from.x - marquee.to.x), height: Math.abs(marquee.from.y - marquee.to.y) }} />}
        {!rows.length && <div className="sp-timeline-empty">Select items in the plan, create a group, then drag it here to design a pattern.</div>}
      </div>
    </div>
    {menu && <div className="sp-clip-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()}>
      {menu.pattern && onEditPattern && <button role="menuitem" onClick={() => { setMenu(null); onEditPattern(menu.id); }}>✦ Edit in builder</button>}
      <button role="menuitem" onClick={() => { setMenu(null); onDuplicate(); }}>Duplicate</button>
      <button role="menuitem" onClick={() => { setMenu(null); onDelete(); }}>Delete</button>
    </div>}
    <input aria-label="Timeline overview" type="range" min={0} max={duration} step={.1} value={Math.min(time, duration)} onChange={e => onSeek(Number(e.target.value))} className="sp-overview" />
  </section>;
}
