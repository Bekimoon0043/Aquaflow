// Firing-script export: AquaFlow never fires pyro. The CSV goes into the firing system, where the
// licensed operator checks, arms and fires; the safety summary travels with it.
import { useState } from "react";
import useEngineeringStore from "../../../store/engineeringStore";
import useProjectStore from "../../../store/projectStore";
import { firingSafetySummary, firingScriptCsv, isPyroClip, isPyroType } from "../../../show/pyro";
import { buildPreflightProject, loadPyroDiagnostics } from "../../../preflight/preflight";
import { downloadTextFile, safeFileName } from "./designerExport";

export function exportFiringScript() {
  const eng = useEngineeringStore.getState(), proj = useProjectStore.getState();
  const clips = (proj.programmer?.timelineClips || []).filter(isPyroClip);
  const fixtures = eng.fixtures || [];
  if (!clips.length) return { ok: false, message: "No pyro cues yet: add a pyro pattern in Show Studio first." };
  const project = buildPreflightProject({ fixtures, programmer: proj.programmer, site: { basins: eng.basins, geometry: eng.geometry, poolType: eng.poolType,
    params: eng.params, siteSurfaces: eng.siteSurfaces, siteModels: eng.siteModels, wind: { x: proj.render?.windX, z: proj.render?.windZ } } });
  const findings = loadPyroDiagnostics(project).filter((d) => d.code !== "pyro-firing-script");
  const name = safeFileName(proj.project?.name || "aquaflow-show");
  downloadTextFile(`${name}-firing-script.csv`, firingScriptCsv(clips, fixtures), "text/csv");
  downloadTextFile(`${name}-firing-safety.txt`, firingSafetySummary(clips, fixtures, findings, { showName: proj.project?.name || "AquaFlow show" }));
  const errors = findings.filter((d) => d.severity === "error").length;
  return { ok: true, message: `Firing script exported: ${clips.length} cue(s)${errors ? ` · ${errors} safety error(s) — read the safety summary` : ""}.` };
}

export default function PyroExportButton({ fixtures = [] }) {
  const [status, setStatus] = useState("");
  if (!fixtures.some((f) => isPyroType(f.type))) return null;
  return (
    <>
      <button type="button" onClick={() => setStatus(exportFiringScript().message)}
        title="CSV for the firing system (cue, ignition time + SMPTE, module/pin, product). AquaFlow never fires pyro."
        style={{ width: "100%", padding: "7px", marginBottom: 4, background: "#2a1204", color: "#ffb070", border: "1px solid #ff8a3d88", borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: "monospace" }}>
        EXPORT PYRO FIRING SCRIPT (CSV)
      </button>
      {status && <div role="status" style={{ color: "#ffb070", fontSize: 8, lineHeight: 1.5, marginBottom: 6 }}>{status}</div>}
    </>
  );
}
