/**
 * pilotProject.js — AF-NEXT-014 "Start" card: open the committed Lebu pilot sample
 * (aquaflow/samples/lebu-pilot, AF-NEXT-002) through the normal project loader.
 *
 * The .aqua is bundled as a lazily loaded raw-text chunk, so the sample works the same in
 * the browser, the dev server and the packaged desktop app. Its hardware is UNMAPPED
 * (`hardware.status: "unmapped"`): it is a design/programming pilot, never evidence of a
 * commissioned installation.
 */
import { openProjectBytes } from "../utils/projectPersistence";

export const LEBU_PILOT_FILE = "Lebu_Fountain_Pilot.aqua";

export async function readLebuPilotText() {
  const mod = await import("../../../samples/lebu-pilot/Lebu_Fountain_Pilot.aqua?raw");
  return mod.default;
}

/** Load the pilot into the workspace (same path as File › Open). Returns {state, report}. */
export async function openLebuPilot({ readText = readLebuPilotText, open = openProjectBytes } = {}) {
  const text = await readText();
  return open({ text, name: LEBU_PILOT_FILE });
}
