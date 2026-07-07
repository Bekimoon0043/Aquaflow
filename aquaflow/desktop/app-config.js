// AF-PKG-004 — desktop app configuration resolver.
//
// Resolves the backend license secret + the auto-update feed URL from, in priority order:
//   1. environment variables (AQUAFLOW_LICENSE_SECRET, AQUAFLOW_UPDATE_URL)
//   2. a bundled resources/app-config.json (admin-provisioned at packaging time)
//   3. a built-in development default (NON-production)
//
// SECURITY NOTE (honest, carried from AF-HUB-009B): the backend license engine uses a
// SYMMETRIC HMAC secret. Any secret shipped inside the installer is extractable by a
// determined user, so a bundled secret gates casual copying only, not a motivated
// attacker. The correct long-term fix is Ed25519 asymmetric license signing (Tier B).
// Documented here so it is not silently relied upon.

const { app } = require("electron");
const path = require("path");
const fs = require("fs");

const DEV_SECRET = "aquaflow-desktop-dev-only-not-for-production";

function readBundledConfig() {
  try {
    const p = path.join(process.resourcesPath || "", "app-config.json");
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    /* ignore malformed config */
  }
  return {};
}

function resolveConfig() {
  const bundled = readBundledConfig();
  const licenseSecret =
    process.env.AQUAFLOW_LICENSE_SECRET || bundled.licenseSecret || (app.isPackaged ? "" : DEV_SECRET);
  const updateUrl = process.env.AQUAFLOW_UPDATE_URL || bundled.updateUrl || "";
  return {
    licenseSecret,
    updateUrl,
    // If packaged with no secret provisioned, that is a packaging error — surfaced by the
    // engine (engine_entry.py fails loud) and by main.js before spawning.
    hasLicenseSecret: Boolean(licenseSecret),
  };
}

module.exports = { resolveConfig, DEV_SECRET };
