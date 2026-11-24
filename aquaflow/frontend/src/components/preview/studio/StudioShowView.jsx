// Studio renderer of the 3D preview: plays the show with the Easy Fountain Design renderer
// (EasyScene): particle water where every drop keeps the level and swing it left its nozzle
// with, bloom, a reflective rippled basin, indirect light from lit water and a night sky.
// It follows the preview clock and the project's camera track, and renders frame-exact video.

import { useEffect, useMemo, useRef, useState } from "react";
import { EasyScene } from "../../panels/easy/EasyScene";
import { poolShape, basinPolygon, sceneItems, showJets } from "../../panels/easy/sceneData";
import { createShowHistory } from "./showHistory";
import { previewPlanProject } from "../../../utils/fullShowPreview";
import { poolCenter } from "../../../engineering/geometryContract";
import { useICANPreviewStore } from "../../../store/icanPreviewStore";
import { useShowStore } from "../../../store/showStore";
import useEngineeringStore from "../../../store/engineeringStore";

const now = () => performance.now();
const btn = { padding: "4px 9px", borderRadius: 5, border: "1px solid #24405e", background: "rgba(11,18,32,0.9)", color: "#cde", fontSize: 11, cursor: "pointer" };

/** Clips of the show, in the show-frame shape: the active preview plan, else the timeline. */
function showClips(plan, timelineTracks) {
  if (plan?.visualClips?.length) return null;   // previewPlanProject handles it
  return (timelineTracks || []).flatMap((t) => (t.clips || []).map((c) => {
    const start = Number(c.startTime ?? c.start) || 0, dur = Number(c.duration) || 0;
    return { ...c, fixtureId: c.fixtureId || t.fixtureId, type: c.type || t.type, start, end: start + dur };
  }));
}

export default function StudioShowView({ cameraTrack, followCamera = true, song = null, render = {}, onClose }) {
  const hostRef = useRef(null);
  const sceneRef = useRef(null);
  const fixtures = useEngineeringStore((s) => s.fixtures);
  const geometry = useEngineeringStore((s) => s.geometry);
  const params = useEngineeringStore((s) => s.params);
  const poolType = useEngineeringStore((s) => s.poolType);
  const plan = useICANPreviewStore((s) => s.plan);
  const timelineTracks = useShowStore((s) => s.timelineTracks);
  const [job, setJob] = useState(null);
  const [msg, setMsg] = useState("");

  const center = useMemo(() => poolCenter(geometry, params, poolType), [geometry, params, poolType]);
  const pool = useMemo(() => poolShape(geometry, params, poolType, center), [geometry, params, poolType, center]);
  const history = useMemo(() => {
    const clips = showClips(plan, timelineTracks);
    const project = clips ? { fixtures, clips } : previewPlanProject(plan, fixtures);
    return createShowHistory(project);
  }, [plan, timelineTracks, fixtures]);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    // A large show (Bellagio: 1,214 jets) needs many more drops than a design view.
    const scene = new EasyScene(hostRef.current, {}, { maxParticles: 240000 });
    scene.setRealistic(true);
    sceneRef.current = scene;
    if (import.meta.env?.DEV) window.__aquaflowStudio = scene;
    return () => { scene.dispose(); sceneRef.current = null; };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setData({ items: sceneItems(fixtures, center), links: [], jets: showJets(fixtures), effects: [], pool,
      safetyBasin: basinPolygon(pool), haze: Number(render.laserHaze ?? 0.35), poolReflection: Number(render.poolReflection ?? 1),
      selectedId: null, selectedLinkId: null, showLinks: false, showLabels: false });
    scene.setShowSource(history);
  }, [fixtures, center, pool, history, render.laserHaze, render.poolReflection]);

  useEffect(() => { sceneRef.current?.setMist(render.studioMist === true); }, [render.studioMist]);

  useEffect(() => { sceneRef.current?.setCameraTrack(cameraTrack, followCamera); }, [cameraTrack, followCamera]);

  // Live playback follows the preview clock (else the timeline playhead).
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    scene.setClock(() => {
      const st = useICANPreviewStore.getState();
      if (st.active && st.plan) {
        const t = st.playback === "playing" ? Math.min(st.plan.duration, st.anchorPosition + (now() - st.anchorTime) / 1000) : st.position;
        history.prune(t);
        return t;
      }
      return Number(useShowStore.getState().playhead) || 0;
    });
    return () => scene.setClock(null);
  }, [history]);

  /** Frame-exact video through the app's encoder (video/bakedEncoder.js), with the song. */
  const renderVideo = async () => {
    const scene = sceneRef.current;
    if (!scene || job) return;
    const { planBake, frameShowTime, frameTimestamp } = await import("../../../video/bakedTimeline");
    const { openBakedEncoder } = await import("../../../video/bakedEncoder");
    const total = Number(plan?.duration) || Math.max(1, ...((timelineTracks || []).flatMap((t) => (t.clips || []).map((c) => (Number(c.startTime) || 0) + (Number(c.duration) || 0)))));
    const startS = Math.min(Math.max(0, Number(render.bakeStart) || 0), Math.max(0, total - 0.1));
    const durationS = Number(render.bakeDuration) > 0 ? Number(render.bakeDuration) : Math.max(0.1, total - startS);
    const bake = planBake({ resolution: render.exportResolution || "1080p", fps: render.exportFps || 30, startS, durationS, prerollS: 0 });
    const abort = { aborted: false };
    const started = Date.now();
    setJob({ frame: 0, frames: bake.frames, abort });
    setMsg("");
    scene.setClock(null);
    scene.baking = true;
    const canvas = scene.renderer.domElement;
    const keep = { w: hostRef.current.clientWidth, h: hostRef.current.clientHeight, pr: scene.renderer.getPixelRatio() };
    try {
      scene.renderer.setPixelRatio(1);
      scene.renderer.setSize(bake.width, bake.height, false);
      scene.composer?.setPixelRatio?.(1);
      scene.composer?.setSize(bake.width, bake.height);
      scene.camera.aspect = bake.width / bake.height;
      scene.camera.updateProjectionMatrix();
      const encoder = await openBakedEncoder(canvas, bake, { audio: song?.file ? { file: song.file, loopS: song.loopS || 0 } : null });
      for (let i = 0; i < bake.frames; i++) {
        if (abort.aborted) { encoder.cancel?.(); throw Object.assign(new Error("cancelled"), { name: "AbortError" }); }
        scene.renderAt(frameShowTime(bake, i), 1 / bake.fps);
        await encoder.addFrame(frameTimestamp(bake, i), 1 / bake.fps);
        if (i % 15 === 0) { setJob((j) => j && { ...j, frame: i }); await new Promise((r) => setTimeout(r, 0)); }
      }
      const out = await encoder.finish();
      const name = `aquaflow-studio-${bake.width}x${bake.height}-${Date.now()}.${out.ext || "mp4"}`;
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement("a"); a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      setMsg(`✓ ${bake.width}×${bake.height} · ${bake.fps} fps · ${bake.durationS.toFixed(1)} s${encoder.hasAudio ? " · with music" : ""} · ${Math.round((Date.now() - started) / 1000)} s → ${name}`);
    } catch (e) {
      setMsg(e?.name === "AbortError" ? "Render cancelled." : `Render failed: ${e?.message || e}`);
    } finally {
      scene.baking = false;
      scene.renderer.setPixelRatio(keep.pr);
      scene.resize();
      setJob(null);
      scene.setClock(() => {
        const st = useICANPreviewStore.getState();
        return st.active && st.plan ? (st.playback === "playing" ? Math.min(st.plan.duration, st.anchorPosition + (now() - st.anchorTime) / 1000) : st.position)
          : Number(useShowStore.getState().playhead) || 0;
      });
    }
  };

  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 5, background: "var(--bg-void)" }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", gap: 6, alignItems: "center", zIndex: 6 }}>
        <span style={{ fontSize: 11, color: "var(--info)", background: "rgba(11,18,32,0.85)", padding: "4px 8px", borderRadius: 5 }}>Studio look</span>
        {!job && <button style={btn} onClick={renderVideo} title="Frame-exact video of the show in the Studio look, with the song (resolution, fps and range from Video export)">Render studio video</button>}
        {job && <><span style={{ fontSize: 11, color: "var(--text-primary)" }}>Rendering {job.frame} / {job.frames}</span>
          <button style={btn} onClick={() => { job.abort.aborted = true; }}>Cancel</button></>}
        {onClose && !job && <button style={btn} onClick={onClose} title="Back to the classic renderer">Classic view</button>}
        {msg && <span data-testid="studio-msg" style={{ fontSize: 11, color: "var(--text-primary)", background: "rgba(11,18,32,0.85)", padding: "4px 8px", borderRadius: 5 }}>{msg}</span>}
      </div>
    </div>
  );
}
