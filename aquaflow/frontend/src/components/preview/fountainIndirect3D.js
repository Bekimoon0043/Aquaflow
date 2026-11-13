import { buildFountainIndirect } from "./fountainIndirect.js";

export class FountainIndirectLights {
  constructor(T, scene, { maxEmitters = 8 } = {}) {
    this.T = T;
    this.scene = scene;
    this.group = new T.Group();
    this.group.name = "Fountain indirect light approximation";
    this.lights = Array.from({ length: maxEmitters }, () => {
      const light = new T.PointLight(0xffffff, 0, 0, 2);
      light.castShadow = false;
      this.group.add(light);
      return light;
    });
    scene.add(this.group);
  }

  update(nozzles, lights, quality = "medium") {
    const enabled = quality === "medium" || quality === "high" || quality === "ultra";
    const emitters = enabled ? buildFountainIndirect(nozzles, lights, { maxEmitters: this.lights.length }) : [];
    this.lights.forEach((light, index) => {
      const emitter = emitters[index];
      light.visible = Boolean(emitter);
      if (!emitter) { light.intensity = 0; return; }
      light.position.set(emitter.x, emitter.y, emitter.z);
      light.color.setRGB(emitter.color.r, emitter.color.g, emitter.color.b);
      light.intensity = Math.min(2, emitter.intensity);
      light.distance = emitter.radius;
      light.userData.approximation = emitter.approximation;
      light.userData.sourceNozzleIds = emitter.sourceNozzleIds;
    });
  }

  dispose() {
    this.scene.remove(this.group);
    this.lights.length = 0;
  }
}
