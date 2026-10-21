"""
ai_common.py — one way for every AquaFlow AI feature to ask Claude.

All AI features (show director, words → patterns, show critic, design advisor, commissioning
helper) use the same key, model, error messages and structured-output call:

    from services.ai_common import ask_json
    answer, model = ask_json(feature="Show critic", system=SYSTEM, prompt=text, schema=SCHEMA)

  * Key: the one saved on this machine (POST /api/director/key, ~/.aquaflow/director_key) or
    ANTHROPIC_API_KEY / an `ant auth login` profile — see show_director.saved_key().
  * Errors: RuntimeError with a short, user-readable message naming the feature; routes turn it
    into HTTP 502 so the UI can show it as-is.
  * Text only: features send descriptions of the site / song / show, never audio or files.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from services import show_director

MODEL = show_director.MODEL


def make_client():
    """Anthropic client with this machine's key (raises RuntimeError when the SDK is missing)."""
    if not show_director.sdk_available():
        raise RuntimeError("AquaFlow's AI features need the 'anthropic' package in the engine")
    import anthropic
    key = show_director.saved_key()
    return anthropic.Anthropic(api_key=key) if key else anthropic.Anthropic()


def ask_json(*, feature: str, system: str, prompt: str, schema: dict, effort: str = "medium",
             max_tokens: int = 16000, client: Any = None) -> tuple[dict, str]:
    """Ask Claude for a JSON answer that follows `schema` (structured outputs).

    Returns (answer, model). Raises RuntimeError("<feature> …") on any failure.
    """
    if client is None:
        client = make_client()
    import anthropic
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=system,
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError as exc:
        raise RuntimeError(f"{feature}: the API key was not accepted") from exc
    except anthropic.PermissionDeniedError as exc:
        raise RuntimeError(f"{feature}: the API key may not use model {MODEL}") from exc
    except anthropic.RateLimitError as exc:
        raise RuntimeError(f"{feature}: the AI is busy (rate limited) — try again in a minute") from exc
    except anthropic.APIStatusError as exc:
        raise RuntimeError(f"{feature} failed ({exc.status_code})") from exc
    except anthropic.APIConnectionError as exc:
        raise RuntimeError(f"{feature}: the AI could not be reached (no internet?)") from exc
    if response.stop_reason == "refusal":
        raise RuntimeError(f"{feature}: the AI declined this request")
    if response.stop_reason == "max_tokens":
        raise RuntimeError(f"{feature}: the AI's answer was cut off")
    text = next((b.text for b in response.content if getattr(b, "type", "") == "text"), None)
    if not text:
        raise RuntimeError(f"{feature}: the AI returned no answer")
    try:
        answer = json.loads(text)
    except ValueError as exc:
        raise RuntimeError(f"{feature}: the AI returned an unreadable answer") from exc
    if not isinstance(answer, dict):
        raise RuntimeError(f"{feature}: the AI returned an unexpected answer")
    return answer, getattr(response, "model", MODEL)


def clip(text: Optional[str], n: int) -> str:
    """Trim free text from the model for display."""
    return str(text or "")[:n]
