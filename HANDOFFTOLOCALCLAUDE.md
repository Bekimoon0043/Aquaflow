# Handoff brief — AquaFlow Studio frontend/backend connection fix

Paste this whole file into Claude Code in VS Code as your first message.

---

You are picking up a diagnosed-and-fixed issue on **AquaFlow Studio**. A cloud
session did the diagnosis and wrote the fix; it could not touch this machine.
You can. Do the machine-side work.

## Guardrails — read first

1. **Do not modify the commissioning flag or any safety logic.** Not
   `services/bench_safety.py`, not `services/commissioning.py`, not
   `safety/safety_kernel.py`, not `AQUAFLOW_HARDWARE_COMMISSIONED`. This work
   is the frontend-to-backend connection only.
2. **Do not delete anything under `C:\Program Files\AquaFlow Studio`** until
   Task 4's checks are run and their decision rules applied. Back up first.
3. If something contradicts what is written here, **stop and report** rather
   than improvising. The findings below were measured, not assumed — a
   contradiction means the machine state changed.

## What was wrong

The frontend could not reach the backend: REST calls reported as CORS
failures, and the `/ws` WebSocket returning 403.

Root cause — a port-8000 collision across **address families**:

```
::1:8000          wslrelay            (IPv6 loopback)
:::8000           com.docker.backend  (IPv6 wildcard)
127.0.0.1:8000    aquaflow-engine     (IPv4 loopback ONLY)
```

`findFreePort()` in `aquaflow/desktop/launcher.js` probed a candidate port by
binding `127.0.0.1` alone. A port held on the IPv6 side does not block an IPv4
bind, so 8000 looked free and the engine was handed a port it **shared** with
Docker Desktop and the WSL relay. Anything reaching the backend over `::1` — or
over the name `localhost`, which Chromium resolves to `::1` before trying IPv4
— landed on a foreign service, which sends no `Access-Control-Allow-Origin`
header (the browser calls that a CORS failure) and 403s an unknown path (the
`/ws` 403). One cause, both symptoms.

**Ruled out, with evidence — do not re-investigate these:**
- Not a stale build. Installed artifacts are dated 7/8/2026 and the running
  engine's CORS list contained the injected UI-server origin, proving the
  post-`dca7cc6` launcher code is live.
- Not the backend CORS config. `allow_origin_regex` has covered
  `127.0.0.1:<any port>` since the first commit and was never removed.
- Not a WebSocket auth/origin check. There is none in the code; `/ws` does a
  bare `ws.accept()`. There is exactly one middleware in the whole backend.
- Not a missing route. `/api/hardware/commissioning` and `/api/analytics/track`
  are both registered and both return 200.

## The fix (already written, tested, pushed)

Repo `burook-Luxury/aquaflow-studio`, branch
**`claude/fix-findfreeport-address-family`**, commit **`562ca7e`**.

A port now counts as free only when bindable on **every address family present
on the host** — `0.0.0.0`, `::`, `127.0.0.1`, `::1`. Only `EADDRINUSE`/`EACCES`
count as a conflict; `EAFNOSUPPORT`/`EADDRNOTAVAIL`/`EINVAL` mean that family
does not exist on the machine and must not veto the port, or an IPv4-only host
could never start.

Two files: `aquaflow/desktop/launcher.js` (the fix) and
`aquaflow/desktop/scripts/verify-port-selection.js` (a new 9-check regression
script). One caller, `aquaflow/desktop/main.js:272`, which already awaits it.

**Caveat you must close out:** the cloud container had IPv6 compiled out of the
kernel, so the two checks that bind real IPv6 sockets **skipped** there. The
logic was proven instead via an injected prober simulating this machine's
occupancy. On Windows those two checks will execute for real for the first
time. That is Task 2 and it matters.

---

# Tasks

## Task 1 — get the branch and confirm the tree

Find the local working copy (likely
`E:\Burook platform development\Luxurycon\aquaflow-phase1-stabilization-clean`,
but verify it is the `aquaflow-studio` repo and not a different one — check
`git remote -v`). Fetch and check out
`claude/fix-findfreeport-address-family`.

Report: the remote URL, the commit you land on, and `git status`.

## Task 2 — run the port-selection verification ON WINDOWS

```
cd aquaflow\desktop
node scripts/verify-port-selection.js
```

Expect all 9 checks to pass. **Sections 1 and 2 must actually RUN here, not
SKIP** — they bind real IPv6 sockets and are the ones the cloud run could not
execute. If they skip, this machine has no IPv6 and you should say so. If they
fail, stop and report the output verbatim; the fix is wrong and must not ship.

## Task 3 — rebuild, reinstall, verify end to end

Only `launcher.js` changed. It is Electron-side JavaScript that lives in
`app.asar`, so **the PyInstaller engine binary does not need rebuilding** —
avoid a full engine rebuild if the existing `resources/engine/` bundle is
present and current. Work out the minimal correct build from
`aquaflow/desktop/package.json` (`build:web`, `build:engine`, `dist`, `pack`)
and `electron-builder.yml`, and say which you chose and why.

Current install (the live one, keep it):
`C:\Users\buroo\AppData\Local\Programs\AquaFlow Studio`

Then launch the app and verify:

1. The engine no longer takes 8000 while Docker/WSL hold the IPv6 side —
   confirm with `Get-NetTCPConnection -LocalPort 8000 -State Listen` and by
   finding the engine's actual port.
2. `/api/health` succeeds.
3. `/api/hardware/commissioning` succeeds — **read only, do not change the
   flag.** It is expected to report `hardware_commissioned: false`,
   `SIMULATED`. That is correct and must stay that way.
4. The `/ws` WebSocket connects with **no 403**, from the UI-server loopback
   origin.

Paste the WebSocket proof.

## Task 4 — the leftover `C:\Program Files\AquaFlow Studio`

It exists but contains no engine, no `app.asar`, no `index.html`. "No
resources" is not "empty". Run these READ-ONLY checks, then apply the rules.

```powershell
# 1. contents
$f = Get-ChildItem "C:\Program Files\AquaFlow Studio" -Recurse -File -ErrorAction SilentlyContinue
"{0} files, {1:N1} MB" -f $f.Count, (($f | Measure-Object Length -Sum).Sum/1MB)
$f | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize

# 2. registered Windows program?
Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*, HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*, HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\* -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*AquaFlow*" } | Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString

# 3. shortcuts pointing at it?
$ws = New-Object -ComObject WScript.Shell
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu", "$env:PUBLIC\Desktop", "$env:USERPROFILE\Desktop" -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { $t = $ws.CreateShortcut($_.FullName).TargetPath; if ($t -like "*AquaFlow*") { "{0}`n    -> {1}" -f $_.FullName, $t } }

# 4. license / config data?
Get-ChildItem "C:\Program Files\AquaFlow Studio" -Recurse -Include *.json,*.lic,*.key,*.dat,*.log -ErrorAction SilentlyContinue | Select-Object FullName, LastWriteTime
```

Decision rules:

- **Check 2 returns an entry with `InstallLocation` in Program Files** → do NOT
  hand-delete. Run its `UninstallString`, or remove via Settings → Apps.
  Deleting the directory by hand orphans registry entries and can break a
  future installer.
- **Check 3 shows a shortcut targeting Program Files** → fix that FIRST.
  Repoint it to
  `C:\Users\buroo\AppData\Local\Programs\AquaFlow Studio\AquaFlow Studio.exe`.
  A shortcut aimed at a gutted install is a plausible contributor to the
  original fault.
- **Check 4 finds a license/key/`app-config.json`** → copy it somewhere safe
  before touching anything. The engine refuses to boot without
  `AQUAFLOW_LICENSE_SECRET`.
- **Checks 2, 3 and 4 all empty and check 1 shows only stray files** →
  abandoned partial install, safe to remove. Still zip it first and close
  AquaFlow Studio before deleting.

Backup regardless (errors harmlessly if there are no files, which is itself an
answer):
```powershell
Compress-Archive -Path "C:\Program Files\AquaFlow Studio\*" -DestinationPath "$env:USERPROFILE\Desktop\ProgramFiles-AquaFlow-backup.zip"
```

## Task 5 — report

State plainly: what the Windows IPv6 checks did (ran or skipped, pass or fail),
which build command you used, the engine's port after the fix, the WebSocket
result, which Task 4 rule applied and what you did about it. If anything did
not work, say so with the output rather than describing it as done.

Do not open a pull request unless asked.
