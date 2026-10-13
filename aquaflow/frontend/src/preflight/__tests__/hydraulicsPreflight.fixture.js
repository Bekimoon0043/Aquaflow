// AF-NEXT-007 × AF-NEXT-009 — the overloaded-pump project shared by the end-to-end test and
// the golden generator (regenerate with: UPDATE_GOLDEN=1 npx vitest run src/preflight, then
// python backend/tests/golden_show_timeline.py — see docs/evidence/AF-NEXT-007.md).
import { buildPreflightProject } from "../preflight.js";

const nozzle = i => ({ id: `N${i}`, type: "nozzle_straight_dn25", x: 2 + i, y: 5,
  engineering: { flowLpm: 82.16, pressureBar: 1.2, jetHeightM: 9.79, connectionSize: "DN25", pumpId: "P1" } });

export function overloadedPumpProject() {
  return buildPreflightProject({
    fixtures: [{ id: "P1", type: "pump_submersible_1_5kw", x: 0, y: 5,
      engineering: { flowLpm: 366.67, headM: 12, connectionSize: "DN80" } },
    ...Array.from({ length: 8 }, (_, i) => nozzle(i))],
    programmer: { timelineClips: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}:N${i}:0`, fixtureId: `N${i}`,
      type: "device_intensity", startTime: 0, duration: 10, value: 100 })) },
    site: { basins: [{ id: "b1", outer: [{ x: -2, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 10 }, { x: -2, y: 10 }], holes: [] }] },
  });
}
