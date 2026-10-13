// FixtureTrustPanel.jsx — AF-NEXT-012 (Fixture data trust)
//
// Shown in the Engineering Designer's selected-fixture inspector:
//   * the equipment data source / confidence badge and citation (model, units,
//     revision, document) — generic items read "Generic estimate — verify with
//     supplier datasheet";
//   * the solved hydraulic result for this nozzle with the citation it rests on;
//   * "Replace type": preview the control-footprint diff, then apply. Applying
//     recomputes dependent calculations (BOM / totals recompute from the fixtures;
//     the hydraulic solve is re-run when one existed) and flags changed control
//     footprints. Addresses are never silently reassigned.
import { useEffect, useMemo, useState } from "react";
import ProvenanceBadge, { CitationLine } from "./ProvenanceBadge";
import { FIXTURE_LIBRARY, getFixtureProvenance } from "../../data/fixtureLibrary";
import { citeProvenance, unitsText } from "../../data/fixtureProvenance";
import { replaceFixtureType, acknowledgeControlReview } from "../../engineering/fixtureTypeReplacement";
import { buildHydraulicPreviewPayload, normalizeHydraulicResult } from "../../engineering/hydraulicAdapter";
import { fixtureMatchesTool } from "./FixtureLibraryBrowser";
import { apiPost } from "../../utils/apiClient";
import useProjectStore from "../../store/projectStore";
import { siemensRequest } from "../../utils/siemensSite";

const box = { margin: "8px 0", padding: 7, background: "#050d14", border: "1px solid #0a3040", borderRadius: 4 };
const small = { fontSize: 8, color: "#7a96aa", lineHeight: 1.5 };
const STATUS_COLOR = { conflict: "#ff8a8a", unassigned: "#ffb86b", review: "#ffcc00", recompute: "#8de0ff", kept: "#9cc" };

function toolOf(type) {
  for (const tool of ["nozzle", "light", "equipment"]) if (fixtureMatchesTool({ key: type }, tool)) return tool;
  return "equipment";
}

export function ReplacementReport({ report, onAcknowledge }) {
  if (!report) return null;
  const flagged = report.footprintChanged || report.affectedItems?.some((a) => a.status === "conflict" || a.status === "unassigned");
  return (
    <div role={flagged ? "alert" : "status"} data-testid="replacement-report"
      style={{ marginTop: 6, padding: 6, borderRadius: 3, border: `1px solid ${flagged ? "#7a5a00" : "#0a3040"}`, background: flagged ? "#1c1404" : "#06121c" }}>
      <div style={{ color: flagged ? "#ffcc00" : "#8de0ff", fontSize: 9, fontWeight: "bold", marginBottom: 3 }}>
        {flagged ? "⚠ CONTROL FOOTPRINT CHANGED — REVIEW" : "Control footprint unchanged"}
      </div>
      <div style={small}>{report.fromType} → {report.toType}</div>
      {report.changes?.map((c) => (
        <div key={c.field} style={{ ...small, color: "#ffcc00" }}>• {c.label}: {String(c.from || "—")} → {String(c.to || "—")}</div>
      ))}
      {report.affectedItems?.length > 0 && <div style={{ ...small, marginTop: 3, color: "#a9c4d6" }}>Affected items:</div>}
      {report.affectedItems?.map((a, i) => (
        <div key={`${a.kind}-${i}`} style={{ ...small, color: STATUS_COLOR[a.status] || "#9cc" }}>• [{a.kind}] {a.message}</div>
      ))}
      {report.valueChanges?.length > 0 && (
        <div style={{ ...small, marginTop: 3 }}>Recomputed from new type: {report.valueChanges.map((v) => `${v.field} ${v.from ?? "—"}→${v.to ?? "—"}`).join(", ")}</div>
      )}
      {report.recompute?.length > 0 && <div style={small}>Dependent calculations: {report.recompute.join(", ")}</div>}
      {report.warnings?.map((w, i) => <div key={i} style={{ ...small, color: "#ffb86b" }}>• {w}</div>)}
      <div style={{ ...small, marginTop: 3 }}>Addresses are kept as-is and never auto-reassigned.</div>
      {onAcknowledge && (
        <button type="button" onClick={onAcknowledge}
          style={{ marginTop: 4, width: "100%", padding: 4, background: "#2a2006", color: "#ffcc00", border: "1px solid #7a5a00", borderRadius: 3, cursor: "pointer", fontSize: 8 }}>
          MARK CONTROL MAPPING REVIEWED
        </button>
      )}
    </div>
  );
}

export default function FixtureTrustPanel({
  fixture, fixtures = [], solvedHydraulics = null, hydraulicParams = {}, volumeLitres = 0,
  onApply, onHydraulics,
}) {
  const [newType, setNewType] = useState("");
  const [preview, setPreview] = useState(null);
  const [lastReport, setLastReport] = useState(null);
  const [status, setStatus] = useState("");
  const [ioPoints, setIoPoints] = useState([]);
  const siteId = useProjectStore((s) => s.integrations?.siemensSiteId);

  useEffect(() => { setNewType(""); setPreview(null); setLastReport(null); setStatus(""); }, [fixture?.id]);
  useEffect(() => {
    let alive = true;
    if (!siteId) { setIoPoints([]); return undefined; }
    siemensRequest(`/${siteId}/io-map`).then((r) => alive && setIoPoints(r.points || [])).catch(() => alive && setIoPoints([]));
    return () => { alive = false; };
  }, [siteId]);

  const provenance = useMemo(() => getFixtureProvenance(fixture), [fixture]);
  const citation = useMemo(() => citeProvenance(provenance, { equipmentModel: fixture?.type }), [provenance, fixture?.type]);
  const options = useMemo(() => {
    const tool = toolOf(fixture?.type || "");
    return FIXTURE_LIBRARY.filter((f) => fixtureMatchesTool(f, tool) && f.key !== fixture?.type);
  }, [fixture?.type]);
  if (!fixture) return null;

  const physics = solvedHydraulics?.nozzlePhysics?.[fixture.id] || solvedHydraulics?.nozzlePhysics?.[String(fixture.id)];

  const doPreview = () => {
    if (!newType) return;
    try { setPreview(replaceFixtureType(fixtures, fixture.id, newType, { ioPoints }).report); setStatus(""); }
    catch (e) { setStatus(String(e.message || e)); }
  };

  const apply = async () => {
    let result;
    try { result = replaceFixtureType(fixtures, fixture.id, newType, { ioPoints }); }
    catch (e) { setStatus(String(e.message || e)); return; }
    onApply?.(result.fixtures, result.report);
    setLastReport(result.report);
    setPreview(null);
    setNewType("");
    // Dependent calc: a hydraulic solve that existed is stale now — re-run it on the
    // new fixture set instead of leaving old numbers on screen.
    if (solvedHydraulics && result.report.recompute.includes("solvedHydraulics") && onHydraulics) {
      onHydraulics(null);
      setStatus("Re-running hydraulic solver for the new type…");
      try {
        const payload = buildHydraulicPreviewPayload({ fixtures: result.fixtures, params: hydraulicParams, volumeLitres });
        if (!payload.nozzles.length) { setStatus("No hydraulic nozzles left — solver result cleared."); return; }
        onHydraulics(normalizeHydraulicResult(await apiPost("/hydraulics/preview-physics", payload)));
        setStatus("Hydraulics recomputed for the new type.");
      } catch (e) {
        setStatus(`Hydraulic results cleared (re-run failed: ${e.message || e}). Run the solver again.`);
      }
    }
  };

  const acknowledge = () => {
    onApply?.(fixtures.map((f) => (String(f.id) === String(fixture.id) ? acknowledgeControlReview(f) : f)), null);
    setLastReport(null);
  };

  const pendingReview = fixture.controlReview?.required ? fixture.controlReview : null;

  return (
    <div style={box} data-testid="fixture-trust-panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span style={{ color: "#8de0ff", fontSize: 9, fontWeight: "bold" }}>EQUIPMENT DATA</span>
        <ProvenanceBadge provenance={provenance} />
      </div>
      <div style={small}>
        Model: {citation.manufacturer ? `${citation.manufacturer} ` : ""}{provenance.model || fixture.type} · rev {citation.revision}
        {citation.document ? ` · ${citation.document}` : ""}
      </div>
      <div style={small}>Units: {unitsText(citation.units) || "—"}</div>
      {provenance.downgradeReason && (
        <div style={{ ...small, color: "#ffb86b" }}>Claimed {provenance.downgradedFrom} but incomplete ({provenance.downgradeReason}) — treated as generic.</div>
      )}

      {physics && (
        <div style={{ marginTop: 5 }}>
          <div style={{ ...small, color: "#a9c4d6" }}>
            Solved: {physics.flowLpm != null ? `${Number(physics.flowLpm).toFixed(1)} L/min` : "—"}
            {physics.jetHeightM != null ? ` · jet ${Number(physics.jetHeightM).toFixed(2)} m (${physics.basis || "ESTIMATED"})` : ""}
          </div>
          <CitationLine citation={physics.equipment ? {
            equipmentModel: physics.equipment.equipment_model, dataSource: physics.equipment.data_source,
            confidence: physics.equipment.confidence, revision: physics.equipment.revision, units: physics.equipment.units,
          } : citation} />
        </div>
      )}

      {pendingReview && !lastReport && (
        <ReplacementReport report={{ ...pendingReview, footprintChanged: true }} onAcknowledge={acknowledge} />
      )}

      <div style={{ marginTop: 6, ...small, color: "#a9c4d6" }}>Replace fixture type</div>
      <div style={{ display: "flex", gap: 4 }}>
        <select aria-label="Replacement fixture type" value={newType} onChange={(e) => { setNewType(e.target.value); setPreview(null); }}
          style={{ flex: 1, minWidth: 0, padding: 3, background: "#06121c", color: "#cce8ff", border: "1px solid #16415a", borderRadius: 3, fontSize: 9 }}>
          <option value="">— choose type —</option>
          {options.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <button type="button" disabled={!newType} onClick={doPreview}
          style={{ padding: "3px 6px", background: "#072b40", color: "#8de0ff", border: "1px solid #176181", borderRadius: 3, cursor: newType ? "pointer" : "default", fontSize: 8 }}>
          PREVIEW
        </button>
      </div>
      {preview && (
        <>
          <ReplacementReport report={preview} />
          <button type="button" onClick={apply}
            style={{ marginTop: 4, width: "100%", padding: 4, background: "#0b2512", color: "#b8f59e", border: "1px solid #37612b", borderRadius: 3, cursor: "pointer", fontSize: 8 }}>
            APPLY TYPE REPLACEMENT
          </button>
        </>
      )}
      {lastReport && <ReplacementReport report={lastReport} onAcknowledge={lastReport.footprintChanged || pendingReview ? acknowledge : undefined} />}
      {status && <div role="status" style={{ ...small, color: "#8de0ff", marginTop: 3 }}>{status}</div>}
    </div>
  );
}
