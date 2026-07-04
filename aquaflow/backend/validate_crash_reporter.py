"""
validate_crash_reporter.py — AQ-S4-002 verification

Verifies the crash reporting system:
  1. automatic logs are uploaded (report → spool → upload, with offline outbox + retry),
  2. crash fingerprints are generated (stable per bug, distinct across bugs),
  3. support reports are generated (readable, with system info + traceback + logs).

Run:  python backend/validate_crash_reporter.py   (from the aquaflow/ dir)
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # backend/ on path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from pathlib import Path
from services.crash_reporter import (
    CrashReporter, LogRingBuffer, crash_fingerprint, build_crash_report,
    generate_support_report,
)

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def make_tb(func, line):
    return (f'Traceback (most recent call last):\n'
            f'  File "/opt/app/services/{func}.py", line {line}, in {func}\n'
            f'    do_thing()\n'
            f'ValueError: something went wrong')


print("== 2. crash fingerprints generated ==")
fp1 = crash_fingerprint("ValueError", make_tb("show_engine", 120))
fp2 = crash_fingerprint("ValueError", make_tb("show_engine", 145))   # same func, diff line
fp3 = crash_fingerprint("ValueError", make_tb("protocol_bus", 77))   # different location
fp4 = crash_fingerprint("KeyError",  make_tb("show_engine", 120))    # different exc type
check("fingerprint is 12 hex chars", len(fp1) == 12 and all(c in "0123456789abcdef" for c in fp1), fp1)
check("same bug → same fingerprint (line number ignored)", fp1 == fp2, f"{fp1} == {fp2}")
check("different location → different fingerprint", fp1 != fp3)
check("different exception type → different fingerprint", fp1 != fp4)
# path normalisation: same frame from a Windows path hashes the same
win = ('Traceback (most recent call last):\n'
       '  File "C:\\\\opt\\\\app\\\\services\\\\show_engine.py", line 999, in show_engine\n'
       '    do_thing()\nValueError: x')
check("path style doesn't change the fingerprint", crash_fingerprint("ValueError", win) == fp1,
      crash_fingerprint("ValueError", win))

print("== 1. automatic logs uploaded ==")
root = Path(tempfile.mkdtemp()) / "crash"
logs = LogRingBuffer()
logs.add("engine started"); logs.add("playing show s1")
rep = CrashReporter(root, log_buffer=logs)
r = rep.report("ValueError", "bad value", make_tb("show_engine", 120), context={"screen": "timeline"})
check("report returns id + fingerprint + uploaded", r["id"] and r["fingerprint"] and r["uploaded"] is True)
check("uploaded to the sink", (root / "sink" / f"{r['id']}.json").exists())
check("outbox empty after a successful upload", rep.outbox_count() == 0)
check("recent logs auto-attached to the report",
      any("playing show s1" in l for l in rep.get_report(r["id"])["recent_logs"]))

# Offline: a failing transport keeps the report in the outbox; flush retries it.
fail = {"on": True}
def flaky(_r):
    if fail["on"]:
        raise RuntimeError("network down")
    return True
rep2 = CrashReporter(Path(tempfile.mkdtemp()) / "crash2", transport=flaky)
r2 = rep2.report("KeyError", "missing", make_tb("protocol_bus", 50))
check("failed upload stays in the outbox", r2["uploaded"] is False and rep2.outbox_count() == 1)
fail["on"] = False
flushed = rep2.flush()
check("flush() retries and uploads the outbox", flushed["uploaded"] == 1 and rep2.outbox_count() == 0)

print("== 1b. grouping (recurring crashes) ==")
for i in range(3):
    rep.report("ValueError", "bad value", make_tb("show_engine", 120 + i))  # same fingerprint
rep.report("TypeError", "nope", make_tb("weather_engine", 12))
summ = rep.summary()
check("summary groups by fingerprint", summ["unique_crashes"] == 2, str(summ["unique_crashes"]))
top = summ["groups"][0]
check("recurring crash counted (4 of the ValueError)", top["count"] == 4, str(top["count"]))

print("== 3. support reports generated ==")
report = rep.get_report(r["id"])
sup = generate_support_report(report)
check("support report has readable text", "CRASH SUPPORT REPORT" in sup["text"])
check("support report includes the fingerprint", sup["fingerprint"] == r["fingerprint"])
check("support report includes system info", "app_version" in sup["system"])
check("support report includes the traceback", "Traceback" in sup["text"] and "show_engine" in sup["text"])
check("support report includes recent logs", "playing show s1" in sup["text"])

print("== 4. build from a real exception ==")
try:
    {}["missing"]
except Exception as e:
    import traceback
    rep_ex = build_crash_report(type(e).__name__, str(e), "".join(traceback.format_exc()))
check("report built from a live KeyError", rep_ex["exc_type"] == "KeyError" and len(rep_ex["fingerprint"]) == 12)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
