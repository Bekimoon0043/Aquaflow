import DxfParser from "dxf-parser";
import { CAD_DXF_HEADER, CAD_DXF_FOOTER, CAD_MODEL_SPACE_HANDLE } from "./cadDxfTemplate";
import { createDefaultEngineeringProject } from "./engineeringProject";
import { geometryForPoolType, polygonArea, pointInGeometry } from "./poolGeometry";
import { basinToGeometry, legacyFromBasins, reconcileBasins, scopeDepthZones, tessellateGeometry } from "./basins";
import { getDefaultEngineering, FIXTURE_LIBRARY } from "../data/fixtureLibrary";
import { resolveFixtureGroup } from "../hooks/fixtureTypeMap";
import { cadFrame, cadToPlan, planToCad, cadRotationToPlan } from "./geometryContract";
import { createCadUnderlay, createCadUnderlayFromEntities } from "./cadUnderlay";
import { LAND_SURFACE_TYPES } from "./siteSurfaces";
import { apiUrl } from "../utils/apiClient";

/** Client-side (main-thread dxf-parser) fallback cap. */
export const CAD_MAX_BYTES = 10 * 1024 * 1024;
/** Backend ezdxf importer cap (POST /api/cad/import, AF-CAD-010); matches desktop/cad-native.js. */
export const CAD_BACKEND_MAX_BYTES = 100 * 1024 * 1024;
export const CAD_UNITS = {
  meters: { code: 6, scale: 1, label: "Meters" },
  millimeters: { code: 4, scale: 0.001, label: "Millimeters" },
  centimeters: { code: 5, scale: 0.01, label: "Centimeters" },
  inches: { code: 1, scale: 0.0254, label: "Inches" },
  feet: { code: 2, scale: 0.3048, label: "Feet" },
};
export const CAD_ROLES = ["ignore", "pool", "island", "nozzle", "light", "equipment", "pipe", "depth", "measurement"];
const IDENTITY = [1, 0, 0, 1, 0, 0];
const finite = n => {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) > 1e12) throw new Error("Drawing contains invalid or excessively large coordinates.");
  return v === 0 ? 0 : v;
};
const point = p => ({ x: finite(p?.x), y: finite(p?.y) });
const transform = (p, m) => ({ x: finite(m[0] * p.x + m[2] * p.y + m[4]), y: finite(m[1] * p.x + m[3] * p.y + m[5]) });
const compose = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3],
  a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
const BASE_TYPES = ["pump", "vfd", "valve", "ican_gateway", "nozzle_running", "nozzle_geyser", "light_rgb"];
const knownTypes = new Set([...FIXTURE_LIBRARY.map(f => f.key), ...BASE_TYPES]);
const textValue = value => String(value ?? "").replace(/[\r\n\x00-\x1f]/g, " ")
  .replace(/[^\x20-\x7e]/g, ch => `\\U+${ch.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`);
const decodeText = value => String(value ?? "").replace(/\\U\+([a-f\d]{4})/gi, (_, v) => String.fromCharCode(parseInt(v, 16)));

function encodeMetadata(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
  return [1001, "AQUAFLOW", ...hex.match(/.{1,240}/g).flatMap(chunk => [1000, chunk])];
}

function readMetadata(lines) {
  const result = new Map();
  let handle, chunks = [], ours = false;
  const flush = () => {
    if (handle && chunks.length) {
      try {
        const hex = chunks.join("");
        if (!/^(?:[a-f\d]{2})+$/i.test(hex) || hex.length > 32768) return;
        const bytes = Uint8Array.from(hex.match(/../g), v => parseInt(v, 16));
        const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)
          || !["pool","island","fixture","label","pipe","depth"].includes(decoded.kind)) return;
        const meta = {kind:decoded.kind};
        for (const key of ["id","type","label","fixtureId","pipeType","zone","name","basinId"])
          if (typeof decoded[key] === "string" && decoded[key].length <= 4096) meta[key] = decoded[key];
        for (const key of ["rotation","depth","diameterMm","floorLevel","wallHeight"])
          if (typeof decoded[key] === "number" && Number.isFinite(decoded[key])) meta[key] = decoded[key];
        result.set(handle,meta);
      } catch { /* Unrecognized or damaged metadata never supplies control settings. */ }
    }
  };
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]), value = lines[i + 1].trim();
    if (code === 0) { flush(); handle = null; chunks = []; ours = false; }
    if (code === 5) handle = value;
    if (code === 1001) ours = value === "AQUAFLOW";
    if (code === 1000 && ours) chunks.push(value);
  }
  flush();
  return result;
}

// dxf-parser omits extrusion on some entity classes. Preserve the raw OCS
// normal so a reversed/tilted circle cannot be silently imported as XY geometry.
function attachRawCadHints(dxf, lines) {
  const models = [], blocks = new Map();
  let section = "", blockName = "", record = null;
  const flush = () => {
    if (!record) return;
    if (record.type === "SECTION") section = record.tags.get(2);
    else if (record.type === "ENDSEC") { section = ""; blockName = ""; }
    else if (section === "BLOCKS" && record.type === "BLOCK") { blockName = record.tags.get(2); blocks.set(blockName, []); }
    else if (record.type === "ENDBLK") blockName = "";
    else if (section === "ENTITIES") models.push(record);
    else if (section === "BLOCKS" && blockName) blocks.get(blockName).push(record);
  };
  for (let i=0;i<lines.length;i+=2) {
    const code = Number(lines[i]), value = lines[i+1].trim();
    if (code === 0) { flush(); record = { type:value, tags:new Map() }; }
    else if (record && !record.tags.has(code)) record.tags.set(code,value);
  }
  flush();
  const attach = (entities, records) => {
    let cursor = 0;
    for (const e of entities || []) {
      let i = records.findIndex((r,j) => j>=cursor && r.type===e.type && (!r.tags.has(5) || r.tags.get(5)===e.handle));
      if (i < 0) continue;
      const tags = records[i].tags; cursor = i+1;
      if (tags.has(210) || tags.has(220) || tags.has(230)) e.extrusionDirection = {
        x:Number(tags.get(210) || 0), y:Number(tags.get(220) || 0), z:Number(tags.get(230) ?? 1),
      };
      if (tags.has(67)) e.inPaperSpace = Number(tags.get(67))!==0;
    }
  };
  attach(dxf.entities,models);
  Object.entries(dxf.blocks || {}).forEach(([name,block]) => attach(block.entities,blocks.get(name) || []));
  return models;
}

export function defaultCadRole(layer) {
  const name = String(layer).toUpperCase().replace(/[ -]/g, "_");
  if (/^(POOL_OUTLINE|POOL|BASIN|BOUNDARY)$/.test(name)) return "pool";
  if (/^(POOL_ISLANDS?|ISLANDS?)$/.test(name)) return "island";
  if (/^(NOZZLES?|JETS?|RUNNING|FOAM|PEACOCK)$/.test(name)) return "nozzle";
  if (/^(LIGHTS?|LIGHTING|LEDS?)$/.test(name)) return "light";
  if (/^(EQUIPMENT|PUMPS?|VALVES?)$/.test(name)) return "equipment";
  if (/^(PIPEWORK|PIPES?)$/.test(name)) return "pipe";
  if (name === "DEPTH_ZONES") return "depth";
  if (name === "MEASUREMENTS") return "measurement";
  return "ignore";
}

export function parseCadDxf(text) {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > CAD_MAX_BYTES)
    throw new Error("Choose an ASCII DXF file no larger than 10 MB.");
  if (/^AutoCAD Binary DXF|^AC10\d\d/.test(text)) throw new Error("Save the drawing as ASCII DXF in AutoCAD first. Binary DXF and DWG are not supported.");
  const lines = text.replace(/^\uFEFF/, "").replace(/\r/g, "").trimEnd().split("\n");
  if (lines.length % 2 || lines.length > 600000 || lines.at(-1)?.trim() !== "EOF")
    throw new Error("The DXF is incomplete or too complex. Save a clean 2D ASCII DXF and try again.");
  for (let i = 0; i < lines.length; i += 2) {
    if (!/^\s*\d+\s*$/.test(lines[i]) || Number(lines[i]) > 1071) throw new Error("Invalid DXF group code.");
  }
  const metadata = readMetadata(lines);
  const dxf = new DxfParser().parseSync(lines.join("\n") + "\n");
  const rawEntities = attachRawCadHints(dxf,lines);
  if (!dxf?.entities?.length) throw new Error("The DXF has no model-space entities to import.");
  if (dxf.entities.length > 10000) throw new Error("Limit the drawing to 10,000 model-space entities before importing.");
  const layerSet = new Set(dxf.entities.map(e => e.layer || "0"));
  Object.keys(dxf.tables?.layer?.layers || {}).forEach(name => layerSet.add(name));
  Object.values(dxf.blocks || {}).forEach(block => (block.entities || []).forEach(e => layerSet.add(e.layer || "0")));
  const unitCode = Number(dxf.header?.$INSUNITS || 0);
  const units = Object.keys(CAD_UNITS).find(key => CAD_UNITS[key].code === unitCode) || null;
  return { dxf, metadata, rawEntities, units, unitCode, layers: [...layerSet].sort(),
    roles: Object.fromEntries([...layerSet].map(name => [name, defaultCadRole(name)])) };
}

function arcPoints(center, radius, start, sweep) {
  if (!(radius > 0)) throw new Error("Drawing contains a circle or arc with an invalid radius.");
  const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 60)));
  if (steps > 720) throw new Error("Invalid arc or ellipse sweep. Use curves within one full revolution.");
  return Array.from({ length: steps + 1 }, (_, i) => ({ x: center.x + radius * Math.cos(start + sweep*i/steps),
    y: center.y + radius * Math.sin(start + sweep*i/steps) }));
}

function polyPoints(vertices, closed) {
  if (vertices.length > 20000) throw new Error("A polyline has too many vertices. Simplify it before importing.");
  const result = [];
  for (let i = 0; i < vertices.length; i++) {
    if (result.length > 20000) throw new Error("Expanded polyline has too many curved segments. Simplify it before importing.");
    const a = point(vertices[i]), b = vertices[(i + 1) % vertices.length];
    const bulge = Number(vertices[i].bulge || 0);
    result.push(a);
    if (b && bulge && (closed || i < vertices.length - 1)) {
      finite(bulge);
      const end = point(b), dx = end.x-a.x, dy = end.y-a.y, chord = Math.hypot(dx, dy);
      if (!chord) continue;
      const offset = chord*(1-bulge*bulge)/(4*bulge);
      const center = { x: (a.x+end.x)/2-dy/chord*offset, y: (a.y+end.y)/2+dx/chord*offset };
      const radius = chord*(1+bulge*bulge)/(4*Math.abs(bulge));
      result.push(...arcPoints(center, radius, Math.atan2(a.y-center.y, a.x-center.x), 4*Math.atan(bulge)).slice(1, -1));
    }
  }
  return result;
}

function planar(e) {
  const ex = e.extrusionDirection;
  const x = ex?.x ?? e.extrusionDirectionX ?? 0, y = ex?.y ?? e.extrusionDirectionY ?? 0, z = ex?.z ?? e.extrusionDirectionZ ?? 1;
  return Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8 && Math.abs(z - 1) < 1e-8
    && !(e.paperSpace || e.inPaperSpace) && !e.is3dPolyline && !e.is3dPolygonMesh && !e.isPolyfaceMesh;
}

function flatten(parsed, roles, warnings) {
  const flat = [];
  let visits = 0;
  const visit = (e, matrix, inheritedLayer, stack = [], instance = "") => {
    if (++visits > 30000) throw new Error("Expanded CAD drawing is too complex. Explode or simplify blocks before importing.");
    const layer = !e.layer || e.layer === "0" ? (inheritedLayer || "0") : e.layer;
    const role = roles[layer] || "ignore";
    if (!planar(e)) { warnings.add("Non-planar, reversed-extrusion or paper-space entities were skipped. Use a 2D model-space drawing."); return; }
    const meta = parsed.metadata.get(e.handle) || null;
    if (e.type === "INSERT") {
      const pos = point(e.position);
      const sx = finite(e.xScale ?? 1), sy = finite(e.yScale ?? 1), angle = finite(e.rotation ?? 0)*Math.PI/180;
      const cols = e.columnCount || 1, rows = e.rowCount || 1;
      if (!sx || !sy || cols*rows > 1024 || cols < 1 || rows < 1) throw new Error("Invalid or excessively large block array.");
      const block = parsed.dxf.blocks?.[e.name];
      for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
        const offset = { x: col*(e.columnSpacing || 0), y: row*(e.rowSpacing || 0) };
        const insertPos = { x: pos.x+Math.cos(angle)*offset.x-Math.sin(angle)*offset.y,
          y: pos.y+Math.sin(angle)*offset.x+Math.cos(angle)*offset.y };
        const key = `${instance}${e.handle || visits}-${row}-${col}/`;
        if (["nozzle", "light", "equipment"].includes(role)) {
          flat.push({ e, layer, role, meta, key, anchor: transform(insertPos, matrix),
            rotation: angle+Math.atan2(matrix[1], matrix[0]), label: e.name });
          continue;
        }
        if (!block || stack.includes(e.name) || stack.length >= 8) { warnings.add("Unresolved, recursive or deeply nested blocks were skipped. Explode those blocks in AutoCAD."); continue; }
        const base = block.position || { x: 0, y: 0 };
        const a = Math.cos(angle)*sx, b = Math.sin(angle)*sx, cc = -Math.sin(angle)*sy, d = Math.cos(angle)*sy;
        const m = compose(matrix, [a, b, cc, d, insertPos.x-a*base.x-cc*base.y, insertPos.y-b*base.x-d*base.y]);
        (block.entities || []).forEach(child => visit(child, m, layer, [...stack, e.name], key));
      }
      return;
    }
    if (role === "ignore" && !["TEXT", "MTEXT"].includes(e.type)) return;
    let pts = [], closed = false, anchor = null, native = null;
    if (e.type === "LINE") pts = (e.vertices || []).map(point);
    else if (["LWPOLYLINE", "POLYLINE"].includes(e.type)) { closed = !!e.shape; pts = polyPoints(e.vertices || [], closed); }
    else if (e.type === "CIRCLE") {
      const center = point(e.center), radius = finite(e.radius);
      anchor = transform(center, matrix); closed = true;
      if (["nozzle", "light", "equipment"].includes(role)) {
        if (!(radius > 0)) throw new Error("Invalid fixture circle radius.");
      } else pts = arcPoints(center, radius, 0, 2*Math.PI).slice(0, -1);
      const sx = Math.hypot(matrix[0], matrix[1]), sy = Math.hypot(matrix[2], matrix[3]);
      if (Math.abs(sx-sy) < 1e-8 && Math.abs(matrix[0]*matrix[2]+matrix[1]*matrix[3]) < 1e-8)
        native = { type: "circle", center: anchor, radius: radius*sx };
    } else if (e.type === "ARC") {
      let sweep = finite(e.endAngle)-finite(e.startAngle);
      if (sweep <= 0) sweep += 2*Math.PI;
      pts = arcPoints(point(e.center), finite(e.radius), finite(e.startAngle), sweep);
      warnings.add("Curved polylines, arcs and rotated ellipses are approximated by short straight segments when needed.");
    } else if (e.type === "ELLIPSE") {
      const center = point(e.center), axis = point(e.majorAxisEndPoint), ratio = finite(e.axisRatio);
      if (!(ratio > 0 && ratio <= 1)) throw new Error("Invalid ellipse axis ratio.");
      const start = e.startAngle ?? 0, end = e.endAngle ?? 2*Math.PI;
      let sweep = finite(end)-finite(start); if (sweep <= 0) sweep += 2*Math.PI;
      closed = Math.abs(sweep-2*Math.PI) < 1e-7;
      const steps = Math.ceil(sweep/(Math.PI/60));
      if (steps > 720) throw new Error("Invalid ellipse sweep. Use curves within one full revolution.");
      pts = Array.from({ length: steps+(closed ? 0 : 1) }, (_, i) => {
        const t = start+sweep*i/steps;
        return { x: center.x+axis.x*Math.cos(t)-axis.y*ratio*Math.sin(t), y: center.y+axis.y*Math.cos(t)+axis.x*ratio*Math.sin(t) };
      });
      anchor = transform(center, matrix);
      const u = { x: matrix[0]*axis.x+matrix[2]*axis.y, y: matrix[1]*axis.x+matrix[3]*axis.y };
      const v = { x: (-matrix[0]*axis.y+matrix[2]*axis.x)*ratio, y: (-matrix[1]*axis.y+matrix[3]*axis.x)*ratio };
      if (closed && Math.abs(u.x*u.y+v.x*v.y) < 1e-8)
        native = { type: "ellipse", center: anchor, rx: Math.hypot(u.x,v.x), ry: Math.hypot(u.y,v.y) };
      else warnings.add("Curved polylines, arcs and rotated ellipses are approximated by short straight segments when needed.");
    } else if (["POINT", "TEXT", "MTEXT"].includes(e.type)) anchor = transform(point(e.position || e.startPoint), matrix);
    else { warnings.add(`Unsupported ${e.type} entities on selected layers were skipped.`); return; }
    if ((e.vertices || []).some(v => v.bulge)) warnings.add("Curved polylines, arcs and rotated ellipses are approximated by short straight segments when needed.");
    flat.push({ e, layer, role, meta, key: instance+(e.handle || visits), points: pts.map(p => transform(p,matrix)), closed, anchor, native,
      rotation: (Number(e.rotation ?? (meta?.kind === "fixture" ? -Number(meta.rotation || 0) : 0))*Math.PI/180)+Math.atan2(matrix[1],matrix[0]) });
  };
  parsed.dxf.entities.forEach(e => visit(e, IDENTITY));
  return flat;
}

function closedPaths(items, warnings) {
  const paths = items.filter(e => e.closed && e.points?.length >= 3).map(e => ({ ...e }));
  const open = items.filter(e => !e.closed && e.points?.length >= 2).map(e => ({ ...e, points: [...e.points] }));
  while (open.length) {
    const first = open.shift(), pts = [...first.points];
    while (!near(pts[0], pts.at(-1))) {
      const matches = open.map((e,i) => ({ e,i })).filter(({ e }) => near(pts.at(-1),e.points[0]) || near(pts.at(-1),e.points.at(-1)));
      if (matches.length !== 1) break;
      const { e,i } = matches[0]; open.splice(i,1);
      pts.push(...(near(pts.at(-1), e.points[0]) ? e.points : [...e.points].reverse()).slice(1));
    }
    if (pts.length >= 4 && near(pts[0], pts.at(-1))) paths.push({ ...first, native: null, points: pts.slice(0,-1), closed: true });
    else warnings.add("Open or branching pool lines were skipped. Join the boundary into one closed polyline in AutoCAD.");
  }
  return paths.filter(e => polygonArea(e.points) > 1e-10);
}

export function previewCadImport(parsed, options = {}) {
  const units = options.units === "auto" || !options.units ? parsed.units : options.units;
  if (!CAD_UNITS[units]) throw new Error("This drawing has no supported unit declaration. Select its actual drawing units before importing.");
  const scale = CAD_UNITS[units].scale, frame = cadFrame(options), flipY = frame.flipY;
  // AF-CAD-001: every CAD coordinate goes through the single geometryContract chain.
  const convert = p => { const q = cadToPlan({ x: finite(p.x*scale), y: finite(p.y*scale) }, frame); return { x: finite(q.x), y: finite(q.y) }; };
  const quarterTurn = Math.abs(frame.rotationDeg % 180) > 1e-9;
  const roles = options.roles || parsed.roles;
  const warnings = new Set();
  const flat = flatten(parsed, roles, warnings);
  // Parser silently skips some entity types; report those directly from the source.
  const supported = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "VERTEX", "SEQEND", "CIRCLE", "ARC", "ELLIPSE", "POINT", "TEXT", "MTEXT", "INSERT", "ATTRIB"]);
  for (const e of parsed.rawEntities || []) if (!supported.has(e.type) && roles[e.tags.get(8) || "0"] && roles[e.tags.get(8) || "0"] !== "ignore") warnings.add(`Unsupported ${e.type} entities were skipped.`);
  const poolPaths = closedPaths(flat.filter(e => e.role === "pool" || e.role === "island"), warnings);
  // AquaFlow exports tag islands on POOL_OUTLINE with XDATA kind "island".
  const isIsland = e => e.role === "island" || e.meta?.kind === "island";
  const candidates = poolPaths.filter(e => !isIsland(e)).map(e => {
    const native = e.native && !(quarterTurn && e.native.type === "ellipse") ? { ...e.native, center: convert(e.native.center),
      ...(e.native.radius ? { radius: e.native.radius*scale } : { rx: e.native.rx*scale, ry: e.native.ry*scale }) } : null;
    const points = e.points.map(convert);
    return { id: e.key, layer: e.layer, geometry: native || { type: "freeform", points, closed: true }, points,
      area: polygonArea(points), meta: e.meta };
  }).sort((a,b) => b.area-a.area);
  // AF-NEXT-010: basins written by AquaFlow (XDATA kind "pool") all come back as basins; any
  // other drawing chooses its primary basin (boundaryId) and, optionally, more (basinIds).
  const aquaBasins = candidates.filter(c => c.meta?.kind === "pool");
  const selected = options.boundaryId ? candidates.find(e => e.id === options.boundaryId)
    : (candidates.length === 1 || (aquaBasins.length && aquaBasins.length === candidates.length) ? candidates[0] : null);
  const basinIds = Array.isArray(options.basinIds) ? options.basinIds.map(String)
    : (selected ? [selected.id, ...aquaBasins.filter(c => c !== selected).map(c => c.id)] : []);
  const chosen = basinIds.map(id => candidates.find(c => c.id === id)).filter(Boolean);
  if (selected && !chosen.includes(selected)) chosen.unshift(selected);
  const islandPaths = poolPaths.filter(isIsland);
  const islands = islandPaths.map(e => e.points.map(convert));
  const clientLevels = meta => (meta?.kind === "pool" && (Number.isFinite(meta.floorLevel) || Number.isFinite(meta.wallHeight))
    ? { floorLevel: Number.isFinite(meta.floorLevel) ? meta.floorLevel : undefined, wallHeight: Number.isFinite(meta.wallHeight) ? meta.wallHeight : undefined,
      provenance: { floorLevel: "AQUAFLOW XDATA", wallHeight: "AQUAFLOW XDATA" } } : null);
  const basins = buildPreviewBasins(chosen.map(c => ({ handle: c.id, layer: c.layer, candidate: c, meta: c.meta, levels: clientLevels(c.meta) })),
    islandPaths.map(e => ({ handle: e.key, parent: null, points: e.points.map(convert) })), warnings);
  const labels = flat.filter(e => ["TEXT", "MTEXT"].includes(e.e.type) && e.anchor);
  const fixtures = [];
  for (const e of flat.filter(e => ["nozzle", "light", "equipment"].includes(e.role))) {
    if (!["CIRCLE", "POINT", "INSERT"].includes(e.e.type) || !e.anchor) {
      if (!["TEXT", "MTEXT"].includes(e.e.type)) warnings.add("Fixture layers import circle centers, points and block insertion points only. Other symbols were skipped.");
      continue;
    }
    const pos = convert(e.anchor);
    // Some drawings represent a fixture by a circle and a point at the same center.
    if (fixtures.some(f => f.cadLayer === e.layer && near(f,pos))) { warnings.add("Duplicate fixture markers at the same layer/position were collapsed."); continue; }
    const linkedLabel = labels.find(l => l.meta?.kind === "label" && l.meta.fixtureId === e.meta?.id);
    const label = labels.map(l => ({ l, dist: Math.hypot(l.anchor.x-e.anchor.x,l.anchor.y-e.anchor.y)*scale }))
      .filter(l => l.dist <= 1).sort((a,b) => a.dist-b.dist)[0]?.l;
    const fallback = e.role === "nozzle" ? "nozzle_geyser" : e.role === "light" ? "light_rgb" : "pump";
    fixtures.push({ id: e.meta?.kind === "fixture" ? String(e.meta.id || "") : `cad-${e.key.replace(/[^a-z\d-]/gi,"-")}`,
      type: knownTypes.has(e.meta?.type) ? e.meta.type : (options.fixtureTypes?.[e.layer] || fallback),
      label: linkedLabel ? decodeText(linkedLabel.e.text) : e.meta?.label || (label ? decodeText(label.e.text) : e.label) || `${e.layer} ${fixtures.length+1}`,
      ...pos, rotation: cadRotationToPlan(e.rotation*180/Math.PI, frame), cadLayer: e.layer, hasIdentity: e.meta?.kind === "fixture" });
  }
  if (fixtures.length > 5000) throw new Error("Limit fixture markers to 5,000 before importing.");
  const seen = new Set();
  for (const f of fixtures) {
    if (!f.id || seen.has(f.id)) throw new Error("Duplicate AquaFlow fixture IDs found. Remove copied identity metadata or export distinct fixtures before importing.");
    seen.add(f.id);
  }
  const pipes = flat.filter(e => e.role === "pipe" && e.points.length >= 2).map(e => ({
    id: e.meta?.kind === "pipe" ? e.meta.id : `cad-pipe-${e.key}`, points: e.points.map(convert),
    diameterMm: Math.max(1, Number(e.meta?.diameterMm) || 50), pipeType: e.meta?.pipeType || "supply", label: e.meta?.label || "Imported pipe", layer: "pipework",
  }));
  const depthZones = closedPaths(flat.filter(e => e.role === "depth"), warnings).map(e => ({
    id: e.meta?.id || `cad-depth-${e.key}`, zone: e.meta?.zone || "medium", label: e.meta?.label || "Imported depth zone",
    depth: Math.max(.05, Number(e.meta?.depth) || Number(options.depth) || .8), color: "#0077b6", points: e.points.map(convert),
  }));
  const measurements = flat.filter(e => e.role === "measurement" && e.points.length === 2).map(e => {
    const [a,b] = e.points.map(convert);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
  const allPoints = [...(selected?.points || []), ...fixtures];
  const bounds = allPoints.length ? { minX: Math.min(...allPoints.map(p => p.x)), maxX: Math.max(...allPoints.map(p => p.x)),
    minY: Math.min(...allPoints.map(p => p.y)), maxY: Math.max(...allPoints.map(p => p.y)) } : null;
  return { candidates, boundary: selected, islands, basins, levels: basins[0]?.levels || null, fixtures, pipes, depthZones, measurements, bounds,
    warnings: [...warnings], units, flipY, frame, source: "client" };
}

/**
 * Whole-drawing underlay for the client (dxf-parser) fallback path: every model-space
 * entity on every layer, in the same contract entity shape the backend returns.
 */
export function clientCadUnderlay(parsed, options = {}) {
  const units = options.units === "auto" || !options.units ? parsed.units : options.units;
  if (!CAD_UNITS[units]) return null;
  const scale = CAD_UNITS[units].scale;
  const roles = Object.fromEntries(parsed.layers.map(name => [name, "underlay"]));
  const flat = flatten(parsed, roles, new Set());
  const xy = p => [p.x*scale, p.y*scale];
  const entities = [];
  for (const e of flat) {
    if (["TEXT", "MTEXT"].includes(e.e.type) && e.anchor) entities.push({ handle: e.e.handle, layer: e.layer, kind: "text",
      position: xy(e.anchor), text: decodeText(e.e.text).replace(/\\P/g, " "), height: (Number(e.e.textHeight || e.e.height) || .2)*scale, rotation_deg: Number(e.e.rotation) || 0 });
    else if (e.points?.length >= 2) entities.push({ handle: e.e.handle, layer: e.layer, kind: "polyline", points: e.points.map(xy), closed: !!e.closed });
    else if (e.anchor) entities.push({ handle: e.e.handle, layer: e.layer, kind: "point", position: xy(e.anchor) });
  }
  const layers = Object.entries(parsed.dxf.tables?.layer?.layers || {}).map(([name, l]) => ({ name, color: l.colorIndex, off: l.visible === false }));
  return createCadUnderlayFromEntities(entities, { frame: options.frame || cadFrame(options), filename: options.filename, layers, units });
}

/**
 * applyCadImport(current, preview, { mode, name, depth, hydraulicGroups? })
 *
 * `hydraulicGroups` (optional): the CONFIRMED pump → valve → nozzle groups from the review's
 * "Hydraulic network" step (cadHydraulicGroups()). They are written onto the imported
 * fixtures as engineering.pumpId / engineering.valveId (final AquaFlow fixture ids — these
 * reach the solver through hydraulicAdapter's `...engineering` spread) and onto the imported
 * pipes as pumpId, and summarised in project.hydraulic_network. Unconfirmed proposals are
 * never stored.
 */
export function applyCadImport(current, preview, options = {}) {
  const updateExisting = options.mode === "update";
  // A fixtures-only drawing (e.g. the AutoLISP export: block references, no outlines) may
  // update a design that already has a basin; everything else needs a basin.
  const previewBasins = Array.isArray(preview.basins) && preview.basins.length ? preview.basins : null;
  const keepGeometry = !preview.boundary && !previewBasins && updateExisting && !!current?.geometry;
  if (!preview.boundary && !previewBasins && !keepGeometry) throw new Error("Choose one closed pool boundary before applying the drawing.");
  const base = updateExisting ? structuredClone(current) : createDefaultEngineeringProject();
  const matches = new Map((current.fixtures || []).map(f => [String(f.id), f]));
  const importedIds = new Set();
  const idByCandidate = new Map();
  const imported = preview.fixtures.map(f => {
    const old = updateExisting && f.hasIdentity ? matches.get(f.id) : null;
    const type = old?.type || f.type;
    if (!old && !knownTypes.has(type)) throw new Error(`Choose a valid AquaFlow fixture type for ${f.cadLayer}.`);
    importedIds.add(f.id);
    // CAD provenance only (handle/block/model/flow/height). Hardware addresses are NEVER taken from CAD.
    const cad = {};
    if (f.cadHandle) cad.cadHandle = String(f.cadHandle);
    if (f.cadBlock) cad.cadBlock = String(f.cadBlock);
    if (f.cadFields && Object.keys(f.cadFields).length) cad.cadFields = structuredClone(f.cadFields);
    const fixture = { ...(old ? structuredClone(old) : { id: updateExisting ? `import-${f.id}` : f.id,
      type, groupId: resolveFixtureGroup(type), zone: "medium", z: 0,
      engineering: { ...getDefaultEngineering(type), plcChannel: null, group: "", icanGroup: null, icanChannel: null, mappingStatus: "commissioning-required" } }),
      x: f.x, y: f.y, rotation: f.rotation, label: String(f.label), cadLayer: f.cadLayer, ...cad };
    if (f.candidateId) idByCandidate.set(String(f.candidateId), fixture.id);
    return fixture;
  });
  // Updating a site never deletes hardware records that were omitted from a CAD drawing.
  base.fixtures = updateExisting ? [...(current.fixtures || []).filter(f => !importedIds.has(String(f.id))), ...imported] : imported;
  if (new Set(base.fixtures.map(f => f.id)).size !== base.fixtures.length) throw new Error("Imported fixture identities conflict with this project.");
  const primaryMeta = preview.boundary?.meta || null;
  const depth = Number(options.depth ?? primaryMeta?.depth ?? base.params.depth);
  if (!Number.isFinite(depth) || depth < .05 || depth > 100) throw new Error("Enter a pool depth between 0.05 and 100 meters.");
  if (keepGeometry) {
    base.params = { ...base.params, depth };
  } else if (previewBasins) {
    applyPreviewBasins(base, previewBasins, { depth, current: updateExisting ? current : null });
  } else {
    const geometry = structuredClone(preview.boundary.geometry);
    const xs = preview.boundary.points.map(p => p.x), ys = preview.boundary.points.map(p => p.y);
    // AF-CAD-014: islands are holes in the single basin (backward compatible: absent = none).
    const holes = (preview.islands || []).filter(h => h?.length >= 3).map(h => h.map(p => ({ x: p.x, y: p.y })));
    if (holes.length) geometry.holes = holes; else delete geometry.holes;
    const levels = preview.levels || null;
    if (levels) {
      if (Number.isFinite(levels.floorLevel)) geometry.floorLevel = levels.floorLevel;
      if (Number.isFinite(levels.wallHeight)) geometry.wallHeight = levels.wallHeight;
    }
    base.geometry = geometry;
    base.pool_type = geometry.type === "circle" ? "circular" : geometry.type === "ellipse" ? "elliptical" : "freeform";
    base.params = { ...base.params, width: Math.max(.1, Math.max(...xs)-Math.min(...xs)), length: Math.max(.1, Math.max(...ys)-Math.min(...ys)),
      depth, ...(geometry.radius ? { radius: geometry.radius } : {}),
      ...(levels && Number.isFinite(levels.wallHeight) ? { wallHeight: levels.wallHeight } : {}),
      ...(levels && Number.isFinite(levels.floorLevel) ? { floorLevel: levels.floorLevel } : {}) };
  }
  if (!previewBasins) {
    // Legacy single-boundary previews and fixtures-only updates: basins follow the geometry.
    base.basins = reconcileBasins({ basins: keepGeometry ? current.basins : [], geometry: base.geometry,
      poolType: base.pool_type, params: base.params });
  }
  if (Array.isArray(preview.landSurfaces)) {
    // Re-import replaces only CAD-derived land; hand-drawn surfaces are kept when updating.
    const kept = updateExisting ? (current.site_surfaces || current.siteSurfaces || []).filter(s => !s.cadHandle) : [];
    base.site_surfaces = [...kept, ...structuredClone(preview.landSurfaces)];
  }
  if (preview.underlay) base.cad_underlay = preview.underlay;
  else if (!updateExisting) base.cad_underlay = null;
  base.name = options.name?.trim() || (updateExisting ? current.name : "Imported CAD design");
  base.id = updateExisting ? current.id : null;
  const pipes = structuredClone(preview.pipes || []);
  base.manualPipes = pipes; base.pipes = pipes;
  // Depth zones are scoped to the basin that contains them (zone.basinId / basin.depthZones).
  const scoped = scopeDepthZones(base.basins || [], preview.depthZones || []);
  base.depth_zones = scoped.depthZones; base.measurements = preview.measurements;
  if (base.basins?.length) base.basins = scoped.basins;
  base.solved_hydraulics = null; base.hydraulics = null; base.bom = [];
  applyCadHydraulicGroups(base, options.hydraulicGroups, idByCandidate);
  return base;
}

/**
 * AF-NEXT-010: preview basins → project.basins (+ the legacy geometry / pool_type / params of
 * basins[0]). Islands become that basin's holes; per-basin floor level / wall height come from
 * the preview levels. Re-importing keeps the name of a basin whose id (AQUAFLOW XDATA) matches.
 */
function applyPreviewBasins(base, previewBasins, { depth, current }) {
  const oldById = new Map((current?.basins || []).map(b => [String(b.id), b]));
  const basins = previewBasins.map((pb, i) => {
    const geometry = structuredClone(pb.geometry);
    const holes = (pb.islands || []).filter(h => h?.length >= 3).map(h => h.map(p => ({ x: p.x, y: p.y })));
    if (holes.length) geometry.holes = holes; else delete geometry.holes;
    const lv = pb.levels || null;
    if (lv && Number.isFinite(lv.floorLevel)) geometry.floorLevel = lv.floorLevel;
    if (lv && Number.isFinite(lv.wallHeight)) geometry.wallHeight = lv.wallHeight;
    const pts = geometry.type === "circle" || geometry.type === "ellipse" ? tessellateGeometry(geometry) : (geometry.points || pb.points);
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    const poolType = geometry.type === "circle" ? "circular" : geometry.type === "ellipse" ? "elliptical" : "freeform";
    const params = { width: Math.max(.1, Math.max(...xs) - Math.min(...xs)), length: Math.max(.1, Math.max(...ys) - Math.min(...ys)),
      depth: i === 0 ? depth : (Number(pb.depth) || depth), ...(geometry.radius ? { radius: geometry.radius } : {}),
      ...(lv && Number.isFinite(lv.wallHeight) ? { wallHeight: lv.wallHeight } : {}),
      ...(lv && Number.isFinite(lv.floorLevel) ? { floorLevel: lv.floorLevel } : {}) };
    const old = oldById.get(String(pb.id));
    return { geometry, poolType, params, id: pb.id, name: old?.name || pb.name || `Basin ${i + 1}` };
  });
  const primary = basins[0];
  base.pool_type = primary.poolType;
  base.params = { ...base.params, ...primary.params };
  base.geometry = primary.geometry;
  base.basins = reconcileBasins({
    basins: basins.map(b => ({ ...b.geometry, id: b.id, name: b.name, outer: b.geometry.points || tessellateGeometry(b.geometry),
      holes: b.geometry.holes || [], poolType: b.poolType, params: b.params })),
    geometry: primary.geometry, poolType: base.pool_type, params: base.params,
  });
  const legacy = legacyFromBasins(base.basins);
  base.geometry = legacy.geometry || base.geometry;
}

/** Write confirmed topology groups onto fixtures (engineering.pumpId/valveId) and pipes (pumpId). */
function applyCadHydraulicGroups(project, groups, idByCandidate) {
  const confirmed = (Array.isArray(groups) ? groups : []).filter(g => g && g.confirmed && g.pump);
  if (!confirmed.length) return;
  const byId = new Map(project.fixtures.map(f => [String(f.id), f]));
  const fid = cand => idByCandidate.get(String(cand)) || null;
  const out = [];
  for (const g of confirmed) {
    const pumpId = fid(g.pump);
    if (!pumpId) continue;
    const valveOf = new Map();
    Object.entries(g.valve_nozzles || {}).forEach(([valve, nozzles]) => (nozzles || []).forEach(n => valveOf.set(String(n), fid(valve))));
    const members = [...(g.valves || []), ...(g.nozzles || [])];
    for (const cand of members) {
      const f = byId.get(String(fid(cand)));
      if (!f) continue;
      f.engineering = { ...(f.engineering || {}), pumpId, valveId: valveOf.get(String(cand)) || null };
    }
    const pipeHandles = new Set((g.pipe_handles || []).map(String));
    for (const p of project.manualPipes) if (p.cadHandle && pipeHandles.has(String(p.cadHandle))) p.pumpId = pumpId;
    out.push({ pumpId, valveIds: (g.valves || []).map(fid).filter(Boolean), nozzleIds: (g.nozzles || []).map(fid).filter(Boolean),
      pipeIds: project.manualPipes.filter(p => p.pumpId === pumpId).map(p => p.id), confirmed: true });
  }
  project.hydraulic_network = { source: "cad", groups: out };
}

export function exportCadDxf(project) {
  const out = [];
  const pair = (...values) => out.push(...values.map(String));
  let handle = 256;
  const entity = (type, layer, subclass, fields, meta) => {
    pair(0,type,5,(handle++).toString(16).toUpperCase(),330,CAD_MODEL_SPACE_HANDLE,100,"AcDbEntity",8,layer,100,subclass,...fields);
    if (meta) pair(...encodeMetadata(meta));
  };
  const number = n => finite(n).toFixed(8).replace(/\.?0+$/, "") || "0";
  // AF-CAD-001: plan → CAD WCS through the single geometryContract chain (default frame).
  const xy = p => { const q = planToCad({ x: finite(p.x), y: finite(p.y) }); return [number(q.x), number(q.y)]; };
  const line = (a,b,layer,meta) => { const [ax,ay] = xy(a), [bx,by] = xy(b);
    entity("LINE",layer,"AcDbLine",[10,ax,20,ay,30,0,11,bx,21,by,31,0],meta); };
  const poly = (pts,layer,closed,meta) => entity("LWPOLYLINE",layer,"AcDbPolyline",[90,pts.length,70,closed ? 1 : 0,
    ...pts.flatMap(p => { const [x,y] = xy(p); return [10,x,20,y]; })],meta);
  const circle = (center,radius,layer,meta) => { const [x,y] = xy(center);
    entity("CIRCLE",layer,"AcDbCircle",[10,x,20,y,30,0,40,number(radius)],meta); };
  const label = (pos,text,layer="ANNOTATIONS",meta) => { const [x,y] = xy(pos);
    entity("TEXT",layer,"AcDbText",[10,x,20,y,30,0,40,.18,1,textValue(text),50,0,7,"STANDARD",100,"AcDbText",73,0],meta); };
  const writePool = (g, poolMeta) => {
    if (g.type === "circle") circle(g.center,g.radius,"POOL_OUTLINE",poolMeta);
    else if (g.type === "ellipse") {
      const vertical = g.ry > g.rx;
      const [ex,ey] = xy(g.center), axis = planToCad(vertical ? { x: 0, y: g.ry } : { x: g.rx, y: 0 });
      entity("ELLIPSE","POOL_OUTLINE","AcDbEllipse",[10,ex,20,ey,30,0,
        11,number(axis.x),21,number(axis.y),31,0,40,Math.min(g.rx,g.ry)/Math.max(g.rx,g.ry),41,0,42,2*Math.PI],poolMeta);
    } else if (g.points?.length >= 3) poly(g.points,"POOL_OUTLINE",g.closed !== false,poolMeta);
    else throw new Error("Draw a valid pool outline before exporting.");
  };
  const projectDepth = project.params?.depth ?? .8;
  // AF-NEXT-010: every basin (geometry wins for basins[0] if a legacy writer changed only it).
  const basins = Array.isArray(project.basins) && project.basins.length
    ? reconcileBasins({ basins: project.basins, geometry: project.geometry, poolType: project.pool_type, params: project.params }) : null;
  if (basins?.length) {
    basins.forEach((b, bi) => {
      const meta = { kind: "pool", id: String(b.id), name: String(b.name || b.id),
        depth: Number(bi === 0 ? projectDepth : (b.params?.depth ?? projectDepth)) || .8,
        ...(Number.isFinite(Number(b.floorLevel)) && b.floorLevel !== null ? { floorLevel: Number(b.floorLevel) } : {}),
        ...(Number.isFinite(Number(b.wallHeight)) && b.wallHeight !== null ? { wallHeight: Number(b.wallHeight) } : {}) };
      writePool(basinToGeometry(b), meta);
      (b.holes || []).forEach((h,j) => { if (h?.length >= 3) poly(h,"POOL_ISLANDS",true,{ kind: "island", id: `${b.id}-island-${j+1}`, basinId: String(b.id) }); });
    });
  } else {
    const g = project.geometry || geometryForPoolType(project.pool_type || project.poolType,project.params);
    writePool(g, { kind: "pool", depth: projectDepth });
    // Same layer set / XDATA as the backend writer (services/cad_export.py, AF-CAD-003).
    (g.holes || []).forEach((h,i) => { if (h?.length >= 3) poly(h,"POOL_ISLANDS",true,{ kind: "island", id: `island-${i+1}` }); });
  }
  const ids = new Set();
  (project.fixtures || []).forEach((f,i) => {
    const id = String(f.id || "");
    if (!id || ids.has(id)) throw new Error("Every exported fixture needs a unique AquaFlow ID.");
    ids.add(id);
    const layer = /^(light|laser)/.test(f.type) ? "LIGHTS" : /^nozzle/.test(f.type) ? "NOZZLES" : "EQUIPMENT";
    const model = f.model || f.cadFields?.model || f.engineering?.model;
    circle(f,.12,layer,{ kind: "fixture", id, type: f.type, label: f.label || `${f.type}-${i+1}`, rotation: Number(f.rotation || 0),
      ...(model ? { model: String(model) } : {}) });
    label({ x: finite(f.x)+.18, y: finite(f.y)-.18 },f.label || id,"ANNOTATIONS",{kind:"label",fixtureId:id});
  });
  (project.manualPipes?.length ? project.manualPipes : project.pipes || []).forEach((p,i) => {
    if (p.points?.length >= 2) poly(p.points,"PIPEWORK",false,{ kind: "pipe", id: p.id || `pipe-${i}`, label: p.label, diameterMm: p.diameterMm, pipeType: p.pipeType,
      ...Object.fromEntries(["from","to","material"].filter(k => p[k] != null && p[k] !== "").map(k => [k, String(p[k])])) });
  });
  // Land surfaces → solid HATCH on LANDSCAPE (the backend writes a pattern hatch; both carry kind "land").
  (project.site_surfaces || project.siteSurfaces || []).forEach((s,i) => {
    if (!(s?.points?.length >= 3)) return;
    const type = String(s.type || "grass").toLowerCase();
    entity("HATCH","LANDSCAPE","AcDbHatch",[10,0,20,0,30,0,210,0,220,0,230,1,2,"SOLID",70,1,71,0,91,1,92,3,72,0,73,1,93,s.points.length,
      ...s.points.flatMap(p => { const [x,y] = xy(p); return [10,x,20,y]; }),97,0,75,0,76,1,98,0],
      { kind: "land", id: String(s.id || `surface-${i+1}`), type, label: String(s.label || type) });
  });
  (project.depth_zones || []).forEach(z => { if (z.points?.length >= 3) poly(z.points,"DEPTH_ZONES",true,{ kind: "depth", id: z.id, zone: z.zone, label: z.label, depth: z.depth }); });
  (project.measurements || []).forEach(m => line({x:m.x1,y:m.y1},{x:m.x2,y:m.y2},"MEASUREMENTS"));
  label({ x: 0, y: -1 },project.name || "AquaFlow fountain design");
  return CAD_DXF_HEADER.replace(/(\$HANDSEED\n5\n)[a-f\d]+/i,"$1FFFFFF")
    + out.join("\n")+"\n" + CAD_DXF_FOOTER;
}

/**
 * AF-CAD-003 — one DXF writer. The designer exports through the backend ezdxf writer
 * (POST /api/cad/export.dxf, services/cad_export.py: blocks + ATTRIBs + AQUAFLOW XDATA,
 * AC1027) whenever the AquaFlow engine is reachable, and falls back to the browser writer
 * above (same layers, XDATA and +Y-up frame) only when it is not.
 * Resolves { dxf, writer: "backend" | "browser" }.
 */
export async function requestCadExportDxf(project, { dimensions = true, signal, fetchImpl } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  let res = null;
  try {
    res = await doFetch(apiUrl(`/cad/export.dxf?dimensions=${dimensions ? "true" : "false"}`), {
      method: "POST", headers: { "Content-Type": "application/json", Accept: "application/dxf" },
      body: JSON.stringify(project), signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    res = null;
  }
  if (res && res.ok) {
    const dxf = await res.text();
    if (dxf.slice(0, 64).includes("SECTION")) return { dxf, writer: "backend" };
  } else if (res && ![404, 405, 501, 502, 503, 504].includes(res.status)) {
    let detail = "";
    try { const body = await res.json(); detail = typeof body.detail === "string" ? body.detail : ""; } catch { /* non-JSON */ }
    throw new Error(detail || `CAD export failed (HTTP ${res.status}).`);
  }
  return { dxf: exportCadDxf(project), writer: "browser" };
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Backend importer (AF-CAD-010 / 012 / 014 / 017) — docs/CAD-IMPORT-CONTRACT.md
 * ══════════════════════════════════════════════════════════════════════════════
 * The backend returns CAD WCS metres (+Y up). Everything below converts through the
 * geometryContract chain (cadToPlan with the user's frame). CAD import is design data
 * only: nothing here talks to controllers, and hardware addresses are never assigned.
 */

/** Contract unit names ↔ CAD_UNITS keys. */
export const CAD_CONTRACT_UNITS = { mm: "millimeters", cm: "centimeters", m: "meters", in: "inches", ft: "feet" };
const UNIT_TO_CONTRACT = Object.fromEntries(Object.entries(CAD_CONTRACT_UNITS).map(([k, v]) => [v, k]));

export const CAD_CANDIDATE_TYPES = ["nozzle", "light", "pump", "valve", "equipment", "laser", "fire", "mist"];
/** Default AquaFlow fixture type per recognised category (user can override per group). */
export const CAD_CANDIDATE_DEFAULT_FIXTURE = {
  nozzle: "nozzle_geyser", light: "light_rgb", pump: "pump", valve: "valve", equipment: "pump",
  laser: "laser_rgb_5w", fire: "effect_flame_single", mist: "nozzle_mist_ring",
};
const FIXTURE_ROLE_TO_CANDIDATE = { nozzle: "nozzle", light: "light", equipment: "equipment" };

export class CadBackendUnavailableError extends Error {
  constructor(message) { super(message); this.name = "CadBackendUnavailableError"; this.backendUnavailable = true; }
}

async function cadFetch(path, init = {}, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await doFetch(apiUrl(path), { ...init, headers: { Accept: "application/json", ...(init.headers || {}) } });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new CadBackendUnavailableError("The AquaFlow CAD service is not reachable.");
  }
  if ([404, 405, 501, 502, 503, 504].includes(res.status)) throw new CadBackendUnavailableError(`The AquaFlow CAD service is unavailable (HTTP ${res.status}).`);
  if (!res.ok) {
    let detail = "";
    try { const body = await res.json(); detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body); }
    catch { /* non-JSON error body */ }
    throw new Error(detail || `CAD import failed (HTTP ${res.status}).`);
  }
  return res.json();
}

/** Basic shape check so a malformed response can never reach the design. */
export function validateCadImportResponse(data) {
  if (!data || typeof data !== "object" || !Array.isArray(data.entities))
    throw new Error("The CAD service returned an unexpected response. Try again or save the drawing as ASCII DXF.");
  return {
    ...data,
    layers: Array.isArray(data.layers) ? data.layers : [],
    inserts: Array.isArray(data.inserts) ? data.inserts : [],
    closed_outlines: Array.isArray(data.closed_outlines) ? data.closed_outlines : [],
    tables: Array.isArray(data.tables) ? data.tables : [],
    warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
    units: data.units && typeof data.units === "object" ? data.units : { name: "m", to_m: 1, unitless: false },
  };
}

/**
 * POST /api/cad/import (multipart). `file` is a File/Blob (DXF ASCII/binary, or the
 * AutoLISP .json export). Throws CadBackendUnavailableError when the service cannot be
 * reached so the caller can fall back to the client parser.
 */
export async function requestCadImport(file, { units, recognize = true, template = null, flattenTol, signal, fetchImpl } = {}) {
  if (!file || !(file.size > 0)) throw new Error("Choose a drawing file to import.");
  if (file.size > CAD_BACKEND_MAX_BYTES) throw new Error("The drawing must be no larger than 100 MB.");
  const unit = UNIT_TO_CONTRACT[units] || (CAD_CONTRACT_UNITS[units] ? units : null);
  // AF-CAD-019: the AutoLISP AQFEXPORT .json is read by POST /api/cad/import/aqf-json (the
  // multipart route only reads DXF). That route returns no recognition, so run it after.
  if (/\.json$/i.test(file.name || "")) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { throw new Error("This .json file is not valid JSON. Export it again with the AquaFlow AutoLISP command AQFEXPORT."); }
    const query = unit ? `?units=${encodeURIComponent(unit)}` : "";
    const imported = validateCadImportResponse(await cadFetch(`/cad/import/aqf-json${query}`,
      jsonPost({ data, filename: file.name }, signal), fetchImpl));
    if (recognize) {
      const recognition = await cadFetch("/cad/recognize", jsonPost({ import: imported, template }, signal), fetchImpl);
      if (recognition && Array.isArray(recognition.candidates)) imported.recognition = recognition;
    }
    return imported;
  }
  const form = new FormData();
  form.append("file", file, file.name || "drawing.dxf");
  if (unit) form.append("units", unit);
  form.append("max_mb", "100");
  form.append("recognize", String(!!recognize));
  if (flattenTol) form.append("flatten_tol", String(flattenTol));
  // Contract: inline JSON object, or the name of a saved template (sent verbatim).
  if (template) form.append("template", typeof template === "string" ? template : JSON.stringify(template));
  return validateCadImportResponse(await cadFetch("/cad/import", { method: "POST", body: form, signal }, fetchImpl));
}

const jsonPost = (body, signal) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });

/** POST /api/cad/recognize — re-run recognition with a mapping template. */
export async function recognizeCadImport(importResponse, template = null, { signal, fetchImpl } = {}) {
  const { recognition: _drop, ...payload } = importResponse || {};
  return cadFetch("/cad/recognize", jsonPost({ import: payload, template }, signal), fetchImpl);
}

/** GET /api/cad/templates → [{ name, rules }]. */
export async function listCadTemplates({ signal, fetchImpl } = {}) {
  const data = await cadFetch("/cad/templates", { signal }, fetchImpl);
  const list = Array.isArray(data) ? data : Array.isArray(data?.templates) ? data.templates : [];
  return list.filter(t => t && typeof t.name === "string").map(t => ({ name: t.name, rules: Array.isArray(t.rules) ? t.rules : [] }));
}

/** POST /api/cad/templates. */
export async function saveCadTemplate(template, { signal, fetchImpl } = {}) {
  if (!template?.name?.trim()) throw new Error("Name the mapping template before saving it.");
  return cadFetch("/cad/templates", jsonPost({ name: template.name.trim(), rules: template.rules || [] }, signal), fetchImpl);
}

const escapeRegex = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Turn review overrides ({ "block:NAME" | "layer:NAME": type }) into contract template rules. */
export function cadTemplateFromOverrides(name, overrides = {}) {
  const rules = [];
  for (const [key, type] of Object.entries(overrides)) {
    if (!CAD_CANDIDATE_TYPES.includes(type)) continue;
    const [match, ...rest] = key.split(":");
    if (!["block", "layer"].includes(match) || !rest.length) continue;
    rules.push({ match, pattern: `^${escapeRegex(rest.join(":"))}$`, type });
  }
  return { name: String(name || "").trim(), rules };
}

/** Review overrides recovered from a template's exact-match rules (inverse of the above). */
export function cadOverridesFromTemplate(template) {
  const out = {};
  for (const rule of template?.rules || []) {
    const m = /^\^(.*)\$$/.exec(String(rule.pattern || ""));
    if (!m || !["block", "layer"].includes(rule.match) || !CAD_CANDIDATE_TYPES.includes(rule.type)) continue;
    out[`${rule.match}:${m[1].replace(/\\(.)/g, "$1")}`] = rule.type;
  }
  return out;
}

/**
 * For a unitless drawing the backend ALREADY applied its suggested unit (coordinates are
 * metres, units.name / units.to_m say which factor was used). Rescale every coordinate
 * client-side to the unit the operator chose, RELATIVE to that applied factor
 * (k = chosen.to_m / units.to_m), so choosing the suggested unit is a no-op and nothing is
 * scaled twice. The dialog prefers a backend re-import with `units=` when the file is at
 * hand; this is the instant preview / offline path.
 */
export function rescaleCadImport(response, unitKey) {
  const target = CAD_UNITS[unitKey]?.scale;
  const from = Number(response?.units?.to_m) || 1;
  if (!target || Math.abs(target / from - 1) < 1e-12) return response;
  const k = target / from;
  const p = pt => (Array.isArray(pt) ? pt.map((v, i) => (i < 2 ? v * k : v)) : pt);
  const pts = list => (Array.isArray(list) ? list.map(p) : list);
  const loops = list => (Array.isArray(list) ? list.map(pts) : list);
  const r = structuredClone(response);
  r.units = { ...r.units, to_m: target, name: UNIT_TO_CONTRACT[unitKey] || r.units?.name, unitless: !!r.units?.unitless, overridden: unitKey };
  const z = v => (v == null || !Number.isFinite(Number(v)) ? v : Number(v) * k);
  if (r.extents) r.extents = { min: p(r.extents.min), max: p(r.extents.max) };
  r.entities = (r.entities || []).map(e => ({ ...e, ...(e.points ? { points: pts(e.points) } : {}), ...(e.center ? { center: p(e.center) } : {}),
    ...(e.radius != null ? { radius: e.radius * k } : {}), ...(e.position ? { position: p(e.position) } : {}),
    ...(e.height != null ? { height: e.height * k } : {}), ...(e.loops ? { loops: loops(e.loops) } : {}), ...(e.z != null ? { z: z(e.z) } : {}) }));
  // Insert positions are [x, y, z] in metres: Z (levels) scales with the drawing unit too.
  r.inserts = (r.inserts || []).map(i => ({ ...i, position: Array.isArray(i.position) ? i.position.map(v => v * k) : i.position }));
  r.closed_outlines = (r.closed_outlines || []).map(o => ({ ...o, points: pts(o.points), holes: loops(o.holes || []), area_m2: (Number(o.area_m2) || 0) * k * k }));
  r.tables = (r.tables || []).map(t => ({ ...t, ...(t.position ? { position: p(t.position) } : {}), ...(Array.isArray(t.bbox) ? { bbox: t.bbox.map(v => v * k) } : {}) }));
  if (r.recognition) {
    const g = r.recognition;
    r.recognition = { ...g,
      candidates: (g.candidates || []).map(c => ({ ...c, position: p(c.position), z: z(c.z) })),
      basins: (g.basins || []).map(b => ({ ...b, points: pts(b.points), holes: loops(b.holes || []), area_m2: (Number(b.area_m2) || 0) * k * k })),
      pipes: (g.pipes || []).map(x => ({ ...x, points: pts(x.points) })),
      land: (g.land || []).map(x => ({ ...x, loops: loops(x.loops) })) };
  }
  return r;
}

/** Hatch pattern / layer name → siteSurfaces material (null = not a land surface). */
export function landMaterialFor(pattern = "", layer = "") {
  const s = `${pattern} ${layer}`.toUpperCase();
  if (/GRASS|LAWN|TURF|GRAS\b|CESPED|RASEN/.test(s)) return "grass";
  if (/SAND|ARENA/.test(s)) return "sand";
  if (/GRAVEL|ROCK|STONE|KIES|GRAVA|PIEDRA/.test(s)) return "rock";
  if (/SOIL|EARTH|PLANT|MULCH|TIERRA|ERDE|BED/.test(s)) return "soil";
  if (/PAV|CONC|BRICK|TILE|AR-B|AR-HBONE|AR-PARQ|PATIO|DECK|PLAZA|HARD/.test(s)) return "paving";
  return null;
}

const pointInPoly = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / ((by - ay) || 1e-12) + ax) inside = !inside;
  }
  return inside;
};
const polyArea = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const dropClosingPoint = pts => (pts.length > 3 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 1e-9 ? pts.slice(0, -1) : pts);
const numOrNull = v => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

const LEVEL_FLOOR_KEYS = /^(FLOOR_?LEVEL|FLOOR|FFL|FL|BOTTOM|INVERT|IL|ELEV|ELEVATION|LEVEL)$/i;
const LEVEL_WALL_KEYS = /^(WALL_?HEIGHT|WALL_?H|WH|WALL)$/i;

/**
 * AF-CAD-014: wall height / floor level for the chosen basin from Z, attributes or defaults.
 * Returns { copingLevel, floorLevel, wallHeight, provenance: { copingLevel, floorLevel, wallHeight } }.
 */
export function deriveCadLevels(response, basinHandle, { depth, wallHeight, floorLevel } = {}) {
  const entities = response?.entities || [];
  const outline = (response?.closed_outlines || []).find(o => o.handle === basinHandle);
  const entity = entities.find(e => e.handle === basinHandle);
  const poly = outline?.points || entity?.points || null;
  const inside = pos => !poly || (Array.isArray(pos) && pointInPoly(pos[0], pos[1], poly));
  const prov = {};
  const coping = numOrNull(entity?.z) ?? 0;
  prov.copingLevel = numOrNull(entity?.z) != null && entity.z !== 0 ? "basin outline Z" : "default (0 m)";
  let floorAttr = null, wallAttr = null;
  for (const ins of response?.inserts || []) {
    if (!inside(ins.position)) continue;
    for (const [key, value] of Object.entries(ins.attribs || {})) {
      const v = numOrNull(String(value).replace(/[^\d.+-]/g, ""));
      if (v == null) continue;
      if (floorAttr == null && LEVEL_FLOOR_KEYS.test(key)) floorAttr = { v, src: `attribute ${key} on ${ins.effective_name || ins.block || "block"}` };
      if (wallAttr == null && LEVEL_WALL_KEYS.test(key)) wallAttr = { v, src: `attribute ${key} on ${ins.effective_name || ins.block || "block"}` };
    }
  }
  let floorZ = null;
  for (const o of response?.closed_outlines || []) {
    if (o.handle === basinHandle || !/FLOOR|BOTTOM|INVERT|SOFFIT/i.test(o.layer || "")) continue;
    const e = entities.find(x => x.handle === o.handle);
    const z = numOrNull(e?.z);
    if (z != null && z < coping && (!poly || o.points?.every(pt => pointInPoly(pt[0], pt[1], poly)))) { floorZ = { v: z, src: `Z of ${o.layer} outline` }; break; }
  }
  const d = numOrNull(depth);
  let wall = numOrNull(wallHeight), floor = numOrNull(floorLevel);
  if (wall != null) prov.wallHeight = "entered";
  if (floor != null) prov.floorLevel = "entered";
  if (floor == null && floorAttr) { floor = floorAttr.v; prov.floorLevel = floorAttr.src; }
  if (floor == null && floorZ) { floor = floorZ.v; prov.floorLevel = floorZ.src; }
  if (wall == null && wallAttr) { wall = wallAttr.v; prov.wallHeight = wallAttr.src; }
  if (wall == null && floor != null && coping - floor > 0) { wall = coping - floor; prov.wallHeight = "coping Z − floor level"; }
  if (wall == null) { wall = d != null && d > 0 ? d : 0.8; prov.wallHeight = d != null ? "pool depth" : "default (0.8 m)"; }
  if (floor == null) { floor = coping - wall; prov.floorLevel = "coping − wall height"; }
  return { copingLevel: coping, floorLevel: floor, wallHeight: wall, provenance: prov };
}

/** deriveCadLevels + the per-basin levels AquaFlow wrote into the outline's XDATA (round trip). */
function deriveBasinLevels(response, handle, options = {}, meta = null) {
  const lv = deriveCadLevels(response, handle, options);
  if (meta?.kind !== "pool") return lv;
  for (const key of ["floorLevel", "wallHeight"]) {
    if (numOrNull(options[key]) == null && numOrNull(meta[key]) != null) { lv[key] = Number(meta[key]); lv.provenance[key] = "AQUAFLOW XDATA"; }
  }
  return lv;
}

/**
 * AF-NEXT-010: chosen basin outlines → preview basins, each with its islands attached:
 * parent_handle first (contract: the smallest containing outline), else the smallest basin
 * that contains the island. items: [{handle, layer, candidate:{points, geometry}, meta, levels}].
 */
function buildPreviewBasins(items, islandRings, warnings) {
  const used = new Set();
  const basins = items.map((b, i) => {
    let id = b.meta?.kind === "pool" && b.meta.id ? String(b.meta.id) : `basin-${String(b.handle ?? i + 1).replace(/[^a-z\d-]/gi, "-")}`;
    if (used.has(id)) id = `${id}-${i + 1}`;
    used.add(id);
    return { id, name: b.meta?.kind === "pool" && b.meta.name ? String(b.meta.name) : `Basin ${i + 1}`, handle: b.handle ?? null,
      layer: b.layer || "", geometry: b.candidate.geometry, points: b.candidate.points, islands: [], islandHandles: [], levels: b.levels || null,
      area: polygonArea(b.candidate.points) };
  });
  for (const r of islandRings) {
    if (!basins.length || !(r.points?.length >= 3)) continue;
    let target = r.parent != null ? basins.find(b => b.handle != null && String(b.handle) === String(r.parent)) : null;
    if (!target) {
      const c = { x: r.points.reduce((t, p) => t + p.x, 0) / r.points.length, y: r.points.reduce((t, p) => t + p.y, 0) / r.points.length };
      target = basins.filter(b => pointInGeometry(c, { points: b.points }) || pointInGeometry(r.points[0], { points: b.points }))
        .sort((a, b) => a.area - b.area)[0] || null;
    }
    if (!target) { warnings.add("An island outside every chosen basin was not imported. Choose its basin, or mark it as reference only."); continue; }
    target.islands.push(r.points);
    target.islandHandles.push(r.handle ?? null);
  }
  return basins;
}

// Fields copied from recognition into fixture metadata. Addresses (dmx_address, pump_id,
// channels) are deliberately absent: CAD import never assigns hardware.
const SAFE_FIELDS = ["model", "flow_lpm", "height_m", "head_m", "dn", "power_w"];
const sanitizeFields = (fields = {}) => Object.fromEntries(SAFE_FIELDS
  .filter(k => fields?.[k] !== undefined && fields?.[k] !== null && fields?.[k] !== "")
  .map(k => [k, typeof fields[k] === "number" ? fields[k] : String(fields[k]).slice(0, 200)]));

/** Recognition candidates, or a conservative layer/XDATA-only fallback when recognition is absent. */
export function cadImportCandidates(response) {
  const rec = response?.recognition;
  if (rec && Array.isArray(rec.candidates)) return rec.candidates.filter(c => c && Array.isArray(c.position));
  const out = [];
  (response?.inserts || []).forEach((ins, i) => {
    const xd = ins.xdata?.AQUAFLOW;
    const role = FIXTURE_ROLE_TO_CANDIDATE[defaultCadRole(ins.layer)];
    if (!xd && !role) return;
    const type = role || (/^light|^laser/.test(xd?.type || "") ? "light" : /^nozzle/.test(xd?.type || "") ? "nozzle" : "equipment");
    // Nested inserts share their block-definition `handle`; `instance_id` (block_path/handle)
    // is the per-instance key recognition uses as source_handle (contract clarification).
    out.push({ id: `cand_${i}`, source_handle: ins.instance_id || ins.handle, type, confidence: xd ? 1 : 0.6,
      reasons: [xd ? "AQUAFLOW XDATA" : `layer ${ins.layer}`], position: ins.position, z: ins.position?.[2] ?? 0,
      rotation_deg: ins.rotation_deg || 0, block: ins.effective_name || ins.block, layer: ins.layer, attribs: ins.attribs || {},
      tag: ins.attribs?.ID || ins.attribs?.TAG || null, fields: {}, field_provenance: {}, aquaflow_id: xd?.id || null,
      ...(xd ? { xdata: { AQUAFLOW: xd } } : {}) });
  });
  (response?.entities || []).forEach((e, i) => {
    const role = FIXTURE_ROLE_TO_CANDIDATE[defaultCadRole(e.layer)];
    if (!role || !["circle", "point"].includes(e.kind) || e.block_path?.length) return;
    out.push({ id: `cand_e${i}`, source_handle: e.handle, type: role, confidence: 0.5, reasons: [`${e.kind} on layer ${e.layer}`],
      position: e.center || e.position, z: e.z ?? 0, rotation_deg: 0, block: null, layer: e.layer, attribs: {}, tag: null,
      fields: {}, field_provenance: {}, aquaflow_id: null });
  });
  return out;
}

export const cadGroupKey = c => (c.block ? `block:${c.block}` : `layer:${c.layer ?? "0"}`);

/** Closed outlines offered as basin / island / ignore, with recognition hints. */
export function cadOutlineChoices(response) {
  const rec = new Map((response?.recognition?.basins || []).map(b => [b.source_handle, b]));
  // `excluded` (contract): depth zones, dimensions, measurements, annotation layers and
  // non-pool AQUAFLOW XDATA kinds are listed but are never basins/islands — reference only.
  const list = (response?.closed_outlines || []).filter(o => Array.isArray(o.points) && o.points.length >= 3).map(o => {
    const excluded = o.excluded ? String(o.excluded) : null;
    const r = excluded ? null : rec.get(o.handle);
    return { handle: o.handle, layer: o.layer, points: dropClosingPoint(o.points), holes: excluded ? [] : (o.holes || []),
      holeHandles: excluded ? [] : (Array.isArray(o.hole_handles) ? o.hole_handles.map(String) : []), parentHandle: o.parent_handle ?? null,
      excluded, area: Number(o.area_m2) || polyArea(o.points), recognizedRole: r?.role || null, confidence: r?.confidence ?? null, reasons: r?.reasons || [] };
  });
  // Recognised basins that are not in closed_outlines (e.g. joined line loops).
  for (const [handle, b] of rec) if (!list.some(o => o.handle === handle) && Array.isArray(b.points) && b.points.length >= 3)
    list.push({ handle, layer: b.layer || "", points: dropClosingPoint(b.points), holes: b.holes || [],
      holeHandles: Array.isArray(b.hole_handles) ? b.hole_handles.map(String) : [], parentHandle: null, excluded: null,
      area: Number(b.area_m2) || polyArea(b.points), recognizedRole: b.role || "basin", confidence: b.confidence ?? null, reasons: b.reasons || [] });
  list.sort((a, b) => b.area - a.area);
  return list;
}

/**
 * Sensible defaults: every recognised basin (AF-NEXT-010 — a drawing may hold several), else the
 * largest outline on a pool layer, else the largest (never an excluded one).
 */
export function defaultCadOutlineRoles(outlines) {
  const roles = Object.fromEntries(outlines.map(o => [o.handle, !o.excluded && o.recognizedRole === "island" ? "island" : "ignore"]));
  const usable = outlines.filter(o => !o.excluded);
  const recognized = usable.filter(o => o.recognizedRole === "basin");
  const poolLayer = usable.filter(o => defaultCadRole(o.layer) === "pool");
  if (recognized.length) recognized.forEach(o => { roles[o.handle] = "basin"; });
  else { const basin = poolLayer[0] || usable[0]; if (basin) roles[basin.handle] = "basin"; }
  usable.filter(o => defaultCadRole(o.layer) === "island").forEach(o => { roles[o.handle] = "island"; });
  return roles;
}

/**
 * Effective outline roles: defaults ← user overrides, then
 *   - excluded outlines are forced to "ignore" (reference only, whatever was asked),
 *   - every chosen basin's holes (hole_handles) default to "island" unless the user chose otherwise.
 * Each island is therefore listed ONCE — by handle — never again from `basin.holes`.
 */
export function resolveCadOutlineRoles(outlines, overrides = {}) {
  const roles = { ...defaultCadOutlineRoles(outlines), ...overrides };
  const byHandle = new Map(outlines.map(o => [o.handle, o]));
  for (const o of outlines) if (o.excluded) roles[o.handle] = "ignore";
  for (const basin of outlines.filter(o => roles[o.handle] === "basin")) {
    for (const h of basin.holeHandles || []) {
      const hole = byHandle.get(h);
      if (hole && !hole.excluded && !(h in overrides) && roles[h] !== "basin") roles[h] = "island";
    }
  }
  return roles;
}

/**
 * previewCadImportResponse(response, options) → the same preview shape as previewCadImport
 * (so applyCadImport works for both paths) plus review data:
 *   reviewCandidates, groups, outlines, islands, landSurfaces, levels, underlay, recognition.
 *
 * options: { frame, units (override for unitless), outlineRoles {handle: basin|island|ignore},
 *   groupTypes {groupKey: type|"ignore"}, candidateTypes {candId: type|"ignore"},
 *   fixtureTypes {category: AquaFlow fixture key}, currentFixtures, depth, wallHeight,
 *   floorLevel, includeLand = true, includeUnderlay = true, filename }
 */
export function previewCadImportResponse(rawResponse, options = {}) {
  let response = validateCadImportResponse(rawResponse);
  // Unit override (required for unitless drawings, optional otherwise): rescale client-side, no re-upload.
  if (options.units && CAD_UNITS[options.units]) response = rescaleCadImport(response, options.units);
  const frame = cadFrame(options.frame || options);
  const toPlan = p => { const q = cadToPlan(p, frame); return { x: finite(q.x), y: finite(q.y) }; };
  const warnings = new Set(response.warnings);
  if (response.xrefs?.length) warnings.add(`Unresolved external references (XREF) were not imported: ${response.xrefs.join(", ")}.`);
  if (response.units?.unitless && !options.units) warnings.add("The drawing has no unit declaration. Choose its actual units before importing.");
  const entityByHandle = new Map(response.entities.map(e => [e.handle, e]));

  // Basin / islands
  const outlines = cadOutlineChoices(response);
  const roles = resolveCadOutlineRoles(outlines, options.outlineRoles || {});
  // AF-NEXT-010: EVERY outline chosen as "basin" becomes a basin (largest first = primary).
  const basinOutlines = outlines.filter(o => roles[o.handle] === "basin");
  const basinOutline = basinOutlines[0] || null;
  const xdataOf = handle => { const x = entityByHandle.get(handle)?.xdata?.AQUAFLOW
    || (response.closed_outlines || []).find(o => o.handle === handle)?.xdata?.AQUAFLOW; return x && typeof x === "object" ? x : null; };
  const candidates = outlines.map(o => {
    const points = o.points.map(toPlan);
    return { id: o.handle, layer: o.layer, role: roles[o.handle] || "ignore", points, area: o.area, confidence: o.confidence, reasons: o.reasons,
      excluded: o.excluded, parentHandle: o.parentHandle, geometry: { type: "freeform", points, closed: true }, meta: xdataOf(o.handle) };
  });
  const basinCandidate = o => {
    const c = candidates.find(x => x.id === o.handle);
    const ent = entityByHandle.get(o.handle);
    if (ent?.kind === "circle" && Array.isArray(ent.center) && ent.radius > 0)
      return { ...c, geometry: { type: "circle", center: toPlan(ent.center), radius: Number(ent.radius) } };
    return c;
  };
  const boundary = basinOutline ? basinCandidate(basinOutline) : null;
  // Islands: each attaches to its parent basin (parent_handle), else the basin containing it.
  const islandRings = outlines.filter(o => roles[o.handle] === "island").map(o => ({ handle: o.handle, parent: o.parentHandle, points: o.points.map(toPlan) }));
  // Holes the backend reported without a matching outline handle (older payloads) are added
  // once; holes that ARE outlines were resolved to roles above (no double islands).
  const listed = new Set(outlines.map(o => o.handle));
  basinOutlines.forEach(b => (b.holes || []).forEach((h, i) => {
    const handle = b.holeHandles?.[i];
    if ((handle == null || !listed.has(handle)) && h?.length >= 3) islandRings.push({ handle: null, parent: b.handle, points: dropClosingPoint(h).map(toPlan) });
  }));
  const islands = islandRings.map(r => r.points);
  const previewBasins = buildPreviewBasins(basinOutlines.map(o => ({ handle: o.handle, layer: o.layer, candidate: basinCandidate(o),
    meta: xdataOf(o.handle), levels: deriveBasinLevels(response, o.handle, options, xdataOf(o.handle)) })), islandRings, warnings);

  // Fixtures (review candidates → fixtures)
  const current = options.currentFixtures || [];
  const currentIds = new Set(current.map(f => String(f.id)));
  const byHandle = new Map(current.filter(f => f.cadHandle).map(f => [String(f.cadHandle), f]));
  const texts = response.entities.filter(e => e.kind === "text" && Array.isArray(e.position));
  const reviewCandidates = cadImportCandidates(response).map(c => {
    const groupKey = cadGroupKey(c);
    const override = options.candidateTypes?.[c.id] ?? options.groupTypes?.[groupKey];
    const type = override || c.type;
    return { ...c, groupKey, effectiveType: type, excluded: type === "ignore" || !CAD_CANDIDATE_TYPES.includes(type), overridden: !!override,
      matchedId: c.aquaflow_id && currentIds.has(String(c.aquaflow_id)) ? String(c.aquaflow_id)
        : (c.source_handle && byHandle.has(String(c.source_handle)) ? String(byHandle.get(String(c.source_handle)).id) : null) };
  });
  const groups = [...reviewCandidates.reduce((m, c) => {
    if (!m.has(c.groupKey)) m.set(c.groupKey, { key: c.groupKey, type: c.effectiveType, count: 0, confidenceSum: 0, layer: c.layer, block: c.block });
    const g = m.get(c.groupKey); g.count += 1; g.confidenceSum += Number(c.confidence) || 0;
    if (g.type !== c.effectiveType) g.type = "mixed";
    return m;
  }, new Map()).values()].map(g => ({ ...g, meanConfidence: g.count ? g.confidenceSum / g.count : 0 }));

  const fixtures = [];
  for (const c of reviewCandidates) {
    if (c.excluded) continue;
    const pos = toPlan(c.position);
    const label = c.tag || c.attribs?.ID || c.attribs?.TAG || c.attribs?.NAME
      || texts.map(t => ({ t, d: Math.hypot(t.position[0] - c.position[0], t.position[1] - c.position[1]) })).filter(t => t.d <= 1).sort((a, b) => a.d - b.d)[0]?.t.text
      || `${c.effectiveType} ${fixtures.length + 1}`;
    const libraryType = knownTypes.has(c.xdata?.AQUAFLOW?.type) ? c.xdata.AQUAFLOW.type
      : options.fixtureTypes?.[c.effectiveType] || CAD_CANDIDATE_DEFAULT_FIXTURE[c.effectiveType];
    fixtures.push({
      id: c.matchedId || (c.aquaflow_id ? String(c.aquaflow_id) : `cad-${String(c.source_handle || c.id).replace(/[^a-z\d-]/gi, "-")}`),
      type: libraryType, label: String(label), ...pos, rotation: cadRotationToPlan(c.rotation_deg || 0, frame),
      cadLayer: c.layer || "0", hasIdentity: !!c.matchedId || !!c.aquaflow_id,
      cadHandle: c.source_handle || null, cadBlock: c.block || null, cadFields: sanitizeFields(c.fields),
      confidence: Number(c.confidence) || 0, candidateId: c.id, category: c.effectiveType,
    });
  }
  if (fixtures.length > 5000) throw new Error("Limit fixture markers to 5,000 before importing.");
  const seen = new Set();
  for (const f of fixtures) {
    if (!f.id || seen.has(f.id)) throw new Error("Duplicate AquaFlow fixture IDs found. Remove copied identity metadata or export distinct fixtures before importing.");
    seen.add(f.id);
  }

  // Pipes, depth zones, measurements
  const recPipes = response.recognition?.pipes;
  const pipeSource = Array.isArray(recPipes) && recPipes.length ? recPipes
    : response.entities.filter(e => e.kind === "polyline" && !e.closed && defaultCadRole(e.layer) === "pipe")
      .map(e => ({ source_handle: e.handle, points: e.points, layer: e.layer }));
  const pipes = pipeSource.filter(p => p.points?.length >= 2).map((p, i) => ({
    id: `cad-pipe-${p.source_handle || i}`, points: p.points.map(toPlan), diameterMm: Math.max(1, Number(p.dn) || 50),
    pipeType: "supply", label: [p.material, p.dn ? `DN${p.dn}` : ""].filter(Boolean).join(" ") || "Imported pipe", layer: "pipework",
    ...(p.source_handle ? { cadHandle: p.source_handle } : {}),
  }));
  const depthZones = response.entities.filter(e => e.kind === "polyline" && e.closed && defaultCadRole(e.layer) === "depth" && e.points?.length >= 3)
    .map(e => { const x = e.xdata?.AQUAFLOW?.kind === "depth" ? e.xdata.AQUAFLOW : null;
      return { id: x?.id ? String(x.id) : `cad-depth-${e.handle}`, zone: x?.zone || "medium", label: x?.label || "Imported depth zone",
        depth: Math.max(.05, Number(x?.depth) || Number(options.depth) || .8), color: "#0077b6", points: e.points.map(toPlan) }; });
  const measurements = response.entities.filter(e => e.kind === "polyline" && e.points?.length === 2 && defaultCadRole(e.layer) === "measurement")
    .map(e => { const [a, b] = e.points.map(toPlan); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }; });

  // Land surfaces from hatches (AF-CAD-014)
  let landSurfaces;
  if (options.includeLand !== false) {
    const recLand = response.recognition?.land;
    const source = Array.isArray(recLand) && recLand.length ? recLand
      : response.entities.filter(e => e.kind === "hatch").map(e => ({ source_handle: e.handle, material: landMaterialFor(e.pattern, e.layer), loops: e.loops }))
        .filter(l => l.material);
    landSurfaces = [];
    source.forEach((l, i) => {
      const type = LAND_SURFACE_TYPES.some(t => t.key === l.material) ? l.material : "grass";
      const preset = LAND_SURFACE_TYPES.find(t => t.key === type);
      (l.loops || []).filter(loop => loop?.length >= 3).slice(0, 1).forEach(loop => landSurfaces.push({
        id: `cad-land-${l.source_handle || i}`, label: `${preset.label} (CAD)`, type, color: preset.color, elevation: 0.02, visible: true,
        points: dropClosingPoint(loop).map(toPlan), cadHandle: l.source_handle || null,
      }));
    });
  }

  const levels = previewBasins[0]?.levels || null;
  const underlay = options.includeUnderlay === false ? null : createCadUnderlay(response, { frame, filename: options.filename || response.filename });
  const allPoints = [...(boundary?.points || []), ...fixtures];
  const bounds = allPoints.length ? { minX: Math.min(...allPoints.map(p => p.x)), maxX: Math.max(...allPoints.map(p => p.x)),
    minY: Math.min(...allPoints.map(p => p.y)), maxY: Math.max(...allPoints.map(p => p.y)) } : null;
  return {
    source: "backend", frame, flipY: frame.flipY, units: CAD_CONTRACT_UNITS[response.units?.name] || response.units?.name || "meters",
    unitless: !!response.units?.unitless, suggestedUnits: CAD_CONTRACT_UNITS[response.units?.suggested] || null,
    candidates, outlines: candidates, boundary, islands, basins: previewBasins, fixtures, pipes, depthZones, measurements, landSurfaces, levels,
    reviewCandidates, groups, underlay, recognition: response.recognition || null, bounds, warnings: [...warnings],
    stats: response.stats || null,
  };
}

// ── Re-import diff (AF-CAD-017) ──────────────────────────────────────────────

/**
 * AquaFlow fixture type → recognition category (nozzle|light|pump|valve|laser|fire|mist|equipment).
 * The diff's proximity rule compares `type` exactly, so the previous design must be expressed
 * in the same vocabulary as the candidates (their effective review category).
 */
export function cadCategoryForFixtureType(type = "") {
  const t = String(type || "").toLowerCase();
  if (CAD_CANDIDATE_TYPES.includes(t)) return t;
  if (/^laser/.test(t)) return "laser";
  if (/^light|led|rgb/.test(t)) return "light";
  if (/mist|fog/.test(t)) return "mist";
  if (/flame|fire|fuel|burner/.test(t)) return "fire";
  if (/^nozzle|jet|geyser/.test(t)) return "nozzle";
  if (/valve/.test(t)) return "valve";
  if (/pump/.test(t)) return "pump";
  return "equipment";
}

/** Current project fixtures expressed in CAD WCS for POST /api/cad/diff. */
export function cadDiffPrevious(fixtures = [], frame) {
  return fixtures.map(f => {
    const p = planToCad({ x: f.x, y: f.y }, frame || {});
    return { id: String(f.id), type: cadCategoryForFixtureType(f.type), position: [p.x, p.y], aquaflow_id: String(f.id),
      ...(f.cadHandle ? { source_handle: String(f.cadHandle) } : {}) };
  });
}

/** Review candidates (non-ignored) in the diff request shape: id, effective type, CAD position, identity keys. */
export function cadDiffCandidates(preview) {
  return (preview?.reviewCandidates || []).filter(c => !c.excluded).map(c => ({
    id: c.id, type: c.effectiveType || c.type, position: c.position,
    aquaflow_id: c.aquaflow_id || null, source_handle: c.source_handle != null ? String(c.source_handle) : null,
  }));
}

/**
 * Local implementation of the diff contract (fallback when the backend is unreachable) —
 * the same rules and response shape as services/cad_import.py::diff_import:
 * aquaflow_id → source_handle → nearest same-type within `tolerance`; entries carry
 * candidate_id / match / source_handle / aquaflow_id (+ type_changed); `warnings` lists
 * duplicate AQUAFLOW ids, which are refused as identity keys.
 */
export function diffCadCandidates(previous = [], candidates = [], { tolerance = 0.05, movedEpsilon = 0.001 } = {}) {
  const prev = previous.filter(p => p && typeof p === "object");
  const cands = candidates.filter(c => c && typeof c === "object");
  const aid = item => { const a = item.aquaflow_id ?? item.xdata?.AQUAFLOW?.id; return a == null || a === "" ? null : String(a); };
  const cid = (c, i) => c.id || c.source_handle || `cand_${i}`;
  const pos = item => [Number(item.position?.[0]) || 0, Number(item.position?.[1]) || 0];
  const counts = new Map();
  cands.forEach(c => { const a = aid(c); if (a) counts.set(a, (counts.get(a) || 0) + 1); });
  const dup = [...counts].filter(([, n]) => n > 1).map(([a]) => a).sort();
  const warnings = dup.length ? [`Duplicate AQUAFLOW ids in the drawing were not used for matching: ${dup.join(", ")}`] : [];
  const byAid = new Map(), byHandle = new Map();
  cands.forEach((c, i) => {
    const a = aid(c);
    if (a && !dup.includes(a) && !byAid.has(a)) byAid.set(a, i);
    if (c.source_handle != null && !byHandle.has(String(c.source_handle))) byHandle.set(String(c.source_handle), i);
  });
  const taken = new Set(), matches = [];
  let rest = [];
  for (const p of prev) {
    const a = aid(p);
    if (a && byAid.has(a) && !taken.has(byAid.get(a))) { taken.add(byAid.get(a)); matches.push([p, byAid.get(a), "aquaflow_id"]); }
    else rest.push(p);
  }
  const rest2 = [];
  for (const p of rest) {
    const h = p.source_handle != null ? String(p.source_handle) : null;
    if (h != null && byHandle.has(h) && !taken.has(byHandle.get(h))) { taken.add(byHandle.get(h)); matches.push([p, byHandle.get(h), "source_handle"]); }
    else rest2.push(p);
  }
  rest = rest2;
  const pairs = [];
  rest.forEach((p, pi) => {
    const pp = pos(p);
    cands.forEach((c, i) => {
      if (taken.has(i) || (p.type && c.type && p.type !== c.type)) return;
      const cp = pos(c), d = Math.hypot(cp[0] - pp[0], cp[1] - pp[1]);
      if (d <= tolerance) pairs.push([d, pi, i]);
    });
  });
  pairs.sort((a, b) => a[0] - b[0]);
  const usedPrev = new Set();
  for (const [, pi, i] of pairs) {
    if (usedPrev.has(pi) || taken.has(i)) continue;
    usedPrev.add(pi); taken.add(i); matches.push([rest[pi], i, "proximity"]);
  }
  const removed = rest.filter((_, pi) => !usedPrev.has(pi));
  const moved = [], unchanged = [];
  for (const [p, i, how] of matches) {
    const c = cands[i], a = pos(p), b = pos(c), d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const entry = { id: p.id, candidate_id: cid(c, i), match: how, source_handle: c.source_handle ?? null, aquaflow_id: aid(c) || aid(p) };
    if (p.type && c.type && p.type !== c.type) entry.type_changed = { from: p.type, to: c.type };
    if (d > movedEpsilon) moved.push({ ...entry, from: a, to: b, distance_m: d });
    else unchanged.push(entry);
  }
  const added = cands.filter((_, i) => !taken.has(i));
  return { added, moved, removed, unchanged, warnings };
}

/** POST /api/cad/diff, falling back to the identical local rule set when the service is down. */
export async function requestCadDiff(previous, candidates, { signal, fetchImpl, proximity } = {}) {
  try {
    const body = { previous, candidates, ...(proximity ? { proximity_m: proximity } : {}) };
    const result = await cadFetch("/cad/diff", jsonPost(body, signal), fetchImpl);
    return { added: result.added || [], moved: result.moved || [], removed: result.removed || [], unchanged: result.unchanged || [],
      warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [], source: "backend" };
  } catch (error) {
    if (!error?.backendUnavailable) throw error;
    return { ...diffCadCandidates(previous, candidates, proximity ? { tolerance: proximity } : {}), source: "local" };
  }
}

// ── Pipe topology (AF-CAD-015) ───────────────────────────────────────────────

/** POST /api/cad/topology body from a backend preview: recognition pipes + non-ignored candidates (CAD metres). */
export function cadTopologyInput(preview, { tolerance = 0.05 } = {}) {
  const pipes = (preview?.recognition?.pipes || []).filter(p => Array.isArray(p?.points) && p.points.length >= 2);
  const candidates = (preview?.reviewCandidates || []).filter(c => !c.excluded).map(c => ({
    id: c.id, type: c.effectiveType || c.type, position: c.position, z: c.z ?? 0, fields: c.fields || {},
  }));
  return { pipes, candidates, tolerance_m: tolerance, pump_head_m: null, solve: false };
}

/** POST /api/cad/topology. Returns null when the CAD service is not reachable (the step is optional). */
export async function requestCadTopology(body, { signal, fetchImpl } = {}) {
  try {
    return await cadFetch("/cad/topology", jsonPost(body, signal), fetchImpl);
  } catch (error) {
    if (error?.backendUnavailable) return null;
    throw error;
  }
}

/**
 * Topology response → review groups: each proposed group plus the CAD handles of the pipes in
 * its network component (`pipe_handles`), `confirmed` as proposed (false). The dialog flips
 * `confirmed` per group; applyCadImport stores only confirmed ones.
 */
export function cadHydraulicGroups(topology) {
  if (!topology || !Array.isArray(topology.groups)) return [];
  const nodes = new Map((topology.nodes || []).map(n => [n.id, n]));
  // node.pump = the pump that feeds the node (multi-source Dijkstra); a link belongs to a
  // pump's group when both ends are fed by it.
  return topology.groups.map(g => {
    const handles = new Set();
    for (const l of topology.links || []) {
      if (l.source_handle != null && nodes.get(l.from)?.pump === g.pump && nodes.get(l.to)?.pump === g.pump) handles.add(String(l.source_handle));
    }
    return { ...g, pipe_handles: [...handles], confirmed: !!g.confirmed };
  });
}
