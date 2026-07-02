/**
 * PipePropertiesPanel.jsx
 * Sidebar section shown when a pipe is selected in PoolGeometryDesigner.
 * Plug into the existing left panel where fixture properties appear.
 */
import { PIPE_COLORS } from "../../engineering/usePipeDrawing";
import { getSymbolForType, drawSymbol } from "../../engineering/fixtureSymbols";

const PIPE_SIZES_DN = [20, 25, 32, 40, 50, 65, 80, 100, 125, 150];
const PIPE_TYPES = [
  { key:"supply",   label:"Supply",         color: PIPE_COLORS.supply   },
  { key:"return_",  label:"Return/Overflow", color: PIPE_COLORS.return_  },
  { key:"drain",    label:"Drain",           color: PIPE_COLORS.drain    },
  { key:"chemical", label:"Chemical",        color: PIPE_COLORS.chemical },
  { key:"air",      label:"Compressed Air",  color: PIPE_COLORS.air      },
];

export default function PipePropertiesPanel({
  pipe,
  selectedNode,
  selectedSegment,
  onUpdatePipe,
  onUpdateDiameter,
  onUpdateType,
  onDeletePipe,
  onDeleteSegment,
  onInsertNodeAtPoint,
  onRemoveNode,
}) {
  if (!pipe) return null;

  const s = { color:"#7ab", fontSize:8, marginBottom:2 };
  const input = {
    width:"100%", padding:"3px 5px",
    background:"#06121c", color:"#ffcc00",
    border:"1px solid #0a3040", borderRadius:3,
    fontSize:10, fontFamily:"monospace",
  };

  const totalLen = pipe.points.reduce((sum, pt, i) => {
    if (i === 0) return sum;
    return sum + Math.abs(pt.x - pipe.points[i-1].x) + Math.abs(pt.y - pipe.points[i-1].y);
  }, 0);

  const color = PIPE_COLORS[pipe.type] || PIPE_COLORS.supply;

  return (
    <div style={{ padding:"8px 10px", borderBottom:"1px solid #0a2030", background:"#050d14" }}>
      <div style={{ color:"#ffcc00", fontSize:10, marginBottom:4, fontWeight:"bold" }}>
  PIPE PROPERTIES
</div>

<div style={{ color, fontSize:9, marginBottom:8, fontWeight:"bold" }}>
  ═ {pipe.label || `Pipe DN${pipe.diameterMm}`}
</div>

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4, marginBottom:8 }}>
        {[
          ["Length", `${totalLen.toFixed(2)} m`],
          ["Nodes",  `${pipe.points.length}`],
          ["DN",     `${pipe.diameterMm} mm`],
          ["Segments", `${pipe.points.length - 1}`],
        ].map(([k,v]) => (
          <div key={k} style={{ padding:"3px 5px", background:"#0a1520", borderRadius:3 }}>
            <div style={{ fontSize:8, color:"#334455" }}>{k}</div>
            <div style={{ fontSize:10, color, fontWeight:"bold" }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Diameter */}
      <div style={{ marginBottom:6 }}>
        <div style={s}>Pipe Diameter (DN)</div>
        <select value={pipe.diameterMm} onChange={e=>onUpdateDiameter(pipe.id, parseInt(e.target.value))}
          style={{ ...input, color:"#ffcc00" }}>
          {PIPE_SIZES_DN.map(dn => (
            <option key={dn} value={dn}>DN{dn}</option>
          ))}
        </select>
      </div>

      {/* Type */}
      <div style={{ marginBottom:8 }}>
        <div style={s}>Pipe Type</div>
        <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
          {PIPE_TYPES.map(t => (
            <button key={t.key} onClick={()=>onUpdateType(pipe.id, t.key)} style={{
              padding:"3px 6px", textAlign:"left", cursor:"pointer",
              background: pipe.type===t.key ? `${t.color}22` : "#0a1825",
              color: pipe.type===t.key ? t.color : "#556677",
              border:`1px solid ${pipe.type===t.key ? t.color+"55" : "#0a2030"}`,
              borderRadius:3, fontFamily:"monospace", fontSize:9,
            }}>
              <span style={{ color:t.color }}>█ </span>{t.label}
            </button>
          ))}
        </div>
      </div>
{/* Material */}
<div style={{ marginBottom:6 }}>
  <div style={s}>Pipe Material</div>
  <select
    value={pipe.material || "SS304"}
    onChange={e=>onUpdatePipe(pipe.id, { material:e.target.value })}
    style={input}
  >
    <option value="SS304">Stainless Steel SS304</option>
    <option value="SS316">Stainless Steel SS316</option>
    <option value="PVC">PVC</option>
    <option value="HDPE">HDPE</option>
    <option value="GI">Galvanized Steel</option>
  </select>
</div>

{/* Pressure Class */}
<div style={{ marginBottom:8 }}>
  <div style={s}>Pressure Class</div>
  <select
    value={pipe.pressureClass || "PN10"}
    onChange={e=>onUpdatePipe(pipe.id, { pressureClass:e.target.value })}
    style={input}
  >
    <option value="PN6">PN6</option>
    <option value="PN10">PN10</option>
    <option value="PN16">PN16</option>
    <option value="PN25">PN25</option>
  </select>
</div>
{/* Hydraulic Design */}
<div style={{ marginBottom:8, padding:"5px", background:"#06111a", border:"1px solid #0a3040", borderRadius:3 }}>
  <div style={{ color:"#ffcc00", fontSize:9, marginBottom:6, fontWeight:"bold" }}>
    HYDRAULIC DESIGN
  </div>

  <div style={{ marginBottom:6 }}>
    <div style={s}>Design Flow (L/s)</div>
    <input
      type="number"
      min="0"
      step="0.1"
      value={pipe.designFlowLps || 0}
      onChange={e=>onUpdatePipe(pipe.id, { designFlowLps:Number(e.target.value) })}
      style={input}
    />
  </div>

  <div style={{ marginBottom:6 }}>
    <div style={s}>Velocity (m/s)</div>
    <input
      type="number"
      min="0"
      step="0.01"
      value={pipe.velocityMps || 0}
      onChange={e=>onUpdatePipe(pipe.id, { velocityMps:Number(e.target.value) })}
      style={input}
    />
  </div>

  <div>
    <div style={s}>Head Loss (m)</div>
    <input
      type="number"
      min="0"
      step="0.01"
      value={pipe.headLossM || 0}
      onChange={e=>onUpdatePipe(pipe.id, { headLossM:Number(e.target.value) })}
      style={input}
    />
  </div>
</div>
{/* Segment actions */}
{selectedSegment && selectedSegment.pipeId === pipe.id && (
  <div style={{ marginBottom:6, padding:"5px", background:"#120808", border:"1px solid #ff444422", borderRadius:3 }}>
    <div style={{ color:"#ff6666", fontSize:9, marginBottom:4 }}>
      Segment {selectedSegment.segmentIndex + 1} selected
    </div>

    <button
      onClick={() => {
        const a = pipe.points[selectedSegment.segmentIndex];
        const b = pipe.points[selectedSegment.segmentIndex + 1];
        if (!a || !b) return;

        const mid = {
          x: (a.x + b.x) / 2,
          y: (a.y + b.y) / 2
        };

        onInsertNodeAtPoint(mid);
      }}
      style={{
        width:"100%",
        padding:"3px",
        background:"#06121c",
        color:"#00ccaa",
        border:"1px solid #00ccaa44",
        borderRadius:3,
        cursor:"pointer",
        fontSize:9,
        marginBottom:4
      }}
    >
      ＋ Insert node at segment center
    </button>

    <button onClick={onDeleteSegment} style={{
      width:"100%", padding:"3px", background:"#1a0808", color:"#ff8888",
      border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9,
    }}>✕ Delete selected segment</button>
  </div>
)}

      {/* Node actions */}
      {selectedNode && selectedNode.pipeId === pipe.id && (
        <div style={{ marginBottom:6, padding:"5px", background:"#081520", border:"1px solid #0a3040", borderRadius:3 }}>
          <div style={{ color:"#ffcc00", fontSize:9, marginBottom:4 }}>
            Node {selectedNode.nodeIndex + 1} of {pipe.points.length}
          </div>
          <div style={{ color:"#7ab", fontSize:9, marginBottom:4 }}>
            X: {pipe.points[selectedNode.nodeIndex]?.x.toFixed(3)} m
            &nbsp;·&nbsp;
            Y: {pipe.points[selectedNode.nodeIndex]?.y.toFixed(3)} m
          </div>
          {pipe.points.length > 2 && (
            <button onClick={()=>onRemoveNode(pipe.id, selectedNode.nodeIndex)} style={{
              width:"100%", padding:"3px", background:"#1a0808", color:"#ff8888",
              border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9,
            }}>✕ Remove this node</button>
          )}
        </div>
      )}

      {/* Delete */}
      <button onClick={onDeletePipe} style={{
        width:"100%", padding:"4px", background:"#1a0808", color:"#ff4444",
        border:"1px solid #ff444422", borderRadius:3, cursor:"pointer", fontSize:9,
      }}>✕ Delete pipe</button>
    </div>
  );
}
