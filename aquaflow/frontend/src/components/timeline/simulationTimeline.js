const SIMULATION_COLORS = ["#22d3ee", "#34d399", "#a78bfa", "#f59e0b", "#fb7185", "#60a5fa"];

export function buildSimulationTracks(plan) {
  if (!plan) return [];
  const sourceClips = plan.visualClips || plan.designClips;
  if (sourceClips?.length) {
    const groups = new Map();
    sourceClips.forEach((clip, index) => {
      const key = plan.visualClips ? (clip.type || "visual") : "water-outlets";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        id: `simulation-${key}-${index}`,
        start: Number(clip.start) || 0,
        end: Math.max(Number(clip.end) || 0, Number(clip.start) || 0),
        intensity: Math.max(0, Math.min(100, Number(clip.value) || 0)),
        label: plan.visualClips
          ? `${String(clip.fixtureId || "fixture").replaceAll("_", " ")} · ${String(key).replaceAll("_", " ")}`
          : String(clip.fixtureId || "Water outlet").replaceAll("_", " "),
      });
    });
    return [...groups.entries()].map(([key, clips], index) => ({
      id: `simulation-track-${key}`,
      label: String(key).replaceAll("_", " "),
      type: "simulation",
      color: SIMULATION_COLORS[index % SIMULATION_COLORS.length],
      clips,
      muted: false,
      solo: false,
    }));
  }

  let cursor = 0;
  const clips = [];
  for (let pass = 0; pass < Math.max(1, Number(plan.repeat) || 1); pass += 1) {
    (plan.steps || []).forEach((step, index) => {
      const duration = Math.max(0, Number(step.duration) || 0) / 1000;
      clips.push({
        id: `simulation-step-${pass}-${index}`,
        start: cursor,
        end: cursor + duration,
        intensity: 100,
        label: `Pass ${pass + 1} · Step ${index + 1}`,
      });
      cursor += duration;
    });
  }
  return clips.length ? [{
    id: "simulation-track-steps",
    label: "I-CAN pattern states",
    type: "simulation",
    color: SIMULATION_COLORS[0],
    clips,
    muted: false,
    solo: false,
  }] : [];
}
