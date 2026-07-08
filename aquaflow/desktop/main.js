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
const { buildMenu, setCheckForUpdatesHook } = require("./menu");
const { initAutoUpdate, checkForUpdates } = require("./updater");
const { startUiServer } = require("./ui-server");

const getMainWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);

// Debug logging to stdout (visible in a terminal-launched run). DevTools also auto-open unless
// AQUAFLOW_DEVTOOLS=0. Set AQUAFLOW_DEVTOOLS=0 to suppress for a clean production run.
const dbg = (...a) => process.stdout.write(`[aquaflow] ${a.join(" ")}\n`);
const DEVTOOLS = process.env.AQUAFLOW_DEVTOOLS !== "0";

// LuxuryCon brand.
const BRAND = { forest: "#0D2A1A", gold: "#C9A227" };
const WEB_INDEX = path.join(__dirname, "web", "index.html");
const SPLASH = path.join(__dirname, "splash.html");
const APP_ICON = path.join(__dirname, "assets", "icon.png"); // shield + water (generate_brand_assets.py)

let mainWindow = null;
let splashWindow = null;
let engine = null; // { child, mode, command }
let enginePort = 0;
let ui = null;       // loopback UI server { server, port, url, close }
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

  // Surface renderer failures in the main-process stdout (visible even without DevTools).
  const wc = mainWindow.webContents;
  wc.on("did-fail-load", (_e, code, desc, url) => dbg(`RENDERER did-fail-load ${code} ${desc} — ${url}`));
  wc.on("render-process-gone", (_e, d) => dbg(`RENDERER gone: ${d && d.reason}`));
  wc.on("preload-error", (_e, p, err) => dbg(`PRELOAD error ${p}: ${err && err.message}`));
  wc.on("console-message", (_e, level, message, line, sourceId) =>
    dbg(`console[${level}] ${message} (${sourceId}:${line})`));
  if (DEVTOOLS) wc.once("dom-ready", () => { try { wc.openDevTools({ mode: "right" }); } catch {} });

  const api = encodeURIComponent(`http://127.0.0.1:${enginePort}/api`);
  const ws = encodeURIComponent(`ws://127.0.0.1:${enginePort}/ws`);

  if (ui && fs.existsSync(WEB_INDEX)) {
    // Load over the loopback HTTP server (real origin) — NOT file:// — so the Vite
    // `type="module" crossorigin` scripts can be fetched (they cannot over file://).
    const url = `${ui.url("index.html")}?api=${api}&ws=${ws}`;
    dbg(`engine on 127.0.0.1:${enginePort} · UI server on 127.0.0.1:${ui.port}`);
    dbg(`loading frontend URL: ${url}`);
    dbg(`web dir: ${path.join(__dirname, "web")} (index exists: ${fs.existsSync(WEB_INDEX)})`);
    mainWindow.loadURL(url);
  } else {
    // UI not built (or server failed to start) — show a clear message, not a blank window.
    dbg(`frontend NOT loaded — ui=${!!ui} WEB_INDEX exists=${fs.existsSync(WEB_INDEX)}`);
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
    dbg("renderer did-finish-load");
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

    // Adopt the port the engine ACTUALLY bound (read from its startup log). A bundled engine
    // may serve on its own default (e.g. 8000) regardless of the port we requested; the
    // frontend and health check must use that real port or the window loads blank.
    enginePort = await engine.whenPort;
    dbg(`engine reported port: ${enginePort} (${engine.mode})`);

    setSplashStatus("Waiting for engine health…");
    try {
      await waitForHealth(enginePort, { timeoutMs: 30000 });
      dbg(`health check PASSED on 127.0.0.1:${enginePort}/api/health`);
    } catch (e) {
      dbg(`health check FAILED on 127.0.0.1:${enginePort}: ${e && e.message}`);
      throw e;
    }

    setSplashStatus("Loading interface…");
    // Serve the frontend build over a loopback HTTP server (real origin) so ES-module scripts
    // load — they cannot be fetched over file://. See ui-server.js.
    try {
      ui = await startUiServer(path.join(__dirname, "web"));
      dbg(`UI server started on 127.0.0.1:${ui.port}`);
    } catch (e) {
      dbg(`UI server failed to start: ${e && e.message}`);
      ui = null;
    }
    buildMenu(); // AF-PKG-005 — File/View/Help + About
    // AF-PKG-007 — menu "Check for Updates…" runs an interactive (non-silent) check.
    setCheckForUpdatesHook(() => checkForUpdates({ silent: false }, getMainWindow));
    createMainWindow();

    // AF-PKG-007 — configure the update feed and run the silent launch check. Admin-only
    // URL from resolveConfig(); no-ops cleanly in dev / when unconfigured / offline.
    initAutoUpdate(getMainWindow, cfg.updateUrl);
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
  try { if (ui && ui.close) await ui.close(); } catch { /* ignore */ }
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
