// The 3D preview's show timeline: the patterns as they play, one block per pattern.
// Drag a block to move it, drag its right edge to change its length, click it to edit.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_CONTROLS, FIELD_KINDS, ORIGINS, fieldKind } from './wavePatterns';
import { builderGroups } from './patternPresets';
import PatternCreator from './PatternEditor';
import { motionAxesOf, motionPatternRecipes } from './motionPatterns';
import MusicLanes, { MUSIC_LANE_H, useMusicLanes } from './MusicLanes';
import PlanStrip, { PLAN_STRIP_H } from './PlanStrip';
import { applyMeter } from './musicMeter';
import { songAnalysis } from './deepMerge';
import { useStems } from './stemSync';
import { useProgrammerSong } from './musicSync';
import { grid as beatGrid } from './beatSync';
import { clipTooltip, ownerLabel, ownerOfBlock, ownershipIndex, ownerSummary, stickyOffset } from './timelineOwnership';

/** Snap a time to the song's beats (when the music has a beat grid), else to quarter seconds. */
export function snapToMusic(t, g) {
  if (!g) return snap(t);
  return Math.round((g.beatOrigin + Math.round((t - g.beatOrigin) / g.beatSec) * g.beatSec) * 1000) / 1000;
}
import { myTypes } from './customPatterns';
import PatternAssetBrowser from './PatternAssetBrowser';
import ProjectPatternBrowser from './ProjectPatternBrowser';
import { PATTERN_ASSETS, PATTERN_ASSET_DRAG_MIME, patternAssetById, patternAssetFile } from './patternAssets';
import {
  defaultFieldGroups, deleteBlock, duplicateBlock, exportPatterns, fieldUnitRecipes, importPatterns, moveBlock, resizeBlock, showBlocks, updateFieldUnit, updateMotionUnit, updateRecipeBlock,
} from './showBlocks';

const fileName = text => `${String(text || 'patterns').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'patterns'}.aqpattern.json`;
function download(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* download unavailable (tests) */ }
}
const readText = file => (typeof file.text === 'function' ? file.text() : new Promise((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsText(file);
}));

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
    <span className="seq-num"><input type="range" min={min} max={max} step={step} value={value ?? min} aria-label={label}
      onChange={e => commit(e.target.value, true)} onPointerUp={e => commit(e.target.value, false)} />
    <input type="number" min={min} max={max} step={step} value={draft ?? value ?? ''} aria-label={`${label} value`}
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
    {controls.has('mode') && num('mode', f.kind === 'spiral' ? 'Arms' : 'Mode (nodes)', 1, 8, 1)}
    {controls.has('twist') && num('twist', 'Twist', 0, 3, 0.1)}
    {controls.has('fadeOut') && num('fadeOut', 'Fade with distance', 0, 1, 0.05)}
    {controls.has('sets') && num('sets', f.kind === 'packet' ? 'Waves per group' : 'Waves per set', 2, 12, 1)}
    {controls.has('decay') && num('decay', 'Decay', 0.2, 10, 0.1, 's')}
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

function RecipeInspector({ block, onPatch }) {
  const recipe = block.water;
  const points = recipe.envelope || [];
  const setPoint = (index, key, raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const envelope = points.map((p, i) => {
      if (i !== index) return p;
      if (key === 'value') return { ...p, value: Math.max(0, Math.min(1, value / 100)) };
      const low = i === 0 ? 0 : points[i - 1].time + 0.001;
      const high = i === points.length - 1 ? 1 : points[i + 1].time - 0.001;
      return { ...p, time: Math.max(low, Math.min(high, value / 100)) };
    });
    onPatch({ envelope });
  };
  const addPoint = () => {
    let index = 0;
    for (let i = 1; i < points.length; i++) if (points[i].time - points[i - 1].time > points[index + 1]?.time - points[index]?.time) index = i - 1;
    const a = points[index], b = points[index + 1];
    if (!a || !b) return;
    const envelope = [...points.slice(0, index + 1), { time: (a.time + b.time) / 2, value: (a.value + b.value) / 2 }, ...points.slice(index + 1)];
    onPatch({ envelope });
  };
  return <>
    <label className="seq-field"><span>Name</span><input value={block.name} onChange={e => onPatch({ name: e.target.value })} /></label>
    <p className="seq-hint">{recipe.attribute === 'motion_angle' ? 'Moving-nozzle angle' : recipe.effect === 'static' ? 'Constant water or light level' : 'Keyed curve'} · editable copy</p>
    <Num label={recipe.attribute === 'motion_angle' ? 'Motion scale' : 'Level'} value={recipe.intensity} min={0} max={100} step={1} suffix="%" onChange={v => onPatch({ intensity: v })} />
    <label className="seq-field"><span>Colour</span><input type="color" value={recipe.color || '#65d9d0'} onChange={e => onPatch({ color: e.target.value })} /></label>
    {recipe.effect === 'curve' && <>
      <Num label="Cycles" value={recipe.cycles} min={1} max={32} step={1} onChange={v => onPatch({ cycles: Math.round(v) })} />
      <Num label="Phase spread" value={recipe.spread} min={0} max={1} step={0.05} onChange={v => onPatch({ spread: v })} />
      <label className="seq-field"><span>Fixture order</span><select value={recipe.order || 'engineering'} onChange={e => onPatch({ order: e.target.value })}>
        {['engineering', 'left-to-right', 'right-to-left', 'front-to-back', 'clockwise', 'counter-clockwise', 'center-out'].map(order => <option key={order} value={order}>{order.replaceAll('-', ' ')}</option>)}
      </select></label>
      <div className="seq-section">Curve keys <button onClick={addPoint}>＋ Add key</button></div>
      {points.map((p, i) => <div className="seq-curve-key" key={i}>
        <input aria-label={`Key ${i + 1} time`} type="number" min={0} max={100} step={0.1} value={Math.round(p.time * 1000) / 10} disabled={i === 0 || i === points.length - 1} onChange={e => setPoint(i, 'time', e.target.value)} /><span>% time</span>
        <input aria-label={`Key ${i + 1} level`} type="number" min={0} max={100} step={1} value={Math.round(p.value * 100)} onChange={e => setPoint(i, 'value', e.target.value)} /><span>% level</span>
        <button aria-label={`Remove key ${i + 1}`} disabled={points.length <= 2 || i === 0 || i === points.length - 1} onClick={() => onPatch({ envelope: points.filter((_, n) => n !== i) })}>✕</button>
      </div>)}
    </>}
  </>;
}

export default function PreviewSequence({ studio, items, definitions, time, playing, showLength, onSeek, onChange, onChangeLive, onEditInBuilder, onPatternBuilder, onProgrammingView, extras = null, onExportFile = download }) {
  const blocks = useMemo(() => showBlocks(studio, definitions), [studio, definitions]);
  // Which group / item each block plays on: shown in front of the block name.
  const owners = useMemo(() => ownershipIndex(studio, items), [studio.groups, items]);
  const [selectedId, setSelectedId] = useState(null);
  const [zoom, setZoom] = useState(0); // 0 = fit the whole show
  const [menu, setMenu] = useState(false);
  const [drag, setDrag] = useState(null);
  const [context, setContext] = useState(null); // { id, x, y }
  const [note, setNote] = useState('');
  const [creator, setCreator] = useState(null); // null | { block }
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  // Music graph: per-stem frequency bands, bars, beats and sections above the patterns.
  const music = useMusicLanes();
  const stemsApi = useStems();
  const song = useProgrammerSong();
  const [showMusic, setShowMusic] = useState(true);
  const [scrollLeft, setScrollLeft] = useState(0);
  const musicH = (showMusic ? music.lanes.length * MUSIC_LANE_H : 0) + (studio.plan?.sections?.length ? PLAN_STRIP_H : 0);
  // The graph shows the same sections the plan uses (deep analysis when the song has it).
  const songGrid = useMemo(() => applyMeter(songAnalysis(music.analysis), studio.meter), [music.analysis, studio.meter]);
  const importRef = useRef(null);
  // Menus close on any click outside them, or on Escape.
  useEffect(() => {
    if (!menu && !context && !assetsOpen && !projectOpen) return undefined;
    const close = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !e.target.closest?.('.seq-add, .seq-context')) { setMenu(false); setContext(null); setAssetsOpen(false); setProjectOpen(false); } };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [menu, context, assetsOpen, projectOpen]);
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
  const projectBlocks = useMemo(() => blocks.filter(b => !b.background), [blocks]);
  const revealProjectBlock = block => {
    setSelectedId(block.id);
    setProjectOpen(false);
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, 12 + block.start * pps - el.clientWidth / 2);
    el.scrollTop = Math.max(0, block.lane * LANE_H - el.clientHeight / 2);
  };
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
    // With a beat grid, blocks land on beats (hold Alt for free quarter-second steps).
    const g = e.altKey ? null : beatGrid(music.analysis);
    setDrag(d => d && (d.mode === 'move' ? { ...d, moved: drag.moved, newStart: Math.max(0, snapToMusic(d.start + dx, g)) }
      : { ...d, moved: drag.moved, newDuration: Math.max(1, snapToMusic(d.start + d.duration + dx, g) - d.start) }));
  };
  const onUp = () => {
    if (!drag) return;
    if (drag.moved && preview) {
      if (drag.mode === 'move' && drag.newStart !== undefined) onChange(s => moveBlock(s, preview, drag.newStart));
      if (drag.mode === 'resize' && drag.newDuration !== undefined) onChange(s => resizeBlock(s, preview, drag.newDuration));
    }
    setDrag(null);
  };

  const nextStart = () => Math.min(590, snap(Math.max(0, ...blocks.filter(b => !b.background).map(b => b.start + b.duration))));
  const add = (kind, type = null) => {
    setMenu(false);
    const groups = defaultFieldGroups(studio, items);
    const start = nextStart();
    if (type?.patternKind === 'motion') {
      const axes = type.motion?.axes || 1, byId = new Map(items.map(i => [i.id, i]));
      const compatible = g => (g?.memberFixtureIds || []).map(id => byId.get(id)).filter(Boolean).every(item => motionAxesOf(item) >= axes);
      const water = compatible(groups.motion) && groups.motion.memberFixtureIds.length ? groups.motion
        : builderGroups(studio, items).find(g => g.memberFixtureIds?.length && compatible(g));
      if (!water) { setNote(`This design has no compatible ${axes}D moving-nozzle group.`); return; }
      const made = motionPatternRecipes({ start, duration: 15, name: type.name, groupId: water.id, lightGroupId: groups.lights?.id,
        field: type.field, motion: type.motion, light: type.light, order: water.orderMode || 'engineering' });
      const missing = [water, groups.lights].filter(g => g && !studio.groups.some(x => x.id === g.id)).map(({ source, quick, ...g }) => g);
      onChange(s => ({ ...s, groups: [...s.groups, ...missing], recipes: [...s.recipes, ...made.recipes] }));
      setSelectedId(`unit:${made.unitId}`); return;
    }
    if (!groups.water) return;
    const { recipes, unitId } = fieldUnitRecipes({ kind, start, duration: 15, waterGroupId: groups.water.id, lightGroupId: groups.lights?.id,
      order: groups.water.orderMode === 'counter-clockwise' ? 'counter-clockwise' : 'clockwise',
      ...(type ? { name: type.name, field: type.field, light: type.light } : {}) });
    const missing = [groups.water, groups.lights].filter(g => g && !studio.groups.some(x => x.id === g.id)).map(({ source, quick, ...g }) => g);
    onChange(s => ({ ...s, groups: [...s.groups, ...missing], recipes: [...s.recipes, ...recipes] }));
    setSelectedId(`unit:${unitId}`);
  };
  const addAsset = (asset, at = time) => {
    let result = null;
    onChange(s => { result = importPatterns(s, patternAssetFile(asset), items, { at }); return result.studio; });
    setAssetsOpen(false);
    if (!result?.added) { setNote(result?.notes?.[0] || 'This design has no compatible group for that pattern.'); return; }
    const recipe = result.studio.recipes.find(r => r.id === result.addedRecipeIds[0]);
    if (recipe) {
      const unitId = recipe.pattern?.id || (recipe.effect === 'field' ? recipe.id : null);
      setSelectedId(unitId ? `unit:${unitId}` : `recipe:${recipe.id}`);
    }
    setNote(`Added “${asset.name}” — edit the copy in the inspector.`);
  };
  const dropAsset = e => {
    const id = e.dataTransfer.getData(PATTERN_ASSET_DRAG_MIME);
    const asset = patternAssetById(id);
    if (!asset || !scroller.current) return;
    e.preventDefault();
    const rect = scroller.current.getBoundingClientRect();
    const at = Math.max(0, Math.min(length, (e.clientX - rect.left + scroller.current.scrollLeft - 12) / pps));
    addAsset(asset, snapToMusic(at, beatGrid(music.analysis)));
  };
  const exportBlocks = list => {
    const real = list.filter(b => !b.background);
    if (!real.length) { setNote('No patterns to export'); return; }
    const data = exportPatterns(studio, real);
    onExportFile(fileName(real.length === 1 ? real[0].name : 'show_patterns'), JSON.stringify(data, null, 1));
    setNote(`Exported ${real.length} pattern${real.length === 1 ? '' : 's'}`);
  };
  const importFile = async file => {
    if (!file) return;
    try {
      const text = await readText(file);
      let result = null;
      onChange(s => { result = importPatterns(s, text, items); return result.studio; });
      setNote(`Imported ${result.added} pattern${result.added === 1 ? '' : 's'}${result.skipped ? ` · ${result.skipped} left out` : ''}${result.notes.length ? ` — ${result.notes[0]}` : ''}`);
    } catch (error) { setNote(error.message); }
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
        <button className="sp-primary" aria-expanded={!!menu} onClick={e => {
          // Fixed position above the button: the timeline panel clips anything inside it.
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(m => m ? false : { left: r.left, bottom: window.innerHeight - r.top + 4, maxHeight: Math.max(160, r.top - 12) });
        }}>+ Add pattern</button>
        {menu && <div className="seq-menu" role="menu" style={menu}>
          <button role="menuitem" className="seq-menu-create" onClick={() => { setMenu(false); setCreator({ block: null }); }}><b>✎ Create your own pattern…</b><small>Build a pattern from a movement shape, a path, timing, height and lights</small></button>
          {myTypes(studio).length > 0 && <div className="seq-menu-head">MY PATTERNS</div>}
          {myTypes(studio).map(t => <button key={t.id} role="menuitem" onClick={() => add('custom', t)}><b>★ {t.name}</b><small>Your pattern type</small></button>)}
          <div className="seq-menu-head">READY-MADE</div>
          {FIELD_KINDS.map(k => <button key={k.id} role="menuitem" onClick={() => add(k.id)}><b>{k.label}</b><small>{k.hint}</small></button>)}
          <button role="menuitem" onClick={() => { setMenu(false); onPatternBuilder(); }}><b>Pattern builder…</b><small>Chase, ripple, sparkle, pulse and music-synced patterns</small></button>
        </div>}
      </div>
      <div className="seq-add">
        <button aria-expanded={assetsOpen} onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(false); setProjectOpen(false);
          setAssetsOpen(open => open ? false : { left: Math.max(10, Math.min(r.left, window.innerWidth - 450)), bottom: window.innerHeight - r.top + 4, maxHeight: Math.max(220, r.top - 12) });
        }}>▦ Pattern assets ({PATTERN_ASSETS.length})</button>
        {assetsOpen && <PatternAssetBrowser style={assetsOpen} onUse={addAsset} onCustomize={asset => { setAssetsOpen(false); setCreator({ asset }); }} />}
      </div>
      <div className="seq-add">
        <button aria-expanded={projectOpen} title="Find and edit any pattern in this show, including blocks in later vertical lanes" onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(false); setAssetsOpen(false);
          setProjectOpen(open => open ? false : { left: Math.max(10, Math.min(r.left, window.innerWidth - 450)), bottom: window.innerHeight - r.top + 4, maxHeight: Math.max(260, r.top - 12) });
        }}>▤ Project patterns ({projectBlocks.length})</button>
        {projectOpen && <ProjectPatternBrowser style={projectOpen} blocks={projectBlocks} onSelect={revealProjectBlock} />}
      </div>
      <button onClick={() => setCreator({ block: null })} title="Build your own pattern from its basic pieces">✎ Create pattern</button>
      <button onClick={onPatternBuilder} title="Chase, ripple, sparkle, pulse and music-synced patterns">✦ Pattern builder</button>
      <button onClick={() => exportBlocks(selected ? [selected] : blocks)} title={selected ? 'Save the selected pattern to a file' : 'Save every pattern in the show to a file'}>⤓ Export{selected ? '' : ' all'}</button>
      <button onClick={() => importRef.current?.click()} title="Add patterns from a pattern file">⤒ Import</button>
      <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Import patterns file" onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
      {extras}
      {note && <span className="seq-muted seq-note">{note}</span>}
      <span className="sp-grow" />
      {music.lanes.length > 0
        ? <button onClick={() => setShowMusic(v => !v)} aria-pressed={showMusic} title="Show or hide the music graph (frequency bands per stem, bars, beats, sections)">♫ Music</button>
        : <button onClick={() => stemsApi.split(song)} disabled={!song || stemsApi.status === 'working'}
          title={song ? 'Analyse the song: frequency graph of the whole song and of its drums, bass and vocals (estimated), shown above the patterns' : 'Load the show song first'}>
          {stemsApi.status === 'working' ? `♫ Analysing… ${stemsApi.done}%` : '♫ Music graph'}</button>}
      <button onClick={() => setZoom(0)} aria-pressed={zoom === 0} title="Fit the whole show">Fit</button>
      <button onClick={() => setZoom(z => Math.max(2, (z || pps) / 1.5))} title="Zoom out">−</button>
      <button onClick={() => setZoom(z => Math.min(200, (z || pps) * 1.5))} title="Zoom in">+</button>
      <button onClick={onProgrammingView} title="Show the group / channel rows used in Show Programming">Programming view</button>
    </div>
    <div className="seq-body">
      <div className="seq-scroll" ref={scroller} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onDragOver={e => { if (e.dataTransfer?.types?.includes(PATTERN_ASSET_DRAG_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={dropAsset}
        onScroll={e => setScrollLeft(e.currentTarget.scrollLeft)}>
        <div className="seq-canvas" style={{ width: length * pps + 24, height: 26 + musicH + lanes * LANE_H + 8 }}>
          <div className="seq-ruler" onPointerDown={seekAt}>
            {ticks.map(t => <span key={t} style={{ left: 12 + t * pps }}>{fmt(t)}</span>)}
            {(studio.markers || []).map(m => <i key={m.id} className="seq-marker" style={{ left: 12 + m.time * pps }} title={m.name} />)}
          </div>
          <PlanStrip studio={studio} items={items} analysis={music.analysis} pps={pps} onChange={onChange} />
          {showMusic && <MusicLanes lanes={music.lanes} analysis={songGrid} pps={pps} scrollLeft={scrollLeft} viewWidth={width} onSeek={seekAt} />}
          <div className="seq-lanes" onPointerDown={e => { if (e.target === e.currentTarget) { setSelectedId(null); seekAt(e); } }}>
            {blocks.map(raw => { const b = dragged(raw); const owner = ownerOfBlock(b, owners, studio.legacyClips);
              const left = 12 + b.start * pps, w = Math.max(6, b.duration * pps), compact = w < 90;
              return <div key={b.id}
              className={`seq-block ${b.type}${b.id === selectedId ? ' selected' : ''}${b.background ? ' background' : ''}${b.muted ? ' muted' : ''}${owner ? ' owned' : ''}`}
              style={{ left, width: w, top: b.lane * LANE_H + 4, '--block': b.color, '--owner-color': owner?.color, '--sticky': `${stickyOffset(left, w, scrollLeft)}px` }}
              role="button" tabIndex={0} aria-label={b.name} aria-description={owner ? `${ownerLabel(owner)} — ${ownerSummary(owner)}` : undefined} aria-pressed={b.id === selectedId}
              onPointerDown={e => { if (e.button === 0) startDrag(e, raw, 'move'); }}
              onKeyDown={e => { if (e.key === 'Enter') setSelectedId(b.id); if (e.key === 'Delete') { onChange(s => deleteBlock(s, raw)); setSelectedId(null); } }}
              onContextMenu={e => { e.preventDefault(); setSelectedId(b.id); setContext({ id: b.id, x: e.clientX, y: e.clientY }); }}
              onDoubleClick={() => b.type === 'builder' && onEditInBuilder(b.recipeIds[0])}
              title={clipTooltip({ owner, name: b.name, kind: b.kindLabel, start: b.start, duration: b.duration, level: b.water?.intensity })}>
              {owner && <span className="seq-owner" aria-hidden="true" data-owner-kind={owner.kind}><i className="seq-owner-swatch" />{!compact && <b>{ownerLabel(owner)}{owner.also ? ` + ${owner.also.name}` : ''}</b>}</span>}
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
          {['field', 'recipe', 'motion'].includes(selected.type) && <label className="seq-field"><span>Target group</span>
            <select value={selected.motion?.groupId || selected.water.groupId} onChange={e => {
              const groupId = e.target.value;
              if (selected.type === 'field') patch({ groupId });
              else if (selected.type === 'motion') onChange(s => updateMotionUnit(s, selected, { groupId }));
              else onChange(s => updateRecipeBlock(s, selected, { groupId }));
            }}>{builderGroups(studio, items).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
          {selected.type === 'motion' && <>
            <button className="seq-creator-btn" onClick={() => setCreator({ block: selected })}>✎ Edit {selected.motion.motion?.axes || 1}D pattern</button>
            <p className="seq-hint">Coordinated water, {selected.motion.motion?.axes || 1}D motion{selected.lights ? ' and lights' : ''}. Open the creator to change every layer.</p>
          </>}
          {selected.type === 'field' && <button className="seq-creator-btn" onClick={() => setCreator({ block: selected })}>
            ✎ {selected.water.field?.kind === 'custom' ? 'Edit in pattern creator' : 'See how it is made (pattern creator)'}</button>}
          {selected.type === 'field' && <FieldInspector block={selected} studio={studio} items={items}
            onPatch={p => patch(p)} onPatchLive={p => patch(p, true)} />}
          {selected.type === 'builder' && <button onClick={() => onEditInBuilder(selected.recipeIds[0])}>✦ Edit in builder</button>}
          {selected.type === 'recipe' && <RecipeInspector block={selected} onPatch={p => onChange(s => updateRecipeBlock(s, selected, p))} />}
          {selected.type === 'recorded' && <p className="seq-hint">Recorded pattern ({selected.legacyIds.length} cues). You can move or delete it.
            To change its shape, add a new pattern with “+ Add pattern”.</p>}
          <div className="seq-actions">
            <button onClick={() => exportBlocks([selected])} title="Save this pattern to a file">⤓ Export</button>
            <button onClick={() => { let id = null; onChange(s => { const r = duplicateBlock(s, selected); id = r.blockId; return r.studio; }); setTimeout(() => id && setSelectedId(id)); }}>Duplicate</button>
            <button onClick={() => { onChange(s => deleteBlock(s, selected)); setSelectedId(null); }}>Delete</button>
          </div>
        </div>
      </aside>}
    </div>
    {creator && <PatternCreator dock initialMode={creator.block?.motion?"motion":"curve"} key={creator.block?.id || creator.asset?.id || 'new'} studio={studio} items={items} start={creator.block ? creator.block.start : nextStart()}
      editBlock={creator.block} asset={creator.asset} onChange={onChange} onAdded={unitId => setSelectedId(`unit:${unitId}`)}
      onClose={() => setCreator(null)} onExportFile={onExportFile} />}
    {context && (() => { const b = blocks.find(x => x.id === context.id); if (!b) return null; const close = () => setContext(null);
      return <div className="seq-context" role="menu" style={{ left: context.x, top: Math.min(context.y, window.innerHeight - 140) }}>
        {b.type === 'builder' && <button role="menuitem" onClick={() => { close(); onEditInBuilder(b.recipeIds[0]); }}>✦ Edit in builder</button>}
        <button role="menuitem" onClick={() => { close(); onChange(s => duplicateBlock(s, b).studio); }}>Duplicate</button>
        <button role="menuitem" onClick={() => { close(); onChange(s => deleteBlock(s, b)); setSelectedId(null); }}>Delete</button>
      </div>; })()}
  </div>;
}
