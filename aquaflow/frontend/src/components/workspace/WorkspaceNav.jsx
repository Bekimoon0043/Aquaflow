// AF-NEXT-014 — left navigation for the active workspace. Primary tools first, then
// "More in <workspace>" (advanced/legacy panels stay discoverable here), then Help.
import { useState } from "react";
import { HELP_ENTRIES, getWorkspace } from "../../workspaces/workspaceModel";
import "./workspace.css";

const COLLAPSE_KEY = "aquaflow.workspace.navCollapsed";
const readCollapsed = () => { try { return window.localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; } };

function NavButton({ entry, activePanel, onOpen }) {
  const active = entry.target.panel === activePanel;
  return (
    <li>
      <button
        type="button"
        className={`ws-nav-item${active ? " is-active" : ""}`}
        aria-current={active ? "page" : undefined}
        data-panel={entry.target.panel}
        onClick={() => onOpen(entry.target)}
      >
        {entry.label}
      </button>
    </li>
  );
}

export default function WorkspaceNav({ workspace, activePanel, onOpen }) {
  const ws = getWorkspace(workspace);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const moreActive = ws.more.some(e => e.target.panel === activePanel);
  const [showMore, setShowMore] = useState(false);
  const toggle = () => setCollapsed(v => {
    try { window.localStorage.setItem(COLLAPSE_KEY, v ? "0" : "1"); } catch { /* ignore */ }
    return !v;
  });

  if (collapsed) {
    return (
      <nav className="ws-nav is-collapsed" aria-label={`${ws.label} tools`}>
        <button type="button" className="ws-nav-collapse" onClick={toggle} title={`Show ${ws.label} tools`} aria-label={`Show ${ws.label} tools`}>»</button>
        <span className="ws-nav-vertical">{ws.label}</span>
      </nav>
    );
  }

  return (
    <nav className="ws-nav" aria-label={`${ws.label} tools`} data-workspace={ws.id}>
      <div className="ws-nav-head">
        <div>
          <div className="ws-nav-title">{ws.label}</div>
          <div className="ws-nav-hint">{ws.hint}</div>
        </div>
        <button type="button" className="ws-nav-collapse" onClick={toggle} title="Hide this list" aria-label={`Hide ${ws.label} tools`}>«</button>
      </div>
      <ul className="ws-nav-list">
        {ws.nav.map(e => <NavButton key={e.id} entry={e} activePanel={activePanel} onOpen={onOpen} />)}
      </ul>
      <button type="button" className="ws-nav-more" aria-expanded={showMore || moreActive} onClick={() => setShowMore(!(showMore || moreActive))}>
        {showMore || moreActive ? "▾" : "▸"} More in {ws.label} ({ws.more.length})
      </button>
      {(showMore || moreActive) && (
        <ul className="ws-nav-list ws-nav-list--more" aria-label={`More in ${ws.label}`}>
          {ws.more.map(e => <NavButton key={e.id} entry={e} activePanel={activePanel} onOpen={onOpen} />)}
        </ul>
      )}
      <div className="ws-nav-spacer" />
      <ul className="ws-nav-list ws-nav-list--help" aria-label="Help">
        {HELP_ENTRIES.map(e => <NavButton key={e.id} entry={e} activePanel={activePanel} onOpen={onOpen} />)}
      </ul>
    </nav>
  );
}
