// AF-NEXT-014 — "next step" guidance strip for the active workspace: the next unfinished
// step of a checklist built from real project state, the whole checklist, and every
// warning/diagnostic with the action that opens its responsible object or procedure.
// Navigation and read-only checks only: nothing here arms, starts or pulses hardware.
import { useEffect, useState } from "react";
import { getWorkspace, guidanceProgress, nextStep } from "../../workspaces/workspaceModel";
import "./workspace.css";

const STATUS = {
  done: ["✓", "Done"],
  todo: ["○", "To do"],
  warn: ["⚠", "Needs attention"],
  blocked: ["⛔", "Blocked"],
  manual: ["☐", "Operator action"],
  info: ["ℹ", "Tip"],
};

function StatusIcon({ status }) {
  const [icon, label] = STATUS[status] || STATUS.info;
  return <span className={`ws-status ws-status--${status}`} role="img" aria-label={label} title={label}>{icon}</span>;
}

function StepActions({ step, onGo, onRunPreflight, preflightBusy }) {
  return (
    <span className="ws-step-actions">
      {step.go && (
        <button type="button" className="btn ws-go" onClick={() => onGo(step)} aria-label={`${step.go.label} — ${step.title}`}>
          {step.go.label} →
        </button>
      )}
      {step.runPreflight && onRunPreflight && (
        <button type="button" className="btn ws-go" disabled={preflightBusy} onClick={onRunPreflight}>
          {preflightBusy ? "Checking…" : "Run preflight"}
        </button>
      )}
    </span>
  );
}

export default function GuidanceStrip({
  workspace, steps = [], diagnostics = [], onGo, onDiagnostic, onRunPreflight, preflightBusy = false, preflightError = "",
}) {
  const [open, setOpen] = useState(null); // "checklist" | "diagnostics" | null
  const ws = getWorkspace(workspace);
  const next = nextStep(steps);
  const progress = guidanceProgress(steps);
  const errors = diagnostics.filter(d => d.severity === "error").length;
  const toggle = (which) => setOpen(v => (v === which ? null : which));
  useEffect(() => { setOpen(null); }, [workspace]);
  // Acting on a step or warning navigates away: close the dropdown so the target is visible.
  const go = (step) => { setOpen(null); onGo?.(step); };

  return (
    <section className="ws-guidance" aria-label={`${ws.label} guidance`} data-workspace={ws.id}>
      <div className="ws-guidance-row">
        <span className="ws-guidance-label">{ws.label} · next step</span>
        {next ? (
          <div className="ws-guidance-next" data-testid="next-step" data-step={next.id}>
            <StatusIcon status={next.status} />
            <strong>{next.title}</strong>
            <span className="ws-guidance-detail">{next.detail}</span>
            <StepActions step={next} onGo={go} onRunPreflight={onRunPreflight} preflightBusy={preflightBusy} />
          </div>
        ) : (
          <div className="ws-guidance-next" data-testid="next-step"><StatusIcon status="done" /> <strong>All {ws.label} steps are done.</strong></div>
        )}
        <div className="ws-guidance-toggles">
          <button type="button" className={`ws-toggle${open === "checklist" ? " is-open" : ""}`} aria-expanded={open === "checklist"} onClick={() => toggle("checklist")}>
            Checklist {progress.done}/{progress.total}
          </button>
          <button type="button" className={`ws-toggle${open === "diagnostics" ? " is-open" : ""}${errors ? " has-errors" : diagnostics.length ? " has-warnings" : ""}`}
            aria-expanded={open === "diagnostics"} onClick={() => toggle("diagnostics")}>
            Warnings {diagnostics.length}
          </button>
        </div>
      </div>
      {preflightError && <div className="ws-guidance-error" role="alert">Preflight could not run: {preflightError}</div>}
      {open === "checklist" && (
        <ol className="ws-dropdown ws-checklist" aria-label={`${ws.label} checklist`}>
          {steps.map(step => (
            <li key={step.id} className="ws-check" data-step={step.id} data-status={step.status}>
              <StatusIcon status={step.status} />
              <div className="ws-check-body">
                <div className="ws-check-title">{step.title}</div>
                <div className="ws-check-detail">{step.detail}</div>
                {step.note && <div className="ws-check-note">{step.note}</div>}
              </div>
              <StepActions step={step} onGo={go} onRunPreflight={onRunPreflight} preflightBusy={preflightBusy} />
            </li>
          ))}
        </ol>
      )}
      {open === "diagnostics" && (
        <div className="ws-dropdown ws-diagnostics" role="list" aria-label={`${ws.label} warnings`}>
          {diagnostics.length === 0 && <div className="ws-empty">No warnings for this workspace. Run preflight to check the show.</div>}
          {diagnostics.map(d => (
            <button key={d.id} type="button" role="listitem" className={`ws-diag ws-diag--${d.severity}`} data-code={d.code} onClick={() => { setOpen(null); onDiagnostic?.(d); }}
              title="Open the responsible object or procedure">
              <span className="ws-diag-code">{d.code}</span>
              {d.timeMs !== null && d.timeMs !== undefined && <span className="ws-diag-time"> @ {(d.timeMs / 1000).toFixed(2)}s</span>}
              <span className="ws-diag-source"> [{d.source}]</span>
              <span className="ws-diag-msg">{d.message}</span>
              <span className="ws-diag-open">Open →</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
