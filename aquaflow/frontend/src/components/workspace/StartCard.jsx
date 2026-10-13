// AF-NEXT-014 — Start card: open the Lebu pilot, import a CAD drawing, open a project
// file, or continue. Shown on first run and from the top-bar "Start" button.
import { useEffect } from "react";
import "./workspace.css";

export default function StartCard({ onOpenPilot, onImportCad, onOpenProject, onClose, pilotState = {} }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="ws-start-overlay" role="dialog" aria-modal="true" aria-labelledby="ws-start-title" onMouseDown={onClose}>
      <div className="ws-start-card" onMouseDown={e => e.stopPropagation()}>
        <div className="ws-start-head">
          <h2 id="ws-start-title">Start a fountain project</h2>
          <button type="button" className="btn" onClick={onClose}>Close · Esc</button>
        </div>
        <p className="ws-start-intro">
          AquaFlow is organised as four steps: <b>Design</b> the site, <b>Program</b> the show, <b>Commission</b> the
          controller and <b>Operate</b>. Each workspace shows a checklist for your project.
        </p>
        <div className="ws-start-grid">
          <div className="ws-start-option">
            <h3>Lebu fountain pilot</h3>
            <p>A complete sample: DWG-derived basin, 39 fixtures, groups and a 60 s pattern show. Its hardware is
              <b> unmapped</b> — it is a design and programming sample, not a commissioned site.</p>
            <button type="button" className="btn primary" disabled={pilotState.busy} onClick={onOpenPilot}>
              {pilotState.busy ? "Opening…" : "Open the pilot"}
            </button>
            {pilotState.error && <div className="ws-guidance-error" role="alert">Could not open the pilot: {pilotState.error}</div>}
          </div>
          <div className="ws-start-option">
            <h3>Import a CAD drawing</h3>
            <p>Bring in your site DWG/DXF. You confirm units, basins and fixture types before anything is applied.</p>
            <button type="button" className="btn" onClick={onImportCad}>Import CAD…</button>
          </div>
          <div className="ws-start-option">
            <h3>Open a project</h3>
            <p>Open a saved .aqua or .aquapkg project. Missing assets are reported before playback.</p>
            <button type="button" className="btn" onClick={onOpenProject}>Open project…</button>
          </div>
        </div>
        <div className="ws-start-foot">
          <button type="button" className="btn" onClick={onClose}>Continue with the current project</button>
        </div>
      </div>
    </div>
  );
}
