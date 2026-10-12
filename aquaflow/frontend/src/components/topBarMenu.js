// topBarMenu.js — pure menu definitions + action wiring for TopBar.
//
// Kept free of React/store imports so the "every menu item does something" contract can be
// unit-tested: each "action" entry in MENU_ITEMS must map to a handler built by
// createMenuActionHandlers(), and edit commands nobody handled produce a visible notice.

export const MENU_ITEMS = {
  File: [
    ["New Show", "action", "New Show"],
    ["Open Show...", "action", "Open Show..."],
    ["Save", "action", "Save"],
    ["Save As...", "action", "Save As..."],
    ["---", "separator"],
    ["Import Audio", "action", "Import Audio"],
    ["Import Show (.aqua file)...", "action", "Import Show"],
    ["Export Show (.aqua file)", "action", "Export Show"],
    ["---", "separator"],
    ["Preferences...", "action", "Preferences"],
  ],
  Edit: [
    ["Undo", "action", "Undo", "Ctrl+Z"],
    ["Redo", "action", "Redo", "Ctrl+Y"],
    ["---", "separator"],
    ["Cut", "action", "Cut", "Ctrl+X"],
    ["Copy", "action", "Copy", "Ctrl+C"],
    ["Paste", "action", "Paste", "Ctrl+V"],
    ["Delete", "action", "Delete", "Del"],
    ["---", "separator"],
    ["Select All", "action", "Select All", "Ctrl+A"],
    ["Deselect All", "action", "Deselect All", "Esc"],
  ],
  Design: [
    ["Nodes", "panel", "nodes"],
    ["3D Preview", "panel", "preview"],
    ["Keyframes", "panel", "keyframes"],
    ["Presets", "panel", "presets"],
    ["Engineering Designer", "panel", "geometry"],
    ["Pattern Designer", "panel", "patterns"],
    ["Show Programmer", "panel", "show_programmer"],
    ["Engineering Tools", "panel", "engtools"],
    ["Collaboration", "panel", "collab"],
    ["Environments & Materials", "panel", "envmaterial"],
    ["3D Export", "panel", "export3d"],
    ["---", "separator"],
    ["Add Node", "action", "Add Node"],
    ["Toggle Grid", "action", "Toggle Grid"],
    ["Toggle Snap", "action", "Toggle Snap"],
    ["Reset Layout", "action", "Reset Layout"],
  ],
  Devices: [
    ["Device Discovery", "panel", "devices"],
    ["Fountain Control (I-CAN)", "panel", "fountain"],
    ["Audio", "panel", "audio"],
    ["PLC", "panel", "plc"],
    ["Calibration", "panel", "calibration"],
    ["Dependencies", "panel", "dependencies"],
    ["---", "separator"],
    ["Scan Network", "action", "Scan Network"],
    ["Hardware Test...", "action", "Hardware Test..."],
  ],
  Runtime: [
    ["Scheduler", "panel", "scheduler"],
    ["Safety Monitor", "panel", "safety"],
    ["Operator", "panel", "operator"],
    ["Live Validation", "panel", "validation"],
    ["Wind Drift Safety", "panel", "wind"],
    ["Mobile Monitoring", "panel", "mobilemon"],
    ["Digital Twin", "panel", "twin"],
    ["Autonomous Adaptation", "panel", "adaptation"],
    ["Fleet Management", "panel", "fleet"],
    ["Global Asset Cloud", "panel", "cloud"],
    ["Diagnostics", "panel", "diagnostics"],
    ["Compile", "panel", "compile"],
    ["---", "separator"],
    ["Add Track", "action", "Add Track"],
    ["Quantize", "action", "Quantize"],
    ["Emergency Stop", "action", "Emergency Stop"],
  ],
  AI: [
    ["AI / Music Show Builder", "action", "AI Show Builder"],
    ["AI Assistant (learned patterns)", "panel", "ai"],
    ["AI Optimization", "panel", "optimize"],
    ["Generative Designer", "panel", "generative"],
  ],
  Help: [
    ["Documentation Center", "panel", "docs"],
    ["Training Academy", "panel", "academy"],
    ["Keyboard Shortcuts", "action", "Keyboard Shortcuts", "?"],
    ["---", "separator"],
    ["About AquaFlow", "action", "About AquaFlow"],
  ],
};

/** Every action id used by MENU_ITEMS (deduplicated, in menu order). */
export function menuActionIds(menu = MENU_ITEMS) {
  const ids = [];
  Object.values(menu).forEach((entries) => entries.forEach(([label, type, value]) => {
    if (type === "action") ids.push(value || label);
  }));
  return [...new Set(ids)];
}

/** Human label for a panel id, taken from the menu (falls back to the id). */
export function panelLabel(panelId, menu = MENU_ITEMS) {
  for (const entries of Object.values(menu)) {
    const hit = entries.find(([, type, value]) => type === "panel" && value === panelId);
    if (hit) return hit[0];
  }
  if (panelId === "show_programmer") return "Show Programmer";
  return panelId || "this view";
}

export const EDIT_COMMAND_LABELS = {
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select All",
  delete: "Delete",
  deselect: "Deselect All",
};

// The Node editor, Engineering designer and global Timeline already act on delete /
// deselect but predate the `handled` flag. The Timeline is mounted under every standard
// panel, so those two commands are always serviced outside Show Programming.
const LEGACY_DELETE_DESELECT = new Set(["delete", "deselect"]);

/**
 * Decide the notice for an `aquaflow:edit-command` dispatch.
 * Returns null when the command was handled, else a short user-facing message.
 */
export function editCommandNotice(command, { handled = false, activePanel } = {}) {
  if (handled) return null;
  if (LEGACY_DELETE_DESELECT.has(command) && activePanel && activePanel !== "show_programmer") return null;
  const label = EDIT_COMMAND_LABELS[command] || command;
  return `${label} isn't available in ${panelLabel(activePanel)}`;
}

/** Parse the desktop app version Electron puts in the user agent ("<App>/1.2.3 Chrome/x Electron/y"). */
export function desktopVersionFromUserAgent(ua = "") {
  const m = /\/(\d+\.\d+\.\d+[\w.+-]*)\s+Chrome\/[\d.]+\s+Electron\//.exec(String(ua));
  return m ? m[1] : null;
}

/**
 * Call `dispatch` (which returns true once a listener handled it) until it succeeds or
 * `tries` run out. Used for events aimed at lazily mounted panels. Resolves to handled.
 */
export function retryDispatch(dispatch, { tries = 30, interval = 100, schedule = (fn, ms) => setTimeout(fn, ms) } = {}) {
  return new Promise((resolve) => {
    let left = tries;
    const attempt = () => {
      if (dispatch()) return resolve(true);
      left -= 1;
      if (left <= 0) return resolve(false);
      schedule(attempt, interval);
    };
    schedule(attempt, 0);
  });
}

/**
 * Build the action-id → handler map. `deps` supplies the side effects so the mapping is
 * testable without React or stores.
 */
export function createMenuActionHandlers(deps) {
  const d = deps;
  return {
    "New Show": () => d.openBrowser("new"),
    "Open Show...": () => d.openBrowser("open"),
    "Save": () => d.openBrowser("save"),
    "Save As...": () => d.openBrowser("save"),
    "Import Audio": () => d.setActivePanel("audio"),
    "Import Show": () => d.importShow(),
    "Export Show": () => d.exportShow(),
    "Preferences": () => d.showPreferences(),
    "Undo": () => d.undo(),
    "Redo": () => d.redo(),
    "Cut": () => d.editCommand("cut"),
    "Copy": () => d.editCommand("copy"),
    "Paste": () => d.editCommand("paste"),
    "Delete": () => d.editCommand("delete"),
    "Select All": () => d.editCommand("selectAll"),
    "Deselect All": () => d.editCommand("deselect"),
    "Add Node": () => {
      d.setActivePanel("nodes");
      d.emit("aquaflow:add-node-request");
    },
    "Toggle Grid": () => d.toggleShowGrid(),
    "Toggle Snap": () => d.toggleSnapToGrid(),
    "Reset Layout": () => {
      d.setActivePanel("nodes");
      d.emit("aquaflow:reset-node-editor");
    },
    "Scan Network": () => {
      d.setActivePanel("devices");
      d.defer(() => d.emit("aquaflow:open-device-tab", { tab: "controllers" }));
    },
    "Hardware Test...": () => {
      d.setActivePanel("devices");
      d.defer(() => d.emit("aquaflow:open-device-tab", { tab: "test" }));
    },
    "Add Track": () => d.addTimelineTrack(),
    "Quantize": () => d.quantizeTimeline(),
    "Emergency Stop": () => d.emergencyStop(),
    "AI Show Builder": () => {
      d.setActivePanel("show_programmer");
      // Show Programming is lazy-loaded; openShowAi re-dispatches until it is mounted.
      d.openShowAi();
    },
    "Keyboard Shortcuts": () => d.showShortcuts(),
    "About AquaFlow": () => d.showAbout(),
  };
}
