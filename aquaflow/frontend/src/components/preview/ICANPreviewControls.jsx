import { useEffect, useMemo, useRef } from "react";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import useEngineeringStore from "../../store/engineeringStore";
import { evaluateICANPreview } from "../../utils/icanPatternPreview";

export default function ICANPreviewControls() {
  const preview = useICANPreviewStore();
  const fixtures = useEngineeringStore(state => state.fixtures);
  const audioRef = useRef(null);
  useEffect(() => {
    if (!preview.audioFile) return;
    const url = URL.createObjectURL(preview.audioFile);
    const audio = new Audio(url);
    audioRef.current = audio;
    return () => { audio.pause(); audioRef.current = null; URL.revokeObjectURL(url); };
  }, [preview.audioFile]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const passSeconds = preview.plan.passMs / 1000;
    const audioPosition = preview.position >= preview.plan.duration ? 0 : preview.position % passSeconds;
    if (Math.abs(audio.currentTime - audioPosition) > 0.2) audio.currentTime = audioPosition;
    if (preview.playback === "playing" && audio.paused) audio.play().catch(() => {});
    else if (preview.playback === "playing") return;
    else audio.pause();
  }, [preview.position, preview.playback, preview.plan]);
  const state = useMemo(() => preview.plan
    ? evaluateICANPreview(preview.plan, preview.position, fixtures, preview.playback === "stopped")
    : null, [preview.plan, preview.position, fixtures, preview.playback]);
  if (!preview.active || !state) return null;
  const zoneCounts = { "running-fountain": 0, foam: 0, peacock: 0 };
  if (preview.plan.designClips) fixtures.forEach(fixture => {
    const zone = fixture.engineering?.siteFunction;
    if (zone in zoneCounts && state.fixtureIntensities[fixture.id] > 0) zoneCounts[zone] += 1;
  });
  const btn = { background: "#081b2a", color: "#78dcff", border: "1px solid #24516b", padding: "5px 7px", cursor: "pointer", fontSize: 10, fontFamily: "monospace" };
  return <div style={{ padding: 8, border: "1px solid #278b65", background: "#041513", fontSize: 10, color: "#bce2d9", marginBottom: 8 }}>
    <div style={{ fontWeight: "bold", color: "#57e6a5", marginBottom: 5 }}>{preview.plan.visualClips ? "FULL SHOW DESIGN SIMULATION" : preview.plan.designClips ? "DESIGN SIMULATION" : "I-CAN SIMULATION"} — NO HARDWARE OUTPUT</div>
    <div>{preview.plan.name}</div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0" }}>
      <button style={btn} onClick={() => preview.playback === "playing" ? preview.pause() : preview.play()}>
        {preview.playback === "playing" ? "Pause simulation" : "Play simulation"}
      </button>
      <button style={btn} onClick={() => { preview.seek(0); preview.play(); }}>Replay</button>
      <button style={btn} onClick={preview.stop}>Stop simulation</button>
      <button style={btn} onClick={() => { preview.pause(); window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: preview.editPanel } })); }}>Edit pattern</button>
      <button style={btn} onClick={preview.close}>Exit simulation</button>
    </div>
    <input aria-label="Simulation position" type="range" min="0" max={preview.plan.duration} step="0.05"
      value={preview.position} onChange={event => preview.seek(event.target.value)} style={{ width: "100%" }} />
    <div>{preview.position.toFixed(1)} / {preview.plan.duration.toFixed(1)}s · {preview.playback}</div>
    {preview.plan.visualClips
      ? <div>{state.active} water outlets · {state.lightsActive} RGB lights · {Object.values(state.fixtureMotion || {}).filter(({ pan, tilt }) => pan || tilt).length} moving jets · virtual pump {(state.pump * 100).toFixed(0)}%</div>
      : preview.plan.designClips
      ? <div>Running {zoneCounts["running-fountain"]} · Foam {zoneCounts.foam} · Peacock {zoneCounts.peacock} · {state.active} outlets animated</div>
      : <div>Pass {state.passIndex}/{preview.plan.repeat} · Step {state.stepIndex + 1}/{preview.plan.steps.length} · {state.active} jets selected</div>}
    <details style={{ color: "#ffc66b", marginTop: 5, lineHeight: 1.4 }}>
      <summary style={{ cursor: "pointer" }}>{preview.plan.visualClips ? "This example is visual design only; water, light, and motion outputs are illustrative." : preview.plan.designClips ? "All selected design outlets can animate; hardware mapping is checked separately." : `${state.mapped} valves mapped; ${state.unmapped} outlets uncommissioned and off.`}</summary>
      Water height is illustrative. Pump separation and protected frequency commands are not modeled as calibrated water output.
      {state.protectedSelected && <div>This step includes support/protected commands; only mapped running valves are animated.</div>}
    </details>
  </div>;
}
