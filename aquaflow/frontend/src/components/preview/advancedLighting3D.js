import { RectAreaLightUniformsLib } from "three/examples/jsm/lights/RectAreaLightUniformsLib.js";

export function advancedLightKind(light = {}) {
  const type = String(light.luminaireType || light.luminaire?.type || "").toLowerCase();
  if (type === "rectangular_area" || type === "pixel_matrix" || light.areaLight) return "area";
  if (type === "framing_gobo" || type === "video_projector" || light.gobo || light.projection) return "gobo";
  return null;
}

function patternTexture(T, kind = "breakup") {
  const canvas = T.createCanvas ? T.createCanvas() : document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "white";
  if (kind === "grid") {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) if ((i + j) % 2) ctx.fillRect(i * 32, j * 32, 32, 32);
  } else {
    const gradient = ctx.createRadialGradient(128, 128, 18, 128, 128, 120);
    gradient.addColorStop(0, "white");
    gradient.addColorStop(0.55, "white");
    gradient.addColorStop(1, "black");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(128, 128, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 18; i++) {
      const angle = i * Math.PI * 2 / 18;
      ctx.beginPath();
      ctx.moveTo(128, 128);
      ctx.lineTo(128 + Math.cos(angle) * 120, 128 + Math.sin(angle) * 120);
      ctx.lineTo(128 + Math.cos(angle + 0.08) * 120, 128 + Math.sin(angle + 0.08) * 120);
      ctx.closePath();
      ctx.fill();
    }
  }
  const texture = new T.CanvasTexture(canvas);
  texture.center.set(0.5, 0.5);
  return texture;
}

function aimQuaternion(T, object, aimDir) {
  const direction = Array.isArray(aimDir) ? aimDir : [0, -1, 0];
  object.quaternion.setFromUnitVectors(new T.Vector3(0, 0, -1), new T.Vector3(...direction).normalize());
}

export class AdvancedLightingLayer {
  constructor(T, scene) {
    this.T = T;
    this.scene = scene;
    this.group = new T.Group();
    this.group.name = "Area and projected lighting";
    this.entries = new Map();
    this.textures = new Map();
    scene.add(this.group);
    RectAreaLightUniformsLib.init();
  }

  texture(light) {
    const projection = light.projection || light.gobo || {};
    const url = projection.textureUrl || projection.url;
    if (url) {
      if (!this.textures.has(url)) this.textures.set(url, new this.T.TextureLoader().load(url));
      return this.textures.get(url);
    }
    const kind = projection.pattern || "breakup";
    if (!this.textures.has(kind)) this.textures.set(kind, patternTexture(this.T, kind));
    return this.textures.get(kind);
  }

  create(light, kind) {
    const T = this.T;
    const group = new T.Group();
    let object;
    if (kind === "area") {
      const area = light.area || {};
      object = new T.RectAreaLight(light.color || 0xffffff, 1, area.widthM || 1, area.lengthM || 1);
      object.userData.shadowModel = "unshadowed-rect-area";
      aimQuaternion(T, object, light.aimDir);
    } else {
      object = new T.SpotLight(light.color || 0xffffff, 1, light.radius || 20, (light.beamAngleDeg || 30) * Math.PI / 180, 0.35, 2);
      object.map = this.texture(light);
      object.target = new T.Object3D();
      object.castShadow = false;
      group.add(object.target);
    }
    group.add(object);
    this.group.add(group);
    return { group, object, kind };
  }

  update(lights = [], elapsed = 0) {
    const wanted = new Set();
    for (const light of lights) {
      const kind = advancedLightKind(light);
      if (!kind) continue;
      wanted.add(light.id);
      if (!this.entries.has(light.id)) this.entries.set(light.id, this.create(light, kind));
      const entry = this.entries.get(light.id);
      const object = entry.object;
      object.position.set(light.x || 0, light.y || light.mountHeightM || 0, light.z || 0);
      object.color.copy(light.color);
      object.intensity = Math.max(0, light.intensity || 0);
      if (entry.kind === "gobo") {
        const direction = Array.isArray(light.aimDir) ? light.aimDir : [0, -1, 0];
        object.target.position.set(
          object.position.x + direction[0] * 10,
          object.position.y + direction[1] * 10,
          object.position.z + direction[2] * 10,
        );
        object.angle = Math.max(0.01, (light.beamAngleDeg || 30) * Math.PI / 180);
        object.distance = (light.radius || 20) * 3;
        if (object.map) object.map.rotation = (light.goboRotationDeg || elapsed * 12) * Math.PI / 180;
      } else {
        aimQuaternion(this.T, object, light.aimDir);
      }
    }
    for (const [id, entry] of this.entries) {
      if (!wanted.has(id)) {
        entry.group.removeFromParent();
        this.entries.delete(id);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.entries.clear();
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}
