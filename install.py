#!/usr/bin/env python3
"""
install.py — AquaFlow Studio one-click installer (AQ-S4-001)

Bootstraps an AquaFlow Studio deployment in one command:

    python install.py [--target DIR] [--edition beta] [--skip-frontend] [--skip-deps]

Steps:
  1. provision the install directory (config/data/logs/compiled/cache) + manifest,
  2. install backend Python dependencies (pip),
  3. build the frontend (npm ci + npm run build),
  4. print how to start the app and activate a license.

The directory provisioning + manifest are handled by
aquaflow/backend/services/installer.InstallManager so the same logic is unit-tested.
Dependency/build steps are skippable for CI or offline installs.
"""
import argparse
import subprocess
import sys
from pathlib import Path

try:                                    # ASCII-safe on Windows cp1252 consoles
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

REPO = Path(__file__).resolve().parent
BACKEND = REPO / "aquaflow" / "backend"
FRONTEND = REPO / "aquaflow" / "frontend"


def _run(cmd, cwd):
    print(f"  $ {' '.join(str(c) for c in cmd)}  (in {cwd})")
    return subprocess.call(cmd, cwd=str(cwd)) == 0


def main() -> int:
    ap = argparse.ArgumentParser(description="AquaFlow Studio one-click installer")
    ap.add_argument("--target", default=str(Path.home() / ".aquaflow" / "install"),
                    help="install directory (default: ~/.aquaflow/install)")
    ap.add_argument("--edition", default="beta")
    ap.add_argument("--skip-deps", action="store_true", help="skip pip install")
    ap.add_argument("--skip-frontend", action="store_true", help="skip npm build")
    ap.add_argument("--force", action="store_true", help="re-provision even if installed")
    args = ap.parse_args()

    sys.path.insert(0, str(BACKEND))
    from services.installer import InstallManager, get_app_version   # noqa: E402

    print(f"AquaFlow Studio installer — version {get_app_version()}")
    print("=" * 60)

    print("[1/3] Provisioning install directory...")
    mgr = InstallManager(args.target)
    report = mgr.install(edition=args.edition, force=args.force)
    if report.get("already_installed"):
        print(f"  Already installed at {args.target} (v{report.get('version')}).")
    else:
        for s in report.get("steps", []):
            print(f"  [ok] {s}")
        if not report.get("ok"):
            print(f"  [FAIL] verification failed: {report.get('verification')}")
            return 1
    print(f"  Install id: {mgr.info().get('install_id')}")

    ok = True
    if not args.skip_deps:
        print("[2/3] Installing backend dependencies...")
        req = BACKEND / "requirements.txt"
        if req.exists():
            ok = _run([sys.executable, "-m", "pip", "install", "-r", str(req)], BACKEND) and ok
        else:
            print("  (no requirements.txt found — skipping)")
    else:
        print("[2/3] Skipping backend dependencies (--skip-deps).")

    if not args.skip_frontend:
        print("[3/3] Building frontend...")
        npm = "npm.cmd" if sys.platform.startswith("win") else "npm"
        if (FRONTEND / "package.json").exists():
            _run([npm, "ci"], FRONTEND)
            ok = _run([npm, "run", "build"], FRONTEND) and ok
        else:
            print("  (no frontend/package.json — skipping)")
    else:
        print("[3/3] Skipping frontend build (--skip-frontend).")

    print("=" * 60)
    print("Done." if ok else "Completed with warnings (see above).")
    print("Start the backend:  cd aquaflow/backend && python -m uvicorn main:app --port 8000")
    print("Activate a license: POST /api/installer/activate  (or place active_license.json)")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
