// AquaFlow Studio — Electron main process.
//
// AF-PKG-001 scaffolding: an intentionally minimal shell. It shows a blank branded
// window and does NOT yet launch the backend or load the frontend — that arrives in
// AF-PKG-003 (frontend) and AF-PKG-004 (startup orchestration). Keeping this stage a
// pure skeleton makes each later task independently verifiable.

const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

// LuxuryCon brand.
const BRAND = { forest: "#0D2A1A", gold: "#C9A227" };

// AF-PKG-003 — the built frontend lives in web/ (produced by scripts/build-web.js).
const WEB_INDEX = path.join(__dirname, "web", "index.html");

let mainWindow = null;

// The backend base URL is passed to the renderer as query params the frontend's config
// override chain already honours (src/config.js). In AF-PKG-003 there is no backend yet,
// so this is empty; AF-PKG-004 fills it with the launched engine's host:port.
function webQuery() {
  const base = process.env.AQUAFLOW_RENDERER_API_BASE || "";
  const ws = process.env.AQUAFLOW_RENDERER_WS_URL || "";
  const q = {};
  if (base) q.api = base;
  if (ws) q.ws = ws;
  return q;
}

const SCAFFOLD_HTML =
  "data:text/html;charset=utf-8," +
  encodeURIComponent(
    `<!doctype html><html><body style="margin:0;height:100vh;display:flex;` +
      `align-items:center;justify-content:center;background:${BRAND.forest};` +
      `color:${BRAND.gold};font-family:system-ui,sans-serif">` +
      `<div style="text-align:center"><div style="font-size:28px;font-weight:700;` +
      `letter-spacing:.1em">AquaFlow Studio</div>` +
      `<div style="opacity:.7;margin-top:8px">LuxuryCon · desktop shell — run ` +
      `<code>npm run build:web</code> to bundle the UI</div></div></body></html>`
  );

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: BRAND.forest,
    title: "AquaFlow Studio — LuxuryCon",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // AF-PKG-003 — load the local production frontend build if present (loaded from disk,
  // not a URL), passing the backend api/ws as query params. Falls back to the branded
  // scaffold placeholder if the UI has not been built yet.
  if (fs.existsSync(WEB_INDEX)) {
    mainWindow.loadFile(WEB_INDEX, { query: webQuery() });
  } else {
    mainWindow.loadURL(SCAFFOLD_HTML);
  }

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  // Windows/Linux: quit when all windows are closed.
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
