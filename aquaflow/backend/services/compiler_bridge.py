"""Step 3 compiler bridge.

Bridges the current AquaFlow editor/backend payloads to the future canonical
show package and runtime session contracts.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from contracts.runtime_contract import RuntimeDeployRequest, RuntimeSession
from schema_adapter import aqua_to_canonical, runtime_session_from_canonical


DEFAULT_RUNTIME_TARGET = "industrial_pc"


def _stable_hash(value: Any) -> str:
    blob = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def build_canonical_package(payload: dict[str, Any]) -> dict[str, Any]:
    canonical = aqua_to_canonical(payload)
    canonical = deepcopy(canonical)
    signature = _stable_hash({
        "show": canonical.get("show", {}),
        "devices": canonical.get("devices", []),
        "timeline": canonical.get("timeline", []),
        "patch": canonical.get("patch", {}),
    })
    canonical.setdefault("compile", {})["validated"] = True
    canonical["compile"]["signature"] = signature
    canonical["compile"]["compiled_at"] = datetime.now(UTC).isoformat()
    return canonical


def build_runtime_session(payload: dict[str, Any], *, mode: str = "simulation") -> RuntimeSession:
    canonical = build_canonical_package(payload)
    session_dict = runtime_session_from_canonical(canonical, mode=mode)
    return RuntimeSession.model_validate(session_dict)


def build_deployment_bundle(
    payload: dict[str, Any],
    *,
    runtime_target: str = DEFAULT_RUNTIME_TARGET,
    safety_profile: str = "default-field-profile",
    operator_ack_required: bool = True,
) -> dict[str, Any]:
    canonical = build_canonical_package(payload)
    signature = canonical.get("compile", {}).get("signature", _stable_hash(canonical))
    show_id = canonical.get("show", {}).get("id", "show-001")
    bundle_id = f"bundle-{show_id}-{signature[:8]}"
    return {
        "bundle_id": bundle_id,
        "show_id": show_id,
        "runtime_target": runtime_target,
        "artifacts": [
            {"path": f"compiled/{show_id}.luxshow.json", "kind": "canonical_show", "optional": False},
            {"path": f"compiled/{show_id}.runtime-session.json", "kind": "runtime_session", "optional": False},
            {"path": f"compiled/{show_id}.validation-report.json", "kind": "validation_report", "optional": False},
        ],
        "checksums": [
            {"path": f"compiled/{show_id}.luxshow.json", "sha256": signature},
            {"path": f"compiled/{show_id}.runtime-session.json", "sha256": _stable_hash(runtime_session_from_canonical(canonical, mode="live"))},
        ],
        "safety_profile": safety_profile,
        "requires_operator_ack": operator_ack_required,
    }


def build_compile_report(payload: dict[str, Any], *, mode: str = "simulation", runtime_target: str = DEFAULT_RUNTIME_TARGET) -> dict[str, Any]:
    canonical = build_canonical_package(payload)
    session = build_runtime_session(payload, mode=mode)
    bundle = build_deployment_bundle(payload, runtime_target=runtime_target)

    show = canonical.get("show", {})
    timeline = canonical.get("timeline", [])
    patch = canonical.get("patch", {})
    return {
        "status": "compiled",
        "show": show,
        "summary": {
            "track_count": len(timeline),
            "clip_count": sum(len(track.get("clips", [])) for track in timeline),
            "device_count": len(canonical.get("devices", [])),
            "node_count": len(patch.get("nodes", [])),
            "connection_count": len(patch.get("connections", [])),
            "signature": canonical.get("compile", {}).get("signature"),
        },
        "canonical_package": canonical,
        "runtime_session": session.model_dump(mode="json"),
        "deployment_bundle": bundle,
    }


def build_deploy_request(payload: dict[str, Any], *, runtime_target: str = DEFAULT_RUNTIME_TARGET, mode: str = "live") -> RuntimeDeployRequest:
    bundle = build_deployment_bundle(payload, runtime_target=runtime_target)
    return RuntimeDeployRequest(
        bundle_id=bundle["bundle_id"],
        runtime_target=runtime_target,
        mode=mode,
        safety_profile=bundle["safety_profile"],
        operator_ack_required=bundle["requires_operator_ack"],
    )
