"""ai_common — the one structured-output call every AI feature uses (fake client, no network)."""
import json
from types import SimpleNamespace

import pytest

from services import ai_common

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}


class FakeMessages:
    def __init__(self, text, stop="end_turn"):
        self.text, self.stop, self.calls = text, stop, []

    def create(self, **kw):
        self.calls.append(kw)
        return SimpleNamespace(stop_reason=self.stop, model="claude-opus-5-5",
                               content=[SimpleNamespace(type="text", text=self.text)])


def fake(text, stop="end_turn"):
    m = FakeMessages(text, stop)
    return SimpleNamespace(beta=SimpleNamespace(messages=m)), m


def test_returns_the_answer_and_sends_schema_effort_and_fallbacks():
    client, m = fake(json.dumps({"ok": True}))
    answer, model = ai_common.ask_json(feature="Show critic", system="sys", prompt="p", schema=SCHEMA, effort="low", client=client)
    assert answer == {"ok": True} and model == "claude-opus-5-5"
    call = m.calls[0]
    assert call["model"] == ai_common.MODEL and call["fallbacks"] == "default"
    assert call["output_config"] == {"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}}
    assert call["messages"] == [{"role": "user", "content": "p"}] and call["system"] == "sys"


@pytest.mark.parametrize("text,stop,msg", [
    ("{}", "refusal", "declined"),
    ("{}", "max_tokens", "cut off"),
    ("not json", "end_turn", "unreadable"),
    ("[1, 2]", "end_turn", "unexpected"),
])
def test_failures_name_the_feature(text, stop, msg):
    client, _ = fake(text, stop)
    with pytest.raises(RuntimeError, match=f"Design advisor.*{msg}"):
        ai_common.ask_json(feature="Design advisor", system="s", prompt="p", schema=SCHEMA, client=client)
