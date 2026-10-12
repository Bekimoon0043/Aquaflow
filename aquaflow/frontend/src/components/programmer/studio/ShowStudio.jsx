import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useShowStore } from '../../../store/showStore';
import { downloadShowFile } from '../../../utils/showFile';
import { apiUrl } from '../../../utils/apiClient';
import { createFullShowPreview } from '../../../utils/fullShowPreview';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import { poolCenter } from '../../../engineering/geometryContract';
import SiemensShowControls from '../SiemensShowControls';
import StudioPlcPanel from './StudioPlcPanel';
import { checkPlcLimits, issuesByBlock, nozzleLinks } from './plcLimits';
import { siemensRequest } from '../../../utils/siemensSite';
import ShowChoreographyAssistant from '../ShowChoreographyAssistant';
import ArrayPatternBuilder from '../ArrayPatternBuilder';
import useShowDocument from './useShowDocument';
import { EFFECTS, ORDERS, aiRecipes, autoGroups, compileStudio, copyStudioClips, editableClip, groupFlag, inventory, moveStudioClips, newRecipe, orderMembers, pasteStudioClips, resolveMembers, sampleClips, uid } from './showModel';
import VirtualList from './VirtualList';
import SpatialPlan from './SpatialPlan';
import StudioTimeline from './StudioTimeline';
import EnvelopeEditor from './EnvelopeEditor';
import './showStudio.css';

const StudioPreview = lazy(() => import('./StudioPreview'));
const fieldLabel = text => text.replaceAll('-', ' ').replaceAll('_', ' ');
const clock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`;
function NumberField({ label, value, onChange, min = 0, max = 600, step = .1 }) {
  return <label>{label}<input type="number" min={min} max={max} step={step} value={value} onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} /></label>;
}

export default function ShowStudio() {
  const fixtures = useEngineeringStore(s => s.fixtures), models = useEngineeringStore(s => s.siteModels);
  const geometry = useEngineeringStore(s => s.geometry), params = useEngineeringStore(s => s.params), poolType = useEngineeringStore(s => s.poolType);
  const revision = useProjectStore(s => s.loadRevision);
  const active = useProjectStore(s => s.workspace.activePanel === 'show_programmer');
  const name = useEngineeringStore(s => s.projectName);
  const items = useMemo(() => inventory(fixtures, models, poolCenter(geometry, params, poolType)), [fixtures, models, geometry, params, poolType]);
  const doc = useShowDocument(items);
  const { studio, change, layout, clips, issues, pending } = doc;
  const [selection, setSelection] = useState([]), [groupId, setGroupId] = useState(null), [selectedId, setFocusedId] = useState(null);
  const [clipIds, setClipIds] = useState([]);
  const clipboard = useRef(null);
  const setSelectedId = id => { setFocusedId(id); setClipIds(id ? [id] : []); };
  const [search, setSearch] = useState(''), [dimension, setDimension] = useState('groupId'), [expanded, setExpanded] = useState(new Set());
  const [tab, setTab] = useState('pattern'), [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [loop, setLoop] = useState(false);
  const [message, setMessage] = useState(''), [frame, setFrame] = useState(0), [palette, setPalette] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [groupName, setGroupName] = useState(''), [prompt, setPrompt] = useState('A flowing blue wave, then a strong pulse finale');
  const [aiDuration, setAiDuration] = useState(24), [proposal, setProposal] = useState(null), [proposalIds, setProposalIds] = useState([]), [ghost, setGhost] = useState(false), [busy, setBusy] = useState(false);
  const [audioFile, setAudioFile] = useState(null), [audioName, setAudioName] = useState('');
  const [audioBuffer, setAudioBuffer] = useState(null);
  const audio = useRef(null), host = useRef(null), searchRef = useRef(null), timeRef = useRef(time), abort = useRef(null);
  timeRef.current = time;
  const groups = useMemo(() => dimension === 'custom' ? studio.groups : autoGroups(items, dimension), [items, dimension, studio.groups]);
  const allGroups = useMemo(() => new Map([...autoGroups(items), ...groups, ...studio.groups].map(g => [g.id, g])), [items, groups, studio.groups]);
  const group = allGroups.get(groupId);
  const recipe = studio.recipes.find(r => r.id === selectedId);
  const legacy = studio.legacyClips.find(c => c.id === selectedId);
  // Live PLC limits: the selected Siemens site's rules applied to every resolved clip.
  const plcSiteId = useProjectStore(s => s.integrations?.siemensSiteId);
  const [plcSite, setPlcSite] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!plcSiteId) { setPlcSite(null); return undefined; }
    siemensRequest().then(r => { if (alive) setPlcSite(r.sites.find(s => s.id === plcSiteId) || null); }).catch(() => alive && setPlcSite(null));
    return () => { alive = false; };
  }, [plcSiteId, tab]);
  const plcCheck = useMemo(() => checkPlcLimits(clips, plcSite, nozzleLinks(items)), [clips, plcSite, items]);
  const blockIssues = useMemo(() => issuesByBlock(plcCheck), [plcCheck]);
  const selectedIssues = blockIssues.get(selectedId) || [];
  const issueNotes = selectedIssues.length ? <div className="sp-plc-notes" role="note">{selectedIssues.map((issue, i) => <p key={i} className={`sp-plc-note ${issue.level}`}>{issue.level === 'error' ? '⛔' : issue.level === 'warn' ? '⚠' : 'ℹ'} {issue.text}</p>)}</div> : null;
  useEffect(() => {
    const valid = new Set([...studio.recipes, ...studio.legacyClips].map(c => c.id));
    setClipIds(old => old.every(id => valid.has(id)) ? old : old.filter(id => valid.has(id)));
    setFocusedId(old => valid.has(old) ? old : null);
  }, [studio.recipes, studio.legacyClips]);
  const selectedSet = useMemo(() => new Set(selection), [selection]);
  const tracks = useMemo(() => items.flatMap(i => i.tracks), [items]);
  const end = Math.max(1, ...clips.map(c => c.startTime + c.duration), ...studio.recipes.map(r => r.start + r.duration));
  const proposalSignature = JSON.stringify({ fixtures: fixtures.map(f => [f.id, f.type, f.groupId, f.x, f.y]), group, groupId });
  const proposalValid = proposal?.signature === proposalSignature;
  const ghostClips = useMemo(() => ghost && proposalValid ? compileStudio({ ...studio, recipes: proposal.recipes.filter(r => proposalIds.includes(r.id)), legacyClips: [] }, items).clips : clips,
    [ghost, proposalValid, proposal, proposalIds, studio, items, clips]);
  const levels = useMemo(() => sampleClips(ghostClips, time), [ghostClips, time]);
  useEffect(() => { setSelection([]); setGroupId(null); setSelectedId(null); clipboard.current = null; setPlaying(false); setTime(0); setProposal(null); setAudioFile(null); setAudioName(useProjectStore.getState().programmer?.audioFileReference?.name || ''); }, [revision]);
  useEffect(() => { if (!active) { setPlaying(false); audio.current?.pause(); } }, [active]);
  useEffect(() => {
    setAudioBuffer(null);
    if (!audioFile) return;
    let alive = true;
    const url = URL.createObjectURL(audioFile), element = new Audio(url); audio.current = element;
    setAudioName(audioFile.name);
    const context = new AudioContext();
    audioFile.arrayBuffer().then(buffer => context.decodeAudioData(buffer)).then(buffer => { if (alive) setAudioBuffer(buffer); })
      .catch(error => { if (alive) setMessage(`Could not read the waveform: ${error.message}`); }).finally(() => context.close());
    const project = useProjectStore.getState();
    project.rememberProgrammer({ ...project.programmer, audioFile });
    return () => { alive = false; element.pause(); URL.revokeObjectURL(url); audio.current = null; };
  }, [audioFile]);
  useEffect(() => {
    if (!playing || !active) { audio.current?.pause(); return; }
    let id, last = performance.now(), lastDraw = 0;
    if (audio.current) { audio.current.currentTime = timeRef.current; audio.current.play().catch(e => setMessage(`Music playback: ${e.message}`)); }
    const tick = now => {
      const elapsed = (now - last) / 1000; last = now;
      let next = timeRef.current + elapsed;
      if (next >= end) { if (loop) { next = 0; if (audio.current) audio.current.currentTime = 0; } else { setTime(end); setPlaying(false); return; } }
      timeRef.current = next;
      if (now - lastDraw > 32) { setTime(next); lastDraw = now; }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(id); audio.current?.pause(); };
  }, [playing, active, end, loop]);
  useEffect(() => () => abort.current?.abort(), []);
  const seek = value => { setTime(value); timeRef.current = value; if (audio.current) audio.current.currentTime = value; };
  // Follow mode: while the PLC plays this show, the playhead (and 3D preview) show the PLC's show time.
  const [plcPlaying, setPlcPlaying] = useState(null);
  const followPlc = useCallback(status => {
    const running = Boolean(status?.running && status?.runtime_mode === 'show');
    setPlcPlaying(running ? { elapsed: Number(status.elapsed) || 0, mode: status.mode } : null);
    if (running) { const t = Number(status.elapsed) || 0; timeRef.current = t; setTime(t); }
  }, []);
  const selectItems = (ids, add = false) => { setSelection(old => add ? [...new Set([...old, ...ids])] : ids); setSelectedId(null); setGroupId(null); };
  // Tick boxes: add/remove items without Ctrl/Shift. A group's box ticks or clears all its members.
  const toggleItems = (ids, on) => { setSelection(old => on ? [...new Set([...old, ...ids])] : old.filter(id => !ids.includes(id))); setSelectedId(null); setGroupId(null); };
  const chooseGroup = g => { setGroupId(g.id); setSelection(resolveMembers(g, items)); setSelectedId(null); setTab('group'); };
  const rememberGroup = g => studio.groups.some(s => s.id === g.id) ? studio.groups : [...studio.groups, { ...g }];
  const createGroup = () => {
    if (!selection.length) { setMessage('Select items in the plan or Explorer first.'); return; }
    const g = { id: uid('group'), name: groupName.trim() || `Selection ${studio.groups.length + 1}`, memberFixtureIds: [...selection], orderMode: 'engineering', color: '#65d9d0' };
    change(s => ({ ...s, groups: [...s.groups, g] })); setGroupId(g.id); setDimension('custom'); setTab('group'); setGroupName('');
    setMessage(`Group “${g.name}” created with ${g.memberFixtureIds.length} item(s). It now has its own timeline row: click ＋ on that row (or double-click the row) to add a pattern.`);
  };
  const addPattern = (id = groupId, start = time) => {
    let g = allGroups.get(id);
    if (!g && selection.length) g = { id: uid('group'), name: groupName.trim() || `Selection ${studio.groups.length + 1}`, memberFixtureIds: selection, orderMode: 'engineering' };
    if (!g) { setMessage('Choose a group or select items before adding a pattern.'); return; }
    if (groupFlag(studio.groups, g.id, 'locked')) { setMessage('Unlock the group or parent folder before editing.'); return; }
    if (!resolveMembers(g, items).some(id => items.find(i => i.id === id)?.tracks.length)) { setMessage('This group has no programmable items.'); return; }
    const r = { ...newRecipe(g.id, Math.min(592, start)), order: g.orderMode || 'left-to-right' };
    change(s => ({ ...s, groups: s.groups.some(x => x.id === g.id) ? s.groups : [...s.groups, g], recipes: [...s.recipes, r] }));
    setSelectedId(r.id); setGroupId(g.id); setTab('pattern');
  };
  const patchRecipe = (id, patch) => change(s => ({ ...s, recipes: s.recipes.map(r => r.id === id && !r.locked && !groupFlag(s.groups, r.groupId, 'locked') ? { ...r, ...patch } : r) }));
  const patchLegacy = (id, patch) => change(s => ({ ...s, legacyClips: s.legacyClips.map(c => c.id === id && editableClip(s, c) ? { ...c, ...patch,
    effects: (c.effects || []).map(effect => effect.type === 'basic' ? { ...effect, duration: patch.duration ?? effect.duration, params: { ...effect.params, value: patch.value ?? effect.params?.value } } : effect) } : c) }));
  const patchGroup = (id, patch) => {
    const target = allGroups.get(id); if (!target) return;
    change(s => ({ ...s, groups: (s.groups.some(g => g.id === id) ? s.groups : [...s.groups, target]).map(g => g.id === id ? { ...g, ...patch } : g) }));
  };
  const selectClip = (id, isLegacy, additive = false) => {
    setFocusedId(id); setClipIds(old => additive ? old.includes(id) ? old.filter(c => c !== id) : [...old, id] : old.includes(id) ? old : [id]); setTab('pattern');
    if (isLegacy) { const c = studio.legacyClips.find(c => c.id === id); if (c) setSelection([c.fixtureId]); }
    else { const r = studio.recipes.find(r => r.id === id), g = allGroups.get(r?.groupId); if (g) { setGroupId(g.id); setSelection(resolveMembers(g, items)); } }
  };
  const remove = () => {
    if (!clipIds.length) return;
    change(s => ({ ...s, recipes: s.recipes.filter(r => !clipIds.includes(r.id) || !editableClip(s, r)), legacyClips: s.legacyClips.filter(c => !clipIds.includes(c.id) || !editableClip(s, c)) })); setSelectedId(null); };
  const copy = () => { clipboard.current = copyStudioClips(studio, clipIds); setMessage(`Copied ${clipIds.length} timeline clips. Paste inserts them at the playhead.`); };
  const paste = (source = clipboard.current, at = time) => {
    const result = pasteStudioClips(studio, source, at);
    if (!result.selectedIds.length) return;
    change(() => result.studio); setClipIds(result.selectedIds); setFocusedId(result.selectedIds[0]);
  };
  const duplicate = () => {
    const source = copyStudioClips(studio, clipIds), all = [...source.recipes, ...source.legacyClips];
    if (all.length) paste(source, Math.max(...all.map(c => (c.start ?? c.startTime) + c.duration)));
  };
  const save = () => {
    if (pending) { setMessage('Resolving patterns. Save again in a moment.'); return; }
    const project = useProjectStore.getState();
    project.rememberProgrammer({ ...project.programmer, studio, timelineClips: clips, audioFile });
    downloadShowFile(useShowStore.getState(), useEngineeringStore.getState().getProjectPayload(), project.getProjectDocument());
    project.markSaved(); setMessage('Saved the Engineering design, groups, patterns, and resolved timeline in one .aqua file.');
  };
  useEffect(() => {
    if (!active) return;
    const handler = e => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'k') { e.preventDefault(); e.stopImmediatePropagation(); setPalette(v => !v); return; }
      if (e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const key = e.key.toLowerCase();
      const actions = { ' ': () => { if (time >= end) seek(0); setPlaying(v => !v); }, delete: remove, backspace: remove, f: () => setFrame(n => n + 1), escape: () => { setPalette(false); setGhost(false); }, arrowleft: () => seek(Math.max(0, time - (e.shiftKey ? 1 : .1))), arrowright: () => seek(Math.min(end, time + (e.shiftKey ? 1 : .1))) };
      let action = ctrl ? { s: save, z: e.shiftKey ? doc.redo : doc.undo, y: doc.redo, d: duplicate, c: copy, v: () => paste(), g: createGroup, f: () => searchRef.current?.focus(), a: () => {
        if (e.target.closest?.('.sp-timeline')) { const ids = [...studio.recipes, ...studio.legacyClips].map(c => c.id); setClipIds(ids); setFocusedId(ids[0] || null); }
        else selectItems(items.map(i => i.id));
      } }[key] : actions[key];
      if (action) { e.preventDefault(); e.stopImmediatePropagation(); action(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  });
  // Top-bar Edit menu (Cut/Copy/Paste/Delete/Select All/Deselect All) acts on timeline clips.
  useEffect(() => {
    if (!active) return;
    const needClips = fn => () => { if (!clipIds.length) { setMessage('Select timeline clips first.'); return; } fn(); };
    const commands = {
      copy: needClips(copy),
      cut: needClips(() => { copy(); remove(); }),
      paste: () => { if (!clipboard.current) { setMessage('Nothing copied yet. Copy timeline clips first.'); return; } paste(); },
      delete: needClips(remove),
      selectAll: () => { const ids = [...studio.recipes, ...studio.legacyClips].map(c => c.id); setClipIds(ids); setFocusedId(ids[0] || null); setMessage(`Selected ${ids.length} timeline clips.`); },
      deselect: () => { setClipIds([]); setFocusedId(null); setSelection([]); setGroupId(null); },
    };
    const onEdit = e => { const run = commands[e.detail?.command]; if (!run) return; e.detail.handled = true; run(); };
    window.addEventListener('aquaflow:edit-command', onEdit);
    return () => window.removeEventListener('aquaflow:edit-command', onEdit);
  });
  // AI menu → "AI / Music Show Builder" opens the inspector's AI tab.
  useEffect(() => {
    const onOpenAi = e => { if (e.detail) e.detail.handled = true; setTab('ai'); if (studio.layout.hideInspector) layout({ hideInspector: false }); };
    window.addEventListener('aquaflow:open-show-ai', onOpenAi);
    return () => window.removeEventListener('aquaflow:open-show-ai', onOpenAi);
  });
  const rows = useMemo(() => {
    const query = search.toLowerCase();
    const matches = item => !query || [item.label, item.id, item.type, item.zone, item.groupId, item.status, JSON.stringify(item.engineering || {})].join(' ').toLowerCase().includes(query);
    const out = [];
    if (dimension === 'all' || dimension === 'warnings') return items.filter(i => matches(i) && (dimension !== 'warnings' || i.status === 'Needs mapping')).map(item => ({ key: item.id, item }));
    groups.forEach(g => {
      const members = resolveMembers(g, items).map(id => items.find(i => i.id === id)).filter(Boolean).filter(matches);
      if (query && !members.length && !g.name.toLowerCase().includes(query)) return;
      out.push({ key: g.id, group: g, count: members.length });
      if (expanded.has(g.id) || query) members.forEach(item => out.push({ key: `${g.id}:${item.id}`, item, nested: true }));
    });
    return out;
  }, [search, dimension, items, groups, expanded]);
  const propose = async () => {
    if (!group) { setMessage('Choose a target group for AI.'); return; }
    if (groupFlag(studio.groups, group.id, 'locked')) { setMessage('Unlock the target group before composing patterns.'); return; }
    if (!studio.groups.some(g => g.id === group.id)) { change(s => ({ ...s, groups: rememberGroup(group) })); }
    if (!prompt.trim() || aiDuration < 1 || aiDuration > 600 - time) { setMessage('Enter a prompt and duration that ends within 10 minutes.'); return; }
    abort.current?.abort(); const controller = new AbortController(); abort.current = controller;
    const signature = proposalSignature; setBusy(true); setProposal(null); setGhost(false);
    try {
      const response = await fetch(apiUrl('/ai/generate'), { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, duration: aiDuration, bpm: useShowStore.getState().currentShow.bpm, mood: /calm|slow/i.test(prompt) ? 'calm' : 'energetic', include_flame: false, include_laser: false, include_fog: false }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'AI generation failed.');
      const recipes = aiRecipes(data, group.id, prompt, time, aiDuration);
      if (!recipes.length) throw new Error('No usable sections returned. Try another duration.');
      setProposal({ recipes, signature, notes: data.show?.notes }); setProposalIds(recipes.map(r => r.id));
    } catch (error) { setMessage(controller.signal.aborted ? 'Generation cancelled.' : error.message); }
    finally { if (abort.current === controller) setBusy(false); }
  };
  const resize = (key, e) => {
    const origin = e.clientX, originY = e.clientY, initial = studio.layout[key];
    const move = event => {
      const value = key === 'timeline' ? initial + originY - event.clientY : initial + (event.clientX - origin) * (key === 'right' ? -1 : 1);
      const min = key === 'timeline' ? 170 : 190, max = key === 'timeline' ? Math.max(200, host.current.clientHeight - 200) : 430;
      host.current.style.setProperty(`--sp-${key}`, `${Math.max(min, Math.min(max, value))}px`);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); layout({ [key]: parseFloat(host.current.style.getPropertyValue(`--sp-${key}`)) || initial }); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true });
  };
  const navigate = panel => useProjectStore.getState().setActivePanel(panel);
  const commands = [ ['Play / pause', () => setPlaying(v => !v), 'Space'], ['Add pattern', () => addPattern(), ''], ['Create group from selection', createGroup, 'Ctrl+G'], ['Save project', save, 'Ctrl+S'], ['Undo', doc.undo, 'Ctrl+Z'], ['Redo', doc.redo, 'Ctrl+Y'], ['Frame all', () => setFrame(n => n + 1), 'F'], ['Engineering design', () => navigate('geometry'), ''], ['AI assistant', () => setTab('ai'), ''], ['Compile / Siemens', () => setTab('compile'), ''] ];
  const selectedFixtures = items.filter(i => selectedSet.has(i.id));
  const supportedAttributes = [...new Set(selectedFixtures.flatMap(i => i.tracks.map(t => t.type)))];
  return <div className={`show-studio sp-preset-${studio.layout.preset.toLowerCase()} ${studio.layout.hideExplorer ? 'sp-hide-explorer' : ''} ${studio.layout.hideInspector ? 'sp-hide-inspector' : ''}`} ref={host} style={{ '--sp-left': `${studio.layout.left}px`, '--sp-right': `${studio.layout.right}px`, '--sp-timeline': `${studio.layout.timeline}px` }}>
    <header className="sp-header"><div><span className="sp-eyebrow">AQUAFLOW / SHOW PROGRAMMING</span><strong>{name || 'Untitled fountain'}</strong></div>
      <span className="sp-status">{pending ? 'Resolving…' : `${items.length} items synced`}</span><span className="sp-grow" />
      <button onClick={doc.undo} disabled={!doc.canUndo} title="Undo · Ctrl+Z">↶</button><button onClick={doc.redo} disabled={!doc.canRedo} title="Redo · Ctrl+Y">↷</button>
      <button className="sp-primary" onClick={save} disabled={pending}>Save .aqua</button><button onClick={() => setPalette(true)} title="Commands · Ctrl+K">⌘ Commands</button><button onClick={() => navigate('geometry')}>Engineering ↗</button>
    </header>
    <div className="sp-transport"><button onClick={() => { setPlaying(false); seek(0); }} title="Stop preview">■</button><button className="sp-play" onClick={() => { if (time >= end) seek(0); setPlaying(!playing); }} disabled={pending || !clips.length}>{playing ? 'Ⅱ Pause' : '▶ Play preview'}</button>
      <output>{clock(time)}</output><button aria-pressed={loop} onClick={() => setLoop(!loop)}>Loop</button><span className="sp-divider" />
      <button onClick={() => addPattern()}>+ Pattern</button><button onClick={createGroup}>+ Group</button><button onClick={() => setTab('ai')}>AI compose</button><button onClick={() => setTab('compile')}>Compile / Siemens</button><button className={plcPlaying ? 'sp-primary' : ''} onClick={() => setTab('compile')} title="Send this show to PLCSIM or the PLC">{plcPlaying ? `PLC ▶ ${plcPlaying.elapsed.toFixed(1)}s` : '▶ Play on PLC'}</button>
      <span className="sp-grow" /><button aria-pressed={!studio.layout.hideExplorer} onClick={() => layout({ hideExplorer: !studio.layout.hideExplorer })}>Explorer</button><button aria-pressed={!studio.layout.hideInspector} onClick={() => layout({ hideInspector: !studio.layout.hideInspector })}>Inspector</button><label className="sp-inline">Layout<select value={studio.layout.preset} onChange={e => { layout({ preset: e.target.value }); if (e.target.value === 'AI') setTab('ai'); }}>{['Compose', 'Spatial', 'Timing', 'AI'].map(p => <option key={p}>{p}</option>)}</select></label>
    </div>
    <div className="sp-main">
      <aside className="sp-explorer"><div className="sp-strip"><strong>SHOW EXPLORER</strong><span>{selection.length} selected</span></div>
        <input ref={searchRef} className="sp-search" aria-label="Search Engineering items" placeholder="Search items, zones, addresses…" value={search} onChange={e => setSearch(e.target.value)} />
        <select aria-label="Explorer grouping" value={dimension} onChange={e => setDimension(e.target.value)}>{[['groupId', 'Engineering groups'], ['custom', 'Show groups'], ['all', 'All items'], ['zone', 'Zones'], ['type', 'Fixture types'], ['system', 'Systems / pumps'], ['warnings', 'Needs mapping']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        {selection.length > 0 && <div className="sp-check-bar"><span>{selection.length} ticked</span><button onClick={() => selectItems([])}>Clear</button></div>}
        <VirtualList rows={rows} label="Engineering items" renderRow={row => row.group ? <div className={`sp-item sp-group ${groupId === row.group.id ? 'selected' : ''}`} draggable onDragStart={e => e.dataTransfer.setData('application/aquaflow-group', row.group.id)}>
          <GroupTick members={resolveMembers(row.group, items)} selected={selectedSet} name={row.group.name} onToggle={toggleItems} />
          <button aria-label={`Expand ${row.group.name}`} onClick={() => setExpanded(old => { const s = new Set(old); s.has(row.group.id) ? s.delete(row.group.id) : s.add(row.group.id); return s; })}>{expanded.has(row.group.id) ? '▾' : '▸'}</button>
          <button className="sp-item-name" onClick={() => chooseGroup(row.group)}>{row.group.name}</button><small>{row.count}</small>
        </div> : <div className={`sp-item sp-item-row ${row.nested ? 'nested' : ''} ${selectedSet.has(row.item.id) ? 'selected' : ''}`}>
          <input type="checkbox" className="sp-check" aria-label={`Tick ${row.item.label}`} checked={selectedSet.has(row.item.id)} disabled={!row.item.tracks.length} title={row.item.tracks.length ? 'Tick to add to a group' : 'Not programmable'} onChange={e => toggleItems([row.item.id], e.target.checked)} />
          <button className="sp-item-name" title={`${row.item.label} · ${row.item.status} · ${row.item.id}`} onClick={e => { selectItems([row.item.id], e.ctrlKey || e.shiftKey); setTab('group'); }}>
            <span className={`sp-dot ${row.item.status === 'Needs mapping' ? 'warning' : ''}`} />{row.item.label}</button><small>{row.item.status === 'Scenery' ? 'SCENE' : row.item.tracks.length}</small>
        </div>} />
        <div className="sp-explorer-footer"><input aria-label="New group name" placeholder="Name selected group…" value={groupName} onChange={e => setGroupName(e.target.value)} /><button className={selection.length ? 'sp-primary' : ''} onClick={createGroup} disabled={!selection.length}>{selection.length ? `Create group from ${selection.length} ticked` : 'Tick items to make a group'}</button></div>
      </aside>
      <div className="sp-resizer" role="separator" aria-label="Resize Explorer" onPointerDown={e => resize('left', e)} />
      <main className="sp-stage"><div className="sp-strip"><div className="sp-segment">{[['plan', '2D Plan'], ['3d', '3D Water'], ['matrix', 'Matrix']].map(([id, label]) => <button key={id} aria-pressed={studio.layout.view === id} onClick={() => layout({ view: id })}>{label}</button>)}</div><span className="sp-grow" /><button onClick={() => setFrame(n => n + 1)}>Frame all</button></div>
        {active && (studio.layout.view === '3d' ? <Suspense fallback={<p>Loading water renderer…</p>}><StudioPreview clips={ghostClips} time={time} selected={selection} onSelect={selectItems} frame={frame} /></Suspense>
          : <SpatialPlan items={items} selected={selection} onSelect={selectItems} levels={levels} matrix={studio.layout.view === 'matrix'} frame={frame} />)}
        <div className="sp-strip sp-stage-footer"><span>{ghost ? 'PROPOSAL PREVIEW' : 'DESIGN PREVIEW'}</span><span className="sp-grow" /><span>Click to select · Shift to add · drag to box select</span></div>
      </main>
      <div className="sp-resizer" role="separator" aria-label="Resize Inspector" onPointerDown={e => resize('right', e)} />
      <aside className="sp-inspector"><div className="sp-tabs">{['pattern', 'group', 'ai', 'compile', 'music'].map(t => <button key={t} aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'ai' ? 'AI' : t}</button>)}</div>
        <div className="sp-inspector-body">
          {tab === 'pattern' && <>{recipe ? <>
            {issueNotes}
            <span className="sp-eyebrow">PATTERN RECIPE</span><label>Name<input value={recipe.name} onChange={e => patchRecipe(recipe.id, { name: e.target.value })} /></label>
            <label>Target group<select value={recipe.groupId} onChange={e => { patchRecipe(recipe.id, { groupId: e.target.value }); setGroupId(e.target.value); setSelection(resolveMembers(allGroups.get(e.target.value), items)); }}>
              {!studio.groups.some(g => g.id === recipe.groupId) && <option value={recipe.groupId}>Missing group — choose a replacement</option>}{studio.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select></label>
            <label>Effect<select aria-label="Effect" value={recipe.effect} onChange={e => patchRecipe(recipe.id, { effect: e.target.value })}>{EFFECTS.map(p => <option key={p}>{p}</option>)}</select></label>
            {recipe.effect === 'curve' && <EnvelopeEditor value={recipe.envelope} onChange={envelope => patchRecipe(recipe.id, { envelope })} />}
            <label>Parameter<select value={recipe.attribute} onChange={e => patchRecipe(recipe.id, { attribute: e.target.value })}><option value="level">Primary level / water output</option>{supportedAttributes.map(a => <option key={a} value={a}>{fieldLabel(a)}</option>)}</select></label>
            <div className="sp-fields"><NumberField label="Start (s)" value={recipe.start} onChange={start => patchRecipe(recipe.id, { start })} /><NumberField label="Duration (s)" value={recipe.duration} min={.1} onChange={duration => patchRecipe(recipe.id, { duration })} /></div>
            <div className="sp-fields"><NumberField label="Cycles" value={recipe.cycles} min={1} max={32} step={1} onChange={cycles => patchRecipe(recipe.id, { cycles })} /><NumberField label="Level (%)" value={recipe.intensity} max={100} step={1} onChange={intensity => patchRecipe(recipe.id, { intensity })} /></div>
            <label>Selection order<select value={recipe.order} onChange={e => patchRecipe(recipe.id, { order: e.target.value })}>{ORDERS.map(o => <option key={o} value={o}>{fieldLabel(o)}</option>)}</select></label>
            <NumberField label="Phase spread" value={recipe.spread} max={1} onChange={spread => patchRecipe(recipe.id, { spread })} />
            <label>Light / clip color<input type="color" value={recipe.color} onChange={e => patchRecipe(recipe.id, { color: e.target.value })} /></label>
            <label className="sp-checkbox"><input type="checkbox" checked={!!recipe.frozenIds} onChange={e => patchRecipe(recipe.id, { frozenIds: e.target.checked ? resolveMembers(group, items) : undefined })} />Freeze group membership</label>
            <p className="sp-help">{recipe.frozenIds ? 'Uses the saved fixture selection.' : 'Follows Engineering changes through this group.'} Drag the clip to move it; drag its right edge to resize.</p>
            <div className="sp-fields"><button onClick={duplicate}>Duplicate</button><button onClick={remove} disabled={recipe.locked}>Delete pattern</button></div>
            <button onClick={() => change(s => ({ ...s, presets: [...s.presets, { ...recipe, id: uid('preset'), frozenIds: undefined }] }))}>Save as reusable preset</button>
            <button disabled={pending || !editableClip(studio, recipe)} onClick={() => {
              const members = clips.filter(c => c.studioRecipeId === recipe.id).map(c => ({ ...c, studioRecipeId: undefined, patternBlockId: undefined }));
              change(s => ({ ...s, recipes: s.recipes.filter(r => r.id !== recipe.id), legacyClips: [...s.legacyClips, ...members] }));
              setSelectedId(members[0]?.id || null); setMessage('Converted to individual fixture clips. Open Fixture details below to edit channels; Undo restores the recipe.');
            }}>Convert to editable fixture clips</button>
            <button onClick={() => change(s => ({ ...s, recipes: s.recipes.map(r => r.id === recipe.id ? { ...r, locked: !r.locked } : r) }))}>{recipe.locked ? 'Unlock' : 'Lock'} pattern</button>
          </> : legacy ? <>{issueNotes}<strong>{legacy.name || 'Fixture clip'}</strong><p>{legacy.type}</p><NumberField label="Start (s)" value={legacy.startTime} onChange={startTime => patchLegacy(legacy.id, { startTime })} /><NumberField label="Duration (s)" value={legacy.duration} min={.1} onChange={duration => patchLegacy(legacy.id, { duration })} /><NumberField label="Value" value={legacy.value} min={/motion_(pan|tilt|angle)/.test(legacy.type) ? -45 : 0} max={/motion_(pan|tilt|angle)/.test(legacy.type) ? 45 : 100} onChange={value => patchLegacy(legacy.id, { value })} /><div className="sp-fields"><NumberField label="Fade in (s)" value={legacy.fadeIn || 0} max={legacy.duration} onChange={fadeIn => patchLegacy(legacy.id, { fadeIn })} /><NumberField label="Fade out (s)" value={legacy.fadeOut || 0} max={legacy.duration} onChange={fadeOut => patchLegacy(legacy.id, { fadeOut })} /></div><label>Color<input type="color" value={legacy.color || '#65d9d0'} onChange={e => patchLegacy(legacy.id, { color: e.target.value })} /></label><button onClick={duplicate}>Duplicate clip</button><button onClick={remove}>Delete clip</button></>
            : <><span className="sp-eyebrow">BUILD A WATER PATTERN</span><h2>Choose a group.<br />Give it movement.</h2><p className="sp-help">Select items in the plan or Explorer, then add a pattern. Each group stays one editable timeline lane.</p><button className="sp-primary" onClick={() => addPattern()}>+ Add pattern</button><div className="sp-effect-grid">{EFFECTS.map(effect => <button key={effect} onClick={() => { const g = group; if (!g) return setMessage('Select a group first.'); if (groupFlag(studio.groups, g.id, 'locked')) return setMessage('Unlock this group before adding patterns.'); const r = { ...newRecipe(g.id, time), effect, name: fieldLabel(effect) }; change(s => ({ ...s, groups: rememberGroup(g), recipes: [...s.recipes, r] })); setSelectedId(r.id); }}>{effect}</button>)}</div></>}
            {!!studio.presets.length && <><strong>Project presets</strong>{studio.presets.map(preset => <button key={preset.id} onClick={() => { if (!group) return setMessage('Select a group for the preset.'); if (groupFlag(studio.groups, group.id, 'locked')) return setMessage('Unlock this group before adding a preset.'); const r = { ...preset, id: uid('recipe'), groupId: group.id, start: time, locked: false }; change(s => ({ ...s, groups: rememberGroup(group), recipes: [...s.recipes, r] })); setSelectedId(r.id); }}>{preset.name}</button>)}</>}
          </>}
          {tab === 'group' && <><span className="sp-eyebrow">SELECTION & GROUPS</span><h2>{selection.length} items</h2>{group ? <>
            <label>Group name<input value={group.name} onChange={e => patchGroup(group.id, { name: e.target.value })} /></label>
            <label>Order<select value={group.orderMode || 'engineering'} onChange={e => { patchGroup(group.id, { orderMode: e.target.value }); setSelection(orderMembers(resolveMembers(group, items), items, e.target.value).map(f => f.id)); }}>{ORDERS.map(o => <option key={o} value={o}>{fieldLabel(o)}</option>)}</select></label>
            <label>Parent folder<select value={group.parentId || ''} onChange={e => patchGroup(group.id, { parentId: e.target.value || null })}><option value="">Top level</option>{studio.groups.filter(g => g.id !== group.id && !g.parentId && !studio.groups.some(c => c.parentId === group.id)).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
            <p className="sp-help">{group.linkedQuery ? `Live Engineering selection: ${group.linkedQuery.field}. New matching items join automatically.` : 'Saved selection. Use “Replace members” after choosing another set.'}</p>
            <button onClick={() => patchGroup(group.id, { linkedQuery: null, memberFixtureIds: selection })}>Replace members with selection</button><button onClick={() => addPattern()}>+ Pattern for this group</button>
            {studio.groups.some(g => g.id === group.id) && <button onClick={() => { change(s => ({ ...s, groups: s.groups.filter(g => g.id !== group.id).map(g => g.parentId === group.id ? { ...g, parentId: null } : g) })); setGroupId(null); setMessage('Group removed. Any patterns using it are flagged for repair; Undo restores the group.'); }}>Delete show group</button>}
          </> : <><p className="sp-help">Select a group to edit its membership, order, and parent folder. Scenery stays visible but has no control channels.</p>
            {!!selection.length && <label>Replace an existing group's members<select value="" onChange={e => { if (!e.target.value) return; patchGroup(e.target.value, { linkedQuery: null, memberFixtureIds: [...selection] }); setGroupId(e.target.value); }}><option value="">Choose group to update…</option>{studio.groups.filter(g => !groupFlag(studio.groups, g.id, 'locked')).map(g => <option value={g.id} key={g.id}>{g.name}</option>)}</select></label>}
          </>}
            <button onClick={createGroup} disabled={!selection.length}>Save selection as new group</button>
            <div className="sp-selection-list">{selectedFixtures.slice(0, 30).map(f => <div key={f.id}><span>{f.label}</span><small>{f.status}</small></div>)}{selection.length > 30 && <small>and {selection.length - 30} more</small>}</div>
          </>}
          {tab === 'ai' && <><span className="sp-eyebrow">AI CO-DESIGNER</span><h2>Compose for your selection.</h2><p className="sp-help">Target: {group?.name || 'Select a group first'}. Uses AquaFlow’s existing choreography engine. Proposed sections become editable recipes.</p>
            <label>Describe the movement<textarea rows={5} value={prompt} onChange={e => { setPrompt(e.target.value); setProposal(null); setGhost(false); }} /></label><NumberField label="Duration (s)" value={aiDuration} min={1} onChange={setAiDuration} />
            <button className="sp-primary" disabled={busy || !group} onClick={propose}>{busy ? 'Composing…' : 'Generate proposal'}</button>{busy && <button onClick={() => abort.current?.abort()}>Cancel</button>}
            {proposal && <><strong>{proposal.recipes.length} proposed patterns</strong>{!proposalValid && <p className="sp-error">Engineering or target group changed. Generate a new proposal.</p>}
              {proposal.recipes.map(r => <label className="sp-checkbox" key={r.id}><input type="checkbox" checked={proposalIds.includes(r.id)} onChange={e => setProposalIds(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} />{r.name} · {r.start.toFixed(1)}–{(r.start + r.duration).toFixed(1)}s</label>)}
              <button disabled={!proposalValid || !proposalIds.length} onClick={() => { setGhost(!ghost); seek(proposal.recipes[0].start); }}>{ghost ? 'Return to saved show' : 'Preview proposed patterns'}</button>
              <button className="sp-primary" disabled={!proposalValid || !proposalIds.length || groupFlag(studio.groups, groupId, 'locked')} onClick={() => { change(s => ({ ...s, recipes: [...s.recipes, ...proposal.recipes.filter(r => proposalIds.includes(r.id))] })); setProposal(null); setGhost(false); setMessage('Applied proposed patterns. Undo restores the previous show.'); }}>Apply selected patterns</button>
            </>}
          </>}
          {tab === 'compile' && <><span className="sp-eyebrow">RESOLVED SHOW</span><strong>{clips.length} fixture clips</strong><p className="sp-help">Group patterns resolve in the background. Preview and Siemens compilation receive these same timed clips.</p>
            {pending ? <p>Resolving patterns…</p> : issues.length ? <div className="sp-error">{issues.slice(0, 15).map((issue, i) => <p key={i}>{issue}</p>)}{issues.length > 15 && <p>+ {issues.length - 15} more issues</p>}</div> : <>
              <button onClick={() => { try { useICANPreviewStore.getState().load(createFullShowPreview(clips, fixtures, name), 1, audioFile, 'show_programmer'); navigate('preview'); } catch (e) { setMessage(e.message); } }}>Open full 3D / video render</button>
              <StudioPlcPanel clips={clips} items={items} pending={pending} onPlcStatus={followPlc} />
              <details><summary>Advanced PLC controls</summary><SiemensShowControls clips={clips} onLoadExample={newClips => change(s => ({ ...s, recipes: [], legacyClips: newClips }))} /></details>
            </>}
          </>}
          {tab === 'music' && <><span className="sp-eyebrow">MUSIC & ARRAY TOOLS</span><label>Show audio<input type="file" accept="audio/*" onChange={e => setAudioFile(e.target.files?.[0] || null)} /></label><p className="sp-help">{audioName || 'Optional. Preview also plays without music.'}{audioName && !audioFile ? ' — relink this file to hear it.' : ''}</p>
            <strong>Tempo map</strong>{studio.tempo.map((point, index) => <div className="sp-fields" key={index}><NumberField label="From time (s)" value={point.time} onChange={value => change(s => ({ ...s, tempo: s.tempo.map((p, i) => i === index ? { ...p, time: value } : p) }))} /><NumberField label="BPM" value={point.bpm} min={20} max={300} step={1} onChange={bpm => change(s => ({ ...s, tempo: s.tempo.map((p, i) => i === index ? { ...p, bpm } : p) }))} /></div>)}<button onClick={() => change(s => ({ ...s, tempo: [...s.tempo, { time, bpm: 120 }] }))}>+ Tempo change at playhead</button>
            <strong>Cue markers</strong>{studio.markers.map(marker => <div className="sp-fields" key={marker.id}><input aria-label="Marker name" value={marker.name} onChange={e => change(s => ({ ...s, markers: s.markers.map(m => m.id === marker.id ? { ...m, name: e.target.value } : m) }))} /><button onClick={() => change(s => ({ ...s, markers: s.markers.filter(m => m.id !== marker.id) }))}>Delete {marker.time.toFixed(1)}s</button></div>)}
            <details><summary>Music choreography / mapped site</summary><ShowChoreographyAssistant fixtures={fixtures} tracks={tracks} audioFile={audioFile} onMusicFile={e => setAudioFile(e.target.files?.[0] || null)} timelineEnd={end}
              onApply={(result, options) => { change(s => ({ ...s, recipes: options?.replace ? [] : s.recipes, legacyClips: options?.replace ? result.clips : [...s.legacyClips, ...result.clips] })); return true; }} /></details>
            <details><summary>Detailed array sequence</summary><ArrayPatternBuilder fixtures={fixtures} tracks={tracks} currentTime={time} bpm={useShowStore.getState().currentShow.bpm} onApply={plan => { change(s => ({ ...s, legacyClips: [...s.legacyClips, ...plan.clips] })); return true; }} /></details>
          </>}
        </div>
      </aside>
    </div>
    <div className="sp-resizer horizontal" role="separator" aria-label="Resize timeline" onPointerDown={e => resize('timeline', e)} />
    <StudioTimeline studio={studio} items={items} time={time} audioBuffer={audioBuffer} selectedIds={clipIds} onSelect={selectClip}
      onSelectMany={(ids, additive) => { setClipIds(old => additive ? [...new Set([...old, ...ids])] : ids); setFocusedId(ids[0] || null); setTab('pattern'); }}
      onMoveSelection={(ids, delta) => change(s => moveStudioClips(s, ids, delta))} onCopy={copy} onPaste={() => paste()} onDuplicate={duplicate} onDelete={remove}
      plcIssues={blockIssues} plcCheck={plcCheck} plcSiteName={plcSite?.name || ''}
      onFocusIssue={(clipId, at) => { const block = clipId.includes(':') ? clipId.split(':')[0] : clipId; selectClip(block, !studio.recipes.some(r => r.id === block), false); seek(at); setTab('pattern'); }}
      onAddPattern={(groupId, start) => addPattern(groupId, start)}
      onChangeRecipe={patchRecipe} onChangeLegacy={patchLegacy} onSeek={seek} onDropGroup={addPattern} onGroupPatch={patchGroup}
      onMarker={position => change(s => ({ ...s, markers: [...s.markers, { id: uid('marker'), name: `Cue ${s.markers.length + 1}`, time: position }] }))} />
    <footer className="sp-footer" role="status"><span>{message || (issues.length ? `${issues.length} programming issue(s) — open Compile to review` : 'Engineering linked · Space play/pause · Ctrl+G group · Ctrl+D duplicate · Ctrl+K commands')}</span>{message && <button onClick={() => setMessage('')}>×</button>}<span className="sp-grow" /><span>{items.filter(i => i.tracks.length).length} programmable · {studio.groups.length} show groups</span></footer>
    {palette && <div className="sp-modal" onClick={() => setPalette(false)}><div role="dialog" aria-label="Show commands" onClick={e => e.stopPropagation()}><div className="sp-strip"><strong>Commands</strong><button onClick={() => setPalette(false)}>Close</button></div><input autoFocus aria-label="Find command" placeholder="Find a command…" value={commandSearch} onChange={e => setCommandSearch(e.target.value)} />{commands.filter(([label]) => label.toLowerCase().includes(commandSearch.toLowerCase())).map(([label, run, key]) => <button key={label} onClick={() => { setPalette(false); run(); }}>{label}<kbd>{key}</kbd></button>)}</div></div>}
  </div>;
}

function GroupTick({ members, selected, name, onToggle }) {
  const all = members.length > 0 && members.every(id => selected.has(id));
  return <input type="checkbox" className="sp-check" aria-label={`Tick all items in ${name}`} checked={all} disabled={!members.length} onChange={e => onToggle(members, e.target.checked)} />;
}
