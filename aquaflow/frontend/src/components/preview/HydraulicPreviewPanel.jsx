/**
 * HydraulicPreviewPanel.jsx — AF-NEXT-007 / AF-NEXT-008 preview controls.
 *
 *  * "Creative (instant response)" vs "Engineering preview" toggle. In engineering mode
 *    jets follow the time-dependent hydraulic timeline at the playhead (pump curve at
 *    speed, valve state, ramp, pipe fill), so an overloaded pump or a closed upstream
 *    valve visibly lowers or removes the affected jets.
 *  * Hydraulic status: the scene's getPhysicsStatus() plus the named diagnostics active
 *    at the playhead, each with its timestamp.
 *  * Splash envelope: toggleable 3D landing regions, offending jets highlighted at the
 *    source, assumptions (gust factor, nozzle uncertainty, wind source) and the
 *    "Advisory — not field calibrated" label.
 * Simulation only — nothing here reaches a hardware driver.
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { previewPlanProject } from "../../utils/fullShowPreview";
import useEngineeringStore from "../../store/engineeringStore";
import {
  fetchShowTimeline, sampleHydraulicTimeline, samplePumps, activeHydraulicDiagnostics,
} from "../../engineering/showHydraulicsClient";
import {
  ADVISORY_LABEL, SPLASH_DEFAULTS, activeJetsAt, createWaterTest, normalizeWind, projectBasins, projectJets,
  splashAssumptions, splashAt,
} from "../../engineering/splashEnvelope";
import { applyEngineeringJets, PREVIEW_MODES } from "./engineeringJets";
import { SplashOverlay, regionsToWorld } from "./splashOverlay3D";

const EMPTY = Object.freeze([]);

/** Show input for the evaluators from the preview plan (same clips the 3D preview plays). */
export function showFromPlan(plan, fixtures = EMPTY) {
  if (!plan) return null;
  if (plan.visualClips?.length) {
    const project = previewPlanProject(plan, fixtures);
    return { clips: project.clips, duration: plan.duration, frameOpts: { loop: { startMs: 0, endMs: plan.passMs } } };
  }
  if (plan.designClips?.length) {
    return { clips: plan.designClips, duration: plan.duration, frameOpts: { loop: { startMs: 0, endMs: plan.passMs } } };
  }
  return null;
}

export function useEngineeringPreview({ sceneRef, sitePreview, wind }) {
  const [mode, setMode] = useState(PREVIEW_MODES.CREATIVE);
  const [timeline, setTimeline] = useState(null);
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [splashOn, setSplashOn] = useState(false);
  const [gustFactor, setGustFactor] = useState(SPLASH_DEFAULTS.gustFactor);
  const [uncertainty, setUncertainty] = useState(SPLASH_DEFAULTS.nozzleUncertainty);
  const [physics, setPhysics] = useState(null);
  const overlayRef = useRef(null);

  const fixtures = useEngineeringStore(s => s.fixtures);
  const basinsRaw = useEngineeringStore(s => s.basins);
  const geometry = useEngineeringStore(s => s.geometry);
  const poolType = useEngineeringStore(s => s.poolType);
  const params = useEngineeringStore(s => s.params);
  const project = useMemo(() => ({ fixtures, basins: basinsRaw, geometry, poolType, params }),
    [fixtures, basinsRaw, geometry, poolType, params]);
  const plan = sitePreview?.active ? sitePreview.plan : null;
  const show = useMemo(() => showFromPlan(plan, fixtures), [plan, fixtures]);
  const tMs = Math.max(0, Number(sitePreview?.position) || 0) * 1000;
  const engineering = mode === PREVIEW_MODES.ENGINEERING;

  // Fetch (cached per revision) whenever the engineering view needs the timeline.
  useEffect(() => {
    if (!(engineering || splashOn) || !show) { setTimeline(null); setStatus({ state: show ? "idle" : "no-show", message: "" }); return; }
    let live = true;
    setStatus({ state: "loading", message: "Solving the show hydraulics…" });
    fetchShowTimeline(project, show, { durationS: show.duration })
      .then(tl => { if (live) { setTimeline(tl); setStatus({ state: "ready", message: "" }); } })
      .catch(err => { if (live) { setTimeline(null); setStatus({ state: "error", message: String(err?.message || err) }); } });
    return () => { live = false; };
  }, [engineering, splashOn, show, project]);

  const samples = useMemo(() => (timeline ? sampleHydraulicTimeline(timeline, tMs) : null), [timeline, tMs]);

  // Drive the jets. Re-applied on a short interval too, so a re-layout (which restores the
  // design-time solve) cannot leave a paused engineering preview on stale records.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;
    const apply = () => applyEngineeringJets(sceneRef.current, engineering ? samples : null);
    apply();
    if (!engineering) return undefined;
    const id = setInterval(apply, 400);
    return () => clearInterval(id);
  }, [sceneRef, engineering, samples]);

  // getPhysicsStatus consumer (2 Hz).
  useEffect(() => {
    const read = () => setPhysics(sceneRef.current?.getPhysicsStatus?.() || null);
    read();
    const id = setInterval(read, 500);
    return () => clearInterval(id);
  }, [sceneRef]);

  // Splash envelope at the playhead.
  const water = useMemo(() => createWaterTest(projectBasins(project)), [project]);
  const jets = useMemo(() => projectJets(project), [project]);
  const windPlan = useMemo(() => normalizeWind({ windX: wind?.x, windZ: wind?.z, source: "3D preview wind setting" }), [wind?.x, wind?.z]);
  const splashOpts = useMemo(() => ({ ...SPLASH_DEFAULTS, gustFactor, nozzleUncertainty: uncertainty }), [gustFactor, uncertainty]);
  const regions = useMemo(() => {
    if (!splashOn || !show) return EMPTY;
    const sampler = engineering && timeline ? () => samples : null;
    const active = activeJetsAt(jets, project, show, tMs, { sampleTimeline: sampler });
    return splashAt(active, water, windPlan, splashOpts);
  }, [splashOn, show, engineering, timeline, samples, jets, project, tMs, water, windPlan, splashOpts]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene?.scene) return undefined;
    if (!overlayRef.current || overlayRef.current.threeScene !== scene.scene) {
      overlayRef.current?.dispose();
      overlayRef.current = new SplashOverlay(scene.scene);
    }
    const center = useEngineeringStore.getState().getPoolBounds?.();
    overlayRef.current.update(regionsToWorld(regions, center ? { cx: center.cx, cy: center.cy } : undefined), splashOn);
    return undefined;
  }, [sceneRef, regions, splashOn]);
  useEffect(() => () => { overlayRef.current?.dispose(); overlayRef.current = null; }, []);

  return {
    mode, setMode, engineering, timeline, status, samples, tMs, show,
    diagnostics: timeline ? activeHydraulicDiagnostics(timeline, tMs) : EMPTY,
    pumps: timeline ? samplePumps(timeline, tMs) : null,
    physics, splashOn, setSplashOn, gustFactor, setGustFactor, uncertainty, setUncertainty, regions,
    assumptions: splashAssumptions(splashOpts, windPlan, engineering && !!timeline),
  };
}

const box = { border: "1px solid #12303a", borderRadius: 4, padding: "6px 7px", margin: "0 0 8px", background: "rgba(4,14,20,0.6)" };
const small = { fontSize: 9, color: "#7f97a6", fontFamily: "monospace" };
const head = { ...small, color: "#b7c9d3", letterSpacing: "0.06em" };
const sevColor = { error: "#ff6b6b", warning: "#ffcc55", info: "#7fb8d8" };
const btn = (on) => ({ flex: 1, padding: "4px 6px", fontSize: 9, cursor: "pointer", fontFamily: "monospace", borderRadius: 3,
  border: `1px solid ${on ? "#3ddc84" : "#1f3a46"}`, background: on ? "rgba(61,220,132,0.14)" : "transparent", color: on ? "#9fffc1" : "#8aa0ad" });

export function fmtTime(ms) {
  if (ms == null) return "static";
  const s = Number(ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
}

/** Compact water-response controls. Detail lives in tooltips and only shows when it matters:
 *  status/diagnostics only in Engineering mode, splash detail only when the envelope is on. */
export default function HydraulicPreviewPanel(props) {
  const { engineering, setMode, status, diagnostics, pumps, physics, splashOn, setSplashOn, gustFactor,
    setGustFactor, uncertainty, setUncertainty, regions, assumptions, show, timeline } = props;
  const offending = regions.filter(r => r.outside);
  const basis = `${engineering && timeline ? "ENGINEERING TIMELINE" : physics?.basis || "ESTIMATED"}`
    + `${physics ? ` · solved nozzles ${physics.solvedNozzles}` : ""}`
    + `${timeline ? ` · solver ${timeline.converged ? "converged" : "NOT converged"}` : ""}`;
  return (
    <section aria-label="Engineering preview" style={box} data-testid="hydraulic-preview-panel">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={head}>WATER RESPONSE</span>
        <span style={{ ...small, fontSize: 8, color: "#55707e" }} title="Simulated — not field calibrated">SIM</span>
      </div>
      <div role="radiogroup" aria-label="Preview response mode" style={{ display: "flex", gap: 4 }}>
        <button role="radio" aria-checked={!engineering} style={btn(!engineering)} onClick={() => setMode(PREVIEW_MODES.CREATIVE)}
          title="Jets respond instantly to the show; hydraulic limits are not applied.">
          Creative
        </button>
        <button role="radio" aria-checked={engineering} style={btn(engineering)} onClick={() => setMode(PREVIEW_MODES.ENGINEERING)}
          title="Jets follow pump curves, valve states, ramps and pipe fill at the playhead (simulated).">
          Engineering
        </button>
      </div>

      {engineering && (
        <div style={{ marginTop: 6 }}>
          {!show && <div style={{ ...small, color: "#ffcc55" }}>Play a show to evaluate hydraulics.</div>}
          {status?.state === "loading" && <div style={small}>Solving…</div>}
          {status?.state === "error" && <div style={{ ...small, color: "#ff6b6b" }} title={status.message}>Hydraulics unavailable</div>}
          {timeline && (
            <div style={{ ...small, color: timeline.converged ? "#3ddc84" : "#ff6b6b" }} title={basis} data-testid="physics-basis">
              {timeline.converged ? "● Solved" : "● Not converged"}
              {pumps ? ` · ${Object.keys(pumps).length} pump${Object.keys(pumps).length === 1 ? "" : "s"}` : ""}
            </div>
          )}
          {pumps && Object.entries(pumps).map(([id, p]) => (
            <div key={id} style={small} title={`Drive: ${p.drive}`}>
              {id} {Math.round((p.speedEff || 0) * 100)}% · {p.flowLpm ?? 0} L/min @ {p.headM ?? 0} m
            </div>
          ))}
          <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }} data-testid="hydraulic-diagnostics">
            {diagnostics.slice(0, 3).map((d, i) => (
              <li key={`${d.code}-${d.fixtureId}-${i}`} title={d.message}
                style={{ ...small, color: sevColor[d.severity] || "#ccc", margin: "2px 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                ▲ {d.code} · {fmtTime(d.timeMs)}{d.endMs != null ? `–${fmtTime(d.endMs)}` : ""}
              </li>
            ))}
            {diagnostics.length > 3 && <li style={small}>+{diagnostics.length - 3} more in Preflight</li>}
          </ul>
        </div>
      )}

      <label style={{ ...head, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", marginTop: 7 }}
        title="Show where active jets land (advisory — not field calibrated)">
        <input type="checkbox" checked={splashOn} onChange={e => setSplashOn(e.target.checked)} aria-label="Show splash envelope" />
        Splash envelope
      </label>
      {splashOn && (
        <div style={{ marginTop: 3 }}>
          <div style={{ ...small, color: offending.length ? "#ff6b6b" : "#3ddc84" }}>
            {offending.length ? `${offending.length} jet(s) land outside the basin` : "All jets land in the water"}
          </div>
          {offending.slice(0, 3).map(r => (
            <div key={r.id} style={{ ...small, color: "#ff9b9b" }} title={`${r.clipId ? `Clip ${r.clipId} · ` : ""}${r.heightM.toFixed(2)} m ${r.basis}`}>
              {r.id}: {r.distanceOutsideM.toFixed(2)} m out
            </div>
          ))}
          <details style={{ marginTop: 4 }}>
            <summary style={{ ...small, cursor: "pointer" }}>Assumptions</summary>
            <div style={{ ...small, color: "#ffcc55", margin: "3px 0" }} data-testid="splash-advisory">{ADVISORY_LABEL}</div>
            <div style={{ display: "flex", gap: 6, ...small }}>
              <label>Gust ×<input type="number" min="1" max="3" step="0.1" value={gustFactor} aria-label="Gust factor"
                onChange={e => setGustFactor(Math.max(1, Number(e.target.value) || 1))} style={{ width: 42, marginLeft: 3 }} /></label>
              <label>Nozzle ±%<input type="number" min="0" max="50" step="1" value={Math.round(uncertainty * 100)} aria-label="Nozzle uncertainty"
                onChange={e => setUncertainty(Math.max(0, Number(e.target.value) || 0) / 100)} style={{ width: 38, marginLeft: 3 }} /></label>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: "4px 0 0" }} data-testid="splash-assumptions">
              {assumptions.map(a => <li key={a.key} style={small}>{a.label}: {String(a.value)}</li>)}
            </ul>
          </details>
        </div>
      )}
    </section>
  );
}
