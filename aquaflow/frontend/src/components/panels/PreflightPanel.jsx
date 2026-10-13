import React, { useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import useProjectStore from "../../store/projectStore";
import { useShowStore } from "../../store/showStore";
import {
  PREVIEW_ONLY_LABEL, buildPreflightProject, fixLabel, groupBySeverity, openDiagnosticFix, runPreflight,
  publishPreflightResult, // AF-NEXT-014: the workspace guidance reads the last result
} from "../../preflight/preflight";

// AF-NEXT-009 — Preflight panel. Runs the backend preflight gate (read-only) for the chosen
// controller and lists EVERY issue grouped by severity; each issue jumps to its fix location
// (timeline clip, Engineering item, or panel). It never sends, arms or starts anything.

const SEVERITY_STYLE = {
  error:   { title: "Errors — block hardware output", color: "#ff6b6b", icon: "⛔" },
  warning: { title: "Warnings", color: "#ffcc00", icon: "⚠" },
  info:    { title: "Info", color: "#7ab", icon: "ℹ" },
};

export const PREFLIGHT_TARGETS = [
  { kind: "preview", label: "Preview only (no controller)" },
  { kind: "siemens", label: "Siemens PLC site" },
  { kind: "dmx", label: "DMX / Art-Net" },
  { kind: "ican", label: "I-CAN relay gateway" },
  { kind: "runtime", label: "AquaFlow runtime (legacy timeline)" },
];

/** Legacy timeline: select the clip in showStore if a track holds it. */
export function selectLegacyClip(clipId, store = useShowStore) {
  const state = store.getState?.();
  const track = (state?.timelineTracks || []).find(t => (t.clips || []).some(c => c.id === clipId));
  if (track) state.selectClip(track.id, clipId);
  return Boolean(track);
}

export function issueAction(issue, env = {}) {
  return openDiagnosticFix(issue, { selectLegacyClip, ...env });
}

const fmtTime = ms => (ms === null || ms === undefined ? "" : `${(ms / 1000).toFixed(2)}s`);

export function PreflightIssueList({ issues, onFix = issueAction }) {
  const groups = groupBySeverity(issues);
  return <div data-testid="preflight-issues">
    {["error", "warning", "info"].map(severity => groups[severity].length > 0 && (
      <div key={severity} data-severity={severity} style={{ marginBottom: 8 }}>
        <div style={{ color: SEVERITY_STYLE[severity].color, fontSize: 10, fontWeight: "bold", marginBottom: 3 }}>
          {SEVERITY_STYLE[severity].icon} {SEVERITY_STYLE[severity].title} ({groups[severity].length})
        </div>
        {groups[severity].map((issue, i) => (
          <button key={`${issue.code}-${i}`} type="button" disabled={!issue.fix}
            onClick={() => onFix(issue)}
            title={issue.fix ? `${fixLabel(issue.fix)}: ${issue.fix.target}` : "No fix location"}
            data-fix-kind={issue.fix?.kind || ""}
            style={{ display: "block", width: "100%", textAlign: "left", padding: "4px 6px", marginBottom: 2,
              background: "#0a1520", color: "#cce8ff", border: `1px solid ${SEVERITY_STYLE[severity].color}33`,
              borderRadius: 3, cursor: issue.fix ? "pointer" : "default", fontFamily: "monospace", fontSize: 10 }}>
            <span style={{ color: SEVERITY_STYLE[severity].color }}>{issue.code}</span>
            {issue.timeMs !== null && issue.timeMs !== undefined && <span style={{ color: "#556677" }}> @ {fmtTime(issue.timeMs)}</span>}
            {issue.source && issue.source !== "preflight" && <span style={{ color: "#556677" }}> [{issue.source}]</span>}
            <div>{issue.message}</div>
            {issue.fix && <div style={{ color: "#00aaff", fontSize: 9 }}>→ {fixLabel(issue.fix)} ({issue.fix.target})</div>}
          </button>
        ))}
      </div>
    ))}
  </div>;
}

export default function PreflightPanel() {
  const fixtures = useEngineeringStore(s => s.fixtures);
  const hydraulicNetwork = useEngineeringStore(s => s.hydraulic_network || null);
  const basins = useEngineeringStore(s => s.basins);
  const geometry = useEngineeringStore(s => s.geometry);
  const poolType = useEngineeringStore(s => s.poolType);
  const params = useEngineeringStore(s => s.params);
  const programmer = useProjectStore(s => s.programmer);
  const siteId = useProjectStore(s => s.integrations?.siemensSiteId || "");
  const [kind, setKind] = useState("preview");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const run = async () => {
    setRunning(true); setError("");
    try {
      const project = buildPreflightProject({ fixtures, programmer, hydraulicNetwork, site: { basins, geometry, poolType, params } });
      const target = kind === "siemens" ? { kind, site_id: siteId } : { kind };
      const outcome = await runPreflight(project, target);
      setResult(outcome);
      publishPreflightResult(outcome, target);
    } catch (e) {
      setResult(null); setError(e?.message || String(e));
    }
    setRunning(false);
  };

  const preview = kind === "preview";
  return <div style={{ background: "#050d18", border: "1px solid #0a2030", borderRadius: 6, padding: 10, marginBottom: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
      <span style={{ color: "#ffcc00", fontSize: 12, fontWeight: "bold" }}>◈ PREFLIGHT</span>
      {preview && <span role="note" style={{ color: "#f6d795", fontSize: 9, border: "1px solid #b98539", borderRadius: 3, padding: "1px 5px" }}>{PREVIEW_ONLY_LABEL}</span>}
    </div>
    <div style={{ fontSize: 9, color: "#556677", marginBottom: 6 }}>
      Checks the resolved show for missing links, address conflicts, pump/valve dependencies, output limits,
      minimum on/off times, unsupported channels and unsafe transitions. Errors block hardware output; nothing is sent from here.
    </div>
    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
      <select aria-label="Preflight controller" value={kind} onChange={e => setKind(e.target.value)}
        style={{ flex: 1, padding: "4px 6px", background: "#0a1825", color: "#cce8ff", border: "1px solid #0a2535", borderRadius: 3, fontFamily: "monospace", fontSize: 10 }}>
        {PREFLIGHT_TARGETS.map(t => <option key={t.kind} value={t.kind} disabled={t.kind === "siemens" && !siteId}>
          {t.label}{t.kind === "siemens" && !siteId ? " — choose a site in Show Programming" : ""}</option>)}
      </select>
      <button type="button" onClick={run} disabled={running}
        style={{ padding: "4px 10px", background: "#1a1000", color: "#ffcc00", border: "1px solid #ffcc0044", borderRadius: 3, cursor: running ? "wait" : "pointer", fontFamily: "monospace", fontSize: 10 }}>
        {running ? "⟳ CHECKING..." : "RUN PREFLIGHT"}
      </button>
    </div>
    {error && <div role="alert" style={{ color: "#ff8866", fontSize: 10 }}>Preflight could not run: {error}. Hardware output stays blocked.</div>}
    {result && <>
      <div style={{ color: result.ok ? "#00ff88" : "#ff6b6b", fontSize: 10, fontWeight: "bold", marginBottom: 6 }}>
        {result.ok ? "✓ No blocking errors" : "✗ Hardware output refused"} · {result.summary.errors} error(s), {result.summary.warnings} warning(s)
        {result.resolved_revision && <span style={{ color: "#556677", fontWeight: "normal" }}> · {result.resolved_revision}</span>}
        {result.hardware === false && <span style={{ color: "#f6d795", fontWeight: "normal" }}> · {PREVIEW_ONLY_LABEL}</span>}
      </div>
      <PreflightIssueList issues={result.issues} />
    </>}
  </div>;
}
