import { useEffect, useRef, useState } from "react";
import { apiUrl } from "../../utils/apiClient";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import { createDesignShowPreview } from "../../utils/siteShowCompiler";
import { CHOREOGRAPHY_STYLES, choreographyToBlocks, choreographyProjectSignature, validateMusicAnalysis } from "../../utils/showChoreography";

const inputStyle = { width: "100%", boxSizing: "border-box", background: "#0f172a", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: 8 };
const buttonStyle = { ...inputStyle, cursor: "pointer", marginTop: 7 };
async function request(path, signal, body) {
  const response = await fetch(apiUrl(path), { signal, ...(body === undefined ? {} : body instanceof FormData
    ? { method: "POST", body } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json();
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`);
  return data;
}
const wait = signal => new Promise((resolve, reject) => {
  const abort = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
  const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 750);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
});

export default function ShowChoreographyAssistant({ fixtures, tracks, audioFile, onMusicFile, onApply, timelineEnd = 0 }) {
  const saved = useICANPreviewStore.getState().choreographyDraft;
  const [settings, setSettings] = useState(saved?.settings || { name: "4KILO AI Dance", prompt: "Create a flowing wave with alternating sections and a strong finale", style: "auto", duration: 60, bpm: 120 });
  const [analysis, setAnalysis] = useState(saved?.file === audioFile ? saved.analysis : null);
  const [proposal, setProposal] = useState(saved?.file === audioFile ? saved.proposal : null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const controller = useRef(null), previousFile = useRef(audioFile);
  const projectSignature = choreographyProjectSignature(fixtures, tracks);
  const checkProject = () => { if (proposal.projectSignature !== projectSignature) throw new Error("The engineering outlets or tracks changed. Regenerate the proposal for this project before previewing or applying it."); };
  const patch = change => { setSettings(previous => ({ ...previous, ...change })); setProposal(null); };
  useEffect(() => {
    useICANPreviewStore.setState({ choreographyDraft: { settings, analysis, proposal, file: audioFile } });
  }, [settings, analysis, proposal, audioFile]);
  useEffect(() => {
    if (previousFile.current !== audioFile) {
      controller.current?.abort(); setBusy(""); setAnalysis(null); setProposal(null); setMessage(""); previousFile.current = audioFile;
    }
  }, [audioFile]);
  useEffect(() => () => controller.current?.abort(), []);
  const execute = async (label, action) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setBusy(label); setMessage("");
    const timeout = setTimeout(() => current.abort("timeout"), 300000);
    try { await action(current.signal); }
    catch (error) {
      if (controller.current === current) setMessage(current.signal.aborted ? (current.signal.reason === "timeout" ? "Analysis timed out. Try a shorter PCM WAV." : "Cancelled. The timeline was preserved.") : error.message);
    } finally {
      clearTimeout(timeout);
      if (controller.current === current) setBusy("");
    }
  };
  const analyze = () => execute("Analyzing selected music…", async signal => {
    setAnalysis(null); setProposal(null);
    const form = new FormData(); form.append("file", audioFile);
    const uploaded = await request("/audio/upload", signal, form);
    if (!uploaded.job_id) throw new Error("Audio upload did not return an analysis job.");
    for (;;) {
      const job = await request(`/audio/status/${encodeURIComponent(uploaded.job_id)}`, signal);
      if (["failed", "error"].includes(job.status)) throw new Error(job.error || "Music analysis failed.");
      if (job.status === "complete") {
        validateMusicAnalysis(job.result);
        setAnalysis({ jobId: uploaded.job_id, result: job.result });
        setMessage(`Measured music: ${job.result.bpm.toFixed(1)} BPM, ${job.result.duration.toFixed(1)} seconds. Beat locations and energy are available; phrase grouping is automatic.`);
        return;
      }
      await wait(signal);
    }
  });
  const generate = music => execute("Creating editable choreography…", async signal => {
    const seconds = Number(settings.duration), bpm = Number(settings.bpm);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600 || !settings.prompt.trim()) throw new Error("Enter a prompt and a duration from 1 to 600 seconds.");
    if (!music && (!Number.isFinite(bpm) || bpm < 40 || bpm > 240)) throw new Error("Manual tempo must be 40–240 BPM.");
    const common = { prompt: settings.prompt, style: settings.style === "auto" ? null : settings.style, include_proven_support: false, save: false };
    const response = await request(music ? "/ican/choreography/from-audio" : "/ican/choreography/generate", signal,
      music ? { ...common, job_id: analysis.jobId } : { ...common, duration_s: seconds, bpm });
    if (signal.aborted) return;
    const result = choreographyToBlocks(response.pattern, fixtures, tracks, { duration: seconds, name: settings.name, analysis: music ? analysis.result : null });
    setProposal({ pattern: response.pattern, result, analysis: music ? analysis.result : null, projectSignature });
    setMessage(`${result.blockCount} editable blocks, ${result.duration.toFixed(1)} seconds, final OFF included. Review the proposal before applying.`);
  });
  const preview = () => {
    try {
      checkProject();
      // Validate against the current project again; a saved proposal must never silently remap.
      const result = choreographyToBlocks(proposal.pattern, fixtures, tracks, { duration: Number(settings.duration), name: settings.name, analysis: proposal.analysis });
      useICANPreviewStore.getState().load(createDesignShowPreview(result.clips, fixtures, result.name), 1, result.music ? audioFile : null, "show_programmer");
      window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "preview" } }));
    } catch (error) { setMessage(error.message); }
  };
  const apply = () => {
    try {
      checkProject();
      const result = choreographyToBlocks(proposal.pattern, fixtures, tracks, { duration: Number(settings.duration), name: settings.name,
        startTime: proposal.analysis ? 0 : Math.round(timelineEnd * 1000) / 1000, analysis: proposal.analysis });
      if (onApply(result, { replace: result.music }) !== false) setMessage("Applied as editable blocks. Undo restores the previous timeline; Save keeps this show.");
    } catch (error) { setMessage(error.message); }
  };
  return <div style={{ padding: 12, overflowY: "auto", color: "#cbd5e1", fontSize: 12, display: "grid", gap: 9 }}>
    <strong style={{ color: "#67e8f9", fontSize: 15 }}>AI / Music Show Builder</strong>
    <p style={{ margin: 0, lineHeight: 1.5 }}>Describe a movement or analyze music, review in 3D, then apply editable blocks. The offline assistant uses supported styles, measured beats and energy.</p>
    <label>Dance name<input aria-label="AI dance name" maxLength={60} style={inputStyle} value={settings.name} disabled={!!busy} onChange={e => patch({ name: e.target.value })} /></label>
    <label>Describe the dance<textarea aria-label="Describe fountain dance" rows={3} style={inputStyle} value={settings.prompt} disabled={!!busy} onChange={e => patch({ prompt: e.target.value })} /></label>
    <label>Movement<select aria-label="AI movement style" style={inputStyle} value={settings.style} disabled={!!busy} onChange={e => patch({ style: e.target.value })}>{CHOREOGRAPHY_STYLES.map(style => <option key={style} value={style}>{style === "auto" ? "Choose from prompt" : style.replaceAll("-", " ")}</option>)}</select></label>
    <label>Duration (seconds)<input aria-label="AI dance duration" type="number" min={1} max={600} style={inputStyle} value={settings.duration} disabled={!!busy} onChange={e => patch({ duration: e.target.value })} /></label>
    <label>Manual tempo (prompt mode)<input aria-label="AI manual BPM" type="number" min={40} max={240} style={inputStyle} value={settings.bpm} disabled={!!busy} onChange={e => patch({ bpm: e.target.value })} /></label>
    <button style={buttonStyle} disabled={!!busy} onClick={() => generate(false)}>Generate prompt blocks</button>
    <strong>Music choreography</strong>
    <label>Choose WAV<input aria-label="Music for AI choreography" type="file" accept="audio/*" disabled={!!busy} onChange={onMusicFile} style={{ width: "100%", marginTop: 5 }} /></label>
    <span>{audioFile?.name || "Select the show’s music file."}</span>
    <span style={{ color: "#94a3b8", lineHeight: 1.5 }}>Music uses the beginning of the selected track at timeline 0. Duration limits the excerpt. Grouped valve patterns follow beat positions; heights are illustrative. Save/export includes blocks and beats; reselect the WAV after reopening.</span>
    <button style={buttonStyle} disabled={!!busy || !audioFile} onClick={analyze}>Analyze selected music</button>
    <button style={buttonStyle} disabled={!!busy || !analysis} onClick={() => generate(true)}>Generate music blocks</button>
    {analysis && <span>Tempo {analysis.result.bpm.toFixed(1)} BPM · {analysis.result.beats.length} beats · {analysis.result.analysis_method}{(analysis.result.bpm_confidence ?? 1) < 0.5 ? " · Low tempo confidence: check beat alignment in preview." : ""}</span>}
    {busy && <><span role="status">{busy}</span><button style={buttonStyle} onClick={() => { controller.current?.abort(); }}>Cancel generation / analysis</button></>}
    {message && <div role="status" style={{ padding: 9, background: "#172033", borderRadius: 6, lineHeight: 1.5 }}>{message}</div>}
    {proposal && <>
      <button style={buttonStyle} disabled={!!busy} onClick={preview}>Preview proposal in 3D</button>
      <button style={{ ...buttonStyle, borderColor: "#22d3ee" }} disabled={!!busy} onClick={apply}>{proposal.analysis ? "Replace timeline with music blocks" : "Append prompt blocks to timeline"}</button>
    </>}
    <span style={{ color: "#94a3b8", lineHeight: 1.5 }}>Mapped running valves only. Pump support, frequency and rear outputs stay OFF during generation. Use the existing site review controls for a commissioned real-water run.</span>
  </div>;
}
