/**
 * camera/CameraLane.jsx — the show timeline's Camera lane (Depence-style camera animation).
 *
 * CameraLaneRow      one timeline row: a diamond per key, drag to retime, click to seek.
 * CameraLaneControls the strip under the timeline toolbar: + Camera key, Camera moves, saved
 *                    views as keys, View through camera, Keep horizon level, undo/redo and
 *                    the selected key's inspector.
 * The track lives in the project's render settings (render.cameraTrack) so it is saved with
 * the project and the .aquapkg; the 3D scenes sample it at show time.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useProjectStore from "../../../store/projectStore";
import useEngineeringStore from "../../../store/engineeringStore";
import { poolCenter } from "../../../engineering/geometryContract";
import { normalizeCameraViews } from "../../../utils/cameraViews";
import { CAMERA_MOVES, EASES, buildCameraMove, moveCameraKey, normalizeCameraTrack, removeCameraKey, updateCameraKey } from "./cameraTrack";
import { addKeys, createTrackHistory, designBounds, keyFromView, railKeys, saveViewSlot, viewInSlot } from "./cameraLaneModel";
import { getActiveScene, subscribeActiveScene } from "./activeScene";

export const CAMERA_ROW_HEIGHT = 34;
const ANIMATED = "animated";
const history = createTrackHistory();
const C = { accent: "#33d6ff", sel: "#ffffff", text: "#cde6f2", dim: "#6f8a9c", bg: "#08131d", line: "#24405e" };

const readTrack = () => normalizeCameraTrack(useProjectStore.getState().render?.cameraTrack);

export function commitCameraTrack(next) {
  history.push(readTrack());
  useProjectStore.getState().updateRender({ cameraTrack: normalizeCameraTrack(next) });
}

export function undoCameraTrack() {
  const prev = history.undo(readTrack());
  if (prev) useProjectStore.getState().updateRender({ cameraTrack: prev });
  return !!prev;
}

export function redoCameraTrack() {
  const next = history.redo(readTrack());
  if (next) useProjectStore.getState().updateRender({ cameraTrack: next });
  return !!next;
}

/** Ctrl+1..9 / 1..9 over a 3D canvas: store / fly to saved views in render.cameraViews. */
export function bindViewSlots(scene) {
  if (!scene) return;
  scene.onSaveViewSlot = (slot, view) => {
    const views = useProjectStore.getState().render?.cameraViews || [];
    useProjectStore.getState().updateRender({ cameraViews: saveViewSlot(views, slot, view) });
  };
  scene.onRecallViewSlot = (slot) => {
    const v = viewInSlot(normalizeCameraViews(useProjectStore.getState().render?.cameraViews), slot);
    if (v) scene.flyToView?.(v);
  };
}

const useActiveScene = () => useSyncExternalStore(subscribeActiveScene, getActiveScene, getActiveScene);

function useCameraTrack() {
  const raw = useProjectStore((s) => s.render?.cameraTrack);
  return useMemo(() => normalizeCameraTrack(raw), [raw]);
}

/** Bounds for preset moves: the live scene's, else straight from the design. */
function moveBounds(scene) {
  const b = scene?.getCameraBounds?.();
  if (b?.center) return b;
  const e = useEngineeringStore.getState();
  return designBounds({ poolType: e.poolType, params: e.params, fixtures: e.fixtures, center: poolCenter(e.geometry, e.params, e.poolType) });
}

export function CameraLaneRow({ zoom, labelWidth, scrollX, width, time, onSeek, selectedId, onSelectKey, top = 0 }) {
  const track = useCameraTrack();
  const [ghost, setGhost] = useState(null);
  const drag = useRef(null);
  const tAt = (clientX, el) => Math.max(0, (clientX - el.getBoundingClientRect().left - labelWidth) / zoom);
  const keys = track.keys.map((k) => (ghost && ghost.id === k.id ? { ...k, t: ghost.t } : k));
  return (
    <div data-testid="camera-lane" aria-label="Camera lane" style={{ position: "absolute", top, left: 0, width, height: CAMERA_ROW_HEIGHT, background: C.bg, borderBottom: `1px solid ${C.line}` }}
      onPointerDown={(e) => { if (e.button !== 0 || e.target.closest("button,[data-lane-label]")) return; e.stopPropagation(); onSeek?.(tAt(e.clientX, e.currentTarget)); }}>
      <div data-lane-label style={{ position: "absolute", left: scrollX, width: labelWidth, height: "100%", display: "flex", alignItems: "center", gap: 6, paddingLeft: 8, boxSizing: "border-box", background: "#0b1a26", borderRight: `1px solid ${C.line}`, zIndex: 2, color: C.text, fontSize: 11 }}>
        <span aria-hidden>🎥</span><strong>Camera</strong><span style={{ color: C.dim }}>{track.keys.length ? `${track.keys.length} key${track.keys.length > 1 ? "s" : ""}` : "no keys"}</span>
      </div>
      {keys.slice(1).map((k, i) => {
        const a = keys[i];
        const cut = a.ease === "hold" || a.ease === "cut";
        return <div key={`seg-${k.id}`} style={{ position: "absolute", left: labelWidth + a.t * zoom, width: Math.max(0, (k.t - a.t) * zoom), top: CAMERA_ROW_HEIGHT / 2, borderTop: `2px ${cut ? "dashed" : "solid"} ${cut ? "#7c8fa0" : "#1f8fb3"}` }} />;
      })}
      {keys.map((k) => (
        <button key={k.id} type="button" aria-label={`Camera key ${k.label || ""} at ${k.t.toFixed(2)} s`} aria-pressed={selectedId === k.id}
          title={`${k.label || "Camera key"} · ${k.t.toFixed(2)} s · ${k.ease} · FOV ${Math.round(k.fov)}°\nClick: select and jump · drag: retime`}
          style={{ position: "absolute", left: labelWidth + k.t * zoom - 6, top: CAMERA_ROW_HEIGHT / 2 - 6, width: 12, height: 12, minWidth: 0, minHeight: 0, padding: 0, margin: 0, borderRadius: 0, boxShadow: "none", boxSizing: "border-box", border: `1px solid ${selectedId === k.id ? C.sel : "#0b3e52"}`,
            transform: "rotate(45deg)", background: selectedId === k.id ? C.sel : C.accent, cursor: "ew-resize", zIndex: 1 }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);
            onSelectKey?.(k.id);
            drag.current = { id: k.id, x: e.clientX, t: k.t, moved: false };
          }}
          onPointerMove={(e) => {
            const d = drag.current; if (!d) return;
            const dt = (e.clientX - d.x) / zoom;
            if (Math.abs(e.clientX - d.x) > 2) d.moved = true;
            if (d.moved) setGhost({ id: d.id, t: Math.max(0, Math.round((d.t + dt) * 20) / 20) });
          }}
          onPointerUp={() => {
            const d = drag.current; drag.current = null;
            if (!d) return;
            if (d.moved && ghost) commitCameraTrack(moveCameraKey(readTrack(), d.id, ghost.t));
            else onSeek?.(d.t);
            setGhost(null);
          }}
          onPointerCancel={() => { drag.current = null; setGhost(null); }} />
      ))}
      {!track.keys.length && <span style={{ position: "absolute", left: scrollX + labelWidth + 10, top: 9, fontSize: 10, color: C.dim }}>Move the 3D view where you want it, then press “+ Camera key” — or pick a Camera move.</span>}
      <div style={{ position: "absolute", left: labelWidth + time * zoom, top: 0, height: "100%", borderLeft: "1px solid #ff5d73", pointerEvents: "none" }} />
    </div>
  );
}

const btn = (on, color = C.accent) => ({ background: on ? "#0f3346" : "#0b1a26", color: on ? color : C.text, border: `1px solid ${on ? color : C.line}`, borderRadius: 3, padding: "0 8px", height: 24, minHeight: 0, margin: 0, fontSize: 11, whiteSpace: "nowrap", cursor: "pointer" });
const field = { background: "#07111a", color: C.text, border: `1px solid ${C.line}`, borderRadius: 3, fontSize: 11, padding: "2px 4px", width: "auto", minWidth: 0, height: 24, minHeight: 0, margin: 0, boxSizing: "border-box" };
const inline = { display: "inline-flex", alignItems: "center", gap: 4, margin: 0, whiteSpace: "nowrap", color: C.text, fontSize: 11, fontWeight: 400, textTransform: "none", letterSpacing: 0 };

export function CameraLaneControls({ time, onSeek, selectedId, onSelectKey }) {
  const scene = useActiveScene();
  const track = useCameraTrack();
  const render = useProjectStore((s) => s.render) || {};
  const updateRender = useProjectStore((s) => s.updateRender);
  const guides = useEngineeringStore((s) => s.guidePaths) || [];
  const [moveSeconds, setMoveSeconds] = useState(10);
  const [note, setNote] = useState("");
  const selected = track.keys.find((k) => k.id === selectedId) || null;
  const viewThrough = render.cameraMode === ANIMATED;
  const horizon = render.cameraHorizonLock !== false;
  const views = normalizeCameraViews(render.cameraViews);

  useEffect(() => { scene?.setCameraPathVisible?.(true); return () => scene?.setCameraPathVisible?.(false); }, [scene]);
  useEffect(() => { if (selectedId && !selected) onSelectKey?.(null); }, [selectedId, selected, onSelectKey]);

  const view = () => scene?.getCameraState?.() || null;
  const say = (text) => { setNote(text); };
  const addKey = () => {
    const v = view();
    if (!v) { say("Open the 3D view first (Studio 3D or the Preview panel) — the key is taken from what it shows."); return; }
    const next = keyFromView(track, v, time);
    commitCameraTrack(next);
    const k = next.keys.find((x) => Math.abs(x.t - time) <= 1e-3);
    onSelectKey?.(k?.id || null);
    say(`Camera key at ${time.toFixed(2)} s.`);
  };
  const addMove = (value) => {
    if (!value) return;
    const duration = Math.max(0.5, Number(moveSeconds) || 10);
    let keys = [];
    if (value.startsWith("rail:")) {
      const guide = guides.find((g) => g.id === value.slice(5));
      const e = useEngineeringStore.getState();
      const b = moveBounds(scene);
      keys = railKeys(guide, { start: time, duration, center: poolCenter(e.geometry, e.params, e.poolType), target: { x: b.center.x, y: Math.max(1, b.center.y), z: b.center.z } });
    } else {
      keys = buildCameraMove(value, { bounds: moveBounds(scene), start: time, duration, from: view() });
    }
    if (!keys.length) { say("That move could not be built (the guide line needs two or more points)."); return; }
    commitCameraTrack(addKeys(track, keys));
    if (!viewThrough) updateRender({ cameraMode: ANIMATED });
    say(`${keys.length} keys added from ${time.toFixed(1)} s to ${(time + duration).toFixed(1)} s.`);
  };
  const addSavedView = (id) => {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    commitCameraTrack(keyFromView(track, v, time, { label: v.name }));
    say(`“${v.name}” keyed at ${time.toFixed(2)} s.`);
  };
  const patch = (p) => selected && commitCameraTrack(updateCameraKey(track, selected.id, p));
  const goTo = (k) => {
    onSeek?.(k.t);
    if (!scene) return;
    if (viewThrough) scene.resumeCameraTrack?.(); else scene.flyToView?.(k);
  };

  return (
    <div className="sp-camera-strip" aria-label="Camera animation" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: "4px 8px", background: "#071019", borderBottom: `1px solid ${C.line}`, color: C.text, fontSize: 11 }}
      onKeyDown={(e) => {
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) redoCameraTrack(); else undoCameraTrack(); }
        if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); e.stopPropagation(); redoCameraTrack(); }
      }}>
      <strong style={{ color: C.accent }}>🎥 CAMERA</strong>
      <button type="button" style={btn(false, "#00dca0")} onClick={addKey} title="Store what the 3D view shows now as a key at the playhead (replaces a key already there)">+ Camera key</button>
      <select aria-label="Camera moves" value="" onChange={(e) => addMove(e.target.value)} style={field} title="Insert a ready-made move at the playhead, sized to your site">
        <option value="">Camera moves ▾</option>
        {CAMERA_MOVES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        {guides.map((g, i) => <option key={g.id} value={`rail:${g.id}`}>Rail along {g.label || `guide line ${i + 1}`}</option>)}
        {!guides.length && <option value="" disabled>Rail along a guide line (draw one in the designer)</option>}
      </select>
      <label style={inline}>for
        <input aria-label="Move length (s)" type="number" min="0.5" step="0.5" value={moveSeconds} onChange={(e) => setMoveSeconds(e.target.value)} style={{ ...field, width: 46 }} /> s</label>
      {views.length > 0 && <select aria-label="Saved view as key" value="" onChange={(e) => addSavedView(e.target.value)} style={field}>
        <option value="">Saved view → key ▾</option>
        {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>}
      <button type="button" aria-pressed={viewThrough} style={btn(viewThrough)} onClick={() => updateRender({ cameraMode: viewThrough ? "orbit" : ANIMATED })}
        title="Look through the animated camera while the show plays (also used by video export)">View through camera</button>
      <button type="button" aria-pressed={horizon} style={btn(horizon)} onClick={() => updateRender({ cameraHorizonLock: !horizon })}
        title="Keep the horizon level between keys">Keep horizon level</button>
      <button type="button" style={btn(false)} disabled={!history.canUndo} onClick={undoCameraTrack} title="Undo camera edit (Ctrl+Z)">↶</button>
      <button type="button" style={btn(false)} disabled={!history.canRedo} onClick={redoCameraTrack} title="Redo camera edit (Ctrl+Y)">↷</button>
      {track.keys.length > 0 && <button type="button" style={btn(false, "#ff6677")} onClick={() => { commitCameraTrack({ ...track, keys: [] }); onSelectKey?.(null); say("All camera keys removed (Ctrl+Z to undo)."); }}>Clear</button>}
      {note && <span role="status" style={{ color: C.dim }}>{note}</span>}
      {!selected && <div style={{ flexBasis: "100%", height: 30, boxSizing: "border-box", display: "flex", alignItems: "center", paddingTop: 4, borderTop: `1px dashed ${C.line}`, color: C.dim }}>Click a ◆ key in the Camera row to edit it. Drag it to change its time.</div>}
      {selected && (
        <div aria-label="Camera key" style={{ flexBasis: "100%", height: 30, boxSizing: "border-box", display: "flex", flexWrap: "nowrap", overflow: "hidden", alignItems: "center", gap: 6, paddingTop: 4, borderTop: `1px dashed ${C.line}` }}>
          <span style={{ color: C.accent }}>◆ Key</span>
          <label style={inline}>Time <input aria-label="Key time (s)" type="number" min="0" step="0.05" value={Number(selected.t.toFixed(3))} style={{ ...field, width: 64 }}
            onChange={(e) => { const t = Number(e.target.value); if (Number.isFinite(t)) commitCameraTrack(moveCameraKey(track, selected.id, t)); }} /> s</label>
          <label style={inline}>Ease <select aria-label="Key ease" value={selected.ease} style={field} onChange={(e) => patch({ ease: e.target.value })}>
            {EASES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></label>
          <label style={inline}>FOV <input aria-label="Key FOV" type="number" min="5" max="120" step="1" value={Math.round(selected.fov)} style={{ ...field, width: 48 }}
            onChange={(e) => { const f = Number(e.target.value); if (Number.isFinite(f)) patch({ fov: f }); }} />°</label>
          <label style={inline}>Label <input aria-label="Key label" value={selected.label || ""} style={{ ...field, width: 110 }} onChange={(e) => patch({ label: e.target.value })} /></label>
          <button type="button" style={btn(false)} onClick={() => { const v = view(); if (v) patch({ position: v.position, target: v.target, fov: v.fov }); else say("Open the 3D view first."); }}>Update from view</button>
          <button type="button" style={btn(false)} onClick={() => goTo(selected)}>Go to view</button>
          <button type="button" style={btn(false, "#ff6677")} onClick={() => { commitCameraTrack(removeCameraKey(track, selected.id)); onSelectKey?.(null); }}>Delete</button>
        </div>
      )}
    </div>
  );
}
