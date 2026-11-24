/**
 * drafting/penOverlay.js — draws the Pen tool's live stroke (and, while a pen result is
 * open, the original raw stroke as a faint dashed ghost) on a transparent canvas laid over
 * the plan. Drawn imperatively on every pointer move so a stroke never re-renders the
 * whole designer. Points are plan metres; the view is { pan, zoom } as in viewport.js.
 */
const FALLBACK = { stroke: "#c9a227", ghost: "#79afe0" };

function token(canvas, name, fallback) {
  try {
    const value = getComputedStyle(canvas).getPropertyValue(name).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
}

/** Match the overlay's drawing buffer to the plan canvas (CSS px × device pixel ratio). */
export function sizePenOverlay(canvas, { width, height, dpr = 1 }) {
  if (!canvas) return;
  const w = Math.round(width * dpr), h = Math.round(height * dpr);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function tracePath(ctx, points, { pan, zoom }) {
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = pan.x + p.x * zoom, y = pan.y + p.y * zoom;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
}

export function drawPenOverlay(canvas, { stroke = null, ghost = null, pan, zoom, dpr = 1 }) {
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return;
  ctx.setTransform?.(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform?.(dpr, 0, 0, dpr, 0, 0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (ghost?.length > 1) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.setLineDash?.([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = token(canvas, "--info", FALLBACK.ghost);
    tracePath(ctx, ghost, { pan, zoom });
    ctx.stroke();
    ctx.restore();
  }
  if (stroke?.length) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = token(canvas, "--accent", FALLBACK.stroke);
    if (stroke.length === 1) {
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(pan.x + stroke[0].x * zoom, pan.y + stroke[0].y * zoom, 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      tracePath(ctx, stroke, { pan, zoom });
      ctx.stroke();
    }
    ctx.restore();
  }
}
