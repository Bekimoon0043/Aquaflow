# Releasing AquaFlow Studio (Desktop)

The release process for cutting a signed, auto-updatable AquaFlow Studio build. Read
`BUILD.md` first for the build mechanics; this document covers **versioning, signing,
publishing the update feed, and the checklist**.

> **Tier A scope:** releases target an **internal network** update server first. A public
> update server is Tier B. Do not point the feed at an untrusted public host without HTTPS +
> code signing.

---

## 1. Version bump (single source)

The one version source is `aquaflow/desktop/package.json` `version` (see BUILD.md §5).

```bash
cd aquaflow/desktop
npm version patch      # 1.0.0 -> 1.0.1  (minor/major as appropriate)
git push --follow-tags
```

electron-updater compares this version (semver) against the feed's `latest.yml` to decide
whether an update is available. Never ship two builds with the same version.

---

## 2. Code signing — SKIPPED for Tier A (CEO decision)

**Tier A ships UNSIGNED.** No Authenticode certificate will be purchased for Tier A (there is
no free option for code-signing certificates). This is an accepted, documented decision:

- **Windows SmartScreen** will show an **"Unknown publisher"** / "Windows protected your PC"
  warning on first install. This is expected for internal use. Users click
  **"More info" → "Run anyway"**. Document this in the install instructions given to each
  operator (also in FIRST-BUILD-GUIDE.md and the installer README).
- Integrity in the meantime rests on **HTTPS transport + the SHA-256/sha512 checksum** in
  `latest.yml` (verified automatically by electron-updater on download). Publish the SHA-256
  of each installer alongside it so a manual install can be checked too.
- **Purchasing a code-signing certificate is a Tier B task.** When one is obtained, sign by
  setting `CSC_LINK` (path to `.pfx` or base64) + `CSC_KEY_PASSWORD` before `npm run dist`;
  electron-builder then signs the app + installer and electron-updater verifies the signature.

> **Current status:** intentionally unsigned for Tier A → releases are **checksum-verified,
> not signed**, and each release note must say so.

---

## 3. Publish the update feed

`electron-builder.yml` `publish` is a **generic** provider. `npm run dist` emits, in `dist/`:

- `AquaFlowSetup-<version>.exe` — the installer
- `latest.yml` — version + sha512 metadata electron-updater reads
- (blockmap for differential download)

Publish by copying **all three** to the feed root (the `updateUrl`):
`https://luxuryconworld.com/updates/aquaflow/`. Serve over **HTTPS**. The running app reads
its feed URL from `AQUAFLOW_UPDATE_URL` / bundled `app-config.json` only — never from the UI
(MITM guard, see `updater.js`).

Clients pick up the new version on next launch (silent background check) or via
Help > Check for Updates…

---

## 4. Release checklist

- [ ] `npm version` bumped; tag pushed.
- [ ] Backend suite green (`pytest`) and frontend suite green (`vitest`).
- [ ] `npm run dist` succeeds on the Windows build machine.
- [ ] Installer signed (or release notes state checksum-only).
- [ ] Fresh install on a clean machine launches (no Node/Python present).
- [ ] Upgrade from the previous version preserves user data (`%APPDATA%\AquaFlow Studio`).
- [ ] Safety parity confirmed: `AQUAFLOW_HARDWARE_COMMISSIONED` defaults FALSE, bench-safety
      lock active, protocol matrix honest — identical to dev.
- [ ] `latest.yml` + installer + blockmap copied to the HTTPS feed.
- [ ] A prior-version client auto-updates to this build.
- [ ] Release notes written (version, changes, signed vs checksum-only).

---

## 5. Rollback

To pull a bad release: restore the previous `latest.yml` + installer on the feed. Clients
that already updated must reinstall the prior installer manually (electron-updater does not
auto-downgrade). Prefer a fast forward-fix (`npm version patch`) over a rollback where
possible.
