// AF-PKG-004 — backend engine lifecycle: free-port selection, spawn (dev or packaged),
// health polling, and graceful shutdown. Kept separate from main.js so it is unit-reviewable.

// electron's `app` is required lazily inside resolveEngine() so the rest of this module
// (port selection, health polling, graceful stop) is unit-testable with plain node.
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");

/** Resolve a free TCP port at or after `start` (bounded scan). */
function findFreePort(start = 8000, attempts = 50) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      if (port >= start + attempts) return reject(new Error("no free port found"));
      const srv = net.createServer();
      srv.once("error", () => { port += 1; tryPort(); });
      srv.once("listening", () => srv.close(() => resolve(port)));
      srv.listen(port, "127.0.0.1");
    };
    tryPort();
  });
}

/**
 * Where the backend engine lives:
 *  - packaged: the PyInstaller one-dir exe under resources/engine/
 *  - dev (unpackaged): the backend venv python running engine_entry.py
 */
function resolveEngine() {
  const { app } = require("electron"); // lazy — keeps the rest node-testable
  const exeName = process.platform === "win32" ? "aquaflow-engine.exe" : "aquaflow-engine";
  const packaged = path.join(process.resourcesPath || "", "engine", exeName);
  if (app.isPackaged && fs.existsSync(packaged)) {
    return { command: packaged, args: [], cwd: path.dirname(packaged), mode: "packaged" };
  }
  // Dev fallback: run the source backend with its venv python.
  const backendDir = path.resolve(__dirname, "..", "backend");
  const venvPy = process.platform === "win32"
    ? path.join(backendDir, ".venv", "Scripts", "python.exe")
    : path.join(backendDir, ".venv", "bin", "python");
  const py = fs.existsSync(venvPy) ? venvPy : (process.platform === "win32" ? "python.exe" : "python3");
  return { command: py, args: [path.join(backendDir, "engine_entry.py")], cwd: backendDir, mode: "dev" };
}

/** Spawn the engine bound to `port`. Never enables any dev/unsafe flag. */
function startEngine({ port, licenseSecret, extraEnv = {}, onLog = () => {} }) {
  const { command, args, cwd, mode } = resolveEngine();
  const env = {
    ...process.env,
    AQUAFLOW_HOST: "127.0.0.1",
    AQUAFLOW_PORT: String(port),
    AQUAFLOW_LICENSE_SECRET: licenseSecret,
    ...extraEnv,
  };
  // Belt-and-braces: the desktop app must never run the backend in dev/unsafe mode.
  delete env.AQUAFLOW_DEV;
  delete env.AQUAFLOW_ENV;
  delete env.AQUAFLOW_UNSAFE_DEV;
  delete env.AQUAFLOW_DEV_MODE;

  const child = spawn(command, args, { cwd, env, windowsHide: true });
  child.stdout.on("data", (d) => onLog(String(d)));
  child.stderr.on("data", (d) => onLog(String(d)));
  return { child, mode, command };
}

/** Poll /api/health until it answers 200, or reject after timeout. */
function waitForHealth(port, { timeoutMs = 30000, intervalMs = 400 } = {}) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 1500 }, (res) => {
        if (res.statusCode === 200) { res.resume(); return resolve(true); }
        res.resume();
        retry();
      });
      req.on("error", retry);
      req.on("timeout", () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() > deadline) return reject(new Error("engine health check timed out"));
      setTimeout(poll, intervalMs);
    };
    poll();
  });
}

/** Ask the engine to exit, then hard-kill if it lingers. Prevents orphaned processes. */
function stopEngine(child, { graceMs = 4000 } = {}) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.killed) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    child.once("exit", finish);
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    setTimeout(() => {
      if (!done) { try { child.kill("SIGKILL"); } catch { /* ignore */ } finish(); }
    }, graceMs);
  });
}

module.exports = { findFreePort, resolveEngine, startEngine, waitForHealth, stopEngine };
