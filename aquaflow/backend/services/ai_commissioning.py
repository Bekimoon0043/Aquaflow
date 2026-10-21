"""
ai_commissioning.py — optional AI commissioning helper (Preflight / PLC panel → ✦ Ask AI).

Claude reads the current preflight results, the PLC connection status, recent faults and log
lines and a short site summary, and explains them in plain words with step-by-step checks.
Everything is redacted here (anything that looks like a key, password, token or licence) and
capped in size before it leaves the machine.

Advice only: nothing here (or in the answer) sends, arms, starts or pulses equipment. The system
prompt forbids bypassing interlocks / E-stops and remote starts: every step is an on-site check
for qualified staff, and a fixed safety note is always returned first.
"""
from __future__ import annotations

import json
import re
from typing import Any

from services.ai_common import ask_json, clip

FEATURE = "AI commissioning helper"
SAFETY_NOTE = ("Advice only — AquaFlow sent nothing to the equipment. Qualified staff must make every check on site, "
               "with the system isolated where needed; never bypass interlocks, E-stops or level / pressure protection.")

SYSTEM = (
    "You help a fountain owner commission a musical fountain driven by a Siemens S7 PLC. You receive the "
    "app's preflight results, the PLC connection status, recent faults and log lines and a short site "
    "summary. Explain what is wrong in plain words (summary: 2–4 sentences) and give short, ordered steps to find and fix it, each "
    "with what to check to know it worked. Safety comes first: never tell anyone to bypass, jumper, force "
    "or disable an interlock, E-stop, level / pressure / dry-run protection or any safety device; never "
    "tell anyone to arm, start, pulse or run pumps or valves remotely; any check that involves the "
    "equipment must be done on site by qualified staff with the system made safe (isolated and locked out "
    "where needed). Say when the data is not enough and what to look at next. Only cite related ids that "
    "appear in the input."
)

# What a secret looks like in free text and in dict keys.
_SECRET_WORD = r"(?:api[_ -]?key|secret|passw(?:or)?d|pwd|token|licen[cs]e[_ -]?key|licen[cs]e|auth(?:orization)?|credentials?|private[_ -]?key)"
_TEXT_PATTERNS = [
    (re.compile(r"sk-ant-[A-Za-z0-9_\-]+"), "[redacted]"),
    (re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/\-]+=*"), "Bearer [redacted]"),
    (re.compile(rf"(?i)(\b{_SECRET_WORD}\b[\"']?\s*[:=]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;}}]+)"), r"\1[redacted]"),
    (re.compile(r"-----BEGIN [A-Z ]+-----.*?-----END [A-Z ]+-----", re.S), "[redacted]"),
    (re.compile(r"\b[A-Za-z0-9+/_\-]{32,}={0,2}"), "[redacted]"),
]
_SECRET_KEY = re.compile(rf"(?i){_SECRET_WORD}")

MAX_PREFLIGHT, MAX_FAULTS, MAX_LOGS, MAX_LINE, MAX_PROMPT = 120, 40, 60, 400, 30000


def redact(text: Any) -> str:
    """Free text with anything that looks like a secret replaced by [redacted]."""
    s = str(text if text is not None else "")
    for pattern, repl in _TEXT_PATTERNS:
        s = pattern.sub(repl, s)
    return s


def redact_obj(value: Any, depth: int = 0) -> Any:
    """Dicts / lists with secret-looking keys blanked and every string redacted."""
    if depth > 6:
        return "…"
    if isinstance(value, dict):
        return {str(k): ("[redacted]" if _SECRET_KEY.search(str(k)) else redact_obj(v, depth + 1)) for k, v in list(value.items())[:80]}
    if isinstance(value, (list, tuple)):
        return [redact_obj(v, depth + 1) for v in list(value)[:80]]
    if isinstance(value, str):
        return redact(value)[:MAX_LINE]
    return value


def _line(text: Any) -> str:
    return clip(redact(text).replace("\n", " ").strip(), MAX_LINE)


def related_ids(preflight: list[dict], faults: list[dict]) -> list[str]:
    """Ids the answer may cite: preflight codes and the parts / clips they name, fault codes."""
    ids: list[str] = []
    for d in preflight[:MAX_PREFLIGHT]:
        for k in ("code", "fixtureId", "clipId", "engineeringItemId"):
            if d.get(k):
                ids.append(str(d[k]))
    ids += [str(f["code"]) for f in faults[:MAX_FAULTS] if f.get("code")]
    return list(dict.fromkeys(ids))


def describe(preflight: list[dict], plc: Any, faults: list[dict], logs: list[str], site: str) -> str:
    """The text Claude reads: redacted, one line per item, capped in size."""
    lines = [f"SITE: {_line(site) or 'not described'}"]
    lines.append(f"PREFLIGHT ({len(preflight)} issue{'s' if len(preflight) != 1 else ''}; severity · code · part · message):")
    for d in preflight[:MAX_PREFLIGHT]:
        part = d.get("fixtureId") or d.get("engineeringItemId") or d.get("clipId") or ""
        when = f" @ {d['timeMs'] / 1000:.2f}s" if isinstance(d.get("timeMs"), (int, float)) else ""
        lines.append(_line(f"{d.get('severity', 'warning')} · {d.get('code', '?')} · {part}{when} · {d.get('message', '')}"))
    if len(preflight) > MAX_PREFLIGHT:
        lines.append(f"… and {len(preflight) - MAX_PREFLIGHT} more")
    lines.append("PLC STATUS: " + (clip(json.dumps(redact_obj(plc), default=str, separators=(",", ":")), 6000) if plc else "not connected / no site chosen"))
    lines.append(f"ACTIVE FAULTS ({len(faults)}):")
    for f in faults[:MAX_FAULTS]:
        lines.append(_line(f"{f.get('severity', '?')} · {f.get('code', '?')} · {f.get('source', '')} · {f.get('message', '')}"
                           + (f" · seen {f['occurrences']}×" if f.get("occurrences") else "")))
    lines.append(f"RECENT LOG LINES (newest first, {min(len(logs), MAX_LOGS)}):")
    lines += [_line(l) for l in logs[:MAX_LOGS]]
    lines.append("Explain the most important problems first and give ordered on-site steps.")
    return clip("\n".join(lines), MAX_PROMPT)


def help_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "summary": {"type": "string"},
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"}, "detail": {"type": "string"}, "check": {"type": "string"},
                        "relatedIds": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["title", "detail", "check", "relatedIds"],
                    "additionalProperties": False,
                },
            },
            "safety": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["summary", "steps", "safety"],
        "additionalProperties": False,
    }


def validate(answer: dict, ids: list[str]) -> dict:
    known = set(ids)
    steps = []
    for s in answer.get("steps", []) or []:
        if not isinstance(s, dict) or not str(s.get("title", "")).strip():
            continue
        steps.append({"title": clip(s.get("title"), 160), "detail": clip(s.get("detail"), 1200), "check": clip(s.get("check"), 600),
                      "relatedIds": list(dict.fromkeys(i for i in s.get("relatedIds") or [] if i in known))[:20]})
    safety = [clip(n, 400) for n in answer.get("safety", []) or [] if str(n).strip()][:8]
    return {"summary": clip(answer.get("summary"), 2000), "steps": steps[:15], "safety": [SAFETY_NOTE, *safety]}


def explain(preflight: list[dict], plc: Any, faults: list[dict], logs: list[str], site: str = "", *, client=None) -> dict:
    """Ask Claude to explain the commissioning problems. Raises RuntimeError with a user-readable message."""
    prompt = describe(preflight, plc, faults, logs, site)
    try:
        answer, model = ask_json(feature=FEATURE, system=SYSTEM, prompt=prompt, schema=help_schema(), effort="medium", client=client)
    except RuntimeError:
        raise
    except Exception as exc:  # e.g. no key at all: the SDK refuses to build a client
        raise RuntimeError(f"{FEATURE}: needs an Anthropic API key (Your fountain → AI director)") from exc
    return {**validate(answer, related_ids(preflight, faults)), "model": model}
