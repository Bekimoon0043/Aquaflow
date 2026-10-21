// ✦ AI design review (Engineering Tools) — Claude reads the fountain design as text and explains
// weak spots and upgrades in plain words. Advice only: it never changes the design. A finding's
// parts can be selected in the Engineering Designer (navigation only).
import { useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import useProjectStore from "../../store/projectStore";
import { aiErrorMessage, designReviewInput, findingFixtureIds, requestDesignReview } from "../../engineering/aiDesignReview";
import { openDiagnosticFix } from "../../preflight/preflight";

const SEVERITY = {
  high: { label: "Important", color: "#ff6b6b" },
  medium: { label: "Worth fixing", color: "#ffcc00" },
  low: { label: "Nice to have", color: "#7ab" },
};
const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };

/** Select one part in the Engineering Designer (the designer selects one item at a time). */
export function selectInDesign(id, env = {}) {
  return openDiagnosticFix({ fix: { kind: "open_engineering_item", target: String(id) }, timeMs: null }, env);
}

export default function AiDesignReview({ post, onSelect = selectInDesign }) {
  const fixtures = useEngineeringStore((s) => s.fixtures) || [];
  const basins = useEngineeringStore((s) => s.basins);
  const programmer = useProjectStore((s) => s.programmer);
  const [state, setState] = useState({});
  const run = async () => {
    setState({ loading: true });
    try {
      const input = designReviewInput({ fixtures, basins, programmer });
      if (!input.design.nozzles.length) throw new Error("Add nozzles to the design first — there is nothing to review yet");
      const review = await requestDesignReview(input, post ? { post } : undefined);
      setState({ review, design: input.design });
    } catch (e) { setState({ error: aiErrorMessage(e, "The AI design review") }); }
  };
  const { review, design } = state;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }} data-testid="ai-design-review">
      <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
        Claude reads a text summary of this design ({fixtures.length} fixtures: areas, valves, pumps, lights, groups, basin and flow budget —
        no drawings or files) and explains weak spots and upgrades. Advice only: nothing in the design is changed.
      </div>
      <div>
        <button type="button" onClick={run} disabled={state.loading}
          title="Optional: Claude reviews the fountain design in plain words. Uses your Anthropic key (Your fountain → AI director)."
          style={{ background: "var(--accent)", color: "#04140a", border: "none", borderRadius: 6, padding: "6px 14px",
            fontSize: 11, fontWeight: 700, cursor: state.loading ? "wait" : "pointer" }}>
          {state.loading ? "Reviewing…" : "✦ AI design review"}
        </button>
      </div>
      {state.error && <div role="alert" style={{ color: "#ef4444", fontSize: 11, padding: 8, ...box }}>⛔ {state.error}</div>}
      {review && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {review.summary && <div style={{ ...box, padding: 8, fontSize: 11, color: "var(--text-primary)" }}>{review.summary}</div>}
        {!review.findings?.length && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No weak spots found.</div>}
        {(review.findings || []).map((f, i) => {
          const sev = SEVERITY[f.severity] || SEVERITY.low;
          const ids = findingFixtureIds(f, design);
          const areaNames = (f.areas || []).map((id) => design?.areas.find((a) => a.id === id)?.name || id);
          return (
            <div key={i} data-testid="ai-finding" data-severity={f.severity} style={{ ...box, padding: 8, borderColor: `${sev.color}55`, fontSize: 11, color: "var(--text-primary)" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                <span style={{ color: sev.color, fontSize: 9, fontWeight: 700, textTransform: "uppercase" }}>{sev.label}</span>
                <strong>{f.title}</strong>
              </div>
              {areaNames.length > 0 && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{areaNames.join(" · ")}</div>}
              {f.detail && <div style={{ marginTop: 4 }}>{f.detail}</div>}
              {f.recommendation && <div style={{ marginTop: 4 }}><b>Recommendation:</b> {f.recommendation}</div>}
              {f.estimatedImpact && <div style={{ marginTop: 2, color: "var(--text-muted)" }}><b>Impact:</b> {f.estimatedImpact}</div>}
              {ids.length > 0 && <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Select in design:</span>
                {ids.slice(0, 12).map((id) => (
                  <button key={id} type="button" onClick={() => onSelect(id)} title="Select this part in the Engineering Designer"
                    style={{ ...box, padding: "1px 6px", fontSize: 9, color: "var(--text-accent)", cursor: "pointer" }}>{id}</button>
                ))}
                {ids.length > 12 && <span style={{ fontSize: 9, color: "var(--text-muted)" }}>+{ids.length - 12} more</span>}
              </div>}
            </div>
          );
        })}
        <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Advice from {review.model || "Claude"} — check it against the datasheets before changing equipment.</div>
      </div>}
    </div>
  );
}
