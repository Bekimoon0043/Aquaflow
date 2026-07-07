#!/usr/bin/env node
/**
 * AF-PKG-002 — build the PyInstaller backend bundle and stage it for electron-builder.
 *
 * Runs PyInstaller against aquaflow/backend/aquaflow-engine.spec, then copies the one-dir
 * output into aquaflow/desktop/resources/engine/ (where electron-builder.yml's
 * extraResources picks it up).
 *
 * REQUIREMENT: PyInstaller does NOT support Python 3.14 (the repo's backend venv). Use a
 * Python 3.10–3.12 build venv. Point this script at it with AQUAFLOW_BUILD_PYTHON, e.g.:
 *   AQUAFLOW_BUILD_PYTHON="C:\\py312\\python.exe" node scripts/build-engine.js
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const desktopDir = path.resolve(__dirname, "..");
const backendDir = path.resolve(desktopDir, "..", "backend");
const python = process.env.AQUAFLOW_BUILD_PYTHON || "python";
const outDir = path.join(desktopDir, "resources", "engine");

function run(cmd, args, cwd) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

console.log("[build-engine] Building aquaflow-engine with PyInstaller…");
console.log(`[build-engine] Python: ${python}  (must be 3.10–3.12)`);

// 1. Ensure PyInstaller is available in the build interpreter.
run(python, ["-m", "pip", "install", "--upgrade", "pyinstaller"], backendDir);
run(python, ["-m", "pip", "install", "-r", "requirements.txt"], backendDir);

// 2. Build from the spec.
run(python, ["-m", "PyInstaller", "aquaflow-engine.spec", "--noconfirm"], backendDir);

// 3. Stage the one-dir output for electron-builder.
const built = path.join(backendDir, "dist", "aquaflow-engine");
if (!fs.existsSync(built)) {
  throw new Error(`[build-engine] Expected PyInstaller output at ${built} — build failed.`);
}
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(outDir), { recursive: true });
fs.cpSync(built, outDir, { recursive: true });

const exe = path.join(outDir, process.platform === "win32" ? "aquaflow-engine.exe" : "aquaflow-engine");
console.log(`[build-engine] Staged: ${exe}`);
console.log("[build-engine] Done. Verify it starts and answers /api/health before packaging.");
