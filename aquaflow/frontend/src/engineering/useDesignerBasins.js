/**
 * useDesignerBasins.js — AF-NEXT-010 multi-basin editing state for PoolGeometryDesigner.
 *
 * The designer keeps editing ONE outline through its existing `geometry` / `poolType` /
 * `params` state; that outline is the ACTIVE basin. This hook owns the other basins and the
 * active index, and returns:
 *   - basins       the full list with the active basin composed from the editing state;
 *   - primary      the legacy view for the store/3D/export: basins[0] as geometry/poolType/params
 *                  (identical to the editing state while basin 1 is active);
 *   - selectBasin / addBasin / removeBasin / renameBasin / loadBasins.
 * Logic lives here (not in the .jsx) so the drafting-kernel extraction (AF-CAD-030) stays easy.
 */
import { useCallback, useMemo, useState } from "react";
import {
  basinToGeometry, composeActiveBasin, createBasinBeside, legacyFromBasins, pointInBasin,
} from "./basins";

export function useDesignerBasins({ initialBasins = [], geometry, setGeometry, poolType, setPoolType, params, setParams }) {
  const [stored, setStored] = useState(() => (Array.isArray(initialBasins) ? initialBasins : []));
  const [activeBasinIndex, setActiveBasinIndex] = useState(0);

  const basins = useMemo(
    () => composeActiveBasin(stored, activeBasinIndex, { geometry, poolType, params }),
    [stored, activeBasinIndex, geometry, poolType, params],
  );

  const primary = useMemo(() => {
    if (activeBasinIndex === 0 || basins.length <= 1) return { geometry, poolType, params };
    const legacy = legacyFromBasins(basins);
    return { geometry: legacy.geometry, poolType: legacy.poolType || poolType, params: legacy.params || params };
  }, [activeBasinIndex, basins, geometry, poolType, params]);

  const activate = useCallback((list, index) => {
    const i = Math.max(0, Math.min(index, list.length - 1));
    const b = list[i];
    setStored(list);
    setActiveBasinIndex(i);
    if (!b) return;
    setGeometry(basinToGeometry(b));
    if (b.poolType) setPoolType(b.poolType);
    if (b.params) setParams(b.params);
  }, [setGeometry, setPoolType, setParams]);

  const selectBasin = useCallback((index) => {
    if (index === activeBasinIndex || index < 0 || index >= basins.length) return;
    activate(basins, index);
  }, [activate, activeBasinIndex, basins]);

  const addBasin = useCallback(() => {
    const next = [...basins, createBasinBeside(basins, { depth: Number(params?.depth) || 0.8 })];
    activate(next, next.length - 1);
  }, [activate, basins, params]);

  const removeBasin = useCallback((index) => {
    if (basins.length <= 1 || index < 0 || index >= basins.length) return;
    const next = basins.filter((_, i) => i !== index);
    activate(next, index === activeBasinIndex ? 0 : (index < activeBasinIndex ? activeBasinIndex - 1 : activeBasinIndex));
  }, [activate, activeBasinIndex, basins]);

  const renameBasin = useCallback((index, name) => {
    setStored(basins.map((b, i) => (i === index ? { ...b, name: String(name || b.id) } : b)));
  }, [basins]);

  /** Replace every basin (project load, CAD import, undo) without touching the editing state. */
  const loadBasins = useCallback((list = [], index = 0) => {
    setStored(Array.isArray(list) ? list : []);
    setActiveBasinIndex(Math.max(0, Math.min(index, Math.max(0, (list?.length || 1) - 1))));
  }, []);

  /** Index of the basin whose water contains the plan point, or -1. */
  const basinIndexAt = useCallback((point) => basins.findIndex((b) => pointInBasin(point, b)), [basins]);

  return {
    basins, activeBasinIndex, activeBasin: basins[activeBasinIndex] || null, primary,
    selectBasin, addBasin, removeBasin, renameBasin, loadBasins, basinIndexAt,
  };
}

/**
 * Canvas overlay: every NON-active basin outline (dashed, labelled) and the islands of every
 * basin. The active basin's outline is drawn by the designer's existing pool renderer.
 */
export function drawBasinOverlay(ctx, basins, activeIndex, { wx, wy, zoom, showLabels = true } = {}) {
  if (!ctx || !Array.isArray(basins) || !wx || !wy) return;
  const ring = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(wx(p.x), wy(p.y)) : ctx.moveTo(wx(p.x), wy(p.y))));
    ctx.closePath();
  };
  basins.forEach((b, i) => {
    const outer = b.outer || [];
    ctx.save();
    if (i !== activeIndex && outer.length >= 3) {
      ring(outer);
      ctx.fillStyle = "rgba(0, 119, 182, 0.10)";
      ctx.fill();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "#4f8fb8";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    (b.holes || []).filter((h) => h.length >= 3).forEach((hole) => {
      ring(hole);
      ctx.fillStyle = "#13202b";
      ctx.fill();
      ctx.strokeStyle = "#5c7a8f";
      ctx.lineWidth = 1;
      ctx.stroke();
    });
    if (showLabels && basins.length > 1 && outer.length >= 3) {
      const xs = outer.map((p) => p.x), ys = outer.map((p) => p.y);
      ctx.fillStyle = i === activeIndex ? "#9fe6ff" : "#6f9bb5";
      ctx.font = `${Math.max(10, Math.min(14, (zoom || 30) * 0.4))}px monospace`;
      ctx.textAlign = "left";
      ctx.fillText(b.name || b.id, wx(Math.min(...xs)) + 4, wy(Math.min(...ys)) + 14);
    }
    ctx.restore();
  });
}
