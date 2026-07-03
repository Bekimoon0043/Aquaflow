"""
Backend contract tests (AQ-S1-009).

Covers the canonical schema adapters and the runtime contract — the boundary the
frontend, compiler, and runtime all agree on. A break here silently corrupts
every saved/loaded/compiled show, so these are the highest-value backend tests.
"""
from tests.sample_data import sample_aqua_show

from schema_adapter import (
    aqua_to_canonical,
    canonical_to_aqua,
    runtime_session_from_canonical,
)
from contracts.runtime_contract import RuntimeSession, RuntimeCommand


# ── Canonical schema shape ─────────────────────────────────────────────────────
def test_aqua_to_canonical_has_required_sections():
    canonical = aqua_to_canonical(sample_aqua_show())
    for key in ("format", "show", "devices", "patch", "timeline", "compile"):
        assert key in canonical, f"canonical missing '{key}'"
    assert canonical["format"]["extension"] == ".luxshow"


def test_duration_converts_seconds_to_ms():
    canonical = aqua_to_canonical(sample_aqua_show())
    # 4 seconds → 4000 ms
    assert canonical["show"]["duration_ms"] == 4000


# ── Round-trip identity on the show contract ───────────────────────────────────
def test_roundtrip_preserves_core_show_fields():
    original = sample_aqua_show()
    canonical = aqua_to_canonical(original)
    restored = canonical_to_aqua(canonical)

    assert restored["show"]["id"] == original["show"]["id"]
    assert restored["show"]["name"] == original["show"]["name"]
    assert restored["show"]["bpm"] == original["show"]["bpm"]
    # duration round-trips seconds → ms → seconds
    assert float(restored["show"]["duration"]) == float(original["show"]["duration"])
    assert restored["show"]["sampleRate"] == original["show"]["sampleRate"]


def test_roundtrip_preserves_timeline_clip():
    original = sample_aqua_show()
    restored = canonical_to_aqua(aqua_to_canonical(original))
    tracks = restored["timelineTracks"]
    assert len(tracks) == 1
    clips = tracks[0]["clips"]
    assert len(clips) == 1


# ── Runtime session contract ───────────────────────────────────────────────────
def test_runtime_session_from_canonical_validates_against_pydantic():
    canonical = aqua_to_canonical(sample_aqua_show())
    session_dict = runtime_session_from_canonical(canonical, mode="design")
    # Must satisfy the pydantic RuntimeSession contract.
    session = RuntimeSession(**session_dict)
    assert session.bundle_id == "show-smoke"
    assert session.mode == "design"
    assert session.transport == "stopped"


def test_runtime_commands_are_derived_from_timeline():
    canonical = aqua_to_canonical(sample_aqua_show())
    session_dict = runtime_session_from_canonical(canonical)
    assert len(session_dict["commands"]) == 1
    cmd = session_dict["commands"][0]
    # timestamp is microseconds; clip starts at 0
    assert cmd["timestamp_us"] == 0
    assert cmd["device_id"] == "pump-1"


def test_runtime_command_rejects_missing_required_fields():
    import pytest
    with pytest.raises(Exception):
        # RuntimeCommand requires an action/command id — empty payload is invalid.
        RuntimeCommand()
