"""
Contract tests for Compile and Deploy Bundle (AQ-X-003).

Asserts the three acceptance criteria:
  1. luxshow_compiler produces a valid, checksum-verified .luxshow bundle (and
     tampering is detected),
  2. runtime_exporter works end-to-end (persist → reload → internally consistent),
  3. on-site playback — the compiled bundle actually plays on the real ShowEngine.
"""
import zipfile

from services.luxshow_compiler import get_compiler, load_luxshow
from services.deploy_verifier import (
    verify_compiler_bundle, verify_runtime_exporter, verify_onsite_playback,
    run_deploy_verification, bundle_to_playable_show,
    sample_editor_show, sample_device_list,
)


# ── 1. valid bundle ───────────────────────────────────────────────────────────

def test_compiler_produces_valid_bundle():
    result = get_compiler().compile(sample_editor_show(), sample_device_list())
    assert result.success
    loaded = load_luxshow(result.bundle_path)
    assert loaded["valid"] is True
    assert loaded["checksum_ok"] is True
    assert loaded["errors"] == []
    # every required member decoded
    for key in ("manifest", "show", "devices", "safety_rules", "deploy"):
        assert loaded[key] is not None
    assert len(loaded["safety_rules"]) >= 5


def test_bundle_checksum_detects_tampering(tmp_path):
    result = get_compiler().compile(sample_editor_show(), sample_device_list())
    tampered = tmp_path / "tampered.luxshow"
    members = {}
    with zipfile.ZipFile(result.bundle_path) as zf:
        for n in zf.namelist():
            members[n] = zf.read(n)
    members["show.json"] = members["show.json"].replace(b'"pump"', b'"flame"')
    with zipfile.ZipFile(tampered, "w", zipfile.ZIP_DEFLATED) as zf:
        for n, b in members.items():
            zf.writestr(n, b)
    loaded = load_luxshow(str(tampered))
    assert loaded["valid"] is False
    assert loaded["checksum_ok"] is False
    assert any("checksum mismatch" in e for e in loaded["errors"])


def test_load_luxshow_rejects_non_bundle(tmp_path):
    junk = tmp_path / "not.luxshow"
    junk.write_bytes(b"this is not a zip file")
    loaded = load_luxshow(str(junk))
    assert loaded["valid"] is False


def test_verify_compiler_bundle_passes():
    r = verify_compiler_bundle()
    assert r["status"] == "pass", r
    assert r["valid"] and r["checksum_ok"]


# ── 2. runtime_exporter end-to-end ────────────────────────────────────────────

def test_runtime_exporter_end_to_end():
    r = verify_runtime_exporter()
    assert r["status"] == "pass", r
    assert r["signature_matches"] is True
    assert r["runtime_session_valid"] is True
    assert set(r["artifacts"]) >= {"canonical", "session", "report", "bundle"}


# ── 3. on-site playback ───────────────────────────────────────────────────────

def test_bundle_to_playable_show_converts_ms_to_seconds():
    result = get_compiler().compile(sample_editor_show(), sample_device_list())
    loaded = load_luxshow(result.bundle_path)
    playable = bundle_to_playable_show(loaded)
    clip = playable["timelineTracks"][0]["clips"][0]
    assert clip["start"] == 0.0
    assert abs(clip["end"] - 3.0) < 1e-9          # 3000 ms → 3.0 s
    assert playable["show"]["duration"] >= 3.0


def test_onsite_playback_of_compiled_bundle():
    r = verify_onsite_playback()
    assert r["status"] == "pass", r
    assert r["started"] is True
    assert r["playhead_advanced"] is True
    assert r["commands_emitted"] > 0
    assert r["pump_intensity_correct"] is True     # pump clip @ 80% → 0.8 on the wire
    assert r["stopped_clean"] is True


# ── full report ───────────────────────────────────────────────────────────────

def test_full_deploy_verification_ready():
    report = run_deploy_verification()
    assert report["deploy_ready"] is True, report
    assert report["summary"]["failed"] == 0
    assert {c["name"] for c in report["checks"]} == {
        "compiler_bundle", "runtime_exporter", "onsite_playback"}
