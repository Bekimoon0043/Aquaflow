/**
 * validate_lebu_fountain.mjs — AF-NEXT-002 pilot validator.
 *
 * Version-controlled successor of <repo>/.tools/validate_lebu_fountain.mjs (kept
 * untouched). Loads aquaflow/samples/lebu-pilot/Lebu_Fountain_Pilot.aqua through the
 * real AquaFlow loader (utils/showFile.deserializeShow), compiles the Show Studio
 * patterns, and re-checks every manifest asset on THIS PC, reporting missing or
 * changed files. Exit code 1 only if the project itself is invalid or missing; optional
 * provenance assets are reported, not fatal.
 *
 *   cd aquaflow/frontend && npx vite-node ../tools/validate_lebu_fountain.mjs
 *   (vite-node resolves the frontend's extensionless imports; plain node cannot)
 */
import fs from "node:fs";
import path from "node:path";
import { deserializeShow } from "../frontend/src/utils/showFile.js";
import { compileStudio, inventory } from "../frontend/src/components/programmer/studio/showModel.js";
import { poolCenter } from "../frontend/src/engineering/geometryContract.js";
import { resolveCameraView } from "../frontend/src/utils/cameraViews.js";
import { PILOT_DIR, PILOT_FILE, scanAssets } from "./generate_lebu_fountain.mjs";

const manifest = JSON.parse(fs.readFileSync(path.join(PILOT_DIR, "manifest.json"), "utf8"));
const data = JSON.parse(fs.readFileSync(path.join(PILOT_DIR, PILOT_FILE), "utf8"));
const state = deserializeShow(data);
const project = state.engineeringProject;
const water = project.fixtures.filter(f => String(f.type).startsWith("nozzle_"));
const lights = project.fixtures.filter(f => String(f.type).startsWith("light_"));
const ids = new Set(project.fixtures.map(f => f.id));
const missingMembers = (data.programmer?.studio?.groups || []).flatMap(g => (g.memberFixtureIds || []).filter(id => !ids.has(id)));
const invalidRecipes = (data.programmer?.studio?.recipes || []).filter(r => !Number.isFinite(r.start) || !Number.isFinite(r.duration) || r.start < 0 || r.start + r.duration > state.currentShow.duration);
const center = poolCenter(project.geometry, project.params);
const items = inventory(project.fixtures, project.site_models, center);
const compiled = compileStudio(data.programmer.studio, items);
const activeView = resolveCameraView(state.projectDocument.render);

const errors = [];
if (project.pool_type !== "freeform" || project.geometry?.points?.length < 20) errors.push("Invalid CAD pool geometry");
if (water.length !== 23 || lights.length !== 16) errors.push("Unexpected fixture inventory");
if (missingMembers.length || invalidRecipes.length) errors.push("Invalid show-programmer references");
if (state.timelineTracks.length !== 5 || !state.currentShow.loop) errors.push("Invalid timeline setup");
if (compiled.issues.length || !compiled.clips.length) errors.push(`Pattern compile failed: ${compiled.issues.join(" | ")}`);
if (!activeView) errors.push("Active camera view missing");
if (state.devices.length || (data.hardware?.addresses || []).some(a => a.provisional !== true)) errors.push("Hardware must be unmapped or explicitly provisional");

// Re-check assets on this PC against the hashes recorded in manifest.json.
const scanned = await scanAssets(manifest.assets);
const assets = scanned.map((asset) => {
  const recorded = manifest.assets.find(a => a.path === asset.path) || {};
  let check = asset.status;
  if (asset.status === "present" && recorded.sha256 && recorded.sha256 !== asset.sha256) check = "changed";
  return { path: asset.path, role: asset.role, required: asset.required, status: check };
});
for (const a of assets) if (a.required && a.status !== "present") errors.push(`Required asset ${a.status}: ${a.path}`);

console.log(JSON.stringify({
  deserialized: true,
  name: state.currentShow.name,
  duration: state.currentShow.duration,
  geometryPoints: project.geometry.points.length,
  fixtures: project.fixtures.length,
  waterFixtures: water.length,
  lightFixtures: lights.length,
  programmerGroups: data.programmer.studio.groups.length,
  recipes: data.programmer.studio.recipes.length,
  timelineTracks: state.timelineTracks.length,
  resolvedPatternClips: compiled.clips.length,
  compileIssues: compiled.issues,
  activeCameraView: activeView?.id || null,
  hardware: data.hardware?.status,
  assets: assets.map(a => `${a.status.padEnd(7)} ${a.required ? "REQUIRED" : "optional"} ${a.path}`),
  errors,
}, null, 2));
if (errors.length) process.exit(1);
