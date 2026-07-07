# AquaFlow Studio — First Build Guide (for the CEO)

A copy-paste, no-experience-needed guide to build **AquaFlowSetup.exe** on your own Windows PC,
then install and test it. Follow it top to bottom. If a step fails, see **Common problems** at
the bottom of that section.

> You do **not** need to be a developer. You will copy commands into a black terminal window
> and read the output. Total time the first time: **about 45–75 minutes** (most of it waiting
> for downloads and the build).

---

## PART A — Prerequisites (install these once)

You need four things: **Git**, **Node.js**, **Python 3.12**, and the **project code**.

### A1. Install Git  (~5 min)
1. Open https://git-scm.com/download/win in your browser.
2. The download starts automatically ("64-bit Git for Windows Setup"). Run it.
3. Click **Next** through every screen (the defaults are fine), then **Install**, then **Finish**.
4. **Verify:** press `Windows key`, type `powershell`, press Enter, and in the blue window type:
   ```powershell
   git --version
   ```
   Success looks like: `git version 2.xx.x`. If you see that, Git is installed.

### A2. Install Node.js (LTS)  (~5 min)
1. Open https://nodejs.org/en/download in your browser.
2. Download the **Windows Installer (.msi), LTS** version (the left, recommended one).
3. Run it. Click **Next** / accept the license / **Next** / **Install** / **Finish**.
   (If it offers "Automatically install the necessary tools", you can leave it **unchecked**.)
4. **Verify** in a **new** PowerShell window:
   ```powershell
   node --version
   npm --version
   ```
   Success: two version numbers (e.g. `v20.x.x` and `10.x.x`).

### A3. Install Python 3.12  (~5 min)  — *must be 3.12, not 3.13/3.14*
1. Open https://www.python.org/downloads/release/python-3129/ in your browser.
2. Scroll to **Files**, download **"Windows installer (64-bit)"**.
3. Run it. **IMPORTANT:** on the first screen, tick **"Add python.exe to PATH"** at the bottom,
   then click **Install Now**. Finish.
4. **Verify** in a **new** PowerShell window:
   ```powershell
   py -3.12 --version
   ```
   Success: `Python 3.12.x`.

   *Why 3.12 specifically:* the tool that packages the backend (PyInstaller) does not support
   Python 3.13 or 3.14. 3.12 is required for the build even though the app itself runs fine on newer Python.

### A4. Get the project code  (~5 min)
1. In PowerShell, go to where you keep projects and download the code:
   ```powershell
   cd $HOME\Documents
   git clone https://github.com/burook-Luxury/aquaflow-studio.git
   cd aquaflow-studio
   ```
   *(If you already have the folder, instead do: `cd` into it and run `git pull`.)*
2. **Verify:** you should now be inside a folder that contains an `aquaflow` sub-folder:
   ```powershell
   dir aquaflow
   ```

**Common problems (Part A)**
- *"git/node/py is not recognized"* → close and reopen PowerShell (PATH updates only apply to
  new windows). If it still fails, re-run that installer and make sure PATH was added.

---

## PART B — Build the installer  (~20–40 min, mostly waiting)

Do these in order, in one PowerShell window, from inside the `aquaflow-studio` folder.

### B1. Install the frontend + desktop dependencies  (~10 min, downloads a lot)
```powershell
cd $HOME\Documents\aquaflow-studio\aquaflow\frontend
npm ci
cd ..\desktop
npm ci
```
*What it does:* downloads the building blocks for the app's screen and the desktop shell.
*Success looks like:* it finishes without red `ERR!` lines and returns you to the prompt.
*Takes:* several minutes each; the second one also downloads the Electron runtime (~100 MB).

### B2. Tell the build which Python to use, and provide the license secret
```powershell
$env:AQUAFLOW_BUILD_PYTHON = (py -3.12 -c "import sys;print(sys.executable)")
$env:AQUAFLOW_LICENSE_SECRET = "choose-a-long-random-secret-and-keep-it-private"
```
*What it does:* points the packager at Python 3.12 and sets the licensing secret the app needs.
Use the **same** secret you use to generate licenses (see LICENSE-ADMIN.md).
*Note:* these two lines only apply to the current window. If you close it, run them again.

### B3. Install the backend packaging tool (PyInstaller) into Python 3.12  (~3 min)
```powershell
py -3.12 -m pip install --upgrade pip
py -3.12 -m pip install -r ..\backend\requirements.txt pyinstaller
```
*Success:* ends with `Successfully installed …` and no red errors.

### B4. Build everything and produce the installer  (~10–20 min)
```powershell
npm run dist
```
*What it does, in order:* builds the app screen → freezes the Python backend into an `.exe` →
wraps it all into a Windows installer.
*Success looks like:* near the end you see lines mentioning `nsis` and a file being written to
`dist\`, and it returns to the prompt with no red errors.
*Takes:* this is the long one — let it run.

### B5. Find your installer
```powershell
dir dist\*.exe
```
You should see **`AquaFlowSetup-1.0.0.exe`** (the number matches the app version).
Its full path is `…\aquaflow-studio\aquaflow\desktop\dist\AquaFlowSetup-1.0.0.exe`.

**Common problems (Part B)**
- *`npm ci` fails with network errors* → re-run it; it resumes. Check your internet.
- *PyInstaller error "unsupported Python"* → you are not on 3.12. Re-check B2 (`$env:AQUAFLOW_BUILD_PYTHON`
  must point at the 3.12 python from A3).
- *Build fails mentioning a missing module* → run `py -3.12 -m pip install -r ..\backend\requirements.txt`
  again (B3) and retry B4.
- *"AQUAFLOW_LICENSE_SECRET … not set"* → you closed the window; re-run B2, then B4.

---

## PART C — Test the installer  (~10 min)

### C1. Install it
1. Double-click `AquaFlowSetup-1.0.0.exe` in the `dist` folder.
2. **Windows SmartScreen** will likely say *"Windows protected your PC / Unknown publisher."*
   **This is expected** — the app is not code-signed for Tier A (a deliberate decision). Click
   **"More info"**, then **"Run anyway"**.
3. Follow the installer: choose the folder (default is fine), let it create a desktop shortcut,
   click **Install**, then **Finish** (you can let it launch on finish).

### C2. Test the installed app
Check each of these:
- [ ] A branded **splash** screen appears (dark green, shield, "AquaFlow Studio").
- [ ] After a few seconds the **main window** opens with the AquaFlow interface (not a blank or
      "Frontend not built" page).
- [ ] The **taskbar icon** is the AquaFlow shield-with-water icon.
- [ ] **Help → About** shows the version and "by LuxuryCon".
- [ ] The app works: you can open the designer/programmer screens.
- [ ] **Close** the app — it shuts down cleanly (no leftover windows).

### C3. Test the file association
- [ ] If you have a `.aquashow` file, double-click it — AquaFlow opens and loads it.

**Common problems (Part C)**
- *No window after the splash, or an error dialog* → note the exact message and report it (see
  below). The most common cause is the license secret not matching; the app needs a valid setup.
- *Antivirus flags the unsigned installer* → expected for an unsigned build; allow it. Signing is
  a Tier B task.

---

## PART D — What to report back

Send this back so we know the build is good (or what to fix):

1. **Did `npm run dist` finish and produce `AquaFlowSetup-1.0.0.exe`?** (yes/no)
2. **Did the installer run and the app open to the real interface?** (yes/no)
3. **Screenshots:** the splash, the main window, and Help → About.
4. **Any red error text** — copy the last ~20 lines from the terminal, or a photo of the error
   dialog.
5. **The `.aquashow` double-click test** result (if you have a file).

That's it. Once the build is confirmed on your machine, we finalize the packaging checklist in
`AF-PKG-VERIFICATION-REPORT.md`.

---

### Reference docs
- **BUILD.md** (`aquaflow/desktop/BUILD.md`) — the developer version of these build steps.
- **RELEASE.md** (`aquaflow/desktop/RELEASE.md`) — versioning, unsigned-build note, update feed.
- **LICENSE-ADMIN.md** (repo root) — issuing licenses to LuxuryCon PCs.
- **BRAND.md** (`aquaflow/desktop/BRAND.md`) — the logo/icon system.
