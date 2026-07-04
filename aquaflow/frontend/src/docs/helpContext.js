// helpContext.js — AquaFlow context-sensitive help (AQ-S4-006)
//
// Tracks the panel the user was last on so the Documentation Center can open directly
// to that panel's help articles.
let _lastContext = "";

export function setHelpContext(panelKey) {
  if (panelKey && panelKey !== "docs") _lastContext = String(panelKey);
}

export function getHelpContext() {
  return _lastContext;
}
