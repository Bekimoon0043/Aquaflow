/**
 * Fireworks in the 3D scene: one additive point cloud refilled every frame from
 * fillPyroParticles(cues, showTime) plus a short point-light flash at fresh bursts.
 * State is a function of the show time only, so a baked video matches the live preview.
 */
import { fillPyroParticles } from "./pyroParticles.js";

const BUDGET = { low: 5000, eco: 5000, medium: 12000, high: 20000, ultra: 24000, xhigh: 24000 };

const VERT = `
attribute float size;
attribute vec3 color;
varying vec3 vColor;
uniform float uScale;
void main() {
  vColor = color;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * uScale / max(0.1, -mv.z), 2.0, 72.0);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec3 vColor;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  float core = exp(-r * 3.5);
  gl_FragColor = vec4(vColor * (core * 1.6 + 0.25 * (1.0 - r)), 1.0);
}`;

export class PyroSystem {
  constructor(THREE, scene) {
    this.T = THREE;
    this.scene = scene;
    this.cues = [];
    this.capacity = 24000;
    this.out = { pos: new Float32Array(this.capacity * 3), col: new Float32Array(this.capacity * 3), size: new Float32Array(this.capacity) };
    const geo = new THREE.BufferGeometry();
    this.attrs = {
      position: new THREE.BufferAttribute(this.out.pos, 3),
      color: new THREE.BufferAttribute(this.out.col, 3),
      size: new THREE.BufferAttribute(this.out.size, 1),
    };
    for (const [name, a] of Object.entries(this.attrs)) { a.setUsage?.(THREE.DynamicDrawUsage); geo.setAttribute(name, a); }
    geo.setDrawRange(0, 0);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 60, 0), 400);
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: { uScale: { value: 600 } },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 900;
    this.points.name = "pyro-particles";
    this.light = new THREE.PointLight(0xffffff, 0, 400, 1.2);
    this.light.name = "pyro-flash";
    scene.add(this.points);
    scene.add(this.light);
    this.flash = { r: 0, g: 0, b: 0, intensity: 0 };
    this.count = 0;
  }

  setCues(cues) { this.cues = Array.isArray(cues) ? cues : []; }

  /** Rebuild the particles for show time `t`. */
  update(t, { quality = "medium", camera = null, viewportHeight = 720 } = {}) {
    if (!this.cues.length) {
      if (this.count) { this.count = 0; this.points.geometry.setDrawRange(0, 0); }
      this.light.intensity = 0; this.flash.intensity = 0;
      return;
    }
    const { count, flash } = fillPyroParticles(this.cues, t, { budget: BUDGET[quality] || BUDGET.medium }, this.out);
    this.count = count;
    const geo = this.points.geometry;
    geo.setDrawRange(0, count);
    if (count) for (const a of Object.values(this.attrs)) a.needsUpdate = true;
    if (camera?.isPerspectiveCamera) this.material.uniforms.uScale.value = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.flash = flash;
    this.light.color.setRGB(flash.r || 1, flash.g || 1, flash.b || 1);
    this.light.position.set(flash.x, flash.y, flash.z);
    this.light.intensity = flash.intensity * 900;
  }

  setVisible(on) { this.points.visible = on; this.light.visible = on; }

  dispose() {
    this.scene.remove(this.points);
    this.scene.remove(this.light);
    this.points.geometry.dispose();
    this.material.dispose();
    this.light.dispose?.();
    this.cues = [];
  }
}
