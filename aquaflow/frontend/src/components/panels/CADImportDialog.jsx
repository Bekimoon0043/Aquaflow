import { useMemo, useRef, useState } from "react";
import { CAD_MAX_BYTES, CAD_ROLES, CAD_UNITS, parseCadDxf, previewCadImport, applyCadImport } from "../../engineering/cadExchange";
import { FIXTURE_LIBRARY } from "../../data/fixtureLibrary";

const field = { background: "#0a1825", border: "1px solid #31536a", color: "#d9edf7", borderRadius: 4, padding: "7px 9px", font: "inherit" };
const button = { ...field, cursor: "pointer", padding: "9px 12px" };
const roleLabel = { ignore: "Ignore", pool: "Pool boundary", nozzle: "Nozzles", light: "Lights", equipment: "Equipment", pipe: "Pipes", depth: "Depth zones", measurement: "Measurements" };

function DrawingPreview({ preview }) {
  const b = preview.bounds;
  if (!b) return <div style={{ padding: 28, color: "#91adc0" }}>Map a pool boundary layer to see the drawing.</div>;
  const width = Math.max(.1,b.maxX-b.minX), height = Math.max(.1,b.maxY-b.minY);
  const scale = Math.min(480/width,210/height);
  const xy = p => ({ x: 20+(p.x-b.minX)*scale, y: 15+(p.y-b.minY)*scale });
  return <svg viewBox="0 0 520 240" role="img" aria-label="CAD import layout preview" style={{ width: "100%", maxHeight: 275, background: "#040b12", borderRadius: 5 }}>
    {preview.boundary && <polygon points={preview.boundary.points.map(p => { const q=xy(p); return `${q.x},${q.y}`; }).join(" ")}
      fill="#004a7044" stroke="#38bdff" strokeWidth="1.5" />}
    {preview.pipes.map((p,i) => <polyline key={i} points={p.points.map(p => {const q=xy(p);return `${q.x},${q.y}`;}).join(" ")}
      fill="none" stroke="#c79aff" strokeWidth="1" />)}
    {preview.fixtures.map((f,i) => { const q=xy(f);return <circle key={i} cx={q.x} cy={q.y} r="2.6"
      fill={f.type.startsWith("light") ? "#ffca57" : f.type.startsWith("nozzle") ? "#36e3bd" : "#a7b6c9"}><title>{f.label}</title></circle>; })}
  </svg>;
}

export default function CADImportDialog({ currentProject, onApply, onClose }) {
  const [parsed,setParsed] = useState(null);
  const [fileName,setFileName] = useState("");
  const [fileError,setFileError] = useState("");
  const [units,setUnits] = useState("auto");
  const [flipY,setFlipY] = useState(true);
  const [roles,setRoles] = useState({});
  const [fixtureTypes,setFixtureTypes] = useState({});
  const [boundaryId,setBoundaryId] = useState("");
  const [mode,setMode] = useState(currentProject.fixtures?.length ? "update" : "new");
  const [name,setName] = useState(currentProject.name || "Imported CAD design");
  const [depth,setDepth] = useState("");
  const [loading,setLoading] = useState(false);
  const readRevision = useRef(0);
  const result = useMemo(() => {
    if (!parsed) return {};
    try { return { preview: previewCadImport(parsed,{ units,flipY,roles,fixtureTypes,boundaryId,depth: depth || undefined }) }; }
    catch (e) { return { error: e.message }; }
  },[parsed,units,flipY,roles,fixtureTypes,boundaryId,depth]);
  const preview = result.preview;
  const matched = preview?.fixtures.filter(f => f.hasIdentity && currentProject.fixtures?.some(old => String(old.id)===f.id)).length || 0;

  const chooseFile = async event => {
    const file = event.target.files?.[0], revision = ++readRevision.current;
    setParsed(null); setFileError(""); setBoundaryId("");
    setLoading(false);
    if (!file) return;
    setFileName(file.name);
    if (!/\.(dxf|dwg)$/i.test(file.name)) { setFileError("Choose an AutoCAD DWG or ASCII DXF drawing."); return; }
    if (file.size>CAD_MAX_BYTES) {setFileError("The drawing must be no larger than 10 MB. Export only the fountain layout.");return;}
    setLoading(true);
    try {
      let text;
      if (/\.dwg$/i.test(file.name)) {
        if (!window.aquaflow?.importDWG) throw new Error("DWG import requires the updated AquaFlow desktop app and an installed CAD engine. Reopen the updated app, or save the drawing as ASCII DXF in AutoCAD.");
        const converted = await window.aquaflow.importDWG(new Uint8Array(await file.arrayBuffer()));
        if (revision!==readRevision.current) return;
        if (!converted?.ok) throw new Error(converted?.error || "DWG conversion failed.");
        text = converted.dxf;
      } else text = await file.text();
      const drawing = parseCadDxf(text);
      if (revision!==readRevision.current) return;
      setParsed(drawing); setRoles(drawing.roles); setFixtureTypes({}); setUnits(drawing.units ? "auto" : "");
      if (mode==="new") setName(file.name.replace(/\.(dxf|dwg)$/i,""));
    } catch(e) { if (revision===readRevision.current) setFileError(e.message); }
    finally { if (revision===readRevision.current) setLoading(false); }
  };
  const apply = () => {
    try {
      const project = applyCadImport(currentProject,preview,{ mode,name,depth: depth==="" ? undefined : Number(depth) });
      onApply(project, { matched, imported: preview.fixtures.length, mode, fileName });
    } catch(e) { setFileError(e.message); }
  };
  return <div style={{ position:"fixed",inset:0,zIndex:5000,background:"#000b",display:"grid",placeItems:"center",padding:20 }}
    onKeyDown={e => {e.stopPropagation(); if(e.key==="Escape")onClose();}}>
    <section role="dialog" aria-modal="true" aria-labelledby="cad-import-title" style={{ width:"min(940px,100%)",maxHeight:"92vh",overflow:"auto",background:"#081420",border:"1px solid #31536a",borderRadius:9,padding:22,fontFamily:"sans-serif",fontSize:13,color:"#d9edf7" }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
        <h2 id="cad-import-title" style={{margin:0,fontSize:21,color:"#65d8ff"}}>Import AutoCAD drawing</h2>
        <button style={button} onClick={onClose} aria-label="Close CAD import">Close</button>
      </div>
      <p style={{color:"#a9c2d3",lineHeight:1.5}}>Choose a DWG or 2D model-space ASCII DXF. Native DWG uses installed AutoCAD 2018+ or ODA File Converter. Review units, layers and orientation before applying.</p>
      <label style={{display:"block",marginBottom:15}}>Drawing file
        <input autoFocus type="file" accept=".dxf,.dwg" onChange={chooseFile} aria-label="AutoCAD drawing file" style={{display:"block",marginTop:7}} />
      </label>
      {loading && <p role="status">{fileName.toLowerCase().endsWith(".dwg") ? "Converting DWG locally with the CAD engine…" : "Reading drawing…"}</p>}
      {(fileError || result.error) && <p role="alert" style={{color:"#ffb39d",background:"#3b211b",padding:12,borderRadius:4}}>{fileError || result.error}</p>}
      {parsed && <>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:14,marginBottom:15}}>
          <label>Drawing units<select aria-label="CAD drawing units" value={units} onChange={e=>setUnits(e.target.value)} style={{...field,display:"block",width:"100%",marginTop:6}}>
            <option value="">Choose actual units</option>
            <option value="auto" disabled={!parsed.units}>From drawing{parsed.units ? ` (${CAD_UNITS[parsed.units].label})` : " (unspecified/unsupported)"}</option>
            {Object.entries(CAD_UNITS).map(([key,u])=><option key={key} value={key}>{u.label}</option>)}
          </select></label>
          <label>Import method<select aria-label="CAD import method" value={mode} onChange={e=>setMode(e.target.value)} style={{...field,display:"block",width:"100%",marginTop:6}}>
            <option value="update">Update current design; keep omitted fixtures</option>
            <option value="new">Create a new design with unassigned fixtures</option>
          </select></label>
          <label>Pool depth (meters)<input aria-label="CAD pool depth" type="number" min="0.05" max="100" step="0.05" value={depth} onChange={e=>setDepth(e.target.value)} placeholder="Use drawing / current depth" style={{...field,display:"block",width:"100%",boxSizing:"border-box",marginTop:6}} /></label>
        </div>
        <label style={{display:"block",marginBottom:15}}><input type="checkbox" checked={flipY} onChange={e=>setFlipY(e.target.checked)} /> Invert CAD Y to match AquaFlow plan orientation (use this for AquaFlow exports)</label>
        <div style={{display:"grid",gridTemplateColumns:"minmax(260px,1fr) minmax(260px,1fr)",gap:20}}>
          <div style={{minWidth:0}}>
            <h3 style={{fontSize:15,margin:"0 0 10px"}}>Map drawing layers</h3>
            <div style={{maxHeight:310,overflow:"auto",border:"1px solid #244255",borderRadius:4}}>
              <table style={{width:"100%",borderCollapse:"collapse",textAlign:"left"}}>
                <thead><tr><th style={{padding:8}}>CAD layer</th><th style={{padding:8}}>Import as</th></tr></thead>
                <tbody>{parsed.layers.map(layer=>{
                  const role=roles[layer];
                  const fallback=role==="nozzle" ? "nozzle_geyser" : role==="light" ? "light_rgb" : "pump";
                  const choices=FIXTURE_LIBRARY.filter(f=>role==="nozzle" ? f.key.startsWith("nozzle") : role==="light" ? /^(light|laser)/.test(f.key) : !/^(nozzle|light|laser)/.test(f.key));
                  if(!choices.some(f=>f.key===fallback))choices.unshift({key:fallback,label:role==="equipment" ? "Pump (unassigned)" : role==="light" ? "RGB light (unassigned)" : "Geyser nozzle (unassigned)"});
                  return <tr key={layer} style={{borderTop:"1px solid #244255"}}>
                    <td style={{padding:8,wordBreak:"break-word",maxWidth:160}}>{layer}</td>
                    <td style={{padding:8}}><select aria-label={`Role for ${layer}`} value={role} onChange={e=>{setRoles(r=>({...r,[layer]:e.target.value}));setBoundaryId("");}} style={{...field,width:"100%"}}>
                      {CAD_ROLES.map(r=><option key={r} value={r}>{roleLabel[r]}</option>)}
                    </select>
                    {["nozzle","light","equipment"].includes(role) && <select aria-label={`Fixture type for ${layer}`} value={fixtureTypes[layer] || (role==="nozzle" ? "nozzle_geyser" : role==="light" ? "light_rgb" : "pump")}
                      onChange={e=>setFixtureTypes(t=>({...t,[layer]:e.target.value}))} style={{...field,width:"100%",marginTop:6}}>
                      {choices.map(f=><option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            <p style={{fontSize:12,color:"#a9c2d3",lineHeight:1.5}}>Use a closed polyline, circle, ellipse or connected line/arc loop for the pool. Nozzle, light and equipment layers use circle centers, points or block insertion points. Unknown layers start as Ignore.</p>
          </div>
          <div style={{minWidth:0}}>
            <h3 style={{fontSize:15,margin:"0 0 10px"}}>Preview {fileName}</h3>
            {preview && <>
              <label>Pool boundary<select aria-label="CAD pool boundary" value={preview.boundary?.id || ""} onChange={e=>setBoundaryId(e.target.value)} style={{...field,display:"block",width:"100%",margin:"6px 0 12px"}}>
                <option value="">{preview.candidates.length ? "Choose one boundary" : "No closed boundary found"}</option>
                {preview.candidates.map((p,i)=><option key={p.id} value={p.id}>{p.layer} - boundary {i+1} ({p.area.toFixed(2)} m²)</option>)}
              </select></label>
              <DrawingPreview preview={preview} />
              <p>{preview.fixtures.length} fixtures · {preview.pipes.length} pipes · {preview.depthZones.length} depth zones</p>
              {preview.boundary && <p style={{color:"#78dbfa"}}>Pool span: {(Math.max(...preview.boundary.points.map(p=>p.x))-Math.min(...preview.boundary.points.map(p=>p.x))).toFixed(3)} × {(Math.max(...preview.boundary.points.map(p=>p.y))-Math.min(...preview.boundary.points.map(p=>p.y))).toFixed(3)} meters</p>}
              {mode==="update" && <p style={{color:"#8bdfc3"}}>{matched} existing fixture IDs matched. {preview.fixtures.length-matched} added fixtures need commissioning. Omitted current fixtures are retained.</p>}
              {preview.warnings.map(w=><p key={w} style={{color:"#ffd58b",fontSize:12,lineHeight:1.45}}>{w}</p>)}
            </>}
          </div>
        </div>
        <label style={{display:"block",marginTop:12}}>Design name<input aria-label="Imported design name" value={name} onChange={e=>setName(e.target.value)} style={{...field,display:"block",width:"100%",boxSizing:"border-box",marginTop:6}} /></label>
        <p style={{lineHeight:1.5,color:"#ffd58b",background:"#352e18",padding:12,borderRadius:4}}>CAD import updates design data only. Matching fixture IDs keep the current AquaFlow control settings; new fixtures get no PLC/I-CAN address. Pipes, depth zones and measurements come from the selected drawing, and hydraulic results must be recalculated. New-design mode does not import hardware mappings.</p>
      </>}
      <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:18}}>
        <button style={button} onClick={onClose}>Cancel</button>
        <button disabled={!preview?.boundary || loading || !!result.error} onClick={apply} style={{...button,background:preview?.boundary ? "#07533d" : "#172b38",color:preview?.boundary ? "#b8ffe4" : "#8396a2",cursor:preview?.boundary ? "pointer" : "default"}}>Apply CAD design</button>
      </div>
    </section>
  </div>;
}
