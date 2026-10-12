import { useEffect, useState } from "react";
const button = { background: "#10253a", color: "#c9e6fa", border: "1px solid #305573", borderRadius: 4, padding: "6px 8px", cursor: "pointer", fontSize: 11 };
const input = { ...button, width: "100%", boxSizing: "border-box", margin: "4px 0 9px" };

export function PatternBlockList({ blocks, selectedId, onSelect, onCreate, onDetails, checkedIds = [], onToggle }) {
  return <div style={{ width: 240, flexShrink: 0, overflowY: "auto", borderRight: "1px solid #294156", background: "#091725", padding: 10 }}>
    <b style={{ color: "#b1dcf9" }}>SHOW PATTERN BLOCKS · {blocks.length}</b>
    <p style={{ color: "#7f9bb3", fontSize: 11 }}>Each block contains its outlet clips. Drag a block to move it; drag its right edge to stretch its dance.</p>
    <button style={button} onClick={onCreate}>+ Create array block</button>
    <button style={{ ...button, marginTop: 5 }} onClick={onDetails}>Show detailed outlet clips</button>
    {onToggle && <p style={{ fontSize: 10, color: "#85b5c5" }}>Tick blocks to build reusable Show Sections.</p>}
    {blocks.map(block => <div key={block.id} style={{ display: "flex", gap: 5, alignItems: "center", marginTop: 9 }}>
      {onToggle && <input type="checkbox" aria-label={`Include block ${block.name} in section`} checked={checkedIds.includes(block.id)} onChange={() => onToggle(block.id)} />}
      <button aria-label={`Select block ${block.name}`} onClick={() => onSelect(block.id)} style={{ ...button,
      width: "100%", minWidth: 0, textAlign: "left", borderColor: checkedIds.includes(block.id) ? "#70ebcc" : block.id === selectedId ? "#39d9f5" : "#29475b" }}>
      <b>{block.name}</b><div style={{ fontSize: 10, marginTop: 4 }}>{block.startTime.toFixed(2)}–{block.endTime.toFixed(2)}s · {block.outletCount} outlets</div>
      <div style={{ fontSize: 10 }}>{block.clipCount} clips{block.customized ? " · individual edits" : ""}</div>
      </button>
    </div>)}
    {!blocks.length && <p style={{ color: "#7f9bb3", fontSize: 11 }}>Choose a movement in Arrays and generate a block. Existing manual clips remain in Detailed clips.</p>}
  </div>;
}

export function PatternBlockLanes({ blocks, zoom, duration, selectedId, onSelect, onChange }) {
  const [drag, setDrag] = useState(null);
  const [ghost, setGhost] = useState(null);
  const begin = (event, block, kind) => {
    if (event.button !== 0) return;
    event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(block.id); setDrag({ id: block.id, kind, x: event.clientX, startTime: block.startTime, duration: block.duration });
    setGhost(null);
  };
  const move = event => {
    if (!drag) return;
    const delta = (event.clientX - drag.x) / zoom;
    const quantum = event.shiftKey ? 0.001 : 0.1;
    const snap = n => Math.round(n / quantum) * quantum;
    setGhost(drag.kind === "move" ? { id: drag.id, startTime: Math.max(0, snap(drag.startTime + delta)) }
      : { id: drag.id, duration: Math.max(0.1, snap(drag.duration + delta)) });
  };
  const finish = event => {
    if (!drag) return;
    event.stopPropagation();
    if (ghost) { const { id, ...changes } = ghost; onChange(id, changes); }
    setDrag(null); setGhost(null);
  };
  return <div aria-label="Pattern block timeline" style={{ minWidth: Math.max(1, duration * zoom), minHeight: 70 }}>
    {!blocks.length && <div style={{ padding: 15, color: "#769bb8", fontSize: 11 }}>Create an array to add the first pattern block.</div>}
    {blocks.map(block => {
      const current = ghost?.id === block.id ? { ...block, ...ghost } : block;
      return <div key={block.id} style={{ height: 64, position: "relative", borderBottom: "1px solid #22364a" }}>
        <div role="button" tabIndex={0} aria-label={`Pattern block ${block.name}`} aria-pressed={selectedId === block.id}
          data-pattern-block-id={block.id}
          onClick={e => { e.stopPropagation(); onSelect(block.id); }}
          onKeyDown={e => { if (e.key === "Enter") { e.stopPropagation(); onSelect(block.id); } }}
          onPointerDown={e => begin(e, block, "move")} onPointerMove={move} onPointerUp={finish}
          onPointerCancel={() => { setDrag(null); setGhost(null); }}
          title={`${block.name}: ${current.startTime.toFixed(2)}s, ${current.duration.toFixed(2)}s · ${block.outletCount} outlets. Drag to move; right edge to stretch.`}
          style={{ position: "absolute", left: current.startTime * zoom, top: 7, width: Math.max(14, current.duration * zoom), height: 48,
            boxSizing: "border-box", borderRadius: 6, background: "linear-gradient(135deg,#13496b,#285197)",
            border: `2px solid ${selectedId === block.id ? "#6be9ff" : "#397baa"}`, color: "#d5f5ff", cursor: "grab", touchAction: "none", overflow: "hidden", padding: "5px 12px 5px 6px" }}>
          <b style={{ display: "block", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{block.name}</b>
          <div style={{ fontSize: 9, whiteSpace: "nowrap" }}>{current.startTime.toFixed(1)}s · {current.duration.toFixed(1)}s · {block.outletCount} outlets / {block.clipCount} clips</div>
          <div aria-label={`Resize block ${block.name}`} role="slider" tabIndex={0} aria-valuemin={0.1} aria-valuenow={current.duration} aria-valuemax={600}
            onKeyDown={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); onChange(block.id, { duration: Math.max(0.1, block.duration + (e.key === "ArrowRight" ? 0.1 : -0.1)) }); } }}
            onPointerDown={e => begin(e, block, "resize")} onPointerMove={move} onPointerUp={finish}
            style={{ position: "absolute", right: 0, top: 0, width: 10, height: "100%", background: "#71dbff55", cursor: "ew-resize", touchAction: "none" }} />
        </div>
      </div>;
    })}
  </div>;
}

export function PatternBlockInspector({ block, currentTime, bpm, onChange, onRepeat, onDuplicate, onDelete, onUnpack, onEditMovement, onDetails }) {
  const [name, setName] = useState(""), [start, setStart] = useState(0), [duration, setDuration] = useState(1), [cycles, setCycles] = useState(1);
  useEffect(() => {
    if (!block) return;
    setName(block.name); setStart(block.startTime); setDuration(block.duration); setCycles(block.recipe?.repeats || 1);
  }, [block?.id, block?.name, block?.startTime, block?.duration, block?.recipe?.repeats]);
  if (!block) return <div style={{ padding: 14, color: "#7f9bb3", fontSize: 11 }}>Select a block on the timeline or create one in Arrays.</div>;
  const beat = 60 / Math.max(1, Number(bpm));
  return <div style={{ padding: 12, overflowY: "auto", color: "#b5d5ef", fontSize: 11 }}>
    <b style={{ fontSize: 13 }}>Edit whole pattern block</b>
    <p>{block.outletCount} outlets · {block.clipCount} clips. These controls move or stretch every member together.</p>
    <label>Block name<input aria-label="Block name" style={input} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Start time (seconds)<input aria-label="Block start" type="number" min={0} step={0.1} style={input} value={start} onChange={e => setStart(e.target.value)} /></label>
    <label>Total duration (seconds)<input aria-label="Block duration" type="number" min={0.1} step={0.1} style={input} value={duration} onChange={e => setDuration(e.target.value)} /></label>
    <button style={{ ...button, width: "100%" }} onClick={() => onChange(block.id, { name, startTime: start, duration })}>Apply block timing / name</button>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, margin: "9px 0" }}>
      <button style={button} onClick={() => onChange(block.id, { startTime: currentTime })}>Move to playhead</button>
      <button style={button} onClick={() => onChange(block.id, { startTime: Math.round(block.startTime / beat) * beat })}>Snap start to beat</button>
      <button style={button} onClick={() => onChange(block.id, { startTime: Math.max(0, block.startTime - 0.1) })}>−0.1s</button>
      <button style={button} onClick={() => onChange(block.id, { startTime: block.startTime + 0.1 })}>+0.1s</button>
    </div>
    <div style={{ color: "#809bb4", marginBottom: 9 }}>Stretch changes pulse lengths, stage delays and gaps proportionally. Exact site preview checks the 100 ms valve-state minimum.</div>
    <label>Array cycles<input aria-label="Block cycles" type="number" min={1} max={100} step={1} disabled={!block.recipe || block.customized} style={input} value={cycles} onChange={e => setCycles(e.target.value)} /></label>
    <button style={{ ...button, width: "100%" }} disabled={!block.recipe || block.customized} onClick={() => onRepeat(block.id, cycles)}>Apply cycles</button>
    {(!block.recipe || block.customized) && <p style={{ color: "#f8d28a" }}>This block contains existing or individually edited clips. Duplicate preserves them. Updating its movement explicitly regenerates its outlet clips.</p>}
    <button style={{ ...button, width: "100%", marginTop: 9, color: "#bdaeff" }} onClick={() => onEditMovement(block)}>Edit movement and outlets</button>
    <button style={{ ...button, width: "100%", marginTop: 6 }} onClick={() => onDuplicate(block.id)}>Duplicate after this block</button>
    <button style={{ ...button, width: "100%", marginTop: 6 }} onClick={onDetails}>Edit individual outlet clips</button>
    <button style={{ ...button, width: "100%", marginTop: 6 }} onClick={() => onUnpack(block.id)}>Ungroup into independent clips</button>
    <button style={{ ...button, width: "100%", marginTop: 12, color: "#ffb4bd" }} onClick={() => onDelete(block.id)}>Delete whole block</button>
  </div>;
}
