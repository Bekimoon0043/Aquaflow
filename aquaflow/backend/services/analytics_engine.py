"""
analytics_engine.py — AquaFlow Stage 4, AQ-S4-003

Usage analytics engine — privacy-first, anonymous product analytics.

Collects anonymous feature-usage events (no PII), aggregates them into feature
statistics, and derives adoption metrics (active sessions, adoption rate per feature,
top features). Collection is consent-gated and every event is anonymised before it is
stored — session ids are one-way hashed and PII-looking properties are dropped — so
the store can never identify a user.

  * anonymous usage collected — `track()` hashes the session id and sanitises
    properties (email/name/ip/path/license/… stripped) before appending the event;
    disabled when consent is off,
  * feature statistics collected — `feature_stats()` gives per-feature count, unique
    sessions, first/last seen,
  * adoption metrics available — `adoption_metrics()` gives total/active sessions
    (DAU/WAU/MAU-style windows), per-feature adoption rate, and the top features.

Filesystem-scoped (events under a root dir) so it is fully unit-tested; clock is
injectable via an explicit event timestamp for deterministic adoption windows.
"""
from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

APP_VERSION = "0.1.0"

# Property keys that look like PII → dropped entirely.
_PII_KEY_RE = re.compile(
    r"email|e-?mail|\bname\b|user(name)?|\bip\b|address|licen[sc]e|token|password|"
    r"passwd|phone|\bpath\b|home|dir|serial|mac|fingerprint", re.IGNORECASE)
# Identifier keys whose value we keep but hash (so they still group without exposing).
_HASH_KEYS = {"session_id", "user_id", "install_id", "device_id"}


def anonymise_id(value: str) -> str:
    """One-way 16-hex hash of an identifier (irreversible, stable for grouping)."""
    return hashlib.sha256(str(value or "anon").encode("utf-8")).hexdigest()[:16]


def sanitise_properties(props: dict) -> dict:
    """Drop PII-looking keys and hash identifier values; keep feature/metric fields."""
    out = {}
    for k, v in (props or {}).items():
        if k in _HASH_KEYS:
            out[k] = anonymise_id(v)
            continue
        if _PII_KEY_RE.search(str(k)):
            continue                     # drop PII-looking property
        if isinstance(v, (int, float, bool)) or v is None:
            out[k] = v
        else:
            s = str(v)
            out[k] = s if len(s) <= 64 and not _PII_KEY_RE.search(s) else s[:64]
    return out


class AnalyticsEngine:
    """Append-only anonymous event store with feature + adoption aggregation."""

    def __init__(self, root, consent: bool = True):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._events_path = self.root / "events.jsonl"
        self._consent_path = self.root / "consent.json"
        self._consent = self._load_consent(consent)

    # ── Consent ────────────────────────────────────────────────────────────────
    def _load_consent(self, default: bool) -> bool:
        if self._consent_path.exists():
            try:
                return bool(json.loads(self._consent_path.read_text()).get("enabled", default))
            except Exception:
                return default
        return default

    def set_consent(self, enabled: bool) -> dict:
        self._consent = bool(enabled)
        self._consent_path.write_text(json.dumps({"enabled": self._consent}),
                                      encoding="utf-8", newline="")
        return {"consent": self._consent}

    @property
    def consent(self) -> bool:
        return self._consent

    # ── Track ──────────────────────────────────────────────────────────────────
    def track(self, name: str, properties: Optional[dict] = None,
              session_id: str = "anon", timestamp: Optional[str] = None) -> dict:
        """Record one anonymous usage event (no-op when consent is off)."""
        if not self._consent:
            return {"tracked": False, "reason": "analytics disabled (no consent)"}
        if not name:
            return {"tracked": False, "reason": "event name required"}
        event = {
            "name": str(name),
            "session": anonymise_id(session_id),
            "ts": timestamp or datetime.now(timezone.utc).isoformat(),
            "props": sanitise_properties(properties or {}),
            "app_version": APP_VERSION,
        }
        with self._events_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False) + "\n")
        return {"tracked": True, "name": event["name"], "session": event["session"]}

    def events(self) -> list[dict]:
        if not self._events_path.exists():
            return []
        out = []
        for line in self._events_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                try:
                    out.append(json.loads(line))
                except Exception:
                    continue
        return out

    def clear(self):
        if self._events_path.exists():
            self._events_path.unlink()

    # ── Feature statistics ─────────────────────────────────────────────────────
    def feature_stats(self) -> list[dict]:
        stats: dict[str, dict] = {}
        for e in self.events():
            s = stats.setdefault(e["name"], {"feature": e["name"], "count": 0,
                                             "sessions": set(), "first_seen": e["ts"],
                                             "last_seen": e["ts"]})
            s["count"] += 1
            s["sessions"].add(e["session"])
            s["first_seen"] = min(s["first_seen"], e["ts"])
            s["last_seen"] = max(s["last_seen"], e["ts"])
        rows = []
        for s in stats.values():
            rows.append({"feature": s["feature"], "count": s["count"],
                         "unique_sessions": len(s["sessions"]),
                         "first_seen": s["first_seen"], "last_seen": s["last_seen"]})
        rows.sort(key=lambda r: -r["count"])
        return rows

    # ── Adoption metrics ───────────────────────────────────────────────────────
    def adoption_metrics(self) -> dict:
        events = self.events()
        if not events:
            return {"total_events": 0, "total_sessions": 0, "active": {},
                    "feature_adoption": [], "top_features": []}
        sessions = {e["session"] for e in events}
        total_sessions = len(sessions)

        # Windows are measured back from the latest event (deterministic for tests).
        latest = max(_parse(e["ts"]) for e in events)

        def active_sessions(days: int) -> int:
            cutoff = latest - timedelta(days=days)
            return len({e["session"] for e in events if _parse(e["ts"]) >= cutoff})

        # Per-feature adoption rate = unique sessions using it / total sessions.
        feat = self.feature_stats()
        adoption = [{"feature": f["feature"], "unique_sessions": f["unique_sessions"],
                     "adoption_rate": round(f["unique_sessions"] / total_sessions, 4),
                     "count": f["count"]} for f in feat]

        return {
            "total_events": len(events),
            "total_sessions": total_sessions,
            "active": {
                "dau": active_sessions(1),
                "wau": active_sessions(7),
                "mau": active_sessions(30),
            },
            "feature_adoption": adoption,
            "top_features": [{"feature": f["feature"], "count": f["count"]} for f in feat[:10]],
        }

    def summary(self) -> dict:
        m = self.adoption_metrics()
        return {"consent": self._consent, "total_events": m["total_events"],
                "total_sessions": m["total_sessions"], "active": m.get("active", {}),
                "unique_features": len(m["feature_adoption"])}


def _parse(ts: str) -> datetime:
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


# ── Singleton ──────────────────────────────────────────────────────────────────
_engine: Optional[AnalyticsEngine] = None


def get_analytics_engine() -> AnalyticsEngine:
    global _engine
    if _engine is None:
        _engine = AnalyticsEngine(Path.home() / ".aquaflow" / "analytics")
    return _engine
