import { useState, useRef, useCallback, useEffect } from "react";
import { useShowStore } from "../../store/showStore";

const NODE_COLORS = {
  pump:      { border: "#00d4ff", bg: "rgba(0,212,255,0.06)",  label: "#00d4ff" },
  valve:     { border: "#8b5cf6", bg: "rgba(139,92,246,0.06)", label: "#8b5cf6" },
  lighting:  { border: "#f59e0b", bg: "rgba(245,158,11,0.06)", label: "#f59e0b" },
  flame:     { border: "#ef4444", bg: "rgba(239,68,68,0.06)",  label: "#ef4444" },
  fog:       { border: "#6b7280", bg: "rgba(107,114,128,0.06)",label: "#9ca3af" },
  sequencer: { border: "#10b981", bg: "rgba(16,185,129,0.06)", label: "#10b981" },
  audio:     { border: "#a78bfa", bg: "rgba(167,139,250,0.06)",label: "#a78bfa" },
  laser:     { border: "#f97316", bg: "rgba(249,115,22,0.06)", label: "#f97316" },
  sensor:    { border: "#06b6d4", bg: "rgba(6,182,212,0.06)",  label: "#06b6d4" },
};

const NODE_ICONS = {
  pump: "〰", valve: "⊠", lighting: "✦", flame: "🔥",
  fog: "≈", sequencer: "⊞", audio: "♫", laser: "✸", sensor: "◉",
};

const DEFAULT_VIEW = { x: 60, y: 40, scale: 1 };

export default function NodeEditor() {
  const {
    nodes,
    connections,
    selectedNodeId,
    selectNode,
    moveNode,
    addNode,
    removeNode,
    duplicateNode,
    addConnection,
    beginHistoryTransaction,
    commitHistoryTransaction,
    cancelHistoryTransaction,
    showGrid,
    addServerLog,
  } = useShowStore();
  const [view, setView] = useState(DEFAULT_VIEW);
  const [dragging, setDragging] = useState(null);
  const [panning, setPanning] = useState(false);
  const [panStart, setPanStart] = useState(null);
  const [pendingConn, setPendingConn] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [toolMode, setToolMode] = useState("select");
  const svgRef = useRef(null);
  const dragMovedRef = useRef(false);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setView((v) => {
      const scale = Math.max(0.2, Math.min(2.5, v.scale * delta));
      return {
        x: mx - (mx - v.x) * (scale / v.scale),
        y: my - (my - v.y) * (scale / v.scale),
        scale,
      };
    });
  }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onWheel]);

  const getViewportCenterWorld = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 260, y: 180 };
    return {
      x: (rect.width / 2 - view.x) / view.scale - 90,
      y: (rect.height / 2 - view.y) / view.scale - 40,
    };
  }, [view]);

  const addNodeAtCenter = useCallback((type = "pump") => {
    const pos = getViewportCenterWorld();
    addNode(type, pos.x, pos.y);
    setToolMode("select");
  }, [addNode, getViewportCenterWorld]);

  const frameNodes = useCallback(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !nodes.length) {
      setView(DEFAULT_VIEW);
      return;
    }
    const targets = selectedNodeId
      ? nodes.filter((node) => node.id === selectedNodeId)
      : nodes;
    const minX = Math.min(...targets.map((node) => node.x));
    const minY = Math.min(...targets.map((node) => node.y));
    const maxX = Math.max(...targets.map((node) => node.x + node.width));
    const maxY = Math.max(...targets.map((node) => node.y + node.height));
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const scale = Math.max(0.2, Math.min(2.5, Math.min((rect.width - 120) / contentWidth, (rect.height - 120) / contentHeight)));
    setView({
      scale,
      x: rect.width / 2 - ((minX + maxX) / 2) * scale,
      y: rect.height / 2 - ((minY + maxY) / 2) * scale,
    });
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      if (target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      if (event.defaultPrevented) return;

      if ((event.key === "Delete" || event.key === "Backspace") && selectedNodeId) {
        event.preventDefault();
        removeNode(selectedNodeId);
        addServerLog({ level: "warn", msg: "Selected node deleted" });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selectedNodeId) {
        event.preventDefault();
        duplicateNode(selectedNodeId);
        addServerLog({ level: "info", msg: "Selected node duplicated" });
        return;
      }
      if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        frameNodes();
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setView(DEFAULT_VIEW);
        return;
      }
      if (event.key === "Escape") {
        setToolMode("select");
        setPendingConn(null);
        setContextMenu(null);
        selectNode(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const onEditCommand = (event) => {
      if (event.detail?.command === "delete" && selectedNodeId) {
        removeNode(selectedNodeId);
        addServerLog({ level: "warn", msg: "Selected node deleted" });
        event.detail.handled = true;
      }
      if (event.detail?.command === "deselect") { selectNode(null); event.detail.handled = true; }
    };
    window.addEventListener("aquaflow:edit-command", onEditCommand);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("aquaflow:edit-command", onEditCommand);
    };
  }, [addServerLog, duplicateNode, frameNodes, removeNode, selectNode, selectedNodeId]);

  useEffect(() => {
    const onAddNode = () => addNodeAtCenter("pump");
    const onResetView = () => {
      setView(DEFAULT_VIEW);
      setToolMode("select");
      setPendingConn(null);
      setContextMenu(null);
      addServerLog({ level: "info", msg: "Node editor view reset" });
    };
    window.addEventListener("aquaflow:add-node-request", onAddNode);
    window.addEventListener("aquaflow:reset-node-editor", onResetView);
    return () => {
      window.removeEventListener("aquaflow:add-node-request", onAddNode);
      window.removeEventListener("aquaflow:reset-node-editor", onResetView);
    };
  }, [addNodeAtCenter, addServerLog]);

  const toWorld = (ex, ey) => {
    const rect = svgRef.current.getBoundingClientRect();
    return {
      x: (ex - rect.left - view.x) / view.scale,
      y: (ey - rect.top  - view.y) / view.scale,
    };
  };

  const onMouseDown = (e) => {
    const shouldPan = e.button === 1 || toolMode === "pan" || (e.button === 0 && e.altKey);
    if (shouldPan) {
      setPanning(true);
      setPanStart({ x: e.clientX - view.x, y: e.clientY - view.y });
      e.preventDefault();
    }
    if (e.target === svgRef.current || e.target.classList.contains("canvas-bg")) {
      selectNode(null);
      setContextMenu(null);
      if (toolMode !== "connect") setPendingConn(null);
    }
  };

  const onMouseMove = (e) => {
    if (panning && panStart) {
      setView((v) => ({ ...v, x: e.clientX - panStart.x, y: e.clientY - panStart.y }));
    }
    if (dragging) {
      const w = toWorld(e.clientX, e.clientY);
      dragMovedRef.current = true;
      moveNode(dragging.nodeId, w.x - dragging.offX, w.y - dragging.offY, { captureHistory: false });
    }
  };

  const onMouseUp = () => {
    if (dragging) {
      if (dragMovedRef.current) {
        commitHistoryTransaction();
        addServerLog({ level: "info", msg: "Node moved" });
      } else {
        cancelHistoryTransaction();
      }
    }
    dragMovedRef.current = false;
    setPanning(false);
    setPanStart(null);
    setDragging(null);
  };

  const startDrag = (e, nodeId) => {
    if (toolMode !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    const node = nodes.find((n) => n.id === nodeId);
    dragMovedRef.current = false;
    beginHistoryTransaction();
    setDragging({ nodeId, offX: w.x - node.x, offY: w.y - node.y });
    selectNode(nodeId);
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    setContextMenu({ x: e.clientX, y: e.clientY, wx: w.x, wy: w.y });
  };

  const startConnection = (e, nodeId, fromPort) => {
    if (toolMode !== "connect") return;
    e.stopPropagation();
    setPendingConn({ from: nodeId, fromPort });
    selectNode(nodeId);
    addServerLog({ level: "info", msg: `Connection source selected: ${fromPort}` });
  };

  const finishConnection = (e, nodeId, toPort) => {
    if (toolMode !== "connect") return;
    e.stopPropagation();
    if (!pendingConn) return;
    if (pendingConn.from === nodeId) {
      setPendingConn(null);
      return;
    }
    addConnection(pendingConn.from, pendingConn.fromPort, nodeId, toPort);
    addServerLog({ level: "info", msg: `Connected ${pendingConn.fromPort} → ${toPort}` });
    setPendingConn(null);
    selectNode(nodeId);
  };

  const connPath = (from, fromPort, to, toPort) => {
    const fn = nodes.find((n) => n.id === from);
    const tn = nodes.find((n) => n.id === to);
    if (!fn || !tn) return null;
    const fi = fn.ports.out.indexOf(fromPort);
    const ti = tn.ports.in.indexOf(toPort);
    const x1 = fn.x + fn.width;
    const y1 = fn.y + 28 + fi * 16;
    const x2 = tn.x;
    const y2 = tn.y + 28 + ti * 16;
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  };

  const NODE_TYPES = Object.keys(NODE_COLORS);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative", overflow: "hidden", userSelect: "none" }}>
      <svg
        ref={svgRef}
        width="100%" height="100%"
        style={{ cursor: panning ? "grabbing" : toolMode === "pan" ? "grab" : "default" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onContextMenu={onContextMenu}
      >
        <defs>
          <pattern id="grid-dots" width="20" height="20" patternUnits="userSpaceOnUse"
            patternTransform={`translate(${view.x % (20 * view.scale)},${view.y % (20 * view.scale)}) scale(${view.scale})`}>
            <circle cx="0" cy="0" r="0.5" fill="rgba(255,255,255,0.08)" />
          </pattern>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M1 1L9 5L1 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {showGrid && <rect className="canvas-bg" width="100%" height="100%" fill="url(#grid-dots)" />}

        <g transform={`translate(${view.x},${view.y}) scale(${view.scale})`}>
          {connections.map((conn) => {
            const d = connPath(conn.from, conn.fromPort, conn.to, conn.toPort);
            if (!d) return null;
            return (
              <g key={conn.id}>
                <path d={d} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                <path d={d} fill="none" stroke="#00d4ff" strokeWidth="1.5"
                  strokeDasharray="4 3" opacity="0.5" markerEnd="url(#arr)" />
              </g>
            );
          })}

          {nodes.map((node) => {
            const colors = NODE_COLORS[node.type] || NODE_COLORS.sensor;
            const isSelected = selectedNodeId === node.id;
            return (
              <g key={node.id} transform={`translate(${node.x},${node.y})`}
                onMouseDown={(e) => startDrag(e, node.id)}
                onClick={() => selectNode(node.id)}
                style={{ cursor: toolMode === "select" ? "grab" : "default" }}>

                {isSelected && (
                  <rect x={-3} y={-3} width={node.width + 6} height={node.height + 6}
                    rx={10} fill="none" stroke={colors.border} strokeWidth="1.5"
                    opacity="0.6" filter="url(#glow)" />
                )}

                <rect x={0} y={0} width={node.width} height={node.height}
                  rx={7} fill={colors.bg}
                  stroke={isSelected ? colors.border : "rgba(255,255,255,0.10)"}
                  strokeWidth={isSelected ? "1.5" : "0.5"} />

                <rect x={0} y={0} width={node.width} height={24} rx={7} fill={colors.bg}
                  style={{ clipPath: "inset(0 0 -10px 0)" }} />
                <rect x={0} y={17} width={node.width} height={7} fill={colors.bg} />
                <rect x={0} y={0} width={node.width} height={2} rx={1} fill={colors.border} opacity="0.8" />

                <text x={10} y={15} fontSize={11} fontFamily="var(--font-body)" fill={colors.label} fontWeight={500}>
                  {NODE_ICONS[node.type] || "◈"} {node.label}
                </text>

                {node.protocol && (
                  <text x={node.width - 6} y={15} fontSize={9} fontFamily="var(--font-mono)"
                    fill={colors.label} textAnchor="end" opacity="0.7">
                    {node.protocol.toUpperCase()}
                  </text>
                )}

                <circle cx={node.width - 8} cy={node.height - 10}
                  r={3} fill={node.status === "online" ? "#10b981" : node.status === "ready" ? "#f59e0b" : "#ef4444"}
                  style={{ filter: "drop-shadow(0 0 3px currentColor)" }} />

                {node.ports.in.map((port, i) => (
                  <g key={port} transform={`translate(-6, ${28 + i * 16})`} onClick={(e) => finishConnection(e, node.id, port)}>
                    <circle cx={6} cy={0} r={4} fill="var(--bg-base)"
                      stroke={pendingConn ? "#10b981" : "#00d4ff"} strokeWidth="1" style={{ cursor: toolMode === "connect" ? "crosshair" : "default" }} />
                    <text x={14} y={4} fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-muted)">{port}</text>
                  </g>
                ))}

                {node.ports.out.map((port, i) => (
                  <g key={port} transform={`translate(${node.width - 6}, ${28 + i * 16})`} onClick={(e) => startConnection(e, node.id, port)}>
                    <circle cx={6} cy={0} r={4} fill="var(--bg-base)"
                      stroke={pendingConn?.from === node.id && pendingConn?.fromPort === port ? "#10b981" : "#8b5cf6"} strokeWidth="1" style={{ cursor: toolMode === "connect" ? "crosshair" : "default" }} />
                    <text x={-2} y={4} fontSize={9} fontFamily="var(--font-mono)" fill="var(--text-muted)" textAnchor="end">{port}</text>
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      </svg>

      <div style={{
        position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
        display: "flex", gap: 4,
        background: "var(--bg-raised)", border: "1px solid var(--border-mid)",
        borderRadius: "var(--radius-lg)", padding: 4,
      }}>
        {[ ["select", "Select"], ["connect", "Connect"], ["pan", "Pan"] ].map(([key, label]) => (
          <button
            key={key}
            className="btn"
            style={{
              padding: "3px 10px",
              fontSize: 11,
              background: toolMode === key ? "rgba(0,212,255,0.12)" : "transparent",
              borderColor: toolMode === key ? "var(--border-accent)" : "transparent",
              color: toolMode === key ? "var(--text-accent)" : "var(--text-secondary)",
            }}
            onClick={() => {
              setToolMode(key);
              if (key !== "connect") setPendingConn(null);
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ width: 1, background: "var(--border)", margin: "0 4px" }} />
        <button className="btn primary" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => addNodeAtCenter("pump")}>+ Add Node</button>
      </div>

      <div style={{
        position: "absolute", top: 52, left: 12,
        background: "var(--bg-raised)", border: "1px solid var(--border)",
        padding: "5px 8px", borderRadius: "var(--radius-sm)",
        fontSize: 10, color: pendingConn ? "var(--green)" : "var(--text-muted)",
        fontFamily: "var(--font-mono)",
      }}>
        {pendingConn ? `CONNECT: ${pendingConn.fromPort} → select an input port` : `MODE: ${toolMode.toUpperCase()}`}
      </div>

      <div style={{
        position: "absolute", bottom: 12, right: 12,
        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)",
        background: "var(--bg-raised)", border: "1px solid var(--border)",
        padding: "4px 8px", borderRadius: "var(--radius-sm)",
      }}>
        {Math.round(view.scale * 100)}% · F frame · Home reset · Del delete · Ctrl+D duplicate
      </div>

      <div style={{
        position: "absolute", bottom: 12, left: 12,
        display: "flex", gap: 8, flexWrap: "wrap",
        background: "var(--bg-raised)", border: "1px solid var(--border)",
        padding: "6px 10px", borderRadius: "var(--radius-md)",
        maxWidth: 260,
      }}>
        {Object.entries(NODE_COLORS).slice(0, 5).map(([type, c]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.border }} />
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase" }}>{type}</span>
          </div>
        ))}
      </div>

      {contextMenu && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 90 }} onClick={() => setContextMenu(null)} />
          <div style={{
            position: "fixed", left: contextMenu.x, top: contextMenu.y,
            background: "var(--bg-raised)", border: "1px solid var(--border-mid)",
            borderRadius: "var(--radius-md)", zIndex: 200,
            padding: "4px 0", minWidth: 180,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div style={{ padding: "4px 12px 6px", fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}>
              ADD NODE
            </div>
            {NODE_TYPES.map((t) => {
              const c = NODE_COLORS[t];
              return (
                <button key={t}
                  onClick={() => { addNode(t, contextMenu.wx, contextMenu.wy); setContextMenu(null); setToolMode("select"); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    width: "100%", textAlign: "left", padding: "6px 12px",
                    background: "transparent", border: "none",
                    color: "var(--text-primary)", fontSize: 12, cursor: "pointer",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.border, flexShrink: 0 }} />
                  <span style={{ textTransform: "capitalize" }}>{t}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {NODE_ICONS[t]}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
