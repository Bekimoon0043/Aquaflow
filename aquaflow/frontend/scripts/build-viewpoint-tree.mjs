// Viewpoint-illusion tree — rows of vertical clear jets whose lit tops line up into a tree only from
// one marked spot ("STAND HERE"), per the user's preliminary layout:
//   pool 8 × 8 m (X −4…+4, Y 0…8 into the pool from its front inside edge), eye 14 m in front at
//   1.60 m, drawing plane 4 m behind the front edge; 42 canopy jets in rows A–F, 5 trunk jets.
//   Perspective: s = (14 + Y) / 18,  X = s·u,  H = 1.60 + s·(v − 1.60)   (u, v on the drawing plane)
//   vite-node build-viewpoint-tree.mjs <template.aquapkg> <out.aquapkg>
//
// v2 (matching the reference render): the canopy outline traced from the reference front view is
// filled with 82 jets in 8 rows (scripts/data/viewpoint-tree-layout.json); each jet carries a bushy
// lit crown tuft sized so, from STAND HERE, neighbouring tufts merge into one scalloped canopy; the
// columns below stay faint. The trunk is 4 foam jets in front. Pool 9 × 9.5 m, drawing plane 4.5 m.
//
// v3 (reports/Viewpoint tree fountain front view.md — physically buildable):
//   • Canopy = the natural crowns of plain smooth-bore jets (no flow straightener, exit turbulence
//     ≈ 6 %), sized per row so each breaks up at ~0.6–0.7 of its height: 10 / 10 / 12 / 12 / 12 /
//     14 / 14 / 16 mm for rows A–H; pitch 0.5 m apparent (≤ 0.7 × crown) with half-pitch stagger.
//   • Key light: two green framing projectors on masts at X = ±5.5 m behind the pool, lighting the
//     crowns from behind/side toward the viewer (forward scatter), the lower blade cut along the
//     canopy-floor sight plane z(Y) = 1.6 + (v_b − 1.6)(14 + Y)/18.5 so the columns below stay dark.
//   • Fill: an 11° underwater spot behind each jet (between rows), aimed toward the viewer at its crown.
//   • Trunk: 4 foam jets + two 25° spots; a 70 bar fog skirt round the trunk (calm nights).
//   • Basin with splash margins: ≥ jet height behind row H, ≥ 2.2 m in front of row A.
// AquaFlow plan: x = X, plan y = POOL.cy − Y (the audience is on +y).
import fs from "node:fs";
import { readZip, zipText, createZip } from "/src/utils/zipStore.js";
import { getDefaultEngineering } from "/src/data/fixtureLibrary.js";
import { compileStudio, inventory, newRecipe, readStudio } from "/src/components/programmer/studio/showModel.js";
import { readFountainDesign } from "/src/components/programmer/studio/fountainDesign.js";

const [tplPath, out] = process.argv.slice(2);
const r3 = (v) => Math.round(v * 1000) / 1000;
const BAR = 10.197, DEG = 180 / Math.PI;
const LAYOUT = JSON.parse(fs.readFileSync(new URL("./data/viewpoint-tree-layout.json", import.meta.url), "utf8"));
const EYE = LAYOUT.eye, PLANE_Y = LAYOUT.planeY;
const POOL = { w: 13, yFront: -1.0, yBack: 14.5 };              // Y range of the water (splash margins)
POOL.d = POOL.yBack - POOL.yFront; POOL.cy = (POOL.yBack + POOL.yFront) / 2;
const planY = (Y) => r3(POOL.cy - Y);
// Canopy-floor sight plane: what lies above it reads as canopy from the eye, what lies below as columns.
const V_FLOOR = LAYOUT.canopyFloorV ?? 1.7, K_FLOOR = (V_FLOOR - EYE.h) / (EYE.d + PLANE_Y);
const floorZ = (Y) => EYE.h + K_FLOOR * (EYE.d + Y);
const GREEN = "#2bff4a", TRUNK_GREEN = "#3dff7a";
const JET = "nozzle_straight_jet_dn15";              // stands in for a 12 mm adjustable lance jet
const FOAM = "nozzle_foam_jet_dn25";
const ROWS = LAYOUT.rows.map((r) => [r.row, r.Y, r.jets, r.nozzleMm]);
// Per-row hydraulics from the report (OASE flow data, plain bore): flow L/min and nozzle pressure bar.
const ROW_HYD = { A: [36, 0.27], B: [39, 0.33], C: [62, 0.39], D: [66, 0.45], E: [72, 0.53], F: [104, 0.60], G: [111, 0.69], H: [155, 0.78] };
const TRUNK = LAYOUT.trunk;

// Lance-jet hydraulics: ~69 L/min at 5 m for a 12 mm lance (SafeRain data), flow ∝ √height.
const plainJet = (row, H, mm) => {
  const [q, p] = ROW_HYD[row];
  return { jetHeightM: H, pressureBar: p, flowLpm: q, nozzleDiaMm: mm, outletDiaMm: mm, exitTurbulence: 0.06,
    nozzleStyle: "plain smooth-bore jet, no flow straightener",
    designStatus: "Viewpoint tree v3 — crown width unmeasured: test 10/12/14/16 mm at 2.2/4/6.4 m before ordering" };
};
// Where a jet top appears on the drawing plane, seen from the eye (inverse of the user's formula).
const apparent = (X, Y, H) => { const s = (EYE.d + Y) / (EYE.d + PLANE_Y); return { u: r3(X / s), v: r3(EYE.h + (H - EYE.h) / s) }; };

const fixtures = [];
const groups = new Map();
const add = (f, group) => {
  fixtures.push({ z: 0, rotation: 0, visible: true, ...f, engineering: { ...getDefaultEngineering(f.type), ...(f.engineering || {}) } });
  if (group) (groups.get(group) || groups.set(group, []).get(group)).push(f.id);
  return f.id;
};
const canopyApparent = [];
for (const [row, Y, jets, mm] of ROWS) {
  jets.forEach(({ X, H }, i) => {
    const id = `${row}${i + 1}`, pumpId = `pump-row-${row.toLowerCase()}`, y = planY(Y);
    add({ id, type: JET, label: `Canopy ${id} (${mm} mm plain jet)`, x: X, y, zone: `row-${row.toLowerCase()}`, groupId: `row_${row.toLowerCase()}`,
      engineering: { ...plainJet(row, H, mm), solenoidValveId: `${id}-valve`, pumpId, aimDeg: 0, aimAzimuthDeg: 0 } }, `Row ${row}`);
    add({ id: `${id}-valve`, type: "valve_solenoid_dn15_24v", label: `Balancing + solenoid valve ${id}`, x: X, y: r3(y - 0.15), zone: `row-${row.toLowerCase()}`,
      engineering: { controlledFixtureId: id, pumpId } }, `Row ${row} valves`);
    // Fill spot BEHIND the jet (half-way to the next row), aimed toward the viewer at the crown:
    // forward-scattered light, never shining along the column toward the audience.
    const back = 0.45, crownMid = Math.max(0.5, H - 0.35), tiltFromVertical = r3(Math.atan2(back, crownMid) * DEG);
    add({ id: `${id}-spot`, type: "light_uw_rgb_18w", label: `11° fill spot behind ${id}`, x: X, y: r3(y - back), zone: "canopy-lights",
      engineering: { pairedNozzleId: id, defaultColor: GREEN, aimDeg: tiltFromVertical, aimAzimuthDeg: 90, beamAngleDeg: 11, beamRadiusM: 1.0 } }, "Canopy spots");
    canopyApparent.push({ id, ...apparent(X, Y, H) });
  });
}
TRUNK.jets.forEach(({ X, H }, i) => {
  const id = `T${i + 1}`, pumpId = "pump-trunk", y = planY(TRUNK.Y);
  const foam = getDefaultEngineering(FOAM);
  add({ id, type: FOAM, label: `Trunk foam jet ${id}`, x: X, y, zone: "trunk", groupId: "trunk",
    engineering: { jetHeightM: H, pressureBar: r3(H / ((Number(foam.heightEfficiency) || 0.6) * BAR)), flowLpm: r3(Number(foam.flowLpm) * Math.sqrt(H / Number(foam.jetHeightM))),
      solenoidValveId: `${id}-valve`, pumpId } }, "Trunk");
  add({ id: `${id}-valve`, type: "valve_solenoid_dn15_24v", label: `Balancing + solenoid valve ${id}`, x: X, y: r3(y - 0.15), zone: "trunk",
    engineering: { controlledFixtureId: id, pumpId } }, "Trunk valves");
});
// Trunk: two 25° spots 0.6 m from the foam cluster, behind it, aimed toward the viewer at its middle.
[-0.6, 0.6].forEach((X, i) => {
  const y = planY(TRUNK.Y + 0.35), aim = r3(Math.atan2(Math.hypot(X, 0.35), 0.7) * DEG);
  add({ id: `trunk-spot-${i + 1}`, type: "light_uw_rgb_36w", label: `Trunk spot ${i + 1} (25°)`, x: X, y, zone: "trunk-lights",
    engineering: { pairedNozzleId: `T${i ? 4 : 1}`, defaultColor: TRUNK_GREEN, aimDeg: aim, aimAzimuthDeg: r3(((Math.atan2(0.35, -X) * DEG) + 360) % 360), beamAngleDeg: 25 } }, "Trunk lights");
});
// Fog skirt: 12 × 0.3 mm 70 bar anti-drip fog nozzles in the deck round the trunk (first stage cut in wind).
for (let i = 0; i < 12; i++) {
  const a = (2 * Math.PI * i) / 12;
  add({ id: `fog-${String(i + 1).padStart(2, "0")}`, type: "nozzle_fog_highpressure", label: `Fog skirt nozzle ${i + 1} (0.3 mm, 70 bar)`,
    x: r3(1.1 * Math.cos(a)), y: r3(planY(TRUNK.Y) + 0.6 * Math.sin(a)), zone: "fog", groupId: "fog",
    engineering: { flowLpm: 0.11, pressureBar: 70, nozzleDiaMm: 0.3, solenoidValveId: "fog-valve", pumpId: "pump-fog" } }, "Fog skirt");
}
add({ id: "fog-valve", type: "valve_solenoid_dn15_24v", label: "Fog skirt valve", x: 0, y: r3(planY(TRUNK.Y) + 0.9), zone: "fog",
  engineering: { controlledFixtureId: "fog-01", pumpId: "pump-fog" } }, "Fog valves");
add({ id: "pump-fog", type: "pump_high_pressure_mist_2_2kw", label: "Fog pump 70 bar (treated, softened supply)", x: 7.5, y: r3(planY(POOL.yBack) - 2), zone: "plant-room",
  groupId: "pumps", engineering: { servesValveIds: ["fog-valve"] } }, "Pumps");

// ── Key light: two green framing projectors on masts behind the pool, blades cut on the sight plane ─
const PROJ_Y = POOL.yBack + 0.5;
for (const side of [-1, 1]) {
  const X = 5.5 * side, z = r3(floorZ(PROJ_Y)), target = { x: 0, Y: 5.0, z: 4.0 };
  const dx = target.x - X, dy = planY(target.Y) - planY(PROJ_Y), dz = target.z - z;
  add({ id: `projector-${side < 0 ? "west" : "east"}`, type: "light_projector_framing_5200lm", label: `Framing projector ${side < 0 ? "west" : "east"} (green, 5,200 lm)`,
    x: X, y: planY(PROJ_Y), zone: "key-light",
    engineering: { mountHeightM: z, defaultColor: GREEN, lumens: 5200, beamAngleDeg: 40,
      aimDeg: r3(Math.atan2(Math.hypot(dx, dy), dz) * DEG), aimAzimuthDeg: r3(((Math.atan2(dy, dx) * DEG) + 360) % 360),
      // Lower blade along the canopy-floor sight plane: keep only z >= floorZ(Y).  In plan coords
      // Y = POOL.cy - y, so the kept half-space is (0, K, 1).(P - P0) >= 0 through P0 at Y = 0.
      framing: { blades: [{ point: [0, planY(0), r3(floorZ(0))], normal: [0, r3(K_FLOOR), 1] }], softnessM: 0.08 },
      designStatus: "Framing projector, Martin Exterior Projection Pro Compact class — verify datasheet" } }, "Key light");
}

// ── Pumps: seven independently adjustable groups (rows A–F + trunk), each on its own VFD ───────
const pumpOf = (id, label, group, x) => {
  const nz = groups.get(group).map((m) => fixtures.find((f) => f.id === m));
  const flow = nz.reduce((s, f) => s + f.engineering.flowLpm, 0), head = Math.max(...nz.map((f) => f.engineering.pressureBar * BAR)) + 6;
  const kw = (flow / 60000) * 1000 * 9.81 * head / 0.65 / 1000;
  const sizes = [[0.75, "0_75"], [1.1, "1_1"], [1.5, "1_5"], [2.2, "2_2"], [3.0, "3_0"], [4.0, "4_0"], [5.5, "5_5"], [7.5, "7_5"]];
  const s = sizes.find(([k]) => k >= kw * 1.15);
  add({ id, type: s ? `pump_inline_vfd_pump_${s[1]}kw` : "pump_dry_centrifugal_15kw", label, x, y: r3(planY(POOL.yBack) - 2), zone: "plant-room", groupId: "pumps",
    engineering: { servesValveIds: nz.map((f) => f.engineering.solenoidValveId), controlType: "VFD", designFlowLpm: r3(flow), designHeadM: r3(head) } }, "Pumps");
  return { label, n: nz.length, flow, head, kw };
};
const pumps = [...ROWS.map(([row], i) => pumpOf(`pump-row-${row.toLowerCase()}`, `Row ${row} pump (VFD)`, `Row ${row}`, -6 + i * 1.5)),
  pumpOf("pump-trunk", "Trunk pump (VFD)", "Trunk", 6)];
for (const p of pumps) console.log(`${p.label.padEnd(20)} ${String(p.n).padStart(2)} jets · ${Math.round(p.flow)} L/min · head ${p.head.toFixed(1)} m · ~${p.kw.toFixed(1)} kW`);
const totalM3h = pumps.reduce((s, p) => s + p.flow, 0) * 60 / 1000;
console.log(`total circulation ${totalM3h.toFixed(0)} m³/h (the 42-jet allowance was 150–170 m³/h)`);
// Sanity: where each row's tops appear on the drawing plane (u across, v up), seen from the eye.
for (const [row] of ROWS) {
  const pts = canopyApparent.filter((p) => p.id.startsWith(row));
  console.log(`row ${row} appears at v ${pts[0].v} m, u ${pts[0].u} … ${pts.at(-1).u} m`);
}

// ── Site: 13 × 15.5 m basin (splash margins), plaza, the STAND HERE disc ──────────────────────────────────────────
const outline = [{ x: -POOL.w / 2, y: -POOL.d / 2 }, { x: POOL.w / 2, y: -POOL.d / 2 }, { x: POOL.w / 2, y: POOL.d / 2 }, { x: -POOL.w / 2, y: POOL.d / 2 }];
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const disc = (cx, cy, r, n = 24) => Array.from({ length: n }, (_, i) => ({ x: r3(cx + r * Math.cos((2 * Math.PI * i) / n)), y: r3(cy + r * Math.sin((2 * Math.PI * i) / n)) }));
const eyePlanY = planY(-EYE.d);
const site_surfaces = [
  { id: "plaza", label: "Plaza", type: "paving", color: "#8f8a82", elevation: 0.02, visible: true, points: rect(-18, planY(POOL.yBack) - 6, 18, eyePlanY + 4) },
  { id: "stand-here", label: "STAND HERE — design viewpoint (eye 1.60 m)", type: "rock", color: "#2c3440", elevation: 0.04, visible: true, points: disc(0, eyePlanY, 0.6) },
  { id: "planting", label: "Planting behind", type: "grass", color: "#2f5d2a", elevation: 0.05, visible: true, points: rect(-18, planY(POOL.yBack) - 10, 18, planY(POOL.yBack) - 6) },
];

const files = readZip(fs.readFileSync(tplPath));
const proj = JSON.parse(zipText(files.get("project.aqua")));
const now = new Date().toISOString();
const NAME = "Viewpoint Tree — illusion from the STAND HERE spot";
Object.assign(proj.engineering, {
  name: "Viewpoint Tree", id: "aquaflow-viewpoint-tree", projectName: NAME, pool_type: "rectangular",
  params: { width: POOL.w, length: POOL.d, radius: 0, depth: 0.45, units: "m", design_head_m: 20 },
  geometry: { type: "polygon", closed: true, points: outline, source: { units: "meters" } },
  basins: [{ type: "polygon", closed: true, id: "basin-1", name: "Viewpoint basin", outer: outline, source: { units: "meters" } }],
  fixtures, groups: [...groups].map(([name, members]) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, uuid: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, owner: "model", name, members })),
  site_models: [], site_surfaces, cad_underlay: null, measurements: [], manualPipes: [], pipes: [],
  depth_zones: [{ id: "display", zone: "display", label: "Display basin (450 mm)", depth: 0.45, color: "#25476a", points: outline }],
  hydraulics: null, solved_hydraulics: null, bom: null, exported_at: now,
});
proj.devices = []; proj.nodes = []; proj.connections = [];

// ── Show (45 s): the trunk, then the canopy builds row by row front to back, holds, fades ────
const items = inventory(fixtures);
const g = (name, color = GREEN) => ({ id: `group-${name.toLowerCase().replace(/\W+/g, "-")}`, name, memberFixtureIds: groups.get(name), orderMode: "engineering", color });
const SG = [g("Trunk", TRUNK_GREEN), ...ROWS.map(([row]) => g(`Row ${row}`)), g("Canopy spots"), g("Trunk lights", TRUNK_GREEN), g("Key light"), g("Fog skirt", "#9fffc0")];
const rec = (group, name, effect, start, duration, extra = {}) => ({ ...newRecipe(SG.find((x) => x.name === group).id, start), name, effect, duration,
  cycles: 1, spread: 1, intensity: 100, order: "engineering", color: group === "Trunk" || group === "Trunk lights" ? TRUNK_GREEN : GREEN, ...extra });
const END = 45;
const recipes = [
  rec("Trunk lights", "Trunk glow", "static", 0, END), rec("Trunk", "Trunk", "static", 0.5, END - 1.5),
  ...ROWS.map(([row], i) => rec(`Row ${row}`, `Row ${row} rises`, "static", 3 + i * 1.5, END - 4 - i * 1.5)),
  rec("Canopy spots", "Fill spots on the crowns", "static", 3, END - 3.5, { intensity: 70 }),
  rec("Key light", "Framing projectors — canopy", "static", 3, END - 3.5),
  rec("Fog skirt", "Fog skirt round the trunk (calm nights)", "static", 1, END - 2),
];
const studio = { ...readStudio({}), groups: SG, recipes, site: { basin: outline.map((p) => [p.x, p.y]), windMs: 0 },
  markers: [{ id: "m1", name: "Trunk", time: 0, kind: "section" }, { id: "m2", name: "Canopy builds", time: 3, kind: "section" }, { id: "m3", name: "Full tree", time: 12, kind: "section" }] };
const { clips, issues } = compileStudio(studio, items);
if (issues.length) console.log("issues:", issues.slice(0, 6));
console.log(readFountainDesign(items).summary);
const byTrack = new Map();
for (const c of clips) (byTrack.get(c.trackId) || byTrack.set(c.trackId, []).get(c.trackId)).push(c);
proj.timelineTracks = items.flatMap((it) => (it.tracks || []).map((t) => ({ id: t.id, fixtureId: it.id, deviceId: it.id, label: `${it.label} · ${String(t.type).replace(/_/g, " ")}`,
  type: t.type, color: t.color || "#65d9d0", muted: false, solo: false, clips: byTrack.get(t.id) || [] })));
proj.programmer = { ...proj.programmer, studio, timelineClips: clips, cues: [], audioFile: null, audioBuffer: null, audioDuration: END,
  audioFileReference: null, musicCache: {}, stems: null };
proj.show = { ...proj.show, id: "aquaflow-viewpoint-tree-show", name: NAME, bpm: 120, duration: END };
proj.project = { ...proj.project, id: "aquaflow-viewpoint-tree", name: NAME, revision: 1, createdAt: now, modifiedAt: now };
// Cameras: the design eye (STAND HERE, 1.60 m) looking at the drawing plane, and a side view.
proj.render = { ...proj.render, environment: "night", windX: 0, windZ: 0, activeCameraView: "stand-here",
  cameraViews: [
    // At the eye point with a long lens (26°): framed like a phone photo zoomed in from the spot.
    { id: "stand-here", name: "STAND HERE (illusion)", position: { x: 0, y: EYE.h, z: eyePlanY }, target: { x: 0, y: 3.0, z: planY(PLANE_Y) }, fov: 26 },
    { id: "side", name: "Side view (rows revealed)", position: { x: 17, y: 7, z: 15 }, target: { x: 0, y: 2.2, z: 0 } },
    { id: "plan", name: "Plan (nozzle grid)", position: { x: 0, y: 26, z: 0.01 }, target: { x: 0, y: 0, z: 0 } },
  ] };
proj.workspace = { activePanel: "preview" };
proj.assetManifest = { format: "aquaflow-asset-manifest", version: 1, generatedAt: now, projectPath: out, assets: [] };
proj.savedAt = now;
fs.writeFileSync(out, createZip([{ name: "project.aqua", data: JSON.stringify(proj) }, { name: "manifest.json", data: JSON.stringify(proj.assetManifest, null, 2) }]));
console.log(`→ ${out} · ${fixtures.length} fixtures · ${clips.length} cues · ${recipes.length} patterns`);
