"""
Contract tests for the Crash Reporting System (AQ-S4-002).

Asserts the three acceptance criteria:
  1. automatic logs uploaded (report → spool → upload, offline outbox + retry),
  2. crash fingerprints generated (stable per bug, distinct across bugs),
  3. support reports generated (readable, with system info + traceback + logs).
"""
import traceback

import pytest

from services.crash_reporter import (
    CrashReporter, LogRingBuffer, crash_fingerprint, build_crash_report,
    report_from_exception, generate_support_report,
)


def _tb(func, line):
    return (f'Traceback (most recent call last):\n'
            f'  File "/opt/app/services/{func}.py", line {line}, in {func}\n'
            f'    do_thing()\nValueError: boom')


# ── 2. fingerprints ───────────────────────────────────────────────────────────

def test_fingerprint_is_stable_hex():
    fp = crash_fingerprint("ValueError", _tb("show_engine", 10))
    assert len(fp) == 12 and all(c in "0123456789abcdef" for c in fp)


def test_same_bug_same_fingerprint_ignoring_line_numbers():
    assert crash_fingerprint("ValueError", _tb("show_engine", 10)) == \
           crash_fingerprint("ValueError", _tb("show_engine", 99))


def test_different_location_or_type_differs():
    base = crash_fingerprint("ValueError", _tb("show_engine", 10))
    assert base != crash_fingerprint("ValueError", _tb("protocol_bus", 10))
    assert base != crash_fingerprint("KeyError", _tb("show_engine", 10))


def test_path_style_does_not_change_fingerprint():
    win = ('Traceback (most recent call last):\n'
           '  File "C:\\\\opt\\\\app\\\\services\\\\show_engine.py", line 5, in show_engine\n'
           '    x()\nValueError: boom')
    assert crash_fingerprint("ValueError", win) == crash_fingerprint("ValueError", _tb("show_engine", 5))


def test_report_from_live_exception():
    try:
        {}["missing"]
    except Exception as e:
        rep = report_from_exception(e, context={"where": "test"})
    assert rep["exc_type"] == "KeyError"
    assert len(rep["fingerprint"]) == 12
    assert rep["context"]["where"] == "test"


# ── 1. automatic upload ───────────────────────────────────────────────────────

def test_report_uploads_and_attaches_logs(tmp_path):
    logs = LogRingBuffer()
    logs.add("started"); logs.add("playing s1")
    rep = CrashReporter(tmp_path / "crash", log_buffer=logs)
    r = rep.report("ValueError", "boom", _tb("show_engine", 10), context={"screen": "timeline"})
    assert r["uploaded"] is True and r["fingerprint"]
    assert (tmp_path / "crash" / "sink" / f"{r['id']}.json").exists()
    assert rep.outbox_count() == 0
    stored = rep.get_report(r["id"])
    assert any("playing s1" in l for l in stored["recent_logs"])


def test_offline_outbox_and_flush(tmp_path):
    state = {"fail": True}
    def transport(_r):
        if state["fail"]:
            raise RuntimeError("network down")
        return True
    rep = CrashReporter(tmp_path / "crash", transport=transport)
    r = rep.report("KeyError", "missing", _tb("protocol_bus", 5))
    assert r["uploaded"] is False
    assert rep.outbox_count() == 1
    state["fail"] = False
    flushed = rep.flush()
    assert flushed["uploaded"] == 1 and rep.outbox_count() == 0


def test_summary_groups_recurring_crashes(tmp_path):
    rep = CrashReporter(tmp_path / "crash")
    for i in range(3):
        rep.report("ValueError", "boom", _tb("show_engine", 10 + i))   # same fingerprint
    rep.report("TypeError", "nope", _tb("weather_engine", 3))
    s = rep.summary()
    assert s["unique_crashes"] == 2
    assert s["total_reports"] == 4
    assert s["groups"][0]["count"] == 3       # the recurring one sorts first


def test_report_exception_method(tmp_path):
    rep = CrashReporter(tmp_path / "crash")
    try:
        raise RuntimeError("kaboom")
    except RuntimeError as e:
        out = rep.report_exception(e, context={"op": "playback"})
    assert out["uploaded"] is True
    assert rep.get_report(out["id"])["exc_type"] == "RuntimeError"


# ── 3. support reports ────────────────────────────────────────────────────────

def test_support_report_is_readable(tmp_path):
    rep = CrashReporter(tmp_path / "crash", log_buffer=LogRingBuffer())
    rep.log_buffer.add("did a thing")
    r = rep.report("ValueError", "boom", _tb("show_engine", 10))
    sup = generate_support_report(rep.get_report(r["id"]))
    assert "CRASH SUPPORT REPORT" in sup["text"]
    assert sup["fingerprint"] == r["fingerprint"]
    assert "app_version" in sup["system"]
    assert "show_engine" in sup["text"]       # traceback included
    assert "did a thing" in sup["text"]       # logs included


def test_build_crash_report_shape():
    rep = build_crash_report("ValueError", "x", _tb("a", 1), context={"k": "v"}, recent_logs=["l"])
    assert set(rep) >= {"id", "fingerprint", "timestamp", "exc_type", "message",
                        "traceback", "context", "recent_logs", "system"}
