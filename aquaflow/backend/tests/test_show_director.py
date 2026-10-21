"""Phase 5 AI director — schema, validation, refusal handling, key never returned (no network)."""
import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from services import show_director

AREAS = ["design:a:jet:front", "design:a:jet:back", "design:b:basket:centre"]
LOOKS = ["wave", "pulse", "stadium-wave", "grand-finale"]


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


ANSWER = {
    "summary": "Quiet start, build into a late climax.",
    "palette": {"base": "#1e4fd8", "second": "#18b7c9", "accent": "#ffb347"},
    "sections": [
        {"index": 0, "role": "intro", "areas": ["design:b:basket:centre"], "looks": ["wave"], "hero": False, "dipBefore": False, "color": "#1e4fd8", "why": "calm"},
        {"index": 1, "role": "climax", "areas": AREAS + ["design:ghost"], "looks": ["grand-finale", "nope"], "hero": True, "dipBefore": True, "color": "white", "why": "peak"},
        {"index": 1, "role": "verse", "areas": [], "looks": [], "hero": False, "dipBefore": False, "color": "#000000", "why": "duplicate"},
        {"index": 9, "role": "verse", "areas": [], "looks": [], "hero": False, "dipBefore": False, "color": "#000000", "why": "out of range"},
    ],
}


def test_schema_uses_the_sites_ids():
    schema = show_director.plan_schema(AREAS, LOOKS, 3)
    item = schema["properties"]["sections"]["items"]["properties"]
    assert item["areas"]["items"]["enum"] == AREAS
    assert item["looks"]["items"]["enum"] == LOOKS
    assert item["index"]["enum"] == [0, 1, 2]
    assert schema["additionalProperties"] is False


def test_direct_sends_structured_request_and_validates():
    client, m = fake(ANSWER)
    plan = show_director.direct("Song: 4 min, climax at 3:10. Fountain: 3 areas.", AREAS, LOOKS, 2, client=client)
    kw = m.calls[0]
    assert kw["model"] == "claude-opus-5-5"
    assert kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]
    assert kw["output_config"]["format"]["type"] == "json_schema"
    assert [s["index"] for s in plan["sections"]] == [0, 1]
    climax = plan["sections"][1]
    assert climax["areas"] == AREAS and climax["looks"] == ["grand-finale"] and climax["color"] is None
    assert plan["palette"]["accent"] == "#ffb347"


def test_refusal_and_cut_off_answers_raise():
    client, _ = fake(ANSWER, stop="refusal")
    with pytest.raises(RuntimeError, match="declined"):
        show_director.direct("x" * 30, AREAS, LOOKS, 2, client=client)
    client, _ = fake(ANSWER, stop="max_tokens")
    with pytest.raises(RuntimeError, match="cut off"):
        show_director.direct("x" * 30, AREAS, LOOKS, 2, client=client)


def test_key_is_saved_locally_and_never_returned(tmp_path, monkeypatch):
    monkeypatch.setattr(show_director, "KEY_FILE", tmp_path / "director_key")
    monkeypatch.setattr(show_director, "HOME_KEY_FILE", tmp_path / "home" / "director_key")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    from main import app
    c = TestClient(app)
    assert c.get("/api/director/status").json()["configured"] is False
    assert c.post("/api/director/key", json={"key": "sk-ant-test-0123456789"}).json() == {"configured": True}
    status = c.get("/api/director/status").json()
    assert status["configured"] is True and "sk-ant" not in json.dumps(status)
    assert (tmp_path / "home" / "director_key").read_text() == "sk-ant-test-0123456789"
    # A key saved by an older version in the engine's data/ folder is still read.
    (tmp_path / "home" / "director_key").unlink()
    (tmp_path / "director_key").write_text("sk-ant-old-0123456789")
    assert show_director.saved_key() == "sk-ant-old-0123456789"
