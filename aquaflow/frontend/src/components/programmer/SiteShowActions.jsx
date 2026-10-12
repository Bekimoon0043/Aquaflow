import { useEffect, useMemo, useState } from "react";
import { compileSiteWaterShow, createDesignShowPreview } from "../../utils/siteShowCompiler";
import { useICANPreviewStore } from "../../store/icanPreviewStore";

export default function SiteShowActions({ clips, fixtures, audioFile }) {
  const previous = useICANPreviewStore.getState().siteShowSettings || {};
  const [name, setName] = useState(previous.name ?? "4KILO Custom Water Dance");
  const [includeCapturedSupport, setIncludeCapturedSupport] = useState(previous.includeCapturedSupport ?? false);
  useEffect(() => { useICANPreviewStore.setState({ siteShowSettings: { name, includeCapturedSupport } }); }, [name, includeCapturedSupport]);
  const [message, setMessage] = useState("");
  const result = useMemo(() => {
    try { return { pattern: compileSiteWaterShow(clips, fixtures, { name, includeCapturedSupport }) }; }
    catch (error) { return { error: error.message }; }
  }, [clips, fixtures, name, includeCapturedSupport]);
  const navigate = panel => window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel } }));
  const preview = exact => {
    try {
      const pattern = exact ? result.pattern : createDesignShowPreview(clips, fixtures, name);
      useICANPreviewStore.getState().load(pattern, 1, audioFile, "show_programmer");
      navigate("preview");
    } catch (error) { setMessage(error.message); }
  };
  const handoff = () => {
    const store = useICANPreviewStore.getState();
    // Replace any previous design preview with this exact runnable valve pattern.
    store.load(result.pattern, 1, audioFile, "patterns");
    store.openSiteEditor(result.pattern);
    navigate("patterns");
  };
  const btn = { width: "100%", padding: "8px 6px", marginTop: 5, borderRadius: 5, border: "1px solid #2c5870", background: "#102b3b", color: "#b7e6ff", cursor: "pointer", fontSize: 11 };
  return <div style={{ padding: 12, background: "#061824", borderBottom: "1px solid #284557", fontSize: 10, color: "#b8d7e8" }}>
    <b style={{ fontSize: 12 }}>Timeline → 3D → Site pattern</b>
    <input aria-label="Site show name" value={name} onChange={e => setName(e.target.value)} style={{ ...btn, textAlign: "left", boxSizing: "border-box" }} />
    <button style={btn} disabled={!clips.length} onClick={() => preview(false)}>Preview water design in 3D</button>
    <div style={{ color: "#7898af", marginTop: 5 }}>Design preview animates selected water outlets, including those awaiting hardware commissioning. Heights are illustrative.</div>
    <label style={{ display: "flex", gap: 6, marginTop: 9, lineHeight: 1.4 }}>
      <input type="checkbox" checked={includeCapturedSupport} onChange={e => setIncludeCapturedSupport(e.target.checked)} />
      Hold the proven captured G17 support state through the valve sequence
    </label>
    <div style={{ color: "#f5c982", marginTop: 3 }}>Support starts OFF by default. When selected, the full captured state stays steady between the first and last ON clips, including gaps. Individual pumps and frequency commands remain protected.</div>
    {result.pattern ? <div style={{ color: "#7ce5b5", marginTop: 6 }}>{result.pattern.steps.length} exact valve states · {(result.pattern.steps.reduce((n, s) => n + s.duration_ms, 0) / 1000).toFixed(2)}s including final OFF.</div>
      : clips.length > 0 && <div role="status" style={{ color: "#f5c982", marginTop: 6 }}>{result.error}</div>}
    <button style={btn} disabled={!result.pattern} onClick={() => preview(true)}>Preview exact site valve pattern in 3D</button>
    <button style={{ ...btn, borderColor: "#278957", color: "#aff4ce" }} disabled={!result.pattern || !name.trim()} onClick={handoff}>Open site pattern controls (review / save / run)</button>
    <div style={{ color: "#7898af", marginTop: 5 }}>Opening controls sends no commands. Real Start and Stop remain in the existing gated Site I-CAN editor.</div>
    {message && <div role="alert" style={{ color: "#fda4af", marginTop: 6 }}>{message}</div>}
  </div>;
}
