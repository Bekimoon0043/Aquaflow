"""AI design review + commissioning helper — schema, validation, redaction, route errors (fake client, no network)."""
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes import ai_advice_routes
from services import ai_commissioning, ai_common, ai_design_advisor, show_director


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


@pytest.fixture(autouse=True)
def no_real_key(tmp_path, monkeypatch):
    # Never read or write the real ~/.aquaflow key, and never build a real client.
    monkeypatch.setattr(show_director, "KEY_FILE", tmp_path / "director_key")
    monkeypatch.setattr(show_director, "HOME_KEY_FILE", tmp_path / "home" / "director_key")

    def no_client():
        raise RuntimeError("tests never build a real client")
    monkeypatch.setattr(ai_common, "make_client", no_client)


@pytest.fixture
def api():
    app = FastAPI()
    app.include_router(ai_advice_routes.router, prefix="/api/ai")
    return TestClient(app)


AREAS = ["design:perimeter:jet:front", "design:centre:basket:centre"]
IDS = ["jet1", "jet2", "pumpA", "valve1"]
REVIEW = {
    "summary": "Two pumps feed everything; the baskets cannot move on their own.",
    "findings": [
        {"severity": "low", "areas": [], "ids": [], "title": "Lights", "detail": "d", "recommendation": "r", "estimatedImpact": "small"},
        {"severity": "high", "areas": AREAS + ["design:ghost"], "ids": ["pumpA", "nope", "pumpA"], "title": "Pump A over budget",
         "detail": "Demand 900 L/min vs 600.", "recommendation": "Add a VFD pump.", "estimatedImpact": "Full height in the finale"},
        {"severity": "urgent", "areas": [], "ids": [], "title": "bad severity", "detail": "", "recommendation": "", "estimatedImpact": ""},
        {"severity": "medium", "areas": [], "ids": [], "title": "  ", "detail": "", "recommendation": "", "estimatedImpact": ""},
    ],
}


def test_review_schema_uses_the_design_area_ids():
    schema = ai_design_advisor.review_schema(AREAS)
    item = schema["properties"]["findings"]["items"]
    assert item["properties"]["areas"]["items"]["enum"] == AREAS
    assert item["properties"]["severity"]["enum"] == ["high", "medium", "low"]
    assert item["additionalProperties"] is False and schema["additionalProperties"] is False
    # No areas (a design without nozzles yet): no empty enum.
    assert "enum" not in ai_design_advisor.review_schema([])["properties"]["findings"]["items"]["properties"]["areas"]["items"]


def test_review_sends_structured_request_and_validates_ids():
    client, m = fake(REVIEW)
    out = ai_design_advisor.review("FOUNTAIN: 2 areas, 2 pumps, flow budget …", AREAS, IDS, client=client)
    kw = m.calls[0]
    assert kw["model"] == ai_common.MODEL and kw["output_config"]["format"]["type"] == "json_schema"
    assert "bypass" in kw["system"] and kw["messages"][0]["content"].startswith("FOUNTAIN")
    assert [f["severity"] for f in out["findings"]] == ["high", "low"]
    top = out["findings"][0]
    assert top["areas"] == AREAS and top["ids"] == ["pumpA"]
    assert out["model"] == "claude-opus-5-5" and out["summary"].startswith("Two pumps")


def test_review_refusal_names_the_feature():
    client, _ = fake(REVIEW, stop="refusal")
    with pytest.raises(RuntimeError, match="AI design review.*declined"):
        ai_design_advisor.review("x" * 30, AREAS, IDS, client=client)


def test_redaction_hides_keys_passwords_and_licences():
    text = ("connect plc password=hunter2 token: 'abc' api_key=\"sk-ant-api03-SECRET\" Authorization: Bearer eyJhbGciOi.xyz "
            "licence_key=AAAA-BBBB licence expired yesterday hash 0123456789abcdef0123456789abcdef01")
    out = ai_commissioning.redact(text)
    for secret in ("hunter2", "'abc'", "sk-ant", "SECRET", "eyJhbGciOi", "AAAA-BBBB", "0123456789abcdef0123456789abcdef01"):
        assert secret not in out
    assert "licence expired yesterday" in out and "connect plc" in out
    obj = ai_commissioning.redact_obj({"host": "192.168.0.10", "password": "x", "licenseKey": "y", "nested": {"note": "token=zzz"}})
    assert obj == {"host": "192.168.0.10", "password": "[redacted]", "licenseKey": "[redacted]", "nested": {"note": "token=[redacted]"}}


def test_commissioning_prompt_is_redacted_and_capped():
    preflight = [{"code": f"c{i}", "severity": "error", "message": "x" * 900, "fixtureId": f"jet{i}"} for i in range(300)]
    logs = ["S7 connect failed password=hunter2"] + [f"line {i}" for i in range(500)]
    text = ai_commissioning.describe(preflight, {"connection_state": "failed", "plc_password": "p"}, [], logs, "Lebu site")
    assert "hunter2" not in text and '"plc_password":"[redacted]"' in text
    assert "… and 180 more" in text and len(text) <= ai_commissioning.MAX_PROMPT
    assert all(len(l) <= ai_commissioning.MAX_LINE for l in text.splitlines())
    assert "line 58" in text and "line 59" not in text  # 60 lines, the first is the password one


def test_commissioning_validates_ids_and_always_adds_the_safety_note():
    answer = {"summary": "The PLC is not answering.", "safety": ["Lock out pumps before opening the panel."],
              "steps": [{"title": "Check the network cable", "detail": "d", "check": "PLC replies to ping", "relatedIds": ["plc-unreachable", "ghost", "F12"]},
                        {"title": "", "detail": "", "check": "", "relatedIds": []}]}
    client, m = fake(answer)
    out = ai_commissioning.explain([{"code": "plc-unreachable", "severity": "error", "message": "no reply"}], {"connection_state": "failed"},
                                   [{"code": "F12", "severity": "critical", "message": "pump trip"}], ["err 1"], "site", client=client)
    system = m.calls[0]["system"]
    assert "never tell anyone to arm, start" in system and "bypass" in system and "qualified staff" in system
    assert len(out["steps"]) == 1 and out["steps"][0]["relatedIds"] == ["plc-unreachable", "F12"]
    assert out["safety"][0] == ai_commissioning.SAFETY_NOTE and out["safety"][1].startswith("Lock out")


def test_routes_return_answers_and_ai_errors_as_502(api, monkeypatch):
    monkeypatch.setattr(ai_design_advisor, "ask_json", lambda **kw: ({"summary": "ok", "findings": []}, "claude-opus-5-5"))
    r = api.post("/api/ai/design-review", json={"description": "FOUNTAIN: one area of jets " * 2, "areas": AREAS, "ids": IDS})
    assert r.status_code == 200 and r.json() == {"summary": "ok", "findings": [], "model": "claude-opus-5-5"}

    def fail(**kw):
        raise RuntimeError("AI commissioning helper: the API key was not accepted")
    monkeypatch.setattr(ai_commissioning, "ask_json", fail)
    r = api.post("/api/ai/commissioning-help", json={"preflight": [{"code": "x", "severity": "error", "message": "m"}]})
    assert r.status_code == 502 and r.json()["detail"] == "AI commissioning helper: the API key was not accepted"
    # Nothing to explain, too-short description.
    assert api.post("/api/ai/commissioning-help", json={}).status_code == 400
    assert api.post("/api/ai/design-review", json={"description": "short"}).status_code == 422


def test_missing_sdk_or_key_becomes_a_readable_502(api, monkeypatch):
    def broken_client():
        raise TypeError("Could not resolve authentication method")
    monkeypatch.setattr(ai_common, "make_client", broken_client)
    r = api.post("/api/ai/design-review", json={"description": "FOUNTAIN: one area of jets, one pump", "areas": [], "ids": []})
    assert r.status_code == 502 and "needs an Anthropic API key" in r.json()["detail"]


def test_routes_are_registered_in_the_engine(monkeypatch):
    from main import app
    monkeypatch.setattr(ai_design_advisor, "ask_json", lambda **kw: ({"summary": "ok", "findings": []}, "m"))
    c = TestClient(app)
    assert c.post("/api/ai/design-review", json={"description": "FOUNTAIN: one area of jets, one pump"}).status_code == 200
    assert c.post("/api/ai/commissioning-help", json={}).status_code == 400  # registered (not 404), nothing to explain
