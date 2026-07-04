"""
validate_deploy_bundle.py — AQ-X-003 verification

Proves the compile-and-deploy path end to end:
  1. luxshow_compiler produces a valid .luxshow bundle (ZIP integrity + required
     members + matching checksums), and tampering is detected,
  2. runtime_exporter persists artifacts that reload and stay internally consistent,
  3. the compiled bundle actually plays on the real ShowEngine (on-site playback).

Run:  python backend/validate_deploy_bundle.py   (from the aquaflow/ dir)
"""
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:                                    # ASCII-safe on Windows cp1252 consoles
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.luxshow_compiler import get_compiler, load_luxshow
from services.deploy_verifier import (
    verify_compiler_bundle, verify_runtime_exporter, verify_onsite_playback,
    run_deploy_verification, sample_editor_show, sample_device_list,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


print("== 1. luxshow_compiler produces a valid bundle ==")
res = get_compiler().compile(sample_editor_show(), sample_device_list())
check("compile succeeded", res.success, res.bundle_id)
loaded = load_luxshow(res.bundle_path)
check("bundle is a valid .luxshow", loaded["valid"], str(loaded["errors"]))
check("all checksums match packaged files", loaded["checksum_ok"])
check("manifest + all 4 payloads present",
      all(loaded.get(k) is not None for k in ("manifest", "show", "devices", "safety_rules", "deploy")))
check("safety rules expanded (>=5 base rules)", len(loaded["safety_rules"]) >= 5,
      f'{len(loaded["safety_rules"])} rules')

print("== 2. tampering is detected ==")
# Corrupt one member and confirm the checksum verification catches it.
import tempfile, shutil
tampered = res.bundle_path + ".tampered.luxshow"
shutil.copy(res.bundle_path, tampered)
data = {}
with zipfile.ZipFile(res.bundle_path) as zf:
    for n in zf.namelist():
        data[n] = zf.read(n)
data["show.json"] = data["show.json"].replace(b'"pump"', b'"flame"')  # sneak in a change
with zipfile.ZipFile(tampered, "w", zipfile.ZIP_DEFLATED) as zf:
    for n, b in data.items():
        zf.writestr(n, b)
tl = load_luxshow(tampered)
check("tampered bundle rejected", tl["valid"] is False and tl["checksum_ok"] is False,
      str(tl["errors"])[:80])
os.remove(tampered)

print("== 3. runtime_exporter works end-to-end ==")
rex = verify_runtime_exporter()
check("exporter status pass", rex["status"] == "pass", str(rex.get("errors")))
check("bundle checksum matches canonical signature", rex["signature_matches"])
check("runtime_session revalidates against contract", rex["runtime_session_valid"])
check("all 4 artifacts persisted", set(rex["artifacts"]) >= {"canonical", "session", "report", "bundle"})

print("== 4. on-site playback of the compiled bundle ==")
pb = verify_onsite_playback(loaded)
check("playback started", pb.get("started"))
check("show duration >= 3s", pb.get("duration_s", 0) >= 3.0, f'{pb.get("duration_s")}s')
check("playhead advanced during playback", pb.get("playhead_advanced"), f'{pb.get("playhead_s")}s')
check("timeline clips emitted to output", pb.get("commands_emitted", 0) > 0,
      f'{pb.get("commands_emitted")} cmds')
check("pump clip emitted at intensity 0.8", pb.get("pump_intensity_correct"))
check("stopped cleanly", pb.get("stopped_clean"))

print("== 5. full verification report ==")
report = run_deploy_verification()
check("deploy_ready is True", report["deploy_ready"] is True,
      f'{report["summary"]}')

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
print(f"== deploy_ready: {report['deploy_ready']} ({report['summary']}) ==")
sys.exit(1 if _failed else 0)
