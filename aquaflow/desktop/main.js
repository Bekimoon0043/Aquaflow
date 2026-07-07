// AquaFlow Studio — Electron main process.
//
// AF-PKG-001 scaffolding: an intentionally minimal shell. It shows a blank branded
// window and does NOT yet launch the backend or load the frontend — that arrives in
// AF-PKG-003 (frontend) and AF-PKG-004 (startup orchestration). Keeping this stage a
// pure skeleton makes each later task independently verifiable.

const { app, BrowserWindow } = require("electron");

// LuxuryCon brand.
const BRAND = { forest: "#0D2A1A", gold: "#C9A227" };

let mainWindow = null;

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
      preload: require("path").join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // AF-PKG-001: blank shell only. A branded placeholder so the window is not an
  // empty white box; real content is loaded in AF-PKG-003.
  mainWindow.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<!doctype html><html><body style="margin:0;height:100vh;display:flex;` +
          `align-items:center;justify-content:center;background:${BRAND.forest};` +
          `color:${BRAND.gold};font-family:system-ui,sans-serif">` +
          `<div style="text-align:center"><div style="font-size:28px;font-weight:700;` +
          `letter-spacing:.1em">AquaFlow Studio</div>` +
          `<div style="opacity:.7;margin-top:8px">LuxuryCon · desktop shell (scaffold)</div>` +
          `</div></body></html>`
      )
  );

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
