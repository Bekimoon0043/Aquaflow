"""
validate_training_academy.py — AQ-S4-005 verification

Verifies the Training Academy:
  1. interactive lessons available (served without the answer key; answers graded with
     per-question feedback),
  2. progress tracking (per-course completion % + scores + overall),
  3. certification (awarded when a course is completed above its threshold; verifiable).

Run:  python backend/validate_training_academy.py   (from the aquaflow/ dir)
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
from services.training_academy import TrainingAcademy, COURSES, _COURSE_BY_ID

_passed = 0
_failed = 0


def check(name, cond, detail=""):
    global _passed, _failed
    ok = bool(cond)
    _passed += ok
    _failed += (not ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


ac = TrainingAcademy(Path(tempfile.mkdtemp()) / "academy")
LEARNER = "operator-1"

print("== 1. interactive lessons available ==")
courses = ac.list_courses()
check("multiple built-in courses", len(courses) >= 3, str(len(courses)))
check("each course has lessons", all(c["lesson_count"] >= 1 for c in courses))
lesson = ac.get_lesson("fundamentals", "f1")
check("lesson serves content + quiz", lesson and lesson["content"] and lesson["quiz"])
check("served quiz hides the answer key",
      all("answer" not in q for q in lesson["quiz"]), "answer key must not leak")
# Grade a correct submission.
key_f1 = [q["answer"] for q in _COURSE_BY_ID["fundamentals"]["lessons"][0]["quiz"]]
res = ac.submit_lesson(LEARNER, "fundamentals", "f1", key_f1)
check("correct answers score 100", res["score"] == 100.0 and res["passed"])
check("submission returns per-question feedback",
      len(res["feedback"]) == len(key_f1) and all(f["correct"] for f in res["feedback"]))
# A wrong submission is graded down with feedback.
wrong = [(k + 1) % 3 for k in key_f1]
res_w = ac.submit_lesson("learner-wrong", "fundamentals", "f1", wrong)
check("wrong answers score < 100", res_w["score"] < 100.0)
check("feedback reveals the correct answer after grading",
      res_w["feedback"][0]["correct_answer"] == key_f1[0])

print("== 2. progress tracking ==")
p = ac.progress(LEARNER, "fundamentals")
check("1 of 3 fundamentals lessons complete", p["lessons_completed"] == 1 and p["lesson_count"] == 3)
check("course percent ~33%", abs(p["percent"] - 33.3) < 0.5, str(p["percent"]))
overall = ac.progress(LEARNER)
check("overall progress reported", 0 < overall["overall_percent"] < 100, str(overall["overall_percent"]))
check("progress persists across instances",
      TrainingAcademy(ac.root).progress(LEARNER, "fundamentals")["lessons_completed"] == 1)

print("== 3. certification ==")
# Not yet eligible (only 1 lesson done).
early = ac.issue_certificate(LEARNER, "fundamentals")
check("no certificate before the course is complete", early["issued"] is False)
# Complete every fundamentals lesson correctly.
for l in _COURSE_BY_ID["fundamentals"]["lessons"]:
    ac.submit_lesson(LEARNER, "fundamentals", l["id"], [q["answer"] for q in l["quiz"]])
cp = ac.progress(LEARNER, "fundamentals")
check("course now 100% complete", cp["percent"] == 100.0 and cp["eligible_for_certificate"])
cert = ac.issue_certificate(LEARNER, "fundamentals", learner_name="Sam Operator")
check("certificate issued on completion", cert["issued"] and not cert.get("already_issued"))
c = cert["certificate"]
check("certificate has id + verification code + score",
      c["certificate_id"].startswith("CERT-") and c["verification_code"] and c["score"] >= 70)
# Idempotent.
again = ac.issue_certificate(LEARNER, "fundamentals")
check("re-issuing returns the same certificate", again["already_issued"]
      and again["certificate"]["certificate_id"] == c["certificate_id"])
# Verify.
v = ac.verify_certificate(c["verification_code"])
check("certificate verifies by code", v["valid"] and v["course_title"] == c["course_title"])
check("a bogus code does not verify", ac.verify_certificate("BADCODE12345")["valid"] is False)
check("certificate appears in the learner's list",
      any(x["certificate_id"] == c["certificate_id"] for x in ac.certificates(LEARNER)))

print("== 4. safety course needs a higher score ==")
check("hardware-safety threshold is stricter (80)",
      _COURSE_BY_ID["hardware-safety"]["pass_threshold"] == 80)

print(f"\n== RESULT: {_passed} passed, {_failed} failed ==")
sys.exit(1 if _failed else 0)
