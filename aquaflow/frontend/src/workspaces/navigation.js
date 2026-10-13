/**
 * navigation.js — AF-NEXT-014 workspace navigation (navigation only; nothing is sent,
 * armed or started).
 *
 * A target is { panel, action?, detail?, fix? }:
 *   - `fix` (a Diagnostic fix) is delegated to preflight/openDiagnosticFix, which already
 *     opens the clip / Engineering item with its pending-focus fallback (AF-NEXT-009).
 *   - `action` (e.g. "tab", "cad-import", "article") is a request for the panel itself.
 *     Panels are lazy and kept alive, so the request is both dispatched as an
 *     `aquaflow:panel-action` event (for a mounted panel) and parked as pending (picked up
 *     by usePanelAction when the panel mounts later) — the same pattern as takePendingFocus.
 */
import { useEffect, useRef } from "react";
import { openDiagnosticFix } from "../preflight/preflight";

export const PANEL_ACTION_EVENT = "aquaflow:panel-action";
const pending = new Map();

const defaultDispatch = (name, detail) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name, { detail }));
};

/** Take (and clear) a parked request for `panel`. */
export function takePanelAction(panel) {
  const value = pending.get(panel) || null;
  pending.delete(panel);
  return value;
}

/** Open a workspace target. Returns a description of what was requested (for tests/logs). */
export function openWorkspaceTarget(target, env = {}) {
  if (!target) return null;
  const dispatch = env.dispatch || defaultDispatch;
  if (target.fix) return openDiagnosticFix({ fix: target.fix, timeMs: null }, { dispatch: env.dispatch });
  if (!target.panel) return null;
  if (target.action) pending.set(target.panel, { action: target.action, detail: target.detail || {} });
  dispatch("aquaflow:open-panel", { panel: target.panel });
  if (target.action) {
    const detail = { panel: target.panel, action: target.action, detail: target.detail || {}, handled: false };
    dispatch(PANEL_ACTION_EVENT, detail);
    if (detail.handled) pending.delete(target.panel);
  }
  return { panel: target.panel, action: target.action || null, detail: target.detail || null };
}

/**
 * Panel side: run `handler({action, detail})` for requests addressed to `panel`, both live
 * events and a request parked before the panel mounted.
 */
export function usePanelAction(panel, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const onAction = (event) => {
      const d = event?.detail;
      if (!d || d.panel !== panel) return;
      pending.delete(panel);
      d.handled = true;
      ref.current?.({ action: d.action, detail: d.detail || {} });
    };
    window.addEventListener(PANEL_ACTION_EVENT, onAction);
    const parked = takePanelAction(panel);
    let timer = null;
    if (parked) timer = setTimeout(() => ref.current?.(parked), 0);
    return () => { window.removeEventListener(PANEL_ACTION_EVENT, onAction); if (timer) clearTimeout(timer); };
  }, [panel]);
}
