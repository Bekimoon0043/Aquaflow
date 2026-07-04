"""
Contract tests for the Cloud Collaboration System (AQ-S3-010).

Asserts multi-user presence/editing, version history + revert, and 3-way
conflict resolution.
"""
from services.collaboration import CollabDocument, CollaborationHub


def _doc():
    return CollabDocument("s", {"show": {"name": "Untitled", "bpm": 120, "duration": 120}, "notes": ""})


def test_multi_user_presence():
    d = _doc()
    d.join("alice", "Alice")
    d.join("bob", "Bob")
    assert sorted(u["user_id"] for u in d.active_users()) == ["alice", "bob"]
    d.leave("bob")
    assert [u["user_id"] for u in d.active_users()] == ["alice"]


def test_sequential_edits_apply():
    d = _doc()
    r1 = d.apply_edit("a", 0, {"show.bpm": 128})
    r2 = d.apply_edit("b", d.version, {"notes": "hi"})
    assert r1["status"] == "applied" and r2["status"] == "applied"
    assert d.data["show"]["bpm"] == 128 and d.data["notes"] == "hi"


def test_version_history_and_revert():
    d = _doc()
    d.apply_edit("a", 0, {"show.name": "Grand"})
    d.apply_edit("a", d.version, {"show.bpm": 140})
    hist = d.history_list()
    assert len(hist) == 3 and hist[1]["author"] == "a" and "show.name" in hist[1]["changed"]
    assert d._version(1).snapshot["show"]["bpm"] == 120
    d.revert("b", 1)
    assert d.data["show"]["name"] == "Grand" and d.data["show"]["bpm"] == 120
    assert d.version == 3 and len(d.history_list()) == 4


def test_auto_merge_non_overlapping():
    d = _doc()
    base = d.version
    d.apply_edit("a", base, {"show.bpm": 130})
    r = d.apply_edit("b", base, {"show.duration": 200})
    assert r["status"] == "applied"
    assert d.data["show"]["bpm"] == 130 and d.data["show"]["duration"] == 200


def test_overlapping_conflict_reported():
    d = _doc()
    base = d.version
    d.apply_edit("a", base, {"show.bpm": 130})
    r = d.apply_edit("c", base, {"show.bpm": 999})
    assert r["status"] == "conflict" and len(r["conflicts"]) == 1
    c = r["conflicts"][0]
    assert c["path"] == "show.bpm" and c["base"] == 120 and c["mine"] == 999 and c["theirs"] == 130
    assert d.data["show"]["bpm"] == 130   # conflicting value not applied


def test_idempotent_same_value():
    d = _doc()
    base = d.version
    d.apply_edit("a", base, {"show.bpm": 130})
    r = d.apply_edit("dave", base, {"show.bpm": 130})
    assert r["status"] in ("applied", "noop") and not r["conflicts"]


def test_resolve_conflict():
    d = _doc()
    base = d.version
    d.apply_edit("a", base, {"show.bpm": 130})
    r = d.apply_edit("c", base, {"show.bpm": 999})
    res = d.resolve_conflicts("c", {"show.bpm": r["conflicts"][0]["mine"]})
    assert res["status"] == "resolved" and d.data["show"]["bpm"] == 999


def test_partial_merge():
    d = _doc()
    base = d.version
    d.apply_edit("a", base, {"show.bpm": 111})
    r = d.apply_edit("b", base, {"show.bpm": 222, "notes": "merged"})
    assert r["status"] == "conflict"
    assert "notes" in r["applied"] and d.data["notes"] == "merged"
    assert any(c["path"] == "show.bpm" for c in r["conflicts"])


def test_hub():
    hub = CollaborationHub()
    a = hub.open("s", {"x": 1})
    assert hub.open("s") is a and hub.get("s") is a
    assert hub.list_docs() == ["s"]
