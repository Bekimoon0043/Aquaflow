import { useMemo, useState } from 'react';
import useEngineeringStore from '../../../store/engineeringStore';
import { resolveMembers } from './showModel';
import {
  DIRECTIONS, MIRROR_DIRECTIONS, PATTERN_PRESETS, PRESET_CONTROLS, QUICK_LIGHTS, QUICK_WATER, SMOOTHNESS,
  applyMatchingLights, applyPattern, builderGroups, defaultOptions, isLightItem, isWaterItem, presetById,
  raiseJetsPatch, showVisibility, snapCycles, visibilityCheck,
} from './patternPresets';
import './patternBuilder.css';

// Per-preset bar animation delays (5 bars) for the small card icons.
const ICON_DELAYS = {
  wave: [0, .15, .3, .45, .6], chase: [0, .2, .4, .6, .8], ripple: [.4, .2, 0, .2, .4],
  breathing: [0, 0, 0, 0, 0], mirror: [0, .25, .5, .25, 0], sparkle: [.5, .1, .7, .3, .9],
};
function PresetIcon({ id }) {
  return <svg className={`pb-icon pb-icon-${id}`} viewBox="0 0 50 22" aria-hidden="true">
    {ICON_DELAYS[id].map((delay, i) => <rect key={i} x={3 + i * 9.5} y={2} width={6} height={18} rx={2} style={{ animationDelay: `${delay}s` }} />)}
  </svg>;
}

function Slider({ label, value, min, max, step = 1, onChange, unit = '', tip, display }) {
  return <label className="pb-slider" title={tip}>
    <span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    <output>{display ?? `${value}${unit}`}</output>
  </label>;
}

const groupLabel = (g, count) => `${g.name} (${count})`;

/**
 * Pattern builder — pick a group, a preset and a few sliders; Apply commits one
 * undoable studio change. The dialog is non-modal so the 3D preview stays visible.
 */
export default function PatternBuilder({ studio, items, params = {}, showLength = 30, onChange, onUndo, onClose, onEngineeringPatch }) {
  const groups = useMemo(() => builderGroups(studio, items), [studio, items]);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const membersOf = g => (g ? resolveMembers(g, items).map(id => byId.get(id)).filter(Boolean) : []);
  const waterGroups = groups.filter(g => membersOf(g).some(isWaterItem));
  const lightGroups = groups.filter(g => membersOf(g).some(isLightItem));
  const initialGroup = (waterGroups.find(g => g.id === QUICK_WATER) || waterGroups[0] || groups[0])?.id || '';
  const [groupId, setGroupId] = useState(initialGroup);
  const [preset, setPreset] = useState('wave');
  const [options, setOptions] = useState(() => defaultOptions('wave', { start: 0, duration: showLength }));
  const [lights, setLights] = useState({ enabled: false, groupId: (lightGroups.find(g => g.id === QUICK_LIGHTS) || lightGroups[0])?.id || '', color: '#4f8cff', level: 30 });
  const [applied, setApplied] = useState([]);
  const [raise, setRaise] = useState(null);
  const [note, setNote] = useState('');

  const group = groups.find(g => g.id === groupId);
  const lightGroup = groups.find(g => g.id === lights.groupId);
  const members = membersOf(group);
  const controls = PRESET_CONTROLS[preset];
  const set = patch => setOptions(o => ({ ...o, ...patch }));
  const timing = snapCycles(options.duration, options.lapSeconds);
  const minLevel = controls.minLevel ? Math.min(options.minLevel, options.maxLevel) : 0;
  const visibility = visibilityCheck({ members, params, minLevel, maxLevel: options.maxLevel });
  const pick = id => {
    setPreset(id);
    setOptions(o => ({ ...defaultOptions(id, { start: o.start, duration: o.duration, color: o.color }) }));
  };

  const apply = () => {
    if (!group) return;
    const previous = applied.at(-1);
    let base = studio;
    if (previous) base = { ...studio, recipes: studio.recipes.filter(r => !previous.recipeIds.includes(r.id)) };
    const before = new Set(base.groups.map(g => g.id));
    const water = applyPattern(base, { preset, options: { ...options, minLevel }, group, items });
    let next = water.studio;
    const recipeIds = water.recipes.map(r => r.id);
    if (lights.enabled && lightGroup) {
      const lit = applyMatchingLights(next, water.recipes, { group: lightGroup, items, color: lights.color, level: lights.level, floor: .2 });
      next = lit.studio;
      recipeIds.push(...lit.recipes.map(r => r.id));
    }
    if (previous) next = { ...next, groups: next.groups.filter(g => !previous.createdGroupIds.includes(g.id) || next.recipes.some(r => r.groupId === g.id)) };
    const createdGroupIds = [...(previous?.createdGroupIds || []), ...next.groups.filter(g => !before.has(g.id)).map(g => g.id)].filter(id => next.groups.some(g => g.id === id));
    onChange(next);
    setApplied(list => [...list, { recipeIds, createdGroupIds }]);
    setNote(`${presetById(preset).label} ${previous ? 'updated' : 'added'} · ${timing.cycles} lap${timing.cycles > 1 ? 's' : ''}`);
  };
  const undo = () => {
    onUndo?.();
    setApplied(list => list.slice(0, -1));
    setNote('Undone');
  };
  const confirmRaise = () => {
    const engineering = useEngineeringStore.getState();
    const patch = raiseJetsPatch(engineering.fixtures, visibility?.jetIds || [], engineering.params || params, raise.height);
    (onEngineeringPatch || engineering.updateEngineering)({ fixtures: patch.fixtures, params: patch.params });
    setRaise(null);
    setNote(`Jet design height set to ${patch.heightM} m${patch.headChanged ? ` · pump head ${patch.headM} m` : ''}`);
  };
  const raiseSummary = () => {
    const engineering = useEngineeringStore.getState();
    const patch = raiseJetsPatch(engineering.fixtures, visibility?.jetIds || [], engineering.params || params, raise.height);
    return `${visibility?.jetIds.length || 0} jets → ${patch.heightM} m${patch.headChanged ? `, pump head → ${patch.headM} m` : ''}`;
  };

  const groupOptions = list => {
    const sources = [...new Set(list.map(g => g.source))];
    return sources.map(source => <optgroup key={source} label={source}>
      {list.filter(g => g.source === source).map(g => <option key={g.id} value={g.id}>{groupLabel(g, membersOf(g).length)}{g.quick ? ' · new' : ''}</option>)}
    </optgroup>);
  };

  return <div className="pattern-builder" role="dialog" aria-label="Pattern builder">
    <div className="pb-head"><strong>Pattern builder</strong><span className="sp-grow" />
      <button onClick={onClose} aria-label="Close pattern builder" title="Close">✕</button></div>

    <label className="pb-row" title="Which jets the pattern runs on. Quick groups are created on Apply; fixture data is not changed.">
      <span>Group</span>
      <select aria-label="Pattern group" value={groupId} onChange={e => setGroupId(e.target.value)}>
        {!groups.length && <option value="">No programmable items</option>}
        {groupOptions(groups)}
      </select>
    </label>
    {group?.quick && <small className="pb-hint">Creates group “{group.name}”, ordered clockwise</small>}

    <div className="pb-presets" role="radiogroup" aria-label="Pattern preset">
      {PATTERN_PRESETS.map(p => <button key={p.id} role="radio" aria-checked={preset === p.id} className={preset === p.id ? 'active' : ''} title={p.hint} onClick={() => pick(p.id)}>
        <PresetIcon id={p.id} /><b>{p.label}</b><small>{p.hint}</small>
      </button>)}
    </div>

    <div className="pb-controls">
      <Slider label="Speed" min={1} max={60} step={.5} value={options.lapSeconds} onChange={v => set({ lapSeconds: v })}
        tip="Seconds for one lap. Snapped so a whole number of laps fills the clip and the loop is seamless."
        display={`${timing.lapSeconds} s/lap`} />
      <small className="pb-hint" title={timing.snapped ? `You chose ${timing.requested} s; ${timing.cycles} whole laps fit ${options.duration} s exactly.` : 'Whole laps — the loop is seamless.'}>
        ↻ {timing.cycles} lap{timing.cycles > 1 ? 's' : ''}{timing.snapped ? ` · snapped to ${timing.lapSeconds} s for a seamless loop` : ' · seamless loop'}
      </small>
      {controls.minLevel && <Slider label="Low" unit=" %" min={0} max={100} value={options.minLevel} onChange={v => set({ minLevel: Math.min(v, options.maxLevel) })} tip="Lowest water level between crests" />}
      <Slider label="High" unit=" %" min={5} max={100} value={options.maxLevel} onChange={v => set({ maxLevel: v, minLevel: Math.min(options.minLevel, v) })} tip="Highest water level at the crest" />
      {controls.direction && <label className="pb-row" title={preset === 'mirror' ? 'Halves move towards or away from the middle' : 'Which way the crest travels'}>
        <span>Direction</span>
        <select aria-label="Direction" value={options.order} onChange={e => set({ order: e.target.value })}>
          {(preset === 'mirror' ? MIRROR_DIRECTIONS : DIRECTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>}
      {preset === 'mirror' && <label className="pb-row" title="Where the group is cut in two">
        <span>Split</span>
        <select aria-label="Mirror split" value={options.axis} onChange={e => set({ axis: e.target.value })}>
          <option value="sides">Left | right</option><option value="front-back">Front | back</option>
        </select>
      </label>}
      {controls.crests && <Slider label="Crests" min={1} max={4} value={options.crests} onChange={v => set({ crests: v })} tip="How many crests chase each other around the group" />}
      {controls.smoothness && <div className="pb-row" title="Shape of each crest"><span>Shape</span>
        <div className="pb-segment" role="radiogroup" aria-label="Shape">
          {SMOOTHNESS.map(([id, label]) => <button key={id} role="radio" aria-checked={options.smoothness === id} className={options.smoothness === id ? 'active' : ''} onClick={() => set({ smoothness: id })}>{label}</button>)}
        </div></div>}
      <div className="pb-row pb-times">
        <label title="Start time in seconds"><span>Start</span><input aria-label="Start" type="number" min={0} max={599} step={.5} value={options.start} onChange={e => set({ start: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label title="Clip length in seconds"><span>Length</span><input aria-label="Length" type="number" min={1} max={600} step={.5} value={options.duration} onChange={e => set({ duration: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <button onClick={() => set({ start: 0, duration: showLength })} title={`Whole show: 0–${showLength} s`}>Whole show</button>
        <input aria-label="Water colour" type="color" value={options.color} onChange={e => set({ color: e.target.value })} title="Clip colour" />
      </div>
    </div>

    <div className="pb-lights">
      <label className="pb-check" title="Adds a light pattern with the same order, laps and spread"><input type="checkbox" checked={lights.enabled} disabled={!lightGroups.length} onChange={e => setLights(l => ({ ...l, enabled: e.target.checked }))} />
        Lights match the water{!lightGroups.length && <small> · no lights</small>}</label>
      {lights.enabled && <>
        <label className="pb-row"><span>Lights</span>
          <select aria-label="Light group" value={lights.groupId} onChange={e => setLights(l => ({ ...l, groupId: e.target.value }))}>{groupOptions(lightGroups)}</select>
          <input aria-label="Light colour" type="color" value={lights.color} onChange={e => setLights(l => ({ ...l, color: e.target.value }))} title="Light colour" />
        </label>
        <Slider label="Brightness" unit=" %" min={5} max={100} value={lights.level} onChange={v => setLights(l => ({ ...l, level: v }))} tip="Softer than the water by default" />
      </>}
    </div>

    {visibility?.warnings.length > 0 && <div className="pb-warnings" role="alert">
      {visibility.warnings.map(w => <div key={w.code} className="pb-warning" title={w.detail}><span>⚠ {w.text}</span>
        {w.code === 'low' && options.maxLevel < 100 && <button onClick={() => set({ maxLevel: 100 })}>Use 100% level</button>}
        {w.code === 'low' && <button onClick={() => setRaise({ height: Math.max(2, Math.ceil((visibility.reachM + .5) * 2) / 2) })}>Raise jet design height</button>}
        {w.code === 'subtle' && controls.minLevel && <button onClick={() => set({ minLevel: Math.round(options.maxLevel * .2) })}>Widen range</button>}
      </div>)}
      {raise && <div className="pb-confirm">
        <label title="New design jet height for these jets (Engineering data)"><span>Jet height</span>
          <input aria-label="New jet height" type="number" min={.5} max={30} step={.5} value={raise.height} onChange={e => setRaise({ height: Number(e.target.value) || 2 })} /> m</label>
        <small>Changes Engineering: {raiseSummary()}</small>
        <button className="sp-primary" onClick={confirmRaise}>Confirm</button><button onClick={() => setRaise(null)}>Cancel</button>
      </div>}
    </div>}
    {visibility && !visibility.warnings.length && <small className="pb-ok" title={`Limited by ${visibility.limitedBy}`}>Jets about {visibility.maxHeightM.toFixed(1)} m tall · {visibility.motionM.toFixed(1)} m of movement</small>}

    <div className="pb-foot">
      {note && <span className="pb-note" role="status">{note}</span>}
      <span className="sp-grow" />
      <button onClick={undo} disabled={!applied.length} title="Undo the last Apply">↶ Undo</button>
      <button className="sp-primary" onClick={apply} disabled={!group || !members.length}>{applied.length ? 'Update' : 'Apply'}</button>
      <button onClick={onClose}>Done</button>
    </div>
  </div>;
}

/** Small timeline badge: shows when any pattern's jets will be hard to see. */
export function VisibilityBadge({ studio, items, params }) {
  const list = useMemo(() => showVisibility(studio, items, params), [studio, items, params]);
  if (!list.length) return null;
  const low = list.some(v => v.warnings.some(w => w.code === 'low'));
  const tip = list.slice(0, 8).map(v => `${v.name}: ${v.warnings.map(w => w.text).join(' · ')}`).join('\n');
  return <span className="pb-badge" title={tip} role="status">⚠ {low ? 'Low jets' : 'Subtle motion'}</span>;
}
