import { useEffect, useMemo, useRef, useState } from 'react';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { useICANPreviewStore } from '../../../store/icanPreviewStore';
import { poolCenter } from '../../../engineering/geometryContract';
import { createFullShowPreview } from '../../../utils/fullShowPreview';
import StudioTimeline from './StudioTimeline';
import {
  compileStudio, copyStudioClips, editableClip, groupFlag, inventory,
  moveStudioClips, newRecipe, pasteStudioClips, readStudio, uid,
} from './showModel';
import './showStudio.css';

const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${(value % 60).toFixed(2).padStart(5, '0')}`;

export default function PreviewShowTimeline({ height = 300 }) {
  const fixtures = useEngineeringStore(s => s.fixtures);
  const models = useEngineeringStore(s => s.siteModels);
  const geometry = useEngineeringStore(s => s.geometry);
  const params = useEngineeringStore(s => s.params);
  const poolType = useEngineeringStore(s => s.poolType);
  const projectName = useEngineeringStore(s => s.projectName);
  const programmer = useProjectStore(s => s.programmer);
  const rememberProgrammer = useProjectStore(s => s.rememberProgrammer);
  const navigate = useProjectStore(s => s.setActivePanel);
  const preview = useICANPreviewStore();
  const [selectedIds, setSelectedIds] = useState([]);
  const [loop, setLoop] = useState(true);
  const [message, setMessage] = useState('');
  const clipboard = useRef(null);

  const studio = useMemo(() => readStudio(programmer), [programmer]);
  const items = useMemo(
    () => inventory(fixtures, models, poolCenter(geometry, params, poolType)),
    [fixtures, models, geometry, params, poolType],
  );
  const resolved = useMemo(() => compileStudio(studio, items), [studio, items]);
  const end = Math.max(1, ...resolved.clips.map(c => c.startTime + c.duration));

  const commit = next => {
    const compiled = compileStudio(next, items);
    rememberProgrammer({
      ...(useProjectStore.getState().programmer || {}),
      studio: next,
      timelineClips: compiled.clips,
      audioDuration: Math.max(30, ...compiled.clips.map(c => c.startTime + c.duration)),
    });
    setMessage(compiled.issues.length ? `${compiled.issues.length} programming issue(s)` : '3D preview updated');
  };
  const change = action => commit(typeof action === 'function' ? action(studio) : action);

  useEffect(() => {
    if (!resolved.clips.length || resolved.issues.length) return;
    try {
      preview.replace(createFullShowPreview(resolved.clips, fixtures, projectName || '3D show preview'), 1, null, 'show_programmer');
      setMessage('');
    } catch (error) {
      setMessage(error.message);
    }
  }, [resolved.clips, resolved.issues, fixtures, projectName]);

  useEffect(() => {
    if (!loop || preview.playback !== 'complete') return;
    preview.seek(0);
    preview.play();
  }, [loop, preview.playback]);

  useEffect(() => {
    const valid = new Set([...studio.recipes, ...studio.legacyClips].map(c => c.id));
    setSelectedIds(old => old.filter(id => valid.has(id)));
  }, [studio.recipes, studio.legacyClips]);

  const select = (id, _legacy, additive = false) => setSelectedIds(old => (
    additive ? (old.includes(id) ? old.filter(value => value !== id) : [...old, id]) : [id]
  ));
  const remove = () => change(s => ({
    ...s,
    recipes: s.recipes.filter(c => !selectedIds.includes(c.id) || !editableClip(s, c)),
    legacyClips: s.legacyClips.filter(c => !selectedIds.includes(c.id) || !editableClip(s, c)),
  }));
  const copy = () => { clipboard.current = copyStudioClips(studio, selectedIds); };
  const paste = (source = clipboard.current, at = preview.position) => {
    const result = pasteStudioClips(studio, source, at);
    if (!result.selectedIds.length) return;
    commit(result.studio);
    setSelectedIds(result.selectedIds);
  };
  const duplicate = () => {
    const source = copyStudioClips(studio, selectedIds);
    const clips = [...source.recipes, ...source.legacyClips];
    if (clips.length) paste(source, Math.max(...clips.map(c => (c.start ?? c.startTime) + c.duration)));
  };
  const addPattern = (groupId, start = preview.position) => {
    const group = studio.groups.find(g => g.id === groupId);
    if (!group || groupFlag(studio.groups, groupId, 'locked')) return;
    const recipe = { ...newRecipe(groupId, Math.min(592, start)), order: group.orderMode || 'left-to-right' };
    change(s => ({ ...s, recipes: [...s.recipes, recipe] }));
    setSelectedIds([recipe.id]);
  };
  const patchRecipe = (id, patch) => change(s => ({ ...s, recipes: s.recipes.map(recipe => (
    recipe.id === id && editableClip(s, recipe) ? { ...recipe, ...patch } : recipe
  )) }));
  const patchLegacy = (id, patch) => change(s => ({ ...s, legacyClips: s.legacyClips.map(clip => (
    clip.id === id && editableClip(s, clip) ? { ...clip, ...patch } : clip
  )) }));
  const patchGroup = (id, patch) => change(s => ({ ...s, groups: s.groups.map(group => group.id === id ? { ...group, ...patch } : group) }));

  const play = () => {
    if (!resolved.clips.length || resolved.issues.length) return;
    if (preview.position >= end || preview.playback === 'complete') preview.seek(0);
    preview.playback === 'playing' ? preview.pause() : preview.play();
  };

  return <div className="show-studio preview-show-timeline" style={{ height, '--sp-timeline': `${Math.max(160, height - 45)}px` }}>
    <div className="sp-transport preview-timeline-transport">
      <span className="preview-timeline-title"><i />3D SHOW TIMELINE</span>
      <button onClick={() => preview.stop()} title="Stop preview">■</button>
      <button className="sp-play" onClick={play} disabled={!resolved.clips.length || !!resolved.issues.length}>
        {preview.playback === 'playing' ? 'Ⅱ Pause' : '▶ Play preview'}
      </button>
      <output>{clock(preview.position)}</output>
      <button aria-pressed={loop} onClick={() => setLoop(value => !value)}>Loop</button>
      <span className="sp-divider" />
      <span className="preview-timeline-cues">{resolved.clips.length} resolved cues</span>
      {resolved.issues.length > 0 && <span className="preview-timeline-error">{resolved.issues.length} issue(s)</span>}
      {message && <span className="preview-timeline-message">{message}</span>}
      <span className="sp-grow" />
      <button onClick={() => navigate('show_programmer')}>Open full Show Programming ↗</button>
    </div>
    <StudioTimeline
      studio={studio} items={items} time={preview.position} audioBuffer={null} selectedIds={selectedIds}
      onSelect={select}
      onSelectMany={(ids, additive) => setSelectedIds(old => additive ? [...new Set([...old, ...ids])] : ids)}
      onMoveSelection={(ids, delta) => change(s => moveStudioClips(s, ids, delta))}
      onCopy={copy} onPaste={() => paste()} onDuplicate={duplicate} onDelete={remove}
      onAddPattern={addPattern}
      onChangeRecipe={patchRecipe} onChangeLegacy={patchLegacy}
      onSeek={preview.seek} onDropGroup={addPattern} onGroupPatch={patchGroup}
      onMarker={position => change(s => ({ ...s, markers: [...s.markers, { id: uid('marker'), name: `Cue ${s.markers.length + 1}`, time: position }] }))}
    />
  </div>;
}
