import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { NODE_TYPES } from "./editor/sceneGraph";
import { venueLayout } from "./venueModels";

export const BUILTIN_MODELS = [
  { id: "venue:person-reading", name: "Person · reading", category: "People", height: 1.76, url: "/models/venue/person_reading.glb" },
  { id: "venue:person-walking", name: "Person · walking", category: "People", height: 1.72, url: "/models/venue/person_walking.glb" },
  { id: "venue:woman-standing", name: "Woman · standing", category: "People", height: 1.68, url: "/models/venue/female_standing.glb" },
  { id: "venue:woman-walking", name: "Woman · walking", category: "People", height: 1.68, url: "/models/venue/female_walking.glb" },
  { id: "venue:man-standing", name: "Man · standing", category: "People", height: 1.75, url: "/models/venue/male_standing.glb" },
  { id: "venue:man-waving", name: "Man · waving", category: "People", height: 1.75, url: "/models/venue/male_standing_waving.glb" },
  { id: "venue:building-small", name: "Textured building · small", category: "Buildings", height: 8, url: "/models/venue/b_small.glb" },
  { id: "venue:building-medium", name: "Textured building · medium", category: "Buildings", height: 11, url: "/models/venue/b_medium.glb" },
  { id: "venue:building-large", name: "Textured building · large", category: "Buildings", height: 14, url: "/models/venue/b_large.glb" },
  { id: "venue:tree-common-1", name: "Textured tree · broad", category: "Landscaping", height: 6.2, url: "/models/venue/tree_common_1.glb" },
  { id: "venue:tree-common-2", name: "Textured tree · tall", category: "Landscaping", height: 7.1, url: "/models/venue/tree_common_2.glb" },
  { id: "venue:tree-common-3", name: "Textured tree · spreading", category: "Landscaping", height: 5.7, url: "/models/venue/tree_common_3.glb" },
];

const DB_NAME = "aquaflow-model-library-v1";
const STORE = "models";
const MAX_BYTES = 60 * 1024 * 1024;
const builtinById = new Map(BUILTIN_MODELS.map(asset => [asset.id, asset]));

function openDB() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("Local model storage is unavailable in this browser."));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(mode, operation) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
      let result;
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Model storage transaction was cancelled."));
      tx.oncomplete = () => resolve(result);
    });
  } finally { db.close(); }
}

export function validateGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 28 || buffer.byteLength > MAX_BYTES)
    throw new Error("Choose a self-contained GLB file smaller than 60 MB.");
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
      || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a)
    throw new Error("This is not a valid glTF 2.0 binary (.glb) file.");
  const jsonLength = view.getUint32(12, true);
  if (20 + jsonLength > buffer.byteLength) throw new Error("The GLB file is incomplete.");
  let json;
  try { json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))); }
  catch { throw new Error("The GLB metadata could not be read."); }
  if (json.asset?.version !== "2.0") throw new Error("Only glTF 2.0 models are supported.");
  const resources = [...(json.buffers || []), ...(json.images || [])];
  if (resources.some(item => item.uri && !item.uri.startsWith("data:")))
    throw new Error("Export a self-contained GLB from Blender with embedded textures.");
  const unsupported = ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"];
  if ((json.extensionsRequired || []).some(extension => unsupported.includes(extension)))
    throw new Error("This GLB uses compressed meshes or textures. Re-export from Blender without mesh/texture compression.");
  return json;
}

export async function importGlb(file) {
  if (!file?.name?.toLowerCase().endsWith(".glb"))
    throw new Error("Export from Blender as glTF Binary (.glb), then select that file.");
  if (file.size > MAX_BYTES) throw new Error("Choose a GLB smaller than 60 MB.");
  const buffer = await file.arrayBuffer();
  validateGlb(buffer);
  const id = `custom:${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`}`;
  const record = { id, name: file.name.replace(/\.glb$/i, ""), category: "Imported", blob: new Blob([buffer], { type: "model/gltf-binary" }) };
  await transaction("readwrite", store => store.put(record));
  return { id, name: record.name, category: record.category };
}

export async function listImportedModels() {
  const records = await transaction("readonly", store => store.getAll());
  return records.map(({ id, name, category }) => ({ id, name, category }));
}

async function assetFor(id) {
  if (builtinById.has(id)) return builtinById.get(id);
  if (!id?.startsWith("custom:")) return null;
  return transaction("readonly", store => store.get(id));
}

/** Default context is editable model nodes, never baked into venue geometry. */
export function defaultVenueModels(pool = {}, quality = "medium") {
  const { audience, landscape, buildings } = venueLayout(pool);
  const low = quality === "low";
  const peopleCount = low ? 8 : 16;
  const treeCount = low ? 10 : 20;
  const buildingCount = low ? 3 : 6;
  const people = ["venue:person-reading", "venue:woman-standing", "venue:man-standing",
    "venue:person-walking", "venue:woman-walking", "venue:man-waving"];
  const result = [];
  for (let i = 0; i < peopleCount; i++) {
    const angle = Math.PI * 2 * (i + 0.15) / peopleCount;
    const radius = audience + (i % 3 - 1) * 0.7;
    const facing = Math.atan2(-Math.cos(angle), -Math.sin(angle)) * 180 / Math.PI;
    result.push({ id: `venue-person-${i}`, name: `Audience ${i + 1}`, type: NODE_TYPES.MODEL,
      position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius },
      rotation: { y: facing }, props: { assetId: people[i % people.length] } });
  }
  for (let i = 0; i < buildingCount; i++) {
    const angle = Math.PI * 2 * (i + 0.18) / buildingCount;
    const facing = Math.atan2(-Math.cos(angle), -Math.sin(angle)) * 180 / Math.PI;
    result.push({ id: `venue-building-${i}`, name: `Building ${i + 1}`, type: NODE_TYPES.MODEL,
      position: { x: Math.cos(angle) * buildings, y: 0, z: Math.sin(angle) * buildings },
      rotation: { y: facing },
      props: { assetId: `venue:building-${["small", "medium", "large"][i % 3]}` } });
  }
  for (let i = 0; i < treeCount; i++) {
    // Two loose rings avoid the artificial "trees on a perfect circle" look while
    // keeping the promenade and engineering fixtures clear.
    const jitter = Math.sin((i + 1) * 91.713) * 0.5 + 0.5;
    const angle = Math.PI * 2 * (i + 0.12 + jitter * 0.16) / treeCount;
    const radius = landscape + 0.8 + (i % 2) * 1.6 + jitter * 0.9;
    result.push({ id: `venue-tree-${i}`, name: `Tree ${i + 1}`, type: NODE_TYPES.MODEL,
      position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius },
      rotation: { y: (angle * 180 / Math.PI + 37 * i) % 360 },
      scale: 0.86 + jitter * 0.28,
      props: { assetId: `venue:tree-common-${(i % 3) + 1}` } });
  }
  return result;
}

/** GLB instances follow the same scene graph as nozzles and lights. */
export class ModelLayer {
  constructor(T, scene) {
    this.T = T;
    this.root = new T.Group();
    this.root.name = "Placed 3D models";
    scene.add(this.root);
    this.instances = new Map();
    this.templates = new Map();
    this.revision = 0;
    this.disposed = false;
  }

  async template(id) {
    if (!this.templates.has(id)) this.templates.set(id, this._loadTemplate(id));
    return this.templates.get(id);
  }

  async _loadTemplate(id) {
    const asset = await assetFor(id);
    if (!asset) throw new Error(`Model asset not found: ${id}`);
    const loader = new GLTFLoader();
    const gltf = asset.url ? await loader.loadAsync(asset.url)
      : await loader.parseAsync(await asset.blob.arrayBuffer(), "");
    const scene = gltf.scene;
    const box = new this.T.Box3().setFromObject(scene);
    const actualHeight = box.getSize(new this.T.Vector3()).y;
    if (!Number.isFinite(actualHeight) || actualHeight <= 0) throw new Error(`Model is empty: ${asset.name}`);
    const scale = asset.height ? asset.height / actualHeight : 1;
    const wrapper = new this.T.Group();
    scene.scale.setScalar(scale);
    scene.position.y = -box.min.y * scale;
    wrapper.add(scene);
    // Low ambient fill preserves readable albedo at night, without adding lights
    // that would flatten the water. Preserve the original PBR maps and materials.
    scene.traverse(object => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (material?.isMeshStandardMaterial) {
          material.emissive?.copy(material.map ? new this.T.Color(0xffffff) : material.color);
          if (material.map) material.emissiveMap = material.map;
          material.emissiveIntensity = asset.category === "Buildings" ? 0.5 : 0.3;
          material.needsUpdate = true;
        }
      }
    });
    return wrapper;
  }

  async syncGraph(graph) {
    const revision = ++this.revision;
    const nodes = graph.flatten().map(({ node }) => node).filter(node => node.type === NODE_TYPES.MODEL && node.props?.assetId);
    const wanted = new Set(nodes.map(node => node.id));
    for (const [id, entry] of this.instances) {
      if (wanted.has(id)) continue;
      this.root.remove(entry.object);
      this.instances.delete(id);
    }
    await Promise.all(nodes.map(async node => {
      let entry = this.instances.get(node.id);
      if (!entry || entry.assetId !== node.props.assetId) {
        try {
          const template = await this.template(node.props.assetId);
          if (this.disposed || revision !== this.revision || !graph.get(node.id)) return;
          if (entry) this.root.remove(entry.object);
          entry = { assetId: node.props.assetId, object: template.clone(true) };
          entry.object.userData.nodeId = node.id;
          this.root.add(entry.object);
          this.instances.set(node.id, entry);
        } catch (error) {
          console.warn("[ModelLayer]", error);
          return;
        }
      }
      const m = graph.worldMatrix(node.id);
      entry.object.matrix.set(...m);
      entry.object.matrixAutoUpdate = false;
      entry.object.visible = graph.isVisible(node.id);
    }));
  }

  dispose() {
    this.disposed = true;
    this.revision++;
    this.root.parent?.remove(this.root);
    this.instances.clear();
    for (const promise of this.templates.values()) promise.then(root => root.traverse(object => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach(material => { material?.map?.dispose?.(); material?.dispose?.(); });
    })).catch(() => {});
    this.templates.clear();
  }
}
