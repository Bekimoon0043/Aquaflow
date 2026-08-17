// AF-PKG-004 — backend engine lifecycle: free-port selection, spawn (dev or packaged),
// health polling, and graceful shutdown. Kept separate from main.js so it is unit-reviewable.

// electron's `app` is required lazily inside resolveEngine() so the rest of this module
// (port selection, health polling, graceful stop) is unit-testable with plain node.
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");

// Addresses a candidate port is probed on before we call it free.
//
// WHY MORE THAN 127.0.0.1 (live incident, Aug 2026): on an operator machine
// Docker Desktop held [::]:8000 and the WSL relay held [::1]:8000 while the
// engine bound 127.0.0.1:8000. Probing ONLY 127.0.0.1 declared 8000 free, so
// the engine was handed a port it SHARED with two foreign services. Anything
// reaching the backend over ::1 — or over the name "localhost", which Chromium
// resolves to ::1 before IPv4 — hit Docker/WSL instead of the engine: no CORS
// headers (the browser calls that a CORS failure) and a 403 on /ws.
//
// Both families, wildcard and loopback, so a port held by anyone on any of
// them is treated as taken.
const PROBE_HOSTS = ["0.0.0.0", "::", "127.0.0.1", "::1"];

// Bind errors that mean "someone else has this port". Anything else (notably
// EAFNOSUPPORT / EADDRNOTAVAIL / EINVAL on a host with IPv6 disabled) means
// the FAMILY is unavailable, which is not a conflict — otherwise an IPv4-only
// machine could never find a free port.
const PORT_TAKEN_CODES = new Set(["EADDRINUSE", "EACCES"]);

/** Probe one (port, host). Resolves true if that address is bindable or the
 *  family simply does not exist here; false only on a real conflict. */
function probePort(port, host) {
  return new Promise((resolve) => {
    let srv;
    try {
      srv = net.createServer();
    } catch {
      return resolve(true); // cannot probe — do not veto the port
    }
    srv.once("error", (err) => {
      resolve(!PORT_TAKEN_CODES.has(err && err.code));
    });
    srv.once("listening", () => srv.close(() => resolve(true)));
    try {
      srv.listen(port, host);
    } catch {
      resolve(true); // e.g. IPv6 literal rejected outright on an IPv4-only host
    }
  });
}

/** Resolve a free TCP port at or after `start` (bounded scan).
 *  A port counts as free only when it is bindable on EVERY address family
 *  available on this host (see PROBE_HOSTS).
 *  `_probe` overrides the prober for headless tests only — same convention as
 *  startEngine's `_engine`. */
async function findFreePort(start = 8000, attempts = 50, _probe = probePort) {
  for (let port = start; port < start + attempts; port += 1) {
    let free = true;
    for (const host of PROBE_HOSTS) {
      // Sequential on purpose: stop at the first conflict rather than opening
      // four sockets per candidate port.
      if (!(await _probe(port, host))) { free = false; break; }
    }
    if (free) return port;
  }
  throw new Error("no free port found");
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

/**
 * Detect the port the engine ACTUALLY bound, from its startup log. The engine prints
 * "…serving on 127.0.0.1:<port>" (and uvicorn prints "Uvicorn running on http://…:<port>").
 * We read that rather than assume the requested port, so the frontend + health check use the
 * real port even if a bundled engine serves on its own default (e.g. 8000) instead of the
 * port we asked for. Returns the captured port, or null.
 */
function detectPortFromLog(text) {
  const m = /(?:serving on|running on)\s+(?:https?:\/\/)?[^\s:/]+:(\d+)/i.exec(String(text));
  return m ? parseInt(m[1], 10) : null;
}

/** Spawn the engine bound to `port`. Never enables any dev/unsafe flag.
 *  `_engine` overrides resolveEngine() for headless tests only (resolveEngine needs electron). */
function startEngine({ port, licenseSecret, corsOrigins = [], extraEnv = {}, onLog = () => {}, portTimeoutMs = 8000, _engine = null }) {
  const { command, args, cwd, mode } = _engine || resolveEngine();
  // CORS origins the engine must allow, read by get_allowed_origins() at startup (works on
  // the already-built engine, no rebuild): "null" covers a file:// fallback; callers add the
  // loopback UI-server origin. (The backend regex already allows any 127.0.0.1 port — this is
  // belt-and-braces.) Merge with any pre-set value rather than clobbering it.
  const corsList = [process.env.AQUAFLOW_CORS_ORIGINS, "null"].concat(corsOrigins).filter(Boolean).join(",");
  const env = {
    ...process.env,
    AQUAFLOW_HOST: "127.0.0.1",
    AQUAFLOW_PORT: String(port),
    AQUAFLOW_LICENSE_SECRET: licenseSecret,
    AQUAFLOW_CORS_ORIGINS: corsList,
    // CRITICAL (audit F1): with stdout PIPED (as here), Python 3.10-3.12 on Windows encodes
    // stdout as cp1252 and the backend's startup banner prints "✅ …" — UnicodeEncodeError,
    // engine dies at import. It runs fine standalone in a terminal (console API handles
    // Unicode), which is exactly why the crash only appears inside the packaged app. Forcing
    // UTF-8 for the child fixes the EXISTING engine bundle — env applies before Python starts.
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    ...extraEnv,
  };
  // Belt-and-braces: the desktop app must never run the backend in dev/unsafe mode.
  delete env.AQUAFLOW_DEV;
  delete env.AQUAFLOW_ENV;
  delete env.AQUAFLOW_UNSAFE_DEV;
  delete env.AQUAFLOW_DEV_MODE;

  const child = spawn(command, args, { cwd, env, windowsHide: true });

  // whenPort resolves with the engine's ACTUAL bound port (from its log), or falls back to the
  // requested port after portTimeoutMs so startup never hangs on an unrecognised log format.
  let resolvePort;
  const whenPort = new Promise((resolve) => { resolvePort = resolve; });
  let settled = false;
  const settle = (p) => { if (!settled) { settled = true; resolvePort(p); } };

  child.stdout.on("data", (d) => {
    const s = String(d);
    onLog(s);
    const detected = detectPortFromLog(s);
    if (detected) settle(detected);
  });
  child.stderr.on("data", (d) => {
    const s = String(d);
    onLog(s);
    const detected = detectPortFromLog(s); // uvicorn logs the running line to stderr
    if (detected) settle(detected);
  });
  setTimeout(() => settle(port), portTimeoutMs);

  return { child, mode, command, port, whenPort };
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

module.exports = { findFreePort, probePort, PROBE_HOSTS, resolveEngine, startEngine, waitForHealth, stopEngine, detectPortFromLog };
