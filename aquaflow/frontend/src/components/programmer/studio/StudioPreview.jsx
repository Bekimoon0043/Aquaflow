import { useEffect, useRef, useState } from 'react';
import { Vector3 } from 'three';
import { FountainScene } from '../../preview/FountainScene_v6';
import { useEngineeringSync } from '../../../hooks/useEngineeringSync';
import useEngineeringStore from '../../../store/engineeringStore';
import { poolCenter } from '../../../engineering/geometryContract';
import { createFullShowPreview, evaluateFullShowPreview } from '../../../utils/fullShowPreview';
import { createICANPreviewPlan } from '../../../utils/icanPatternPreview';
import { SceneGraph } from '../../preview/editor/sceneGraph';
import { reconcileEngineeringGraph } from '../../preview/editor/fixtureBridge';
import useProjectStore from '../../../store/projectStore';
import { normalizeCameraTrack } from '../../preview/camera/cameraTrack';
import { clearActiveScene, setActiveScene } from '../../preview/camera/activeScene';
import { bindViewSlots } from '../../preview/camera/CameraLane';
import { isPyroClip, pyroCuesFromClips } from '../../../show/pyro';

export default function StudioPreview({ clips, time, selected, onSelect, frame }) {
  const canvas = useRef(null), sceneRef = useRef(null), wrapper = useRef(null), overlay = useRef(null);
  const [error, setError] = useState('');
  const [freeLook, setFreeLook] = useState(false);
  const trackRaw = useProjectStore(s => s.render?.cameraTrack);
  const viewThrough = useProjectStore(s => s.render?.cameraMode === 'animated');
  const horizonLock = useProjectStore(s => s.render?.cameraHorizonLock !== false);
  const hasKeys = normalizeCameraTrack(trackRaw).keys.length > 0;
  const [nonvisual, setNonvisual] = useState(0);
  const current = useRef({ selected, onSelect, time });
  current.current = { selected, onSelect, time };
  const plan = useRef(null), hitPoints = useRef([]), start = useRef(null);
  const fixtures = useEngineeringStore(s => s.fixtures);
  const models = useEngineeringStore(s => s.siteModels);
  useEffect(() => {
    let scene, resize, animation;
    try {
      scene = new FountainScene(canvas.current, { environment: 'night', quality: 'medium', cameraMode: 'orbit', lightColor: '#65d9d0' });
      scene.init(); scene.stopPattern(); scene.setReviewOverlays(false); scene.orbitAuto = false;
      sceneRef.current = scene;
      scene.onLeaveCameraTrack = () => setFreeLook(true);
      bindViewSlots(scene);
      setActiveScene(scene);
      resize = new ResizeObserver(() => { if (!wrapper.current) return; const r = wrapper.current.getBoundingClientRect(); if (r.width && r.height) scene.resize(r.width, r.height); });
      resize.observe(wrapper.current);
      const draw = () => {
        if (!overlay.current || !wrapper.current) return;
        const engine = useEngineeringStore.getState();
        if (plan.current) scene.setSignals(evaluateFullShowPreview(plan.current, current.current.time, engine.fixtures));
        scene.setCameraTime?.(current.current.time);
        const element = overlay.current, ctx = element.getContext('2d'), rect = wrapper.current.getBoundingClientRect();
        element.width = rect.width; element.height = rect.height;
        const center = poolCenter(engine.geometry, engine.params, engine.poolType);
        const selection = new Set(current.current.selected);
        hitPoints.current = engine.fixtures.map(f => {
          const point = new Vector3((Number(f.x) || 0) - center.cx, Number(f.z) || .1, (Number(f.y) || 0) - center.cy).project(scene.camera);
          return { id: f.id, x: (point.x + 1) * rect.width / 2, y: (1 - point.y) * rect.height / 2, z: point.z };
        }).filter(p => p.z > -1 && p.z < 1);
        hitPoints.current.forEach(p => { if (!selection.has(p.id)) return; ctx.strokeStyle = '#ffe39b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.stroke(); });
        animation = requestAnimationFrame(draw);
      };
      draw();
    } catch (e) { setError(`3D preview unavailable: ${e.message}. Use Plan or Matrix view.`); }
    return () => { cancelAnimationFrame(animation); resize?.disconnect(); clearActiveScene(scene); scene?.dispose(); sceneRef.current = null; };
  }, []);
  useEffect(() => { sceneRef.current?.setCameraTrack?.(trackRaw); }, [trackRaw]);
  useEffect(() => { sceneRef.current?.setHorizonLock?.(horizonLock); }, [horizonLock]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (viewThrough && hasKeys) scene.resumeCameraTrack?.();
    else scene.leaveCameraTrack?.();
    setFreeLook(false);
  }, [viewThrough, hasKeys]);
  useEngineeringSync(sceneRef);
  useEffect(() => {
    if (!sceneRef.current) return;
    const engine = useEngineeringStore.getState();
    const graph = new SceneGraph();
    reconcileEngineeringGraph(graph, { fixtures: [], siteModels: models, center: poolCenter(engine.geometry, engine.params, engine.poolType) });
    sceneRef.current.syncModelGraph(graph);
  }, [models, fixtures]);
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.fitCameraToDesign(); scene.orbitAuto = false;
    if (useProjectStore.getState().render?.cameraMode === 'animated' && hasKeys) scene.resumeCameraTrack?.();
  }, [frame]);
  useEffect(() => {
    const engine = useEngineeringStore.getState();
    sceneRef.current?.setPyroCues?.(pyroCuesFromClips(clips, fixtures, poolCenter(engine.geometry, engine.params, engine.poolType)));
    const visual = [], supported = new Map();
    for (const clip of clips) {
      if (isPyroClip(clip)) continue;
      const key = `${clip.fixtureId}:${clip.type}`;
      if (!supported.has(key)) {
        try { createFullShowPreview([clip], fixtures); supported.set(key, true); } catch { supported.set(key, false); }
      }
      if (supported.get(key)) visual.push(clip);
    }
    setNonvisual([...supported.values()].filter(value => !value).length);
    try {
      if (visual.length) plan.current = createICANPreviewPlan(createFullShowPreview(visual, fixtures), 1);
      else plan.current = { duration: 600, passMs: 600000, repeat: 1, visualClips: [] };
    } catch (e) { setError(e.message); plan.current = { duration: 600, passMs: 600000, repeat: 1, visualClips: [] }; }
  }, [clips, fixtures]);
  return <div className="sp-preview" ref={wrapper} onPointerEnter={() => sceneRef.current && setActiveScene(sceneRef.current)}>
    {viewThrough && hasKeys && freeLook && <button type="button" className="sp-free-view-chip" onClick={() => { sceneRef.current?.resumeCameraTrack(); setFreeLook(false); }}
      style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 5, background: '#0f3346', color: '#33d6ff', border: '1px solid #33d6ff', borderRadius: 12, padding: '3px 12px', fontSize: 11, cursor: 'pointer' }}>
      Free view · Back to camera</button>}
    <canvas ref={canvas} onPointerDown={e => { start.current = [e.clientX, e.clientY]; }} onPointerUp={e => {
      if (!start.current || Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 4) return;
      if (!wrapper.current) return;
      const rect = wrapper.current.getBoundingClientRect();
      const point = hitPoints.current.filter(p => Math.hypot(p.x - (e.clientX - rect.left), p.y - (e.clientY - rect.top)) < 16).sort((a, b) => a.z - b.z)[0];
      if (point) current.current.onSelect([point.id], e.shiftKey || e.ctrlKey);
    }} />
    <canvas ref={overlay} className="sp-preview-overlay" />
    <span className="sp-preview-caption">{error || `Live design preview · click to select · drag to orbit${nonvisual ? ` · ${nonvisual} nonvisual channels in timeline` : ''}`}</span>
  </div>;
}
