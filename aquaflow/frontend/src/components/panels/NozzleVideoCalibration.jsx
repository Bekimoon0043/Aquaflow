// Nozzle timing calibration from video, in the Commission workspace (Calibration panel).
// It used to be reachable only from the Pattern Builder's music section. The values are part
// of the show's site settings (programmer.studio.site.calibration), so this writes the same
// project data Show Programming reads; its open document picks the change up automatically.
import React, { useMemo, useState } from "react";
import useEngineeringStore from "../../store/engineeringStore";
import useProjectStore from "../../store/projectStore";
import { poolCenter } from "../../engineering/geometryContract";
import { inventory } from "../programmer/studio/showModel";
import { readFountainDesign } from "../programmer/studio/fountainDesign";
import CalibrationDialog from "../programmer/studio/CalibrationDialog";

/** Pure: the programmer draft with one nozzle type's calibration stored on the show's site. */
export function withNozzleCalibration(programmer, type, calibration) {
  const studio = programmer?.studio || {};
  const site = studio.site || {};
  return { ...(programmer || {}), studio: { ...studio, site: { ...site, calibration: { ...(site.calibration || {}), [type]: calibration } } } };
}

export default function NozzleVideoCalibration() {
  const fixtures = useEngineeringStore((s) => s.fixtures), models = useEngineeringStore((s) => s.siteModels);
  const geometry = useEngineeringStore((s) => s.geometry), params = useEngineeringStore((s) => s.params), poolType = useEngineeringStore((s) => s.poolType);
  const programmer = useProjectStore((s) => s.programmer);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");

  const types = useMemo(() => {
    const items = inventory(fixtures, models, poolCenter(geometry, params, poolType));
    const design = readFountainDesign(items);
    return [...new Map(design.nozzles.map((n) => [n.item.type, { id: n.item.type, label: `${n.kindLabel} · ${n.item.type}` }])).values()];
  }, [fixtures, models, geometry, params, poolType]);
  const calibration = programmer?.studio?.site?.calibration || {};
  const done = Object.keys(calibration);

  const save = (type, cal) => {
    const project = useProjectStore.getState();
    project.rememberProgrammer(withNozzleCalibration(project.programmer, type, cal));
    setOpen(false);
    setNote(`Calibrated ${type}: delay ${cal.delayS} s, apex ${cal.apexM} m`);
  };

  return (
    <section className="nozzle-video-calibration" aria-label="Nozzle timing from video">
      <div className="nozzle-video-calibration-head">
        <strong>Nozzle timing from video</strong>
        <span>{done.length ? `${done.length} nozzle type(s) measured: ${done.join(", ")}` : "Timing from physics (not measured yet)"}</span>
        <button className="btn" onClick={() => setOpen(true)} disabled={!types.length}
          title="Film a jet side-on and mark its tip: AquaFlow measures its delay and rise so the show fires it exactly early enough">
          Calibrate from video…
        </button>
      </div>
      {!types.length && <small>Add nozzles in the Design workspace first.</small>}
      {note && <small role="status">{note}</small>}
      {open && <CalibrationDialog types={types} calibration={calibration} onClose={() => setOpen(false)} onSave={save} />}
    </section>
  );
}
