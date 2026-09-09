from pathlib import Path
import io
import zipfile

import pytest

from engine.ican_legacy_importer import LegacyImportError, import_legacy_programs
from engine.ican_manual_patterns import CAPTURED_GROUP17_SUPPORT


DATA = Path(__file__).resolve().parents[1] / "data" / "legacy_4kilo"


def bundled_zip():
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as archive:
        for name in ("schemes.csv", "scheme_audio_sections.csv", "scheme_events.csv"):
            archive.writestr(name, (DATA / name).read_bytes())
    return target.getvalue()


def test_six_old_programs_convert_to_absolute_safe_site_patterns():
    result = import_legacy_programs(bundled_zip())
    assert result["count"] == 6
    assert {item["music"]["filename"] for item in result["patterns"]} == {
        "music-1.wav", "music-3.wav", "music-4.wav", "music-5.wav",
        "music-6.wav", "He's a Pirate.wav",
    }
    for pattern in result["patterns"]:
        assert 1 <= len(pattern["steps"]) <= 500
        assert pattern["provenance"]["source_events"] > 0
        assert all(step["groups"]["2"] == [] and step["groups"]["25"] == []
                   for step in pattern["steps"])
        assert all(step["groups"]["17"] in ([], list(CAPTURED_GROUP17_SUPPORT))
                   for step in pattern["steps"])
        assert all(step["groups"]["1"] or step["groups"]["9"]
                   for step in pattern["steps"] if step["groups"]["17"])
        assert pattern["safety"]["arbitrary_pump_or_frequency_commands"] is False


def test_import_can_leave_support_off_for_dry_commissioning():
    result = import_legacy_programs(bundled_zip(), include_proven_support=False)
    assert all(not step["groups"]["17"]
               for pattern in result["patterns"] for step in pattern["steps"])


def test_import_rejects_incomplete_archive():
    target = io.BytesIO()
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr("schemes.csv", b"ID,name\n1,x\n")
    with pytest.raises(LegacyImportError, match="missing"):
        import_legacy_programs(target.getvalue())
