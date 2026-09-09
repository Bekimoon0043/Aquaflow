"""Offline converter for the six recovered 4KILO music programs."""
from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict

from engine.ican_manual_patterns import MAX_STEP_MS, MAX_STEPS, normalize_pattern
from engine.ican_site_choreography import valve_groups

SAMPLE_RATE = 44_100.0
REQUIRED = {"schemes.csv", "scheme_audio_sections.csv", "scheme_events.csv"}


class LegacyImportError(ValueError):
    pass


def _rows(data: bytes) -> list[dict]:
    text = data.decode("utf-8-sig", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def _pattern_indices(label: str, phase: int) -> set[int] | None:
    name = (label or "").split(",", 1)[0].strip()
    if not name or name[:1].isdigit():
        return None
    if "全开" in name:
        return set(range(1, 65))
    if "奇偶" in name:
        return set(range(1 + phase % 2, 65, 2))
    if "间四" in name:
        return set(range(1 + phase % 4, 65, 4))
    if "间二" in name:
        return set(range(1 + phase % 2, 65, 2))
    if "跑" in name:
        width = 8 if ("一头" in name or "1组" in name) else 16
        start = (phase * 8) % 64
        result = {((start + offset) % 64) + 1 for offset in range(width)}
        if "左" in name:
            result = {65 - item for item in result}
        return result
    if "居中" in name:
        width = 16 if ("2组" in name or "两组" in name) else 24
        return set(range(33 - width // 2, 33 + width // 2))
    if "两边" in name:
        width = 8 if "4头" in name else 16
        return set(range(1, width + 1)) | set(range(65 - width, 65))
    if "左" in name:
        return set(range(1, 33))
    if "右" in name:
        return set(range(33, 65))
    # A readable but unknown valve action still becomes a conservative rotating bank.
    return set(range((phase % 4) * 16 + 1, (phase % 4 + 1) * 16 + 1))


def import_legacy_programs(blob: bytes, *, include_proven_support: bool = True) -> dict:
    if len(blob) > 10 * 1024 * 1024:
        raise LegacyImportError("legacy analysis archive is larger than 10 MB")
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except (zipfile.BadZipFile, OSError) as exc:
        raise LegacyImportError("file is not a valid analysis ZIP") from exc
    by_name = {}
    for info in archive.infolist():
        base = info.filename.replace("\\", "/").rsplit("/", 1)[-1]
        if base and not info.is_dir():
            if info.file_size > 8 * 1024 * 1024 or info.compress_size > 8 * 1024 * 1024:
                raise LegacyImportError(f"archive member {base} is too large")
            by_name[base] = archive.read(info)
    missing = sorted(REQUIRED - set(by_name))
    if missing:
        raise LegacyImportError(f"analysis ZIP is missing: {', '.join(missing)}")

    schemes = _rows(by_name["schemes.csv"])
    sections = _rows(by_name["scheme_audio_sections.csv"])
    events = _rows(by_name["scheme_events.csv"])
    manifest = {row.get("file", ""): row for row in _rows(by_name["music_manifest.csv"])} \
        if "music_manifest.csv" in by_name else {}
    by_scheme_sections: dict[str, list[dict]] = defaultdict(list)
    by_section_events: dict[str, list[dict]] = defaultdict(list)
    for row in sections:
        by_scheme_sections[row.get("scheme_id", "")].append(row)
    for row in events:
        by_section_events[row.get("section", "")].append(row)

    patterns = []
    warnings = []
    for scheme in schemes:
        scheme_id = scheme.get("ID", "")
        ordered = sorted(by_scheme_sections.get(scheme_id, []), key=lambda row: int(row.get("number") or 0))
        if not ordered:
            warnings.append(f"scheme {scheme_id} has no timing sections")
            continue
        current: set[int] = set()
        steps = []
        translated = 0
        for phase, section in enumerate(ordered):
            valve_events = [row for row in by_section_events.get(section.get("ID", ""), []) if row.get("devid") == "328"]
            for event in valve_events:
                state = _pattern_indices(event.get("txt", ""), phase)
                if state is not None:
                    current = state
                    translated += 1
                    break
            try:
                duration_ms = max(100, int(round((int(section["end"]) - int(section["start"])) / SAMPLE_RATE * 1000)))
            except (KeyError, TypeError, ValueError):
                continue
            # Do not energize the captured support state before the first recovered
            # valve action; a possible pump must not run against a closed valve surface.
            groups = valve_groups(current, support=include_proven_support and bool(current))
            if (steps and steps[-1]["groups"] == groups
                    and steps[-1]["duration_ms"] + duration_ms <= MAX_STEP_MS):
                steps[-1]["duration_ms"] += duration_ms
            else:
                while duration_ms > MAX_STEP_MS:
                    steps.append({"duration_ms": MAX_STEP_MS, "groups": groups})
                    duration_ms -= MAX_STEP_MS
                if duration_ms:
                    steps.append({"duration_ms": duration_ms, "groups": groups})
        if len(steps) > MAX_STEPS:
            raise LegacyImportError(f"scheme {scheme_id} exceeds the {MAX_STEPS}-step hardware limit")
        audio_name = scheme.get("audioname") or scheme.get("name") or f"scheme-{scheme_id}"
        audio_filename = (scheme.get("audiofile") or f"{audio_name}.wav").replace("\\", "/").rsplit("/", 1)[-1]
        if audio_filename in manifest:
            try:
                target_ms = int(round(float(manifest[audio_filename]["duration_seconds"]) * 1000))
                gap_ms = target_ms - sum(item["duration_ms"] for item in steps)
                if gap_ms >= 100:
                    # Preserve the silent tail without holding a valve or pump state.
                    steps.append({"duration_ms": gap_ms, "groups": valve_groups([], support=False)})
            except (KeyError, TypeError, ValueError):
                pass
        pattern = normalize_pattern({
            "id": f"legacy-4kilo-{scheme_id}",
            "name": f"Legacy - {scheme.get('name') or audio_name}",
            "description": "Offline conversion of the recovered music program; valve choreography retained structurally.",
            "steps": steps,
            "provenance": {
                "kind": "4KILO-legacy-import",
                "scheme_id": scheme_id,
                "source_events": translated,
                "conversion": "named-action structural translation",
            },
            "music": {
                "filename": audio_filename,
                "duration_s": round(sum(item["duration_ms"] for item in steps) / 1000, 3),
                "bpm": 0,
                "analysis_method": "legacy sample-frame timeline",
            },
            "safety": {
                "designable_outputs": "legacy valves 1-64 only",
                "omitted_legacy_outputs": "valves 65-76, lights, fire outputs",
                "commissioning_locked_groups": [2, 25],
                "support_mode": "exact-proven-state" if include_proven_support else "off",
                "arbitrary_pump_or_frequency_commands": False,
            },
        })
        patterns.append(pattern)
    return {
        "patterns": patterns,
        "count": len(patterns),
        "warnings": warnings + [
            "Pump, frequency, light, fire and legacy valve outputs 65-76 were not imported.",
            "Named legacy effects were translated structurally because the proprietary action blobs are not executed.",
        ],
    }
