/**
 * fbx.js — AquaFlow 3D Export Bridge · binary FBX 7.4 writer
 *
 * Binary FBX is the variant every FBX importer reads (Blender reads only binary;
 * Autodesk 3ds Max / Maya / AutoCAD, Unity, Unreal, SketchUp, Cinema 4D, Twinmotion and
 * Lumion read both). The layout follows the FBX 7.4 binary encoding (as written by the
 * Autodesk SDK and Blender's exporter):
 *
 *   header "Kaydara FBX Binary  \0\x1a\0" + uint32 version
 *   node record: uint32 endOffset, uint32 propertyCount, uint32 propertyBytes,
 *                uint8 nameLength, name, properties, children, [13-byte null record]
 *   property:    type code + payload (C bool, I int32, L int64, D double, S/R string/raw,
 *                i/d arrays: uint32 count, uint32 encoding 0, uint32 byteLength, data)
 *   footer:      null record, footer id, padding to 16, version, 120 zeros, magic
 *
 * Scene: Y up, metres (UnitScaleFactor 100 = 100 cm per unit). One Geometry + Model per
 * mesh node, materials shared by name, all wired in Connections ("OO").
 */

const MAGIC = "Kaydara FBX Binary  \u0000\u001a\u0000";
const VERSION = 7400;
// Fixed file id / creation time / footer id, as written by Blender's exporter (accepted by the SDK).
const FILE_ID = [0x28, 0xb3, 0x2a, 0xeb, 0xb6, 0x24, 0xcc, 0xc2, 0xbf, 0xc8, 0xb0, 0x2a, 0xa9, 0x2b, 0xfc, 0xf1];
const FOOT_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOT_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];
const CREATION_TIME = "1970-01-01 10:00:00:000";

// ── typed property values ────────────────────────────────────────────────────
const I = (v) => ({ t: "I", v }), L = (v) => ({ t: "L", v }), D = (v) => ({ t: "D", v }), C = (v) => ({ t: "C", v });
const S = (v) => ({ t: "S", v: String(v) }), R = (bytes) => ({ t: "R", v: bytes });
const Ai = (v) => ({ t: "i", v }), Ad = (v) => ({ t: "d", v });
const node = (name, props = [], children = []) => ({ name, props, children });
/** "Name\x00\x01Class" — the binary form of "Class::Name". */
const objName = (name, cls) => `${name}\u0000\u0001${cls}`;
/** A Properties70 entry. */
const P = (name, type, label, flags, ...values) => node("P", [S(name), S(type), S(label), S(flags), ...values]);

// ── encoder ──────────────────────────────────────────────────────────────────
class Writer {
  constructor() { this.buf = new Uint8Array(1 << 20); this.view = new DataView(this.buf.buffer); this.len = 0; }
  ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next; this.view = new DataView(next.buffer);
  }
  u8(v) { this.ensure(1); this.view.setUint8(this.len, v); this.len += 1; }
  u32(v) { this.ensure(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; }
  i32(v) { this.ensure(4); this.view.setInt32(this.len, v | 0, true); this.len += 4; }
  i64(v) { this.ensure(8); this.view.setBigInt64(this.len, BigInt(v), true); this.len += 8; }
  f64(v) { this.ensure(8); this.view.setFloat64(this.len, +v, true); this.len += 8; }
  bytes(arr) { this.ensure(arr.length); this.buf.set(arr, this.len); this.len += arr.length; }
  at(pos, v) { this.view.setUint32(pos, v >>> 0, true); }
}
const utf8 = (s) => new TextEncoder().encode(s);

function writeProp(w, p) {
  switch (p.t) {
    case "C": w.u8(0x43); w.u8(p.v ? 1 : 0); break;
    case "I": w.u8(0x49); w.i32(p.v); break;
    case "L": w.u8(0x4c); w.i64(p.v); break;
    case "D": w.u8(0x44); w.f64(p.v); break;
    case "S": { const b = utf8(p.v); w.u8(0x53); w.u32(b.length); w.bytes(b); break; }
    case "R": w.u8(0x52); w.u32(p.v.length); w.bytes(p.v); break;
    case "i": w.u8(0x69); w.u32(p.v.length); w.u32(0); w.u32(p.v.length * 4); for (const x of p.v) w.i32(x); break;
    case "d": w.u8(0x64); w.u32(p.v.length); w.u32(0); w.u32(p.v.length * 8); for (const x of p.v) w.f64(x); break;
    default: throw new Error(`FBX: unknown property type ${p.t}`);
  }
}

function writeNode(w, n) {
  const start = w.len;
  w.u32(0); w.u32(n.props.length); w.u32(0);
  const name = utf8(n.name);
  w.u8(name.length); w.bytes(name);
  const propStart = w.len;
  for (const p of n.props) writeProp(w, p);
  const propBytes = w.len - propStart;
  for (const c of n.children) writeNode(w, c);
  // A node with children (or with no properties) ends with a null record.
  if (n.children.length || !n.props.length) for (let i = 0; i < 13; i++) w.u8(0);
  w.at(start, w.len); w.at(start + 8, propBytes);
}

export function encodeFBX(roots) {
  const w = new Writer();
  w.bytes(utf8(MAGIC)); w.u32(VERSION);
  for (const r of roots) writeNode(w, r);
  for (let i = 0; i < 13; i++) w.u8(0);
  w.bytes(FOOT_ID);
  for (let i = 0; i < 4; i++) w.u8(0);
  let pad = ((w.len + 15) & ~15) - w.len;
  if (pad === 0) pad = 16;
  for (let i = 0; i < pad; i++) w.u8(0);
  w.u32(VERSION);
  for (let i = 0; i < 120; i++) w.u8(0);
  w.bytes(FOOT_MAGIC);
  return w.buf.slice(0, w.len);
}

// ── scene → FBX nodes ────────────────────────────────────────────────────────
const clean = (s) => String(s || "node").replace(/[\u0000-\u001f]/g, "_");

function headerNodes(graph) {
  const now = new Date();
  const creator = graph.meta?.generator || "AquaFlow Studio";
  return [
    node("FBXHeaderExtension", [], [
      node("FBXHeaderVersion", [I(1003)]),
      node("FBXVersion", [I(VERSION)]),
      node("EncryptionType", [I(0)]),
      node("CreationTimeStamp", [], [
        node("Version", [I(1000)]), node("Year", [I(now.getUTCFullYear())]), node("Month", [I(now.getUTCMonth() + 1)]),
        node("Day", [I(now.getUTCDate())]), node("Hour", [I(now.getUTCHours())]), node("Minute", [I(now.getUTCMinutes())]),
        node("Second", [I(now.getUTCSeconds())]), node("Millisecond", [I(0)]),
      ]),
      node("Creator", [S(creator)]),
    ]),
    node("FileId", [R(new Uint8Array(FILE_ID))]),
    node("CreationTime", [S(CREATION_TIME)]),
    node("Creator", [S(creator)]),
    node("GlobalSettings", [], [
      node("Version", [I(1000)]),
      node("Properties70", [], [
        P("UpAxis", "int", "Integer", "", I(1)), P("UpAxisSign", "int", "Integer", "", I(1)),
        P("FrontAxis", "int", "Integer", "", I(2)), P("FrontAxisSign", "int", "Integer", "", I(1)),
        P("CoordAxis", "int", "Integer", "", I(0)), P("CoordAxisSign", "int", "Integer", "", I(1)),
        P("OriginalUpAxis", "int", "Integer", "", I(1)), P("OriginalUpAxisSign", "int", "Integer", "", I(1)),
        P("UnitScaleFactor", "double", "Number", "", D(100)), P("OriginalUnitScaleFactor", "double", "Number", "", D(100)),
        P("AmbientColor", "ColorRGB", "Color", "", D(0), D(0), D(0)),
        P("DefaultCamera", "KString", "", "", S("Producer Perspective")),
        P("TimeMode", "enum", "", "", I(11)),
        P("TimeSpanStart", "KTime", "Time", "", L(0)), P("TimeSpanStop", "KTime", "Time", "", L(46186158000)),
        P("CustomFrameRate", "double", "Number", "", D(-1)),
      ]),
    ]),
  ];
}

function geometryNode(id, n) {
  const pos = n.mesh.positions, nrm = n.mesh.normals, idx = n.mesh.indices;
  const pvi = new Array(idx.length);
  const normals = new Array(idx.length * 3);
  for (let i = 0; i < idx.length; i += 3) {
    pvi[i] = idx[i]; pvi[i + 1] = idx[i + 1]; pvi[i + 2] = -(idx[i + 2] + 1); // last corner bit-inverted
    for (let k = 0; k < 3; k++) {
      const v = idx[i + k];
      normals[(i + k) * 3] = nrm[v * 3]; normals[(i + k) * 3 + 1] = nrm[v * 3 + 1]; normals[(i + k) * 3 + 2] = nrm[v * 3 + 2];
    }
  }
  return node("Geometry", [L(id), S(objName(clean(n.name), "Geometry")), S("Mesh")], [
    node("Properties70"),
    node("GeometryVersion", [I(124)]),
    node("Vertices", [Ad(Array.from(pos))]),
    node("PolygonVertexIndex", [Ai(pvi)]),
    node("LayerElementNormal", [I(0)], [
      node("Version", [I(101)]), node("Name", [S("")]),
      node("MappingInformationType", [S("ByPolygonVertex")]), node("ReferenceInformationType", [S("Direct")]),
      node("Normals", [Ad(normals)]),
    ]),
    node("LayerElementMaterial", [I(0)], [
      node("Version", [I(101)]), node("Name", [S("")]),
      node("MappingInformationType", [S("AllSame")]), node("ReferenceInformationType", [S("IndexToDirect")]),
      node("Materials", [Ai([0])]),
    ]),
    node("Layer", [I(0)], [
      node("Version", [I(100)]),
      node("LayerElement", [], [node("Type", [S("LayerElementNormal")]), node("TypedIndex", [I(0)])]),
      node("LayerElement", [], [node("Type", [S("LayerElementMaterial")]), node("TypedIndex", [I(0)])]),
    ]),
  ]);
}

function modelNode(id, n) {
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  return node("Model", [L(id), S(objName(clean(n.name), "Model")), S("Mesh")], [
    node("Version", [I(232)]),
    node("Properties70", [], [
      P("Lcl Translation", "Lcl Translation", "", "A", D(tx), D(ty), D(tz)),
      P("Lcl Rotation", "Lcl Rotation", "", "A", D(0), D(n.rotationY || 0), D(0)),
      P("Lcl Scaling", "Lcl Scaling", "", "A", D(sx), D(sy), D(sz)),
      P("DefaultAttributeIndex", "int", "Integer", "", I(0)),
      P("InheritType", "enum", "", "", I(1)),
    ]),
    node("MultiLayer", [I(0)]), node("MultiTake", [I(0)]),
    node("Shading", [C(true)]), node("Culling", [S("CullingOff")]),
  ]);
}

function materialNode(id, m) {
  const [r, g, b, a = 1] = m.baseColor || [0.8, 0.8, 0.8, 1];
  const [er, eg, eb] = m.emissive || [0, 0, 0];
  const shininess = (1 - (m.roughness ?? 0.8)) * 100;
  return node("Material", [L(id), S(objName(clean(m.name), "Material")), S("")], [
    node("Version", [I(102)]),
    node("ShadingModel", [S("phong")]),
    node("MultiLayer", [I(0)]),
    node("Properties70", [], [
      P("DiffuseColor", "Color", "", "A", D(r), D(g), D(b)),
      P("DiffuseFactor", "Number", "", "A", D(1)),
      P("EmissiveColor", "Color", "", "A", D(er), D(eg), D(eb)),
      P("EmissiveFactor", "Number", "", "A", D(er || eg || eb ? 1 : 0)),
      P("SpecularColor", "Color", "", "A", D(0.5), D(0.5), D(0.5)),
      P("SpecularFactor", "Number", "", "A", D(m.metallic ? 1 : 0.3)),
      P("Shininess", "double", "Number", "", D(shininess)),
      P("ShininessExponent", "Number", "", "A", D(shininess)),
      P("TransparencyFactor", "Number", "", "A", D(1 - a)),
      P("Opacity", "Number", "", "A", D(a)),
      P("Diffuse", "Vector3D", "Vector", "", D(r), D(g), D(b)),
      P("Emissive", "Vector3D", "Vector", "", D(er), D(eg), D(eb)),
    ]),
  ]);
}

/** Binary FBX 7.4 of the export scene graph (Uint8Array). */
export function toFBX(graph) {
  const meshNodes = (graph.nodes || []).filter((n) => n.mesh && n.mesh.indices.length);
  let next = 1000000;
  const id = () => ++next;
  const objects = [], links = [];
  const materials = new Map(); // name → id (materials are shared between nodes)
  for (const n of meshNodes) {
    const g = id(), mdl = id();
    objects.push(geometryNode(g, n), modelNode(mdl, n));
    links.push(node("C", [S("OO"), L(mdl), L(0)]), node("C", [S("OO"), L(g), L(mdl)]));
    if (n.material) {
      let mat = materials.get(n.material.name);
      if (!mat) { mat = id(); materials.set(n.material.name, mat); objects.push(materialNode(mat, n.material)); }
      links.push(node("C", [S("OO"), L(mat), L(mdl)]));
    }
  }
  const type = (t, count) => node("ObjectType", [S(t)], [node("Count", [I(count)])]);
  const roots = [
    ...headerNodes(graph),
    node("Documents", [], [
      node("Count", [I(1)]),
      node("Document", [L(id()), S("Scene"), S("Scene")], [
        node("Properties70", [], [P("SourceObject", "object", "", ""), P("ActiveAnimStackName", "KString", "", "", S(""))]),
        node("RootNode", [L(0)]),
      ]),
    ]),
    node("References"),
    node("Definitions", [], [
      node("Version", [I(100)]),
      node("Count", [I(1 + meshNodes.length * 2 + materials.size)]),
      type("GlobalSettings", 1), type("Model", meshNodes.length), type("Geometry", meshNodes.length), type("Material", materials.size),
    ]),
    node("Objects", [], objects),
    node("Connections", [], links),
    node("Takes", [], [node("Current", [S("")])]),
  ];
  return encodeFBX(roots);
}

/** @deprecated ASCII FBX is not read by Blender and many tools; kept as an alias of toFBX. */
export const toFBXASCII = toFBX;
