// AF-NEXT-014 — top-bar switcher for the four guided workspaces.
import { WORKSPACES } from "../../workspaces/workspaceModel";
import "./workspace.css";

export default function WorkspaceSwitcher({ workspace, onSelect, onStart }) {
  return (
    <div className="ws-switcher" role="tablist" aria-label="Workspaces">
      {WORKSPACES.map((w, i) => (
        <button
          key={w.id}
          type="button"
          role="tab"
          aria-selected={workspace === w.id}
          data-workspace={w.id}
          title={w.hint}
          className={`ws-switcher-tab${workspace === w.id ? " is-active" : ""}`}
          onClick={() => onSelect(w.id)}
        >
          <span className="ws-switcher-step">{i + 1}</span>{w.label}
        </button>
      ))}
      {onStart && (
        <button type="button" className="ws-switcher-start" onClick={onStart} title="Open the pilot sample, import a drawing or open a project">
          Start
        </button>
      )}
    </div>
  );
}
