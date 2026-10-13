/**
 * assetManifest.js — AF-NEXT-006 project dependency manifest (pure; no store imports).
 *
 * Data contract (stored as `assetManifest` in the .aqua envelope; optional — legacy files
 * without it load unchanged):
 *
 *   {
 *     format: "aquaflow-asset-manifest", version: 1, generatedAt: ISO,
 *     projectPath: absolute path at save time (informational) | null,
 *     assets: [{
 *       id:           stable key, e.g. "audio:programmer", "model:custom:<uuid>", "cad_underlay"
 *       role:         "audio" | "model" | "texture" | "site_model" | "cad_underlay"
 *       source:       "file"     — a file on disk (path / relativePath)
 *                     "library"  — an imported GLB held in this PC's model library (IndexedDB)
 *                     "embedded" — data stored inside the project itself (CAD underlay)
 *       name, type,   original file name / MIME type
 *       path:         absolute path at save time | null (browser builds cannot see paths)
 *       relativePath: path relative to the project file (preferred when resolving) | null
 *       size, sha256: byte size and hex SHA-256 | null when the bytes were unavailable
 *       locator:      role-specific id (e.g. { assetId }) used to re-attach the asset
 *       packaged:     ZIP member name inside an .aquapkg, when embedded
 *     }]
 *   }
 *
 * Reuses the engineering-package / .luxshow pattern (a manifest listing each member's
 * size and SHA-256), but with the full 64-hex digest.
 */

export const MANIFEST_FORMAT = "aquaflow-asset-manifest";
export const MANIFEST_VERSION = 1;

/** Live File objects keyed by asset id (browser builds hash/package these; never serialized). */
export const liveAssetFiles = new Map();
export function rememberAssetFile(id, file) {
  if (file && typeof file === "object") liveAssetFiles.set(id, file); else liveAssetFiles.delete(id);
}

const toBytes = (data) => (data instanceof Uint8Array ? data
  : data instanceof ArrayBuffer ? new Uint8Array(data)
    : new TextEncoder().encode(String(data)));

export async function sha256Hex(data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("SHA-256 is unavailable in this environment.");
  const digest = await subtle.digest("SHA-256", toBytes(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const baseName = (p) => String(p || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
const dirName = (p) => {
  const parts = String(p || "").replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/");
};

/**
 * Path of `target` relative to the folder holding `projectPath` (forward slashes), or null
 * when the two are on different drives / not both absolute.
 */
export function relativeAssetPath(projectPath, target) {
  if (!projectPath || !target) return null;
  const norm = (p) => String(p).replace(/\\/g, "/");
  const from = norm(dirName(projectPath)).split("/").filter(Boolean);
  const to = norm(target).split("/").filter(Boolean);
  const isAbs = (p) => /^[a-zA-Z]:\//.test(norm(p)) || norm(p).startsWith("/");
  if (!isAbs(projectPath) || !isAbs(target)) return null;
  const win = /^[a-zA-Z]:$/.test(from[0] || "");
  const same = (a, b) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (!from.length || !to.length || !same(from[0], to[0])) return null;
  let i = 0;
  while (i < from.length && i < to.length - 1 && same(from[i], to[i])) i++;
  return [...Array(from.length - i).fill(".."), ...to.slice(i)].join("/");
}

const TEXTURE_KEY = /texture/i;
function collectTextures(node, trail, out, depth = 0) {
  if (!node || typeof node !== "object" || depth > 6) return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string" && TEXTURE_KEY.test(key) && value && !value.startsWith("data:")
      && /\.(png|jpe?g|webp|ktx2|hdr|exr)$/i.test(value)) {
      out.push({ id: `texture:${trail}${key}`, role: "texture", source: "file", name: baseName(value),
        path: value, locator: { field: `${trail}${key}` } });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      collectTextures(value, `${trail}${key}.`, out, depth + 1);
    }
  }
}

/** Every external dependency referenced by a serialized .aqua object (no I/O). */
export function collectAssetRefs(data) {
  const refs = [];
  const audio = data?.programmer?.audioFileReference;
  if (audio && (audio.name || audio.path)) {
    refs.push({ id: "audio:programmer", role: "audio", source: "file", name: audio.name || baseName(audio.path),
      type: audio.type || "", path: audio.path || null, size: Number(audio.size) || null,
      locator: { field: "programmer.audioFileReference" } });
  }
  const timelineAudio = data?.automation?.audioData;
  if (timelineAudio && typeof timelineAudio === "object" && (timelineAudio.path || timelineAudio.filename || timelineAudio.name)) {
    refs.push({ id: "audio:timeline", role: "audio", source: "file",
      name: timelineAudio.filename || timelineAudio.name || baseName(timelineAudio.path),
      path: timelineAudio.path || null, size: Number(timelineAudio.size) || null,
      locator: { field: "automation.audioData" } });
  }
  const engineering = data?.engineering || {};
  const seen = new Set();
  for (const model of Array.isArray(engineering.site_models) ? engineering.site_models : []) {
    const assetId = model?.props?.assetId;
    if (!assetId || seen.has(assetId) || !String(assetId).startsWith("custom:")) continue; // venue:* ship with the app
    seen.add(assetId);
    refs.push({ id: `model:${assetId}`, role: "site_model", source: "library", name: model.props?.assetName || model.name || assetId,
      type: "model/gltf-binary", path: null, locator: { assetId }, usedBy: model.id });
  }
  const underlay = engineering.cad_underlay;
  if (underlay && Array.isArray(underlay.items)) {
    refs.push({ id: "cad_underlay", role: "cad_underlay", source: "embedded", name: underlay.filename || "CAD underlay",
      path: null, locator: { field: "engineering.cad_underlay" } });
  }
  collectTextures(data?.render, "render.", refs);
  collectTextures(engineering?.params, "engineering.params.", refs);
  return refs;
}

/** Canonical bytes for an embedded underlay so the hash is independent of key order on disk. */
export function underlayFingerprint(underlay) {
  return JSON.stringify({ filename: underlay?.filename || "", units: underlay?.units ?? null, items: underlay?.items || [] });
}

/**
 * Build the manifest. `describe(refs)` (optional, desktop) → [{ id, found, path, size, sha256 }]
 * for file assets; `readLibrary(ref)` → Uint8Array|null for library models; `liveFile(id)`
 * → File|null for browser builds.
 */
export async function buildAssetManifest(data, { projectPath = null, describe = null, readLibrary = null, liveFile = (id) => liveAssetFiles.get(id) || null, now = () => new Date() } = {}) {
  const refs = collectAssetRefs(data);
  const described = new Map();
  const fileRefs = refs.filter((r) => r.source === "file" && r.path);
  if (describe && fileRefs.length) {
    for (const d of (await describe(fileRefs)) || []) described.set(d.id, d);
  }
  const assets = [];
  for (const ref of refs) {
    const entry = { ...ref, size: ref.size ?? null, sha256: null, relativePath: null };
    try {
      if (ref.source === "embedded") {
        const bytes = new TextEncoder().encode(underlayFingerprint(data.engineering.cad_underlay));
        Object.assign(entry, { size: bytes.length, sha256: await sha256Hex(bytes) });
      } else if (ref.source === "library") {
        const bytes = readLibrary ? await readLibrary(ref) : null;
        if (bytes) Object.assign(entry, { size: bytes.length, sha256: await sha256Hex(bytes) });
        else entry.note = "Model is not in this PC's library.";
      } else {
        const d = described.get(ref.id);
        const file = liveFile(ref.id);
        if (d?.found) Object.assign(entry, { path: d.path, size: d.size, sha256: d.sha256 });
        else if (file && typeof file.arrayBuffer === "function") {
          const bytes = new Uint8Array(await file.arrayBuffer());
          Object.assign(entry, { size: bytes.length, sha256: await sha256Hex(bytes) });
        } else entry.note = ref.path ? "File was not found when saving." : "No file path available (browser build); relink on open.";
      }
    } catch (e) {
      entry.note = `Could not hash: ${e.message}`;
    }
    entry.relativePath = entry.path ? relativeAssetPath(projectPath, entry.path) : null;
    assets.push(entry);
  }
  return { format: MANIFEST_FORMAT, version: MANIFEST_VERSION, generatedAt: now().toISOString(), projectPath: projectPath || null, assets };
}

export function hasManifest(data) {
  return data?.assetManifest?.format === MANIFEST_FORMAT && Array.isArray(data.assetManifest.assets);
}

/**
 * Check every manifest asset on this PC. `resolve(asset)` → { found, path?, size?, sha256?, via? }.
 * Embedded assets are verified against the project data itself.
 * Status per item: ok | changed | missing | unverified (found but no recorded hash).
 */
export async function verifyAssetManifest(data, { resolve }) {
  const manifest = data?.assetManifest;
  const items = [];
  for (const asset of hasManifest(data) ? manifest.assets : []) {
    let found;
    try {
      if (asset.source === "embedded") {
        const underlay = data?.engineering?.cad_underlay;
        found = underlay ? { found: true, sha256: await sha256Hex(underlayFingerprint(underlay)), via: "embedded" } : { found: false };
      } else {
        found = (await resolve(asset)) || { found: false };
      }
    } catch (e) {
      found = { found: false, error: e.message };
    }
    let status;
    if (!found.found) status = "missing";
    else if (!asset.sha256 || !found.sha256) status = "unverified";
    else status = found.sha256 === asset.sha256 ? "ok" : "changed";
    items.push({ ...asset, status, resolvedPath: found.path || null, resolvedVia: found.via || null,
      actualSize: found.size ?? null, actualSha256: found.sha256 || null, error: found.error || null });
  }
  const pick = (s) => items.filter((i) => i.status === s);
  return {
    checkedAt: new Date().toISOString(), total: items.length, items,
    ok: pick("ok"), missing: pick("missing"), changed: pick("changed"), unverified: pick("unverified"),
    needsAttention: items.some((i) => i.status === "missing" || i.status === "changed"),
  };
}

/** Human-readable lines for logs / evidence. */
export function describeAssetReport(report) {
  return report.items.map((i) => {
    const where = i.resolvedPath || i.relativePath || i.path || i.locator?.assetId || "";
    const tag = { ok: "OK", changed: "CHANGED", missing: "MISSING", unverified: "UNVERIFIED" }[i.status];
    return `${tag.padEnd(10)} ${i.role.padEnd(12)} ${i.name}${where ? ` (${where})` : ""}`;
  });
}

export const packagedMemberName = (asset) =>
  `assets/${asset.id.replace(/[^a-zA-Z0-9_.-]+/g, "_")}--${String(asset.name || "asset").replace(/[^a-zA-Z0-9_.-]+/g, "_")}`;
