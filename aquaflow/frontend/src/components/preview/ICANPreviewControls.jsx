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
  const title = preview.plan.visualClips ? "Show simulation" : preview.plan.designClips ? "Design simulation" : "I-CAN simulation";
  const stats = preview.plan.visualClips
    ? `${state.active} water outlets · ${state.lightsActive} RGB lights · ${Object.values(state.fixtureMotion || {}).filter(({ pan, tilt }) => pan || tilt).length} moving jets · virtual pump ${(state.pump * 100).toFixed(0)}%`
    : preview.plan.designClips
    ? `Running ${zoneCounts["running-fountain"]} · Foam ${zoneCounts.foam} · Peacock ${zoneCounts.peacock} · ${state.active} outlets animated`
    : `Pass ${state.passIndex}/${preview.plan.repeat} · Step ${state.stepIndex + 1}/${preview.plan.steps.length} · ${state.active} jets selected`;
  const note = preview.plan.visualClips ? "Visual design only; water, light and motion are illustrative."
    : preview.plan.designClips ? "Hardware mapping is checked separately."
    : `${state.mapped} valves mapped; ${state.unmapped} outlets uncommissioned and off.`;
  const playing = preview.playback === "playing";
  const icon = { background: "transparent", color: "#9fdcc4", border: "1px solid #1f4d40", borderRadius: 3, width: 24, height: 22,
    cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 };
  const editPattern = () => { preview.pause(); window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: preview.editPanel } })); };
  return <div style={{ padding: "6px 7px", border: "1px solid #1f5a47", borderRadius: 4, background: "#041513", fontSize: 10, color: "#bce2d9", marginBottom: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}
      title={[stats, note, "Water height is illustrative; pump separation and protected frequency commands are not modelled.",
        ...(state.protectedSelected ? ["This step includes protected commands; only mapped running valves animate."] : [])].join("\n")}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: playing ? "#3ddc84" : "#557766", flexShrink: 0 }} />
      <span style={{ fontWeight: 700, color: "#57e6a5", fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</span>
      <span style={{ marginLeft: "auto", fontSize: 8, color: "#5f8577" }}>no hardware output</span>
    </div>
    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "#8fb8aa", marginBottom: 5 }} title={preview.plan.name}>{preview.plan.name}</div>
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <button style={icon} title={playing ? "Pause" : "Play"} aria-label={playing ? "Pause simulation" : "Play simulation"}
        onClick={() => playing ? preview.pause() : preview.play()}>{playing ? "❚❚" : "▶"}</button>
      <button style={icon} title="Replay" aria-label="Replay" onClick={() => { preview.seek(0); preview.play(); }}>↺</button>
      <button style={icon} title="Stop" aria-label="Stop simulation" onClick={preview.stop}>■</button>
      <span style={{ fontFamily: "monospace", fontSize: 9, color: "#8fb8aa", marginLeft: 4 }}>
        {preview.position.toFixed(1)} / {preview.plan.duration.toFixed(1)}s
      </span>
      <button style={{ ...icon, marginLeft: "auto" }} title="Edit pattern" aria-label="Edit pattern" onClick={editPattern}>✎</button>
      <button style={icon} title="Exit simulation" aria-label="Exit simulation" onClick={preview.close}>✕</button>
    </div>
    <input aria-label="Simulation position" type="range" min="0" max={preview.plan.duration} step="0.05"
      value={preview.position} onChange={event => preview.seek(event.target.value)} style={{ width: "100%", marginTop: 5 }} />
  </div>;
}
