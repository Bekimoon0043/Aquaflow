// Pattern creator: build your own pattern from the basic pieces of every fountain pattern —
// how one jet moves (shape), how that spreads across the jets (path), timing, height and
// lights — with a live preview. Add it to the timeline, save it as your own pattern type,
// or export / import pattern types.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ORIGINS, PATHS, SHAPES, fieldLevel, memberGeometry, shapeValue } from './wavePatterns';
import { EXAMPLES, cleanType, exportTypes, importTypes, loadMyTypes, myTypes, saveMyTypes, saveTypeToProject, upsertType } from './customPatterns';
import { defaultFieldGroups, fieldUnitRecipes, updateFieldUnit } from './showBlocks';

const PREVIEW_JETS = 48;
const DRAW_POINTS = 9;

// A small triangle of jets (tip at the top) so every path previews like the real basin.
const previewMembers = (() => {
  const corners = [[0, -1], [1, 0.75], [-1, 0.75]];
  const out = [];
  for (let i = 0; i < PREVIEW_JETS; i++) {
    const u = (i / PREVIEW_JETS) * 3, k = Math.floor(u), t = u - k;
    const a = corners[k], b = corners[(k + 1) % 3];
    out.push({ id: `p${i}`, x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t });
  }
  return out;
})();

function resample(points) {
  return Array.from({ length: DRAW_POINTS }, (_, i) => {
    const time = i / (DRAW_POINTS - 1);
    return { time, value: Math.round(shapeValue({ shape: 'drawn', points }, time) * 100) / 100 };
  });
}

function Slider({ label, value, min, max, step = 1, suffix = '', onChange, hint }) {
  return <label className="pc-field" title={hint}><span>{label}</span>
    <span className="pc-num"><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} aria-label={label} />
      <input type="number" min={min} max={max} step={step} value={value} aria-label={`${label} value`}
        onChange={e => { const v = Number(e.target.value); if (e.target.value !== '' && v >= min && v <= max) onChange(v); }} />
      {suffix && <small>{suffix}</small>}</span></label>;
}

function Choice({ options, value, onChange, label }) {
  return <div className="pc-choices" role="radiogroup" aria-label={label}>
    {options.map(([id, title, hint]) => <button key={id} role="radio" aria-checked={value === id} className={value === id ? 'on' : ''}
      onClick={() => onChange(id)} title={hint}><b>{title}</b><small>{hint}</small></button>)}
  </div>;
}

function ShapeGraph({ field, onDraw }) {
  const W = 260, H = 84, pad = 6;
  const pts = Array.from({ length: 81 }, (_, i) => { const x = i / 80; return [pad + x * (W - 2 * pad), H - pad - shapeValue(field, x) * (H - 2 * pad)]; });
  const dragging = useRef(null);
  const drawn = field.shape === 'drawn' ? field.points : null;
  const move = e => {
    if (dragging.current === null || !drawn) return;
    const r = e.currentTarget.getBoundingClientRect();
    const value = Math.min(1, Math.max(0, 1 - (e.clientY - r.top - pad) / (r.height - 2 * pad)));
    onDraw(drawn.map((p, i) => i === dragging.current ? { ...p, value: Math.round(value * 100) / 100 } : p));
  };
  return <svg className="pc-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Movement of one jet over one cycle"
    onPointerMove={move} onPointerUp={() => { dragging.current = null; }} onPointerLeave={() => { dragging.current = null; }}>
    <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} className="pc-axis" />
    <polyline points={pts.map(p => p.join(',')).join(' ')} className="pc-line" />
    {drawn && drawn.map((p, i) => <circle key={i} cx={pad + p.time * (W - 2 * pad)} cy={H - pad - p.value * (H - 2 * pad)} r={6} className="pc-handle"
      onPointerDown={e => { e.currentTarget.ownerSVGElement?.setPointerCapture?.(e.pointerId); dragging.current = i; }} />)}
  </svg>;
}

function Preview({ field, light }) {
  const [t, setT] = useState(1.2);
  useEffect(() => {
    let alive = true, last = performance.now(), handle;
    const raf = globalThis.requestAnimationFrame || (fn => setTimeout(() => fn(performance.now()), 50));
    const cancel = globalThis.cancelAnimationFrame || clearTimeout;
    const tick = now => { if (!alive) return; setT(v => (v + (now - last) / 1000) % 600); last = now; handle = raf(tick); };
    handle = raf(tick);
    return () => { alive = false; cancel(handle); };
  }, []);
  const geo = useMemo(() => memberGeometry(previewMembers, { origin: field.origin || 'tip' }), [field.origin]);
  const span = Math.max(4, field.period * 2);
  const local = 1.2 + (t % span); // stay clear of the soft start
  const levels = geo.map(g => fieldLevel({ ...field, ease: 0 }, g, local, local + 100));
  const W = 300, H = 120;
  const colour = i => light.colorMode === 'sequence' && light.colors?.length ? light.colors[Math.min(light.colors.length - 1, Math.floor(((t % 12) / 12) * light.colors.length))]
    : light.colorMode === 'rainbow' ? `hsl(${Math.round(((i / PREVIEW_JETS - local / 10) % 1 + 1) % 1 * 360)} 90% 60%)` : light.color;
  return <div className="pc-preview">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Live preview of the jets">
      {previewMembers.map((m, i) => {
        const cx = W / 2 + m.x * 120, cy = 58 + m.y * 46, h = levels[i] / 100 * 34;
        return <g key={m.id}><line x1={cx} x2={cx} y1={cy} y2={cy - h} stroke={colour(i)} strokeWidth="3" strokeLinecap="round" opacity={0.35 + levels[i] / 160} />
          <circle cx={cx} cy={cy} r="1.6" fill="#7f95a8" /></g>;
      })}
    </svg>
    <small>Live preview: {PREVIEW_JETS} jets around a triangle (tip at the top) — taller line = higher water</small>
  </div>;
}

const EXAMPLE_FOR_KIND = { rolling: 'Rolling wave', travelling: 'Travelling wave', seesaw: 'See-saw', swell: 'Grand swell',
  sweep: 'Converge & split', crossing: 'Crossing waves', stadium: 'Stadium wave', finale: 'Rainbow finale' };

/** The pattern creator's version of a block: custom blocks as they are, ready-made ones as their recipe. */
export function creatorTypeFromBlock(block) {
  const w = block.water.field || {}, lights = block.lights;
  const light = { color: lights?.color || block.water.color, colorMode: lights?.field?.colorMode, colors: lights?.field?.colors, low: lights?.field?.low, high: lights?.field?.high };
  if (w.kind === 'custom') return cleanType({ name: block.name, field: w, light });
  const example = EXAMPLES.find(x => x.name === EXAMPLE_FOR_KIND[w.kind]) || EXAMPLES[1];
  const same = {};
  for (const k of ['period', 'crests', 'width', 'origin', 'direction', 'block', 'drift', 'low', 'high', 'lowFar', 'highFar', 'stairs', 'accel', 'ease']) if (w[k] !== undefined) same[k] = w[k];
  if (w.kind === 'swell') same.spread = (Number(w.lag) || 0) / Math.max(0.2, Number(w.period) || 5);
  if (w.kind === 'sweep' || w.kind === 'stadium') delete same.crests;
  return cleanType({ name: block.name, field: { ...example.field, ...same }, light: { ...example.light, ...light } });
}

export default function PatternCreator({ studio, items, start = 0, editBlock = null, onChange, onClose, onExportFile }) {
  const initial = editBlock ? creatorTypeFromBlock(editBlock) : cleanType({ name: 'My pattern', field: { shape: 'sine', path: 'around' } });
  const [type, setType] = useState(initial);
  const [farEnd, setFarEnd] = useState(initial.field.lowFar !== undefined && (initial.field.lowFar !== initial.field.low || initial.field.highFar !== initial.field.high));
  const [note, setNote] = useState('');
  const [library, setLibrary] = useState(() => myTypes(studio));
  const importRef = useRef(null);
  const f = type.field, L = type.light;
  const set = patch => setType(t => cleanType({ ...t, field: { ...t.field, ...patch } }));
  const setLight = patch => setType(t => cleanType({ ...t, light: { ...t.light, ...patch } }));
  const effective = farEnd ? f : { ...f, lowFar: f.low, highFar: f.high, stairs: 0 };

  const load = example => { setType(cleanType({ ...example, name: example.name })); setFarEnd(example.field.lowFar !== undefined && example.field.lowFar !== example.field.low); setNote(`Loaded “${example.name}” — change any piece to make it yours.`); };
  const add = () => {
    const groups = defaultFieldGroups(studio, items);
    if (!groups.water) { setNote('This design has no jets to program.'); return; }
    if (editBlock) {
      onChange(s => updateFieldUnit(s, editBlock, { kind: 'custom', name: type.name, field: effective, light: { color: L.color, low: L.low, high: L.high, colorMode: L.colorMode, colors: L.colors } }));
      setNote('Pattern updated'); return;
    }
    const { recipes } = fieldUnitRecipes({ kind: 'custom', start, duration: 15, name: type.name, field: effective,
      waterGroupId: groups.water.id, lightGroupId: groups.lights?.id, light: L, order: 'clockwise' });
    const missing = [groups.water, groups.lights].filter(g => g && !studio.groups.some(x => x.id === g.id)).map(({ source, quick, ...g }) => g);
    onChange(s => ({ ...s, groups: [...s.groups, ...missing], recipes: [...s.recipes, ...recipes] }));
    setNote(`Added “${type.name}” to the timeline at ${start.toFixed(1)} s`);
  };
  const save = () => {
    const clean = cleanType({ ...type, field: effective });
    onChange(s => saveTypeToProject(s, clean));
    const lib = upsertType(loadMyTypes(), clean); saveMyTypes(lib);
    setLibrary([...myTypes({ presets: [...(studio.presets || []).filter(p => !(p.kind === 'field-type' && p.name === clean.name)), { ...clean, kind: 'field-type' }] })]);
    setNote(`Saved “${clean.name}” to My patterns — it is now in + Add pattern`);
  };
  const exportAll = () => {
    const list = library.length ? library : [cleanType({ ...type, field: effective })];
    onExportFile(`${list.length === 1 ? list[0].name.replace(/\W+/g, '_') : 'my_pattern_types'}.aqtypes.json`, exportTypes(list));
    setNote(`Exported ${list.length} pattern type${list.length === 1 ? '' : 's'}`);
  };
  const importFile = async file => {
    if (!file) return;
    try {
      const text = typeof file.text === 'function' ? await file.text() : await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsText(file); });
      const incoming = importTypes(text);
      const lib = incoming.reduce(upsertType, loadMyTypes()); saveMyTypes(lib);
      onChange(s => incoming.reduce(saveTypeToProject, s));
      setLibrary(myTypes({ presets: [...(studio.presets || []), ...incoming.map(t => ({ ...t, kind: 'field-type' }))] }));
      setNote(`Imported ${incoming.length} pattern type${incoming.length === 1 ? '' : 's'}`);
    } catch (error) { setNote(error.message); }
  };

  return <div className="pc" role="dialog" aria-label="Pattern creator">
    <header className="pc-head">
      <strong>✎ {editBlock ? 'Edit pattern' : 'Create pattern'}</strong>
      <label className="pc-name"><span>Name</span><input value={type.name} onChange={e => setType(t => ({ ...t, name: e.target.value }))} aria-label="Pattern name" /></label>
      <label className="pc-name"><span>Start from</span>
        <select aria-label="Start from" value="" onChange={e => { const x = [...EXAMPLES, ...library].find(t => t.id === e.target.value); if (x) load(x); }}>
          <option value="">— a blank or an example —</option>
          <optgroup label="How the Lebu patterns are made">{EXAMPLES.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
          {library.length > 0 && <optgroup label="My patterns">{library.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>}
        </select></label>
      <span className="sp-grow" />
      <button onClick={onClose} aria-label="Close pattern creator">✕</button>
    </header>
    <div className="pc-body">
      <div className="pc-steps">
        <section><h4>1 · How one jet moves</h4>
          <Choice label="Shape" options={SHAPES} value={f.shape} onChange={shape => set(shape === 'drawn' && !f.points ? { shape, points: resample(undefined) } : { shape })} />
          <ShapeGraph field={f} onDraw={points => set({ points })} />
          {f.shape === 'drawn' && <p className="pc-hint">Drag the dots up and down to draw the movement of one jet during one cycle.</p>}
          {['bump', 'pulse', 'triangle'].includes(f.shape) && <Slider label="Crest width" value={f.width} min={0.02} max={0.5} step={0.01} onChange={width => set({ width })}
            hint={f.shape === 'triangle' ? 'Half the base of the pointed crest, as a part of the cycle (0.5 = straight up and down with no flat part)' : 'How long the jet stays up, as a part of the cycle'} />}
          {f.shape === 'rise-fall' && <Slider label="Rise time" value={f.rise} min={0.03} max={0.6} step={0.01} onChange={rise => set({ rise })} hint="Part of the cycle used to rise; the rest is the slow fall" />}
        </section>
        <section><h4>2 · How it spreads across the jets</h4>
          <Choice label="Path" options={PATHS} value={f.path} onChange={path => set({ path })} />
          {['around', 'from-point'].includes(f.path) && <Slider label="Waves" value={f.crests} min={f.path === 'from-point' ? 0.25 : 1} max={12} step={f.path === 'from-point' ? 0.01 : 1} onChange={crests => set({ crests })} hint="How many crests are on the jets at the same time" />}
          {f.path === 'around' && <label className="pc-field"><span>Direction</span><select aria-label="Direction" value={f.direction} onChange={e => set({ direction: Number(e.target.value) })}><option value={1}>Clockwise</option><option value={-1}>Counter-clockwise</option></select></label>}
          {['from-point', 'together'].includes(f.path) && <label className="pc-field"><span>Starts from</span><select aria-label="Starts from" value={f.origin} onChange={e => set({ origin: e.target.value })}>{ORIGINS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
          {f.path === 'together' && <Slider label="Delay to the far end" value={f.spread} min={0} max={1} step={0.01} onChange={spread => set({ spread })} hint="0 = every jet exactly together; higher = the far end follows a little later" />}
          {f.path === 'alternate' && <><Slider label="Jets per block" value={f.block} min={1} max={20} onChange={block => set({ block })} />
            <Slider label="Drift" value={f.drift} min={0} max={60} step={0.5} suffix="s" onChange={drift => set({ drift })} hint="Seconds for the blocks to move one step around (0 = they stay in place)" /></>}
          <Slider label="Jets per group" value={f.group} min={1} max={20} onChange={group => set({ group })} hint="Neighbouring jets that move exactly together (1 = every jet on its own)" />
          <label className="pc-check"><input type="checkbox" checked={f.opposite} onChange={e => set({ opposite: e.target.checked })} /> Every other {f.group > 1 ? 'group' : 'jet'} opposite (one rises while the next falls)</label>
        </section>
        <section><h4>3 · Timing</h4>
          <Slider label={f.motion === 'there-and-back' ? 'Seconds there and back' : 'Seconds per cycle'} value={f.period} min={0.5} max={30} step={0.1} suffix="s" onChange={period => set({ period })} />
          <Slider label="Start point in the cycle" value={Math.min(f.offset || 0, f.period)} min={0} max={f.period} step={0.05} suffix="s" onChange={offset => set({ offset })} hint="Where in its cycle the movement is when the pattern starts" />
          <Choice label="Motion" value={f.motion} onChange={motion => set({ motion })} options={[['repeat', 'Repeat', 'The movement repeats every cycle'], ['there-and-back', 'There and back', 'Runs to the far end, then comes back']]} />
          <label className="pc-check"><input type="checkbox" checked={f.bothWays} onChange={e => set({ bothWays: e.target.checked })} /> Both directions at once (crossing)</label>
          <label className="pc-check"><input type="checkbox" checked={f.grow} onChange={e => set({ grow: e.target.checked, accel: e.target.checked && !f.accel ? 0.00375 : f.accel })} /> Build up (grows taller and faster, then settles)</label>
        </section>
        <section><h4>4 · Water height</h4>
          <Slider label="Lowest" value={f.low} min={0} max={100} suffix="%" onChange={low => set({ low })} />
          <Slider label="Highest" value={f.high} min={0} max={100} suffix="%" onChange={high => set({ high })} />
          <label className="pc-check"><input type="checkbox" checked={farEnd} onChange={e => { setFarEnd(e.target.checked); if (e.target.checked && f.lowFar === undefined) set({ lowFar: f.low, highFar: f.high, stairs: 0 }); }} /> Different height at the far end (slope or stairs)</label>
          {farEnd && <><Slider label="Lowest at far end" value={f.lowFar ?? f.low} min={0} max={100} suffix="%" onChange={lowFar => set({ lowFar })} />
            <Slider label="Highest at far end" value={f.highFar ?? f.high} min={0} max={100} suffix="%" onChange={highFar => set({ highFar })} />
            <Slider label="Stair steps (0 = smooth slope)" value={f.stairs ?? 0} min={0} max={12} onChange={stairs => set({ stairs })} /></>}
        </section>
        <section><h4>5 · Lights</h4>
          <label className="pc-field"><span>Colour</span><span className="pc-num"><input type="color" aria-label="Light colour" value={L.color} onChange={e => setLight({ color: e.target.value })} />
            <select aria-label="Colour mode" value={L.colorMode} onChange={e => setLight({ colorMode: e.target.value })}><option value="solid">Solid colour</option><option value="rainbow">Moving rainbow</option><option value="sequence">Colour sequence</option></select></span></label>
          {L.colorMode === 'sequence' && <div className="pc-field"><span>Colours in order (the pattern's time is shared equally)</span><span className="pc-num">
            {L.colors.map((c, k) => <input key={k} type="color" aria-label={`Sequence colour ${k + 1}`} value={c} onChange={e => setLight({ colors: L.colors.map((x, m) => m === k ? e.target.value : x) })} />)}
            <button onClick={() => setLight({ colors: [...L.colors, '#ffffff'].slice(0, 6) })} disabled={L.colors.length >= 6} aria-label="Add colour">+</button>
            <button onClick={() => setLight({ colors: L.colors.slice(0, -1) })} disabled={L.colors.length <= 2} aria-label="Remove colour">−</button></span></div>}
          <Slider label="Lights lowest" value={L.low} min={0} max={100} suffix="%" onChange={low => setLight({ low })} />
          <Slider label="Lights highest" value={L.high} min={0} max={100} suffix="%" onChange={high => setLight({ high })} />
        </section>
      </div>
      <aside className="pc-side">
        <Preview field={effective} light={L} />
        <div className="pc-actions">
          <button className="sp-primary" onClick={add}>{editBlock ? 'Update pattern' : '+ Add to timeline'}</button>
          <button onClick={save} title="Keep this pattern type in this project and on this computer">★ Save as my pattern</button>
          <button onClick={exportAll} title="Save your pattern types to a file">⤓ Export types</button>
          <button onClick={() => importRef.current?.click()} title="Add pattern types from a file">⤒ Import types</button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden aria-label="Import pattern types file" onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        {note && <p className="pc-note" role="status">{note}</p>}
      </aside>
    </div>
  </div>;
}
