"""Persistent export helpers for compiled runtime artifacts."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from services.compiler_bridge import build_compile_report

BASE_DIR = Path(__file__).resolve().parent.parent
COMPILED_DIR = BASE_DIR / "compiled"
COMPILED_DIR.mkdir(exist_ok=True)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=False))


def persist_compiled_artifacts(
    payload: dict[str, Any],
    *,
    mode: str = "simulation",
    runtime_target: str = "industrial_pc",
) -> dict[str, Any]:
    report = build_compile_report(payload, mode=mode, runtime_target=runtime_target)
    bundle = report["deployment_bundle"]
    bundle_id = bundle["bundle_id"]
    bundle_dir = COMPILED_DIR / bundle_id
    bundle_dir.mkdir(parents=True, exist_ok=True)

    canonical_path = bundle_dir / "canonical.luxshow.json"
    session_path = bundle_dir / "runtime-session.json"
    report_path = bundle_dir / "compile-report.json"
    bundle_path = bundle_dir / "deployment-bundle.json"
    manifest_path = bundle_dir / "manifest.json"

    _write_json(canonical_path, report["canonical_package"])
    _write_json(session_path, report["runtime_session"])
    _write_json(report_path, report)
    _write_json(bundle_path, bundle)

    manifest = {
        "bundle_id": bundle_id,
        "show_id": bundle["show_id"],
        "compiled_at": datetime.now(UTC).isoformat(),
        "mode": mode,
        "runtime_target": runtime_target,
        "files": {
            "canonical": str(canonical_path.relative_to(BASE_DIR)).replace("\\", "/"),
            "session": str(session_path.relative_to(BASE_DIR)).replace("\\", "/"),
            "report": str(report_path.relative_to(BASE_DIR)).replace("\\", "/"),
            "bundle": str(bundle_path.relative_to(BASE_DIR)).replace("\\", "/"),
        },
        "summary": report["summary"],
    }
    _write_json(manifest_path, manifest)
    return manifest


def list_compiled_artifacts() -> list[dict[str, Any]]:
    manifests: list[dict[str, Any]] = []
    for manifest_path in sorted(COMPILED_DIR.glob("*/manifest.json"), reverse=True):
        try:
            manifests.append(json.loads(manifest_path.read_text()))
        except Exception:
            continue
    return manifests


def load_bundle_manifest(bundle_id: str) -> dict[str, Any] | None:
    path = COMPILED_DIR / bundle_id / "manifest.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def load_bundle_artifact(bundle_id: str, artifact_name: str) -> dict[str, Any] | None:
    mapping = {
        "manifest": "manifest.json",
        "canonical": "canonical.luxshow.json",
        "session": "runtime-session.json",
        "report": "compile-report.json",
        "bundle": "deployment-bundle.json",
    }
    filename = mapping.get(artifact_name)
    if not filename:
        return None
    path = COMPILED_DIR / bundle_id / filename
    if not path.exists():
        return None
    return json.loads(path.read_text())
