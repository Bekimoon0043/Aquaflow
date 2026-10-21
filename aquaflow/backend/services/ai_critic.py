"""
ai_critic.py — the show critic ("✦ AI critic" on the plan strip).

After a show exists, the app sends a text description of it: the measured quality (score,
metrics, hard gates and their violations — showMetrics.measureShow), the plan (sections and
their roles, phrases with the look each group plays), the groups and the song sections. Claude
reviews it like a show designer and returns findings, each with an optional fix the app can
apply: swap a phrase's look, shift a phrase or section in time, mute a group there, or change
its level. Every id in a fix is an enum from the request and is checked again here, so a fix
cannot point at anything that does not exist; the app's compiler still enforces every limit.

Privacy: text only — no audio, no drawings, no project files.
"""
from __future__ import annotations

from services import ai_common
from services.ai_compose import client_or_error

FEATURE = "AI critic"
SEVERITIES = ["high", "medium", "low"]
FIX_KINDS = ["swap-look", "retime", "mute", "level", "none"]
MAX_FINDINGS = 12
MAX_SHIFT_S = 4.0

SYSTEM = (
    "You are an experienced musical fountain show designer reviewing a show made in AquaFlow. You get the "
    "show's measured quality (score, metrics 0-1, hard gates), its plan (sections with roles, phrases with the "
    "look each group plays) and the song's sections. Find the few things that most hurt the show for an "
    "audience: a weak or misplaced climax, no dip before big hits, the same look repeated too often, looks that "
    "fight the music, hero looks used too often, groups idle in the climax, hard-gate violations. Order "
    "findings by severity. For each, give a concrete fix when one of these works: 'swap-look' (phraseId, "
    "optional groupId, look), 'retime' (phraseId or sectionId, shiftS seconds, + later / - earlier, at most 4), "
    "'mute' (groupId and phraseId or sectionId), 'level' (level 5-100 % for a phraseId or sectionId, optional "
    "groupId); otherwise 'none' and say what to do in the detail. Use null for fields a fix does not need. "
    "Choose only from the ids you are given. Be brief and specific."
)


def _nullable(schema: dict) -> dict:
    return {"anyOf": [schema, {"type": "null"}]}


def critique_schema(section_ids: list[str], phrase_ids: list[str], group_ids: list[str], look_ids: list[str]) -> dict:
    """JSON schema for the review, with enums from this show's plan, groups and looks."""
    fix = {
        "type": "object",
        "properties": {
            "kind": {"type": "string", "enum": FIX_KINDS},
            "sectionId": _nullable({"type": "string", "enum": section_ids}),
            "phraseId": _nullable({"type": "string", "enum": phrase_ids}),
            "groupId": _nullable({"type": "string", "enum": group_ids}),
            "look": _nullable({"type": "string", "enum": look_ids}),
            "shiftS": _nullable({"type": "number"}),
            "level": _nullable({"type": "integer"}),
        },
        "required": ["kind", "sectionId", "phraseId", "groupId", "look", "shiftS", "level"],
        "additionalProperties": False,
    }
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
                        "title": {"type": "string"},
                        "detail": {"type": "string"},
                        "fix": fix,
                    },
                    "required": ["severity", "title", "detail", "fix"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["summary", "findings"],
        "additionalProperties": False,
    }


def _num(v):
    try:
        x = float(v)
        return x if x == x and abs(x) != float("inf") else None
    except (TypeError, ValueError):
        return None


def validate_fix(fix, sections: set, phrases: dict, groups: set, looks: set) -> dict:
    """A fix the app can apply, or {'kind': 'none'} when it names unknown ids or misses a field."""
    none = {"kind": "none"}
    if not isinstance(fix, dict) or fix.get("kind") not in FIX_KINDS or fix["kind"] == "none":
        return none
    kind = fix["kind"]
    phrase = fix.get("phraseId") if fix.get("phraseId") in phrases else None
    section = phrase.split(":")[0] if phrase else fix.get("sectionId") if fix.get("sectionId") in sections else None
    group = fix.get("groupId") if fix.get("groupId") in groups else None
    if group and phrase and group not in phrases[phrase]:
        group = None                                    # that group does not play in this phrase
    where = {"phraseId": phrase} if phrase else {"sectionId": section} if section else None
    if kind == "swap-look":
        look = fix.get("look") if fix.get("look") in looks else None
        return {"kind": kind, "phraseId": phrase, "groupId": group, "look": look} if phrase and look else none
    if kind == "retime":
        shift = _num(fix.get("shiftS"))
        if not where or shift is None or abs(shift) < 0.05:
            return none
        return {"kind": kind, **where, "shiftS": round(max(-MAX_SHIFT_S, min(MAX_SHIFT_S, shift)), 3)}
    if kind == "mute":
        return {"kind": kind, **where, "groupId": group} if where and group else none
    if kind == "level":
        level = _num(fix.get("level"))
        if not where or level is None:
            return none
        return {"kind": kind, **where, "groupId": group, "level": int(max(5, min(100, round(level))))}
    return none


def validate(answer: dict, section_ids: list[str], phrases: dict, group_ids: list[str], look_ids: list[str]) -> dict:
    """Keep well-formed findings (most severe first); fixes are checked against the given ids."""
    sections, groups, looks = set(section_ids), set(group_ids), set(look_ids)
    out = []
    for f in answer.get("findings", []) or []:
        if not isinstance(f, dict) or f.get("severity") not in SEVERITIES or not str(f.get("title") or "").strip():
            continue
        out.append({"severity": f["severity"], "title": ai_common.clip(f["title"], 120), "detail": ai_common.clip(f.get("detail"), 600),
                    "fix": validate_fix(f.get("fix"), sections, phrases, groups, looks)})
        if len(out) >= MAX_FINDINGS:
            break
    out.sort(key=lambda f: SEVERITIES.index(f["severity"]))
    return {"summary": ai_common.clip(answer.get("summary"), 600), "findings": out}


def critique(description: str, section_ids: list[str], phrases: dict, group_ids: list[str], look_ids: list[str], *, client=None) -> dict:
    """Ask Claude to review the show. `phrases` maps phrase id → the group ids playing in it."""
    if client is None:
        client = client_or_error(FEATURE)
    phrase_ids = list(phrases)
    answer, model = ai_common.ask_json(feature=FEATURE, system=SYSTEM, prompt=description,
                                       schema=critique_schema(section_ids, phrase_ids, group_ids, look_ids), effort="medium", client=client)
    result = validate(answer, section_ids, phrases, group_ids, look_ids)
    result["model"] = model
    return result
