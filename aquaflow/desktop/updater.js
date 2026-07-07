// AF-PKG-007 — auto-update (electron-updater over a generic feed).
//
// Design goals for Tier A (internal network first):
//   • Feed URL is admin-controlled only — from AQUAFLOW_UPDATE_URL or the bundled
//     resources/app-config.json (see app-config.js). It is NEVER user-editable at
//     runtime, which is the MITM guard the packaging spec calls for.
//   • Checks run on launch, silently. No network / unreachable feed / no update ⇒ no
//     dialog, just a log line. Updates should never interrupt a running show.
//   • When an update is found it downloads in the background; the user is offered a
//     non-intrusive "Restart to update" choice and can defer.
//   • The menu "Check for Updates…" performs the same check but is interactive: it
//     reports "you're up to date" / errors so the click has visible feedback.
//
// SECURITY NOTE (honest): electron-updater verifies the download against the signed
// latest.yml (sha512) it fetches from the same feed. Real tamper resistance requires the
// installer to be CODE-SIGNED (Authenticode) and the feed served over HTTPS. Until the
// CEO provides a signing certificate, integrity rests on the HTTPS transport + sha512
// checksum only — documented in RELEASE.md (AF-PKG-010), not silently assumed.

const { app, dialog } = require("electron");

let autoUpdater = null;      // lazily required — absent in dev / uninstalled deps
let configuredUrl = "";
let checking = false;

function log(msg) {
  process.stdout.write(`[updater] ${msg}\n`);
}

// Load electron-updater lazily so a missing dependency (e.g. dev sandbox) degrades to a
// no-op instead of crashing the whole app at require time.
function loadUpdater() {
  if (autoUpdater) return autoUpdater;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  } catch (err) {
    log(`electron-updater unavailable: ${err && err.message}`);
    autoUpdater = null;
  }
  return autoUpdater;
}

// Wire the feed + event handlers once. `updateUrl` comes from resolveConfig().
function initAutoUpdate(getWindow, updateUrl) {
  configuredUrl = (updateUrl || "").trim();

  if (!app.isPackaged) {
    log("dev build — auto-update disabled");
    return;
  }
  if (!configuredUrl) {
    log("no update URL configured — auto-update disabled");
    return;
  }
  const up = loadUpdater();
  if (!up) return;

  try {
    up.setFeedURL({ provider: "generic", url: configuredUrl });
  } catch (err) {
    log(`invalid feed URL, auto-update disabled: ${err && err.message}`);
    return;
  }

  up.removeAllListeners("update-downloaded");
  up.on("update-downloaded", (info) => {
    const win = getWindow && getWindow();
    const version = (info && info.version) || "a new version";
    dialog
      .showMessageBox(win, {
        type: "info",
        title: "Update ready",
        message: `AquaFlow Studio ${version} has been downloaded.`,
        detail: "Restart now to finish updating, or keep working and update on next launch.",
        buttons: ["Restart now", "Later"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      .then(({ response }) => {
        if (response === 0) {
          setImmediate(() => up.quitAndInstall(false, true));
        }
      })
      .catch(() => {});
  });

  // Background check shortly after launch — never blocks startup, never dialogs on failure.
  checkForUpdates({ silent: true });
}

// Run a check. silent=true (launch/background) swallows "up to date" and errors.
// silent=false (menu click) reports both so the action has feedback.
function checkForUpdates({ silent } = { silent: false }, getWindow) {
  const up = loadUpdater();
  const win = getWindow && getWindow();

  if (!app.isPackaged || !configuredUrl || !up) {
    if (!silent) {
      dialog.showMessageBox(win, {
        type: "info",
        title: "Check for Updates",
        message: "Automatic updates are not configured for this build.",
        buttons: ["OK"],
      }).catch(() => {});
    }
    return;
  }
  if (checking) return;
  checking = true;

  up.checkForUpdates()
    .then((result) => {
      const info = result && result.updateInfo;
      const available =
        info && info.version && info.version !== app.getVersion();
      if (!available && !silent) {
        dialog.showMessageBox(win, {
          type: "info",
          title: "Check for Updates",
          message: "AquaFlow Studio is up to date.",
          detail: `Version ${app.getVersion()}`,
          buttons: ["OK"],
        }).catch(() => {});
      }
      // If available, autoDownload handles it → 'update-downloaded' prompts to restart.
    })
    .catch((err) => {
      log(`check failed (offline or feed unreachable): ${err && err.message}`);
      if (!silent) {
        dialog.showMessageBox(win, {
          type: "warning",
          title: "Check for Updates",
          message: "Could not reach the update server.",
          detail: "Check your network connection and try again.",
          buttons: ["OK"],
        }).catch(() => {});
      }
    })
    .finally(() => { checking = false; });
}

module.exports = { initAutoUpdate, checkForUpdates };
