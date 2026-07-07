"""
engine_entry.py — AF-PKG-002 frozen entry point for the bundled backend
(aquaflow-engine.exe).

Runs the SAME FastAPI `app` as `python main.py`, always in PRODUCTION mode (no reload, no
dev watchers — AF-HUB-000B), bound to localhost for the desktop app. Behaviour is
identical to the dev backend: the commissioning flag, safety kernel, runtime authority,
fail-closed routing and every AF-HUB hardening path are unchanged (this file only starts
the server; it does not alter app behaviour).

The Electron shell (AF-PKG-004) launches this exe with AQUAFLOW_PORT set to a free port
and AQUAFLOW_LICENSE_SECRET set from the bundled config, then waits for /api/health.
"""
import multiprocessing
import os
import sys


def main() -> None:
    # Required for PyInstaller one-file/one-dir bundles that may spawn processes.
    multiprocessing.freeze_support()

    # Force production: the bundle must NEVER run uvicorn's reloader/watchers.
    os.environ.pop("AQUAFLOW_DEV", None)
    os.environ.pop("AQUAFLOW_ENV", None)          # no legacy dev-mode selector in the bundle
    # Desktop app talks to itself over loopback only, unless explicitly overridden.
    os.environ.setdefault("AQUAFLOW_HOST", "127.0.0.1")

    # The license engine requires AQUAFLOW_LICENSE_SECRET at import time. The Electron
    # launcher provides it; fail loudly (not silently) if it is missing so packaging
    # misconfiguration is obvious rather than a mysterious crash.
    if not os.getenv("AQUAFLOW_LICENSE_SECRET"):
        print("[engine] FATAL: AQUAFLOW_LICENSE_SECRET is not set — the bundled launcher "
              "must provide it. Refusing to start.", file=sys.stderr, flush=True)
        raise SystemExit(2)

    import uvicorn
    from main import app  # imports and wires the full app exactly as dev does

    host = os.getenv("AQUAFLOW_HOST", "127.0.0.1")
    port = int(os.getenv("AQUAFLOW_PORT", "8000"))
    print(f"[engine] AquaFlow engine (bundled) — PRODUCTION, serving on {host}:{port}",
          flush=True)
    uvicorn.run(app, host=host, port=port, reload=False, log_level="info")


if __name__ == "__main__":
    main()
