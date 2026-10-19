/**
 * alembic.js — streaming Alembic (.abc, Ogawa) writer for one animated polygon mesh: the
 * fountain water, a new mesh (positions, faces, optional per-vertex Cd colour) every frame.
 * Alembic is what D5 Render, 3ds Max, Maya, Cinema 4D, Houdini, Blender, Unreal (Geometry
 * Cache) and most renderers read for animated geometry.
 *
 * Layout follows the reference library (alembic/alembic lib/Alembic/Ogawa + AbcCoreOgawa):
 *   file    "Ogawa" · frozen 0xff · version 0,1 · uint64 root group position
 *   data    uint64 size · bytes                       (child ref = pos | 1<<63)
 *   group   uint64 n · n × uint64 child refs          (empty group = 0, empty data = 1<<63)
 *   root    [int32 0, int32 library version, top object, archive metadata, time samplings,
 *            indexed metadata]
 *   object  [properties compound, child objects…, child headers + 32 hash bytes]
 *   compound[child properties…, property headers]
 *   array   per sample [16-byte key + values, dimensions (empty for rank 1)]
 *   scalar  per sample [16-byte key + value]
 * Data blocks are appended as frames arrive; groups are written at the end (children
 * first), then the root position and the frozen byte are patched into the header.
 *
 * Objects: /<name> (identity Xform) → /<name>/<name>Shape (PolyMesh), Y-up, metres,
 * Alembic (clockwise) winding.
 */

const DATA_BIT = 0x8000000000000000n;
const LIB_VERSION = 10709;
const POD = { bool: 0, uint8: 1, int32: 6, float32: 10, float64: 11 };

/** A unique 16-byte key per stored sample (the library hashes the data; uniqueness is what readers rely on). */
function keyMaker() {
  const session = new Uint32Array(2);
  for (let i = 0; i < 2; i++) session[i] = (Math.random() * 0x100000000) >>> 0;
  let n = 0;
  return () => {
    const k = new Uint8Array(16);
    const dv = new DataView(k.buffer);
    dv.setUint32(0, session[0], true); dv.setUint32(4, session[1], true);
    dv.setUint32(8, ++n, true); dv.setUint32(12, (n * 2654435761) >>> 0, true);
    return k;
  };
}

const enc = new TextEncoder();
const u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0, true); return b; };
const concat = (parts) => {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const bytesOf = (typed) => new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);

/** MetaData::serialize — keys sorted, "k=v;k=v". */
export function serializeMeta(obj = {}) {
  return Object.keys(obj).sort().map((k) => `${k}=${obj[k]}`).join(";");
}

/** pushUint32WithHint: hint 0 → 1 byte, 1 → 2 bytes, 2 → 4 bytes. */
function hinted(v, hint) {
  const b = u32(v);
  return hint === 0 ? b.subarray(0, 1) : hint === 1 ? b.subarray(0, 2) : b;
}

/**
 * @param {object} sink  { append(bytes) → Promise, patch(offset, bytes) → Promise }
 * @param {object} opts  { fps, startTime (s of the first frame), name, application, color }
 */
export async function createAlembicMeshWriter(sink, { fps = 30, startTime = 1 / 30, name = "Fountain_Water",
  application = "AquaFlow Studio", color = false } = {}) {
  let pos = 0;
  const key = keyMaker();
  const write = async (bytes) => { await sink.append(bytes); pos += bytes.length; };
  /** Store a data block; returns its child reference. */
  const data = async (bytes) => {
    if (!bytes.length) return DATA_BIT;
    const at = pos;
    const size = new Uint8Array(8);
    new DataView(size.buffer).setBigUint64(0, BigInt(bytes.length), true);
    await write(size);
    await write(bytes);
    return BigInt(at) | DATA_BIT;
  };
  /** Store a group from child refs; returns its reference (0 for an empty group). */
  const group = async (children) => {
    if (!children.length) return 0n;
    const at = pos;
    const b = new Uint8Array(8 + children.length * 8);
    const dv = new DataView(b.buffer);
    dv.setBigUint64(0, BigInt(children.length), true);
    children.forEach((c, i) => dv.setBigUint64(8 + i * 8, c, true));
    await write(b);
    return BigInt(at);
  };

  // Header: magic, frozen byte (0 until finished), format version 1, root position (patched).
  await write(new Uint8Array([0x4f, 0x67, 0x61, 0x77, 0x61, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]));

  const shapeName = `${name}Shape`;
  const props = {
    P: { refs: [], array: true, pod: POD.float32, extent: 3, meta: { geoScope: "vtx", interpretation: "point" }, counts: [] },
    ".selfBnds": { refs: [], array: false, pod: POD.float64, extent: 6, meta: { interpretation: "box" }, counts: [] },
    ".faceIndices": { refs: [], array: true, pod: POD.int32, extent: 1, meta: {}, counts: [] },
    ".faceCounts": { refs: [], array: true, pod: POD.int32, extent: 1, meta: {}, counts: [] },
  };
  const cd = color ? { refs: [], array: true, pod: POD.float32, extent: 3, meta: { geoScope: "vtx", interpretation: "rgb" }, counts: [] } : null;
  let samples = 0;
  let inheritsRef = null;

  const arraySample = async (p, typed, count) => {
    p.refs.push(await data(concat([key(), bytesOf(typed)])));
    p.refs.push(DATA_BIT);                 // rank-1 dimensions are implied by the data size
    p.counts.push(count);
  };

  return {
    /** One frame: positions (Float32Array xyz), triangle indices (Int32Array), optional colours (Float32Array rgb). */
    async addFrame({ positions, indices, colors = null }) {
      if (!inheritsRef) inheritsRef = await data(concat([key(), new Uint8Array([1])]));
      const nv = positions.length / 3, nf = indices.length / 3;
      // Alembic polygons wind clockwise: reverse each triangle.
      const faces = new Int32Array(indices.length);
      for (let f = 0; f < nf; f++) {
        faces[f * 3] = indices[f * 3]; faces[f * 3 + 1] = indices[f * 3 + 2]; faces[f * 3 + 2] = indices[f * 3 + 1];
      }
      const counts = new Int32Array(nf).fill(3);
      let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < nv; i++) {
        for (let a = 0; a < 3; a++) {
          const v = positions[i * 3 + a];
          if (v < min[a]) min[a] = v;
          if (v > max[a]) max[a] = v;
        }
      }
      if (!nv) { min = [0, 0, 0]; max = [0, 0, 0]; }
      await arraySample(props.P, positions, nv);
      const box = new Float64Array([...min, ...max]);
      props[".selfBnds"].refs.push(await data(concat([key(), bytesOf(box)])));
      props[".selfBnds"].counts.push(1);
      await arraySample(props[".faceIndices"], faces, faces.length);
      await arraySample(props[".faceCounts"], counts, nf);
      if (cd) await arraySample(cd, colors && colors.length === positions.length ? colors : new Float32Array(positions.length), nv);
      samples++;
    },

    get samples() { return samples; },

    async finish() {
      if (!samples) throw new Error("Alembic: no frames written.");
      if (!inheritsRef) inheritsRef = await data(concat([key(), new Uint8Array([1])]));
      const indexed = [];
      const metaIndex = (m) => {
        if (!m) return 0;
        if (m.length < 256) {
          let i = indexed.indexOf(m);
          if (i < 0 && indexed.length < 254) { indexed.push(m); i = indexed.length - 1; }
          if (i >= 0) return i + 1;
        }
        return 0xff;
      };
      /** WritePropertyInfo for one property header. */
      const propHeader = (pname, p, tsIndex) => {
        const meta = serializeMeta(p.meta);
        const n = p.compound ? 0 : p.counts.length;
        const maxSize = Math.max(meta.length, pname.length, n, tsIndex);
        const hint = maxSize > 255 && maxSize < 65536 ? 1 : maxSize >= 65536 ? 2 : 0;
        const mi = metaIndex(meta);
        let info = (0x000c & (hint << 2)) | (0xff00000 & (mi << 20));
        const parts = [];
        if (p.compound) {
          parts.push(u32(info >>> 0));
        } else {
          const homogenous = p.counts.every((c) => c === p.counts[0]);
          const scalarLike = p.counts.every((c) => c === 1);
          info |= 0x0003 & (p.array ? 2 : 1);
          info |= scalarLike ? 1 : 0;
          info |= 0x00f0 & (p.pod << 4);
          if (tsIndex !== 0) info |= 0x0100;
          // Every sample is stored: first changed = 1, last = n − 1 (one sample: "all the same").
          const first = n > 1 ? 1 : 0, last = n > 1 ? n - 1 : 0;
          if (first === 0 && last === 0) info |= 0x800;
          info |= 0xff000 & (p.extent << 12);
          if (homogenous) info |= 0x400;
          parts.push(u32(info >>> 0), hinted(n, hint));
          if (tsIndex !== 0) parts.push(hinted(tsIndex, hint));
        }
        parts.push(hinted(pname.length, hint), enc.encode(pname));
        if (mi === 0xff) { parts.push(hinted(meta.length, hint)); if (meta.length) parts.push(enc.encode(meta)); }
        return concat(parts);
      };
      const compound = async (children) => {
        const refs = [], headers = [];
        for (const [pname, p, ts] of children) {
          refs.push(p.compound ? await compound(p.children) : await group(p.refs));
          headers.push(propHeader(pname, p, ts));
        }
        if (headers.length) refs.push(await data(concat(headers)));
        return group(refs);
      };
      const objectHeaders = (children) => {
        const parts = [];
        for (const [oname, meta] of children) {
          const m = serializeMeta(meta);
          const mi = metaIndex(m);
          parts.push(u32(oname.length), enc.encode(oname), new Uint8Array([mi]));
          if (mi === 0xff) parts.push(u32(m.length), enc.encode(m));
        }
        parts.push(new Uint8Array(32));                    // data + children hashes
        return concat(parts);
      };

      // Mesh shape: .geom { P, .selfBnds, .faceIndices, .faceCounts, .arbGeomParams { Cd } }.
      const geomChildren = [["P", props.P, 1], [".selfBnds", props[".selfBnds"], 1],
        [".faceIndices", props[".faceIndices"], 1], [".faceCounts", props[".faceCounts"], 1]];
      if (cd) geomChildren.push([".arbGeomParams", { compound: true, meta: {}, children: [["Cd", cd, 1]] }, 0]);
      const shapeProps = await compound([[".geom", { compound: true,
        meta: { schema: "AbcGeom_PolyMesh_v1", schemaBaseType: "AbcGeom_GeomBase_v1" }, children: geomChildren }, 0]]);
      const shapeObj = await group([shapeProps, await data(objectHeaders([]))]);
      // Identity Xform parent: .xform { .inherits = true }.
      const inherits = { refs: [inheritsRef], array: false, pod: POD.bool, extent: 1, meta: {}, counts: [1] };
      const xformProps = await compound([[".xform", { compound: true, meta: { schema: "AbcGeom_Xform_v3" },
        children: [[".inherits", inherits, 0]] }, 0]]);
      const meshMeta = { schema: "AbcGeom_PolyMesh_v1", schemaBaseType: "AbcGeom_GeomBase_v1", schemaObjTitle: "AbcGeom_PolyMesh_v1:.geom" };
      const xformObj = await group([xformProps, shapeObj, await data(objectHeaders([[shapeName, meshMeta]]))]);
      const xformMeta = { schema: "AbcGeom_Xform_v3", schemaObjTitle: "AbcGeom_Xform_v3:.xform" };
      const top = await group([0n, xformObj, await data(objectHeaders([[name, xformMeta]]))]);

      const archiveMeta = serializeMeta({ _ai_AlembicVersion: "Alembic 1.7.9 (AquaFlow Studio writer)",
        _ai_Application: application.replace(/[;=]/g, " "), _ai_DCC_FPS: String(fps),
        _ai_DateWritten: new Date().toUTCString().replace(/[;=]/g, " ") });
      // Time samplings: 0 = identity (1 sample), 1 = uniform at the frame rate.
      const ts = new Uint8Array(2 * (4 + 8 + 4 + 8));
      const tv = new DataView(ts.buffer);
      tv.setUint32(0, 1, true); tv.setFloat64(4, 1.0, true); tv.setUint32(12, 1, true); tv.setFloat64(16, 0.0, true);
      tv.setUint32(24, samples, true); tv.setFloat64(28, 1 / fps, true); tv.setUint32(36, 1, true); tv.setFloat64(40, startTime, true);
      const version = new Uint8Array(4);
      const lib = u32(LIB_VERSION);
      const rootChildren = [await data(version), await data(lib), top, await data(enc.encode(archiveMeta)), await data(ts)];
      const im = indexed.length ? concat(indexed.flatMap((m) => [new Uint8Array([m.length]), enc.encode(m)])) : new Uint8Array(0);
      rootChildren.push(await data(im));
      const root = await group(rootChildren);
      const head = new Uint8Array(8);
      new DataView(head.buffer).setBigUint64(0, root, true);
      await sink.patch(8, head);
      await sink.patch(5, new Uint8Array([0xff]));
      return { bytes: pos, samples };
    },
  };
}
