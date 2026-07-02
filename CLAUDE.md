# Claude Code Standing Instructions

## End of Every Session

Before ending any session always do these steps:

1. Update CURRENT_STATUS.md with today's progress
2. Write session report to:
   `E:\Burook platform development\Luxurycon\LuxuryCon-AI-Hub\bridge\session-report.json`
3. Commit all changes to GitHub
4. Push to origin main

The `session-report.json` must always be written even if the session ends mid-task.
If a task is incomplete write status as **"In Progress"** not **"Done"**.

### session-report.json format

```json
{
  "date": "2026-07-02",
  "session_end": "18:30",
  "tasks_completed": [
    {
      "task_id": "AQ-S1-001",
      "title": "Backend fixture-aware architecture",
      "status": "Done",
      "files_modified": ["show_engine.py", "protocol_bus.py"],
      "acceptance_criteria_met": 3,
      "acceptance_criteria_total": 3,
      "notes": "All criteria met. Pushed to GitHub."
    }
  ],
  "tasks_in_progress": [],
  "tasks_started_today": ["AQ-S1-001"],
  "github_commits": ["abc123 - Stage 1 P1 complete"],
  "blockers": [],
  "next_recommended_task": "AQ-S1-002",
  "session_summary": "Short summary of what was accomplished this session."
}
```

The LuxuryCon AI Command Hub reads this file automatically on startup and updates the
Master Roadmap, Memory Hub session log, progress trackers, CEO Dashboard, and the Daily
Briefing. Task IDs must match the roadmap exactly (e.g. `AQ-S1-002`).
