import { useMemo, useRef, useState } from 'react';
import useEngineeringStore from '../../../store/engineeringStore';
import { resolveMembers } from './showModel';
import {
  DIRECTIONS, MIRROR_DIRECTIONS, PATTERN_PRESETS, PRESET_CONTROLS, QUICK_LIGHTS, QUICK_WATER, SMOOTHNESS,
  builderGroups, defaultOptions, isLightItem, isWaterItem, presetById,
  raiseJetsPatch, showVisibility, snapCycles, visibilityCheck, buildPatternUnit, builderStateFromUnit, patternUnit,
} from './patternPresets';
import {
  builderValuesFromPreset, exportLibrary, importLibrary, loadUserLibrary, presetCards, presetFromBuilder, saveUserLibrary, upsertPreset,
} from './patternLibrary';
import { fillSong, grid, syncPatternOptions } from './beatSync';
import { attachSong, useSongBeats } from './musicSync';
import { useStems } from './stemSync';
import { STEM_ROLES } from './stemAnalysis';
import { availableSources, programFromStems, songStem, sourceById, suggestRows } from './stemProgram';
import { nameRows, stemShow } from './stemShow';
import { designRows, patternsFromMusic } from './musicPatterns';
import { designGroups, readFountainDesign } from './fountainDesign';
import { createShow } from './autoShow';
import { requestDeepAnalysis } from './deepAnalysis';
import { writeCache } from './musicSync';
import { DEFAULT_METER, METER_CHOICES, tapTempo } from './musicMeter';
import { buildSiteModel } from './siteCapability';
import { groupConflicts } from './groupAdvisor';
import CalibrationDialog from './CalibrationDialog';
import { apiGet, apiPost } from '../../../utils/apiClient';
import './patternBuilder.css';

// Per-preset bar animation delays (5 bars) for the small card icons.
const ICON_DELAYS = {
  wave: [0, .15, .3, .45, .6], chase: [0, .2, .4, .6, .8], ripple: [.4, .2, 0, .2, .4],
  breathing: [0, 0, 0, 0, 0], mirror: [0, .25, .5, .25, 0], sparkle: [.5, .1, .7, .3, .9], pulse: [0, 0, 0, 0, 0],
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
/** With a fountain design the planner casts the parts; hand links stay available, folded away. */
const Advanced = ({ on, open = false, note = '', children }) => (on
  ? <details className="pb-advanced" open={open || undefined}><summary title="Link each part of the music to a group yourself, or make the jets follow each instrument exactly">Link parts by hand{note && <span className="pb-group-warn"> · ⚠ {note}</span>}</summary>{children}</details>
  : <>{children}</>);
const withoutSync = ({ sync, ...rest }) => rest; // eslint-disable-line no-unused-vars
const mmss = t => `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
const SECTION_COLORS = { intro: '#2f6bff', verse: '#35d0c0', chorus: '#ffb347', bridge: '#9b6bff', outro: '#2f6bff' };

const readText = file => (typeof file.text === 'function' ? file.text() : new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(file);
}));

function download(name, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* download unavailable (tests / locked-down browser) */ }
}

/**
 * Pattern builder — pick a group, a preset and a few sliders; Apply commits one
 * undoable studio change. The dialog is non-modal so the 3D preview stays visible.
 * `editRecipeId` reopens a builder-made pattern: Update then replaces it in place.
 */
export default function PatternBuilder({ studio, items, params = {}, showLength = 30, onChange, onUndo, onClose, onEngineeringPatch, editRecipeId = null }) {
  // The Engineering design: areas (front, back, centre …), what feeds them and how they switch.
  const design = useMemo(() => readFountainDesign(items), [items]);
  // The basin outline from Engineering keeps every jet's water inside (splash / wind).
  const basins = useEngineeringStore(s => s.basins);
  const basin = useMemo(() => { const b = basins?.[0]?.outer; return Array.isArray(b) && b.length >= 3 ? b.map(p => [Number(p.x), Number(p.y)]) : null; }, [basins]);
  const scm = useMemo(() => buildSiteModel(items, { design, overrides: { ...(studio.site || {}), basin } }), [items, design, studio.site, basin]);
  const groups = useMemo(() => [...designGroups(design), ...builderGroups(studio, items)], [design, studio, items]);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const membersOf = g => (g ? resolveMembers(g, items).map(id => byId.get(id)).filter(Boolean) : []);
  const waterGroups = groups.filter(g => membersOf(g).some(isWaterItem));
  const lightGroups = groups.filter(g => membersOf(g).some(isLightItem));
  const defaultLights = (lightGroups.find(g => g.id === QUICK_LIGHTS) || lightGroups[0])?.id || '';
  // Reopen: the unit (all recipes made together) and the form values that made it.
  const [edit] = useState(() => {
    const unit = editRecipeId ? patternUnit(studio, editRecipeId) : null;
    return unit ? { unit, state: builderStateFromUnit(unit, groups) } : null;
  });
  const initialGroup = edit?.state.groupId || (waterGroups.find(g => g.id === QUICK_WATER) || waterGroups[0] || groups[0])?.id || '';
  const [groupId, setGroupId] = useState(initialGroup);
  const [preset, setPreset] = useState(edit?.state.preset || 'wave');
  const [options, setOptions] = useState(() => edit ? withoutSync(edit.state.options) : defaultOptions('wave', { start: 0, duration: showLength }));
  const [lights, setLights] = useState(() => edit ? { ...edit.state.lights, groupId: edit.state.lights.groupId || defaultLights }
    : { enabled: false, groupId: defaultLights, color: '#4f8cff', level: 30 });
  const [syncOn, setSyncOn] = useState(!!edit?.state.sync);
  const base = useRef(edit ? { recipeIds: edit.unit.recipeIds, unitId: edit.unit.id } : null);
  const [applied, setApplied] = useState([]);
  const [raise, setRaise] = useState(null);
  const [note, setNote] = useState(edit ? 'Editing pattern' : '');
  const [userPresets, setUserPresets] = useState(() => loadUserLibrary());
  const [saveName, setSaveName] = useState(null);
  const importRef = useRef(null);
  const beats = useSongBeats();
  const analysis = beats.analysis;
  const stemsApi = useStems();
  // Meter (the user's beat-grid correction) and site settings live on the studio.
  const meter = { ...DEFAULT_METER, ...(studio.meter || {}) };
  const setMeter = patch => onChange({ ...studio, meter: { ...meter, ...patch } });
  const taps = useRef([]);
  const tap = () => {
    const now = performance.now() / 1000;
    taps.current = [...taps.current.filter(t => now - t < 4), now];
    const bpm = tapTempo(taps.current);
    if (bpm) setMeter({ bpm });
  };
  const site = studio.site || {};
  const [calibrating, setCalibrating] = useState(false);
  // Optional AI director: the key is stored by the engine on this machine, never in the project.
  const [director, setDirector] = useState({ checked: false, configured: false, sdk: false, key: '' });
  const checkDirector = () => apiGet('/director/status').then(s => setDirector(d => ({ ...d, checked: true, ...s }))).catch(() => setDirector(d => ({ ...d, checked: true, sdk: false })));
  const saveDirectorKey = () => apiPost('/director/key', { key: director.key }).then(() => { setDirector(d => ({ ...d, key: '', configured: true })); setNote('AI director key saved on this computer'); })
    .catch(e => setNote(`Could not save the key: ${e.message}`));
  const nozzleTypes = [...new Map(design.nozzles.map(n => [n.item.type, { id: n.item.type, label: `${n.kindLabel} · ${n.item.type}` }])).values()];
  const setSite = patch => onChange({ ...studio, site: { ...site, ...patch } });
  const [stemRows, setStemRows] = useState(null);   // null = follow the suggestion

  const group = groups.find(g => g.id === groupId);
  const lightGroup = groups.find(g => g.id === lights.groupId);
  const members = membersOf(group);
  const controls = PRESET_CONTROLS[preset];
  const set = patch => setOptions(o => ({ ...o, ...patch }));
  const minLevel = controls.minLevel ? Math.min(options.minLevel, options.maxLevel) : 0;
  const synced = syncOn && analysis ? syncPatternOptions(preset, { ...options, minLevel }, analysis, { members: members.length }) : null;
  const finalOptions = synced?.info ? synced.options : { ...options, minLevel };
  const timing = snapCycles(finalOptions.duration, finalOptions.lapSeconds);
  const visibility = visibilityCheck({ members, params, minLevel, maxLevel: options.maxLevel });
  const songLength = analysis ? Math.min(600, Math.round(analysis.duration * 10) / 10) : null;
  const wholeLength = songLength || showLength;
  const editing = !!base.current;
  const pick = id => {
    setPreset(id);
    setOptions(o => ({ ...defaultOptions(id, { start: o.start, duration: o.duration, color: o.color }) }));
  };

  const apply = () => {
    if (!group) return;
    const previous = [...applied].reverse().find(a => !a.fill) || base.current;
    const result = buildPatternUnit(studio, { preset, options: finalOptions, group, items,
      lights: lights.enabled && lightGroup ? { group: lightGroup, color: lights.color, level: lights.level } : null,
      unitId: previous?.unitId || null, replaceIds: previous?.recipeIds || [] });
    let next = result.studio;
    const g = synced?.info ? grid(analysis) : null;
    if (g) next = { ...next, tempo: [{ time: Math.round(g.beatOrigin * 1000) / 1000, bpm: synced.info.bpm }] };
    onChange(next);
    setApplied(list => [...list, { recipeIds: result.recipeIds, unitId: result.unitId }]);
    setNote(`${presetById(preset).label} ${previous ? 'updated' : 'added'} · ${timing.cycles} lap${timing.cycles > 1 ? 's' : ''}`);
  };
  const undo = () => {
    onUndo?.();
    setApplied(list => list.slice(0, -1));
    setNote('Undone');
  };
  const findBeats = async () => (analysis || await beats.analyze());
  // Deep analysis in the engine: structure with repeats, build-ups, drops, mood (cached per song).
  const [deep, setDeep] = useState({ status: 'idle', progress: 0 });
  const runDeep = async () => {
    const song = await findBeats();
    if (!song || !beats.file) return;
    setDeep({ status: 'working', progress: 0 });
    try {
      const result = await requestDeepAnalysis(beats.file, song, { onProgress: p => setDeep({ status: 'working', progress: p }) });
      writeCache(beats.hash, { ...song, deep: result });
      setDeep({ status: 'idle', progress: 1 });
      setNote(`Deep analysis · ${result.sections.length} sections · ${result.drops.length} drop${result.drops.length === 1 ? '' : 's'} · ${result.builds.length} build-up${result.builds.length === 1 ? '' : 's'} · ${result.mood.key} · energy ${Math.round(100 * result.mood.arousal)} %`);
    } catch (error) {
      setDeep({ status: 'idle', progress: 0 });
      setNote(/fetch|Failed|HTTP|network/i.test(error.message) ? 'Deep analysis needs the AquaFlow engine (it is not running)' : error.message);
    }
  };
  const toggleSync = async on => {
    if (!on) { setSyncOn(false); return; }
    setSyncOn(true);
    if (!(await findBeats())) setSyncOn(false);
  };
  const fill = async () => {
    if (!group) return;
    const song = await findBeats();
    if (!song) return;
    try {
      const result = fillSong(studio, { analysis: song, items, waterGroup: group, lightGroup: lights.enabled ? lightGroup : null });
      onChange(result.studio);
      setApplied(list => [...list, { fill: true }]);
      setNote(result.warning || `Song filled · ${result.markers.length} sections · ${result.recipes.length} patterns`);
    } catch (error) { setNote(error.message); }
  };
  const loadSong = file => { if (file) attachSong(file); };

  // ── Stems: each part of the music drives its own group ──
  // The whole song is one more part ("Song"), from its energy curve.
  const stemsAll = useMemo(() => { const song = analysis ? songStem(analysis) : null; return song ? [...stemsApi.stems, song] : stemsApi.stems; }, [stemsApi.stems, analysis]);
  const stemSources = availableSources(stemsAll);
  // Water follows its stem: each linked group plays its own part all song long (stemShow.js).
  const followStems = !!site.followStems;
  const suggested = useMemo(() => {
    // Groups named after a part ("Group 1 · Bass", "Vocals", "Song", "Drums") follow it.
    const byName = followStems ? nameRows(availableSources(stemsAll), waterGroups) : [];
    if (byName.length) return byName;
    return design.areas.length ? designRows(design, stemsApi.stems) : suggestRows(stemsApi.stems, waterGroups, lightGroups, membersOf);
  }, [stemsApi.stems, stemsAll, groups, followStems]); // eslint-disable-line react-hooks/exhaustive-deps
  const rowsNow = (stemRows || suggested).filter(r => stemSources.some(s => s.id === r.sourceId));
  const editRow = (i, patch) => setStemRows(rowsNow.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  // Group check: groups linked by hand that share jets or pumps cannot each follow their own
  // part. (The suggested links are the design's own areas; the planner already keeps them apart.)
  const linkedWater = [...new Set(rowsNow.filter(r => r.kind !== 'lights').map(r => r.groupId))];
  const stemConflicts = stemRows || followStems || !design.areas.length
    ? groupConflicts({ groups: groups.filter(g => linkedWater.includes(g.id)), membersOf: g => resolveMembers(g, items), design, linked: linkedWater })
    : [];
  const addRow = () => {
    const used = new Set(rowsNow.map(r => r.sourceId));
    const src = stemSources.find(s => !used.has(s.id)) || stemSources[0];
    const g = waterGroups[0];
    if (src && g) setStemRows([...rowsNow, { sourceId: src.id, groupId: g.id, min: 15, max: 100, kind: 'water' }]);
  };
  const musicPatterns = async () => {
    const song = await findBeats();
    if (!song) { setNote('Load the song and find its beats first'); return; }
    try {
      if (followStems) {
        // Beats just found: the Song part is new, so links by name are made again.
        const fresh = !analysis && !stemRows ? nameRows(availableSources([...stemsApi.stems, songStem(song)].filter(Boolean)), waterGroups) : [];
        const result = stemShow(studio, { analysis: song, stems: stemsApi.stems, links: fresh.length ? fresh : rowsNow, items, groups, design, basin });
        onChange(result.studio);
        setApplied(list => [...list, { fill: true }]);
        setNote(result.summary.text
          + (result.muted ? ` · ${result.muted} fixed pump / valve pattern${result.muted === 1 ? '' : 's'} muted (the music drives them now)` : '')
          + (result.skipped.length ? ` · skipped: ${result.skipped.join('; ')}` : ''));
        return;
      }
      // With a fountain design: the full planner (arc → phrase search → real valves and pumps).
      const result = design.areas.length
        ? createShow(studio, { analysis: song, stems: stemsApi.stems, items, groups, design, site: { ...(studio.site || {}), basin } })
        : patternsFromMusic(studio, { analysis: song, stems: stemsAll, rows: rowsNow, items, groups, design });
      onChange(result.studio);
      setApplied(list => [...list, { fill: true }]);
      const parts = Object.entries(result.counts).map(([k, n]) => `${k} ${n}`).join(' · ');
      const climax = result.plan?.sections.find(x => x.role === 'climax');
      setNote(result.warning || `${result.plan ? `Show planned · ${result.plan.sections.length} sections${climax ? ` · climax at ${mmss(climax.start)}` : ''} · ` : 'Patterns from the music · '}${result.recipes.filter(r => r.pattern?.role !== 'lights').length} patterns · ${parts}`
        + (result.muted ? ` · ${result.muted} fixed pump / valve pattern${result.muted === 1 ? '' : 's'} muted (the music drives them now)` : '')
        + (result.skipped?.length ? ` · skipped: ${result.skipped.join('; ')}` : ''));
    } catch (error) { setNote(error.message); }
  };
  const programStems = () => {
    try {
      const result = programFromStems(studio, { stems: stemsAll, rows: rowsNow, items, groups });
      onChange(result.studio);
      setApplied(list => [...list, { fill: true }]);
      const parts = new Set(result.recipes.map(r => r.stems.source)).size;
      setNote(`Programmed from stems · ${parts} part${parts === 1 ? '' : 's'} · ${result.recipes.length} curves`
        + (result.skipped.length ? ` · skipped: ${result.skipped.join(', ')}` : ''));
    } catch (error) { setNote(error.message); }
  };

  // ── Saved presets ──
  const cards = presetCards(studio.presets, userPresets);
  const loadPreset = card => {
    const values = builderValuesFromPreset(card, options);
    if (!values) return;
    setPreset(values.preset); setOptions(values.options);
    setLights(l => ({ ...l, enabled: values.lights.enabled && !!lightGroups.length, level: values.lights.level, color: values.lights.color }));
    setNote(`${card.name} loaded`);
  };
  const savePreset = () => {
    const saved = presetFromBuilder(saveName || '', { preset, options, lights });
    if (!saved) { setNote('Give the preset a name'); return; }
    const library = upsertPreset(userPresets, saved);
    setUserPresets(library);
    const stored = saveUserLibrary(library);
    const key = saved.name.toLowerCase();
    onChange({ ...studio, presets: [...studio.presets.filter(p => !(p.kind === 'pattern' && p.name.toLowerCase() === key)), saved] });
    setSaveName(null);
    setNote(`Saved “${saved.name}”${stored ? '' : ' to this project'}`);
  };
  const removePreset = card => {
    if (card.source === 'library') { const library = userPresets.filter(p => p.name !== card.name); setUserPresets(library); saveUserLibrary(library); }
    if (card.source === 'project') onChange({ ...studio, presets: studio.presets.filter(p => p.id !== card.id) });
  };
  const exportPresets = () => download('aquaflow-pattern-presets.json', exportLibrary(cards.filter(c => !c.builtin)));
  const importPresets = async file => {
    if (!file) return;
    try {
      const incoming = importLibrary(await readText(file));
      const library = incoming.reduce(upsertPreset, userPresets);
      setUserPresets(library); saveUserLibrary(library);
      setNote(`Imported ${incoming.length} preset${incoming.length === 1 ? '' : 's'}`);
    } catch (error) { setNote(error.message); }
  };
  const cardTip = c => {
    const o = c.options;
    return [presetById(c.preset).label, o.duration ? `${Math.max(1, Math.round(o.duration / o.lapSeconds))} laps / ${o.duration} s` : `${o.lapSeconds} s/lap`,
      `${o.minLevel}–${o.maxLevel} %`, c.lights.enabled ? `lights ${c.lights.level} %` : null, c.source].filter(Boolean).join(' · ');
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

  const followTip = 'Each linked group follows its own part of the music, all together, all song long: phrase by phrase it gets the next wave of its part’s family (bass → ocean sets, tidal bore, rolling sea …; vocals → swaying arcs, moving spot …; the song → ripples, stadium wave, spiral arms …, grand finale in the climax; drums → heartbeat, firework burst, wall pulse …), and that part’s loudness or hits shape each wave moment by moment. The lights change colour with the song. Uses the links below (groups named Bass, Vocals, Song, Drums are linked by name).';
  const followCheck = <label className="pb-check" title={followTip}>
    <input type="checkbox" aria-label="Water follows its stem" checked={followStems} onChange={e => setSite({ followStems: e.target.checked || undefined })} />Water follows its stem</label>;
  const musicTip = followStems
    ? `Water follows its stem: ${rowsNow.filter(r => r.kind !== 'lights').map(r => `${sourceById(r.sourceId)?.label} → ${groups.find(g => g.id === r.groupId)?.name || '?'}`).join('; ') || 'link a part to a group below'}. Replaces earlier music patterns; one Undo removes it.`
    : null;

  const groupOptions = list => {
    const sources = [...new Set(list.map(g => g.source))];
    return sources.map(source => <optgroup key={source} label={source}>
      {list.filter(g => g.source === source).map(g => <option key={g.id} value={g.id}>{groupLabel(g, membersOf(g).length)}{g.quick ? ' · new' : ''}</option>)}
    </optgroup>);
  };

  return <>{calibrating && <CalibrationDialog types={nozzleTypes} calibration={site.calibration || {}} onClose={() => setCalibrating(false)}
    onSave={(type, cal) => { setSite({ calibration: { ...(site.calibration || {}), [type]: cal } }); setCalibrating(false); setNote(`Calibrated ${type}: delay ${cal.delayS} s, apex ${cal.apexM} m`); }} />}
  <div className="pattern-builder" role="dialog" aria-label="Pattern builder">
    <div className="pb-head"><strong>Pattern builder</strong>{editing && <span className="pb-tag" title="Update replaces this pattern in place">editing</span>}<span className="sp-grow" />
      <button onClick={onClose} aria-label="Close pattern builder" title="Close">✕</button></div>

    <div className="pb-saved" aria-label="Saved presets">
      {cards.map(c => <span key={`${c.source}:${c.name}`} className="pb-saved-card">
        <button onClick={() => loadPreset(c)} title={cardTip(c)}><PresetIcon id={c.preset} /><b>{c.name}</b></button>
        {!c.builtin && <button className="pb-saved-x" aria-label={`Remove preset ${c.name}`} title="Remove" onClick={() => removePreset(c)}>×</button>}
      </span>)}
      {saveName === null
        ? <button className="pb-saved-add" onClick={() => setSaveName('')} title="Save these settings (not the jets) as a preset for this project and your library">＋ Save as preset</button>
        : <span className="pb-saved-form"><input aria-label="Preset name" autoFocus placeholder="Name" value={saveName} maxLength={60}
            onChange={e => setSaveName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setSaveName(null); }} />
          <button className="sp-primary" onClick={savePreset}>Save</button><button onClick={() => setSaveName(null)} aria-label="Cancel save">✕</button></span>}
      <button className="pb-saved-io" onClick={exportPresets} title="Download your presets as a file">Export</button>
      <button className="pb-saved-io" onClick={() => importRef.current?.click()} title="Add presets from a file">Import</button>
      <input ref={importRef} type="file" accept="application/json,.json" hidden aria-label="Import presets file" onChange={e => { importPresets(e.target.files?.[0]); e.target.value = ''; }} />
    </div>

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
        display={synced?.info ? synced.info.label.replace(/^lap /, '') : `${timing.lapSeconds} s/lap`} />
      {synced?.info
        ? <small className="pb-hint pb-sync-hint" title={`Start and length snap to bars; laps are whole beats. ${mmss(finalOptions.start)}–${mmss(finalOptions.start + finalOptions.duration)}`}>
            ♩ {Math.round(synced.info.bpm)} BPM · {timing.cycles} lap{timing.cycles > 1 ? 's' : ''} · {synced.info.label}</small>
        : <small className="pb-hint" title={timing.snapped ? `You chose ${timing.requested} s; ${timing.cycles} whole laps fit ${options.duration} s exactly.` : 'Whole laps — the loop is seamless.'}>
            ↻ {timing.cycles} lap{timing.cycles > 1 ? 's' : ''}{timing.snapped ? ` · snapped to ${timing.lapSeconds} s for a seamless loop` : ' · seamless loop'}
          </small>}
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
      {preset === 'breathing' && <div className="pb-row" title="Fade the whole clip in or out (intros and endings)"><span>Fade</span>
        <div className="pb-segment" role="radiogroup" aria-label="Fade">
          {[['none', 'None'], ['in', 'In'], ['out', 'Out']].map(([id, label]) => <button key={id} role="radio" aria-checked={(options.fade || 'none') === id} className={(options.fade || 'none') === id ? 'active' : ''} onClick={() => set({ fade: id === 'none' ? undefined : id })}>{label}</button>)}
        </div></div>}
      <div className="pb-row pb-times">
        <label title="Start time in seconds"><span>Start</span><input aria-label="Start" type="number" min={0} max={599} step={.5} value={options.start} onChange={e => set({ start: Math.max(0, Number(e.target.value) || 0) })} /></label>
        <label title="Clip length in seconds"><span>Length</span><input aria-label="Length" type="number" min={1} max={600} step={.5} value={options.duration} onChange={e => set({ duration: Math.max(1, Number(e.target.value) || 1) })} /></label>
        <button onClick={() => set({ start: 0, duration: wholeLength })} title={`${songLength ? 'Whole song' : 'Whole show'}: 0–${wholeLength} s`}>{songLength ? 'Whole song' : 'Whole show'}</button>
        <input aria-label="Water colour" type="color" value={options.color} onChange={e => set({ color: e.target.value })} title="Clip colour" />
      </div>
    </div>

    <div className="pb-music">
      <div className="pb-row">
        {beats.file
          ? <span className="pb-song" title={beats.file.name}>♪ {beats.file.name}</span>
          : <span className="pb-song pb-muted">♪ No song</span>}
        <span className="sp-grow" />
        {beats.file && (analysis
          ? <output className="pb-bpm" title={`${analysis.sections.length} sections · ${Math.round(analysis.duration)} s · tempo from ${analysis.source === 'backend' ? 'the beat engine' : 'the browser'}`}>♩ {Math.round(analysis.bpm)} BPM</output>
          : <button onClick={() => beats.analyze()} disabled={beats.status === 'working'} title="Find tempo, bars and sections in the song">{beats.status === 'working' ? 'Listening…' : 'Find beats'}</button>)}
        {analysis && <button onClick={runDeep} disabled={deep.status === 'working'} aria-pressed={!!analysis.deep}
          title="Deep analysis in the AquaFlow engine (licence-clean, about a second per song): song structure with repeats, build-ups, drops, mood and key, vocal phrases. The show plan then lands drops, builds up to them and picks colours from the mood.">
          {deep.status === 'working' ? `Deep… ${Math.round(100 * deep.progress)}%` : analysis.deep ? 'Deep ✓' : 'Deep analysis'}</button>}
        <label className="pb-file" title="Choose the show's music">{beats.file ? 'Change' : 'Load song'}
          <input type="file" accept="audio/*" hidden aria-label="Load song" onChange={e => { loadSong(e.target.files?.[0]); e.target.value = ''; }} /></label>
      </div>
      {beats.error && <small className="pb-error" role="alert">{beats.error}</small>}
      {analysis && <div className="pb-row pb-meter" aria-label="Meter" title="Correct the beat grid when the detector is unsure — e.g. 6/8 songs felt in two">
        <span>Meter</span>
        <select aria-label="Beats per bar" value={String(meter.beatsPerBar)} onChange={e => setMeter({ beatsPerBar: e.target.value === 'auto' ? 'auto' : Number(e.target.value), pulse: [6, 12].includes(Number(e.target.value)) ? 'dotted' : 'beat' })}>
          {METER_CHOICES.map(([v, l]) => <option key={v} value={String(v)}>{l}</option>)}</select>
        <select aria-label="Accent" value={meter.accent} onChange={e => setMeter({ accent: e.target.value })} title="Rise: the water jumps up on the beat. Bend: it dips on the beat and rises between (like bending the knee).">
          <option value="rise">Rise on the beat</option><option value="bend">Bend on the beat</option></select>
        <button onClick={() => setMeter({ downbeat: (meter.downbeat || 0) + 1 })} title="Move the bar start one beat later">Bar +1</button>
        <button onClick={() => setMeter({ nudgeS: Math.round(((meter.nudgeS || 0) - 0.02) * 1000) / 1000 })} title="Beats 20 ms earlier">◀</button>
        <button onClick={() => setMeter({ nudgeS: Math.round(((meter.nudgeS || 0) + 0.02) * 1000) / 1000 })} title="Beats 20 ms later">▶</button>
        <button onClick={tap} title="Tap along with the beat (4+ taps) to set the tempo">Tap{meter.bpm ? ` · ${Math.round(meter.bpm)}` : ''}</button>
      </div>}
      {analysis?.sections?.length > 0 && <div className="pb-sections" aria-label="Song sections">
        {analysis.sections.map((s, i) => <span key={i} style={{ flexGrow: Math.max(.1, s.end - s.start), background: SECTION_COLORS[s.label] || '#35d0c0', opacity: .35 + .65 * (s.energy || 0) }}
          title={`${s.label} · ${mmss(s.start)}–${mmss(s.end)}`} />)}
      </div>}
      <div className="pb-row">
        <label className="pb-check" title="Snap start and length to bars, laps to whole beats; chase, sparkle and pulse hit on the beat">
          <input type="checkbox" aria-label="Sync to music" checked={syncOn} disabled={!beats.file} onChange={e => toggleSync(e.target.checked)} />Sync to music</label>
        <span className="sp-grow" />
        <button onClick={fill} disabled={!beats.file || !group || beats.status === 'working'}
          title="Lay patterns over the whole song for this group: calm intro, waves in verses, chase and mirror in choruses, ripple accents, fade-out ending. Levels follow the music. Lights follow if ticked below. Replaces an earlier fill; one Undo removes it.">♫ Fill the song</button>
      </div>
    </div>

    <div className="pb-stems" aria-label="Stems">
      <div className="pb-row">
        <strong title="Separate tracks of the song (drums, bass, vocals, other…) from the producer, a DAW or a stem splitter">Stems</strong>
        <span className="sp-grow" />
        {stemsApi.status === 'working' && <small role="status">{stemsApi.total === 100 ? `Splitting… ${stemsApi.done}%` : `Listening… ${stemsApi.done}/${stemsApi.total}`}</small>}
        <button onClick={() => stemsApi.split(beats.file)} disabled={!beats.file || stemsApi.status === 'working'}
          title="No stems? Estimate drums (kick, hats), bass and the lead melody straight from the show's song. Clean stems from the producer give a better result.">Split the song</button>
        <label className="pb-file" title="Load one or more stem files (WAV/MP3). The part is guessed from the file name: drums, bass, vocals, piano, guitar, other.">Load stems
          <input type="file" accept="audio/*" multiple hidden aria-label="Load stems" onChange={e => { stemsApi.add(e.target.files); e.target.value = ''; }} /></label>
      </div>
      {stemsApi.error && <small className="pb-error" role="alert">{stemsApi.error}</small>}
      {stemsApi.stems.map(st => (
        <div className="pb-row pb-stem" key={st.id}>
          <span className="pb-stem-dot" style={{ background: STEM_ROLES[st.role]?.color }} />
          <select aria-label={`Part of ${st.name}`} value={st.role} onChange={e => stemsApi.setRole(st.id, e.target.value)}>
            {Object.entries(STEM_ROLES).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
          </select>
          <span className="pb-song" title={st.name}>{st.name}</span>
          <small>{Math.round(st.analysis.duration)} s · {(st.analysis.kicks || st.analysis.hits || []).length} hits</small>
          <button onClick={() => stemsApi.remove(st.id)} title="Remove this stem" aria-label={`Remove ${st.name}`}>×</button>
        </div>
      ))}
      {design.areas.length > 0 && (
        <details className="pb-design" aria-label="Your fountain">
          <summary title="What AquaFlow read from the Engineering design: each area, its nozzles, how they switch and which pump feeds them. Patterns from the music use this.">
            Your fountain · {design.summary}</summary>
          <ul>{design.areas.map(a => <li key={a.id}><strong>{a.name}</strong> <small>{a.summary}</small></li>)}</ul>
          <div className="pb-row" title="Which way the audience looks at the fountain: front rows get the low, close effects, the back gets the tall ones">
            <span>Audience</span>
            <select aria-label="Audience side" value={site.front?.vector ? site.front.vector.join(',') : 'auto'}
              onChange={e => setSite({ front: e.target.value === 'auto' ? undefined : { vector: e.target.value.split(',').map(Number) } })}>
              <option value="auto">Auto · {scm.front.source === 'user' ? 'set' : `${scm.front.source}`}</option>
              <option value="0,1">Plan bottom (+y)</option><option value="0,-1">Plan top (−y)</option>
              <option value="1,0">Plan right (+x)</option><option value="-1,0">Plan left (−x)</option>
            </select>
            <span>Wind</span>
            <input aria-label="Wind speed" type="number" min={0} max={30} step={0.5} value={site.windMs ?? 0} onChange={e => setSite({ windMs: Math.max(0, Number(e.target.value) || 0) })} />
            <small>m/s</small>
            <span>Splash</span>
            <input aria-label="Allowed splash" title="Share of each jet's water allowed to land outside the basin" type="number" min={0} max={50} step={1}
              value={Math.round(100 * (site.splashLimit ?? 0.05))} onChange={e => setSite({ splashLimit: Math.min(0.5, Math.max(0, (Number(e.target.value) || 0) / 100)) })} />
            <small>%</small>
          </div>
          {scm.tips.map(t => <p key={t} className="pb-design-tip">💡 {t}</p>)}
          <div className="pb-row">
            <small>{Object.keys(site.calibration || {}).length ? `${Object.keys(site.calibration).length} nozzle type(s) calibrated from video` : 'Timing from physics (not measured yet)'}</small>
            <span className="sp-grow" />
            <button onClick={() => setCalibrating(true)} title="Film a jet side-on and mark its tip: AquaFlow measures its delay and rise so the show fires it exactly early enough">Calibrate from video…</button>
          </div>
          <div className="pb-row" title="Optional: Claude (Anthropic) directs the show's arc from a text description of the song and your fountain. Your key is kept by the AquaFlow engine on this computer.">
            <small>AI director · {!director.checked ? <button onClick={checkDirector}>Check</button> : !director.sdk ? 'not available in this engine' : director.configured ? 'ready (✦ AI director on the plan strip)' : 'needs an Anthropic API key'}</small>
            <span className="sp-grow" />
            {director.checked && director.sdk && <>
              <input aria-label="Anthropic API key" type="password" placeholder={director.configured ? 'Replace key…' : 'sk-ant-…'} value={director.key} onChange={e => setDirector(d => ({ ...d, key: e.target.value }))} />
              <button onClick={saveDirectorKey} disabled={director.key.length < 10}>Save key</button></>}
          </div>
        </details>
      )}
      {design.areas.length > 0 && <div className="pb-row">
        {followCheck}
        <span className="sp-grow" />
        <button className="sp-primary" onClick={musicPatterns} disabled={!beats.file || (followStems && !!analysis && !rowsNow.some(r => r.kind !== 'lights'))}
          title={musicTip || "Plan the whole show from the music and your fountain: an arc (intro → build → climax → ending) from the song's energy, each area cast as an instrument (melody, rhythm, bass, accents), one look per phrase chosen from the library incl. world-famous looks, a colour story, a dip before the climax — then the real valves and pumps follow within their limits. Works with or without stems (stems make it follow each instrument). Replaces earlier music patterns; one Undo removes it. Variants and phrase locks are on the plan strip in the timeline."}>♫ Create patterns from the music</button>
      </div>}
      {stemSources.length > 0 && <Advanced on={design.areas.length > 0} open={followStems} note={stemConflicts.length ? `${stemConflicts.length} pair${stemConflicts.length === 1 ? '' : 's'} of linked groups share jets or pumps` : ''}>
        {rowsNow.map((row, i) => (
          <div className="pb-stem-map" key={i}>
            <div className="pb-row">
              <select aria-label="Music part" value={row.sourceId} onChange={e => editRow(i, { sourceId: e.target.value })}>
                {stemSources.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
              <span className="pb-stem-arrow">→</span>
              <select aria-label="Drives group" value={`${row.kind || 'water'}|${row.groupId}`} onChange={e => { const [kind, id] = e.target.value.split('|'); editRow(i, { kind, groupId: id }); }}>
                <optgroup label="Water">{waterGroups.map(g => <option key={g.id} value={`water|${g.id}`}>{groupLabel(g, membersOf(g).length)}</option>)}</optgroup>
                {lightGroups.length > 0 && <optgroup label="Lights">{lightGroups.map(g => <option key={g.id} value={`lights|${g.id}`}>{groupLabel(g, membersOf(g).length)}</option>)}</optgroup>}
              </select>
            </div>
            <div className="pb-row pb-stem-levels">
              <span>Level</span>
              <input aria-label="Lowest level" title="Level when the part is quiet / between hits" type="number" min={0} max={100} value={row.min} onChange={e => editRow(i, { min: Number(e.target.value) || 0 })} />
              <small>to</small>
              <input aria-label="Highest level" title="Level at the loudest note / strongest hit" type="number" min={0} max={100} value={row.max} onChange={e => editRow(i, { max: Number(e.target.value) || 0 })} />
              <small>%</small>
              <span className="sp-grow" />
              <button onClick={() => setStemRows(rowsNow.filter((_, k) => k !== i))} aria-label="Remove this link" title="Remove">×</button>
            </div>
          </div>
        ))}
        {stemConflicts.map(c => <p key={`${c.a}|${c.b}`} className="pb-design-tip pb-group-warn">⚠ {c.text} {c.fix}</p>)}
        <div className="pb-row">
          <button onClick={addRow} title="Link another part of the music to a group">+ Link</button>
          {stemRows && <button onClick={() => setStemRows(null)} title="Back to the suggested links">Suggest</button>}
          <span className="sp-grow" />
          {!design.areas.length && followCheck}
          {!design.areas.length && <button className="sp-primary" onClick={musicPatterns} disabled={!rowsNow.length || !beats.file}
            title={musicTip || "Lay real patterns over the song for each linked area, chosen phrase by phrase from that part's frequencies: kicks → pulse / chase / ripple on the beat, hats → sparkle / chase, bass → slow breathing or wave, melody → wave / mirror while singing. Every other phrase is a world-famous look (shooter salvo, stadium wave, swaying arcs, peacock fan …) and the last chorus builds to a grand finale. Each area only gets what its nozzles, solenoids and pumps can really do, and the patterns drive the real valves and pumps. Every pattern starts early by its jets' rise time. Replaces earlier music patterns; one Undo removes it. Every pattern can be edited afterwards."}>♫ Create patterns from the music</button>}
          <button onClick={programStems} disabled={!rowsNow.length}
            title={`Each linked part drives its group: ${rowsNow.map(r => `${sourceById(r.sourceId)?.label} → ${groups.find(g => g.id === r.groupId)?.name || '?'}`).join('; ')}. Kicks and hats lift the jets on every hit, bass and other parts follow their loudness, a melody moves the jets with the notes and rests when nobody sings. Replaces earlier stem programming; one Undo removes it.`}>Follow exactly</button>
        </div>
      </Advanced>}
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
      <button onClick={undo} disabled={!applied.length} title="Undo the last change made here">↶ Undo</button>
      <button className="sp-primary" onClick={apply} disabled={!group || !members.length}>{applied.some(a => !a.fill) || editing ? 'Update' : 'Apply'}</button>
      <button onClick={onClose}>Done</button>
    </div>
  </div></>;
}

/** Small timeline badge: shows when any pattern's jets will be hard to see. */
export function VisibilityBadge({ studio, items, params }) {
  const list = useMemo(() => showVisibility(studio, items, params), [studio, items, params]);
  if (!list.length) return null;
  const low = list.some(v => v.warnings.some(w => w.code === 'low'));
  const tip = list.slice(0, 8).map(v => `${v.name}: ${v.warnings.map(w => w.text).join(' · ')}`).join('\n');
  return <span className="pb-badge" title={tip} role="status">⚠ {low ? 'Low jets' : 'Subtle motion'}</span>;
}
