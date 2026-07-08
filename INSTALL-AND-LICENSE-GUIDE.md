# AquaFlow Studio — Install & License Guide

Everything needed to get AquaFlow Studio running on a LuxuryCon employee machine. Two roles:
- **Employee** (installs the app on their PC) — Parts 1–2.
- **Admin / CEO** (issues the license) — Part 3.

> AquaFlow is **machine-locked**: each install stays **locked** until you activate it with a
> license file issued for **that specific computer**. This is expected and by design.

---

## Part 1 — Install (Employee)

1. Get **`AquaFlowSetup-1.0.2.exe`** from LuxuryCon (email/USB/shared drive).
2. Double-click it. Windows may show **"Windows protected your PC"** (the app isn't
   code-signed yet — this is expected and safe for internal use):
   - Click **More info** → **Run anyway**.
3. Follow the installer (defaults are fine). It installs **per-user — no admin password
   needed** and creates a desktop shortcut.
4. Launch **AquaFlow Studio**. A branded splash appears, then the **Activation screen**.

*Nothing to install first — no Python, no settings, no environment variables. Everything is
bundled.*

---

## Part 2 — Activate (Employee)

On first launch you'll see the **Activation screen** (the studio stays locked until this is done):

1. **Copy your Machine ID.** The screen shows *Your Machine ID* (a long code). Click
   **Copy Machine ID**.
   - If it says *"Could not read Machine ID — is the engine running?"*, wait a few seconds and
     click **Retry reading Machine ID** (the backend is still starting).
2. **Send the Machine ID to LuxuryCon** (email support@luxurycon.com or your admin).
3. LuxuryCon sends you back a **`license.json`** file (issued for your machine). Save it
   somewhere you can find it (e.g. Desktop or Downloads).
4. On the Activation screen, click **Load License File…**, select the `license.json`, and it
   unlocks — the studio opens.
   - Future launches open straight to the studio; you don't activate again.

### If activation is refused
The screen tells you *why*:
- **"This license was issued for a different computer."** — the license was made for another
  machine. Send **your** Machine ID (Part 2 step 1) and ask for a license for **this** PC.
- **"This license file is invalid or damaged."** — the file is corrupted/incomplete. Ask
  LuxuryCon to re-send it (don't edit the file).
- **"That file is not a valid AquaFlow license."** — you picked the wrong file; select the
  `license.json` LuxuryCon sent.

> Loading a wrong or damaged file **never** removes a license you already activated — your
> existing activation is only replaced once a **valid** file is confirmed.

---

## Part 3 — Issue a license (Admin / CEO)

You need this **once** per employee machine. Requires the license secret in your environment
(`AQUAFLOW_LICENSE_SECRET` — already set on your laptop; it's in your password manager).

1. Get the employee's **Machine ID** (they copy it from their Activation screen).
2. Run **one command** (from `aquaflow/backend`):
   ```powershell
   python -m license.license_generator_BETA -f <PASTE_MACHINE_ID> -n "Employee Name" -c "LuxuryCon"
   ```
   This writes `licenses/luxurycon_<date>.json` (STRONG_BETA, 2-year expiry by default).
3. Send that `.json` to the employee. They load it via **Load License File…** (Part 2 step 4).

Full admin reference (editions, expiry, 30-day offline grace, replacing a dead machine, the
secret, security notes): **[LICENSE-ADMIN.md](LICENSE-ADMIN.md)**.

> **The secret must match.** The generator and the installed app must use the **same**
> `AQUAFLOW_LICENSE_SECRET`. Your build already bundles it (in `resources/app-config.json`),
> and your laptop's env var is the same value — so licenses you mint will validate on employee
> installs. If you ever change the secret, every issued license must be re-minted.

---

## Building the installer (Admin, reference)

```powershell
cd aquaflow\desktop
$env:AQUAFLOW_LICENSE_SECRET = "<your secret>"
$env:AQUAFLOW_BUILD_PYTHON  = (py -3.12 -c "import sys;print(sys.executable)")
npm ci
npm run dist          # -> dist\AquaFlowSetup-1.0.2.exe
```
`resources/app-config.json` (git-ignored — lives only on your build machine) must exist first;
it carries the bundled secret. See BUILD.md for details.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| SmartScreen "unknown publisher" | Expected (unsigned). More info → Run anyway. |
| Stuck on splash, never reaches activation | Engine didn't start. Relaunch; if it persists, launch from a terminal to see `[engine]` logs, and confirm the build has `resources/app-config.json` bundled. |
| "Could not read Machine ID" | Backend still starting — click **Retry reading Machine ID**. |
| Antivirus blocks the app/engine | Unsigned exe; allow it / add an exception. A code-signing cert removes this (Tier B). |
| Activation refused | See "If activation is refused" above — the message says exactly why. |
| Machine changed / new PC | The old license won't work (machine-locked). Get the new Machine ID and have the admin issue a fresh license. |
