import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const asset = (id, file, name, category, height, extra = {}) => ({
  id: `equipment:${id}`, file: `/models/equipment/${file}.glb`, name, category, height,
  provenance: "Original procedural model generated for AquaFlow", ...extra,
});

export const EQUIPMENT_ASSETS = Object.freeze({
  jet: asset("nozzle-straight-dn25", "nozzle_straight_dn25", "Straight jet · DN25", "Nozzles", 0.22),
  geyser: asset("nozzle-aerated-dn40", "nozzle_aerated_dn40", "Aerated jet · DN40", "Nozzles", 0.32),
  laminar: asset("nozzle-laminar-dn25", "nozzle_laminar_dn25", "Laminar jet · DN25", "Nozzles", 0.30),
  fan_jet: asset("nozzle-fan-dn25", "nozzle_fan_dn25", "Fan jet · DN25", "Nozzles", 0.182),
  pirouette: asset("nozzle-basket-3outlet", "nozzle_b_3outlet", "Rotating basket · 3 outlets", "Nozzles", 0.372),
  motion: asset("motion-2d-nozzle", "motion_2d_nozzle", "Robotic nozzle · 2 axes", "Nozzles", 0.55),
  light: asset("light-rgb-uw", "light_rgb_uw", "Underwater RGB light", "Lighting", 0.12),
  pump: asset("pump-centrifugal", "pump_centrifugal", "Centrifugal pump", "Hydraulics", 0.501),
  valve: asset("valve-solenoid-dn25", "valve_solenoid_dn25", "Solenoid valve · DN25", "Hydraulics", 0.184),
  distributor: asset("manifold-4way", "manifold_4way", "Distribution manifold · 4 way", "Hydraulics", 0.258),
  laser: asset("laser-projector", "laser_projector", "Outdoor laser projector", "Effects", 0.379),
  flame: asset("flame-burner", "flame_burner", "Flame-effect burner", "Effects", 0.197),
});

export const equipmentAssetForKind = (kind) => EQUIPMENT_ASSETS[kind] || null;

export function equipmentAssetForEngineeringType(type) {
  const key = String(type || "").toLowerCase();
  if (key.includes("pump")) return EQUIPMENT_ASSETS.pump;
  if (key.includes("valve") || key.includes("solenoid")) return EQUIPMENT_ASSETS.valve;
  if (key.includes("manifold") || key.includes("distributor")) return EQUIPMENT_ASSETS.distributor;
  return null;
}

const pending = new Map();

export function loadEquipmentAsset(THREE, kind) {
  const definition = equipmentAssetForKind(kind);
  if (!definition || typeof window === "undefined" || !window.location?.href) return Promise.resolve(null);
  const key = `${definition.file}:${THREE?.REVISION || "three"}`;
  if (!pending.has(key)) {
    pending.set(key, new GLTFLoader().loadAsync(definition.file).then((gltf) => {
      gltf.scene.name = definition.name;
      gltf.scene.userData.equipmentAssetId = definition.id;
      gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      return { ...definition, template: gltf.scene, animations: gltf.animations };
    }).catch((error) => {
      pending.delete(key);
      throw error;
    }));
  }
  return pending.get(key);
}

export function socketWorld(THREE, root, name) {
  const socket = root?.getObjectByName(name);
  if (!socket) return null;
  root.updateWorldMatrix(true, true);
  const position = socket.getWorldPosition(new THREE.Vector3());
  const direction = new THREE.Vector3(0, 1, 0).transformDirection(socket.matrixWorld).normalize();
  return { name, position: position.toArray(), direction: direction.toArray() };
}

export function applyModelOutlets(emitters, cfg) {
  if (cfg.modelOutlets?.length) {
    return emitters.map((emitter, index) => {
      const outlet = cfg.modelOutlets[index % cfg.modelOutlets.length];
      return { ...emitter, ox: outlet.position[0], oy: outlet.position[1], oz: outlet.position[2],
        dx: outlet.direction[0], dy: outlet.direction[1], dz: outlet.direction[2] };
    });
  }
  if (!cfg.modelOutlet) return emitters;
  const { position, direction } = cfg.modelOutlet;
  return emitters.map((emitter) => ({
    ...emitter,
    ox: position[0], oy: position[1], oz: position[2],
    ...(emitter.mode === 0 ? { dx: direction[0], dy: direction[1], dz: direction[2] } : {}),
  }));
}
