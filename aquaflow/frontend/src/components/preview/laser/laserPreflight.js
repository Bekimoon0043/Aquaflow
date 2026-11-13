// Preflight: would any programmed laser position put a beam into audience space below the
// minimum beam height? The preview (and real output) raises or blanks such beams; preflight says
// where and when so the programmer can fix the aim. Works in the plan frame (x, plan y as z).
import { evaluateShowFrameAt } from "../../../show/evaluateShowFrame";
import { isLaserFixture, laserFrame, laserState, DEFAULT_MIN_BEAM_HEIGHT_M } from "./laserRig";
import { laserSafetyArea } from "./laserSite";

const STEP_S = 0.25;

/** Sky / searchlight lasers point into navigable airspace: a standing reminder per projector. */
export function aviationNotes(lasers = []) {
  return lasers.filter((f) => f.engineering?.aviation || f.engineering?.laserKind === "sky").map((f) => ({
    code: "laser-aviation", severity: "info", fixtureId: f.id, engineeringItemId: f.id, timeMs: null,
    message: `${f.label || f.id}: sky laser — outdoor beams into the sky need the civil aviation authority's approval before use `
      + `(e.g. FAA Form 7140-1 in the US; ICAO laser-free, critical and sensitive flight zones near airports), a spotter or automatic `
      + `aircraft shutdown where required, and the show-laser permit.${Number(f.engineering?.nohdM) > 0 ? ` Static-beam NOHD ≈ ${f.engineering.nohdM} m.` : ""}`,
  }));
}

export function laserDiagnostics(project = {}) {
  const lasers = (project.fixtures || []).filter((f) => isLaserFixture(f?.type));
  if (!lasers.length) return [];
  const notes = aviationNotes(lasers);
  const clips = project.clips || [];
  const end = clips.reduce((m, c) => Math.max(m, Number(c.startTime ?? c.start ?? 0) + Number(c.duration || 0)), 0);
  const safety = laserSafetyArea({ siteSurfaces: project.siteSurfaces, basins: project.basins, geometry: project.geometry }, null);
  const rigs = lasers.map((f) => ({ id: f.id, label: f.label || f.id, x: Number(f.x) || 0, z: Number(f.y) || 0,
    y: Number.isFinite(Number(f.engineering?.mountHeightM)) ? Number(f.engineering.mountHeightM) : 0.5, rotation: Number(f.rotation) || 0, engineering: f.engineering || {} }));
  const found = new Map();
  for (let t = 0; t < end; t += STEP_S) {
    const frame = evaluateShowFrameAt(project, t);
    for (const rig of rigs) {
      const state = laserState(frame.fixtures[rig.id], rig);
      if (state.intensity <= 0.01) continue;
      const f = laserFrame(rig, state, t, safety);
      if (!f.blanked && !f.clamped) continue;
      const seen = found.get(rig.id) || { first: t, last: t, blanked: 0, clamped: 0 };
      seen.last = t; seen.blanked += f.blanked; seen.clamped += f.clamped;
      found.set(rig.id, seen);
    }
  }
  return [...notes, ...[...found].map(([id, s]) => {
    const rig = rigs.find((r) => r.id === id);
    const h = Number(rig.engineering.minBeamHeightM) || DEFAULT_MIN_BEAM_HEIGHT_M;
    const where = safety.zones.length ? "an audience area" : "audience space outside the basin";
    return {
      code: s.blanked ? "laser-audience-blanked" : "laser-audience-raised", severity: "warning", fixtureId: id, engineeringItemId: id,
      timeMs: Math.round(s.first * 1000),
      message: `${rig.label}: between ${s.first.toFixed(1)} s and ${(s.last + STEP_S).toFixed(1)} s the programmed aim sends beams into ${where} below ${h} m. `
        + (s.blanked ? "The projector stands in audience space below that height, so its beams are blanked — raise its mount height or move it into the basin."
          : "The preview raises them to clear it; aim higher (Tilt) so the real show matches."),
    };
  })];
}
