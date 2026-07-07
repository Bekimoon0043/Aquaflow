#!/usr/bin/env node
/**
 * AF-PKG-003 — build the React frontend as static production files for the Electron shell.
 *
 * Runs Vite with a RELATIVE base (`./`) so assets resolve when the page is loaded from
 * the local filesystem (file://) inside Electron, and writes the output to
 * aquaflow/desktop/web/. This does NOT modify the frontend source or vite.config.js —
 * only the desktop build overrides `base` on the CLI (backward-compatible).
 *
 * The backend URL is NOT baked in: the Electron launcher (AF-PKG-004) loads
 * web/index.html with `?api=…&ws=…` query params, which the frontend's existing config
 * override chain (src/config.js readBrowserOverride) already honours.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const desktopDir = path.resolve(__dirname, "..");
const frontendDir = path.resolve(desktopDir, "..", "frontend");
const outDir = path.join(desktopDir, "web");

// Invoke Vite's JS entry directly with node — avoids the flaky .cmd/npx shim on Windows
// and works identically on macOS/Linux.
const viteBin = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
if (!fs.existsSync(viteBin)) {
  throw new Error(`[build-web] Vite not found at ${viteBin} — run 'npm install' in aquaflow/frontend first.`);
}

console.log("[build-web] Building the frontend (Vite, base=./) for Electron…");
execFileSync(
  process.execPath, // node
  [viteBin, "build", "--base=./", `--outDir=${outDir}`, "--emptyOutDir"],
  { cwd: frontendDir, stdio: "inherit" }
);

const indexHtml = path.join(outDir, "index.html");
if (!fs.existsSync(indexHtml)) {
  throw new Error(`[build-web] Expected ${indexHtml} — Vite build did not produce it.`);
}
console.log(`[build-web] Done → ${indexHtml}`);
