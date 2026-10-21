"""Words → patterns and the show critic — schema, validation, route errors (fake client, no network)."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from services import ai_common, ai_compose, ai_critic, show_director

GROUPS = ["design:a:jet:front", "design:a:jet:back", "group-drums"]
LOOKS = ["wave", "pulse", "firework-burst", "grand-finale"]


class FakeMessages:
    def __init__(self, answer, stop="end_turn"):
        self.answer, self.stop, self.calls = answer, stop, []

    def create(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(stop_reason=self.stop, model="claude-opus-5-5",
                               content=[SimpleNamespace(type="text", text=json.dumps(self.answer))])


def fake(answer, stop="end_turn"):
    m = FakeMessages(answer, stop)
    return SimpleNamespace(beta=SimpleNamespace(messages=m)), m


@pytest.fixture
def no_key(tmp_path, monkeypatch):
    """Never touch the real ~/.aquaflow key."""
    monkeypatch.setattr(show_director, "KEY_FILE", tmp_path / "director_key")
    monkeypatch.setattr(show_director, "HOME_KEY_FILE", tmp_path / "home" / "director_key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)


# ── compose ──────────────────────────────────────────────────────────────────
PLACEMENTS = {
    "summary": "Blue wave at the back in the chorus, fireworks on the drop, white finale.",
    "placements": [
        {"groupId": "design:a:jet:back", "look": "wave", "start": 30, "end": 60, "color": "#1e4fd8", "low": 20, "high": 70, "why": "chorus"},
        {"groupId": "group-drums", "look": "firework-burst", "start": 58, "end": 70, "color": "#ffb347", "low": 0, "high": 140, "why": "drop"},
        {"groupId": "design:a:jet:front", "look": "grand-finale", "start": 170, "end": 400, "color": "white", "low": 90, "high": 60, "why": "end"},
        {"groupId": "design:ghost", "look": "wave", "start": 0, "end": 10, "color": "#000000", "low": 0, "high": 50, "why": "unknown group"},
        {"groupId": "group-drums", "look": "nope", "start": 0, "end": 10, "color": "#000000", "low": 0, "high": 50, "why": "unknown look"},
        {"groupId": "group-drums", "look": "pulse", "start": 100, "end": 100.4, "color": "#000000", "low": 0, "high": 50, "why": "too short"},
        {"groupId": "group-drums", "look": "pulse", "start": -20, "end": 5, "color": "#00ff00", "low": 10, "high": 50, "why": "clamped start"},
    ],
}


def test_compose_schema_uses_the_given_ids():
    schema = ai_compose.compose_schema(GROUPS, LOOKS)
    item = schema["properties"]["placements"]["items"]
    assert item["properties"]["groupId"]["enum"] == GROUPS
    assert item["properties"]["look"]["enum"] == LOOKS
    assert item["additionalProperties"] is False and schema["additionalProperties"] is False


def test_compose_sends_structured_request_and_validates():
    client, m = fake(PLACEMENTS)
    out = ai_compose.compose("Groups: … Song: 3:00 … User: blue wave in the chorus", GROUPS, LOOKS, 180, client=client)
    kw = m.calls[0]
    assert kw["model"] == ai_common.MODEL and kw["output_config"]["format"]["type"] == "json_schema"
    assert kw["system"] == ai_compose.SYSTEM
    ps = out["placements"]
    assert [p["groupId"] for p in ps] == ["group-drums", "design:a:jet:back", "group-drums", "design:a:jet:front"]
    first = ps[0]
    assert first["start"] == 0 and first["end"] == 5 and first["color"] == "#00ff00"
    drop = ps[2]
    assert drop["high"] == 100 and drop["low"] == 0
    end = ps[3]
    assert end["end"] == 180 and end["color"] is None and end["low"] == 60 and end["high"] == 60
    assert out["model"] == "claude-opus-5-5"


def test_compose_caps_the_number_of_placements():
    many = {"summary": "", "placements": [{"groupId": "group-drums", "look": "pulse", "start": i, "end": i + 2, "color": "#ffffff", "low": 0, "high": 80, "why": ""} for i in range(120)]}
    out = ai_compose.validate(many, GROUPS, LOOKS, 600)
    assert len(out["placements"]) == ai_compose.MAX_PLACEMENTS


def test_compose_refusal_raises_readable_error():
    client, _ = fake(PLACEMENTS, stop="refusal")
    with pytest.raises(RuntimeError, match="AI compose: the AI declined"):
        ai_compose.compose("x" * 30, GROUPS, LOOKS, 180, client=client)


# ── critic ───────────────────────────────────────────────────────────────────
SECTIONS = ["S1", "S2", "S3"]
PHRASES = {"S1:0": ["design:a:jet:front"], "S2:0": ["design:a:jet:front", "design:a:jet:back"], "S3:0": ["group-drums"]}


def fix(kind, **kw):
    base = {"kind": kind, "sectionId": None, "phraseId": None, "groupId": None, "look": None, "shiftS": None, "level": None}
    return {**base, **kw}


REVIEW = {
    "summary": "Good arc, but the climax is thin.",
    "findings": [
        {"severity": "low", "title": "Late hits", "detail": "Pulses land after the beat.", "fix": fix("retime", phraseId="S1:0", shiftS=-9)},
        {"severity": "high", "title": "Thin climax", "detail": "Swap to a finale.", "fix": fix("swap-look", phraseId="S2:0", groupId="design:a:jet:back", look="grand-finale")},
        {"severity": "medium", "title": "Too loud intro", "detail": "", "fix": fix("level", sectionId="S1", level=250)},
        {"severity": "medium", "title": "Mute ghost", "detail": "", "fix": fix("mute", sectionId="S9", groupId="group-drums")},
        {"severity": "medium", "title": "Swap wrong group", "detail": "", "fix": fix("swap-look", phraseId="S1:0", groupId="group-drums", look="pulse")},
        {"severity": "urgent", "title": "Bad severity", "detail": "", "fix": fix("none")},
        {"severity": "low", "title": "Mute drums in S3", "detail": "", "fix": fix("mute", phraseId="S3:0", groupId="group-drums")},
    ],
}


def test_critic_schema_uses_the_given_ids():
    schema = ai_critic.critique_schema(SECTIONS, list(PHRASES), GROUPS, LOOKS)
    f = schema["properties"]["findings"]["items"]["properties"]["fix"]
    assert f["properties"]["phraseId"]["anyOf"][0]["enum"] == list(PHRASES)
    assert f["properties"]["look"]["anyOf"][0]["enum"] == LOOKS
    assert f["properties"]["kind"]["enum"] == ai_critic.FIX_KINDS
    assert set(f["required"]) == set(f["properties"])


def test_critique_validates_fixes_against_the_plan():
    client, m = fake(REVIEW)
    out = ai_critic.critique("Score 61/100 … plan … " * 3, SECTIONS, PHRASES, GROUPS, LOOKS, client=client)
    assert m.calls[0]["output_config"]["format"]["type"] == "json_schema"
    fs = out["findings"]
    assert [f["severity"] for f in fs] == ["high", "medium", "medium", "medium", "low", "low"]
    assert fs[0]["fix"] == {"kind": "swap-look", "phraseId": "S2:0", "groupId": "design:a:jet:back", "look": "grand-finale"}
    assert fs[1]["fix"] == {"kind": "level", "sectionId": "S1", "groupId": None, "level": 100}
    assert fs[2]["fix"] == {"kind": "none"}                       # unknown section
    # A group that does not play in the phrase: the swap applies to the whole phrase.
    assert fs[3]["fix"] == {"kind": "swap-look", "phraseId": "S1:0", "groupId": None, "look": "pulse"}
    assert fs[4]["fix"] == {"kind": "retime", "phraseId": "S1:0", "shiftS": -4.0}
    assert fs[5]["fix"] == {"kind": "mute", "phraseId": "S3:0", "groupId": "group-drums"}
    assert out["model"] == "claude-opus-5-5"


def test_critique_cut_off_raises():
    client, _ = fake(REVIEW, stop="max_tokens")
    with pytest.raises(RuntimeError, match="AI critic: the AI's answer was cut off"):
        ai_critic.critique("x" * 30, SECTIONS, PHRASES, GROUPS, LOOKS, client=client)


# ── routes ───────────────────────────────────────────────────────────────────
def test_routes_return_the_message_as_502(no_key, monkeypatch):
    from main import app
    c = TestClient(app)

    def boom(*a, **kw):
        raise RuntimeError("AI compose: the API key was not accepted")
    monkeypatch.setattr(ai_compose, "compose", boom)
    r = c.post("/api/ai/compose", json={"description": "x" * 30, "groups": GROUPS, "looks": LOOKS, "duration": 180})
    assert r.status_code == 502 and r.json()["detail"] == "AI compose: the API key was not accepted"

    seen = {}

    def ok(description, sections, phrases, groups, looks):
        seen.update(phrases=phrases)
        return {"summary": "ok", "findings": [], "model": "claude-opus-5-5"}
    monkeypatch.setattr(ai_critic, "critique", ok)
    body = {"description": "x" * 30, "sections": SECTIONS, "phrases": [{"id": k, "groups": v} for k, v in PHRASES.items()], "groups": GROUPS, "looks": LOOKS}
    r = c.post("/api/ai/critique", json=body)
    assert r.status_code == 200 and r.json()["summary"] == "ok" and seen["phrases"] == PHRASES


def test_routes_reject_bad_requests(no_key):
    from main import app
    c = TestClient(app)
    assert c.post("/api/ai/compose", json={"description": "short", "groups": GROUPS, "looks": LOOKS, "duration": 180}).status_code == 422
    assert c.post("/api/ai/compose", json={"description": "x" * 30, "groups": [], "looks": LOOKS, "duration": 180}).status_code == 422
    assert c.post("/api/ai/critique", json={"description": "x" * 30, "sections": [], "phrases": [], "groups": GROUPS, "looks": LOOKS}).status_code == 422


def test_missing_key_gives_a_readable_message(no_key, monkeypatch):
    class NoKey:
        def __init__(self, **kw):
            raise Exception("The api_key client option must be set")
    if not show_director.sdk_available():
        pytest.skip("anthropic SDK not installed")
    import anthropic
    monkeypatch.setattr(anthropic, "Anthropic", NoKey)
    with pytest.raises(RuntimeError, match="AI compose needs an Anthropic API key"):
        ai_compose.compose("x" * 30, GROUPS, LOOKS, 180)
    with pytest.raises(RuntimeError, match="AI critic needs an Anthropic API key"):
        ai_critic.critique("x" * 30, SECTIONS, PHRASES, GROUPS, LOOKS)
