/**
 * Pyrotechnics: cue maths, Show Studio patterns, validation, the firing-script export and the
 * safety checks. Pure — no React, no stores, no THREE.
 *
 * A pyro cue is one `pyro_fire` clip per firing position. The designer places the BURST on the
 * beat; the clip starts at the IGNITION time = burst − lift time (pre-fire), and lasts until the
 * last star of the last shot has faded. AquaFlow never sends `pyro_fire` to any hardware: the
 * firing script is exported, and the operator arms and fires on the firing system.
 */
import { PYRO_BY_KEY } from "../data/pyroLibrary.js";

export const PYRO_CHANNEL = "pyro_fire";
export const PYRO_MODES = [
  ["single", "Single shot (all together)"],
  ["sweep", "Fan sweep across the positions"],
  ["chase", "Chase (one after another)"],
  ["barrage", "Finale barrage"],
];
/** Aerial pyro is normally stopped above roughly 9 m/s (20 mph) sustained wind. */
export const PYRO_WIND_LIMIT_MS = 9;

const round = (v, d = 3) => { const k = 10 ** d; return Math.round(Number(v) * k) / k; };
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export const isPyroType = (type) => String(type || "").toLowerCase().startsWith("pyro_");
export const isPyroClip = (clip) => clip?.type === PYRO_CHANNEL;

/** The pyro product of a fixture (its own engineering block first, then the catalogue). */
export function pyroProduct(fixtureOrType) {
  const fixture = typeof fixtureOrType === "object" && fixtureOrType ? fixtureOrType : null;
  const type = fixture ? fixture.type : fixtureOrType;
  const entry = PYRO_BY_KEY.get(String(type || ""));
  const base = entry?.engineering?.pyro || null;
  const own = fixture?.engineering?.pyro || null;
  if (!base && !own) return null;
  return { label: entry?.label || String(type), key: String(type), ...(base || {}), ...(own || {}) };
}

/** Seconds from the first burst to the end of the last shot's stars. */
export const pyroSpan = (p) => Math.max(0, (Math.max(1, num(p?.shots, 1)) - 1) * num(p?.intervalS)) + num(p?.durationS, 1);

/** Ignition time for a wanted burst time. */
export const ignitionTime = (burstTime, product) => round(num(burstTime) - num(product?.liftTimeS));

const hash01 = (i, seed = 1) => { let h = ((i + 1) * 2654435761 + seed * 40503) >>> 0; h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13; return (h >>> 0) / 4294967296; };

/** Burst time of the i-th of n ordered positions for a pyro recipe. */
export function burstTimeFor(recipe, i, n) {
  const start = num(recipe.start), duration = Math.max(0, num(recipe.duration));
  const mode = recipe.pyro?.mode || "single";
  if (mode === "sweep") return start + (n > 1 ? (duration * i) / (n - 1) : 0);
  if (mode === "chase") return start + i * Math.max(0.05, num(recipe.pyro?.intervalS, 0.5));
  if (mode === "barrage") return start + duration * hash01(i, num(recipe.seed, 1));
  return start;
}

/**
 * Compile a pyro recipe over its ordered member items (inventory items with tracks).
 * @returns {{ clips: object[], issues: string[] }}
 */
export function compilePyroRecipe(recipe, members) {
  const clips = [], issues = [];
  const pyroMembers = members.filter((item) => isPyroType(item.type));
  if (!pyroMembers.length) issues.push(`${recipe.name}: the group has no pyro firing positions.`);
  pyroMembers.forEach((item, i) => {
    const product = pyroProduct(item);
    const track = (item.tracks || []).find((t) => t.type === PYRO_CHANNEL);
    if (!product || !track) { issues.push(`${recipe.name}: ${item.label || item.id} has no pyro channel.`); return; }
    const burst = round(burstTimeFor(recipe, i, pyroMembers.length));
    const ignition = ignitionTime(burst, product);
    if (ignition < 0) {
      issues.push(`${recipe.name}: ${item.label || item.id} would have to fire ${(-ignition).toFixed(2)} s before the show starts (lift ${product.liftTimeS} s). Move the burst to ${(burst - ignition).toFixed(2)} s or later.`);
      return;
    }
    clips.push({
      id: `${recipe.id}:${item.id}:pyro`, studioRecipeId: recipe.id, patternBlockId: recipe.id,
      fixtureId: item.id, trackId: track.id, type: PYRO_CHANNEL,
      name: `${recipe.name} · ${product.label}${product.liftTimeS ? ` · fires ${product.liftTimeS} s before burst` : ""}`,
      startTime: ignition, duration: round(Math.max(0.1, num(product.liftTimeS) + pyroSpan(product))), value: 100,
      color: product.colors?.[0] || recipe.color, source: "show-studio",
      pyro: { burstTime: burst, liftTimeS: num(product.liftTimeS), productKey: product.key, shots: Math.max(1, num(product.shots, 1)) },
    });
  });
  return { clips, issues };
}

const burstOf = (clip, product) => num(clip.pyro?.burstTime, num(clip.startTime) + num(product?.liftTimeS ?? clip.pyro?.liftTimeS));

/** Show-level checks: nothing ignites before 0 s, and a position fires once (cakes may repeat). */
export function validatePyroCues(clips = [], items = []) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const issues = [], fired = new Map();
  for (const clip of clips) {
    if (!isPyroClip(clip)) continue;
    const item = byId.get(clip.fixtureId);
    const label = item?.label || clip.fixtureId;
    if (num(clip.startTime) < 0) issues.push({ code: "pyro-ignition-before-start", clip, message: `${label}: ignition at ${num(clip.startTime).toFixed(2)} s is before the show starts.` });
    const product = pyroProduct(item || {});
    if (product?.kind === "cake") continue;
    if (fired.has(clip.fixtureId)) {
      issues.push({ code: "pyro-position-reused", clip, message: `${label} is fired twice (at ${burstOf(fired.get(clip.fixtureId), product).toFixed(2)} s and ${burstOf(clip, product).toFixed(2)} s). Each mortar holds one shell: add another position or use a cake.` });
    } else fired.set(clip.fixtureId, clip);
  }
  return issues;
}

/** World-frame cues for the 3D preview: { id, x, y0, z, ignition, product }. */
export function pyroCuesFromClips(clips = [], fixtures = [], center = { cx: 0, cy: 0 }) {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const cues = [];
  for (const clip of clips) {
    if (!isPyroClip(clip) || clip.muted) continue;
    const f = byId.get(clip.fixtureId);
    const product = f && pyroProduct(f);
    if (!product) continue;
    cues.push({ id: clip.id, x: num(f.x) - num(center.cx), y0: 0, z: num(f.y) - num(center.cy), ignition: num(clip.startTime), product });
  }
  return cues.sort((a, b) => a.ignition - b.ignition);
}

// ─── Firing script export ───────────────────────────────────────────────

/** SMPTE time code HH:MM:SS:FF. */
export function smpte(seconds, fps = 30) {
  const totalFrames = Math.max(0, Math.round(num(seconds) * fps));
  const ff = totalFrames % fps, s = Math.floor(totalFrames / fps);
  const pad = (v) => String(v).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(ff)}`;
}

const csvCell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/**
 * Firing script rows, in ignition order. Module/pin come from the fixture's
 * engineering.firingModule / firingPin when set, otherwise 16 pins per module in position order.
 */
export function firingScriptRows(clips = [], fixtures = [], { pinsPerModule = 16 } = {}) {
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const positions = fixtures.filter((f) => isPyroType(f.type));
  const slot = new Map(positions.map((f, i) => [f.id, { module: Math.floor(i / pinsPerModule) + 1, pin: (i % pinsPerModule) + 1 }]));
  return clips.filter(isPyroClip).filter((c) => !c.muted)
    .sort((a, b) => num(a.startTime) - num(b.startTime) || String(a.fixtureId).localeCompare(String(b.fixtureId)))
    .map((clip, i) => {
      const f = byId.get(clip.fixtureId) || {};
      const product = pyroProduct(f) || {};
      const auto = slot.get(clip.fixtureId) || { module: "", pin: "" };
      const module = f.engineering?.firingModule ?? auto.module, pin = f.engineering?.firingPin ?? auto.pin;
      return {
        cue: i + 1, ignition: round(num(clip.startTime), 2), burst: round(burstOf(clip, product), 2), lift: num(product.liftTimeS),
        position: f.label || clip.fixtureId, module, pin, product: product.label || f.type || "", effect: product.effect || "",
        calibreMm: product.calibreMm || "", shots: Math.max(1, num(product.shots, 1)), safetyDistanceM: product.safetyDistanceM ?? "",
        notes: [f.engineering?.firingModule === undefined ? "module/pin auto-assigned" : "", product.onWater ? "on water" : "", clip.name || ""].filter(Boolean).join("; "),
      };
    });
}

export const FIRING_SCRIPT_COLUMNS = ["Cue", "Ignition (s)", "Ignition SMPTE (HH:MM:SS:FF)", "Burst (s)", "Lift (s)", "Position", "Module", "Pin",
  "Product", "Effect", "Calibre (mm)", "Shots", "Safety distance (m)", "Notes"];

export function firingScriptCsv(clips = [], fixtures = [], { fps = 30 } = {}) {
  const rows = firingScriptRows(clips, fixtures);
  const lines = [FIRING_SCRIPT_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([r.cue, r.ignition.toFixed(2), smpte(r.ignition, fps), r.burst.toFixed(2), r.lift, r.position, r.module, r.pin, r.product, r.effect,
      r.calibreMm, r.shots, r.safetyDistanceM, r.notes].map(csvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Plain-text safety summary that travels with the firing script. */
export function firingSafetySummary(clips = [], fixtures = [], diagnostics = [], { showName = "AquaFlow show" } = {}) {
  const rows = firingScriptRows(clips, fixtures);
  const out = [
    `${showName} — pyro firing script (EXPORT ONLY)`,
    "AquaFlow does not arm or fire pyrotechnics. The licensed operator loads this script into the firing system,",
    "checks every position on site, and arms and fires from the firing system.",
    "",
    `Cues: ${rows.length}${rows.length ? ` · first ignition ${rows[0].ignition.toFixed(2)} s · last burst ${Math.max(...rows.map((r) => r.burst)).toFixed(2)} s` : ""}`,
    `Wind limit for aerial items: ${PYRO_WIND_LIMIT_MS} m/s sustained (hold the show above it).`,
    "Distances are rule-of-thumb estimates (NFPA 1123: 70 ft per inch of shell diameter). Use the supplier data and the local permit.",
    "",
    "Safety findings:",
    ...(diagnostics.length ? diagnostics.map((d) => `  [${d.severity}] ${d.message}`) : ["  none"]),
  ];
  return `${out.join("\r\n")}\r\n`;
}

// ─── Safety checks ──────────────────────────────────────────────────────

function segDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
const asPoint = (p) => (Array.isArray(p) ? { x: num(p[0]), y: num(p[1]) } : { x: num(p?.x), y: num(p?.y) });

/** Plan outline points of a basin / geometry / surface record (circles are sampled). */
export function outlinePoints(shape) {
  if (!shape) return [];
  const list = shape.outer || shape.points || shape.geometry?.points;
  if (Array.isArray(list) && list.length >= 2) return list.map(asPoint);
  const radius = num(shape.radius ?? shape.geometry?.radius);
  if (radius > 0) {
    const c = asPoint(shape.center || shape.geometry?.center || { x: 0, y: 0 });
    return Array.from({ length: 48 }, (_, k) => ({ x: c.x + radius * Math.cos((k / 48) * 2 * Math.PI), y: c.y + radius * Math.sin((k / 48) * 2 * Math.PI) }));
  }
  return [];
}

/** Shortest distance from a plan point to a closed outline (0 when inside). */
export function distanceToOutline(point, outline) {
  if (outline.length < 2) return Infinity;
  let best = Infinity, inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[j], b = outline[i];
    best = Math.min(best, segDistance(point, a, b));
    if ((b.y > point.y) !== (a.y > point.y) && point.x < ((a.x - b.x) * (point.y - b.y)) / (a.y - b.y || 1e-12) + b.x) inside = !inside;
  }
  return inside ? 0 : best;
}

const AUDIENCE = /audience|spectator|crowd|seat|viewing|plaza|walkway|promenade|terrace/i;
const BUILDING = /building|hotel|house|tower|kiosk|pavilion|office|mall|shop|church|mosque|stage|tent|apartment/i;

/**
 * Safety diagnostics (preflight shape). `siteModels` positions are in the world frame relative to
 * `center` (as the 3D scene stores them); everything else is plan metres.
 */
export function pyroSafetyDiagnostics({ fixtures = [], clips = [], siteSurfaces = [], siteModels = [], basins = [], geometry = null, center = { cx: 0, cy: 0 }, wind = null } = {}) {
  const out = [];
  const positions = fixtures.filter((f) => isPyroType(f.type)).map((f) => ({ f, p: pyroProduct(f) })).filter((x) => x.p);
  if (!positions.length) return out;
  const fix = (f) => ({ kind: "open_engineering_item", target: f.id });
  const outlines = (basins?.length ? basins : geometry ? [geometry] : []).map((b) => ({ name: b.name || "Basin", pts: outlinePoints(b) })).filter((b) => b.pts.length >= 2);
  const audience = siteSurfaces.filter((s) => s?.type === "paving" || s?.type === "audience" || AUDIENCE.test(`${s?.label || ""} ${s?.name || ""}`))
    .map((s) => ({ name: s.label || s.name || "Paved area", pts: outlinePoints(s) })).filter((s) => s.pts.length >= 3);
  const buildings = siteModels.filter((m) => BUILDING.test(`${m?.name || ""} ${m?.label || ""} ${m?.assetId || ""} ${m?.kind || ""} ${m?.category || ""}`))
    .map((m) => ({ name: m.name || m.label || "Building", p: {
      x: num(m.transform?.position?.x ?? m.position?.x ?? m.position?.[0] ?? m.x) + num(center.cx),
      y: num(m.transform?.position?.z ?? m.position?.z ?? m.position?.[2] ?? m.y) + num(center.cy) } }));
  const fired = new Set(clips.filter(isPyroClip).map((c) => c.fixtureId));
  for (const { f, p } of positions) {
    const at = { x: num(f.x), y: num(f.y) }, R = num(p.safetyDistanceM), label = f.label || f.id;
    for (const zone of audience) {
      const d = distanceToOutline(at, zone.pts);
      if (d < R) out.push({ code: "pyro-safety-audience", severity: "error", fixtureId: f.id, engineeringItemId: f.id, fix: fix(f),
        message: `${label}: spectator area "${zone.name}" is ${d.toFixed(1)} m away, inside the ${R} m safety distance of ${p.label}.` });
    }
    for (const b of buildings) {
      const d = Math.hypot(b.p.x - at.x, b.p.y - at.y);
      if (d < R) out.push({ code: "pyro-safety-building", severity: "warning", fixtureId: f.id, engineeringItemId: f.id, fix: fix(f),
        message: `${label}: building "${b.name}" is ${d.toFixed(1)} m away, inside the ${R} m safety distance — check debris fall-out and the permit.` });
    }
    for (const b of outlines) {
      const d = distanceToOutline(at, b.pts);
      if (d < R && !p.onWater) out.push({ code: "pyro-safety-basin-edge", severity: "warning", fixtureId: f.id, engineeringItemId: f.id, fix: fix(f),
        message: `${label}: the ${b.name} edge walkway is ${d.toFixed(1)} m away, inside the ${R} m safety distance. Keep spectators off that part of the edge.` });
    }
    if (!fired.has(f.id)) out.push({ code: "pyro-position-unused", severity: "info", fixtureId: f.id, engineeringItemId: f.id, fix: fix(f), message: `${label} is never fired in the show.` });
  }
  const windMs = wind ? Math.hypot(num(wind.x), num(wind.z)) : 0;
  if (windMs > PYRO_WIND_LIMIT_MS && positions.some(({ p }) => p.aerial)) {
    out.push({ code: "pyro-wind", severity: "warning", message: `Wind ${windMs.toFixed(1)} m/s is above the ${PYRO_WIND_LIMIT_MS} m/s limit for aerial pyro: hold the aerial cues or the whole show.` });
  }
  const rows = firingScriptRows(clips, fixtures);
  if (rows.length) out.push({ code: "pyro-firing-script", severity: "info", timeMs: Math.round(rows[0].ignition * 1000),
    message: `Pyro firing script: ${rows.length} cue(s), first ignition ${rows[0].ignition.toFixed(2)} s. AquaFlow exports it only — the operator arms and fires on the firing system.` });
  for (const issue of validatePyroCues(clips, fixtures.map((x) => ({ ...x, label: x.label || x.id })))) {
    out.push({ code: issue.code, severity: "error", fixtureId: issue.clip.fixtureId, clipId: issue.clip.id, timeMs: Math.round(num(issue.clip.startTime) * 1000), message: issue.message });
  }
  return out;
}
