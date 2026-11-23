// Side-panel layout for the full-screen workspaces (Engineering Designer, Easy Fountain Design).
// Those workspaces keep their own internal arrangement; this gives their side panels the same
// dock behaviour as the standard workspace: resize, collapse, swap side, persist, reset.
import { useCallback, useEffect, useState } from 'react';

const KEY = id => `aquaflow.panels.v1.${id}`;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** defaults: { [panel]: { size, min = 160, max = 640 } } plus optional { swapped }. */
export function validatePanelLayout(raw, defaults) {
  const out = { swapped: raw?.swapped === true, panels: {} };
  for (const [name, d] of Object.entries(defaults.panels)) {
    const r = raw?.panels?.[name] || {};
    const size = Number(r.size);
    out.panels[name] = { size: Number.isFinite(size) ? clamp(size, d.min ?? 160, d.max ?? 640) : d.size, collapsed: r.collapsed === true };
  }
  return out;
}

export function resizePanel(layout, name, delta, defaults) {
  const d = defaults.panels[name], p = layout.panels[name];
  return { ...layout, panels: { ...layout.panels, [name]: { ...p, collapsed: false, size: clamp(p.size + delta, d.min ?? 160, d.max ?? 640) } } };
}

export function togglePanel(layout, name) {
  const p = layout.panels[name];
  return { ...layout, panels: { ...layout.panels, [name]: { ...p, collapsed: !p.collapsed } } };
}

/** Size the panel occupies on screen (a collapsed panel keeps a 28 px strip for its toggle). */
export const shownSize = p => (p.collapsed ? 28 : p.size);

export function usePanelLayout(id, defaults, storage = globalThis.localStorage) {
  const [layout, setLayout] = useState(() => {
    try { return validatePanelLayout(JSON.parse(storage?.getItem(KEY(id)) || 'null'), defaults); }
    catch { return validatePanelLayout(null, defaults); }
  });
  useEffect(() => { try { storage?.setItem(KEY(id), JSON.stringify(layout)); } catch { /* storage unavailable */ } }, [id, layout, storage]);
  useEffect(() => {
    const reset = () => setLayout(validatePanelLayout(null, defaults));
    window.addEventListener('aquaflow:reset-layout', reset);
    return () => window.removeEventListener('aquaflow:reset-layout', reset);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    layout,
    resize: useCallback((name, delta) => setLayout(l => resizePanel(l, name, delta, defaults)), []), // eslint-disable-line react-hooks/exhaustive-deps
    toggle: useCallback(name => setLayout(l => togglePanel(l, name)), []),
    swap: useCallback(() => setLayout(l => ({ ...l, swapped: !l.swapped })), []),
  };
}
