/**
 * drafting/overlays.js — canvas overlays drawn on top of the 2D designer (AF-CAD-032..034):
 *   - the selection window (left→right, solid blue = WINDOW) or crossing box
 *     (right→left, dashed green = CROSSING), AutoCAD colours;
 *   - the polar-tracking guide ray and its angle tag;
 *   - the object-snap marker with its tooltip.
 */
import { drawSnapGlyph } from "./snap";
import { selectionBoxMode } from "./selection";

export function drawDraftingOverlays(ctx, s, { wx, wy }) {
  const { selectionBox, polarGuide, snapResult, canvasViewport } = s;
  if (selectionBox?.start && selectionBox?.end) {
    const mode = selectionBoxMode(selectionBox.start, selectionBox.end);
    const x = wx(Math.min(selectionBox.start.x, selectionBox.end.x));
    const y = wy(Math.min(selectionBox.start.y, selectionBox.end.y));
    const w = Math.abs(selectionBox.end.x - selectionBox.start.x) * s.zoom;
    const h = Math.abs(selectionBox.end.y - selectionBox.start.y) * s.zoom;
    ctx.save();
    ctx.fillStyle = mode === "window" ? "rgba(60,130,255,0.12)" : "rgba(60,220,120,0.12)";
    ctx.strokeStyle = mode === "window" ? "#4f8cff" : "#3cdc78";
    ctx.lineWidth = 1;
    ctx.setLineDash(mode === "window" ? [] : [6, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.restore();
  }
  if (polarGuide?.from && Number.isFinite(polarGuide.angleDeg)) {
    const a = polarGuide.angleDeg * Math.PI / 180;
    const sx = wx(polarGuide.from.x), sy = wy(polarGuide.from.y);
    const len = Math.max(canvasViewport?.width || 900, canvasViewport?.height || 600) * 2;
    ctx.save();
    ctx.strokeStyle = polarGuide.locked ? "rgba(255,170,0,0.75)" : "rgba(102,204,255,0.55)";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    // Plan y runs down the screen; polar angles are counter-clockwise on screen.
    ctx.lineTo(sx + Math.cos(a) * len, sy - Math.sin(a) * len);
    ctx.stroke();
    if (polarGuide.label) {
      ctx.setLineDash([]);
      ctx.font = "10px monospace";
      ctx.fillStyle = polarGuide.locked ? "#ffaa00" : "#66ccff";
      ctx.textAlign = "left";
      ctx.fillText(polarGuide.label, sx + 14, sy - 14);
    }
    ctx.restore();
  }
  if (snapResult?.mode) drawSnapGlyph(ctx, snapResult, wx(snapResult.x), wy(snapResult.y));
}
