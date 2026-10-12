/** Site-specific design, AI/music generation and legacy import for the real fountain. */
import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, apiUrl } from "../../utils/apiClient";
import ICANManualPatternEditor from "./ICANManualPatternEditor";
import useEngineeringStore from "../../store/engineeringStore";
import { useICANPreviewStore } from "../../store/icanPreviewStore";
import {
  createICANSiteEngineeringProject,
  ICAN_SITE_LAYOUT_SUMMARY,
} from "../../data/icanSiteEngineeringProject";

const C = { line:"#173044", text:"#9bb0c3", bright:"#d8e7f4", accent:"#00aaff", ok:"#37d67a", warn:"#ffb020", danger:"#ff5c6c", bg:"#010409" };
const input = { background:C.bg, border:`1px solid ${C.line}`, borderRadius:3, color:C.bright, padding:"6px 8px", fontSize:10, fontFamily:"monospace" };
const button = (color=C.accent) => ({ ...input, cursor:"pointer", color, background:`${color}12` });

async function multipart(path, file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(apiUrl(path), { method:"POST", body, headers:{ Accept:"application/json" } });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try { message = (await response.json()).detail || message; } catch { /* response has no JSON */ }
    throw new Error(message);
  }
  return response.json();
}

export default function ICANSiteDesignStudio() {
  const [gateway, setGateway] = useState(null);
  const [safety, setSafety] = useState(null);
  const [runner, setRunner] = useState(null);
  const [demo, setDemo] = useState(null);
  const [draft, setDraft] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [prompt, setPrompt] = useState("Create a flowing left-to-right wave with a strong finale");
  const [style, setStyle] = useState("");
  const [duration, setDuration] = useState(60);
  const [bpm, setBpm] = useState(120);
  const [audioFile, setAudioFile] = useState(() => useICANPreviewStore.getState().audioFile);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState("");
  const [messages, setMessages] = useState([]);

  const say = useCallback((message, kind="info") => {
    setMessages(items => [{ message, kind, time:new Date().toLocaleTimeString() }, ...items].slice(0, 8));
  }, []);

  const refresh = useCallback(async () => {
    const [g, s, r, d] = await Promise.all([
      apiGet("/ican/status").catch(() => null),
      apiGet("/safety/status").catch(() => null),
      apiGet("/ican/manual-pattern/status").catch(() => null),
      apiGet("/ican/demo/status").catch(() => null),
    ]);
    setGateway(g); setSafety(s); setRunner(r); setDemo(d);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const timer = setInterval(refresh, runner?.running ? 750 : 4000);
    return () => clearInterval(timer);
  }, [refresh, runner?.running]);

  useEffect(() => {
    if (!job?.job_id || ["complete", "error"].includes(job.status)) return;
    const timer = setInterval(async () => {
      try {
        const next = await apiGet(`/audio/status/${job.job_id}`);
        setJob(next);
        if (next.status === "complete") {
          setBpm(next.result.bpm);
          say(`Music analyzed: ${next.result.bpm} BPM, ${next.result.duration}s`, "ok");
        }
        if (next.status === "error") say(`Music analysis failed: ${next.error}`, "err");
      } catch (error) { say(`Analysis status failed: ${error.message}`, "err"); clearInterval(timer); }
    }, 800);
    return () => clearInterval(timer);
  }, [job?.job_id, job?.status, say]);

  const generate = async () => {
    setBusy("generate");
    try {
      const result = await apiPost("/ican/choreography/generate", {
        prompt, duration_s:Number(duration), bpm:Number(bpm), style:style || null,
        include_proven_support:true, save:false,
      });
      setDraft(result.pattern);
      say(`Draft created: ${result.pattern.steps.length} steps`, "ok");
    } catch (error) { say(`AI pattern failed: ${error.message}`, "err"); }
    finally { setBusy(""); }
  };

  const uploadAudio = async file => {
    if (!file) return;
    setAudioFile(file); setBusy("audio"); setJob(null);
    try {
      const next = await multipart("/audio/upload", file);
      setJob(next); say(`Analyzing ${file.name} locally…`);
    } catch (error) { say(`Music upload failed: ${error.message}`, "err"); }
    finally { setBusy(""); }
  };

  const generateFromAudio = async () => {
    setBusy("music");
    try {
      const result = await apiPost("/ican/choreography/from-audio", {
        job_id:job.job_id, prompt, style:style || null, bpm_override:Number(bpm) || null,
        include_proven_support:true, save:false,
      });
      setDraft(result.pattern);
      say(`Music choreography created: ${result.pattern.steps.length} synchronized steps`, "ok");
    } catch (error) { say(`Music choreography failed: ${error.message}`, "err"); }
    finally { setBusy(""); }
  };

  const importBundled = async () => {
    setBusy("legacy");
    try {
      const result = await apiPost("/ican/legacy/import-bundled?include_proven_support=true", {});
      setDraft(result.patterns[0]); setReloadKey(value => value + 1);
      say(`Imported and saved all ${result.count} old music programs`, "ok");
    } catch (error) { say(`Old-program import failed: ${error.message}`, "err"); }
    finally { setBusy(""); }
  };

  const importZip = async file => {
    if (!file) return;
    setBusy("legacy");
    try {
      const result = await multipart("/ican/legacy/import?include_proven_support=true", file);
      setDraft(result.patterns[0]); setReloadKey(value => value + 1);
      say(`Imported and saved ${result.count} program(s) from ${file.name}`, "ok");
    } catch (error) { say(`Import failed: ${error.message}`, "err"); }
    finally { setBusy(""); }
  };

  const connected = gateway?.state === "connected";
  const armed = !!gateway?.output_enabled;
  const permit = !!safety?.permit;
  const result = job?.result;

  const openSiteDesign = panel => {
    const engineering = useEngineeringStore.getState();
    if (!engineering.fixtures.some(fixture => fixture.engineering?.siteFunction === "running-fountain")) {
      engineering.loadProject(createICANSiteEngineeringProject());
      say(`Loaded the ${ICAN_SITE_LAYOUT_SUMMARY.totalWaterNozzles}-outlet site model`, "ok");
    }
    window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail:{ panel } }));
  };

  return <div style={{ padding:10, overflowY:"auto", height:"100%", color:C.text, fontFamily:"monospace" }}>
    <div style={{ padding:9, border:`1px solid ${C.line}`, background:"rgba(0,170,255,.035)", marginBottom:9 }}>
      <div style={{ color:C.bright, fontSize:12, marginBottom:5 }}>Real Fountain Design Studio</div>
      <div style={{ fontSize:9, lineHeight:1.55 }}>
        The engineering model contains 76 running jets, 16 foam outlets and 8 peacock outlets. Hardware pattern output remains limited to the first 64 capture-mapped running valves;
        running valves 65-76 and peacock frequency setpoints remain commissioning-locked. Hardware Run still requires the three Fountain Control safety gates.
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:7 }}>
        <button onClick={()=>openSiteDesign("geometry")} style={button(C.accent)}>OPEN SITE ENGINEERING DESIGN</button>
        <button onClick={()=>openSiteDesign("preview")} style={button(C.ok)}>OPEN SITE 3D SIMULATION</button>
      </div>
      <div style={{ color:C.warn, fontSize:9, marginTop:5 }}>
        Layout and quantities are confirmed. Dimensions, hydraulic values, pipe sizes and exact coordinates are provisional until the site survey.
      </div>
      <div style={{ display:"flex", gap:10, marginTop:6, fontSize:9 }}>
        <span style={{ color:connected?C.ok:C.warn }}>Gateway {connected?"connected":"not connected"}</span>
        <span style={{ color:permit?C.ok:C.warn }}>Safety {permit?"armed":"withheld"}</span>
        <span style={{ color:armed?C.ok:C.warn }}>Output {armed?"armed":"disarmed"}</span>
      </div>
    </div>

    <div style={{ display:"grid", gridTemplateColumns:"minmax(250px,1fr) minmax(250px,1fr)", gap:9, marginBottom:10 }}>
      <div style={{ padding:9, border:`1px solid ${C.line}` }}>
        <div style={{ color:C.accent, fontSize:10, marginBottom:6 }}>AI prompt pattern</div>
        <textarea value={prompt} onChange={event=>setPrompt(event.target.value)} style={{...input,width:"100%",height:55,resize:"vertical",boxSizing:"border-box"}} />
        <div style={{ display:"flex", gap:5, marginTop:6, flexWrap:"wrap" }}>
          <select value={style} onChange={event=>setStyle(event.target.value)} style={input}>
            <option value="">Auto style</option><option>wave</option><option>reverse-wave</option><option>center-out</option>
            <option>edges-in</option><option>alternate</option><option>pulse</option><option>cascade</option><option>calm</option><option>dramatic</option>
          </select>
          <label style={{fontSize:9}}>Seconds <input type="number" min="1" max="600" value={duration} onChange={e=>setDuration(e.target.value)} style={{...input,width:55}} /></label>
          <label style={{fontSize:9}}>BPM <input type="number" min="40" max="240" value={bpm} onChange={e=>setBpm(e.target.value)} style={{...input,width:55}} /></label>
          <button onClick={generate} disabled={!!busy} style={button(C.ok)}>{busy==="generate"?"Creating…":"Create editable draft"}</button>
        </div>
      </div>

      <div style={{ padding:9, border:`1px solid ${C.line}` }}>
        <div style={{ color:C.accent, fontSize:10, marginBottom:6 }}>Automatic music choreography</div>
        <input type="file" accept="audio/wav,audio/*" disabled={!!busy} onChange={event=>uploadAudio(event.target.files?.[0])} style={{...input,width:"100%",boxSizing:"border-box"}} />
        <div style={{ fontSize:9, minHeight:28, marginTop:5, color:result?C.ok:C.text }}>
          {result ? `${result.filename} · ${result.duration}s · ${result.bpm} BPM · ${result.analysis_method}`
            : job ? `Analysis: ${job.status}` : "Choose a WAV. Analysis runs offline on this PC."}
        </div>
        <button onClick={generateFromAudio} disabled={!!busy || job?.status!=="complete"} style={button(C.ok)}>
          {busy==="music"?"Creating…":"Create dance from music"}
        </button>
      </div>
    </div>

    <div style={{ padding:9, border:`1px solid ${C.line}`, marginBottom:10 }}>
      <div style={{ color:C.accent, fontSize:10 }}>Recovered 4KILO programs</div>
      <div style={{ fontSize:9, margin:"5px 0" }}>Imports six old timelines as editable valve patterns. Proprietary binaries are never launched; pump, frequency, light, fire and valve outputs 65–76 stay protected.</div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
        <button onClick={importBundled} disabled={!!busy} style={button(C.warn)}>{busy==="legacy"?"Importing…":"Import the 6 built-in programs"}</button>
        <label style={button(C.text)}>Import another analysis ZIP<input type="file" accept=".zip" onChange={event=>importZip(event.target.files?.[0])} style={{display:"none"}} /></label>
      </div>
    </div>

    {messages.length>0 && <div style={{ marginBottom:8, fontSize:9 }}>
      {messages.map((item,index)=><div key={`${item.time}-${index}`} style={{color:item.kind==="err"?C.danger:item.kind==="ok"?C.ok:C.text}}>{item.time} · {item.message}</div>)}
    </div>}

    <ICANManualPatternEditor connected={connected} armed={armed} permit={permit}
      siteDemoRunning={!!demo?.running} channelTestRunning={false} status={runner}
      setStatus={setRunner} say={say} refresh={refresh} incomingPattern={draft}
      reloadKey={reloadKey} audioFile={audioFile} />
  </div>;
}
