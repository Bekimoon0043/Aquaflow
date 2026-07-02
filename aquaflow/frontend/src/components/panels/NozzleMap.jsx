/**
 * NozzleMap.jsx — Pool top-view nozzle intensity map
 * Shows each fixture as a dot positioned on a 2D pool plan,
 * colored by live intensity (0=dark blue, 1=bright cyan/white).
 * Supports click-to-select individual nozzles for solo control.
 *
 * Props:
 *   fixtures      — engineeringFixtures[] from engineeringStore
 *   intensities   — Float32Array | null, per-nozzle 0..1
 *   poolGeometry  — { width, length, shape } from engineeringStore
 *   selected      — Set<number> of selected fixture indices
 *   onSelect      — (idx, multi) => void
 */

import React, { useRef, useEffect, useCallback, useMemo } from "react";

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Map an intensity value (0..1) to a CSS color string.
 * 0   → deep navy  (#0a1628)
 * 0.3 → royal blue (#1a6fbd)
 * 0.7 → cyan       (#00d4ff)
 * 1.0 → white-cyan (#e0f8ff)
 */
function intensityToColor(v, selected = false) {
  const t = Math.max(0, Math.min(1, v));
  if (selected) {
    // selected nozzle: amber/gold ring
    return { fill: `hsl(${42 + t * 18},${80 + t * 20}%,${45 + t * 30}%)`, ring: true };
  }
  if (t < 0.01) return { fill: "#0d1e38" };
  if (t < 0.3) {
    const p = t / 0.3;
    const l = Math.round(8 + p * 22);
    return { fill: `hsl(210,${60 + p * 20}%,${l}%)` };
  }
  if (t < 0.7) {
    const p = (t - 0.3) / 0.4;
    return { fill: `hsl(${210 - p * 20},${80 + p * 20}%,${30 + p * 25}%)` };
  }
  const p = (t - 0.7) / 0.3;
  return { fill: `hsl(${190 - p * 5},100%,${55 + p * 35}%)` };
}

/**
 * Nozzle type → icon label for the dot tooltip
 */
const NOZZLE_LABELS = {
  geyser: "GY", arch: "AR", jet_1d: "J1", jet_2d: "J2", jet_3d: "J3",
  laminar: "LM", mist: "MS", cascade: "CS", ring: "RG",
  pump: "PM", valve: "VL", lighting: "LT", fog: "FG",
  flame: "FL", laser: "LS",
};

// ─── component ──────────────────────────────────────────────────────────────

const NozzleMap = React.memo(function NozzleMap({
  fixtures = [],
  intensities = null,
  poolGeometry = null,
  selected = new Set(),
  onSelect,
}) {
  const canvasRef = useRef(null);
  const tooltipRef = useRef(null);
  const hoverRef = useRef(-1);
  const animRef = useRef(null);
  const lastIntensitiesRef = useRef(null);

  // Determine pool shape extents for normalizing fixture coords
  const poolW = poolGeometry?.length ?? 20; // metres
  const poolH = poolGeometry?.width ?? 10;

  // Canvas dimensions — leave room for label row at bottom
  const CANVAS_W = 560;
  const CANVAS_H = 280;
  const PAD = 28;
  const drawW = CANVAS_W - PAD * 2;
  const drawH = CANVAS_H - PAD * 2 - 20; // 20 for bottom label

  /**
   * Convert a fixture's real-world x/y (metres from pool centre)
   * to canvas coordinates.
   * Fixture coords are stored as { x, y } in engineering units.
   * We normalise to pool extents then map to canvas.
   */
  const fixtureToCanvas = useCallback((fx) => {
    // engineeringFixtures have .position.x and .position.y if set,
    // otherwise we distribute evenly in a circle/grid fallback
    const rx = fx.position?.x ?? 0;
    const ry = fx.position?.y ?? 0;
    const halfW = poolW / 2;
    const halfH = poolH / 2;
    const nx = halfW > 0 ? (rx + halfW) / (poolW) : 0.5;
    const ny = halfH > 0 ? (ry + halfH) / (poolH) : 0.5;
    return {
      cx: PAD + nx * drawW,
      cy: PAD + (1 - ny) * drawH, // flip Y axis
    };
  }, [poolW, poolH, drawW, drawH]);

  // Fallback positions when fixtures lack position data
  const fixturePositions = useMemo(() => {
    return fixtures.map((fx, i) => {
      if (fx.position?.x != null) return fixtureToCanvas(fx);
      // distribute evenly in an ellipse
      const angle = (i / Math.max(fixtures.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const er = Math.min(drawW, drawH) * 0.38;
      const erx = drawW * 0.42;
      const ery = drawH * 0.38;
      return {
        cx: PAD + drawW / 2 + Math.cos(angle) * erx,
        cy: PAD + drawH / 2 + Math.sin(angle) * ery,
      };
    });
  }, [fixtures, fixtureToCanvas, drawW, drawH]);

  // ── draw ──────────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ── pool outline ─────────────────────────────────────────────────────
    const shape = poolGeometry?.shape ?? "rectangle";
    ctx.save();
    ctx.strokeStyle = "rgba(0,180,255,0.18)";
    ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    if (shape === "oval" || shape === "ellipse") {
      ctx.ellipse(
        PAD * dpr + (drawW * dpr) / 2,
        PAD * dpr + (drawH * dpr) / 2,
        (drawW * dpr) / 2,
        (drawH * dpr) / 2,
        0, 0, Math.PI * 2
      );
    } else {
      const r = 10 * dpr;
      const x = PAD * dpr, y = PAD * dpr;
      const w = drawW * dpr, h = drawH * dpr;
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }
    ctx.stroke();
    ctx.restore();

    // ── pool centre cross ─────────────────────────────────────────────────
    const cx0 = (PAD + drawW / 2) * dpr;
    const cy0 = (PAD + drawH / 2) * dpr;
    ctx.save();
    ctx.strokeStyle = "rgba(0,180,255,0.10)";
    ctx.lineWidth = dpr;
    ctx.setLineDash([3 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(cx0, PAD * dpr);
    ctx.lineTo(cx0, (PAD + drawH) * dpr);
    ctx.moveTo(PAD * dpr, cy0);
    ctx.lineTo((PAD + drawW) * dpr, cy0);
    ctx.stroke();
    ctx.restore();

    // ── nozzle dots ───────────────────────────────────────────────────────
    fixtures.forEach((fx, i) => {
      const pos = fixturePositions[i];
      if (!pos) return;
      const { cx, cy } = pos;
      const v = intensities ? (intensities[i] ?? 0) : 0;
      const sel = selected.has(i);
      const hover = hoverRef.current === i;
      const { fill, ring } = intensityToColor(v, sel);

      const radius = (sel ? 9 : hover ? 8 : 7) * dpr;

      // glow halo when active
      if (v > 0.05 && !sel) {
        const glowR = (12 + v * 14) * dpr;
        const grad = ctx.createRadialGradient(cx * dpr, cy * dpr, 0, cx * dpr, cy * dpr, glowR);
        const alpha = Math.round(v * 50).toString(16).padStart(2, "0");
        grad.addColorStop(0, `#00d4ff${alpha}`);
        grad.addColorStop(1, "#00d4ff00");
        ctx.beginPath();
        ctx.arc(cx * dpr, cy * dpr, glowR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // selection ring
      if (ring || sel) {
        ctx.beginPath();
        ctx.arc(cx * dpr, cy * dpr, radius + 3 * dpr, 0, Math.PI * 2);
        ctx.strokeStyle = sel ? "#f5a623" : "#00d4ff";
        ctx.lineWidth = 2 * dpr;
        ctx.setLineDash([]);
        ctx.stroke();
      }

      // dot fill
      ctx.beginPath();
      ctx.arc(cx * dpr, cy * dpr, radius, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();

      // intensity bar inside dot for high values
      if (v > 0.3) {
        ctx.beginPath();
        ctx.arc(cx * dpr, cy * dpr, radius * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${v * 0.7})`;
        ctx.fill();
      }

      // fixture type label
      const label = NOZZLE_LABELS[fx.type] ?? "??";
      ctx.font = `${500} ${9 * dpr}px "Anthropic Sans", system-ui, sans-serif`;
      ctx.fillStyle = v > 0.5 ? "#001a2e" : "rgba(180,220,255,0.7)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, cx * dpr, cy * dpr);
    });

    // ── legend ────────────────────────────────────────────────────────────
    const legendY = (CANVAS_H - 14) * dpr;
    const steps = [0, 0.25, 0.5, 0.75, 1];
    const legendW = 100 * dpr;
    const legendX = (CANVAS_W / 2 - 50) * dpr;
    const grad = ctx.createLinearGradient(legendX, 0, legendX + legendW, 0);
    grad.addColorStop(0, "#0d1e38");
    grad.addColorStop(0.35, "#1a6fbd");
    grad.addColorStop(0.7, "#00d4ff");
    grad.addColorStop(1, "#e0f8ff");
    ctx.fillStyle = grad;
    ctx.fillRect(legendX, legendY - 5 * dpr, legendW, 5 * dpr);
    ctx.font = `${9 * dpr}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(140,170,200,0.7)";
    ctx.textAlign = "left";
    ctx.fillText("0%", legendX, legendY + 8 * dpr);
    ctx.textAlign = "right";
    ctx.fillText("100%", legendX + legendW, legendY + 8 * dpr);
    ctx.textAlign = "center";
    ctx.fillText("intensity", legendX + legendW / 2, legendY + 8 * dpr);
  }, [fixtures, intensities, selected, fixturePositions, poolGeometry]);

  // ── animation loop ────────────────────────────────────────────────────────
  useEffect(() => {
    let running = true;
    const loop = () => {
      if (!running) return;
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  // ── canvas setup (DPR) ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    canvas.style.width = CANVAS_W + "px";
    canvas.style.height = CANVAS_H + "px";
  }, []);

  // ── pointer events ────────────────────────────────────────────────────────
  const hitTest = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return -1;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = -1, bestD = 14;
    fixturePositions.forEach(({ cx, cy }, i) => {
      const d = Math.hypot(mx - cx, my - cy);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }, [fixturePositions]);

  const handleMouseMove = useCallback((e) => {
    const idx = hitTest(e);
    hoverRef.current = idx;
    const tooltip = tooltipRef.current;
    if (!tooltip) return;
    if (idx === -1) {
      tooltip.style.display = "none";
      return;
    }
    const fx = fixtures[idx];
    const v = intensities ? (intensities[idx] ?? 0) : 0;
    tooltip.style.display = "block";
    tooltip.style.left = (e.clientX - canvasRef.current.getBoundingClientRect().left + 14) + "px";
    tooltip.style.top = (e.clientY - canvasRef.current.getBoundingClientRect().top - 10) + "px";
    tooltip.innerHTML = `
      <span style="font-weight:500">${fx.name ?? fx.id ?? `Fixture ${idx + 1}`}</span><br/>
      <span style="color:rgba(180,220,255,0.7);font-size:11px">${fx.type ?? "—"} · ${Math.round(v * 100)}%</span>
    `;
  }, [hitTest, fixtures, intensities]);

  const handleMouseLeave = useCallback(() => {
    hoverRef.current = -1;
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
  }, []);

  const handleClick = useCallback((e) => {
    const idx = hitTest(e);
    if (idx === -1 || !onSelect) return;
    onSelect(idx, e.ctrlKey || e.metaKey || e.shiftKey);
  }, [hitTest, onSelect]);

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        style={{ cursor: "crosshair", display: "block", borderRadius: 8 }}
        aria-label="Pool nozzle intensity map"
      />
      {/* Tooltip */}
      <div
        ref={tooltipRef}
        style={{
          display: "none",
          position: "absolute",
          pointerEvents: "none",
          background: "rgba(8,18,36,0.95)",
          border: "1px solid rgba(0,180,255,0.25)",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 12,
          color: "#c8e8ff",
          whiteSpace: "nowrap",
          zIndex: 100,
          lineHeight: 1.5,
        }}
      />
    </div>
  );
});

export default NozzleMap;
