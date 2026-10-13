// AquaFlow Studio — Electron main process.
//
// AF-PKG-004 startup orchestration: pick a free port → spawn the backend engine →
// show a branded splash while polling /api/health → open the main window on the local
// frontend build → shut the engine down cleanly on exit. Errors surface as dialogs, not
// crashes. A single-instance lock keeps one process group (also needed for .aquashow in
// AF-PKG-006).

const { app, BrowserWindow, dialog, ipcMain, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");

const { findFreePort, startEngine, waitForHealth, stopEngine } = require("./launcher");
const { resolveConfig } = require("./app-config");
const { buildMenu, setCheckForUpdatesHook } = require("./menu");
const { initAutoUpdate, checkForUpdates } = require("./updater");
const { startUiServer } = require("./ui-server");
const { registerCadIpc } = require("./cad-native");
// AF-NEXT-006 — atomic project save/open, autosave snapshots, unclean-exit detection.
const { registerProjectIpc, acquireSessionLock, releaseSessionLock } = require("./project-files");

const getMainWindow = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);

// Debug logging to stdout (visible in a terminal-launched run). DevTools also auto-open unless
// AQUAFLOW_DEVTOOLS=0. Set AQUAFLOW_DEVTOOLS=0 to suppress for a clean production run.
// Packaged GUI launches do not own a durable console. Windows can leave stdout
// attached to a short-lived parent pipe (for example an installer or diagnostic
// launcher); writing after that parent exits raises EPIPE in Electron's main process.
// Debug output must never be allowed to terminate the desktop application.
let stdoutBroken = false;
if (process.stdout && typeof process.stdout.on === "function") {
  process.stdout.on("error", (err) => {
    if (err && (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED")) {
      stdoutBroken = true;
      return;
    }
    // A diagnostic stream failure is non-fatal in a GUI application.
    stdoutBroken = true;
  });
}
const dbg = (...a) => {
  if (stdoutBroken || !process.stdout || !process.stdout.writable) return;
  try {
    process.stdout.write(`[aquaflow] ${a.join(" ")}\n`);
  } catch (err) {
    if (err && (err.code === "EPIPE" || err.code === "ERR_STREAM_DESTROYED")) {
      stdoutBroken = true;
      return;
    }
    stdoutBroken = true;
  }
};
const DEVTOOLS = process.env.AQUAFLOW_DEVTOOLS !== "0";

// LuxuryCon brand.
const BRAND = { forest: "#0D2A1A", gold: "#C9A227" };
// Audit F3: web/ is asarUnpack'ed (electron-builder.yml) because the ui-server streams it
// with plain node fs, which cannot be trusted to read inside app.asar. When running from the
// asar, prefer the real on-disk copy under app.asar.unpacked; in dev __dirname is a plain dir.
function resolveWebRoot() {
  const inAsar = path.join(__dirname, "web");
  const unpacked = inAsar.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  return (unpacked !== inAsar && fs.existsSync(path.join(unpacked, "index.html"))) ? unpacked : inAsar;
}
const WEB_ROOT = resolveWebRoot();
const WEB_INDEX = path.join(WEB_ROOT, "index.html");
const SPLASH = path.join(__dirname, "splash.html");
const APP_ICON = path.join(__dirname, "assets", "icon.png"); // shield + water (generate_brand_assets.py)

let mainWindow = null;
let splashWindow = null;
let engine = null; // { child, mode, command }
let enginePort = 0;
let ui = null;       // loopback UI server { server, port, url, close }
let shuttingDown = false;
let pendingOpenPath = null; // AF-PKG-006 — .aquashow path awaiting the ready window
let sessionInfo = null;     // AF-NEXT-006 — { uncleanExit, previous } from the session lock
const recoveryDir = () => path.join(app.getPath("userData"), "project-recovery");

// AF-PKG-006 — extract a .aquashow path from a launch/second-instance argv.
function showPathFromArgv(argv) {
  const arg = (argv || []).find(
    (a) => typeof a === "string" && /\.(aquashow|aqua|aquapkg)$/i.test(a)
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
    dbg(`web root: ${WEB_ROOT} (index exists: ${fs.existsSync(WEB_INDEX)})`);
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

// ── License activation IPC (AF-PKG-ENABLE-LICENSE) ──────────────────────────────
// The activation screen calls window.aquaflow.installLicenseFromFile(): pick a license.json
// via the OS dialog, VALIDATE it against the backend, and only then atomically replace the
// active license (~/.aquaflow/license.json). A wrong/corrupt file NEVER destroys a previously
// valid license — validation happens against a temp copy first (Codex audit fix #1).

// POST the license to the engine's stateless validator (/api/license/validate) — no side
// effects — so we can decide whether it is safe to replace the active license.
function validateWithEngine(licenseData) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ license_data: licenseData });
    const req = http.request(
      { host: "127.0.0.1", port: enginePort, path: "/api/license/validate", method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        timeout: 8000 },
      (res) => { let b = ""; res.on("data", (d) => (b += d));
        res.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve(null); } }); }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("engine timeout")); });
    req.write(body); req.end();
  });
}

function registerLicenseIpc() {
  ipcMain.handle("license:install-from-file", async () => {
    const win = getMainWindow();
    const res = await dialog.showOpenDialog(win, {
      title: "Select your AquaFlow license file",
      filters: [{ name: "AquaFlow License", extensions: ["json"] }, { name: "All Files", extensions: ["*"] }],
      properties: ["openFile"],
    });
    if (res.canceled || !res.filePaths[0]) return { canceled: true };
    const src = res.filePaths[0];

    // 1) Read + shape-check the picked file — do NOT touch the active license yet.
    let raw, lic;
    try { raw = fs.readFileSync(src, "utf8"); lic = JSON.parse(raw); }
    catch { return { ok: false, status: "INVALID_FILE", error: "That file could not be read as JSON." }; }
    if (!lic || !lic.signature || !lic.hardware_fingerprint) {
      return { ok: false, status: "INVALID_FILE", error: "That file is not a valid AquaFlow license." };
    }

    // 2) VALIDATE against the backend BEFORE overwriting anything (signature + this machine).
    let v;
    try { v = await validateWithEngine(lic); }
    catch { return { ok: false, status: "ERROR", error: "Could not reach the engine to validate the license." }; }
    if (!v || !v.valid) {
      return { ok: false, status: (v && v.status) || "INVALID_SIG", error: (v && v.message) || "License is not valid." };
    }

    // 3) Valid — write to a temp file, then atomically rename over the active license. A prior
    //    valid license is only ever replaced once the new one is confirmed good.
    try {
      const dir = path.join(os.homedir(), ".aquaflow");
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, "license.json");
      const tmp = path.join(dir, `license.json.tmp-${process.pid}-${Date.now()}`);
      fs.writeFileSync(tmp, raw, "utf8");
      try { fs.renameSync(tmp, dest); }            // atomic on the same volume
      catch { fs.copyFileSync(tmp, dest); fs.rmSync(tmp, { force: true }); }
      dbg(`license installed to ${dest} (validated: ${v.status})`);
      return { ok: true, path: dest, status: v.status };
    } catch (e) {
      return { ok: false, status: "ERROR", error: String(e && e.message ? e.message : e) };
    }
  });
}

// ── Boot sequence ───────────────────────────────────────────────────────────────
// Reliable file downloads. Every "export" surface in the UI (Export TIA package, 3D
// export, save show, pattern/section export) hands the browser a blob: URL via an
// anchor click. With NO will-download handler, packaged Electron leaves that download
// as an orphaned .tmp in the Downloads folder and the button appears to do nothing —
// this is exactly the "click Export, no response" symptom. Save straight to the user's
// Downloads folder under the suggested name (de-duplicated) and reveal it, so every
// export gives an unmistakable, dialog-independent response.
function installDownloadHandler() {
  session.defaultSession.on("will-download", (_event, item) => {
    try {
      const downloads = app.getPath("downloads");
      const suggested = item.getFilename() || "aquaflow-download";
      const ext = path.extname(suggested);
      const stem = path.basename(suggested, ext);
      let target = path.join(downloads, suggested);
      for (let n = 1; fs.existsSync(target); n++) target = path.join(downloads, `${stem} (${n})${ext}`);
      item.setSavePath(target);
      item.once("done", (_e, state) => {
        if (state === "completed") {
          dbg(`download saved → ${target}`);
          try { shell.showItemInFolder(target); } catch { /* ignore */ }
        } else {
          dbg(`download did not complete (${state}): ${suggested}`);
        }
      });
    } catch (e) {
      dbg(`will-download handler error: ${e && e.message}`);
    }
  });
}

async function boot() {
  registerLicenseIpc();
  registerCadIpc({ipcMain,dialog,getMainWindow});
  // AF-NEXT-006 — a lock left over from the previous run means it never quit cleanly; the
  // renderer then offers crash recovery from the newest autosave snapshot.
  try { sessionInfo = acquireSessionLock(recoveryDir()); dbg(`session lock acquired (previous unclean: ${sessionInfo.uncleanExit})`); }
  catch (e) { sessionInfo = { uncleanExit: false, previous: null, error: e.message }; dbg(`session lock failed: ${e && e.message}`); }
  registerProjectIpc({ ipcMain, dialog, getMainWindow, userDataDir: app.getPath("userData"), sessionInfo });
  installDownloadHandler();
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

    // Start the loopback UI server FIRST (no dependencies) so its origin can be injected
    // into the engine's CORS env below. Serves WEB_ROOT (asar-unpacked in a packaged app).
    setSplashStatus("Starting UI server…");
    try {
      ui = await startUiServer(WEB_ROOT);
      dbg(`UI server on 127.0.0.1:${ui.port} serving ${WEB_ROOT}`);
    } catch (e) {
      dbg(`UI server failed to start: ${e && e.message}`);
      ui = null;
    }

    setSplashStatus("Selecting port…");
    enginePort = await findFreePort(8000);

    setSplashStatus("Starting engine…");
    engine = startEngine({
      port: enginePort,
      licenseSecret: cfg.licenseSecret,
      // Belt-and-braces: the backend regex already allows any 127.0.0.1 port, but list the
      // UI server's exact origin too so CORS holds even if the regex ever changes.
      corsOrigins: ui ? [`http://127.0.0.1:${ui.port}`] : [],
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
  releaseSessionLock(recoveryDir()); // AF-NEXT-006 — clean quit: no recovery prompt next launch
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
