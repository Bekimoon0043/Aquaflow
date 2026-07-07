// AquaFlow Studio — Electron main process.
//
// AF-PKG-004 startup orchestration: pick a free port → spawn the backend engine →
// show a branded splash while polling /api/health → open the main window on the local
// frontend build → shut the engine down cleanly on exit. Errors surface as dialogs, not
// crashes. A single-instance lock keeps one process group (also needed for .aquashow in
// AF-PKG-006).

const { app, BrowserWindow, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const { findFreePort, startEngine, waitForHealth, stopEngine } = require("./launcher");
const { resolveConfig } = require("./app-config");
const { buildMenu } = require("./menu");

// LuxuryCon brand.
const BRAND = { forest: "#0D2A1A", gold: "#C9A227" };
const WEB_INDEX = path.join(__dirname, "web", "index.html");
const SPLASH = path.join(__dirname, "splash.html");
const APP_ICON = path.join(__dirname, "build", "icon.png"); // AF-PKG-005 (placeholder)

let mainWindow = null;
let splashWindow = null;
let engine = null; // { child, mode, command }
let enginePort = 0;
let shuttingDown = false;
let pendingOpenPath = null; // AF-PKG-006 — .aquashow path awaiting the ready window

// AF-PKG-006 — extract a .aquashow path from a launch/second-instance argv.
function showPathFromArgv(argv) {
  const arg = (argv || []).find(
    (a) => typeof a === "string" && a.toLowerCase().endsWith(".aquashow")
  );
  return arg && fs.existsSync(arg) ? arg : null;
}

// Deliver an .aquashow to the renderer once it exists; queue it otherwise. A basic
// readability check turns a corrupted/missing file into a dialog rather than a crash.
function handleOpenShow(filePath) {
  if (!filePath) return;
  try {
    if (!fs.existsSync(filePath)) throw new Error("file not found");
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    try {
      dialog.showErrorBox("Cannot open show", `The file could not be read:\n${filePath}`);
    } catch { /* ignore */ }
    return;
  }
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send("open-show", filePath);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingOpenPath = filePath;
  }
}

// ── Single instance ───────────────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    // AF-PKG-006 — a second launch (e.g. double-clicking another .aquashow) forwards its
    // argv here; load it in the existing instance instead of starting a new one.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    handleOpenShow(showPathFromArgv(argv));
  });
  // macOS delivers file opens via this event (kept for a future Tier B mac build).
  app.on("open-file", (e, filePath) => { e.preventDefault(); handleOpenShow(filePath); });
  app.whenReady().then(boot);
}

// ── Splash ──────────────────────────────────────────────────────────────────────
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420, height: 300, frame: false, resizable: false, show: true,
    backgroundColor: BRAND.forest, center: true, alwaysOnTop: true, icon: APP_ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(SPLASH);
}

function setSplashStatus(text) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents
      .executeJavaScript(`window.setSplashStatus && window.setSplashStatus(${JSON.stringify(text)})`)
      .catch(() => {});
  }
}

// ── Main window ───────────────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 680,
    backgroundColor: BRAND.forest, title: "AquaFlow Studio — LuxuryCon",
    icon: APP_ICON, show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });

  const query = {
    api: `http://127.0.0.1:${enginePort}/api`,
    ws: `ws://127.0.0.1:${enginePort}/ws`,
  };

  if (fs.existsSync(WEB_INDEX)) {
    mainWindow.loadFile(WEB_INDEX, { query });
  } else {
    // UI not built — show a clear message instead of a blank/broken window.
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          `<body style="margin:0;height:100vh;display:flex;align-items:center;` +
            `justify-content:center;background:${BRAND.forest};color:${BRAND.gold};` +
            `font-family:system-ui">Frontend not built — run <code>npm run build:web</code>.</body>`
        )
    );
  }

  mainWindow.webContents.once("did-finish-load", () => {
    // AF-PKG-006 — flush a queued .aquashow (from launch argv) once the UI is ready.
    if (pendingOpenPath) { handleOpenShow(pendingOpenPath); pendingOpenPath = null; }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    splashWindow = null;
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Boot sequence ───────────────────────────────────────────────────────────────
async function boot() {
  // AF-PKG-006 — capture a .aquashow passed on the initial launch command line.
  pendingOpenPath = showPathFromArgv(process.argv.slice(1));
  createSplash();
  try {
    const cfg = resolveConfig();
    if (!cfg.hasLicenseSecret) {
      throw new Error(
        "No license secret configured. Provision resources/app-config.json (licenseSecret) " +
          "or set AQUAFLOW_LICENSE_SECRET before launch."
      );
    }

    setSplashStatus("Selecting port…");
    enginePort = await findFreePort(8000);

    setSplashStatus("Starting engine…");
    engine = startEngine({
      port: enginePort,
      licenseSecret: cfg.licenseSecret,
      onLog: (line) => process.stdout.write(`[engine] ${line}`),
    });

    // If the engine process dies before we're up, fail fast with a dialog.
    engine.child.once("exit", (code) => {
      if (!shuttingDown && !mainWindow) {
        fatal(`The AquaFlow engine exited during startup (code ${code}).`);
      }
    });

    setSplashStatus("Waiting for engine health…");
    await waitForHealth(enginePort, { timeoutMs: 30000 });

    setSplashStatus("Loading interface…");
    buildMenu(); // AF-PKG-005 — File/View/Help + About
    createMainWindow();
  } catch (err) {
    fatal(String(err && err.message ? err.message : err));
  }
}

function fatal(message) {
  if (shuttingDown) return;
  try {
    dialog.showErrorBox(
      "AquaFlow Studio — startup failed",
      `${message}\n\nThe application will now close.`
    );
  } catch { /* ignore */ }
  cleanupAndQuit();
}

// ── Shutdown ──────────────────────────────────────────────────────────────────────
async function cleanupAndQuit() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { if (engine && engine.child) await stopEngine(engine.child); } catch { /* ignore */ }
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  app.quit();
}

app.on("before-quit", (e) => {
  if (shuttingDown) return;
  e.preventDefault();
  cleanupAndQuit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") cleanupAndQuit();
});

// Last-resort: never leave the engine orphaned.
process.on("exit", () => {
  try { if (engine && engine.child && engine.child.exitCode === null) engine.child.kill("SIGKILL"); }
  catch { /* ignore */ }
});
