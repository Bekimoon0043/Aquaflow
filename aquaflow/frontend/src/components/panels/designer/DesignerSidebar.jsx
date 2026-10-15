/**
 * DesignerSidebar.jsx — AF-CAD-030: the Engineering Designer's left-panel sections, moved
 * verbatim out of PoolGeometryDesigner.jsx so the designer component holds behaviour, not
 * 2,000 lines of markup. Each section receives the designer's state bag `d`.
 */
import FixtureLibraryBrowser from "../FixtureLibraryBrowser";
import BasinListPanel from "../BasinListPanel";
import ProvenanceBadge from "../ProvenanceBadge"; // AF-NEXT-012
import { bomCitation } from "../../../engineering/bomEngine"; // AF-NEXT-012
import { LAND_SURFACE_TYPES } from "../../../engineering/siteSurfaces";
import { setUnderlayLayerVisible, setUnderlayVisible } from "../../../engineering/cadUnderlay";
import { ICAN_SITE_PROJECT_NAME } from "../../../data/icanSiteEngineeringProject";
import { POOL_TYPES, TOOLS, FIXTURE_TYPES } from "../../../engineering/drafting/designerCatalog";

// AQ-S2-002 — head/pump figures are null until the backend solver supplies them.
export const HYD_NOT_CALCULATED = "—";
export function hydFmt(value, digits = 1, suffix = "", prefix = "") {
  return Number.isFinite(value) ? `${prefix}${Number(value).toFixed(digits)}${suffix}` : HYD_NOT_CALCULATED;
}


export function ProjectHeaderSection({ d }) {
  const { chooseProjectFile, fixtures, loadICANSiteDesign, openProjectFile, openSavedProject, projectFileInputRef, projectName, savedProjects, savedProjectsLoading, selectedSavedProjectId, setProjectName, setSelectedSavedProjectId, showSavedProjects, toggleSavedProjectBrowser } = d;
  return (
    <>
    <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030", background:"#030608" }}>
      <div style={{ color:"#00ccaa", fontWeight:"bold", fontSize:12, marginBottom:4 }}>⬡ POOL GEOMETRY</div>
      <input value={projectName} onChange={e=>setProjectName(e.target.value)}
        style={{ width:"100%", padding:"3px 6px", background:"#0a1825", color:"#cce8ff", border:"1px solid #0a2535", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
      <button onClick={loadICANSiteDesign} style={{
        width:"100%", marginTop:5, padding:"5px 6px", cursor:"pointer",
        background:"rgba(0,170,255,.09)", color:"#58c7ff", border:"1px solid #1a5a78",
        borderRadius:3, fontSize:9, fontFamily:"monospace", textAlign:"left",
      }}>LOAD 4KILO SITE DESIGN</button>
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".aquaflow.json,.aqua,.json,application/json"
        onChange={openProjectFile}
        aria-label="Open AquaFlow engineering project file"
        style={{ display:"none" }}
      />
      <button onClick={chooseProjectFile} style={{
        width:"100%", marginTop:5, padding:"6px 6px", cursor:"pointer",
        background:"rgba(0,170,255,.10)", color:"#9bdcff", border:"1px solid #2479a3",
        borderRadius:3, fontSize:9, fontFamily:"monospace", textAlign:"left", fontWeight:700,
      }}>OPEN PROJECT FILE…</button>
      <button onClick={toggleSavedProjectBrowser} disabled={savedProjectsLoading} style={{
        width:"100%", marginTop:5, padding:"5px 6px", cursor:savedProjectsLoading?"wait":"pointer",
        background:"rgba(34,197,94,.08)", color:"#86efac", border:"1px solid #166534",
        borderRadius:3, fontSize:9, fontFamily:"monospace", textAlign:"left",
      }}>{savedProjectsLoading ? "LOADING PROJECT LIBRARY…" : showSavedProjects ? "CLOSE PROJECT LIBRARY" : "OPEN PROJECT LIBRARY…"}</button>
      {showSavedProjects && <div style={{ marginTop:5, padding:5, background:"#06121c", border:"1px solid #16415a", borderRadius:4 }}>
        <select value={selectedSavedProjectId} onChange={event=>setSelectedSavedProjectId(event.target.value)} style={{
          width:"100%", padding:"5px", background:"#041018", color:"#cce8ff", border:"1px solid #1a4055", borderRadius:3, fontSize:9, fontFamily:"monospace",
        }}>
          {savedProjects.map(project => <option key={project.id} value={project.id}>
            {project.name} · {project.fixture_count} fixtures
          </option>)}
        </select>
        <button onClick={openSavedProject} disabled={!selectedSavedProjectId || savedProjectsLoading} style={{
          width:"100%", marginTop:5, padding:"5px", cursor:selectedSavedProjectId?"pointer":"not-allowed",
          background:"#07351e", color:"#86efac", border:"1px solid #22c55e", borderRadius:3, fontSize:9, fontFamily:"monospace",
        }}>OPEN SELECTED PROJECT</button>
      </div>}
      {(projectName === ICAN_SITE_PROJECT_NAME || projectName.startsWith("4KILO Site Fountain")) && <div style={{
        marginTop:5, color:"#ffcc55", fontSize:8, lineHeight:1.4,
      }}>100 water outlets / 7 pumps. Layout confirmed; dimensions and hydraulics require site survey.</div>}
    </div>
    </>
  );
}


export function PoolTypeSection({ d }) {
  const { activeBasin, activeBasinIndex, basinState, basins, changePoolType, isLayerLocked, poolType, pushUndo, safePoolTypes, startCustomPoolDrawing, tool } = d;
  return (
    <>
    <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
      <BasinListPanel basins={basins} activeIndex={activeBasinIndex} onSelect={basinState.selectBasin}
        onAdd={() => { pushUndo(); basinState.addBasin(); }} onRemove={(i) => { pushUndo(); basinState.removeBasin(i); }}
        onRename={basinState.renameBasin} disabled={isLayerLocked("pool_outline")} />
      <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>POOL TYPE{basins.length > 1 ? ` — ${activeBasin?.name || ""}` : ""}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3 }}>
        {safePoolTypes.map(t => (
          <button key={t.key} onClick={()=>changePoolType(t.key)} style={{
            padding:"5px 6px",
            background: poolType===t.key
              ? "linear-gradient(135deg,#00402a,#002818)"
              : "#0a1825",
            color: poolType===t.key ? "#7fffd4" : "#556677",
            border:`1px solid ${poolType===t.key ? "#00ffcc" : "#0a2030"}`,
            borderRadius:4,
            cursor:"pointer",
            fontFamily:"monospace",
            fontSize:9,
            textAlign:"left",
            fontWeight: poolType===t.key ? 800 : 400,
            boxShadow: poolType===t.key
              ? "0 0 0 1px rgba(0,255,204,0.35), 0 0 14px rgba(0,255,204,0.18)"
              : "none",
          }}>{poolType===t.key ? "●" : t.icon} {t.label}</button>
        ))}
      </div>
      <button type="button" onClick={startCustomPoolDrawing} style={{
        width:"100%", marginTop:6, padding:"7px 8px", cursor:"crosshair",
        background:tool==="polyline"?"linear-gradient(135deg,#00533f,#073020)":"#08253a",
        color:tool==="polyline"?"#a7ffe8":"#7dd3fc", border:`1px solid ${tool==="polyline"?"#00d6a3":"#1674a8"}`,
        borderRadius:4, fontFamily:"monospace", fontSize:10, fontWeight:800, textAlign:"left",
      }}>✎ DRAW CUSTOM POOL</button>
      <div style={{ color:"#6f8595", fontSize:8, lineHeight:1.5, marginTop:4 }}>
        Draw any outline: click corners in the plan, then double-click to close it.
      </div>
    </div>
    </>
  );
}


export function DimensionsSection({ d }) {
  const { params, poolMetrics, poolType, setNumericParam, showDimensions } = d;
  return (
    <>
    <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
      <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>DIMENSIONS</div>
      {poolType !== "circular" && poolType !== "false_lake" && (
        <>
          {[["Width (m)","width",1,100],["Length (m)","length",1,200]].map(([label,key,min,max]) => (
            <div key={key} style={{ marginBottom:6 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
                <span style={{ color:"#7ab", fontSize:9 }}>{label}</span>
                <span style={{ color:"#00ccaa", fontSize:9 }}>{params[key]}m</span>
              </div>
              <input type="range" min={min} max={max} step="0.5" value={params[key]}
                onChange={e=>setNumericParam(key, e.target.value, min, max)}
                style={{ width:"100%" }} />
              <input type="number" min={min} max={max} step="0.001" value={params[key]}
                onChange={e=>setNumericParam(key, e.target.value, min, max)}
                style={{ width:"100%", marginTop:3, padding:"3px 5px", background:"#06121c", color:"#00ccaa", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>
          ))}
        </>
      )}
      {(poolType === "circular" || poolType === "false_lake") && (
        <div style={{ marginBottom:6 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
            <span style={{ color:"#7ab", fontSize:9 }}>Radius (m)</span>
            <span style={{ color:"#00ccaa", fontSize:9 }}>{params.radius}m</span>
          </div>
          <input type="range" min="1" max="50" step="0.5" value={params.radius}
            onChange={e=>setNumericParam("radius", e.target.value, 1, 50)}
            style={{ width:"100%" }} />
          <input type="number" min="1" max="50" step="0.001" value={params.radius}
            onChange={e=>setNumericParam("radius", e.target.value, 1, 50)}
            style={{ width:"100%", marginTop:3, padding:"3px 5px", background:"#06121c", color:"#00ccaa", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
        </div>
      )}
      <div style={{ marginBottom:4 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
          <span style={{ color:"#7ab", fontSize:9 }}>Design depth (m)</span>
          <span style={{ color:"#00ccaa", fontSize:9 }}>{params.depth}m</span>
        </div>
        <input type="range" min="0.1" max="3" step="0.05" value={params.depth}
          onChange={e=>setNumericParam("depth", e.target.value, 0.1, 3)}
          style={{ width:"100%" }} />
        <input type="number" min="0.1" max="3" step="0.001" value={params.depth}
          onChange={e=>setNumericParam("depth", e.target.value, 0.1, 3)}
          style={{ width:"100%", marginTop:3, padding:"3px 5px", background:"#06121c", color:"#00ccaa", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
      </div>
      <div style={{ marginTop:6, padding:"4px 5px", background:"#06121c", border:"1px solid #0a3040", borderRadius:3, color:"#ffcc00", fontSize:9 }}>
        Drawing annotations: {showDimensions ? "ON" : "OFF"} · Toggle with DIM
      </div>

      {/* Computed stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:3, marginTop:6 }}>
        {[
          ["Surface area", `${poolMetrics.area.toFixed(1)}m²`],
          ["Volume", `${poolMetrics.volume.toFixed(1)}m³`],
          ["Perimeter", `${poolMetrics.perimeter.toFixed(1)}m`],
          ["Capacity", `${poolMetrics.capacityLitres.toFixed(0)}L`],
        ].map(([k,v]) => (
          <div key={k} style={{ padding:"3px 5px", background:"#0a1520", borderRadius:3 }}>
            <div style={{ fontSize:8, color:"#334455" }}>{k}</div>
            <div style={{ fontSize:10, color:"#00ccaa", fontWeight:"bold" }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
    </>
  );
}


export function ToolsSection({ d }) {
  const { cancelDepthZone, cancelDrawing, cancelPipeDrawing, clearMeasurements, depthDrawPoints, depthZone, depthZoneError, drawStart, finishDepthZone, finishLandSurface, finishPolyline, landDrawPoints, landSurfaceType, measureStart, measurements, orthogonalMode, pipeDiameter, pipeDrawMode, pipeSystem, pipeType, polylinePoints, safeDepthZones, setDepthZone, setDepthZones, setLandSurfaceType, setOrthogonalMode, setPipeDiameter, setPipeDrawMode, setPipeType, setTool, tool } = d;
  return (
    <>
        <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
          <div style={{ color:"#556677", fontSize:9, marginBottom:5 }}>TOOLS</div>
          <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
            {TOOLS.map(t => (
              <button key={t.key} onClick={()=>{ setTool(t.key); cancelDrawing(); }} style={{
                padding:"4px 7px", background: tool===t.key?"#003020":"#0a1825",
                color: tool===t.key?"#00ccaa":"#556677",
                border:`1px solid ${tool===t.key?"#00aa4444":"#0a2030"}`,
                borderRadius:3, cursor:"pointer", fontFamily:"monospace", fontSize:9,
                textTransform:"none",
              }}>{t.icon} {t.label}</button>
            ))}
          </div>
          {tool==="pipe" && (
          <div style={{ marginTop:6, padding:"6px", background:"#050d14", border:"1px solid #0a3040", borderRadius:4 }}>
            <div style={{ color:"#8b5cf6", fontSize:9, fontWeight:"bold", marginBottom:5 }}>PIPE SETTINGS</div>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Diameter (DN)</div>
            <select value={pipeDiameter} onChange={e=>setPipeDiameter(parseInt(e.target.value))}
              style={{ width:"100%", padding:"3px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              {[20,25,32,40,50,65,80,100,125,150].map(dn=>(
                <option key={dn} value={dn}>DN{dn}</option>
              ))}
            </select>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Pipe Type</div>
            <select value={pipeType} onChange={e=>setPipeType(e.target.value)}
              style={{ width:"100%", padding:"3px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              <option value="supply">Supply</option>
              <option value="return_">Return/Overflow</option>
              <option value="drain">Drain</option>
              <option value="chemical">Chemical</option>
              <option value="air">Compressed Air</option>
            </select>
<div style={{ marginTop: 6 }}>
  <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>
    Draw Mode
  </div>

  <div style={{
    display:"grid",
    gridTemplateColumns:"1fr 1fr",
    gap:3,
    marginBottom:5
  }}>
    {["straight","polyline","curve","arc"].map(mode => (
      <button
        key={mode}
        onClick={()=>setPipeDrawMode(mode)}
        style={{
          padding:"3px",
          background: pipeDrawMode===mode ? "#006644" : "#0a1825",
          color: pipeDrawMode===mode ? "#00ffaa" : "#556677",
          border:"1px solid #0a3040",
          borderRadius:3,
          cursor:"pointer",
          fontSize:8,
          fontFamily:"monospace"
        }}
      >
        {mode}
      </button>
    ))}
  </div>
</div>
            <button onClick={()=>setOrthogonalMode(v=>!v)} style={{ width:"100%", padding:"4px", background:orthogonalMode?"#002030":"#0a1825", color:orthogonalMode?"#00ccaa":"#556677", border:`1px solid ${orthogonalMode?"#00aa4444":"#0a2030"}`, borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              {orthogonalMode ? "⊢ ORTHO ON" : "⊢ ORTHO OFF"}
            </button>
            <div style={{ color:"#556677", fontSize:8, lineHeight:1.5 }}>Click to add points · Double-click to finish · ESC to cancel</div>
            {pipeSystem.drawing && (
              <button onClick={cancelPipeDrawing} style={{ width:"100%", marginTop:4, padding:"3px", background:"#1a0808", color:"#ff8888", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
                Cancel Drawing ({pipeSystem.drawing.points.length} pts)
              </button>
            )}
          </div>
        )}
        {tool==="polyline" && (
            <div style={{ marginTop:6 }}>
              <button onClick={finishPolyline} disabled={polylinePoints.length < 3} style={{ width:"100%", padding:"4px", background:polylinePoints.length>=3?"#002030":"#081018", color:polylinePoints.length>=3?"#00ccaa":"#334455", border:"1px solid #00aa4444", borderRadius:3, cursor:"pointer", fontSize:9 }}>
                ✓ Close Polyline ({polylinePoints.length} pts)
              </button>
              <button onClick={cancelDrawing} style={{ width:"100%", marginTop:4, padding:"3px", background:"#1a0808", color:"#ff8888", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
                Cancel Drawing
              </button>
            </div>
          )}
          {tool === "land" && (
            <div style={{ marginTop:6, padding:6, background:"#050d14", border:"1px solid #25451d", borderRadius:4 }}>
              <div style={{ color:"#a7e38c", fontSize:9, fontWeight:"bold", marginBottom:5 }}>LAND SURFACE</div>
              <select value={landSurfaceType} onChange={(event) => setLandSurfaceType(event.target.value)}
                aria-label="Land surface material"
                style={{ width:"100%", padding:4, background:"#06121c", color:"#e8f6df", border:"1px solid #37612b", borderRadius:3, fontSize:9, marginBottom:5 }}>
                {LAND_SURFACE_TYPES.map((surface) => <option key={surface.key} value={surface.key}>{surface.label}</option>)}
              </select>
              <div style={{ color:"#91ad84", fontSize:8, lineHeight:1.5, marginBottom:5 }}>
                Click the land boundary points. Double-click or choose Close Surface to finish.
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                <button type="button" onClick={finishLandSurface} disabled={landDrawPoints.length < 3}
                  style={{ padding:4, background:landDrawPoints.length >= 3?"#163719":"#081018", color:landDrawPoints.length >= 3?"#b8f59e":"#334455", border:"1px solid #37612b", borderRadius:3, fontSize:8, cursor:"pointer" }}>
                  CLOSE ({landDrawPoints.length})
                </button>
                <button type="button" onClick={cancelDrawing}
                  style={{ padding:4, background:"#1a0808", color:"#ff9999", border:"1px solid #552222", borderRadius:3, fontSize:8, cursor:"pointer" }}>
                  CANCEL
                </button>
              </div>
            </div>
          )}
          {(tool==="rectangle" || tool==="circle") && drawStart && (
            <button onClick={cancelDrawing} style={{ width:"100%", marginTop:6, padding:"3px", background:"#1a0808", color:"#ff8888", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
              Cancel Drawing
            </button>
          )}
          {tool==="measure" && measureStart && (
            <div style={{ color:"#ffcc00", fontSize:9, marginTop:4 }}>Click to set end point</div>
          )}
          {tool === "depth" && (
            <div style={{ marginTop:6, padding:6, background:"#050d14", border:"1px solid #0a3040", borderRadius:4 }}>
              <div style={{ color:"#7ec8e3", fontSize:9, fontWeight:"bold", marginBottom:5 }}>DEPTH-ZONE DRAWING</div>
              <select value={depthZone} onChange={(event) => { setDepthZone(event.target.value); cancelDepthZone(); }}
                aria-label="Active depth zone"
                style={{ width:"100%", padding:4, background:"#06121c", color:"#cce8ff", border:"1px solid #0a3040", borderRadius:3, fontSize:9, marginBottom:5 }}>
                {safeDepthZones.map((zone) => <option key={zone.key} value={zone.key}>{zone.label} · {zone.depth}m</option>)}
              </select>
              <div style={{ color:"#7890a0", fontSize:8, lineHeight:1.5, marginBottom:5 }}>
                Click at least three points inside the pool, then validate and close the zone.
              </div>
              {depthZoneError && <div role="alert" style={{ color:"#ff8888", fontSize:8, marginBottom:5 }}>{depthZoneError}</div>}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                <button type="button" onClick={finishDepthZone} disabled={depthDrawPoints.length < 3}
                  style={{ padding:4, background:depthDrawPoints.length >= 3?"#002b26":"#081018", color:depthDrawPoints.length >= 3?"#7fffd4":"#334455", border:"1px solid #0a5045", borderRadius:3, fontSize:8, cursor:"pointer" }}>
                  CLOSE ({depthDrawPoints.length})
                </button>
                <button type="button" onClick={cancelDepthZone}
                  style={{ padding:4, background:"#1a0808", color:"#ff9999", border:"1px solid #552222", borderRadius:3, fontSize:8, cursor:"pointer" }}>
                  CANCEL
                </button>
              </div>
              {safeDepthZones.find((zone) => zone.key === depthZone)?.points?.length >= 3 && (
                <button type="button" onClick={() => setDepthZones((zones) => zones.map((zone) => (zone.zone || zone.key) === depthZone ? { ...zone, points:[] } : zone))}
                  style={{ width:"100%", marginTop:4, padding:3, background:"transparent", color:"#ff8888", border:"1px solid #552222", borderRadius:3, fontSize:8, cursor:"pointer" }}>
                  CLEAR SAVED ZONE
                </button>
              )}
            </div>
          )}
          {measurements.length > 0 && (
            <button onClick={clearMeasurements} style={{ width:"100%", marginTop:4, padding:"3px", background:"#1a0808", color:"#ff4444", border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9 }}>
              ✕ Clear measurements
            </button>
          )}
        </div>
    </>
  );
}


export function FixturePickerSection({ d }) {
  const { applyFixtureArray, arrayCols, arrayCount, arrayInset, arrayMode, arrayRows, autoPlaceNozzles, fixtureType, fixtures, setArrayCols, setArrayCount, setArrayInset, setArrayMode, setArrayRows, setFixtureType, tool } = d;
  return (
    <>
    <div style={{ display:["nozzle","light","equipment"].includes(tool)?"block":"none", borderBottom:"1px solid #0a2030" }}>
      <FixtureLibraryBrowser
        fixtures={FIXTURE_TYPES}
        tool={tool}
        selectedKey={fixtureType}
        onSelect={setFixtureType}
      />
      <div style={{ padding:"0 10px 8px" }}>
      {tool === "nozzle" && (
        <button onClick={autoPlaceNozzles} style={{ width:"100%", marginTop:6, padding:"5px", background:"#001530", color:"#00aaff", border:"1px solid #00aaff44", borderRadius:3, cursor:"pointer", fontSize:9 }}>
          ⬡ AUTO-PLACE NOZZLES
        </button>
      )}

      <div style={{ marginTop:8, padding:"6px", background:"#050d14", border:"1px solid #0a3040", borderRadius:4 }}>
        <div style={{ color:"#ffcc00", fontSize:9, fontWeight:"bold", marginBottom:5 }}>ARRAY PLACEMENT</div>

        <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Array Type</div>
        <select aria-label="Array type" value={arrayMode} onChange={e=>setArrayMode(e.target.value)}
          style={{ width:"100%", padding:"3px", background:"#06121c", color:"#cce8ff", border:"1px solid #0a3040", borderRadius:3, fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
          <option value="centerline">Centerline</option>
          <option value="ring">Ring</option>
          <option value="grid">Grid</option>
          <option value="edge">Along edge</option>
        </select>

        {arrayMode !== "grid" && (
          <div style={{ marginBottom:5 }}>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Count</div>
            <input aria-label="Array count" type="number" min="1" max="200" step="1" value={arrayCount}
              onChange={e=>setArrayCount(parseInt(e.target.value || 1))}
              style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
          </div>
        )}

        {arrayMode === "grid" && (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:5 }}>
            <div>
              <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Rows</div>
              <input type="number" min="1" max="50" step="1" value={arrayRows}
                onChange={e=>setArrayRows(parseInt(e.target.value || 1))}
                style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>
            <div>
              <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Columns</div>
              <input type="number" min="1" max="50" step="1" value={arrayCols}
                onChange={e=>setArrayCols(parseInt(e.target.value || 1))}
                style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>
          </div>
        )}

        <div style={{ marginBottom:6 }}>
          <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Inset from Edge (m)</div>
          <input aria-label="Inset from edge (m)" type="number" min="0" max="50" step="0.1" value={arrayInset}
            onChange={e=>setArrayInset(parseFloat(e.target.value || 0))}
            style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
        </div>

        <button onClick={applyFixtureArray}
          style={{ width:"100%", padding:"5px", background:"#002030", color:"#00ccaa", border:"1px solid #00aa8844", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
          APPLY ARRAY
        </button>
      </div>
      </div>
    </div>
    </>
  );
}


export function PoolPropertiesSection({ d }) {
  const { geometryMeta, params, selectedObject, setGeometryProperty } = d;
  return (
    <>
    {selectedObject === "pool" && geometryMeta && (
      <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030", background:"#050d14" }}>
        <div style={{ color:"#ffcc00", fontSize:9, marginBottom:6, fontWeight:"bold" }}>
          ▭ SELECTED POOL PROPERTIES
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:6 }}>
          <div>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>X Origin (m)</div>
            <input type="number" step="0.001" value={geometryMeta.x.toFixed(3)}
              onChange={e=>setGeometryProperty("x", e.target.value)}
              style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
          </div>
          <div>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Y Origin (m)</div>
            <input type="number" step="0.001" value={geometryMeta.y.toFixed(3)}
              onChange={e=>setGeometryProperty("y", e.target.value)}
              style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
          </div>
        </div>

        {geometryMeta.kind === "circle" ? (
          <div style={{ marginBottom:6 }}>
            <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Radius (m)</div>
            <input type="number" step="0.001" value={geometryMeta.radius.toFixed(3)}
              onChange={e=>setGeometryProperty("radius", e.target.value)}
              style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
          </div>
        ) : (
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:5, marginBottom:6 }}>
            <div>
              <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Width (m)</div>
              <input type="number" step="0.001" value={geometryMeta.width.toFixed(3)}
                onChange={e=>setGeometryProperty("width", e.target.value)}
                style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>
            <div>
              <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Length (m)</div>
              <input type="number" step="0.001" value={geometryMeta.length.toFixed(3)}
                onChange={e=>setGeometryProperty("length", e.target.value)}
                style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
            </div>
          </div>
        )}

        <div style={{ marginBottom:6 }}>
          <div style={{ color:"#7ab", fontSize:8, marginBottom:2 }}>Design Depth (m)</div>
          <input type="number" step="0.001" value={Number(params.depth || 0).toFixed(3)}
            onChange={e=>setGeometryProperty("depth", e.target.value)}
            style={{ width:"100%", padding:"3px 5px", background:"#06121c", color:"#ffcc00", border:"1px solid #0a3040", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
        </div>
      </div>
    )}
    </>
  );
}


export function SurfacePropertiesSection({ d }) {
  const { deleteSelectedSurface, duplicateSelectedSurface, selectedObject, selectedSurface, selectedSurfaceMetrics, updateSelectedSurface } = d;
  return (
    <>
    {selectedObject === "surface" && selectedSurface && (
      <div style={{ padding:"8px 10px", borderBottom:"1px solid #25451d", background:"#07110a" }}>
        <div style={{ color:"#a7e38c", fontSize:9, marginBottom:6, fontWeight:"bold" }}>
          ▰ SELECTED LAND SURFACE
        </div>
        <div style={{ color:"#91ad84", fontSize:8, marginBottom:2 }}>Name</div>
        <input value={selectedSurface.label} onChange={(event) => updateSelectedSurface({ label:event.target.value })}
          style={{ width:"100%", padding:"3px 5px", marginBottom:5, background:"#06121c", color:"#e8f6df", border:"1px solid #37612b", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 56px", gap:5, marginBottom:5 }}>
          <div>
            <div style={{ color:"#91ad84", fontSize:8, marginBottom:2 }}>Material</div>
            <select value={selectedSurface.type} onChange={(event) => {
              const preset = LAND_SURFACE_TYPES.find((entry) => entry.key === event.target.value);
              updateSelectedSurface({ type:event.target.value, color:preset?.color || selectedSurface.color });
            }} style={{ width:"100%", padding:3, background:"#06121c", color:"#e8f6df", border:"1px solid #37612b", borderRadius:3, fontSize:9 }}>
              {LAND_SURFACE_TYPES.map((surface) => <option key={surface.key} value={surface.key}>{surface.label}</option>)}
            </select>
          </div>
          <div>
            <div style={{ color:"#91ad84", fontSize:8, marginBottom:2 }}>Color</div>
            <input aria-label="Land surface color" type="color" value={selectedSurface.color}
              onChange={(event) => updateSelectedSurface({ color:event.target.value })}
              style={{ width:"100%", height:23, padding:1, background:"#06121c", border:"1px solid #37612b", borderRadius:3 }} />
          </div>
        </div>
        <div style={{ color:"#91ad84", fontSize:8, marginBottom:2 }}>Elevation above deck (m)</div>
        <input type="number" min="-0.01" max="2" step="0.01" value={selectedSurface.elevation}
          onChange={(event) => updateSelectedSurface({ elevation:Number(event.target.value || 0) })}
          style={{ width:"100%", padding:"3px 5px", marginBottom:6, background:"#06121c", color:"#b8f59e", border:"1px solid #37612b", borderRadius:3, fontSize:10, fontFamily:"monospace" }} />
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:6 }}>
          <div style={{ padding:4, background:"#0b1b0e", color:"#b8f59e", fontSize:8 }}>AREA<br/><b>{selectedSurfaceMetrics.area.toFixed(2)} m²</b></div>
          <div style={{ padding:4, background:"#0b1b0e", color:"#b8f59e", fontSize:8 }}>PERIMETER<br/><b>{selectedSurfaceMetrics.perimeter.toFixed(2)} m</b></div>
        </div>
        <div style={{ color:"#91ad84", fontSize:8, lineHeight:1.5, marginBottom:6 }}>
          Drag inside to move · drag square grips to reshape · Ctrl+D duplicates.
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
          <button onClick={duplicateSelectedSurface} style={{ padding:4, background:"#0b2512", color:"#b8f59e", border:"1px solid #37612b", borderRadius:3, cursor:"pointer", fontSize:8 }}>DUPLICATE</button>
          <button onClick={deleteSelectedSurface} style={{ padding:4, background:"#1a0808", color:"#ff8888", border:"1px solid #552222", borderRadius:3, cursor:"pointer", fontSize:8 }}>DELETE</button>
        </div>
      </div>
    )}
    </>
  );
}


export function SiteSurfacesSection({ d }) {
  const { cancelDrawing, selectedSurfaceId, setSelectedFixture, setSelectedObject, setSelectedSurfaceId, setSelectedSurfaceVertex, setTool, siteSurfaces } = d;
  return (
    <>
    <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
        <span style={{ color:"#91ad84", fontSize:9 }}>SITE SURFACES</span>
        <button onClick={() => { setTool("land"); cancelDrawing(); }} style={{ padding:"2px 6px", background:"#0b2512", color:"#b8f59e", border:"1px solid #37612b", borderRadius:3, cursor:"pointer", fontSize:8 }}>+ DRAW</button>
      </div>
      {siteSurfaces.length === 0 && <div style={{ color:"#4e6650", fontSize:8 }}>No land areas yet. Draw grass, paving, soil, rock, or sand.</div>}
      {siteSurfaces.map((surface) => (
        <button key={surface.id} onClick={() => {
          setSelectedSurfaceId(surface.id);
          setSelectedSurfaceVertex(null);
          setSelectedFixture(null);
          setSelectedObject("surface");
          setTool("select");
        }} style={{ width:"100%", display:"grid", gridTemplateColumns:"12px 1fr auto", alignItems:"center", gap:5, padding:"4px 5px", marginBottom:3, background:selectedSurfaceId === surface.id?"#17341b":"#06121c", color:selectedSurfaceId === surface.id?"#d7ffc7":"#91ad84", border:`1px solid ${selectedSurfaceId === surface.id?"#5a913f":"#17351d"}`, borderRadius:3, cursor:"pointer", fontSize:8, textAlign:"left" }}>
          <span style={{ width:9, height:9, borderRadius:2, background:surface.color }} />
          <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{surface.label}</span>
          <span>{surface.points.length} pts</span>
        </button>
      ))}
    </div>
    </>
  );
}


export function LayersSection({ d }) {
  const { cadUnderlay, layers, setShowLayerPanel, showLayerPanel, toggleLayerLocked, toggleLayerVisible, updateCadUnderlay } = d;
  return (
    <>
    <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:5 }}>
        <div style={{ color:"#556677", fontSize:9 }}>LAYERS</div>
        <button onClick={()=>setShowLayerPanel(v=>!v)} style={{ background:"none", border:"none", color:"#7ab", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
          {showLayerPanel ? "HIDE" : "SHOW"}
        </button>
      </div>

      {showLayerPanel && layers.map(layer => (
        <div key={layer.key} style={{ display:"grid", gridTemplateColumns:"18px 18px 12px 1fr", gap:4, alignItems:"center", padding:"3px 0", borderBottom:"1px solid rgba(10,32,48,0.35)" }}>
          <button onClick={()=>toggleLayerVisible(layer.key)} title="Show/Hide Layer" style={{ background:"#06121c", border:"1px solid #0a3040", borderRadius:3, color:layer.visible?"#00ccaa":"#334455", cursor:"pointer", fontSize:9 }}>
            {layer.visible ? "👁" : "–"}
          </button>
          <button onClick={()=>toggleLayerLocked(layer.key)} title="Lock/Unlock Layer" style={{ background:"#06121c", border:"1px solid #0a3040", borderRadius:3, color:layer.locked?"#ff4444":"#556677", cursor:"pointer", fontSize:9 }}>
            {layer.locked ? "🔒" : "○"}
          </button>
          <span style={{ width:10, height:10, borderRadius:2, background:layer.color, display:"inline-block" }} />
          <span style={{ color:layer.visible?"#7ab":"#334455", fontSize:9, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
            {layer.label}
          </span>
        </div>
      ))}

      {/* AF-CAD-011: locked CAD underlay, per-layer visibility */}
      {showLayerPanel && cadUnderlay && (
        <div style={{ marginTop:7, paddingTop:6, borderTop:"1px solid #0a3040" }}>
          <div style={{ display:"grid", gridTemplateColumns:"18px 1fr auto", gap:4, alignItems:"center", marginBottom:3 }}>
            <button onClick={()=>updateCadUnderlay(setUnderlayVisible(cadUnderlay, cadUnderlay.visible === false))} title="Show/Hide CAD underlay" aria-label="Toggle CAD underlay" style={{ background:"#06121c", border:"1px solid #0a3040", borderRadius:3, color:cadUnderlay.visible !== false?"#00ccaa":"#334455", cursor:"pointer", fontSize:9 }}>
              {cadUnderlay.visible !== false ? "👁" : "–"}
            </button>
            <span title={`${cadUnderlay.filename || "CAD drawing"} · locked reference · ${cadUnderlay.items.length} entities`} style={{ color:"#7ab", fontSize:9, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
              🔒 CAD {cadUnderlay.filename || "UNDERLAY"}
            </span>
            <button onClick={()=>{ if (window.confirm("Remove the CAD reference drawing from this design? The design itself is unchanged.")) updateCadUnderlay(null); }} title="Remove CAD underlay" style={{ background:"none", border:"none", color:"#556677", cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>✕</button>
          </div>
          <div style={{ maxHeight:150, overflowY:"auto" }}>
            {cadUnderlay.layers.map(l => (
              <label key={l.name} style={{ display:"grid", gridTemplateColumns:"14px 10px 1fr auto", gap:4, alignItems:"center", padding:"1px 0 1px 8px", cursor:"pointer" }}>
                <input type="checkbox" checked={l.visible !== false} onChange={e=>updateCadUnderlay(setUnderlayLayerVisible(cadUnderlay, l.name, e.target.checked))} aria-label={`Show CAD layer ${l.name}`} style={{ margin:0 }} />
                <span style={{ width:8, height:8, borderRadius:2, background:l.color, display:"inline-block" }} />
                <span style={{ color:l.visible !== false?"#7ab":"#334455", fontSize:8, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{l.name}</span>
                <span style={{ color:"#334455", fontSize:8 }}>{l.count}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
    </>
  );
}


export function ProjectOutputSection({ d }) {
  const { bomItems, cadExportBusy, exportBOMCSV, exportProjectDWG, exportProjectDXF, exportProjectJSON, exportStatus, fixtures, hydraulicRunState, hydraulicSummary, pipework, runHydraulics, saveProject, saveStatus, saved, setShowCADImport, solvedHydraulics } = d;
  return (
    <>
        <div style={{ padding:"8px 10px", marginTop:"auto" }}>
          <div style={{ fontSize:9, color:"#334455", marginBottom:4 }}>
            {fixtures.length} fixtures placed
<div style={{
  padding:"4px",
  background:"#06121c",
  border:"1px solid #0a3040",
  borderRadius:3,
  color:"#00ccaa",
  fontSize:9,
  marginBottom:6,
  fontFamily:"monospace",
  fontWeight:"bold"
}}>
  BOM ITEMS: {bomItems.length}
</div>
          </div>
{bomItems.length > 0 && (
  <div style={{
    background:"#041018",
    border:"1px solid #0a3040",
    borderRadius:3,
    marginBottom:6,
    padding:"4px",
    fontSize:8,
    fontFamily:"monospace"
  }}>
    {bomItems.map(item => (
      <div key={item.key} style={{
        display:"grid",
        gridTemplateColumns:"1fr auto 28px",
        gap:4,
        color:"#9bd",
        borderBottom:"1px solid #0a304044",
        padding:"2px 0"
      }}>
        <span>{item.label}</span>
        <ProvenanceBadge provenance={bomCitation(item)} compact />
        <span style={{ color:"#00ccaa", textAlign:"right" }}>{item.quantity}</span>
      </div>
    ))}
  </div>
)}
          <div style={{ padding:6, background:"#041018", border:"1px solid #16415a", borderRadius:4, marginBottom:6 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:6, marginBottom:5 }}>
              <div style={{ color:"#7ec8e3", fontSize:9, fontWeight:"bold" }}>SOLVED HYDRAULICS</div>
              <span style={{ color:solvedHydraulics?.converged?"#00dd88":"#ffcc00", fontSize:8 }}>
                {solvedHydraulics ? solvedHydraulics.status.toUpperCase() : "NOT RUN"}
              </span>
            </div>
            <button type="button" onClick={runHydraulics} disabled={hydraulicRunState.loading}
              style={{ width:"100%", padding:5, background:"#072b40", color:"#8de0ff", border:"1px solid #176181", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace", marginBottom:5 }}>
              {hydraulicRunState.loading ? "SOLVING…" : "RUN HYDRAULIC SOLVER"}
            </button>
            {hydraulicRunState.error && <div role="alert" style={{ color:"#ff8888", fontSize:8, marginBottom:4 }}>{hydraulicRunState.error}</div>}
            {solvedHydraulics && [
              ["Method", solvedHydraulics.method],
              ["Design flow", `${solvedHydraulics.totalDesignFlowLpm.toFixed(1)} L/min`],
              ["Turnover", solvedHydraulics.turnoverTimeHours == null ? "—" : `${solvedHydraulics.turnoverTimeHours.toFixed(2)} h`],
              ["Solved nozzles", Object.keys(solvedHydraulics.nozzlePhysics || {}).length],
            ].map(([label, value]) => (
              <div key={label} style={{ display:"grid", gridTemplateColumns:"1fr 1fr", padding:"2px 0", borderBottom:"1px solid #0a304044", fontSize:8 }}>
                <span style={{ color:"#587286" }}>{label}</span><span style={{ color:"#8de0ff", textAlign:"right" }}>{value}</span>
              </div>
            ))}
            {solvedHydraulics?.validation?.length > 0 && (
              <div style={{ marginTop:5, color:"#ffcc88", fontSize:8 }}>
                {solvedHydraulics.validation.slice(0, 3).map((finding, index) => (
                  <div key={`${finding.code || "finding"}-${index}`}>• {finding.message || String(finding)}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ padding:"6px", background:"#041018", border:"1px solid #0a3040", borderRadius:4, marginBottom:6 }}>
  <div style={{ color:"#ffcc00", fontSize:9, fontWeight:"bold", marginBottom:6 }}>
    ENGINEERING SUMMARY
  </div>

  {[
    ["Nozzle Flow", `${hydraulicSummary.totalNozzleFlowLpm.toFixed(1)} L/min`],
    ["Process Flow", `${hydraulicSummary.totalProcessFlowLpm.toFixed(1)} L/min`],
    ["Total Flow", `${hydraulicSummary.totalFlowM3Hr.toFixed(2)} m³/hr`],
    ["Recommended Pipe", hydFmt(hydraulicSummary.recommendedPipeMm, 0, "", "DN")],
    ["TDH", hydFmt(hydraulicSummary.totalDynamicHeadM, 1, " m")],
    ["Required Pump", hydFmt(hydraulicSummary.recommendedPumpKw, 2, " kW")],
    ["Installed Pump", `${hydraulicSummary.totalPumpPowerKw.toFixed(2)} kW`],
    ["Pump Capacity", `${hydraulicSummary.totalPumpCapacityM3Hr.toFixed(1)} m³/hr`],
    ["Pump Status", (hydraulicSummary.pumpCapacityStatus && hydraulicSummary.pumpPowerStatus)
      ? `${hydraulicSummary.pumpCapacityStatus} / ${hydraulicSummary.pumpPowerStatus}`
      : HYD_NOT_CALCULATED],
    ["Electrical Load", `${hydraulicSummary.totalWatts.toFixed(0)} W`],
    ["Air Demand", `${hydraulicSummary.totalAirFlowLpm.toFixed(0)} L/min`],
    ["Fuel Demand", `${hydraulicSummary.totalFuelFlow.toFixed(2)}`],
    ["DMX Channels", `${hydraulicSummary.totalDmxChannels}`],
    ["Digital I/O", `${hydraulicSummary.totalDigitalInputs} IN / ${hydraulicSummary.totalDigitalOutputs} OUT`],
    ["Analog I/O", `${hydraulicSummary.totalAnalogInputs} IN / ${hydraulicSummary.totalAnalogOutputs} OUT`],
    ["Pipe Length", `${((pipework?.totalBranchLengthM || 0) + (pipework?.mainHeaderLengthM || 0)).toFixed(1)} m`],
  ].map(([k,v]) => (
    <div key={k} style={{
      display:"grid",
      gridTemplateColumns:"1fr 1fr",
      gap:4,
      padding:"3px 0",
      borderBottom:"1px solid #0a304044"
    }}>
      <span style={{ color:"#556677", fontSize:8 }}>{k}</span>
      <span style={{ color:"#00ccaa", fontSize:9, fontWeight:"bold", textAlign:"right" }}>{v}</span>
    </div>
  ))}
</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:5, marginBottom:6 }}>
            <button onClick={exportProjectJSON}
              style={{ padding:"5px", background:"#001a16", color:"#00ccaa", border:"1px solid #00aa8844", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
              EXPORT JSON
            </button>
<button
  onClick={exportBOMCSV}
  style={{
    padding:"5px",
    background:"#102000",
    color:"#88ff88",
    border:"1px solid #44aa44",
    borderRadius:3,
    cursor:"pointer",
    fontSize:9,
    fontFamily:"monospace"
  }}
>
  EXPORT BOM
</button>
            <button onClick={exportProjectDXF}
              style={{ padding:"5px", background:"#001530", color:"#00aaff", border:"1px solid #00aaff44", borderRadius:3, cursor:"pointer", fontSize:9, fontFamily:"monospace" }}>
              EXPORT DXF
            </button>
          </div>
          <button onClick={exportProjectDWG} disabled={cadExportBusy} style={{ width:"100%", padding:"8px", marginBottom:6, background:"#003052", color:"#65d8ff", border:"1px solid #00aaff88", borderRadius:3, cursor:cadExportBusy ? "wait" : "pointer", fontSize:10, fontFamily:"monospace" }}>
            {cadExportBusy ? "CREATING DWG…" : "EXPORT AUTOCAD DWG"}
          </button>
          <button onClick={() => setShowCADImport(true)} style={{ width:"100%", padding:"7px", marginBottom:6, background:"#001530", color:"#65d8ff", border:"1px solid #00aaff66", borderRadius:3, cursor:"pointer", fontSize:10, fontFamily:"monospace" }}>
            IMPORT AUTOCAD DWG / DXF
          </button>
          <div style={{ color:"#91adc0", fontSize:9, lineHeight:1.5, marginBottom:7 }}>Native DWG uses your installed AutoCAD 2018+ (ODA File Converter: non-commercial use only). DXF and the AutoLISP export work without a DWG engine.</div>
          {exportStatus && (
            <div style={{ color:"#00ccaa", fontSize:9, marginBottom:5 }}>{exportStatus}</div>
          )}
          {saveStatus && (
            <div role="status" style={{ color:/^(Save|Open) failed/.test(saveStatus)?"#ff8888":"#7fffd4", fontSize:9, marginBottom:5 }}>{saveStatus}</div>
          )}

          <button onClick={saveProject} style={{ width:"100%", padding:"6px", background:"#003520", color:"#00ff88", border:"1px solid #00aa4444", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"monospace" }}>
            {saved ? "✓ SAVED" : "SAVE PROJECT"}
          </button>
        </div>
    </>
  );
}
