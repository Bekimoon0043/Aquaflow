"""
ai_compose.py — words → patterns ("AI compose" in Show Studio's AI tab).

The user types plain language ("back row slow blue wave in the chorus, drums fireworks on the
drop, everything white at the end"). The app sends a compact text description of the show
groups, the song (sections, drops, tempo), the look library and those words; Claude returns
placements — which group plays which look, when, in what colour and at what level. Group and
look ids are enums from the request, so a placement cannot name anything that does not exist.
The app turns each placement into a real, editable pattern with its own look → recipe
machinery (planRender), so every hardware limit still applies at compile.

Privacy: text only — no audio, no drawings, no project files.
"""
from __future__ import annotations

from services import ai_common

FEATURE = "AI compose"
MAX_PLACEMENTS = 80
MIN_LENGTH_S = 1.0

SYSTEM = (
    "You are the choreographer of a musical fountain show. The user describes in plain words what the water "
    "should do; you turn that into placements: one group, one look, a start and end time in seconds, a colour "
    "and a level range. Follow the user's words literally first (which groups, which looks, which moments), and "
    "place things on the song's sections and drops when the user names them (chorus, drop, the end). Pick looks "
    "the group can perform (its control type must be in the look's controls and it needs at least the look's "
    "minimum jets). 'Everything' or 'all' means every group. Keep placements on one group from overlapping. "
    "Colours are #rrggbb; white is #ffffff. Levels are 0-100 % of the group's allowed height (low <= high). "
    "Explain each placement in a few words in 'why'. Choose only from the ids you are given."
)


def _hex(c) -> bool:
    return isinstance(c, str) and len(c) == 7 and c.startswith("#") and all(ch in "0123456789abcdefABCDEF" for ch in c[1:])


def compose_schema(group_ids: list[str], look_ids: list[str]) -> dict:
    """JSON schema for the answer, with enums from this show's groups and the look library."""
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "placements": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "groupId": {"type": "string", "enum": group_ids},
                        "look": {"type": "string", "enum": look_ids},
                        "start": {"type": "number"},
                        "end": {"type": "number"},
                        "color": {"type": "string"},
                        "low": {"type": "integer"},
                        "high": {"type": "integer"},
                        "why": {"type": "string"},
                    },
                    "required": ["groupId", "look", "start", "end", "color", "low", "high", "why"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["summary", "placements"],
        "additionalProperties": False,
    }


def validate(answer: dict, group_ids: list[str], look_ids: list[str], duration: float) -> dict:
    """Keep only valid placements: known ids, times inside the song (≥ 1 s long), levels 0–100."""
    groups, looks = set(group_ids), set(look_ids)
    out = []
    for p in answer.get("placements", []) or []:
        if not isinstance(p, dict) or p.get("groupId") not in groups or p.get("look") not in looks:
            continue
        try:
            start, end = float(p.get("start")), float(p.get("end"))
        except (TypeError, ValueError):
            continue
        start, end = max(0.0, min(start, duration)), max(0.0, min(end, duration))
        if end - start < MIN_LENGTH_S:
            continue
        try:
            low, high = int(round(float(p.get("low", 0)))), int(round(float(p.get("high", 100))))
        except (TypeError, ValueError):
            low, high = 0, 100
        high = max(5, min(100, high))
        low = max(0, min(low, high))
        out.append({"groupId": p["groupId"], "look": p["look"], "start": round(start, 3), "end": round(end, 3),
                    "color": p["color"] if _hex(p.get("color")) else None, "low": low, "high": high,
                    "why": ai_common.clip(p.get("why"), 200)})
        if len(out) >= MAX_PLACEMENTS:
            break
    out.sort(key=lambda p: (p["start"], p["groupId"]))
    return {"summary": ai_common.clip(answer.get("summary"), 600), "placements": out}


def client_or_error(feature: str = FEATURE):
    """The Anthropic client, or a RuntimeError telling the user to add a key."""
    try:
        return ai_common.make_client()
    except RuntimeError:
        raise
    except Exception as exc:  # the SDK refuses to start without credentials
        raise RuntimeError(f"{feature} needs an Anthropic API key (Your fountain → AI director)") from exc


def compose(description: str, group_ids: list[str], look_ids: list[str], duration: float, *, client=None) -> dict:
    """Ask Claude for placements. Raises RuntimeError with a user-readable message on failure."""
    if client is None:
        client = client_or_error(FEATURE)
    answer, model = ai_common.ask_json(feature=FEATURE, system=SYSTEM, prompt=description,
                                       schema=compose_schema(group_ids, look_ids), effort="medium", client=client)
    result = validate(answer, group_ids, look_ids, duration)
    result["model"] = model
    return result

