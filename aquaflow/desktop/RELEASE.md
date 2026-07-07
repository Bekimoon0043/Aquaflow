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

## 2. Code signing (required for a real release)

Auto-update integrity depends on it. Without a signing certificate the installer is
**unsigned** and integrity rests on HTTPS transport + the sha512 checksum in `latest.yml`
only — acceptable for a controlled internal LAN, **not** for wider distribution.

To sign, provide the Authenticode certificate to electron-builder via env before `npm run dist`:

```bash
export CSC_LINK="C:/path/to/cert.pfx"      # or a base64 cert
export CSC_KEY_PASSWORD="********"
npm run dist
```

electron-builder signs both the app and the installer, and electron-updater then verifies
the signature on download.

> **Current status:** no certificate provisioned. See AF-PKG-VERIFICATION-REPORT §8 — the CEO
> must supply the cert. Until then, releases are **checksum-verified, not signed**, and this
> must be stated in the release notes.

---

## 3. Publish the update feed

`electron-builder.yml` `publish` is a **generic** provider. `npm run dist` emits, in `dist/`:

- `AquaFlow Studio-Setup-<version>.exe` — the installer
- `latest.yml` — version + sha512 metadata electron-updater reads
- (blockmap for differential download)

Publish by copying **all three** to the feed root (the `updateUrl`), e.g.
`https://updates.luxuryconworld.com/aquaflow/`. Serve over **HTTPS**. The running app reads
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
