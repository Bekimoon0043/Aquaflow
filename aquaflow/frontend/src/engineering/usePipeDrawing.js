/**
 * usePipeDrawing.js — Professional Pipe Drawing Hook
 *
 * Handles all manual pipe drawing state and logic.
 * Drop-in for PoolGeometryDesigner.
 *
 * Features:
 * - Polyline pipe drawing with live mouse preview
 * - Snap to fixtures and grid
 * - Orthogonal mode (horizontal/vertical only) or free-angle
 * - Pipe editing: select, move nodes, delete segments, split
 * - Pipe properties: diameter, label, color
 * - Elbow curves at bends (visual approximation)
 * - Export to BOM
 */

import { useState, useCallback, useRef, useEffect } from "react";
import useEngineeringStore from "../store/engineeringStore";

export const PIPE_COLORS = {
  supply:  "#8b5cf6",   // purple — supply from pump
  return_: "#06b6d4",   // cyan   — return/overflow
  drain:   "#f59e0b",   // amber  — drain
  chemical:"#10b981",   // green  — chemical dosing
  air:     "#f87171",   // red    — compressed air
};



export function usePipeDrawing({ zoom, pan, snapToGrid, gridStep, fixtures }) {
const [pipePreview, setPipePreview] = useState(null);
  // All placed manual pipes
  // Pipes now come from engineeringStore (project-scoped, not global localStorage)
const storePipes = useEngineeringStore(s => s.pipes) || [];
const updateEngineering = useEngineeringStore(s => s.updateEngineering);
const [pipes, setPipesState] = useState(storePipes);

// Sync from store on mount / external changes
useEffect(() => {
  setPipesState(storePipes);
}, [storePipes]);

// Wrapper that updates both local state and engineeringStore
const setPipes = useCallback((updater) => {
  setPipesState(prev => {
    const next = typeof updater === 'function' ? updater(prev) : updater;
    // Write to engineering store for persistence
    requestAnimationFrame(() => {
      updateEngineering({ pipes: next });
    });
    return next;
  });
}, [updateEngineering]);
  // Currently drawing pipe (polyline in progress)
  const [drawing, setDrawing] = useState(null); // { points:[{x,y},...], diameterMm, type }
  // Selected pipe id
  const [selectedPipeId, setSelectedPipeId] = useState(null);
  // Selected node: { pipeId, nodeIndex }
  const [selectedNode, setSelectedNode] = useState(null);
// Selected segment: { pipeId, segmentIndex }
const [selectedSegment, setSelectedSegment] = useState(null);
  // Pipe tool settings
  const [pipeDiameter, setPipeDiameter] = useState(50);
  const [pipeType, setPipeType] = useState("supply");
const [pipeDrawMode, setPipeDrawMode] = useState("polyline");
  const [orthogonalMode, setOrthogonalMode] = useState(true);
  // Live mouse position for preview
  const [mouseWorld, setMouseWorld] = useState(null);

  // ── Snap helpers ────────────────────────────────────────────────────────────
  const snapPt = useCallback((pt) => {
    // Snap to fixture center first
    if (fixtures?.length) {
      const threshold = Math.max(0.25, 10 / zoom);
      for (const f of fixtures) {
        const dx = pt.x - Number(f.x||0);
        const dy = pt.y - Number(f.y||0);
        if (Math.sqrt(dx*dx+dy*dy) < threshold) return { x: Number(f.x||0), y: Number(f.y||0), snapped: "fixture" };
      }
    }
    // Grid snap
    if (snapToGrid && gridStep) {
      const s = gridStep;
      return { x: Math.round(pt.x/s)*s, y: Math.round(pt.y/s)*s, snapped: "grid" };
    }
    return pt;
  }, [zoom, fixtures, snapToGrid, gridStep]);

  // Constrain to orthogonal from last point
  const orthogonalPt = useCallback((pt, from) => {
    if (!orthogonalMode || !from) return pt;
    const dx = Math.abs(pt.x - from.x);
    const dy = Math.abs(pt.y - from.y);
    if (dx >= dy) return { ...pt, y: from.y }; // horizontal
    return { ...pt, x: from.x };               // vertical
  }, [orthogonalMode]);

  // ── Mouse handlers (call these from canvas events) ──────────────────────────

const onPipeMouseMove = useCallback((worldPt) => {
  let pt = snapPt(worldPt);

  if (drawing && drawing.points.length > 0) {

    if (
      drawing.drawMode !== "curve" &&
      drawing.drawMode !== "arc"
    ) {
      pt = orthogonalPt(
        pt,
        drawing.points[drawing.points.length - 1]
      );
    }

    setPipePreview({
      id: "pipe_preview",
      type: "pipe_preview",
      points: [...drawing.points, pt],
      diameterMm: drawing.diameterMm || pipeDiameter,
      pipeType: drawing.type || pipeType,
      label: `Preview DN${drawing.diameterMm || pipeDiameter}`,
      layer: "pipework"
    });

  } else {
    setPipePreview(null);
  }

  setMouseWorld(pt);

}, [drawing, pipeDiameter, pipeType, snapPt, orthogonalPt]);
  
   
  const onPipeClick = useCallback((worldPt) => {
  let pt = snapPt(worldPt);

  if (
  drawing &&
  drawing.points.length > 0 &&
  pipeDrawMode !== "curve" &&
  pipeDrawMode !== "arc"
) {
  pt = orthogonalPt(pt, drawing.points[drawing.points.length - 1]);
}

  // START NEW PIPE
  if (!drawing) {
    setDrawing({
      points: [pt],
      diameterMm: pipeDiameter,
      type: pipeType,
      drawMode: pipeDrawMode,
    });
    return;
  }

  // STRAIGHT MODE: second click finishes pipe immediately
  if (pipeDrawMode === "straight") {
    const newPipe = {
      id: Date.now(),
      type: "manual_pipe",
      points: [...drawing.points, pt],
      diameterMm: drawing.diameterMm,
      dn: drawing.diameterMm,
      pipeType: drawing.type,
      drawMode: "straight",
      material: "SS304",
      pressureClass: "PN10",
      label: `Pipe DN${drawing.diameterMm}`,
      layer: "pipework",
      flowDirection: "forward",
    };

    setPipes(prev => [...prev, newPipe]);
    setSelectedPipeId(newPipe.id);
    setDrawing(null);
    setPipePreview(null);
    setMouseWorld(null);
    return;
  }

  // POLYLINE MODE: keep adding points until double-click
  if (pipeDrawMode === "polyline") {
    setDrawing(prev => ({
      ...prev,
      points: [...prev.points, pt],
    }));
    return;
  }

  // CURVE MODE: for now, collect 3 points; curve rendering comes next
  if (pipeDrawMode === "curve" || pipeDrawMode === "arc") {
    const nextPoints = [...drawing.points, pt];

    if (nextPoints.length >= 3) {
      const newPipe = {
        id: Date.now(),
        type: "manual_pipe",
        points: nextPoints,
        diameterMm: drawing.diameterMm,
        dn: drawing.diameterMm,
        pipeType: drawing.type,
        drawMode: pipeDrawMode,
        material: "SS304",
        pressureClass: "PN10",
        label: `${pipeDrawMode === "arc" ? "Arc" : "Curve"} Pipe DN${drawing.diameterMm}`,
layer: "pipework",
flowDirection: "forward",
      };

      setPipes(prev => [...prev, newPipe]);
      setSelectedPipeId(newPipe.id);
      setDrawing(null);
      setPipePreview(null);
      setMouseWorld(null);
    } else {
      setDrawing(prev => ({
        ...prev,
        points: nextPoints,
      }));
    }

    return;
  }
}, [drawing, pipeDiameter, pipeType, pipeDrawMode, snapPt, orthogonalPt]);

    const onPipeDoubleClick = useCallback((worldPt) => {
  if (drawing && drawing.points.length >= 2) {
    const newPipe = {
      id: Date.now(),
      type: "manual_pipe",
      points: drawing.points,
      diameterMm: drawing.diameterMm,
      dn: drawing.diameterMm,
      pipeType: drawing.type,
      material: "SS304",
      pressureClass: "PN10",
      label: `Pipe DN${drawing.diameterMm}`,
layer: "pipework",
flowDirection: "forward",
    };

    setPipes(prev => [...prev, newPipe]);
    setSelectedPipeId(newPipe.id);
  }

  setDrawing(null);
  setPipePreview(null);
  setMouseWorld(null);
}, [drawing]);

  const cancelDrawing = useCallback(() => {
  setDrawing(null);
  setPipePreview(null);
  setMouseWorld(null);
}, []);

  // ── Selection ────────────────────────────────────────────────────────────────
  const selectPipeAtPoint = useCallback((worldPt) => {
    const threshold = Math.max(0.3, 8 / zoom);
    for (const pipe of pipes) {
      const pts = pipe.points;
      for (let i = 1; i < pts.length; i++) {
        const x1=pts[i-1].x, y1=pts[i-1].y, x2=pts[i].x, y2=pts[i].y;
        const A=worldPt.x-x1, B=worldPt.y-y1;
        const C=x2-x1, D=y2-y1;
        const lenSq = C*C+D*D;
        if (lenSq < 0.0001) continue;
        const t = Math.max(0,Math.min(1,(A*C+B*D)/lenSq));
        const dx = worldPt.x-(x1+t*C);
        const dy = worldPt.y-(y1+t*D);
        if (Math.sqrt(dx*dx+dy*dy) < threshold) {
  setSelectedPipeId(pipe.id);
  setSelectedNode(null);
  setSelectedSegment({
    pipeId: pipe.id,
    segmentIndex: i - 1
  });
  return pipe.id;
}
      }
    }
    setSelectedPipeId(null);
setSelectedNode(null);
setSelectedSegment(null);
return null;
  }, [pipes, zoom]);

  const selectNodeAtPoint = useCallback((worldPt) => {
    const threshold = Math.max(0.2, 7 / zoom);
    for (const pipe of pipes) {
      for (let i = 0; i < pipe.points.length; i++) {
        const p = pipe.points[i];
        const d = Math.sqrt((worldPt.x-p.x)**2 + (worldPt.y-p.y)**2);
        if (d < threshold) {
  setSelectedNode({ pipeId: pipe.id, nodeIndex: i });
  setSelectedPipeId(pipe.id);
  setSelectedSegment(null);
  return { pipeId: pipe.id, nodeIndex: i };
}
      }
    }
    return null;
  }, [pipes, zoom]);

  // ── Node editing ──────────────────────────────────────────────────────────────
  const moveNode = useCallback((pipeId, nodeIndex, newPt) => {
    let pt = snapPt(newPt);
    setPipes(prev => prev.map(p => {
      if (p.id !== pipeId) return p;
      const newPoints = [...p.points];
      newPoints[nodeIndex] = pt;
      return { ...p, points: newPoints };
    }));
  }, [snapPt]);

  const deleteSelectedPipe = useCallback(() => {
    if (selectedPipeId) {
      setPipes(prev => prev.filter(p => p.id !== selectedPipeId));
      setSelectedPipeId(null);
      setSelectedNode(null);
    }
  }, [selectedPipeId]);
const deleteSelectedSegment = useCallback(() => {
  if (!selectedSegment) return;

  setPipes(prev => prev.map(pipe => {
    if (pipe.id !== selectedSegment.pipeId) return pipe;

    const startIndex = selectedSegment.segmentIndex;
    const endIndex = selectedSegment.segmentIndex + 1;

    // If pipe has only 2 points, deleting the segment deletes the whole pipe
    if (pipe.points.length <= 2) {
      return null;
    }

    const newPoints = pipe.points.filter((_, index) => {
      return index !== endIndex;
    });

    return {
      ...pipe,
      points: newPoints
    };
  }).filter(Boolean));

  setSelectedSegment(null);
  setSelectedNode(null);
}, [selectedSegment]);

  const updatePipeDiameter = useCallback((pipeId, dn) => {
    setPipes(prev => prev.map(p => p.id === pipeId ? { ...p, diameterMm: dn, label: `Pipe DN${dn}` } : p));
  }, []);

  const updatePipeType = useCallback((pipeId, type) => {
    setPipes(prev => prev.map(p => p.id === pipeId ? { ...p, type } : p));
  }, []);
const updatePipeProperties = useCallback((pipeId, updates) => {
  setPipes(prev => prev.map(pipe => {
    if (pipe.id !== pipeId) return pipe;

    const updatedPipe = {
      ...pipe,
      ...updates
    };

    if (updates.diameterMm) {
      updatedPipe.dn = updates.diameterMm;
      updatedPipe.label = `Pipe DN${updates.diameterMm}`;
    }

    return updatedPipe;
  }));
}, []);

  // Insert intermediate node on segment
  const insertNode = useCallback((pipeId, segmentIndex, pt) => {
    setPipes(prev => prev.map(p => {
      if (p.id !== pipeId) return p;
      const newPoints = [...p.points];
      newPoints.splice(segmentIndex + 1, 0, snapPt(pt));
      return { ...p, points: newPoints };
    }));
  }, [snapPt]);
const insertNodeAtPoint = useCallback((worldPt) => {
  const threshold = Math.max(0.3, 8 / zoom);

  for (const pipe of pipes) {
    const pts = pipe.points;

    for (let i = 1; i < pts.length; i++) {
      const x1 = pts[i - 1].x;
      const y1 = pts[i - 1].y;
      const x2 = pts[i].x;
      const y2 = pts[i].y;

      const A = worldPt.x - x1;
      const B = worldPt.y - y1;
      const C = x2 - x1;
      const D = y2 - y1;

      const lenSq = C * C + D * D;
      if (lenSq < 0.0001) continue;

      const t = Math.max(0, Math.min(1, (A * C + B * D) / lenSq));
      const insertPt = {
        x: x1 + t * C,
        y: y1 + t * D
      };

      const dx = worldPt.x - insertPt.x;
      const dy = worldPt.y - insertPt.y;

      if (Math.sqrt(dx * dx + dy * dy) < threshold) {
        insertNode(pipe.id, i - 1, insertPt);
        setSelectedPipeId(pipe.id);
        setSelectedNode({ pipeId: pipe.id, nodeIndex: i });
        return true;
      }
    }
  }

  return false;
}, [pipes, zoom, insertNode]);

  // Remove a node (minimum 2 nodes required)
  const removeNode = useCallback((pipeId, nodeIndex) => {
    setPipes(prev => prev.map(p => {
      if (p.id !== pipeId || p.points.length <= 2) return p;
      const newPoints = p.points.filter((_, i) => i !== nodeIndex);
      return { ...p, points: newPoints };
    }));
    setSelectedNode(null);
  }, []);

  // ── BOM generation from manual pipes ──────────────────────────────────────────
  const getManualPipeBOM = useCallback(() => {
    const bomMap = {};
    pipes.forEach(pipe => {
      let len = 0;
      for (let i = 1; i < pipe.points.length; i++) {
        const dx = pipe.points[i].x - pipe.points[i-1].x;
const dy = pipe.points[i].y - pipe.points[i-1].y;
len += Math.sqrt(dx*dx + dy*dy);
      }
      const key = `manual_pipe_dn${pipe.diameterMm}`;
      if (!bomMap[key]) {
        bomMap[key] = { key, label: `Manual Pipe DN${pipe.diameterMm}`, category:"Pipework", unit:"m", quantity:0 };
      }
      bomMap[key].quantity += len;
    });
    return Object.values(bomMap).map(item => ({
      ...item,
      quantity: Number(item.quantity.toFixed(2))
    }));
  }, [pipes]);

  // ── Canvas rendering helper ────────────────────────────────────────────────────
  const renderPipes = useCallback((ctx, wx, wy, zoom) => {
    const ELBOW_R = Math.max(2, zoom * 0.08); // elbow curve radius in pixels

    // Draw completed pipes
    pipes.forEach(pipe => {
      const color = PIPE_COLORS[pipe.type] || PIPE_COLORS.supply;
      const isSelected = pipe.id === selectedPipeId;
      const lineWidth = Math.max(1.5, (pipe.diameterMm / 25) * 1.5);

      ctx.save();

      // Selection glow
      if (isSelected) {
        ctx.strokeStyle = "#ffff00";
        ctx.lineWidth = lineWidth + 4;
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.3;
        drawPipePath(ctx, pipe.points, wx, wy, ELBOW_R, pipe.drawMode);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Main pipe line

if (isSelected) {
  ctx.strokeStyle = "#ffff00";   // bright yellow
  ctx.lineWidth = lineWidth + 2;
} else {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
}

ctx.setLineDash([]);
drawPipePath(ctx, pipe.points, wx, wy, ELBOW_R, pipe.drawMode);
ctx.stroke();
// Selected segment highlight
if (
  selectedSegment &&
  selectedSegment.pipeId === pipe.id &&
  pipe.points[selectedSegment.segmentIndex] &&
  pipe.points[selectedSegment.segmentIndex + 1]
) {
  const a = pipe.points[selectedSegment.segmentIndex];
  const b = pipe.points[selectedSegment.segmentIndex + 1];

  ctx.save();
  ctx.strokeStyle = "#ff0000";
  ctx.lineWidth = lineWidth + 5;
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.moveTo(wx(a.x), wy(a.y));
  ctx.lineTo(wx(b.x), wy(b.y));
  ctx.stroke();
  ctx.restore();
}

      // Flow direction arrows
      if (zoom > 20) {
        drawFlowArrows(ctx, pipe.points, wx, wy, color, lineWidth);
      }

      // Pipe label
      if (isSelected || zoom > 35) {
        const mid = midPoint(pipe.points);
        ctx.fillStyle = color;
        ctx.font = `${Math.max(8, zoom * 0.3)}px monospace`;
        ctx.textAlign = "center";
        ctx.fillText(`DN${pipe.diameterMm}`, wx(mid.x), wy(mid.y) - 8);
      }

      // Node handles
      if (isSelected) {
        pipe.points.forEach((pt, i) => {
          const isNodeSel = selectedNode?.pipeId === pipe.id && selectedNode?.nodeIndex === i;
          ctx.beginPath();
          ctx.arc(wx(pt.x), wy(pt.y), isNodeSel ? 7 : 5, 0, Math.PI*2);
          ctx.fillStyle   = isNodeSel ? "#ffff00" : color;
          ctx.strokeStyle = "#000";
          ctx.lineWidth   = 1;
          ctx.fill();
          ctx.stroke();
        });
      }

      ctx.restore();
    });

    // Draw in-progress pipe
    if (drawing && drawing.points.length > 0) {
      ctx.save();
      const color = PIPE_COLORS[drawing.type] || PIPE_COLORS.supply;
      const lineWidth = Math.max(1.5, (drawing.diameterMm / 25) * 1.5);

      // Placed segments
      if (drawing.points.length > 1) {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([6, 3]);
        drawPipePath(ctx, drawing.points, wx, wy, ELBOW_R, drawing.drawMode);
        ctx.stroke();
      }

      // Preview segment to mouse
      if (mouseWorld && drawing.points.length > 0) {
        const last = drawing.points[drawing.points.length - 1];
        const preview = drawing.drawMode === "curve" || drawing.drawMode === "arc"
  ? mouseWorld
  : orthogonalMode
    ? (Math.abs(mouseWorld.x - last.x) >= Math.abs(mouseWorld.y - last.y)
        ? { x: mouseWorld.x, y: last.y }
        : { x: last.x, y: mouseWorld.y })
    : mouseWorld;

        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([4, 4]);
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.moveTo(wx(last.x), wy(last.y));
        ctx.lineTo(wx(preview.x), wy(preview.y));
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Snap indicator
        ctx.beginPath();
        ctx.arc(wx(preview.x), wy(preview.y), 5, 0, Math.PI*2);
        ctx.fillStyle = color;
        ctx.fill();

        // Length readout
        const pdx = preview.x - last.x;
	const pdy = preview.y - last.y;
	const segLen = Math.sqrt(pdx*pdx + pdy*pdy);
        ctx.fillStyle = "#ffcc00";
        ctx.font = "10px monospace";
        ctx.textAlign = "left";
        ctx.globalAlpha = 0.9;
        ctx.fillText(`DN${drawing.diameterMm} — ${segLen.toFixed(2)}m`, wx(preview.x) + 8, wy(preview.y) - 8);
        ctx.globalAlpha = 1;
      }

      // Start node
      ctx.beginPath();
      ctx.arc(wx(drawing.points[0].x), wy(drawing.points[0].y), 6, 0, Math.PI*2);
      ctx.fillStyle = "#00ff88";
      ctx.fill();

      // Hint
      if (drawing.points.length === 1 && zoom > 15) {
        ctx.fillStyle = "#ffcc00";
        ctx.font = "9px monospace";
        ctx.textAlign = "left";
        ctx.fillText("Click to add point · Double-click to finish", wx(drawing.points[0].x) + 8, wy(drawing.points[0].y) + 4);
      }

      ctx.restore();
    }
  }, [pipes, drawing, mouseWorld, selectedPipeId, selectedNode, selectedSegment, orthogonalMode]);

  return {
    // State
    pipes, setPipes,
    drawing,
    selectedPipeId, setSelectedPipeId,
selectedNode, setSelectedNode,
selectedSegment, setSelectedSegment,
mouseWorld,
    // Settings
    pipeDiameter, setPipeDiameter,
    pipeType, setPipeType,
    pipeDrawMode,
    setPipeDrawMode,
    orthogonalMode, setOrthogonalMode,
    // Handlers
    onPipeMouseMove,
    onPipeClick,
    onPipeDoubleClick,
    cancelDrawing,
    selectPipeAtPoint,
    selectNodeAtPoint,
    moveNode,
    deleteSelectedPipe,
deleteSelectedSegment,
    updatePipeDiameter,
updatePipeType,
updatePipeProperties,
    insertNode,
    insertNodeAtPoint,
    removeNode,
    // Rendering
    renderPipes,
    // BOM
    getManualPipeBOM,
  };
}

// ─── Canvas drawing helpers ───────────────────────────────────────────────────

function drawPipePath(ctx, points, wx, wy, elbowR, drawMode = "polyline") {
  if (!points || points.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(wx(points[0].x), wy(points[0].y));

  // TRUE CURVE MODE: 3-point quadratic curve
  // points[0] = start
  // points[1] = control/bend influence
  // points[2] = end
  if (drawMode === "curve" && points.length >= 3) {
    ctx.quadraticCurveTo(
      wx(points[1].x),
      wy(points[1].y),
      wx(points[2].x),
      wy(points[2].y)
    );
    return;
  }
// TRUE ARC MODE: 3-point circular arc
// points[0] = start
// points[1] = point on arc / bend influence
// points[2] = end
if (drawMode === "arc" && points.length >= 3) {
  drawCircularArcThrough3Points(ctx, points[0], points[1], points[2], wx, wy);
  return;
}

  // NORMAL STRAIGHT / POLYLINE MODE WITH ROUNDED ELBOWS
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const cx = wx(curr.x);
    const cy = wy(curr.y);
    const px = wx(prev.x);
    const py = wy(prev.y);

    if (!next || elbowR < 2) {
      ctx.lineTo(cx, cy);
      continue;
    }

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    const isElbow =
      (Math.abs(dx1) > 0.01 && Math.abs(dy2) > 0.01) ||
      (Math.abs(dy1) > 0.01 && Math.abs(dx2) > 0.01);

    if (!isElbow) {
      ctx.lineTo(cx, cy);
      continue;
    }

    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) * (wx(1) - wx(0));
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) * (wx(1) - wx(0));
    const r = Math.min(elbowR, len1 * 0.4, len2 * 0.4);

    const nx = wx(next.x);
    const ny = wy(next.y);

    const d1 = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
    const d2 = Math.sqrt((nx - cx) ** 2 + (ny - cy) ** 2);

    const t1 = Math.max(0, 1 - r / Math.max(d1, 0.001));
    const t2 = Math.min(1, r / Math.max(d2, 0.001));

    const beforeX = px + (cx - px) * t1;
    const beforeY = py + (cy - py) * t1;
    const afterX = cx + (nx - cx) * t2;
    const afterY = cy + (ny - cy) * t2;

    ctx.lineTo(beforeX, beforeY);
    ctx.quadraticCurveTo(cx, cy, afterX, afterY);
  }

  ctx.lineTo(
    wx(points[points.length - 1].x),
    wy(points[points.length - 1].y)
  );
}

    

function drawCircularArcThrough3Points(ctx, p0, p1, p2, wx, wy) {
  const x1 = wx(p0.x), y1 = wy(p0.y);
  const x2 = wx(p1.x), y2 = wy(p1.y);
  const x3 = wx(p2.x), y3 = wy(p2.y);

  const a = x1 * (y2 - y3) - y1 * (x2 - x3) + x2 * y3 - x3 * y2;

  // If points are almost straight, fallback to normal line
  if (Math.abs(a) < 0.001) {
    ctx.lineTo(x3, y3);
    return;
  }

  const b =
    ((x1 * x1 + y1 * y1) * (y3 - y2) +
      (x2 * x2 + y2 * y2) * (y1 - y3) +
      (x3 * x3 + y3 * y3) * (y2 - y1)) / (2 * a);

  const c =
    ((x1 * x1 + y1 * y1) * (x2 - x3) +
      (x2 * x2 + y2 * y2) * (x3 - x1) +
      (x3 * x3 + y3 * y3) * (x1 - x2)) / (2 * a);

  const cx = -b;
  const cy = -c;

  const r = Math.sqrt((x1 - cx) ** 2 + (y1 - cy) ** 2);

  const startAngle = Math.atan2(y1 - cy, x1 - cx);
  const midAngle = Math.atan2(y2 - cy, x2 - cx);
  const endAngle = Math.atan2(y3 - cy, x3 - cx);

  const ccw = isAngleBetween(startAngle, endAngle, midAngle, false)
    ? false
    : true;

  ctx.arc(cx, cy, r, startAngle, endAngle, ccw);
}

function isAngleBetween(start, end, test, ccw) {
  const twoPi = Math.PI * 2;

  const normalize = (a) => {
    while (a < 0) a += twoPi;
    while (a >= twoPi) a -= twoPi;
    return a;
  };

  start = normalize(start);
  end = normalize(end);
  test = normalize(test);

  if (!ccw) {
    if (end < start) end += twoPi;
    if (test < start) test += twoPi;
    return test >= start && test <= end;
  }

  if (start < end) start += twoPi;
  if (test < end) test += twoPi;
  return test <= start && test >= end;
}
function drawFlowArrows(ctx, points, wx, wy, color, lineWidth) {
  const arrowLen = Math.max(6, lineWidth * 3);
  for (let i = 1; i < points.length; i++) {
    const p1 = points[i-1], p2 = points[i];
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx*dx+dy*dy);
    if (len < 0.5) continue;
    const nx = dx/len, ny = dy/len;
    const ax = wx(mx), ay = wy(my);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(ny, nx));
    ctx.beginPath();
    ctx.moveTo(-arrowLen, -arrowLen*0.5);
    ctx.lineTo(0, 0);
    ctx.lineTo(-arrowLen, arrowLen*0.5);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.7;
    ctx.stroke();
    ctx.restore();
  }
}

function midPoint(points) {
  if (points.length === 0) return { x:0, y:0 };
  if (points.length === 1) return points[0];
  const mid = Math.floor(points.length / 2);
  return {
    x: (points[mid-1].x + points[mid].x) / 2,
    y: (points[mid-1].y + points[mid].y) / 2,
  };
}
