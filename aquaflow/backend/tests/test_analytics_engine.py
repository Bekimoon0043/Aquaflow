"""
Contract tests for the Usage Analytics Engine (AQ-S4-003).

Asserts the three acceptance criteria:
  1. anonymous usage collected (session hashed, PII stripped, consent-gated),
  2. feature statistics collected (count + unique sessions),
  3. adoption metrics available (active windows + per-feature adoption rate).
"""
from datetime import datetime, timedelta, timezone

from services.analytics_engine import AnalyticsEngine, anonymise_id, sanitise_properties


# ── 1. anonymous collection ───────────────────────────────────────────────────

def test_session_id_is_hashed(tmp_path):
    eng = AnalyticsEngine(tmp_path / "a")
    r = eng.track("panel_open", {"panel": "hydraulics"}, session_id="operator@site.com")
    assert r["tracked"] is True
    assert r["session"] == anonymise_id("operator@site.com")
    assert "@" not in r["session"]


def test_pii_properties_stripped_and_ids_hashed(tmp_path):
    eng = AnalyticsEngine(tmp_path / "a")
    eng.track("login", {"email": "bob@x.com", "user_name": "Bob", "user_id": "u-42", "role": "op"},
              session_id="s1")
    props = eng.events()[-1]["props"]
    assert "email" not in props and "user_name" not in props
    assert props["user_id"] == anonymise_id("u-42")
    assert props["role"] == "op"
    assert not any("@" in str(v) for v in props.values())


def test_consent_gating(tmp_path):
    eng = AnalyticsEngine(tmp_path / "a")
    eng.set_consent(False)
    assert eng.track("x", session_id="s")["tracked"] is False
    # persisted across instances
    assert AnalyticsEngine(tmp_path / "a").consent is False
    eng.set_consent(True)
    assert eng.track("x", session_id="s")["tracked"] is True


def test_sanitise_properties_unit():
    clean = sanitise_properties({"panel": "weather", "ip": "10.0.0.1",
                                 "install_id": "abc", "count": 5})
    assert "ip" not in clean
    assert clean["install_id"] == anonymise_id("abc")
    assert clean["count"] == 5


# ── 2. feature statistics ─────────────────────────────────────────────────────

def test_feature_stats(tmp_path):
    eng = AnalyticsEngine(tmp_path / "a")
    for s in ("s1", "s2", "s3"):
        eng.track("panel_open", {"panel": "hydraulics"}, session_id=s)
    eng.track("panel_open", {"panel": "hydraulics"}, session_id="s1")   # repeat
    eng.track("export_dxf", session_id="s1")
    stats = {f["feature"]: f for f in eng.feature_stats()}
    assert stats["panel_open"]["count"] == 4
    assert stats["panel_open"]["unique_sessions"] == 3
    assert stats["export_dxf"]["count"] == 1
    assert eng.feature_stats()[0]["feature"] == "panel_open"    # sorted by count


# ── 3. adoption metrics ───────────────────────────────────────────────────────

def test_adoption_metrics(tmp_path):
    eng = AnalyticsEngine(tmp_path / "a")
    now = datetime.now(timezone.utc)
    iso = lambda d: (now - timedelta(days=d)).isoformat()
    eng.track("panel_open", {"panel": "hydraulics"}, session_id="a", timestamp=iso(0))
    eng.track("panel_open", {"panel": "hydraulics"}, session_id="b", timestamp=iso(0))
    eng.track("panel_open", {"panel": "hydraulics"}, session_id="c", timestamp=iso(10))
    eng.track("open_app", session_id="d", timestamp=iso(40))
    m = eng.adoption_metrics()
    assert m["total_sessions"] == 4
    assert m["active"]["dau"] == 2
    assert m["active"]["wau"] == 2
    assert m["active"]["mau"] == 3
    hy = next(f for f in m["feature_adoption"] if f["feature"] == "panel_open")
    assert abs(hy["adoption_rate"] - 0.75) < 1e-9      # 3 of 4 sessions
    assert m["top_features"][0]["feature"] == "panel_open"


def test_empty_metrics(tmp_path):
    m = AnalyticsEngine(tmp_path / "a").adoption_metrics()
    assert m["total_events"] == 0 and m["total_sessions"] == 0


def test_summary_shape(tmp_path):
    eng = AnalyticsEngine(tmp_path / "a")
    eng.track("panel_open", session_id="s1")
    s = eng.summary()
    assert s["consent"] is True and s["total_events"] == 1 and s["unique_features"] == 1
