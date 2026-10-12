import DxfParser from "dxf-parser";
import { CAD_DXF_HEADER, CAD_DXF_FOOTER, CAD_MODEL_SPACE_HANDLE } from "./cadDxfTemplate";
import { createDefaultEngineeringProject } from "./engineeringProject";
import { geometryForPoolType, polygonArea } from "./poolGeometry";
import { getDefaultEngineering, FIXTURE_LIBRARY } from "../data/fixtureLibrary";
import { resolveFixtureGroup } from "../hooks/fixtureTypeMap";

export const CAD_MAX_BYTES = 10 * 1024 * 1024;
export const CAD_UNITS = {
  meters: { code: 6, scale: 1, label: "Meters" },
  millimeters: { code: 4, scale: 0.001, label: "Millimeters" },
  centimeters: { code: 5, scale: 0.01, label: "Centimeters" },
  inches: { code: 1, scale: 0.0254, label: "Inches" },
  feet: { code: 2, scale: 0.3048, label: "Feet" },
};
export const CAD_ROLES = ["ignore", "pool", "nozzle", "light", "equipment", "pipe", "depth", "measurement"];
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
          || !["pool","fixture","label","pipe","depth"].includes(decoded.kind)) return;
        const meta = {kind:decoded.kind};
        for (const key of ["id","type","label","fixtureId","pipeType","zone"])
          if (typeof decoded[key] === "string" && decoded[key].length <= 4096) meta[key] = decoded[key];
        for (const key of ["rotation","depth","diameterMm"])
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
  const scale = CAD_UNITS[units].scale, flipY = options.flipY !== false;
  const convert = p => ({ x: finite(p.x*scale), y: finite(p.y*scale*(flipY ? -1 : 1)) });
  const roles = options.roles || parsed.roles;
  const warnings = new Set();
  const flat = flatten(parsed, roles, warnings);
  // Parser silently skips some entity types; report those directly from the source.
  const supported = new Set(["LINE", "LWPOLYLINE", "POLYLINE", "VERTEX", "SEQEND", "CIRCLE", "ARC", "ELLIPSE", "POINT", "TEXT", "MTEXT", "INSERT", "ATTRIB"]);
  for (const e of parsed.rawEntities || []) if (!supported.has(e.type) && roles[e.tags.get(8) || "0"] && roles[e.tags.get(8) || "0"] !== "ignore") warnings.add(`Unsupported ${e.type} entities were skipped.`);
  const candidates = closedPaths(flat.filter(e => e.role === "pool"), warnings).map(e => {
    const native = e.native ? { ...e.native, center: convert(e.native.center),
      ...(e.native.radius ? { radius: e.native.radius*scale } : { rx: e.native.rx*scale, ry: e.native.ry*scale }) } : null;
    const points = e.points.map(convert);
    return { id: e.key, layer: e.layer, geometry: native || { type: "freeform", points, closed: true }, points,
      area: polygonArea(points), meta: e.meta };
  }).sort((a,b) => b.area-a.area);
  const selected = options.boundaryId ? candidates.find(e => e.id === options.boundaryId) : (candidates.length === 1 ? candidates[0] : null);
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
      ...pos, rotation: e.rotation*180/Math.PI*(flipY ? -1 : 1), cadLayer: e.layer, hasIdentity: e.meta?.kind === "fixture" });
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
  return { candidates, boundary: selected, fixtures, pipes, depthZones, measurements, bounds, warnings: [...warnings], units, flipY };
}

export function applyCadImport(current, preview, options = {}) {
  const updateExisting = options.mode === "update";
  if (!preview.boundary) throw new Error("Choose one closed pool boundary before applying the drawing.");
  const base = updateExisting ? structuredClone(current) : createDefaultEngineeringProject();
  const geometry = structuredClone(preview.boundary.geometry);
  const xs = preview.boundary.points.map(p => p.x), ys = preview.boundary.points.map(p => p.y);
  const matches = new Map((current.fixtures || []).map(f => [String(f.id), f]));
  const importedIds = new Set();
  const imported = preview.fixtures.map(f => {
    const old = updateExisting && f.hasIdentity ? matches.get(f.id) : null;
    const type = old?.type || f.type;
    if (!old && !knownTypes.has(type)) throw new Error(`Choose a valid AquaFlow fixture type for ${f.cadLayer}.`);
    importedIds.add(f.id);
    return { ...(old ? structuredClone(old) : { id: updateExisting ? `import-${f.id}` : f.id,
      type, groupId: resolveFixtureGroup(type), zone: "medium", z: 0,
      engineering: { ...getDefaultEngineering(type), plcChannel: null, group: "", icanGroup: null, icanChannel: null, mappingStatus: "commissioning-required" } }),
      x: f.x, y: f.y, rotation: f.rotation, label: String(f.label), cadLayer: f.cadLayer };
  });
  // Updating a site never deletes hardware records that were omitted from a CAD drawing.
  base.fixtures = updateExisting ? [...(current.fixtures || []).filter(f => !importedIds.has(String(f.id))), ...imported] : imported;
  if (new Set(base.fixtures.map(f => f.id)).size !== base.fixtures.length) throw new Error("Imported fixture identities conflict with this project.");
  base.geometry = geometry;
  base.pool_type = geometry.type === "circle" ? "circular" : geometry.type === "ellipse" ? "elliptical" : "freeform";
  const depth = Number(options.depth ?? preview.boundary.meta?.depth ?? base.params.depth);
  if (!Number.isFinite(depth) || depth < .05 || depth > 100) throw new Error("Enter a pool depth between 0.05 and 100 meters.");
  base.params = { ...base.params, width: Math.max(.1, Math.max(...xs)-Math.min(...xs)), length: Math.max(.1, Math.max(...ys)-Math.min(...ys)),
    depth, ...(geometry.radius ? { radius: geometry.radius } : {}) };
  base.name = options.name?.trim() || (updateExisting ? current.name : "Imported CAD design");
  base.id = updateExisting ? current.id : null;
  base.manualPipes = preview.pipes; base.pipes = preview.pipes;
  base.depth_zones = preview.depthZones; base.measurements = preview.measurements;
  base.solved_hydraulics = null; base.hydraulics = null; base.bom = [];
  return base;
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
  const line = (a,b,layer,meta) => entity("LINE",layer,"AcDbLine",[10,number(a.x),20,number(-a.y),30,0,11,number(b.x),21,number(-b.y),31,0],meta);
  const poly = (pts,layer,closed,meta) => entity("LWPOLYLINE",layer,"AcDbPolyline",[90,pts.length,70,closed ? 1 : 0,
    ...pts.flatMap(p => [10,number(p.x),20,number(-p.y)])],meta);
  const circle = (center,radius,layer,meta) => entity("CIRCLE",layer,"AcDbCircle",[10,number(center.x),20,number(-center.y),30,0,40,number(radius)],meta);
  const label = (pos,text,layer="ANNOTATIONS",meta) => entity("TEXT",layer,"AcDbText",[10,number(pos.x),20,number(-pos.y),30,0,40,.18,1,textValue(text),50,0,7,"STANDARD",100,"AcDbText",73,0],meta);
  const g = project.geometry || geometryForPoolType(project.pool_type || project.poolType,project.params);
  const poolMeta = { kind: "pool", depth: project.params?.depth ?? .8 };
  if (g.type === "circle") circle(g.center,g.radius,"POOL_OUTLINE",poolMeta);
  else if (g.type === "ellipse") {
    const vertical = g.ry > g.rx;
    entity("ELLIPSE","POOL_OUTLINE","AcDbEllipse",[10,number(g.center.x),20,number(-g.center.y),30,0,
      11,vertical ? 0 : number(g.rx),21,vertical ? number(-g.ry) : 0,31,0,40,Math.min(g.rx,g.ry)/Math.max(g.rx,g.ry),41,0,42,2*Math.PI],poolMeta);
  } else if (g.points?.length >= 3) poly(g.points,"POOL_OUTLINE",g.closed !== false,poolMeta);
  else throw new Error("Draw a valid pool outline before exporting.");
  const ids = new Set();
  (project.fixtures || []).forEach((f,i) => {
    const id = String(f.id || "");
    if (!id || ids.has(id)) throw new Error("Every exported fixture needs a unique AquaFlow ID.");
    ids.add(id);
    const layer = /^(light|laser)/.test(f.type) ? "LIGHTS" : /^nozzle/.test(f.type) ? "NOZZLES" : "EQUIPMENT";
    circle(f,.12,layer,{ kind: "fixture", id, type: f.type, label: f.label || `${f.type}-${i+1}`, rotation: Number(f.rotation || 0) });
    label({ x: finite(f.x)+.18, y: finite(f.y)-.18 },f.label || id,"ANNOTATIONS",{kind:"label",fixtureId:id});
  });
  (project.manualPipes?.length ? project.manualPipes : project.pipes || []).forEach((p,i) => {
    if (p.points?.length >= 2) poly(p.points,"PIPEWORK",false,{ kind: "pipe", id: p.id || `pipe-${i}`, label: p.label, diameterMm: p.diameterMm, pipeType: p.pipeType });
  });
  (project.depth_zones || []).forEach(z => { if (z.points?.length >= 3) poly(z.points,"DEPTH_ZONES",true,{ kind: "depth", id: z.id, zone: z.zone, label: z.label, depth: z.depth }); });
  (project.measurements || []).forEach(m => line({x:m.x1,y:m.y1},{x:m.x2,y:m.y2},"MEASUREMENTS"));
  label({ x: 0, y: -1 },project.name || "AquaFlow fountain design");
  return CAD_DXF_HEADER.replace(/(\$HANDSEED\n5\n)[a-f\d]+/i,"$1FFFFFF")
    + out.join("\n")+"\n" + CAD_DXF_FOOTER;
}
