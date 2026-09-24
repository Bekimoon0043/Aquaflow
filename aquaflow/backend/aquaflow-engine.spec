# -*- mode: python ; coding: utf-8 -*-
# AF-PKG-002 — PyInstaller spec for the AquaFlow backend bundle (aquaflow-engine.exe).
#
# Build (on a Python 3.10–3.12 venv — PyInstaller does NOT support the repo's 3.14 venv):
#     pip install pyinstaller
#     pip install -r requirements.txt
#     pyinstaller aquaflow-engine.spec --noconfirm
#   → dist/aquaflow-engine/aquaflow-engine.exe   (one-dir; fast start, easy to sign)
#
# Produces a ONE-DIR bundle (not one-file): one-dir starts faster and is friendlier to
# code-signing + electron-builder packaging than one-file's temp-extract.

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

block_cipher = None

# ── Data files bundled next to the exe ────────────────────────────────────────────
# Runtime JSON catalogs the services read (parts, nozzles, fixture library, etc.). The
# per-user shows/ + data/ that the app WRITES live under the OS app-data dir at runtime,
# not here — only read-only seed data is bundled.
datas = []
datas += collect_data_files("data", include_py_files=False)        # backend/data/*.json
datas += [("data", "data")]                                        # ensure the folder ships
# asyncua ships its standard address space as a pickle next to the package.
datas += collect_data_files("asyncua", include_py_files=False)

# ── Hidden imports PyInstaller's static analysis can miss ──────────────────────────
# uvicorn's protocol/loop implementations are imported by string at runtime, and several
# route/service modules are imported lazily inside functions.
hiddenimports = []
hiddenimports += collect_submodules("uvicorn")
hiddenimports += collect_submodules("api.routes")
hiddenimports += collect_submodules("services")
hiddenimports += collect_submodules("engine")
hiddenimports += collect_submodules("safety")
# PLC integration libraries (1.2.5): python-snap7 (pure Python), asyncua (+ its
# crypto stack), pycomm3. All three are imported lazily inside driver methods,
# which PyInstaller's static analysis does not follow.
hiddenimports += collect_submodules("snap7")
hiddenimports += collect_submodules("asyncua")
hiddenimports += collect_submodules("pycomm3")
hiddenimports += collect_submodules("cryptography")
hiddenimports += ["OpenSSL", "OpenSSL.crypto", "sortedcontainers", "dateutil", "pytz", "aiosqlite"]
hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops.auto", "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto", "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto", "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on",
    "anyio._backends._asyncio",
    "app_state", "main",
]

a = Analysis(
    ["engine_entry.py"],
    pathex=["."],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Trim heavy libs that are NOT part of the runtime server (they belong to offline
    # validate_*/analysis scripts only). Keep this list conservative — verify on the
    # build machine that the server still starts after excluding.
    excludes=["tkinter", "matplotlib", "PyQt5", "PySide2", "notebook", "IPython"],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="aquaflow-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,           # console app; the Electron shell hides the window (AF-PKG-004)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    # icon="../desktop/build/icon.ico",   # branded in AF-PKG-005 once the asset exists
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="aquaflow-engine",
)
