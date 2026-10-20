"""
show_director.py — Phase 5 optional AI director (reports/Automatic fountain shows for any site.md).

Claude reads a compact text description of the song (section times, energy, drops, mood) and
of the fountain (areas, nozzle families, controls) and returns a section-level show plan as
structured JSON: each section's role in the arc, which areas play, which looks it prefers, hero
moments, a dip before, and a colour. Every id is an enum built from the real site and look
library, so the plan cannot name anything that does not exist. The app's phrase search and
physics compiler still choose the phrases and enforce every hard limit; the rule planner is
the fallback whenever the director is unavailable or declines.

Privacy: only the text description is sent — no audio, no drawings, no project files.
Credentials: ANTHROPIC_API_KEY / an `ant auth login` profile, or a key saved on this machine
with POST /api/director/key (data/director_key, never returned by the API).
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

MODEL = "claude-opus-5-5"
KEY_FILE = Path("data/director_key")
ROLES = ["intro", "verse", "build", "high", "climax", "rest", "outro"]

SYSTEM = (
    "You are the choreographer of a musical fountain show. You receive a song's structure and a fountain's "
    "areas and return a section-by-section plan. Shape a clear arc: hold back early, build towards the "
    "climax at the strongest section (it may not be the last), give the audience a darker, sparser moment "
    "right before big hits, keep hero looks (shooters, finales) rare and on the biggest moments, cast moving "
    "and ring nozzles as the melody and switched jets as the rhythm, use symmetry by default, and use one "
    "colour story for the song with white kept for the climax. Choose only from the ids you are given."
)


def sdk_available() -> bool:
    try:
        import anthropic  # noqa: F401
        return True
    except Exception:
        return False


def saved_key() -> Optional[str]:
    try:
        key = KEY_FILE.read_text(encoding="utf-8").strip()
        return key or None
    except OSError:
        return None


def save_key(key: str) -> None:
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_text(key.strip(), encoding="utf-8")


def credentials_configured() -> bool:
    return bool(saved_key() or os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def plan_schema(area_ids: list[str], look_ids: list[str], sections: int) -> dict:
    """JSON schema for the director's answer, with enums from this site and look library."""
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "palette": {
                "type": "object",
                "properties": {"base": {"type": "string"}, "second": {"type": "string"}, "accent": {"type": "string"}},
                "required": ["base", "second", "accent"], "additionalProperties": False,
            },
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer", "enum": list(range(sections))},
                        "role": {"type": "string", "enum": ROLES},
                        "areas": {"type": "array", "items": {"type": "string", "enum": area_ids}},
                        "looks": {"type": "array", "items": {"type": "string", "enum": look_ids}},
                        "hero": {"type": "boolean"},
                        "dipBefore": {"type": "boolean"},
                        "color": {"type": "string"},
                        "why": {"type": "string"},
                    },
                    "required": ["index", "role", "areas", "looks", "hero", "dipBefore", "color", "why"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["summary", "palette", "sections"],
        "additionalProperties": False,
    }


def validate(answer: dict, area_ids: list[str], look_ids: list[str], sections: int) -> dict:
    """Keep only valid entries (structured outputs already enforce the schema; this is belt and braces)."""
    hexok = lambda c: isinstance(c, str) and len(c) == 7 and c.startswith("#") and all(ch in "0123456789abcdefABCDEF" for ch in c[1:])
    out = []
    seen = set()
    for s in answer.get("sections", []):
        i = s.get("index")
        if not isinstance(i, int) or not (0 <= i < sections) or i in seen or s.get("role") not in ROLES:
            continue
        seen.add(i)
        out.append({
            "index": i, "role": s["role"],
            "areas": [a for a in s.get("areas", []) if a in area_ids],
            "looks": [l for l in s.get("looks", []) if l in look_ids][:6],
            "hero": bool(s.get("hero")), "dipBefore": bool(s.get("dipBefore")),
            "color": s["color"] if hexok(s.get("color")) else None, "why": str(s.get("why", ""))[:300],
        })
    pal = answer.get("palette") or {}
    palette = {k: pal[k] for k in ("base", "second", "accent") if hexok(pal.get(k))}
    return {"summary": str(answer.get("summary", ""))[:600], "palette": palette if len(palette) == 3 else None, "sections": sorted(out, key=lambda s: s["index"])}


def direct(description: str, area_ids: list[str], look_ids: list[str], sections: int, *, client=None) -> dict:
    """Ask Claude for a section-level plan. Raises RuntimeError with a user-readable message on failure."""
    if client is None:
        if not sdk_available():
            raise RuntimeError("The AI director needs the 'anthropic' package in the engine")
        import anthropic
        key = saved_key()
        client = anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()
    import anthropic
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": plan_schema(area_ids, look_ids, sections)}},
            messages=[{"role": "user", "content": description}],
        )
    except anthropic.AuthenticationError as exc:
        raise RuntimeError("The AI director's API key was not accepted") from exc
    except anthropic.PermissionDeniedError as exc:
        raise RuntimeError("The API key may not use the AI director's model") from exc
    except anthropic.RateLimitError as exc:
        raise RuntimeError("The AI director is busy (rate limited) — try again in a minute") from exc
    except anthropic.APIStatusError as exc:
        raise RuntimeError(f"The AI director failed ({exc.status_code})") from exc
    except anthropic.APIConnectionError as exc:
        raise RuntimeError("The AI director could not be reached (no internet?)") from exc
    if response.stop_reason == "refusal":
        raise RuntimeError("The AI director declined this request")
    if response.stop_reason == "max_tokens":
        raise RuntimeError("The AI director's answer was cut off")
    text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), None)
    if not text:
        raise RuntimeError("The AI director returned no plan")
    try:
        answer = json.loads(text)
    except ValueError as exc:
        raise RuntimeError("The AI director returned an unreadable plan") from exc
    plan = validate(answer, area_ids, look_ids, sections)
    plan["model"] = getattr(response, "model", MODEL)
    return plan
