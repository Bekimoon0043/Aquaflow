"""
Contract tests for the Training Academy (AQ-S4-005).

Asserts the three acceptance criteria:
  1. interactive lessons available (served without the answer key; graded + feedback),
  2. progress tracking supported (per-course % + scores + overall + persistence),
  3. certification supported (awarded on completion above threshold; verifiable).
"""
import pytest

from services.training_academy import TrainingAcademy, COURSES, _COURSE_BY_ID


@pytest.fixture
def academy(tmp_path):
    return TrainingAcademy(tmp_path / "academy")


def _answers(course_id, lesson_id):
    lesson = next(l for l in _COURSE_BY_ID[course_id]["lessons"] if l["id"] == lesson_id)
    return [q["answer"] for q in lesson["quiz"]]


def _complete_course(ac, learner, course_id):
    for l in _COURSE_BY_ID[course_id]["lessons"]:
        ac.submit_lesson(learner, course_id, l["id"], _answers(course_id, l["id"]))


# ── 1. interactive lessons ────────────────────────────────────────────────────

def test_catalog_has_courses_and_lessons(academy):
    courses = academy.list_courses()
    assert len(courses) >= 3
    assert all(c["lesson_count"] >= 1 for c in courses)


def test_served_lesson_hides_answer_key(academy):
    lesson = academy.get_lesson("fundamentals", "f1")
    assert lesson["content"] and lesson["quiz"]
    assert all("answer" not in q for q in lesson["quiz"])


def test_grade_correct_and_wrong(academy):
    res = academy.submit_lesson("u1", "fundamentals", "f1", _answers("fundamentals", "f1"))
    assert res["score"] == 100.0 and res["passed"] is True
    assert all(f["correct"] for f in res["feedback"])
    key = _answers("fundamentals", "f1")
    wrong = [(k + 1) % 3 for k in key]
    res_w = academy.submit_lesson("u2", "fundamentals", "f1", wrong)
    assert res_w["score"] < 100.0
    assert res_w["feedback"][0]["correct_answer"] == key[0]


def test_submit_unknown_course_or_lesson_errors(academy):
    with pytest.raises(ValueError):
        academy.submit_lesson("u1", "nope", "f1", [])
    with pytest.raises(ValueError):
        academy.submit_lesson("u1", "fundamentals", "nope", [])


# ── 2. progress tracking ──────────────────────────────────────────────────────

def test_progress_updates_and_persists(academy):
    academy.submit_lesson("u1", "fundamentals", "f1", _answers("fundamentals", "f1"))
    p = academy.progress("u1", "fundamentals")
    assert p["lessons_completed"] == 1 and p["lesson_count"] == 3
    assert abs(p["percent"] - 33.3) < 0.5
    overall = academy.progress("u1")
    assert 0 < overall["overall_percent"] < 100
    # persists in a fresh instance on the same dir
    assert TrainingAcademy(academy.root).progress("u1", "fundamentals")["lessons_completed"] == 1


def test_best_score_is_kept(academy):
    key = _answers("fundamentals", "f1")
    academy.submit_lesson("u1", "fundamentals", "f1", [(k + 1) % 3 for k in key])   # wrong first
    academy.submit_lesson("u1", "fundamentals", "f1", key)                          # then correct
    assert academy.progress("u1", "fundamentals")["lesson_scores"]["f1"] == 100.0


# ── 3. certification ──────────────────────────────────────────────────────────

def test_certificate_requires_completion(academy):
    academy.submit_lesson("u1", "fundamentals", "f1", _answers("fundamentals", "f1"))
    assert academy.issue_certificate("u1", "fundamentals")["issued"] is False


def test_certificate_issued_and_verifiable(academy):
    _complete_course(academy, "u1", "fundamentals")
    cp = academy.progress("u1", "fundamentals")
    assert cp["percent"] == 100.0 and cp["eligible_for_certificate"] is True
    cert = academy.issue_certificate("u1", "fundamentals", learner_name="Sam")
    assert cert["issued"] and not cert.get("already_issued")
    c = cert["certificate"]
    assert c["certificate_id"].startswith("CERT-") and c["verification_code"]
    assert c["score"] >= 70
    v = academy.verify_certificate(c["verification_code"])
    assert v["valid"] and v["learner_name"] == "Sam"
    assert academy.verify_certificate("BOGUS")["valid"] is False


def test_certificate_is_idempotent(academy):
    _complete_course(academy, "u1", "fundamentals")
    a = academy.issue_certificate("u1", "fundamentals")
    b = academy.issue_certificate("u1", "fundamentals")
    assert b["already_issued"] is True
    assert a["certificate"]["certificate_id"] == b["certificate"]["certificate_id"]


def test_safety_course_has_stricter_threshold():
    assert _COURSE_BY_ID["hardware-safety"]["pass_threshold"] == 80
