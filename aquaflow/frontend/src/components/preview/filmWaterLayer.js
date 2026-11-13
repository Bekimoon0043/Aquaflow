import { describeRadialFilm, describeFallingWater, sampleRadialFilm, sampleFallingWater } from "./simulation/filmWaterModels.js";

const RADIAL = /mushroom|tulip|umbrella|dandelion|crystal[ _-]?ball|water[ _-]?sphere|sphere|bell|dome/;
const FALLING = /cascade|waterfall|waterwall|water[ _-]?wall|weir/;

export function filmKindFor(config = {}) {
  const text = [config.fixtureType, config.type, config.engineering?.group, config.engineering?.nozzleFamily]
    .filter(Boolean).join(" ").toLowerCase().replace(/-/g, "_");
  if (/waterwall|water[ _-]?wall/.test(text)) return "waterwall";
  if (/stepped/.test(text)) return "stepped_fall";
  if (/weir/.test(text)) return "weir";
  if (/cascade|waterfall/.test(text)) return "cascade";
  if (/dandelion/.test(text)) return "dandelion";
  if (/sphere|crystal[ _-]?ball/.test(text)) return "sphere";
  if (/mushroom/.test(text)) return "mushroom";
  if (/tulip/.test(text)) return "tulip";
  if (/umbrella/.test(text)) return "umbrella";
  if (/dome/.test(text)) return "dome";
  if (/bell/.test(text)) return "bell";
  return null;
}

export function isFilmNozzle(config) {
  return Boolean(RADIAL.test(String(config?.fixtureType || config?.type || "")) || FALLING.test(String(config?.fixtureType || config?.type || "")) || filmKindFor(config));
}

function descriptorFor(config, intensity) {
  const kind = filmKindFor(config);
  if (!kind) return null;
  const engineering = config.engineering || {};
  const mountHeight = config.mountHeightM ?? (["cascade", "weir", "stepped_fall"].includes(kind)
    ? engineering.fallHeightM ?? engineering.jetHeightM ?? engineering.mountHeightM
    : engineering.mountHeightM);
  const options = {
    x: config.x || 0,
    y: (Number(mountHeight) || 0) + 0.08,
    z: config.z || 0,
    intensity,
    rotationDeg: config.rotation || 0,
    widthM: engineering.widthM || engineering.screenWidthM || engineering.curtainWidthM || 2,
  };
  if (["cascade", "weir", "stepped_fall", "waterwall"].includes(kind)) return describeFallingWater(kind, options);
  return describeRadialFilm(kind, options);
}

function makeGrid(T, rows, columns) {
  const positions = new Float32Array((rows + 1) * (columns + 1) * 3);
  const coherence = new Float32Array((rows + 1) * (columns + 1));
  const indices = [];
  const stride = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * stride + column;
      const b = a + stride;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.BufferAttribute(positions, 3).setUsage(T.DynamicDrawUsage));
  geometry.setAttribute("aCoherence", new T.BufferAttribute(coherence, 1).setUsage(T.DynamicDrawUsage));
  geometry.setIndex(indices);
  return geometry;
}

function makeMaterial(T) {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    uniforms: {
      uColor: { value: new T.Color(0.72, 0.88, 1.0) },
      uCamera: { value: new T.Vector3() },
    },
    vertexShader: `
      attribute float aCoherence;
      varying float vCoherence;
      varying vec3 vWorld;
      void main() {
        vCoherence = aCoherence;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uCamera;
      varying float vCoherence;
      varying vec3 vWorld;
      void main() {
        vec3 viewDir = normalize(uCamera - vWorld);
        float rim = pow(1.0 - abs(viewDir.y), 2.0);
        float alpha = 0.06 + 0.52 * vCoherence + 0.14 * rim;
        vec3 color = uColor * (0.68 + 0.42 * rim + 0.16 * vCoherence);
        gl_FragColor = vec4(color, clamp(alpha, 0.02, 0.72));
      }
    `,
  });
}

export class FilmWaterLayer {
  constructor(T, scene, { radialSegments = 48, ageSegments = 12, widthSegments = 10 } = {}) {
    this.T = T;
    this.scene = scene;
    this.radialSegments = radialSegments;
    this.ageSegments = ageSegments;
    this.widthSegments = widthSegments;
    this.group = new T.Group();
    this.group.name = "Thin-film and falling water";
    this.entries = new Map();
    scene.add(this.group);
  }

  createEntry(config) {
    const T = this.T;
    const radial = !["cascade", "weir", "stepped_fall", "waterwall"].includes(filmKindFor(config));
    const rows = this.ageSegments;
    const columns = radial ? this.radialSegments : this.widthSegments;
    const geometry = makeGrid(T, rows, columns);
    const material = makeMaterial(T);
    const mesh = new T.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, geometry, material, radial, rows, columns };
  }

  update(nozzles, elapsed, camera = null) {
    const wanted = new Set();
    for (const nozzle of nozzles || []) {
      const config = nozzle.config || nozzle;
      if (!config.advancedNozzleModel || !filmKindFor(config)) continue;
      const level = Math.max(0, Math.min(1, Number(nozzle.intensity ?? config.runtimeIntensity ?? 1) || 0));
      wanted.add(config.id);
      if (!this.entries.has(config.id)) this.entries.set(config.id, this.createEntry(config));
      const entry = this.entries.get(config.id);
      entry.mesh.visible = level > 0.005;
      if (!entry.mesh.visible) continue;
      const descriptor = descriptorFor(config, level);
      const positions = entry.geometry.attributes.position;
      const coherence = entry.geometry.attributes.aCoherence;
      const duration = entry.radial ? 0.65 : 0.5;
      for (let row = 0; row <= entry.rows; row++) {
        const age = (elapsed + (row / entry.rows) * duration) % duration;
        for (let column = 0; column <= entry.columns; column++) {
          const index = row * (entry.columns + 1) + column;
          const u = column / entry.columns;
          const sample = entry.radial
            ? sampleRadialFilm(descriptor, age, u, row / entry.rows)
            : sampleFallingWater(descriptor, age, u);
          positions.setXYZ(index, sample.position[0], sample.position[1], sample.position[2]);
          coherence.setX(index, sample.coherence);
        }
      }
      positions.needsUpdate = true;
      coherence.needsUpdate = true;
      if (camera) entry.material.uniforms.uCamera.value.copy(camera.position);
    }
    for (const [id, entry] of this.entries) {
      if (!wanted.has(id)) {
        entry.mesh.removeFromParent();
        entry.geometry.dispose();
        entry.material.dispose();
        this.entries.delete(id);
      }
    }
  }

  dispose() {
    for (const entry of this.entries.values()) {
      entry.mesh.removeFromParent();
      entry.geometry.dispose();
      entry.material.dispose();
    }
    this.entries.clear();
    this.scene.remove(this.group);
  }
}
