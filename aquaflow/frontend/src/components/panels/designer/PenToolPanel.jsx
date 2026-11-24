/**
 * designer/PenToolPanel.jsx — Pen (freehand) tool UI for the Engineering Designer:
 *   - PenSettingsPanel: sidebar settings while the Pen tool is active;
 *   - PenResultBar: floating "fix and edit" bar over the plan after a stroke is committed.
 * The geometry work is in engineering/drafting/freehand.js; the designer owns the state.
 * Styling: CSS classes in ui/ui.css (Pen tool block), tokens only.
 */
import React from "react";
import { Checkbox, Select, Slider } from "../../../ui";
import { PEN_KIND_LABEL } from "../../../engineering/drafting/freehand";

export const PEN_TARGETS = [
  { value: "pool", label: "Basin outline" },
  { value: "land", label: "Land / site surface" },
  { value: "depth", label: "Depth zone (inside the basin)" },
  { value: "guide", label: "Guide line (for arrays)" },
];
export const PEN_TARGET_LABEL = { pool: "basin outline", land: "land surface", depth: "depth zone", guide: "guide line" };

export function PenSettingsPanel({ settings, onChange, landTypes = [], landSurfaceType, onLandSurfaceType, depthZones = [], depthZone, onDepthZone, snapAvailable }) {
  const set = (key) => (value) => onChange({ ...settings, [key]: value });
  const toggle = (key) => (event) => onChange({ ...settings, [key]: event.target.checked });
  return (
    <section className="pen-settings" aria-label="Pen settings">
      <div className="pen-settings-title">PEN SETTINGS</div>
      <label className="pen-field">
        <span>Stroke becomes</span>
        <Select aria-label="Pen stroke becomes" value={settings.target} options={PEN_TARGETS} onChange={(event) => set("target")(event.target.value)} />
      </label>
      {settings.target === "land" && (
        <label className="pen-field">
          <span>Material</span>
          <Select aria-label="Pen land material" value={landSurfaceType} options={landTypes.map((t) => ({ value: t.key, label: t.label }))} onChange={(event) => onLandSurfaceType(event.target.value)} />
        </label>
      )}
      {settings.target === "depth" && (
        <label className="pen-field">
          <span>Depth zone</span>
          <Select aria-label="Pen depth zone" value={depthZone} options={depthZones.map((z) => ({ value: z.key, label: `${z.label} · ${z.depth} m` }))} onChange={(event) => onDepthZone(event.target.value)} />
        </label>
      )}
      <div className="pen-field">
        <span>Smoothing <small>accurate ↔ smooth</small></span>
        <Slider label="Pen smoothing" value={settings.smoothing} min={0} max={100} step={5} onChange={set("smoothing")} />
      </div>
      <Checkbox label="Recognise shapes (circle, ellipse, rectangle, line)" checked={settings.recognise} onChange={toggle("recognise")} />
      <Checkbox label="Keep sharp corners" checked={settings.keepCorners} onChange={toggle("keepCorners")} />
      <Checkbox label="Auto-close" checked={settings.autoClose} onChange={toggle("autoClose")} />
      <div className="pen-field">
        <span>Close gap up to</span>
        <Slider label="Pen auto-close distance" value={settings.closePx} min={5} max={120} step={5} units=" px" onChange={set("closePx")} />
      </div>
      <Checkbox label={`Snap corners to grid / objects${snapAvailable ? "" : " (turn SNAP or OSNAP on)"}`} checked={settings.snap} onChange={toggle("snap")} />
      <div className="pen-hint">Draw with mouse, pen or touch · lift to clean up · hold still before lifting for a perfect shape · Space-drag pans</div>
    </section>
  );
}

export function PenResultBar({ result, onSmooth, onPerfect, onStraighten, onAsDrawn, onUndoFix, onAccept }) {
  if (!result) return null;
  const { target, kind, vertices, notes = [], fit, history = [] } = result;
  return (
    <div className="pen-result-bar" role="toolbar" aria-label="Pen result">
      <span className="pen-result-label">
        Pen → {PEN_TARGET_LABEL[target] || target}: <strong>{PEN_KIND_LABEL[kind] || kind}</strong> · {vertices} pts
        {notes.length ? ` · ${notes.join(" · ")}` : ""}
      </span>
      <button type="button" onClick={() => onSmooth(-20)} disabled={fit.smoothing <= 0} title="Follow the stroke more closely">Smooth less</button>
      <span className="pen-result-value" aria-label="Smoothing">{fit.smoothing}</span>
      <button type="button" onClick={() => onSmooth(20)} disabled={fit.smoothing >= 100} title="Smoother curve, fewer points">Smooth more</button>
      <button type="button" onClick={onPerfect} title="Snap to the closest circle, ellipse, rectangle, polygon or straight line">Make perfect shape</button>
      <button type="button" onClick={onStraighten} title="Straight edges between the corners">Straighten edges</button>
      <button type="button" onClick={onAsDrawn} title="No shape recognition, light smoothing">As drawn</button>
      <button type="button" onClick={onUndoFix} disabled={!history.length} title="Back to the previous fix">Undo fix</button>
      <button type="button" className="is-primary" onClick={onAccept} title="Keep this result (edit it later with the vertex grips)">Accept</button>
    </div>
  );
}
