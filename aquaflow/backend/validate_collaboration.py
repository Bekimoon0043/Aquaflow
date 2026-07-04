"""
validate_collaboration.py — AquaFlow Stage 3, Priority 10 (AQ-S3-010)

Proves the three acceptance criteria for the Cloud Collaboration System:
  1. Multi-user editing supported (presence + concurrent field-level patches).
  2. Version history available (immutable versions, inspect + revert).
  3. Conflict resolution supported (3-way merge: auto-merge non-overlapping,
     surface + resolve overlapping conflicts).

No server. Exit code 0 = all pass.
Run:  python validate_collaboration.py
"""
import sys

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from services.collaboration import CollabDocument, CollaborationHub, get_hub

PASS, FAIL = "PASS", "FAIL"
results = []


def check(name, ok, detail=""):
    results.append((name, PASS if ok else FAIL, detail))


def new_show():
    return CollabDocument("show-1", {"show": {"name": "Untitled", "bpm": 120, "duration": 120}, "notes": ""})


# ── Criterion 1: multi-user editing ─────────────────────────────────────────────
def test_multi_user():
    doc = new_show()
    doc.join("alice", "Alice", cursor={"track": 1})
    doc.join("bob", "Bob")
    ids = sorted(u["user_id"] for u in doc.active_users())
    check("Multi-user: two users present", ids == ["alice", "bob"], f"{ids}")
    doc.set_cursor("alice", {"track": 2})
    check("Multi-user: cursor/presence tracked",
          next(u for u in doc.active_users() if u["user_id"] == "alice")["cursor"] == {"track": 2}, "")
    doc.leave("bob")
    check("Multi-user: leave removes presence",
          [u["user_id"] for u in doc.active_users()] == ["alice"], "")

    # Two users edit different fields sequentially — both applied.
    r1 = doc.apply_edit("alice", 0, {"show.bpm": 128}, "set bpm")
    r2 = doc.apply_edit("bob", doc.version, {"notes": "hello"}, "note")
    check("Multi-user: sequential edits to different fields both apply",
          r1["status"] == "applied" and r2["status"] == "applied"
          and doc.data["show"]["bpm"] == 128 and doc.data["notes"] == "hello", f"{doc.data}")


# ── Criterion 2: version history ────────────────────────────────────────────────
def test_version_history():
    doc = new_show()
    doc.apply_edit("alice", 0, {"show.name": "Grand Show"}, "rename")
    doc.apply_edit("alice", doc.version, {"show.bpm": 140}, "faster")
    hist = doc.history_list()
    check("History: a version per commit (+initial)", len(hist) == 3, f"{len(hist)}")
    check("History: versions record author + changed paths",
          hist[1]["author"] == "alice" and "show.name" in hist[1]["changed"], f"{hist[1]}")
    check("History: version 1 snapshot preserved (bpm still 120)",
          doc._version(1).snapshot["show"]["bpm"] == 120, "")

    # Revert to version 1 restores that state as a NEW version.
    res = doc.revert("bob", 1)
    check("History: revert restores an old version's data",
          res["status"] == "reverted" and doc.data["show"]["name"] == "Grand Show"
          and doc.data["show"]["bpm"] == 120, f"{doc.data['show']}")
    check("History: revert is itself a new version (history grows)",
          len(doc.history_list()) == 4 and doc.version == 3, f"v={doc.version} len={len(doc.history_list())}")


# ── Criterion 3: conflict resolution ────────────────────────────────────────────
def test_conflict_resolution():
    doc = new_show()
    # Both start from version 0.
    base = doc.version
    # Alice edits bpm → version advances.
    doc.apply_edit("alice", base, {"show.bpm": 130}, "alice bpm")
    # Bob, still on the base version, edits a DIFFERENT field → auto-merge, no conflict.
    rb = doc.apply_edit("bob", base, {"show.duration": 200}, "bob duration")
    check("Conflict: non-overlapping concurrent edits auto-merge (no conflict)",
          rb["status"] == "applied" and doc.data["show"]["duration"] == 200
          and doc.data["show"]["bpm"] == 130, f"{doc.data['show']}")

    # Carol, still on the base version, edits the SAME field Alice changed, different value → conflict.
    rc = doc.apply_edit("carol", base, {"show.bpm": 999}, "carol bpm")
    check("Conflict: overlapping concurrent edit returns a conflict",
          rc["status"] == "conflict" and len(rc["conflicts"]) == 1
          and rc["conflicts"][0]["path"] == "show.bpm", f"{rc}")
    con = rc["conflicts"][0]
    check("Conflict: reports base / mine / theirs",
          con["base"] == 120 and con["mine"] == 999 and con["theirs"] == 130, f"{con}")
    check("Conflict: conflicting value NOT applied (bpm still 130)",
          doc.data["show"]["bpm"] == 130, f"{doc.data['show']['bpm']}")

    # Idempotent: editing the same field to the CURRENT value from an old base → no conflict.
    ri = doc.apply_edit("dave", base, {"show.bpm": 130}, "same value")
    check("Conflict: same-value concurrent edit is idempotent (no conflict)",
          ri["status"] in ("applied", "noop") and not ri["conflicts"], f"{ri}")

    # Resolve the conflict — Carol picks 'mine' (999).
    res = doc.resolve_conflicts("carol", {"show.bpm": con["mine"]}, "resolve keep mine")
    check("Conflict: resolution applies the chosen value + commits",
          res["status"] == "resolved" and doc.data["show"]["bpm"] == 999, f"{doc.data['show']['bpm']}")

    # Partial merge: mixed patch — one clean field + one conflicting field.
    doc2 = new_show(); b2 = doc2.version
    doc2.apply_edit("a", b2, {"show.bpm": 111}, "a")
    rm = doc2.apply_edit("b", b2, {"show.bpm": 222, "notes": "merged"}, "b")
    check("Conflict: partial merge applies clean field, conflicts the rest",
          rm["status"] == "conflict" and "notes" in rm["applied"]
          and doc2.data["notes"] == "merged" and any(c["path"] == "show.bpm" for c in rm["conflicts"]),
          f"{rm}")


# ── Hub integration ─────────────────────────────────────────────────────────────
def test_hub():
    hub = CollaborationHub()
    d = hub.open("s", {"x": 1})
    check("Hub: open returns the same doc on re-open",
          hub.open("s") is d and hub.get("s") is d, "")
    check("Hub: lists documents", hub.list_docs() == ["s"], f"{hub.list_docs()}")


def main() -> int:
    for fn in (test_multi_user, test_version_history, test_conflict_resolution, test_hub):
        fn()
    print("\n" + "=" * 72)
    print("AQ-S3-010 Cloud Collaboration System — Verification")
    print("=" * 72)
    passed = 0
    for name, status, detail in results:
        mark = "[PASS]" if status == PASS else "[FAIL]"
        line = f"{mark} {name}"
        if status == FAIL and detail:
            line += f"  --> {detail}"
        print(line)
        if status == PASS:
            passed += 1
    print("-" * 72)
    print(f"{passed}/{len(results)} checks passed")
    print("=" * 72)
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
