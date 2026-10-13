/**
 * drafting/designerRenderer.js — AF-CAD-030: the 2D Engineering Designer's canvas
 * renderer, moved out of PoolGeometryDesigner.jsx's draw effect. A pure function of the
 * designer state (no React): grid, CAD underlay, land surfaces, pool/basins, pipework,
 * dimensions, depth zones, previews, fixtures and measurements, followed by the drafting
 * overlays (multi-selection, selection window, polar guide, snap marker — AF-CAD-032..034).
 */
import { drawCadUnderlay } from "../cadUnderlay";
import { drawBasinOverlay } from "../useDesignerBasins";
import { LAND_SURFACE_TYPES } from "../siteSurfaces";
import { getEngineeringSymbol, drawEngSymbol } from "./designerCatalog";
import { entityKey } from "./entities";
import { drawDraftingOverlays } from "./overlays";

export function renderDesignerCanvas(canvas, s) {
  if (!canvas) return;
  const {
    canvasViewport, showGrid, zoom, pan, cadUnderlay, isLayerVisible, siteSurfaces, selectedSurfaceId,
    tool, selectedSurfaceVertex, landDrawPoints, landSurfaceType, drawPreview, geometry, showDepth,
    pipework, fixtures, renderPipes, selectedObject, activeGrip, showDimensions, poolMetrics, params,
    basins, activeBasinIndex, depthZones, depthDrawPoints, depthZone, freeformPoints, drawStart,
    polylinePoints, selectedFixture, selectedKeys, measurements,
  } = s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width: W, height: H, dpr } = canvasViewport;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = "#020810";
  ctx.fillRect(0,0,W,H);

  // Grid
  if(showGrid) {
    ctx.strokeStyle = "#0a2030";
    ctx.lineWidth = 0.5;
    const gridSpacing = zoom; // 1m grid
    for(let x = (pan.x % gridSpacing); x < W; x += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for(let y = (pan.y % gridSpacing); y < H; y += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    // 5m major grid
    ctx.strokeStyle = "#0a3040";
    ctx.lineWidth = 1;
    const major = zoom * 5;
    for(let x = (pan.x % major); x < W; x += major) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for(let y = (pan.y % major); y < H; y += major) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }
    // Scale label
    ctx.fillStyle = "#334455";
    ctx.font = "10px monospace";
    ctx.fillText(`1m`, pan.x + 4, H - 8);
    ctx.strokeStyle = "#334455";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pan.x, H-14); ctx.lineTo(pan.x + zoom, H-14); ctx.stroke();
  }

  // World to canvas
  const wx = (x) => pan.x + x * zoom;
  const wy = (y) => pan.y + y * zoom;

  // AF-CAD-011: locked CAD underlay behind the whole design — batched (one stroke per
  // layer/colour) and viewport-culled through its spatial index.
  if (cadUnderlay) drawCadUnderlay(ctx, cadUnderlay, { zoom, pan, width: W, height: H });

  // Site/land surfaces are engineering geometry: draw them below the pool so the
  // basin remains legible while grass, paving and planting areas can be edited.
  if (isLayerVisible("landscape")) {
    siteSurfaces.forEach((surface) => {
      if (surface.visible === false || surface.points.length < 3) return;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(wx(surface.points[0].x), wy(surface.points[0].y));
      surface.points.slice(1).forEach((point) => ctx.lineTo(wx(point.x), wy(point.y)));
      ctx.closePath();
      ctx.globalAlpha = 0.44;
      ctx.fillStyle = surface.color || "#4f8a3c";
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = selectedSurfaceId === surface.id ? "#ffcc00" : (surface.color || "#65a30d");
      ctx.lineWidth = selectedSurfaceId === surface.id ? 2.5 : 1.5;
      if (selectedSurfaceId === surface.id) ctx.setLineDash([7, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      const centroid = surface.points.reduce((sum, point) => ({ x:sum.x + point.x, y:sum.y + point.y }), { x:0, y:0 });
      centroid.x /= surface.points.length;
      centroid.y /= surface.points.length;
      ctx.fillStyle = "#e8f6df";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(surface.label, wx(centroid.x), wy(centroid.y));

      if (selectedSurfaceId === surface.id && tool === "select") {
        surface.points.forEach((point, index) => {
          const x = wx(point.x), y = wy(point.y);
          ctx.fillStyle = selectedSurfaceVertex === index ? "#ffcc00" : "#8ee36d";
          ctx.strokeStyle = "#10210c";
          ctx.fillRect(x - 5, y - 5, 10, 10);
          ctx.strokeRect(x - 5, y - 5, 10, 10);
        });
      }
      ctx.restore();
    });
  }

  if (landDrawPoints.length) {
    const preset = LAND_SURFACE_TYPES.find((entry) => entry.key === landSurfaceType) || LAND_SURFACE_TYPES[0];
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(wx(landDrawPoints[0].x), wy(landDrawPoints[0].y));
    landDrawPoints.slice(1).forEach((point) => ctx.lineTo(wx(point.x), wy(point.y)));
    if (drawPreview) ctx.lineTo(wx(drawPreview.x), wy(drawPreview.y));
    ctx.strokeStyle = preset.color;
    ctx.fillStyle = `${preset.color}33`;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    landDrawPoints.forEach((point) => {
      ctx.fillRect(wx(point.x) - 4, wy(point.y) - 4, 8, 8);
    });
    ctx.restore();
  }

  // Draw pool geometry
  if(geometry && (isLayerVisible("pool_outline") || isLayerVisible("water_surface"))) {
    if(geometry.type === "circle") {
      // Depth fill
      if(showDepth) {
        const grad = ctx.createRadialGradient(wx(geometry.center.x), wy(geometry.center.y), 0, wx(geometry.center.x), wy(geometry.center.y), geometry.radius*zoom);
        grad.addColorStop(0, "rgba(3,4,94,0.7)");
        grad.addColorStop(0.6, "rgba(0,119,182,0.5)");
        grad.addColorStop(1, "rgba(126,200,227,0.4)");
        ctx.fillStyle = isLayerVisible("water_surface") ? grad : "rgba(0,0,0,0)";
      } else {
        ctx.fillStyle = isLayerVisible("water_surface") ? "rgba(0,100,160,0.4)" : "rgba(0,0,0,0)";
      }
      ctx.beginPath();
      ctx.arc(wx(geometry.center.x), wy(geometry.center.y), geometry.radius*zoom, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = isLayerVisible("pool_outline") ? "#00aaff" : "rgba(0,0,0,0)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if(geometry.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(wx(geometry.center.x), wy(geometry.center.y), geometry.rx*zoom, geometry.ry*zoom, 0, 0, Math.PI*2);
      ctx.fillStyle = isLayerVisible("water_surface") ? "rgba(0,100,160,0.4)" : "rgba(0,0,0,0)";
      ctx.fill();
      ctx.strokeStyle = isLayerVisible("pool_outline") ? "#00aaff" : "rgba(0,0,0,0)";
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if(geometry.points) {
      ctx.beginPath();
      ctx.moveTo(wx(geometry.points[0].x), wy(geometry.points[0].y));
      geometry.points.forEach(p => ctx.lineTo(wx(p.x), wy(p.y)));
      if(geometry.closed) ctx.closePath();
      if(showDepth) {
        const minX = Math.min(...geometry.points.map(p=>p.x));
        const minY = Math.min(...geometry.points.map(p=>p.y));
        const maxX = Math.max(...geometry.points.map(p=>p.x));
        const maxY = Math.max(...geometry.points.map(p=>p.y));
        const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
        const grad = ctx.createRadialGradient(wx(cx),wy(cy),0,wx(cx),wy(cy),(maxX-minX)*zoom*0.7);
        grad.addColorStop(0,"rgba(3,4,94,0.7)");
        grad.addColorStop(0.5,"rgba(0,119,182,0.5)");
        grad.addColorStop(1,"rgba(126,200,227,0.4)");
        ctx.fillStyle = isLayerVisible("water_surface") ? grad : "rgba(0,0,0,0)";
      } else {
        ctx.fillStyle = isLayerVisible("water_surface") ? "rgba(0,100,160,0.4)" : "rgba(0,0,0,0)";
      }
      ctx.fill();
      ctx.strokeStyle = isLayerVisible("pool_outline") ? "#00aaff" : "rgba(0,0,0,0)";
      ctx.lineWidth = 2;
      ctx.stroke();

// Pipework rendering
if (isLayerVisible("pipework") && pipework?.branches?.length > 0) {
ctx.save();

// Main header
if (pipework.mainHeaderLengthM > 0) {
  const xs = fixtures.map(f => Number(f.x || 0));
  const ys = fixtures.map(f => Number(f.y || 0));

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const avgY = ys.reduce((a,b) => a + b, 0) / ys.length;

  ctx.strokeStyle = "#8b5cf6";
  ctx.lineWidth = 3;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(wx(minX), wy(avgY));
  ctx.lineTo(wx(maxX), wy(avgY));
  ctx.stroke();
}

// Branch pipes
ctx.strokeStyle = "#a78bfa";
ctx.lineWidth = 2;
ctx.setLineDash([3, 3]);

 pipework.branches.forEach(b => {
  if (b?.from?.x === undefined || b?.to?.x === undefined) return;
  if (!b.from || !b.to) return;
  ctx.beginPath();
  ctx.moveTo(wx(b.from.x), wy(b.from.y));
  ctx.lineTo(wx(b.to.x), wy(b.to.y));
  ctx.stroke();
});

ctx.restore();
}
if (isLayerVisible("pipework")) { renderPipes(ctx, wx, wy, zoom); }

      // Selection outline
      if(selectedObject === "pool") {
        ctx.save();
        ctx.strokeStyle = "#ffcc00";
        ctx.lineWidth = 1;
        ctx.setLineDash([6,4]);
        ctx.stroke();
        ctx.restore();
      }

      // Vertex handles
      if(tool === "select" || tool === "rectangle" || tool === "polyline") {
        geometry.points.forEach((p,i) => {
          const sx = wx(p.x), sy = wy(p.y);
          ctx.fillStyle = activeGrip?.index === i ? "#ffcc00" : "#00aaff";
          ctx.strokeStyle = "#001520";
          ctx.lineWidth = 1;
          ctx.fillRect(sx-5, sy-5, 10, 10);
          ctx.strokeRect(sx-5, sy-5, 10, 10);
        });
      }
    }

    if (selectedObject === "pool" && tool === "select" && (geometry.type === "circle" || geometry.type === "ellipse")) {
      const handles = geometry.type === "circle"
        ? [
            { x:geometry.center.x + geometry.radius, y:geometry.center.y },
            { x:geometry.center.x - geometry.radius, y:geometry.center.y },
            { x:geometry.center.x, y:geometry.center.y + geometry.radius },
            { x:geometry.center.x, y:geometry.center.y - geometry.radius },
          ]
        : [
            { x:geometry.center.x + geometry.rx, y:geometry.center.y },
            { x:geometry.center.x - geometry.rx, y:geometry.center.y },
            { x:geometry.center.x, y:geometry.center.y + geometry.ry },
            { x:geometry.center.x, y:geometry.center.y - geometry.ry },
          ];
      handles.forEach((point, index) => {
        const x = wx(point.x), y = wy(point.y);
        ctx.fillStyle = activeGrip?.index === index ? "#ffcc00" : "#00aaff";
        ctx.strokeStyle = "#001520";
        ctx.fillRect(x - 5, y - 5, 10, 10);
        ctx.strokeRect(x - 5, y - 5, 10, 10);
      });
    }

    // CAD-style dimension annotations
    if(showDimensions && isLayerVisible("annotations")) {
      ctx.save();
      ctx.strokeStyle = "#ffcc00";
      ctx.fillStyle = "#ffcc00";
      ctx.lineWidth = 1;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const arrow = (x, y, dir) => {
        ctx.beginPath();
        if(dir === "left") {
          ctx.moveTo(x, y); ctx.lineTo(x+6, y-3); ctx.moveTo(x, y); ctx.lineTo(x+6, y+3);
        } else if(dir === "right") {
          ctx.moveTo(x, y); ctx.lineTo(x-6, y-3); ctx.moveTo(x, y); ctx.lineTo(x-6, y+3);
        } else if(dir === "up") {
          ctx.moveTo(x, y); ctx.lineTo(x-3, y+6); ctx.moveTo(x, y); ctx.lineTo(x+3, y+6);
        } else if(dir === "down") {
          ctx.moveTo(x, y); ctx.lineTo(x-3, y-6); ctx.moveTo(x, y); ctx.lineTo(x+3, y-6);
        }
        ctx.stroke();
      };

      if(geometry.points && geometry.points.length >= 4) {
        const xs = geometry.points.map(p=>p.x);
        const ys = geometry.points.map(p=>p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const width = maxX - minX;
        const length = maxY - minY;

        const topY = wy(minY) - 26;
        const leftX = wx(minX) - 28;
        const rightX = wx(maxX) + 28;
        const bottomY = wy(maxY) + 26;

        // Width dimension line
        ctx.beginPath();
        ctx.moveTo(wx(minX), topY);
        ctx.lineTo(wx(maxX), topY);
        ctx.stroke();
        arrow(wx(minX), topY, "right");
        arrow(wx(maxX), topY, "left");
        ctx.fillText(`${width.toFixed(3)} m`, wx((minX+maxX)/2), topY - 10);

        // Width extension lines
        ctx.beginPath();
        ctx.moveTo(wx(minX), wy(minY)); ctx.lineTo(wx(minX), topY+6);
        ctx.moveTo(wx(maxX), wy(minY)); ctx.lineTo(wx(maxX), topY+6);
        ctx.stroke();

        // Length dimension line
        ctx.beginPath();
        ctx.moveTo(rightX, wy(minY));
        ctx.lineTo(rightX, wy(maxY));
        ctx.stroke();
        arrow(rightX, wy(minY), "down");
        arrow(rightX, wy(maxY), "up");
        ctx.save();
        ctx.translate(rightX + 12, wy((minY+maxY)/2));
        ctx.rotate(-Math.PI/2);
        ctx.fillText(`${length.toFixed(3)} m`, 0, 0);
        ctx.restore();

        // Length extension lines
        ctx.beginPath();
        ctx.moveTo(wx(maxX), wy(minY)); ctx.lineTo(rightX-6, wy(minY));
        ctx.moveTo(wx(maxX), wy(maxY)); ctx.lineTo(rightX-6, wy(maxY));
        ctx.stroke();

        // Area/depth label inside
        ctx.fillStyle = "rgba(255,204,0,0.85)";
        ctx.font = "10px monospace";
        ctx.fillText(`A=${poolMetrics.area.toFixed(3)} m²`, wx((minX+maxX)/2), wy((minY+maxY)/2)-8);
        ctx.fillText(`D=${Number(params.depth || 0).toFixed(3)} m`, wx((minX+maxX)/2), wy((minY+maxY)/2)+8);
      }

      if(geometry.type === "circle") {
        const cx = wx(geometry.center.x);
        const cy = wy(geometry.center.y);
        const r = geometry.radius * zoom;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + r, cy);
        ctx.stroke();
        arrow(cx + r, cy, "left");
        ctx.fillText(`R ${geometry.radius.toFixed(3)} m`, cx + r/2, cy - 12);
        ctx.fillText(`Ø ${(geometry.radius*2).toFixed(3)} m`, cx, cy + r + 16);
      }

      if(geometry.type === "ellipse") {
        const cx = wx(geometry.center.x);
        const cy = wy(geometry.center.y);
        ctx.beginPath();
        ctx.moveTo(cx - geometry.rx*zoom, cy - geometry.ry*zoom - 24);
        ctx.lineTo(cx + geometry.rx*zoom, cy - geometry.ry*zoom - 24);
        ctx.stroke();
        arrow(cx - geometry.rx*zoom, cy - geometry.ry*zoom - 24, "right");
        arrow(cx + geometry.rx*zoom, cy - geometry.ry*zoom - 24, "left");
        ctx.fillText(`${(geometry.rx*2).toFixed(3)} m`, cx, cy - geometry.ry*zoom - 36);

        ctx.beginPath();
        ctx.moveTo(cx + geometry.rx*zoom + 24, cy - geometry.ry*zoom);
        ctx.lineTo(cx + geometry.rx*zoom + 24, cy + geometry.ry*zoom);
        ctx.stroke();
        arrow(cx + geometry.rx*zoom + 24, cy - geometry.ry*zoom, "down");
        arrow(cx + geometry.rx*zoom + 24, cy + geometry.ry*zoom, "up");
      }

      ctx.restore();
    }
  }

  // AF-NEXT-010: other basins (dashed) and every basin's islands.
  if (isLayerVisible("pool_outline")) drawBasinOverlay(ctx, basins, activeBasinIndex, { wx, wy, zoom });

  // Validated depth-zone polygons. These are real project geometry, not just a
  // fixture tag, and participate in the volume calculation.
  if (showDepth) {
    depthZones.filter((zone) => zone.points?.length >= 3).forEach((zone) => {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(wx(zone.points[0].x), wy(zone.points[0].y));
      zone.points.slice(1).forEach((point) => ctx.lineTo(wx(point.x), wy(point.y)));
      ctx.closePath();
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = zone.color || "#0077b6";
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = zone.color || "#7ec8e3";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const cx = zone.points.reduce((sum, point) => sum + point.x, 0) / zone.points.length;
      const cy = zone.points.reduce((sum, point) => sum + point.y, 0) / zone.points.length;
      ctx.fillStyle = "#ffffff";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${zone.label} ${Number(zone.depth).toFixed(2)}m`, wx(cx), wy(cy));
      ctx.restore();
    });
  }

  if (depthDrawPoints.length) {
    const activeZone = depthZones.find((zone) => (zone.zone || zone.key) === depthZone);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(wx(depthDrawPoints[0].x), wy(depthDrawPoints[0].y));
    depthDrawPoints.slice(1).forEach((point) => ctx.lineTo(wx(point.x), wy(point.y)));
    if (drawPreview) ctx.lineTo(wx(drawPreview.x), wy(drawPreview.y));
    ctx.strokeStyle = activeZone?.color || "#ffcc00";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    depthDrawPoints.forEach((point) => {
      ctx.beginPath();
      ctx.arc(wx(point.x), wy(point.y), 4, 0, Math.PI * 2);
      ctx.fillStyle = activeZone?.color || "#ffcc00";
      ctx.fill();
    });
    ctx.restore();
  }

  // Freeform drawing preview
  if(freeformPoints.length > 0) {
    ctx.beginPath();
    ctx.moveTo(wx(freeformPoints[0].x), wy(freeformPoints[0].y));
    freeformPoints.forEach(p => ctx.lineTo(wx(p.x), wy(p.y)));
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 2;
    ctx.setLineDash([5,3]);
    ctx.stroke();
    ctx.setLineDash([]);
    freeformPoints.forEach(p => {
      ctx.beginPath();
      ctx.arc(wx(p.x), wy(p.y), 4, 0, Math.PI*2);
      ctx.fillStyle = "#ffcc00";
      ctx.fill();
    });
  }

  // CAD drawing preview
  if(drawPreview) {
    ctx.save();
    ctx.strokeStyle = "#ffcc00";
    ctx.fillStyle = "rgba(255,204,0,0.08)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6,4]);

    if(tool === "rectangle" && drawStart) {
      const minX = Math.min(drawStart.x, drawPreview.x);
      const maxX = Math.max(drawStart.x, drawPreview.x);
      const minY = Math.min(drawStart.y, drawPreview.y);
      const maxY = Math.max(drawStart.y, drawPreview.y);
      ctx.strokeRect(wx(minX), wy(minY), (maxX-minX)*zoom, (maxY-minY)*zoom);
      ctx.fillRect(wx(minX), wy(minY), (maxX-minX)*zoom, (maxY-minY)*zoom);
    }

    if(tool === "circle" && drawStart) {
      const r = Math.sqrt((drawPreview.x-drawStart.x)**2 + (drawPreview.y-drawStart.y)**2);
      ctx.beginPath();
      ctx.arc(wx(drawStart.x), wy(drawStart.y), r*zoom, 0, Math.PI*2);
      ctx.stroke();
      ctx.fill();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(wx(drawStart.x), wy(drawStart.y));
      ctx.lineTo(wx(drawPreview.x), wy(drawPreview.y));
      ctx.stroke();
    }

    if(tool === "polyline" && polylinePoints.length) {
      ctx.beginPath();
      ctx.moveTo(wx(polylinePoints[0].x), wy(polylinePoints[0].y));
      polylinePoints.forEach(p => ctx.lineTo(wx(p.x), wy(p.y)));
      ctx.lineTo(wx(drawPreview.x), wy(drawPreview.y));
      ctx.stroke();
      polylinePoints.forEach(p => {
        ctx.beginPath();
        ctx.arc(wx(p.x), wy(p.y), 4, 0, Math.PI*2);
        ctx.fillStyle = "#ffcc00";
        ctx.fill();
      });
    }

    ctx.restore();
  }

  // Draw fixtures using PROFESSIONAL ENGINEERING SYMBOLS
  fixtures.forEach((f, i) => {
    const fixtureLayer = (() => {
      const t = (f.type || "").toLowerCase();
      if (t.includes("light") || t.includes("laser")) return "lights";
      if (t.includes("nozzle") || t.includes("jet") || t.includes("geyser") || t.includes("foam") || t.includes("mist")) return "nozzles";
      if (t.includes("pump") || t.includes("valve") || t.includes("solenoid") || t.includes("drain") ||
          t.includes("sensor") || t.includes("filter") || t.includes("uv") || t.includes("dosing") ||
          t.includes("vfd") || t.includes("motion")) return "equipment";
      return "equipment";
    })();

    if (!isLayerVisible(fixtureLayer)) return;

    const isSelected = selectedFixture === i || (selectedKeys ? selectedKeys.has(String(entityKey(f))) : false);
    const cx = wx(f.x), cy = wy(f.y);

    const symbol = getEngineeringSymbol(f.type);
    const rotation = f.rotation || 0;
    const scale = Math.max(0.7, Math.min(1.4, zoom / 30));

    if (isSelected) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 18 * scale, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,204,0,0.10)";
      ctx.fill();
      ctx.strokeStyle = "#ffcc00";
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 3]);
      ctx.shadowBlur = 14;
      ctx.shadowColor = "#ffcc00";
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.shadowBlur = 12;
      ctx.shadowColor = symbol.color;
      drawEngSymbol(ctx, cx, cy, rotation, scale * 1.18, true, symbol);
      ctx.restore();
    }

    drawEngSymbol(ctx, cx, cy, rotation, scale, isSelected, symbol);

    if (isSelected || zoom > 35) {
      ctx.fillStyle = symbol.color;
      ctx.font = `${Math.max(9, zoom * 0.24)}px monospace`;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(f.label || symbol.type, cx + 12, cy - 8);
    }
  });

  // Measurements
  if(isLayerVisible("measurements")) measurements.forEach(m => {
    ctx.beginPath();
    ctx.moveTo(wx(m.x1), wy(m.y1));
    ctx.lineTo(wx(m.x2), wy(m.y2));
    ctx.strokeStyle = "#ffcc00";
    ctx.lineWidth = 1;
    ctx.setLineDash([4,2]);
    ctx.stroke();
    ctx.setLineDash([]);
    const dist = Math.sqrt((m.x2-m.x1)**2 + (m.y2-m.y1)**2);
    const mx = (m.x1+m.x2)/2, my = (m.y1+m.y2)/2;
    ctx.fillStyle = "#ffcc00";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${dist.toFixed(2)}m`, wx(mx), wy(my)-8);
  });

  // Coordinate display
  ctx.fillStyle = "#334455";
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`0,0`, pan.x+2, pan.y-4);

  drawDraftingOverlays(ctx, s, { wx, wy });
}
