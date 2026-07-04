"""
collaboration.py — AquaFlow Stage 3, Priority 10 (AQ-S3-010)

Cloud Collaboration System for shared show documents.

Lets several designers work on the same show at once with optimistic concurrency:

  * Multi-user editing — users join a document (presence + cursors); each edit is
    a field-level patch applied against the base version the user last saw.
  * Version history — every applied change creates an immutable version (author,
    timestamp, message, snapshot, changed paths); you can inspect any version and
    revert to it.
  * Conflict resolution — a three-way, field-level merge: patches to fields that
    nobody else changed since your base version are auto-merged; a field someone
    else changed to a different value is returned as a conflict (base / mine /
    theirs) for the user to resolve.

Documents are plain JSON dicts (the show payload); paths are dot-separated
("show.bpm"). Pure and framework-agnostic → fully unit-tested; the route wires it
to an in-memory hub (swap for Redis/DB in production).
"""
from __future__ import annotations

import copy
import time
from dataclasses import dataclass, field
from typing import Optional, Any


# ── dot-path helpers ────────────────────────────────────────────────────────────
_MISSING = object()


def _get(d: dict, path: str) -> Any:
    cur = d
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return _MISSING
    return cur


def _set(d: dict, path: str, value: Any) -> None:
    parts = path.split(".")
    cur = d
    for part in parts[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    cur[parts[-1]] = value


@dataclass
class Version:
    version: int
    author: str
    message: str
    ts: float
    snapshot: dict
    changed: list

    def to_dict(self, include_snapshot: bool = False) -> dict:
        d = {"version": self.version, "author": self.author, "message": self.message,
             "ts": round(self.ts, 3), "changed": list(self.changed)}
        if include_snapshot:
            d["snapshot"] = self.snapshot
        return d


class CollabDocument:
    def __init__(self, doc_id: str, initial: Optional[dict] = None):
        self.doc_id = doc_id
        self.data: dict = copy.deepcopy(initial or {})
        self.version = 0
        self.history: list[Version] = [
            Version(0, "system", "initial", time.time(), copy.deepcopy(self.data), [])
        ]
        self.users: dict = {}   # user_id -> presence

    # ── Presence / multi-user ──────────────────────────────────────────────────
    def join(self, user_id: str, name: str = "", cursor: Any = None) -> dict:
        p = self.users.get(user_id) or {"user_id": user_id, "joined_at": time.time()}
        p.update({"name": name or user_id, "cursor": cursor, "last_seen": time.time()})
        self.users[user_id] = p
        return p

    def leave(self, user_id: str) -> None:
        self.users.pop(user_id, None)

    def set_cursor(self, user_id: str, cursor: Any) -> None:
        if user_id in self.users:
            self.users[user_id]["cursor"] = cursor
            self.users[user_id]["last_seen"] = time.time()

    def active_users(self) -> list[dict]:
        return list(self.users.values())

    # ── Versions ───────────────────────────────────────────────────────────────
    def _version(self, n: int) -> Optional[Version]:
        for v in self.history:
            if v.version == n:
                return v
        return None

    def _changed_since(self, base_version: int) -> set:
        changed = set()
        for v in self.history:
            if v.version > base_version:
                changed.update(v.changed)
        return changed

    def _value_at(self, version: int, path: str):
        v = self._version(version)
        if not v:
            return _MISSING
        return _get(v.snapshot, path)

    def _commit(self, author: str, message: str, changed: list) -> Version:
        self.version += 1
        ver = Version(self.version, author, message, time.time(),
                      copy.deepcopy(self.data), list(changed))
        self.history.append(ver)
        return ver

    # ── Editing with 3-way merge ───────────────────────────────────────────────
    def apply_edit(self, user_id: str, base_version: int, changes: dict, message: str = "") -> dict:
        """
        Apply a field-level patch made against `base_version`. Non-conflicting
        fields (nobody else changed them since base) are merged; fields others
        changed to a different value come back as conflicts.
        """
        if not isinstance(changes, dict) or not changes:
            return {"status": "noop", "version": self.version, "applied": [], "conflicts": []}
        changed_since = self._changed_since(base_version)
        applied, conflicts = {}, []
        for path, newval in changes.items():
            curval = _get(self.data, path)
            if base_version >= self.version or path not in changed_since:
                applied[path] = newval                      # clean or non-overlapping → merge
            elif curval == newval:
                applied[path] = newval                      # someone made the same change → idempotent
            else:
                conflicts.append({"path": path,
                                  "base": _jsonable(self._value_at(base_version, path)),
                                  "mine": newval,
                                  "theirs": _jsonable(curval)})
        for path, val in applied.items():
            _set(self.data, path, val)
        if applied:
            self._commit(user_id, (message or "edit") + (" (partial)" if conflicts else ""), list(applied.keys()))
        status = "conflict" if conflicts else ("applied" if applied else "noop")
        return {"status": status, "version": self.version,
                "applied": list(applied.keys()), "conflicts": conflicts}

    def resolve_conflicts(self, user_id: str, resolutions: dict, message: str = "resolve") -> dict:
        """Force-apply resolved values (path → chosen value) against the current
        version, committing them."""
        applied = {}
        for path, value in (resolutions or {}).items():
            _set(self.data, path, value)
            applied[path] = value
        if applied:
            self._commit(user_id, message, list(applied.keys()))
        return {"status": "resolved", "version": self.version, "applied": list(applied.keys())}

    def revert(self, user_id: str, version: int) -> dict:
        v = self._version(version)
        if not v:
            return {"status": "error", "reason": f"version {version} not found"}
        self.data = copy.deepcopy(v.snapshot)
        self._commit(user_id, f"revert to v{version}", list(self.data.keys()))
        return {"status": "reverted", "version": self.version, "restored_from": version}

    def history_list(self) -> list[dict]:
        return [v.to_dict() for v in self.history]

    def snapshot(self) -> dict:
        return {"doc_id": self.doc_id, "version": self.version,
                "data": copy.deepcopy(self.data), "users": self.active_users()}


def _jsonable(v):
    return None if v is _MISSING else v


# ── Hub (in-memory document store) ──────────────────────────────────────────────
class CollaborationHub:
    def __init__(self):
        self._docs: dict[str, CollabDocument] = {}

    def open(self, doc_id: str, initial: Optional[dict] = None) -> CollabDocument:
        if doc_id not in self._docs:
            self._docs[doc_id] = CollabDocument(doc_id, initial)
        return self._docs[doc_id]

    def get(self, doc_id: str) -> Optional[CollabDocument]:
        return self._docs.get(doc_id)

    def list_docs(self) -> list[str]:
        return sorted(self._docs.keys())


_hub: Optional[CollaborationHub] = None


def get_hub() -> CollaborationHub:
    global _hub
    if _hub is None:
        _hub = CollaborationHub()
    return _hub
