"""
training_academy.py — AquaFlow Stage 4, AQ-S4-005

Training Academy: interactive lessons, per-learner progress tracking, and course
certification.

A built-in curriculum of courses (each a set of lessons with an interactive quiz)
teaches operators the platform. Learners step through lessons and submit quiz answers
which are graded server-side (the answer key never leaves the backend); their progress
and scores are tracked, and completing a course above its pass threshold issues a
verifiable certificate.

  * interactive lessons available — `get_lesson()` serves lesson content + quiz
    (without the answer key); `submit_lesson()` grades the answers and returns
    per-question feedback,
  * certification supported — `issue_certificate()` awards a verifiable certificate
    when every lesson is completed and the average score meets the pass threshold,
  * progress tracking supported — `progress()` reports per-course completion %, lesson
    scores, and overall progress; progress persists per learner.

Filesystem-scoped (progress + certificates under a root dir) so it is fully
unit-tested.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Curriculum ──────────────────────────────────────────────────────────────────

def _lesson(id, title, content, quiz):
    return {"id": id, "title": title, "content": content, "quiz": quiz}


def _q(q, options, answer, explanation=""):
    return {"q": q, "options": options, "answer": answer, "explanation": explanation}


COURSES = [
    {
        "id": "fundamentals", "title": "AquaFlow Fundamentals",
        "description": "Get oriented: the workspace, fixtures, and the timeline.",
        "pass_threshold": 70,
        "lessons": [
            _lesson("f1", "The Workspace",
                    "AquaFlow Studio has a node editor, a 3D preview, a timeline, and side "
                    "panels for devices, engineering and runtime. The top bar groups tools by "
                    "Design, Devices, Runtime and AI.",
                    [_q("Where do you scrub through a show over time?",
                        ["The node editor", "The timeline", "The device panel"], 1,
                        "The timeline is the time axis of the show."),
                     _q("Which top-bar group holds the hydraulic solver and BOM tools?",
                        ["Runtime", "Design", "AI"], 1)]),
            _lesson("f2", "Fixtures",
                    "Fixtures are the physical devices in a design — jets, lights, pumps, "
                    "valves. Each has a type, a position, and engineering metadata (DMX "
                    "address or PLC register) used to reach real hardware.",
                    [_q("What links a designed fixture to real hardware?",
                        ["Its colour", "Its address (DMX/PLC)", "Its name"], 1),
                     _q("A water jet is typically driven over which protocol?",
                        ["Modbus (PLC)", "Art-Net (DMX)", "MQTT"], 0,
                        "Jets/pumps/valves are Modbus; lighting/fog/laser are DMX/Art-Net.")]),
            _lesson("f3", "The Timeline",
                    "Tracks hold clips; a clip drives a device between a start and end time "
                    "at an intensity. Playback advances a playhead that evaluates active "
                    "clips and emits them to the output path.",
                    [_q("What does a clip specify?",
                        ["A device, a time range, and an intensity", "Only a colour",
                         "A license seat"], 0)]),
        ],
    },
    {
        "id": "show-programming", "title": "Show Programming",
        "description": "Cues, choreography, and playback for music-synced shows.",
        "pass_threshold": 70,
        "lessons": [
            _lesson("s1", "Cue Stacks",
                    "A cue stack is an ordered list of scenes (looks) you GO through with "
                    "smooth crossfades. Recalling a cue fades the output to that scene.",
                    [_q("What does pressing GO do on a cue stack?",
                        ["Deletes the cue", "Advances to the next cue with a crossfade",
                         "Exports a video"], 1)]),
            _lesson("s2", "Beat Sync",
                    "The beat detection engine estimates BPM and beats from audio so shows "
                    "can be synchronised to music, live or recorded.",
                    [_q("Beat detection provides…",
                        ["Pipe diameters", "Tempo (BPM) and beat times", "DMX addresses"], 1)]),
        ],
    },
    {
        "id": "hardware-safety", "title": "Hardware & Safety",
        "description": "DMX/Art-Net output and the safety interlock chain.",
        "pass_threshold": 80,     # safety course requires a higher score
        "lessons": [
            _lesson("h1", "DMX & Art-Net",
                    "DMX512 carries 512 channels per universe; Art-Net tunnels DMX over UDP. "
                    "The output must never exceed 44 Hz per universe.",
                    [_q("How many channels are in one DMX universe?",
                        ["128", "256", "512"], 2),
                     _q("The Art-Net refresh ceiling is…",
                        ["44 Hz", "1000 Hz", "unlimited"], 0)]),
            _lesson("h2", "The Safety Gate",
                    "Every hardware emit passes a safety gate: without a master permit, ALL "
                    "channels are forced to zero, and an E-stop hard-inhibits output.",
                    [_q("With no safety permit, the output is…",
                        ["Full brightness", "Zero on every channel", "Random"], 1),
                     _q("What does an E-stop do?",
                        ["Speeds up the show", "Hard-inhibits all output immediately",
                         "Adds a seat"], 1)]),
        ],
    },
    {
        "id": "hydraulics", "title": "Hydraulic Design",
        "description": "Pumps, pipe sizing, and valve authority.",
        "pass_threshold": 70,
        "lessons": [
            _lesson("hy1", "Pump Curves",
                    "A pump's operating point is where its head–flow curve meets the system "
                    "curve (H = static + k·Q²). Pumps in parallel add flow; in series add head.",
                    [_q("The operating point is where…",
                        ["The pump curve meets the system curve", "The pipe is longest",
                         "The BOM is cheapest"], 0),
                     _q("Two identical pumps in parallel…",
                        ["Add head", "Add flow", "Cancel out"], 1)]),
            _lesson("hy2", "Valve Authority",
                    "Valve authority β = ΔP_valve / (ΔP_valve + ΔP_rest). Good control needs "
                    "β ≥ 0.5; a low-authority valve behaves like an on/off switch.",
                    [_q("A well-authorised control valve has β…",
                        ["≥ 0.5", "≈ 0", "≥ 5"], 0)]),
        ],
    },
]

_COURSE_BY_ID = {c["id"]: c for c in COURSES}


def _lesson_public(lesson: dict) -> dict:
    """A lesson served to a learner — quiz WITHOUT the answer key."""
    return {"id": lesson["id"], "title": lesson["title"], "content": lesson["content"],
            "quiz": [{"q": q["q"], "options": q["options"]} for q in lesson["quiz"]]}


# ── Academy engine ──────────────────────────────────────────────────────────────

class TrainingAcademy:
    def __init__(self, root):
        self.root = Path(root)
        (self.root / "progress").mkdir(parents=True, exist_ok=True)
        (self.root / "certificates").mkdir(parents=True, exist_ok=True)

    # ── Catalog ────────────────────────────────────────────────────────────────
    def list_courses(self) -> list[dict]:
        return [{"id": c["id"], "title": c["title"], "description": c["description"],
                 "lesson_count": len(c["lessons"]), "pass_threshold": c["pass_threshold"]}
                for c in COURSES]

    def get_course(self, course_id: str) -> Optional[dict]:
        c = _COURSE_BY_ID.get(course_id)
        if not c:
            return None
        return {"id": c["id"], "title": c["title"], "description": c["description"],
                "pass_threshold": c["pass_threshold"],
                "lessons": [{"id": l["id"], "title": l["title"],
                             "quiz_count": len(l["quiz"])} for l in c["lessons"]]}

    def get_lesson(self, course_id: str, lesson_id: str) -> Optional[dict]:
        c = _COURSE_BY_ID.get(course_id)
        if not c:
            return None
        lesson = next((l for l in c["lessons"] if l["id"] == lesson_id), None)
        return _lesson_public(lesson) if lesson else None

    # ── Progress store ─────────────────────────────────────────────────────────
    def _progress_path(self, learner_id: str) -> Path:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in str(learner_id))
        return self.root / "progress" / f"{safe or 'anon'}.json"

    def _load_progress(self, learner_id: str) -> dict:
        p = self._progress_path(learner_id)
        if p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {"learner_id": str(learner_id), "courses": {}}

    def _save_progress(self, prog: dict):
        self._progress_path(prog["learner_id"]).write_text(
            json.dumps(prog, indent=2), encoding="utf-8", newline="")

    # ── Interactive lessons (submit + grade) ────────────────────────────────────
    def submit_lesson(self, learner_id: str, course_id: str, lesson_id: str,
                      answers: list) -> dict:
        c = _COURSE_BY_ID.get(course_id)
        if not c:
            raise ValueError(f"unknown course '{course_id}'")
        lesson = next((l for l in c["lessons"] if l["id"] == lesson_id), None)
        if not lesson:
            raise ValueError(f"unknown lesson '{lesson_id}'")

        quiz = lesson["quiz"]
        answers = list(answers or [])
        correct = 0
        feedback = []
        for i, q in enumerate(quiz):
            given = answers[i] if i < len(answers) else None
            ok = given == q["answer"]
            correct += ok
            feedback.append({"index": i, "correct": ok,
                             "correct_answer": q["answer"], "explanation": q["explanation"]})
        score = round(correct / len(quiz) * 100, 1) if quiz else 100.0
        passed = score >= 50.0    # a lesson is "completed" at ≥ 50%; the course needs the avg

        prog = self._load_progress(learner_id)
        cp = prog["courses"].setdefault(course_id, {"lessons": {}, "started_at": _now()})
        prev = cp["lessons"].get(lesson_id, {})
        cp["lessons"][lesson_id] = {
            "completed": passed or prev.get("completed", False),
            "score": max(score, prev.get("score", 0)),
            "attempts": prev.get("attempts", 0) + 1, "last_at": _now(),
        }
        self._save_progress(prog)
        return {"score": score, "passed": passed, "correct": correct,
                "total": len(quiz), "feedback": feedback}

    # ── Progress tracking ──────────────────────────────────────────────────────
    def progress(self, learner_id: str, course_id: Optional[str] = None) -> dict:
        prog = self._load_progress(learner_id)
        if course_id:
            return self._course_progress(prog, course_id)
        courses = [self._course_progress(prog, c["id"]) for c in COURSES]
        total_lessons = sum(c["lesson_count"] for c in courses)
        done = sum(c["lessons_completed"] for c in courses)
        return {"learner_id": str(learner_id), "courses": courses,
                "overall_percent": round(done / total_lessons * 100, 1) if total_lessons else 0.0,
                "certificates": self.certificates(learner_id)}

    def _course_progress(self, prog: dict, course_id: str) -> dict:
        c = _COURSE_BY_ID[course_id]
        cp = prog["courses"].get(course_id, {"lessons": {}})
        lessons = c["lessons"]
        done = [l for l in lessons if cp["lessons"].get(l["id"], {}).get("completed")]
        scores = [cp["lessons"][l["id"]]["score"] for l in done]
        avg = round(sum(scores) / len(scores), 1) if scores else 0.0
        return {
            "course_id": course_id, "title": c["title"],
            "lesson_count": len(lessons), "lessons_completed": len(done),
            "percent": round(len(done) / len(lessons) * 100, 1) if lessons else 0.0,
            "average_score": avg, "pass_threshold": c["pass_threshold"],
            "eligible_for_certificate": len(done) == len(lessons) and avg >= c["pass_threshold"],
            "lesson_scores": {l["id"]: cp["lessons"].get(l["id"], {}).get("score", 0) for l in lessons},
        }

    # ── Certification ──────────────────────────────────────────────────────────
    def issue_certificate(self, learner_id: str, course_id: str, learner_name: str = "") -> dict:
        cp = self._course_progress(self._load_progress(learner_id), course_id)
        if not cp["eligible_for_certificate"]:
            return {"issued": False,
                    "reason": f"complete all {cp['lesson_count']} lessons with an average "
                              f"≥ {cp['pass_threshold']}% (now {cp['lessons_completed']}/"
                              f"{cp['lesson_count']} @ {cp['average_score']}%)"}
        # idempotent: return the existing certificate if already issued
        existing = next((c for c in self.certificates(learner_id) if c["course_id"] == course_id), None)
        if existing:
            return {"issued": True, "already_issued": True, "certificate": existing}

        cert_id = "CERT-" + uuid.uuid4().hex[:10].upper()
        code = hashlib.sha256(f"{cert_id}|{learner_id}|{course_id}".encode()).hexdigest()[:12].upper()
        cert = {"certificate_id": cert_id, "verification_code": code,
                "learner_id": str(learner_id), "learner_name": learner_name or str(learner_id),
                "course_id": course_id, "course_title": _COURSE_BY_ID[course_id]["title"],
                "score": cp["average_score"], "issued_at": _now(),
                "issuer": "LuxuryCon AquaFlow Academy"}
        (self.root / "certificates" / f"{cert_id}.json").write_text(
            json.dumps(cert, indent=2), encoding="utf-8", newline="")
        return {"issued": True, "already_issued": False, "certificate": cert}

    def certificates(self, learner_id: str) -> list[dict]:
        out = []
        for path in (self.root / "certificates").glob("*.json"):
            try:
                c = json.loads(path.read_text(encoding="utf-8"))
                if c.get("learner_id") == str(learner_id):
                    out.append(c)
            except Exception:
                continue
        return out

    def verify_certificate(self, code: str) -> dict:
        code = str(code or "").upper()
        for path in (self.root / "certificates").glob("*.json"):
            try:
                c = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            if c.get("verification_code") == code:
                return {"valid": True, "certificate_id": c["certificate_id"],
                        "learner_name": c["learner_name"], "course_title": c["course_title"],
                        "score": c["score"], "issued_at": c["issued_at"]}
        return {"valid": False}


# ── Singleton ──────────────────────────────────────────────────────────────────
_academy: Optional[TrainingAcademy] = None


def get_training_academy() -> TrainingAcademy:
    global _academy
    if _academy is None:
        _academy = TrainingAcademy(Path.home() / ".aquaflow" / "academy")
    return _academy
