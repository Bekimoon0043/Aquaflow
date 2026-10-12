# AquaFlow Studio — License Administration (Internal, CEO/Admin)

How LuxuryCon issues and manages AquaFlow Studio licenses **without calling an engineer**.

> **What the licensing actually is (accurate as of 2026-07-07):** each license is
> **machine-locked** and signed with **HMAC-SHA256** using a single server-side secret
> (`AQUAFLOW_LICENSE_SECRET`). It is **not** Ed25519 — older docs said Ed25519 in error and
> have been corrected. Ed25519 (asymmetric) signing is a **planned Tier B upgrade**; until
> then the signing secret must stay on LuxuryCon machines only (see Security below).
> Code: [`license_engine.py`](aquaflow/backend/license/license_engine.py) `_sign()`.

---

> **Where the generator tool lives:** `license/license_generator_BETA.py` (the license
> *minting* tool) is **intentionally excluded from the repository** (`.gitignore`) so the
> license factory is never distributed with the client-facing code. It lives on LuxuryCon
> **admin machines only**. A fresh `git clone` will **not** contain it — keep it on the admin
> PC(s) via internal means. The client-side pieces it relies on (`license_engine.py`,
> `get_fingerprint.py`, `license_routes.py`) **are** in the repo. The one-command CLI in
> Section 1 is available in the admin copy of that tool.

## 0. One-time setup (do this once)

Pick a long random secret and set it as an environment variable on **every LuxuryCon machine
that generates OR runs** AquaFlow. The same secret must be used everywhere.

```powershell
# Windows (PowerShell) — set it permanently for your user account:
setx AQUAFLOW_LICENSE_SECRET "a-long-random-secret-keep-this-private"
```

- Keep this secret private. Anyone with it can mint licenses. Do **not** email it, commit it,
  or put it in chat.
- In the packaged desktop app the secret is provisioned by the installer/admin config
  (`resources/app-config.json` → `licenseSecret`) — see BUILD.md. The generator tool below
  reads it from the environment.

---

## 1. Issue a license — the 3-step flow

### Step 1 — get the machine ID (on the employee / target PC)

**Packaged app (the normal case — employees have no Python):** the installed app opens to an
**Activation screen** that shows the **Machine ID** (a 64-hex fingerprint) with a **Copy
Machine ID** button. The employee clicks Copy and sends you that value. No license = the app
stays locked on this screen; the studio does not open until a valid license is loaded.

**From source (dev only):**
```powershell
cd backend
python -m license.get_fingerprint
```
prints `AQUAFLOW_MACHINE_FINGERPRINT=3f9c…(64 hex)…a1`.

Either way you get one 64-character Machine ID for that computer.

> **Machine ID format, changed in 1.2.29.** Since 1.2.29 the Machine ID is the stable
> **v2** ID: a hash of the CPU id, board serial and computer name.
>
> **Why it changed:** before 1.2.29 the ID also included the MAC address of whichever
> network adapter Python found first. It changed when a USB/VPN/Hyper-V adapter was plugged
> in, unplugged or re-ordered, and the license then showed `INVALID_HW` on the right computer.
>
> **Licenses issued before 1.2.29 (v1) keep working.** AquaFlow accepts a v1 license if it
> matches *any* network adapter the computer currently has. It fails only if the license was
> issued while a now-removed adapter happened to be first. If that happens, re-issue the
> license for the new v2 Machine ID shown on the Activation screen.
>
> **Renaming the computer changes the v2 ID**, because the computer name is part of it.

### Step 2 — generate the license (on YOUR admin PC, one command)

With `AQUAFLOW_LICENSE_SECRET` set (Section 0), run **one command** — paste the fingerprint in:

```powershell
cd backend
python -m license.license_generator_BETA --fingerprint <PASTE_64_HEX> --name "Client Name" --company "Client Company"
```

That writes `backend/licenses/<company>_<date>.json` and prints a summary (license key,
edition, issue/expiry dates). Options:

| Flag | Meaning | Default |
|------|---------|---------|
| `--fingerprint` / `-f` | the 64-hex machine ID from Step 1 | *(required)* |
| `--name` / `-n` | client full name | required |
| `--company` / `-c` | company name | required |
| `--edition` / `-e` | `STRONG_BETA`, `PLAYER`, or `STUDIO` | `STRONG_BETA` |
| `--expiry` | `YYYY-MM-DD` | 2 years from today |
| `--out` / `-o` | output path | `licenses/<company>_<date>.json` |

Run with **no** `--fingerprint` to get a guided interactive wizard instead.

### Step 3 — deliver + activate (on the employee PC)

Send the employee the generated `.json`.

**Packaged app (normal case):** on the Activation screen they click **Load License File…**,
pick the `.json` you sent, and the app validates + unlocks immediately (it copies the file to
`%USERPROFILE%\.aquaflow\license.json` so it stays activated on every future launch). If the
license was minted for a different machine, the screen says so and stays locked.

**From source / manual placement:** drop the `.json` at **one** of these (first found wins),
then restart:

| Location | Use |
|----------|-----|
| `%USERPROFILE%\.aquaflow\license.json` | **packaged app — recommended** (user-writable; where Load License File puts it) |
| `C:\AquaFlow\license.json` | packaged app alternative |
| `backend\license\active_license.json` | dev / running from source |

> **The build machine's own laptop** is licensed the same way — its `license.json` already
> lives at `%USERPROFILE%\.aquaflow\license.json`, so the packaged app opens straight to the
> studio there.

---

## 2. Editions (what each unlocks)

| Edition | Unlocks |
|---------|---------|
| `PLAYER` | play/stop/pause/schedule, load show, device status, basic monitoring |
| `STRONG_BETA` | PLAYER + engineering designer, show programmer, save/load/export/import, dry-run + 3D preview |
| `STUDIO` | STRONG_BETA + AI choreography, pattern designer, timeline editor, audio, hydraulics, BOM export |

Beta clients normally get `STRONG_BETA`.

---

## 3. Expiry, grace period, and offline use

- **Expiry:** default **2 years** from issue (override with `--expiry`). After expiry the app
  reports `EXPIRED` and locks the gated features.
- **Offline grace:** the app caches the last successful validation and allows **up to 30 days
  offline**. Past 30 days offline it asks the machine to reconnect/re-validate.
- **Renewal:** just issue a new license for the **same** fingerprint (Step 2) with a later
  `--expiry`, and have the client replace their `license.json` and restart.

---

## 4. Replace a license for a dead / changed machine

A fingerprint is derived from MAC + CPU + motherboard + hostname. If the machine dies or key
hardware changes, the old license will report `INVALID_HW`. To reissue:

1. On the **new/repaired** machine, run Step 1 to get its new fingerprint.
2. Run Step 2 with the new fingerprint (same client name/company).
3. Deliver + activate (Step 3).

There is no online revocation list in Tier A; simply stop honoring the old file. Keep a
record of which fingerprint maps to which machine/client (the `licenses/` folder is your log).

---

## 5. Packaged-app notes (PyInstaller context)

Verified behaviour so the bundled app matches dev:

- The engine **fails loud** at startup if `AQUAFLOW_LICENSE_SECRET` is missing
  ([`engine_entry.py`](aquaflow/backend/engine_entry.py)) — the desktop shell provisions it
  before spawning (see [`app-config.js`](aquaflow/desktop/app-config.js)).
- The license **file** must live in a **user-writable** location, not inside the installed
  program folder. Use `%USERPROFILE%\.aquaflow\license.json` (the app also checks
  `C:\AquaFlow\license.json`). The in-bundle `active_license.json` path is read-only in a
  packaged install and is for source runs only.
- **Fingerprint caveat:** fingerprinting uses `wmic` on Windows, which is deprecated and may
  be absent on some Windows 11 builds. The code falls back safely (no crash) but the value can
  differ. **Always capture the fingerprint from the same machine/app build that will validate**
  the license, so Step 1 and Step 3 agree.

---

## 6. Security (honest)

- HMAC-SHA256 is **symmetric**: the same secret both signs and verifies. Because that secret
  must exist on any machine that *runs* the app to verify a license, a determined user who
  extracts it could mint their own licenses. This gates **casual** copying, which is the Tier A
  goal — it is not strong DRM.
- The proper fix is **Ed25519 asymmetric** signing (private key on LuxuryCon's side only,
  public key shipped for verification). That is a **Tier B** task, tracked, not yet done.
- Until then: keep `AQUAFLOW_LICENSE_SECRET` on LuxuryCon-controlled machines, and don't
  publish it.

---

## 7. Quick reference

```powershell
# On the client PC — get the machine ID:
python -m license.get_fingerprint

# On your admin PC (AQUAFLOW_LICENSE_SECRET set) — mint the license in one command:
python -m license.license_generator_BETA -f <64_HEX> -n "Name" -c "Company"

# Client drops the .json at %USERPROFILE%\.aquaflow\license.json and restarts AquaFlow.
```
