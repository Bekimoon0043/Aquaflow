import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WORKSPACES, getWorkspace } from "../../workspaces/workspaceModel";
import "./workspace.css";

export default function DesktopWorkspaces({ workspace, activePanel, onSelect, onOpen, onStart }) {
  const [open, setOpen] = useState(null);
  const [position, setPosition] = useState({ left: 8, top: 72 });
  const root = useRef(null), menu = useRef(null), triggers = useRef({});
  const focusMenu = useRef(false);
  const close = (restore = false) => {
    if (restore) triggers.current[open]?.focus();
    setOpen(null);
  };
  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggers.current[open].getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 304)), top: rect.bottom + 2 });
    if (focusMenu.current) menu.current?.querySelector('[role="menuitem"]')?.focus();
    focusMenu.current = false;
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const dismiss = e => {
      if (!root.current?.contains(e.target) && !menu.current?.contains(e.target)) setOpen(null);
    };
    const key = e => {
      if (e.key === 'Escape') { e.preventDefault(); triggers.current[open]?.focus(); setOpen(null); }
    };
    const resize = () => setOpen(null);
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', resize);
    };
  }, [open]);
  const select = id => { onSelect(id); setOpen(onOpen && open !== id ? id : null); };
  const menuKey = e => {
    const buttons = [...menu.current.querySelectorAll('[role="menuitem"]')];
    const index = buttons.indexOf(document.activeElement);
    let next;
    if (e.key === 'ArrowDown') next = (index + 1) % buttons.length;
    if (e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = buttons.length - 1;
    if (next !== undefined) { e.preventDefault(); buttons[next]?.focus(); }
    if (e.key === 'Tab') close();
  };
  const current = open && getWorkspace(open);
  const entryButton = entry => (
    <button key={entry.id} type="button" role="menuitem" className="ws-menu-item"
      data-panel={entry.target.panel} aria-current={activePanel === entry.target.panel && !entry.target.action ? 'page' : undefined}
      onClick={() => { close(true); onOpen(entry.target); }}>
      <span>{entry.label.replace(' (legacy)', '')}</span>
      {activePanel === entry.target.panel && !entry.target.action && <span aria-hidden="true">✓</span>}
    </button>
  );
  return (
    <div className="ws-switcher" ref={root}>
      <div className="ws-tabs" role="tablist" aria-label="Workspaces">
        {WORKSPACES.map(w => (
          <button key={w.id} type="button" role="tab" aria-selected={workspace === w.id}
            aria-haspopup={onOpen ? 'menu' : undefined} aria-expanded={onOpen ? open === w.id : undefined}
            aria-controls={open === w.id ? `workspace-menu-${w.id}` : undefined}
            tabIndex={workspace === w.id ? 0 : -1}
            ref={el => { triggers.current[w.id] = el; }} data-workspace={w.id} title={w.hint}
            className={`ws-switcher-tab${workspace === w.id ? ' is-active' : ''}`}
            onClick={() => select(w.id)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown' && onOpen) {
                e.preventDefault(); onSelect(w.id);
                if (open === w.id) menu.current?.querySelector('[role="menuitem"]')?.focus();
                else { focusMenu.current = true; setOpen(w.id); }
              }
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                const i = WORKSPACES.findIndex(x => x.id === w.id);
                const next = e.key === 'Home' ? 0 : e.key === 'End' ? WORKSPACES.length - 1
                  : (i + (e.key === 'ArrowRight' ? 1 : -1) + WORKSPACES.length) % WORKSPACES.length;
                const id = WORKSPACES[next].id;
                setOpen(null); onSelect(id); triggers.current[id]?.focus();
              }
            }}>
            {w.label}{onOpen && <span className="ws-tab-chevron" aria-hidden="true">⌄</span>}
          </button>
        ))}
      </div>
      {onStart && <button type="button" className="ws-switcher-start" onClick={() => { close(); onStart(); }}
        title="Open a project or start a new design">Project start</button>}
      {current && createPortal(
        <div ref={menu} id={`workspace-menu-${open}`} className="ws-workspace-menu" role="menu"
          aria-label={`${current.label} tools`} style={{ ...position, maxHeight: `calc(100dvh - ${position.top + 8}px)` }} onKeyDown={menuKey}>
          <div className="ws-menu-caption">{current.label}</div>
          {current.nav.map(entryButton)}
          <div role="separator" className="ws-menu-separator" />
          <div className="ws-menu-caption">Additional editors</div>
          {current.more.map(entryButton)}
        </div>, document.body
      )}
    </div>
  );
}
