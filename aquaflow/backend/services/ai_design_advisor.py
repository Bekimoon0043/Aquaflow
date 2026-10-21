"""
ai_design_advisor.py — optional AI design review of the fountain (Engineering → ✦ AI design review).

Claude reads a compact text description of the fountain design built by the app (nozzles by
area / kind / height / control, valves, pumps with power, flow and VFD, lights, groups that share
jets or pumps, the site capability limits, basin splash / wind limits and the pump flow budget)
and returns plain-word findings: weak spots and upgrades, each with a recommendation. Area ids
are an enum built from the real design, and fixture ids are checked against the ids the app
sent, so a finding never points at something that does not exist.

Advice only: the answer never changes the design. Text only: no drawings or project files.
"""
from __future__ import annotations

from services.ai_common import ask_json, clip

FEATURE = "AI design review"
SEVERITIES = ["high", "medium", "low"]

SYSTEM = (
    "You are a senior musical-fountain engineer reviewing a fountain design for its owner. You receive a "
    "compact description of the design: areas of nozzles (kind, height, how they are controlled), valves, "
    "pumps (power, flow, VFD or not, which jets they feed), lights, groups that share jets or pumps, the "
    "site limits, basin splash / wind limits and the pump flow budget. Find the weak spots that limit the "
    "shows this fountain can perform or risk water outside the basin, pumps running past their flow, or "
    "parts that cannot move on their own; and suggest the upgrades that would help most. Write plain words "
    "for a non-engineer (summary: 2–4 sentences; details in the findings), be specific (name the areas and parts), order findings from most to least "
    "important, and keep to what the data shows: say when a figure is missing instead of guessing. Never "
    "suggest bypassing safety devices. Use only the area ids and part ids you are given."
)


def review_schema(area_ids: list[str]) -> dict:
    """JSON schema for the review, with the design's area ids as an enum."""
    areas = {"type": "array", "items": {"type": "string", "enum": area_ids}} if area_ids else {"type": "array", "items": {"type": "string"}}
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "findings": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "severity": {"type": "string", "enum": SEVERITIES},
                        "areas": areas,
                        "ids": {"type": "array", "items": {"type": "string"}},
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                        "recommendation": {"type": "string"},
                        "estimatedImpact": {"type": "string"},
                    },
                    "required": ["severity", "areas", "ids", "title", "detail", "recommendation", "estimatedImpact"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["summary", "findings"],
        "additionalProperties": False,
    }


def validate(answer: dict, area_ids: list[str], ids: list[str]) -> dict:
    """Keep known ids only, clip the text, sort by severity (belt and braces over the schema)."""
    known_areas, known_ids = set(area_ids), set(ids)
    out = []
    for f in answer.get("findings", []) or []:
        if not isinstance(f, dict) or f.get("severity") not in SEVERITIES or not str(f.get("title", "")).strip():
            continue
        out.append({
            "severity": f["severity"],
            "areas": list(dict.fromkeys(a for a in f.get("areas") or [] if a in known_areas))[:20],
            "ids": list(dict.fromkeys(i for i in f.get("ids") or [] if i in known_ids))[:60],
            "title": clip(f.get("title"), 160), "detail": clip(f.get("detail"), 1200),
            "recommendation": clip(f.get("recommendation"), 800), "estimatedImpact": clip(f.get("estimatedImpact"), 300),
        })
    out.sort(key=lambda f: SEVERITIES.index(f["severity"]))
    return {"summary": clip(answer.get("summary"), 2000), "findings": out[:30]}


def review(description: str, area_ids: list[str], ids: list[str], *, client=None) -> dict:
    """Ask Claude to review the design. Raises RuntimeError with a user-readable message."""
    try:
        answer, model = ask_json(feature=FEATURE, system=SYSTEM, prompt=description, schema=review_schema(area_ids),
                                 effort="medium", client=client)
    except RuntimeError:
        raise
    except Exception as exc:  # e.g. no key at all: the SDK refuses to build a client
        raise RuntimeError(f"{FEATURE}: needs an Anthropic API key (Your fountain → AI director)") from exc
    return {**validate(answer, area_ids, ids), "model": model}
