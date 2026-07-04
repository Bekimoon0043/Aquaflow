// TrainingAcademyPanel.jsx — AquaFlow Training Academy (AQ-S4-005)
//
// Interactive in-app training: browse courses, work through lessons, answer the quiz
// (graded server-side with feedback), track progress, and earn a verifiable
// certificate on completion. Consumes the /api/academy endpoints.
import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "../../utils/apiClient";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };

// Stable anonymous learner id for this browser.
function learnerId() {
  try {
    let id = localStorage.getItem("aquaflow.learnerId");
    if (!id) { id = "learner-" + Math.random().toString(36).slice(2); localStorage.setItem("aquaflow.learnerId", id); }
    return id;
  } catch { return "learner-anon"; }
}

function ProgressBar({ percent }) {
  return (
    <div style={{ height: 6, background: "var(--bg-panel)", borderRadius: 3, overflow: "hidden" }}>
      <div style={{ width: `${percent}%`, height: "100%", background: percent >= 100 ? "#22c55e" : "var(--accent)" }} />
    </div>
  );
}

export default function TrainingAcademyPanel() {
  const learner = learnerId();
  const [courses, setCourses] = useState([]);
  const [progress, setProgress] = useState(null);
  const [course, setCourse] = useState(null);
  const [lesson, setLesson] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [cert, setCert] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const c = await apiGet("/academy/courses"); setCourses(c.courses || []);
      setProgress(await apiGet(`/academy/progress/${learner}`));
    } catch (e) { setError(String(e.message || e)); }
  }, [learner]);

  useEffect(() => { refresh(); }, [refresh]);

  const openCourse = async (cid) => {
    setError(""); setLesson(null); setResult(null); setCert(null);
    try { setCourse(await apiGet(`/academy/courses/${cid}`)); } catch (e) { setError(String(e.message || e)); }
  };
  const openLesson = async (lid) => {
    setResult(null); setAnswers({});
    try { setLesson(await apiGet(`/academy/courses/${course.id}/lessons/${lid}`)); }
    catch (e) { setError(String(e.message || e)); }
  };
  const submit = async () => {
    try {
      const res = await apiPost("/academy/submit", {
        learner_id: learner, course_id: course.id, lesson_id: lesson.id,
        answers: lesson.quiz.map((_, i) => (answers[i] ?? -1)),
      });
      setResult(res); refresh();
    } catch (e) { setError(String(e.message || e)); }
  };
  const claimCert = async () => {
    try {
      const c = await apiPost("/academy/certificate", { learner_id: learner, course_id: course.id });
      setCert(c); refresh();
    } catch (e) { setError(String(e.message || e)); }
  };

  const cp = progress?.courses?.find((c) => c.course_id === course?.id);

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>🎓</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Training Academy
        </span>
        {progress && <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)" }}>
          Overall {progress.overall_percent}% · {progress.certificates?.length || 0} certificate(s)
        </span>}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* course list */}
        <div style={{ width: 210, borderRight: "1px solid var(--border)", overflow: "auto", flexShrink: 0, padding: 8 }}>
          {courses.map((c) => {
            const pc = progress?.courses?.find((x) => x.course_id === c.id);
            return (
              <div key={c.id} onClick={() => openCourse(c.id)}
                style={{ ...box, padding: 8, marginBottom: 6, cursor: "pointer",
                  borderColor: course?.id === c.id ? "var(--accent)" : "var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>{c.title}</div>
                <div style={{ fontSize: 9, color: "var(--text-muted)", margin: "2px 0 4px" }}>
                  {c.lesson_count} lessons · pass {c.pass_threshold}%</div>
                <ProgressBar percent={pc?.percent || 0} />
              </div>
            );
          })}
        </div>

        {/* lesson / course view */}
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {error && <div style={{ ...box, padding: 8, color: "#ef4444", fontSize: 11, marginBottom: 8 }}>⛔ {error}</div>}
          {!course && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Select a course to begin.</div>}

          {course && !lesson && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{course.title}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "4px 0 10px" }}>{course.description}</div>
              {course.lessons.map((l) => {
                const done = cp?.lesson_scores?.[l.id] > 0;
                return (
                  <div key={l.id} onClick={() => openLesson(l.id)}
                    style={{ ...box, padding: "8px 10px", marginBottom: 5, cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: done ? "#22c55e" : "var(--text-muted)" }}>{done ? "✓" : "○"}</span>
                    <span style={{ flex: 1, fontSize: 11 }}>{l.title}</span>
                    {done && <span style={{ fontSize: 10, color: "#22c55e" }}>{cp.lesson_scores[l.id]}%</span>}
                  </div>
                );
              })}
              {cp?.eligible_for_certificate && !cert && (
                <button onClick={claimCert} style={{ marginTop: 8, background: "#22c55e", color: "#04140a",
                  border: "none", borderRadius: 6, padding: "8px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
                  🎓 Claim certificate ({cp.average_score}%)
                </button>
              )}
              {cert?.certificate && (
                <div style={{ ...box, padding: 10, marginTop: 8, borderColor: "#22c55e" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#22c55e" }}>Certificate awarded 🎓</div>
                  <div style={{ fontSize: 10, color: "var(--text-secondary)" }}>
                    {cert.certificate.certificate_id} · score {cert.certificate.score}%<br />
                    Verify code: <b>{cert.certificate.verification_code}</b></div>
                </div>
              )}
            </div>
          )}

          {lesson && (
            <div>
              <button onClick={() => setLesson(null)} style={{ background: "transparent", border: "none",
                color: "var(--text-muted)", fontSize: 10, cursor: "pointer", marginBottom: 6 }}>← back to {course.title}</button>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{lesson.title}</div>
              <p style={{ fontSize: 11.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{lesson.content}</p>
              {lesson.quiz.map((q, i) => (
                <div key={i} style={{ ...box, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>{i + 1}. {q.q}</div>
                  {q.options.map((opt, oi) => (
                    <label key={oi} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11,
                      padding: "3px 0", cursor: "pointer",
                      color: result ? (oi === result.feedback[i].correct_answer ? "#22c55e"
                        : (answers[i] === oi ? "#ef4444" : "var(--text-secondary)")) : "var(--text-secondary)" }}>
                      <input type="radio" name={`q${i}`} checked={answers[i] === oi} disabled={!!result}
                        onChange={() => setAnswers({ ...answers, [i]: oi })} />
                      {opt}
                    </label>
                  ))}
                  {result && result.feedback[i].explanation && (
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>ℹ {result.feedback[i].explanation}</div>
                  )}
                </div>
              ))}
              {!result ? (
                <button onClick={submit} disabled={Object.keys(answers).length < lesson.quiz.length}
                  style={{ background: "var(--accent)", color: "#04140a", border: "none", borderRadius: 6,
                    padding: "8px 16px", fontSize: 11, fontWeight: 700,
                    cursor: Object.keys(answers).length < lesson.quiz.length ? "not-allowed" : "pointer",
                    opacity: Object.keys(answers).length < lesson.quiz.length ? 0.5 : 1 }}>Submit answers</button>
              ) : (
                <div style={{ fontSize: 12, fontWeight: 700, color: result.passed ? "#22c55e" : "#ef4444" }}>
                  {result.passed ? "✓ Passed" : "Try again"} — {result.correct}/{result.total} correct ({result.score}%)
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
