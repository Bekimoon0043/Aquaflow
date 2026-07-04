"""
academy_routes.py — AquaFlow Stage 4, AQ-S4-005

Training Academy API: browse courses, take interactive lessons, track progress, and
earn/verify certificates.

  GET  /api/academy/courses                    → course catalog
  GET  /api/academy/courses/{cid}              → a course's lessons
  GET  /api/academy/courses/{cid}/lessons/{lid} → a lesson (content + quiz, no answers)
  POST /api/academy/submit                     → grade a lesson quiz {learner_id, course_id, lesson_id, answers}
  GET  /api/academy/progress/{learner_id}      → progress across all courses
  POST /api/academy/certificate                → issue a certificate {learner_id, course_id, learner_name?}
  GET  /api/academy/verify/{code}              → verify a certificate by its code
"""
from fastapi import APIRouter, HTTPException

from services.training_academy import get_training_academy

router = APIRouter()


@router.get("/courses")
async def courses():
    return {"courses": get_training_academy().list_courses()}


@router.get("/courses/{course_id}")
async def course(course_id: str):
    c = get_training_academy().get_course(course_id)
    if not c:
        raise HTTPException(404, f"course '{course_id}' not found")
    return c


@router.get("/courses/{course_id}/lessons/{lesson_id}")
async def lesson(course_id: str, lesson_id: str):
    l = get_training_academy().get_lesson(course_id, lesson_id)
    if not l:
        raise HTTPException(404, "lesson not found")
    return l


@router.post("/submit")
async def submit(payload: dict):
    for k in ("learner_id", "course_id", "lesson_id"):
        if not payload.get(k):
            raise HTTPException(400, f"{k} required")
    try:
        return get_training_academy().submit_lesson(
            str(payload["learner_id"]), str(payload["course_id"]),
            str(payload["lesson_id"]), payload.get("answers") or [])
    except ValueError as e:
        raise HTTPException(404, str(e))


@router.get("/progress/{learner_id}")
async def progress(learner_id: str, course_id: str = None):
    return get_training_academy().progress(learner_id, course_id)


@router.post("/certificate")
async def certificate(payload: dict):
    if not payload.get("learner_id") or not payload.get("course_id"):
        raise HTTPException(400, "learner_id and course_id required")
    return get_training_academy().issue_certificate(
        str(payload["learner_id"]), str(payload["course_id"]),
        learner_name=payload.get("learner_name", ""))


@router.get("/verify/{code}")
async def verify(code: str):
    return get_training_academy().verify_certificate(code)
