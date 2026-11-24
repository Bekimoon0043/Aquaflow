// Pattern Preview: a floating, non-modal tool window over Show Programming that
// plays the selected pattern alone, looping, in its own low-quality 3D scene.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FountainScene } from '../FountainScene_v6';
import { useEngineeringSync } from '../../../hooks/useEngineeringSync';
import useEngineeringStore from '../../../store/engineeringStore';
import useProjectStore from '../../../store/projectStore';
import { createFullShowPreview, evaluateFullShowPreview } from '../../../utils/fullShowPreview';
import { createICANPreviewPlan } from '../../../utils/icanPatternPreview';
import { getActiveScene } from '../camera/activeScene';
import { IconButton, Toolbar, Select } from '../../../ui';
import { useFocusPreviewStore, PREVIEW_SHORTCUT } from './focusPreviewStore';
import { EDGES, displayRect, moveRect, resizeRect, restoreUnderPointer, snapRect, maximizedRect } from './windowGeometry';
import { localizeClips } from './draftPreview';
import { loopTime } from './patternPreview';
import './focusPreview.css';

const FPS = 30;
const EMPTY = Object.freeze([]);

/** The Show Programming work area a maximized window fills: below Studio's toolbar so Play,
 *  Preview and the other commands stay reachable (falls back to the whole Studio, then the viewport). */
function workspaceArea() {
  const host = typeof document !== 'undefined' && (document.querySelector('.show-studio .sp-main') || document.querySelector('.show-studio'));
  const r = host?.getBoundingClientRect?.();
  return r && r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null;
}

/** Title-bar text: what is playing · who owns it · how many members. */
export function previewTitle({ draftClips, pattern, selectionIds }) {
  if (draftClips) return { name: 'Builder draft', detail: `${selectionIds.length} fixture${selectionIds.length === 1 ? '' : 's'}` };
  if (pattern) return { name: pattern.name, detail: `${pattern.owner} · ${pattern.memberIds.length}` };
  return { name: 'Pattern preview', detail: selectionIds.length ? `${selectionIds.length} selected` : 'nothing selected' };
}

export default function FocusPreview() {
  const mode = useFocusPreviewStore(s => s.mode);
  const rect = useFocusPreviewStore(s => s.rect);
  const draftClips = useFocusPreviewStore(s => s.draftClips);
  const pattern = useFocusPreviewStore(s => s.pattern);
  const selectionIds = useFocusPreviewStore(s => s.selectionIds);
  const pinned = useFocusPreviewStore(s => s.pinned);
  const autoOpen = useFocusPreviewStore(s => s.autoOpen);
  const actions = useFocusPreviewStore.getState();
  const [viewport, setViewport] = useState(() => ({ width: globalThis.innerWidth || 1440, height: globalThis.innerHeight || 900 }));
  const [area, setArea] = useState(workspaceArea);
  const drag = useRef(null);

  // Re-clamp on window resize and keep the maximized frame on the workspace.
  useEffect(() => {
    const onResize = () => {
      setViewport({ width: innerWidth, height: innerHeight });
      setArea(workspaceArea());
      const store = useFocusPreviewStore.getState();
      store.setRect(store.rect);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => { if (mode === 'maximized') setArea(workspaceArea()); }, [mode]);

  const frame = displayRect({ mode, rect }, area, viewport.width, viewport.height);
  const title = previewTitle({ draftClips, pattern, selectionIds });
  const minimized = mode === 'minimized', maximized = mode === 'maximized';

  const beginDrag = (e, edge = null) => {
    if (e.button !== 0 || e.target.closest('button')) return;
    if (edge && mode !== 'normal') return;
    drag.current = { edge, x: e.clientX, y: e.clientY, rect: useFocusPreviewStore.getState().rect, fromMaximized: maximized && !edge, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onDrag = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 3) return;
    if (d.fromMaximized && !d.moved) {
      // Dragging a maximized window restores it under the pointer.
      const restored = restoreUnderPointer(d.rect, maximizedRect(area, viewport.width, viewport.height), e.clientX, e.clientY);
      actions.restore(restored);
      Object.assign(d, { rect: useFocusPreviewStore.getState().rect, x: e.clientX, y: e.clientY, fromMaximized: false, moved: true });
      return;
    }
    d.moved = true;
    actions.setRect(d.edge ? resizeRect(d.rect, d.edge, dx, dy) : moveRect(d.rect, dx, dy), { persist: false });
  };
  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    const current = useFocusPreviewStore.getState().rect;
    actions.setRect(d.edge ? current : snapRect(current, viewport.width, viewport.height));
  };

  const onWindowKey = (e) => {
    if (e.key === 'Escape') {
      // Esc only leaves the preview window; it never closes other app things.
      e.preventDefault(); e.stopPropagation();
      e.currentTarget.blur?.(); document.activeElement?.blur?.();
      return;
    }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); actions.toggleMaximize(); return; }
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); actions.toggleMinimize(); }
  };
  const onTitleKey = (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || mode !== 'normal') return;
    if (e.key === 'Enter') { e.preventDefault(); actions.toggleMaximize(); return; }
    if (actions.nudge(e.key, e.shiftKey)) { e.preventDefault(); e.stopPropagation(); }
  };

  const geometry = { '--fp-x': `${frame.x}px`, '--fp-y': `${frame.y}px`, '--fp-w': `${frame.width}px`, '--fp-h': `${frame.height}px` };
  return <section className={`focus-preview fp-${mode}`} role="dialog" aria-label={`Pattern preview: ${title.name}`} onKeyDown={onWindowKey} style={geometry}>
    <div className="fp-titlebar" tabIndex={0} aria-label="Pattern preview title bar. Arrow keys move, Shift+arrows resize, Enter maximizes"
      title="Drag to move · double-click to maximize" onPointerDown={beginDrag} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={e => { if (!e.target.closest('button')) actions.toggleMaximize(); }} onKeyDown={onTitleKey}>
      <span className="fp-title"><strong>{title.name}</strong><span>{title.detail}</span></span>
      <span className="fp-window-buttons">
        <IconButton icon={minimized ? 'restore' : 'minimize'} label={minimized ? 'Expand pattern preview' : 'Minimize pattern preview'} shortcut="Alt+↓" onClick={actions.toggleMinimize} />
        <IconButton icon={maximized ? 'restore' : 'maximize'} label={maximized ? 'Restore pattern preview' : 'Maximize pattern preview'} shortcut="Alt+↑ · double-click title" onClick={actions.toggleMaximize} />
        <IconButton className="ui-icon-button fp-close" icon="close" label="Close pattern preview" shortcut={PREVIEW_SHORTCUT} onClick={actions.close} />
      </span>
    </div>
    <div className="fp-body" hidden={minimized}>
      <FocusScene paused={minimized} pinned={pinned} autoOpen={autoOpen} />
    </div>
    {mode === 'normal' && EDGES.map(edge => <div key={edge} className={`fp-edge fp-edge-${edge}`} aria-hidden="true"
      onPointerDown={e => beginDrag(e, edge)} onPointerMove={onDrag} onPointerUp={endDrag} onPointerCancel={() => { drag.current = null; }} />)}
  </section>;
}

function FocusScene({ paused, pinned, autoOpen }) {
  const canvas = useRef(null), host = useRef(null), sceneRef = useRef(null), visible = useRef(true), clock = useRef(0), live = useRef(null);
  const [playing, setPlaying] = useState(true), [loop, setLoop] = useState(true), [speed, setSpeed] = useState(1), [time, setTime] = useState(0), [error, setError] = useState('');
  const selectionIds = useFocusPreviewStore(s => s.selectionIds);
  const draft = useFocusPreviewStore(s => s.draftClips);
  const draftError = useFocusPreviewStore(s => s.error);
  const pattern = useFocusPreviewStore(s => s.pattern);
  const source = useFocusPreviewStore(s => s.source);
  const fixtures = useEngineeringStore(s => s.fixtures);
  const saved = useProjectStore(s => s.programmer?.timelineClips);

  // Priority: the builder's live draft, then the selected pattern, then (outside Show Studio) the saved show.
  const subjectKey = draft ? 'draft' : pattern ? `pattern:${pattern.id}` : 'selection';
  const local = useMemo(() => {
    if (draft) return localizeClips(draft);
    if (pattern) return localizeClips(pattern.clips, { origin: pattern.origin, duration: pattern.duration });
    return localizeClips(source === 'studio' ? EMPTY : saved || EMPTY);
  }, [draft, pattern, source, saved]);
  const ids = draft ? selectionIds : pattern ? pattern.memberIds : selectionIds;
  const idsKey = ids.join('|');
  const plan = useMemo(() => {
    try { return local.clips.length ? createICANPreviewPlan(createFullShowPreview(local.clips, fixtures, 'Draft', { skipUnsupported: true }), 1) : null; }
    catch { return null; }
  }, [local, fixtures]);
  live.current = { playing, loop, speed, plan, duration: local.duration, fixtures, paused };

  useEffect(() => {
    let scene, observer, resize, raf;
    try {
      scene = new FountainScene(canvas.current, { quality: 'low', maxFps: FPS, particleBudgetScale: .2, environment: 'night' });
      scene.init(); scene.stopPattern(); scene.orbitAuto = false; scene.setReviewOverlays(false);
      sceneRef.current = scene;
      resize = new ResizeObserver(() => { const r = host.current?.getBoundingClientRect(); if (r?.width && r.height) scene.resize(r.width, r.height); });
      resize.observe(host.current);
      if (typeof IntersectionObserver !== 'undefined') {
        observer = new IntersectionObserver(entries => { visible.current = entries[0]?.isIntersecting !== false; scene.renderVisible = visible.current && !live.current.paused; });
        observer.observe(host.current);
      }
      let last = 0;
      const tick = now => {
        raf = requestAnimationFrame(tick);
        const v = live.current;
        if (document.hidden || !visible.current || v.paused || now - last < 1000 / FPS) { if (v.paused || document.hidden) last = now; return; }
        const elapsed = last ? Math.min(.1, (now - last) / 1000) : 0;
        last = now;
        if (v.playing) {
          clock.current += elapsed * v.speed;
          if (clock.current >= v.duration) {
            if (v.loop) clock.current = loopTime(clock.current, v.duration);
            else { clock.current = v.duration; setPlaying(false); }
          }
        }
        if (v.plan) scene.setSignals(evaluateFullShowPreview(v.plan, clock.current, v.fixtures));
        scene.setCameraTime?.(clock.current);
        setTime(clock.current);
      };
      raf = requestAnimationFrame(tick);
    } catch (e) { setError(e.message); }
    return () => { cancelAnimationFrame(raf); resize?.disconnect(); observer?.disconnect(); scene?.dispose(); sceneRef.current = null; };
  }, []);
  useEngineeringSync(sceneRef);

  // Minimized: stop the scene's own render loop too.
  useEffect(() => { if (sceneRef.current) sceneRef.current.renderVisible = visible.current && !paused; }, [paused]);
  // Isolate + frame only when the members change, never on a pattern edit (the camera stays put).
  useEffect(() => {
    const scene = sceneRef.current, list = idsKey ? idsKey.split('|') : [];
    scene?.setSelectionOutline(list); scene?.setIsolation(list, { ghostOpacity: .15 }); scene?.frameFixtures(list);
  }, [idsKey, fixtures]);
  // A new subject plays from its start; an edit keeps the loop position (wrapped into the new length).
  useEffect(() => { clock.current = 0; setTime(0); setPlaying(true); }, [subjectKey]);
  useEffect(() => { clock.current = loopTime(clock.current, local.duration); setTime(clock.current); }, [local.duration]);

  const seek = n => { clock.current = n; setTime(n); };
  const openMain = () => { const scene = getActiveScene(); scene?.setSelectionOutline?.(ids); scene?.setIsolation?.(ids, { ghostOpacity: .15 }); scene?.frameFixtures?.(ids); };
  const programmable = fixtures.some(f => ids.includes(f.id));
  const hint = error || draftError
    || (!ids.length ? (source === 'studio' ? 'Select a pattern, group or items to preview.' : 'Select a fixture or group to preview.') : '')
    || (!programmable ? 'This selection has no programmable fixtures.' : '')
    || (!draft && !pattern && source === 'studio' ? 'No pattern — add one with ＋ Pattern or ✦ Pattern builder.' : '')
    || (pattern && !local.clips.length ? 'This pattern produces no output (muted group or invalid timing).' : '');
  const store = useFocusPreviewStore.getState();

  return <>
    <div className="focus-canvas" ref={host}><canvas ref={canvas} />{hint && <p className="focus-hint" role="status">{hint}</p>}</div>
    <Toolbar aria-label="Pattern preview transport">
      <IconButton icon={playing ? 'pause' : 'play'} label={playing ? 'Pause pattern preview' : 'Play pattern preview'} onClick={() => setPlaying(v => !v)} />
      <IconButton icon="loop" label="Loop pattern preview" aria-pressed={loop} onClick={() => setLoop(v => !v)} />
      <input aria-label="Pattern preview time" type="range" min={0} max={local.duration} step={.02} value={Math.min(time, local.duration)} onChange={e => seek(Number(e.target.value))} />
      <Select aria-label="Pattern preview speed" value={speed} onChange={e => setSpeed(Number(e.target.value))} options={[.25, .5, 1, 1.5, 2].map(value => ({ value, label: `${value}×` }))} />
      <IconButton icon="frame" label="Show these fixtures in the main viewport" onClick={openMain} />
    </Toolbar>
    <div className="focus-views">
      {['front', 'top', 'iso'].map(v => <button key={v} type="button" onClick={() => sceneRef.current?.snapView(v)}>{v}</button>)}
      <button type="button" onClick={() => { if (sceneRef.current) sceneRef.current.orbitAuto = !sceneRef.current.orbitAuto; }}>Orbit</button>
      <button type="button" aria-pressed={autoOpen} title="Open this window automatically when a pattern is selected or added" onClick={() => store.setAutoOpen(!autoOpen)}>Auto-open</button>
      <button type="button" aria-pressed={pinned} title="Keep this window open when nothing is selected" onClick={store.togglePin}>Pin</button>
      <output>{time.toFixed(1)} / {local.duration.toFixed(1)} s</output>
    </div>
  </>;
}
