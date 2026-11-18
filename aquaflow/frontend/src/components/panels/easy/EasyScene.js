// EasyScene — the big 3D space of the Easy Fountain Design window (plain three.js).
//
// The panel owns the data and calls setData(); this class only draws and reports what the user
// does with the mouse:
//   drop an asset from the tray       → handlers.onDrop(key, {x, z})
//   click an item / a line / nothing  → handlers.onSelect(id) / onSelectLink(linkId) / onSelect(null)
//   drag an item                       → handlers.onMoveEnd(id, {x, z})          (live while dragging)
//   drag a plug at a line's end        → handlers.onReplug(linkId, end, targetId | null)
// World frame: x right, y up, z = plan depth (geometryContract: world z === engineering y).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadEquipmentAsset } from "../../preview/equipmentAssets";
import { laserFrame } from "../../preview/laser/laserRig";

const G = 9.81;
const MODEL_SCALE = 2.5;          // equipment is drawn 2.5× life size so a 0.2 m nozzle can be seen and grabbed
const MAX_PARTICLES = 26000;
const ROLE_COLOR = { pump: 0x38bdf8, valve: 0xa78bfa, nozzle: 0x5eead4, light: 0xfacc15, effect: 0xfb923c };
const LINK_COLOR = { pump: 0x38bdf8, valve: 0xa78bfa, light: 0xfacc15 };
const PORT_Y = 0.18;
const MAX_BEAM_VERTS = 6 * 2400;   // 2 400 ribbon quads
const MAX_DOTS = 3000;
const MAX_FLAME = 9000;
const MAX_FOG = 2400;
const BEAM_DRAW_M = 70;             // beams are drawn this far (they fade into the night sky)

function roundSprite() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.7)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function textSprite(text, color = "#e2e8f0") {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = "600 28px system-ui, sans-serif";
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 24;
  c.width = w; c.height = 44;
  g.font = font;
  g.fillStyle = "rgba(8,15,25,0.72)";
  g.beginPath();
  g.roundRect?.(0, 0, w, 44, 10);
  if (g.roundRect) g.fill(); else g.fillRect(0, 0, w, 44);
  g.fillStyle = color;
  g.textBaseline = "middle";
  g.fillText(text, 12, 23);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const s = new THREE.Sprite(mat);
  s.scale.set(w / 110, 44 / 110, 1);
  s.renderOrder = 10;
  return s;
}

function placeholder(role) {
  const color = ROLE_COLOR[role] ?? 0x94a3b8;
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.45 });
  let geo;
  if (role === "pump") geo = new THREE.CylinderGeometry(0.32, 0.36, 0.6, 20).translate(0, 0.3, 0);
  else if (role === "valve") geo = new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 0.15, 0);
  else if (role === "light") geo = new THREE.CylinderGeometry(0.17, 0.2, 0.14, 20).translate(0, 0.07, 0);
  else if (role === "nozzle") geo = new THREE.CylinderGeometry(0.06, 0.11, 0.3, 14).translate(0, 0.15, 0);
  else geo = new THREE.BoxGeometry(0.4, 0.3, 0.4).translate(0, 0.15, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

/**
 * Where a moving nozzle points at time τ: tilt from vertical (th), azimuth (ph) and lift (m).
 * Each drop keeps the direction it left with, so the water traces the motion (curving ropes).
 */
function motionDir(m, rot, tau) {
  const w = 2 * Math.PI * m.speedHz;
  const half = ((m.range / 2) * Math.PI) / 180;
  const panHalf = ((m.pan / 2) * Math.PI) / 180;
  const fullPan = m.pan >= 359;
  switch (m.pattern) {
    case "wave":
    case "sweep": {
      const a = half * Math.sin(w * tau + (m.pattern === "wave" ? m.phase : 0));
      return { th: Math.abs(a), ph: rot + (a < 0 ? Math.PI : 0), lift: 0 };
    }
    case "circle":
      return { th: half * 0.8, ph: fullPan ? rot + w * tau : rot + panHalf * Math.sin(w * tau), lift: 0 };
    case "figure8": {
      const ax = half * Math.sin(w * tau), az = half * 0.6 * Math.sin(2 * w * tau);
      return { th: Math.hypot(ax, az), ph: rot + Math.atan2(az, ax), lift: 0 };
    }
    case "cross": {
      const a = half * Math.sin(w * tau);
      const along = Math.floor((w * tau) / (2 * Math.PI)) % 2 ? Math.PI / 2 : 0;
      return { th: Math.abs(a), ph: rot + along + (a < 0 ? Math.PI : 0), lift: 0 };
    }
    case "spiral":
    default:
      return { th: half * (0.55 + 0.45 * Math.sin(0.3 * w * tau)), ph: fullPan ? rot + w * tau : rot + panHalf * Math.sin(w * tau),
        lift: m.liftM * (0.5 + 0.5 * Math.sin(0.5 * w * tau)) };
  }
}

/** Outlets of a jet: fixed directions (th, ph) or `at(τ)` for moving / rotating ones. */
function outletsOf(jet, t, rot) {
  const kind = jet.kind;
  const out = [];
  if (jet.motion) {
    out.push({ at: (tau) => motionDir(jet.motion, rot, tau), spread: 0.018 });
  } else if (kind === "basket") {
    const n = Math.max(2, jet.outlets || 3);
    for (let i = 0; i < n; i += 1) out.push({ at: (tau) => ({ th: 0.32, ph: tau * 2.4 + (i * Math.PI * 2) / n, lift: 0 }), spread: 0.035 });
  } else if (kind === "ring") {
    const n = 12;
    for (let i = 0; i < n; i += 1) out.push({ th: 0.42, ph: (i * Math.PI * 2) / n, spread: 0.03 });
  } else if (kind === "curtain") {
    const n = 11;
    for (let i = 0; i < n; i += 1) {
      const a = -0.75 + (1.5 * i) / (n - 1);
      out.push({ th: Math.abs(a), ph: rot + (a < 0 ? Math.PI : 0), spread: 0.025 });
    }
  } else if (kind === "mist") {
    for (let i = 0; i < 16; i += 1) out.push({ th: 0.2 + (i % 4) * 0.25, ph: i * 2.39996, spread: 0.25, mist: true });
  } else if (kind === "jumping") {
    out.push({ th: 0.62, ph: rot, spread: 0.008, pulse: true });
  } else if (kind === "swing") {
    out.push({ th: 0.45 * Math.sin(t * 1.3), ph: rot, spread: 0.03 });
  } else if (kind === "geyser") {
    out.push({ th: 0, ph: 0, spread: 0.11, foam: true });
  } else {
    out.push({ th: 0, ph: 0, spread: kind === "shooter" ? 0.015 : 0.025 });
  }
  return out;
}

export class EasyScene {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.items = new Map();        // id → { group, role, modelKind, data, label, modelToken }
    this.linkObjects = [];
    this.jetState = new Map();     // id → smoothed height
    this.data = { items: [], links: [], jets: [], pool: null };
    this.drag = null;
    this.disposed = false;
    this.time = 0;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.domElement.style.display = "block";
    r.domElement.style.width = "100%";
    r.domElement.style.height = "100%";
    r.domElement.style.touchAction = "none";
    r.domElement.tabIndex = 0;
    container.appendChild(r.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a1420);
    scene.fog = new THREE.Fog(0x0a1420, 60, 160);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    this.camera.position.set(0, 11, 16);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 140;
    this.controls.screenSpacePanning = false;

    scene.add(new THREE.HemisphereLight(0xc6e2ff, 0x1d2a20, 0.85));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(12, 22, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, far: 80 });
    scene.add(sun);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400),
      new THREE.MeshStandardMaterial({ color: 0x27322b, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);
    const grid = new THREE.GridHelper(120, 120, 0x3b4c5e, 0x2a3644);
    grid.position.y = -0.005;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    scene.add(grid);

    this.basin = new THREE.Group();
    scene.add(this.basin);
    this.itemRoot = new THREE.Group();
    scene.add(this.itemRoot);
    this.linkRoot = new THREE.Group();
    scene.add(this.linkRoot);
    this.coneRoot = new THREE.Group();
    scene.add(this.coneRoot);

    // Water particles.
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute("color", new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.sprite = roundSprite();
    this.particles = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.13, map: this.sprite, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 2;
    scene.add(this.particles);
    this.jitter = new Float32Array(MAX_PARTICLES * 3);
    for (let i = 0; i < this.jitter.length; i += 1) this.jitter[i] = Math.random() * 2 - 1;

    // Effects: laser beams (camera-facing ribbons), beam dots, flames and fog.
    const dyn = (count, itemSize) => new THREE.BufferAttribute(new Float32Array(count * itemSize), itemSize).setUsage(THREE.DynamicDrawUsage);
    const beamGeo = new THREE.BufferGeometry();
    beamGeo.setAttribute("position", dyn(MAX_BEAM_VERTS, 3));
    beamGeo.setAttribute("color", dyn(MAX_BEAM_VERTS, 3));
    beamGeo.setDrawRange(0, 0);
    this.beams = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    this.beams.frustumCulled = false;
    this.beams.renderOrder = 2;
    scene.add(this.beams);
    const pointsOf = (count, material) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", dyn(count, 3));
      g.setAttribute("color", dyn(count, 3));
      g.setDrawRange(0, 0);
      const p = new THREE.Points(g, material);
      p.frustumCulled = false;
      p.renderOrder = 2;
      scene.add(p);
      return p;
    };
    this.dots = pointsOf(MAX_DOTS, new THREE.PointsMaterial({ size: 0.35, map: this.sprite, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    this.flames = pointsOf(MAX_FLAME, new THREE.PointsMaterial({ size: 0.7, map: this.sprite, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fog = pointsOf(MAX_FOG, new THREE.PointsMaterial({ size: 2.6, map: this.sprite, vertexColors: true, transparent: true,
      opacity: 0.22, depthWrite: false }));

    // Selection ring, drop ghost, drag line.
    this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    this.selRing.rotation.x = -Math.PI / 2;
    this.selRing.renderOrder = 5;
    this.selRing.visible = false;
    scene.add(this.selRing);
    this.ghost = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 32),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false }));
    this.ghost.rotation.x = -Math.PI / 2;
    this.ghost.visible = false;
    scene.add(this.ghost);
    this.dragLine = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.dragLine.visible = false;
    scene.add(this.dragLine);
    this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 40),
      new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }));
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    scene.add(this.hoverRing);

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this._bind();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.clock = new THREE.Clock();
    this._loop = this._loop.bind(this);
    this.frame = requestAnimationFrame(this._loop);
  }

  // ─── data ─────────────────────────────────────────────────────────────────

  /**
   * @param {{ items: Array<{id,label,role,modelKind,x,z,elevation,rotation,color,on,intensity,beamDeg}>,
   *           links: Array<{id,kind,from,to}>, jets: Array<{id,kind,heightM,color,intensity,outlets}>,
   *           pool: {shape,radius?,rx?,ry?,points?}, selectedId, selectedLinkId, showLinks, showLabels }} data
   */
  setData(data) {
    this.data = { ...this.data, ...data };
    if ("pool" in data) {
      const poolKey = JSON.stringify(data.pool || null);
      if (poolKey !== this.poolKey) { this.poolKey = poolKey; this._buildBasin(data.pool); }
    }
    this._syncItems();
    this._buildLinks();
    this._buildCones();
    this._updateSelection();
  }

  _syncItems() {
    const seen = new Set();
    // Labels on every item while the design is small; on a busy design only the selected one.
    const busy = this.data.items.length > 16;
    for (const it of this.data.items) {
      seen.add(it.id);
      let rec = this.items.get(it.id);
      if (!rec || rec.role !== it.role || rec.modelKind !== it.modelKind) {
        if (rec) this._removeItem(it.id);
        rec = this._createItem(it);
      }
      const labelOn = this.data.showLabels !== false && (!busy || it.id === this.data.selectedId);
      if (rec.label !== `${it.label}|${labelOn}`) {
        if (rec.labelSprite) { rec.group.remove(rec.labelSprite); rec.labelSprite.material.map.dispose(); rec.labelSprite.material.dispose(); }
        rec.labelSprite = null;
        if (labelOn) {
          rec.labelSprite = textSprite(it.label);
          rec.labelSprite.position.y = (it.role === "pump" ? 1.7 : 0.95);
          rec.labelSprite.userData.fixtureId = it.id;
          rec.group.add(rec.labelSprite);
        }
        rec.label = `${it.label}|${labelOn}`;
      }
      rec.data = it;
      if (!(this.drag?.mode === "move" && this.drag.id === it.id && this.drag.moved)) {
        rec.group.position.set(it.x, it.elevation || 0, it.z);
      }
      rec.group.rotation.y = -((Number(it.rotation) || 0) * Math.PI) / 180;
      // A raised item (laser on a truss, elevated nozzle) stands on a mast down to the ground.
      const elev = Number(it.elevation) || 0;
      if (elev > 0.3) {
        if (!rec.pole) {
          rec.pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 1, 10).translate(0, -0.5, 0),
            new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.6, roughness: 0.4 }));
          rec.group.add(rec.pole);
        }
        rec.pole.scale.y = elev;
      } else if (rec.pole) {
        rec.group.remove(rec.pole);
        disposeObject(rec.pole);
        rec.pole = null;
      }
      rec.base.material.opacity = it.on === false ? 0.18 : 0.55;
      if (rec.lamp) {
        const k = it.on === false ? 0 : Math.max(0, Math.min(1, (it.intensity ?? 100) / 100));
        rec.lamp.material.color.set(it.color || "#ffffff");
        rec.lamp.material.opacity = 0.25 + 0.75 * k;
      }
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this._removeItem(id);
  }

  _createItem(it) {
    const group = new THREE.Group();
    group.userData.fixtureId = it.id;
    const base = new THREE.Mesh(new THREE.CircleGeometry(it.role === "pump" ? 0.55 : 0.36, 32),
      new THREE.MeshBasicMaterial({ color: ROLE_COLOR[it.role] ?? 0x94a3b8, transparent: true, opacity: 0.55, depthWrite: false }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.012;
    group.add(base);
    const ph = placeholder(it.role);
    group.add(ph);
    let lamp = null;
    if (it.role === "light") {
      lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 10),
        new THREE.MeshBasicMaterial({ color: it.color || "#ffffff", transparent: true, opacity: 1 }));
      lamp.position.y = 0.2;
      group.add(lamp);
    }
    const rec = { group, base, model: ph, role: it.role, modelKind: it.modelKind, data: it, lamp, label: "", token: Symbol("model") };
    this._tagPickable(group, it.id);
    this.itemRoot.add(group);
    this.items.set(it.id, rec);
    if (it.modelKind) {
      const token = rec.token;
      loadEquipmentAsset(THREE, it.modelKind).then((asset) => {
        const cur = this.items.get(it.id);
        if (!asset || this.disposed || !cur || cur.token !== token) return;
        const model = asset.template.clone(true);
        model.scale.setScalar(MODEL_SCALE);
        model.userData.sharedAsset = true;
        group.remove(cur.model);
        disposeObject(cur.model);
        cur.model = model;
        group.add(model);
        this._tagPickable(group, it.id);
      }).catch(() => { /* keep the placeholder */ });
    }
    return rec;
  }

  _tagPickable(group, id) {
    group.traverse((o) => { o.userData.fixtureId = id; });
  }

  _removeItem(id) {
    const rec = this.items.get(id);
    if (!rec) return;
    this.itemRoot.remove(rec.group);
    disposeObject(rec.group);
    this.items.delete(id);
    this.jetState.delete(id);
  }

  _portOf(id) {
    const rec = this.items.get(id);
    if (!rec) return null;
    const p = rec.group.position;
    return new THREE.Vector3(p.x, p.y + PORT_Y, p.z);
  }

  _curve(a, b) {
    const d = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 0.25 + 0.12 * d;
    return new THREE.QuadraticBezierCurve3(a, mid, b);
  }

  _buildLinks() {
    for (const o of this.linkObjects) { this.linkRoot.remove(o); o.geometry.dispose(); o.material.dispose(); }
    this.linkObjects = [];
    if (this.data.showLinks === false) return;
    const dragging = this.drag?.mode === "replug" ? this.drag.link.id : null;
    for (const link of this.data.links) {
      const a = this._portOf(link.from), b = this._portOf(link.to);
      if (!a || !b) continue;
      const curve = this._curve(a, b);
      const selected = link.id === this.data.selectedLinkId;
      const color = LINK_COLOR[link.kind] ?? 0xffffff;
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, link.kind === "light" ? 0.022 : (selected ? 0.06 : 0.04), 8),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: selected ? 0.9 : 0.35, transparent: true,
          opacity: dragging === link.id ? 0.15 : (link.kind === "light" ? 0.7 : 0.92), roughness: 0.4 }));
      tube.userData.linkId = link.id;
      this.linkRoot.add(tube);
      this.linkObjects.push(tube);
      // Plugs at both ends, a little way along the line so they are not hidden inside the model.
      for (const [end, t] of [["from", 0.1], ["to", 0.9]]) {
        if (dragging === link.id && this.drag.end === end) continue;
        const plug = new THREE.Mesh(new THREE.SphereGeometry(selected ? 0.15 : 0.12, 16, 12),
          new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: color, emissiveIntensity: 0.8, roughness: 0.3 }));
        plug.position.copy(curve.getPoint(t));
        plug.userData.plug = { linkId: link.id, end };
        plug.renderOrder = 3;
        this.linkRoot.add(plug);
        this.linkObjects.push(plug);
      }
    }
  }

  _buildCones() {
    for (const c of [...this.coneRoot.children]) { this.coneRoot.remove(c); c.geometry.dispose(); c.material.dispose(); }
    for (const it of this.data.items) {
      if (it.role !== "light" || it.on === false) continue;
      const k = Math.max(0, Math.min(1, (it.intensity ?? 100) / 100));
      if (k <= 0) continue;
      // A short, faint beam: enough to show colour and aim without hiding the water.
      const beam = Math.max(5, Math.min(60, it.beamDeg || 40));
      const h = 1.3;
      const r = Math.tan((beam * Math.PI) / 360) * h;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 32, 1, true).translate(0, -h / 2, 0).rotateX(Math.PI),
        new THREE.MeshBasicMaterial({ color: it.color || "#ffffff", transparent: true, opacity: 0.05 * k + 0.015,
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      cone.position.set(it.x, (it.elevation || 0) + 0.2, it.z);
      cone.userData.lightId = it.id;
      this.coneRoot.add(cone);
    }
  }

  _buildBasin(pool) {
    for (const c of [...this.basin.children]) { this.basin.remove(c); disposeObject(c); }
    if (!pool) return;
    let shape;
    if (pool.shape === "circle") {
      shape = new THREE.Shape();
      shape.absarc(0, 0, pool.radius || 6, 0, Math.PI * 2, false);
    } else if (pool.shape === "ellipse") {
      shape = new THREE.Shape();
      shape.absellipse(0, 0, pool.rx || 6, pool.ry || 4, 0, Math.PI * 2, false, 0);
    } else if (pool.points?.length >= 3) {
      // Shape space (x, −z) so that rotation.x = −π/2 lands back on world z.
      shape = new THREE.Shape(pool.points.map((p) => new THREE.Vector2(p.x, -p.z)));
    } else return;
    const water = new THREE.Mesh(new THREE.ShapeGeometry(shape, 64),
      new THREE.MeshStandardMaterial({ color: 0x0b4f7a, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.88 }));
    water.rotation.x = -Math.PI / 2;
    water.position.y = 0.0;
    water.receiveShadow = true;
    // Drawn before every particle effect: the particles write no depth, so a later water surface
    // would paint over the jets, flames and beams standing above it.
    water.renderOrder = -2;
    this.basin.add(water);
    const pts = shape.getSpacedPoints(160).map((p) => new THREE.Vector3(p.x, 0.06, -p.y));
    const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 220, 0.09, 8, true),
      new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.7 }));
    rim.castShadow = true;
    this.basin.add(rim);
    const box = new THREE.Box3().setFromObject(water);
    this.poolSize = Math.max(4, box.max.x - box.min.x, box.max.z - box.min.z);
    if (!this.framed) { this.frameAll(); this.framed = true; }
  }

  /** Frame the basin again the next time it is drawn (a whole new project was loaded). */
  reframeOnNextPool() {
    this.framed = false;
    this.poolKey = null;
  }

  frameAll() {
    const size = this.poolSize || 12;
    this.controls.target.set(0, 1, 0);
    this.camera.position.set(size * 0.12, size * 0.55 + 2.5, size * 0.85 + 3);
    this.controls.update();
  }

  _updateSelection() {
    const rec = this.data.selectedId && this.items.get(this.data.selectedId);
    this.selRing.visible = !!rec;
    if (rec) this.selRing.position.set(rec.group.position.x, rec.group.position.y + 0.03, rec.group.position.z);
  }

  // ─── frame ────────────────────────────────────────────────────────────────

  _loop() {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (!this.container.clientWidth || !this.container.isConnected) return;
    this.time += dt;
    this.controls.update();
    this._updateWater(dt);
    this._updateEffects();
    if (this.selRing.visible) this.selRing.rotation.z += dt * 0.8;
    this.renderer.render(this.scene, this.camera);
  }

  _updateWater(dt) {
    const jets = this.data.jets || [];
    const pos = this.pPos, col = this.pCol, jit = this.jitter;
    const active = jets.filter((j) => (j.heightM > 0.02) || (this.jetState.get(j.id) || 0) > 0.02);
    const per = active.length ? Math.min(1400, Math.floor(MAX_PARTICLES / active.length)) : 0;
    let n = 0, q = 0;
    const t = this.time;
    const tmp = new THREE.Color();
    const white = new THREE.Color(0xd8f1ff);
    for (const jet of jets) {
      // Pump ramp: the jet eases to its new height like a real pump changing speed.
      const target = Math.max(0, jet.heightM || 0);
      const cur = this.jetState.get(jet.id) ?? 0;
      const h = cur + (target - cur) * Math.min(1, dt * 2.2);
      this.jetState.set(jet.id, h);
      if (h < 0.02) continue;
      const rec = this.items.get(jet.id);
      if (!rec) continue;
      const o = rec.group.position;
      const oy = o.y + 0.25;
      const rot = rec.group.rotation.y * -1;
      const outlets = outletsOf(jet, t, rot);
      const each = Math.max(8, Math.floor(per / outlets.length));
      tmp.copy(white);
      if (jet.color) tmp.lerp(new THREE.Color(jet.color), Math.min(1, 0.35 + 0.65 * (jet.intensity || 0)));
      const bright = jet.color ? 0.55 + 0.45 * (jet.intensity || 0) : 0.55;
      for (const out of outlets) {
        let hh = h;
        if (out.mist) hh = Math.min(h, 1.2);
        if (out.pulse) {
          const cyc = (t % 1.6) / 1.6;
          if (cyc > 0.7) continue;
        }
        const v0 = Math.sqrt(2 * G * hh);
        // Flight time of a vertical drop (the longest); tilted drops land earlier and are hidden below the water.
        const T = Math.max(0.25, (2 * v0) / G + 0.08);
        let dx = 0, dz = 0, dy = 1, lift = 0;
        if (!out.at) {
          const sTh = Math.sin(out.th), cTh = Math.cos(out.th);
          dx = sTh * Math.cos(out.ph); dz = sTh * Math.sin(out.ph); dy = cTh;
        }
        for (let i = 0; i < each && n < MAX_PARTICLES; i += 1) {
          const j = (q++ * 3) % jit.length;
          const u = (i / each + 0.37 * jit[j + 2] * 0.05 + 1) % 1;
          const age = ((t / T + u) % 1) * T;
          if (out.at) {
            // Direction at the moment this drop left the nozzle.
            const d = out.at(t - age);
            const sTh = Math.sin(d.th);
            dx = sTh * Math.cos(d.ph); dz = sTh * Math.sin(d.ph); dy = Math.cos(d.th); lift = d.lift || 0;
          }
          const s = out.spread * (out.foam ? 1 + age : 1);
          const vx = v0 * (dx + s * jit[j]);
          const vz = v0 * (dz + s * jit[j + 1]);
          const vy = v0 * dy * (1 + s * 0.5 * jit[j + 2]);
          const y = oy + lift + vy * age - 0.5 * G * age * age;
          if (y < 0) continue;                       // already back in the basin
          const k = n * 3;
          n += 1;
          pos[k] = o.x + vx * age;
          pos[k + 1] = Math.max(0.01, y);
          pos[k + 2] = o.z + vz * age;
          const fade = bright * (1 - 0.55 * (age / T)) * (out.mist ? 0.45 : 1);
          col[k] = tmp.r * fade; col[k + 1] = tmp.g * fade; col[k + 2] = tmp.b * fade;
        }
      }
    }
    const geo = this.particles.geometry;
    geo.setDrawRange(0, n);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  /**
   * Lasers, flames and fog. data.effects: [{ id, kind: 'laser', state, engineering, mountM }
   * | { id, kind: 'flame', heightM, intensity, burst } | { id, kind: 'fog', radiusM, density }].
   * Positions come from the item in the scene, so an effect follows its item while it is dragged.
   */
  _updateEffects() {
    const t = this.time;
    const effects = this.data.effects || [];
    const bPos = this.beams.geometry.attributes.position.array, bCol = this.beams.geometry.attributes.color.array;
    const dPos = this.dots.geometry.attributes.position.array, dCol = this.dots.geometry.attributes.color.array;
    const fPos = this.flames.geometry.attributes.position.array, fCol = this.flames.geometry.attributes.color.array;
    const gPos = this.fog.geometry.attributes.position.array, gCol = this.fog.geometry.attributes.color.array;
    let bv = 0, dn = 0, fn = 0, gn = 0;
    const cam = this.camera.position;

    const quad = (ax, ay, az, bx, by, bz, width, r, g, b) => {
      if (bv + 6 > MAX_BEAM_VERTS) return;
      // Width across the beam, facing the camera.
      const mx = (ax + bx) / 2 - cam.x, my = (ay + by) / 2 - cam.y, mz = (az + bz) / 2 - cam.z;
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      let wx = dy * mz - dz * my, wy = dz * mx - dx * mz, wz = dx * my - dy * mx;
      const l = Math.hypot(wx, wy, wz) || 1;
      wx = (wx / l) * width * 0.5; wy = (wy / l) * width * 0.5; wz = (wz / l) * width * 0.5;
      const v = [ax - wx, ay - wy, az - wz, ax + wx, ay + wy, az + wz, bx + wx, by + wy, bz + wz,
        ax - wx, ay - wy, az - wz, bx + wx, by + wy, bz + wz, bx - wx, by - wy, bz - wz];
      for (let i = 0; i < 18; i += 3) {
        bPos[bv * 3] = v[i]; bPos[bv * 3 + 1] = v[i + 1]; bPos[bv * 3 + 2] = v[i + 2];
        bCol[bv * 3] = r; bCol[bv * 3 + 1] = g; bCol[bv * 3 + 2] = b;
        bv += 1;
      }
    };
    const tri = (a, b, c, r, g, bl) => {
      if (bv + 3 > MAX_BEAM_VERTS) return;
      for (const p of [a, b, c]) {
        bPos[bv * 3] = p.x; bPos[bv * 3 + 1] = p.y; bPos[bv * 3 + 2] = p.z;
        bCol[bv * 3] = r; bCol[bv * 3 + 1] = g; bCol[bv * 3 + 2] = bl;
        bv += 1;
      }
    };
    const dot = (p, r, g, b) => {
      if (dn >= MAX_DOTS) return;
      dPos[dn * 3] = p.x; dPos[dn * 3 + 1] = p.y; dPos[dn * 3 + 2] = p.z;
      dCol[dn * 3] = r; dCol[dn * 3 + 1] = g; dCol[dn * 3 + 2] = b;
      dn += 1;
    };

    for (const fx of effects) {
      const rec = this.items.get(fx.id);
      if (!rec) continue;
      const o = rec.group.position;
      if (fx.kind === "laser") {
        if (!(fx.state?.intensity > 0)) continue;
        const frame = laserFrame({ id: fx.id, x: o.x, z: o.z, y: Math.max(o.y, fx.mountM ?? 0.5), rotation: rec.data.rotation || 0,
          engineering: fx.engineering || {} }, fx.state, t, { basin: this.data.safetyBasin || null });
        fx.frame = frame;
        const k = frame.intensity * (frame.faint ? 0.5 : 1);
        const { r, g, b } = frame.color;
        const end = (beam) => {
          const len = Math.min(beam.length, BEAM_DRAW_M);
          return { x: frame.origin.x + beam.dir.x * len, y: frame.origin.y + beam.dir.y * len, z: frame.origin.z + beam.dir.z * len };
        };
        const ends = frame.beams.map(end);
        if (frame.sheet && ends.length > 1) {
          for (let i = 1; i < ends.length; i += 1) tri(frame.origin, ends[i - 1], ends[i], r * k * 0.12, g * k * 0.12, b * k * 0.12);
        }
        frame.beams.forEach((beam, i) => {
          const e = ends[i];
          const gk = k * (beam.glint ?? 1);
          const core = frame.heavy ? 0.22 : frame.faint ? 0.02 : 0.045;
          quad(frame.origin.x, frame.origin.y, frame.origin.z, e.x, e.y, e.z, core, r * gk, g * gk, b * gk);
          quad(frame.origin.x, frame.origin.y, frame.origin.z, e.x, e.y, e.z, core * 7, r * gk * 0.16, g * gk * 0.16, b * gk * 0.16);
          if (beam.hit || frame.faint) dot(e, r * gk, g * gk, b * gk);
        });
        for (const s of frame.outline || []) quad(s.a.x, s.a.y, s.a.z, s.b.x, s.b.y, s.b.z, 0.08, r * k, g * k, b * k);
        dot(frame.origin, r * k, g * k, b * k);
      } else if (fx.kind === "flame") {
        if (!(fx.intensity > 0)) continue;
        // Burst mode: 0.8 s puffs every 2.5 s.
        const env = fx.burst ? Math.max(0, Math.sin(Math.min(1, (t % 2.5) / 0.8) * Math.PI)) * ((t % 2.5) < 0.8 ? 1 : 0) : 1;
        if (env <= 0.01) continue;
        const H = fx.heightM * fx.intensity * env;
        const count = 900;
        for (let i = 0; i < count && fn < MAX_FLAME; i += 1) {
          const j = (i * 3) % this.jitter.length;
          const T = 0.7 + 0.25 * this.jitter[j];
          const age = ((t / T + i / count) % 1);
          // Wide at the burner, licking to a point at the top.
          const rad = 0.42 * Math.sqrt(1 - age) * (0.55 + 0.45 * this.jitter[j + 1]) * Math.max(0.5, fx.intensity);
          const a = i * 2.39996 + t * 3;
          fPos[fn * 3] = o.x + rad * Math.cos(a) + 0.06 * Math.sin(t * 11 + i);
          fPos[fn * 3 + 1] = o.y + 0.25 + age * H * (0.85 + 0.15 * this.jitter[j + 2]);
          fPos[fn * 3 + 2] = o.z + rad * Math.sin(a) + 0.06 * Math.cos(t * 9 + i);
          const heat = 1 - age;                     // white-yellow at the base → orange → dark red
          const fade = Math.min(1, Math.max(0, 1 - age * 1.05) * 1.25);
          fCol[fn * 3] = fade; fCol[fn * 3 + 1] = (0.22 + 0.7 * heat * heat) * fade; fCol[fn * 3 + 2] = 0.25 * heat * heat * heat * fade;
          fn += 1;
        }
      } else if (fx.kind === "fog") {
        if (!(fx.density > 0)) continue;
        const count = Math.round(140 + 180 * fx.density);
        for (let i = 0; i < count && gn < MAX_FOG; i += 1) {
          const j = (i * 3) % this.jitter.length;
          const r0 = fx.radiusM * Math.sqrt(0.5 + 0.5 * this.jitter[j]);
          const a = i * 2.39996 + t * 0.06 * (0.5 + 0.5 * this.jitter[j + 1]);
          gPos[gn * 3] = o.x + r0 * Math.cos(a);
          gPos[gn * 3 + 1] = 0.2 + 0.7 * (0.5 + 0.5 * this.jitter[j + 2]) + 0.12 * Math.sin(t * 0.4 + i);
          gPos[gn * 3 + 2] = o.z + r0 * Math.sin(a);
          const c = 0.55 * fx.density;
          gCol[gn * 3] = c; gCol[gn * 3 + 1] = c * 1.02; gCol[gn * 3 + 2] = c * 1.06;
          gn += 1;
        }
      }
    }
    const finish = (obj, count) => {
      const g = obj.geometry;
      g.setDrawRange(0, count);
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    };
    finish(this.beams, bv);
    finish(this.dots, dn);
    finish(this.flames, fn);
    finish(this.fog, gn);
  }

  /** The laser frame drawn last for an item (beams, blanked / clamped counts), for the sidebar. */
  laserStatus(id) {
    const fx = (this.data.effects || []).find((e) => e.id === id && e.kind === "laser");
    return fx?.frame ? { beams: fx.frame.beams.length, blanked: fx.frame.blanked, clamped: fx.frame.clamped } : null;
  }

  // ─── input ────────────────────────────────────────────────────────────────

  _bind() {
    const el = this.renderer.domElement;
    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onUp = (e) => this._pointerUp(e);
    this._onDragOver = (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("application/x-aquaflow-asset")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      const p = this._groundAt(e);
      this.ghost.visible = !!p;
      if (p) this.ghost.position.set(p.x, 0.04, p.z);
    };
    this._onDragLeave = () => { this.ghost.visible = false; };
    this._onDrop = (e) => {
      const key = e.dataTransfer?.getData("application/x-aquaflow-asset");
      this.ghost.visible = false;
      if (!key) return;
      e.preventDefault();
      const p = this._groundAt(e);
      if (p) this.handlers.onDrop?.(key, { x: p.x, z: p.z });
    };
    // Capture phase: decide (move item / re-plug / orbit) before OrbitControls starts a rotate.
    el.addEventListener("pointerdown", this._onDown, true);
    window.addEventListener("pointermove", this._onMove);
    window.addEventListener("pointerup", this._onUp);
    el.addEventListener("dragover", this._onDragOver);
    el.addEventListener("dragleave", this._onDragLeave);
    el.addEventListener("drop", this._onDrop);
  }

  _setPointer(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  _groundAt(e, height = 0) {
    this._setPointer(e);
    this.groundPlane.constant = -height;
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }

  _hit(e) {
    this._setPointer(e);
    const plugs = this.linkObjects.filter((o) => o.userData.plug);
    const ph = this.raycaster.intersectObjects(plugs, false)[0];
    if (ph) return { plug: ph.object.userData.plug };
    const ih = this.raycaster.intersectObjects(this.itemRoot.children, true).find((h) => h.object.userData.fixtureId && !h.object.isSprite);
    const lh = this.raycaster.intersectObjects(this.linkObjects.filter((o) => o.userData.linkId), false)[0];
    if (ih && (!lh || ih.distance <= lh.distance + 0.2)) return { fixtureId: ih.object.userData.fixtureId };
    if (lh) return { linkId: lh.object.userData.linkId };
    // Labels are easy targets too.
    const sh = this.raycaster.intersectObjects(this.itemRoot.children, true).find((h) => h.object.isSprite);
    if (sh) return { fixtureId: sh.object.userData.fixtureId };
    return {};
  }

  _fixtureUnder(e, exclude) {
    this._setPointer(e);
    const hit = this.raycaster.intersectObjects(this.itemRoot.children, true).find((h) => h.object.userData.fixtureId && h.object.userData.fixtureId !== exclude);
    if (hit) return hit.object.userData.fixtureId;
    // Near miss on the ground: the closest item within 0.8 m.
    const p = this._groundAt(e);
    if (!p) return null;
    let best = null, bestD = 0.8;
    for (const [id, rec] of this.items) {
      if (id === exclude) continue;
      const d = Math.hypot(rec.group.position.x - p.x, rec.group.position.z - p.z);
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  }

  _pointerDown(e) {
    if (e.button !== 0) return;
    this.renderer.domElement.focus();
    const hit = this._hit(e);
    this.downAt = { x: e.clientX, y: e.clientY };
    if (hit.plug) {
      const link = this.data.links.find((l) => l.id === hit.plug.linkId);
      if (!link) return;
      this.controls.enabled = false;
      this.drag = { mode: "replug", link, end: hit.plug.end, fixed: hit.plug.end === "from" ? link.to : link.from, target: null };
      this.handlers.onSelectLink?.(link.id);
      this._buildLinks();
      this._updateDragLine(e);
      return;
    }
    if (hit.fixtureId) {
      this.controls.enabled = false;
      const rec = this.items.get(hit.fixtureId);
      const p = this._groundAt(e, rec?.group.position.y || 0);
      this.drag = { mode: "move", id: hit.fixtureId, moved: false,
        offset: p && rec ? new THREE.Vector3(rec.group.position.x - p.x, 0, rec.group.position.z - p.z) : new THREE.Vector3() };
      this.handlers.onSelect?.(hit.fixtureId);
      return;
    }
    this.drag = { mode: "click", linkId: hit.linkId || null };
  }

  _pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const far = this.downAt && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4;
    if (d.mode === "move" && (d.moved || far)) {
      const rec = this.items.get(d.id);
      if (!rec) return;
      const p = this._groundAt(e, rec.group.position.y);
      if (!p) return;
      d.moved = true;
      rec.group.position.x = p.x + d.offset.x;
      rec.group.position.z = p.z + d.offset.z;
      // Lights, cones and lines follow the item while it moves.
      const it = this.data.items.find((x) => x.id === d.id);
      if (it) { it.x = rec.group.position.x; it.z = rec.group.position.z; }
      this._buildLinks();
      this._buildCones();
      this._updateSelection();
    } else if (d.mode === "replug") {
      this._updateDragLine(e);
    } else if (d.mode === "click" && far) {
      d.mode = "orbit";
    }
  }

  _updateDragLine(e) {
    const d = this.drag;
    const a = this._portOf(d.fixed);
    if (!a) return;
    const target = this._fixtureUnder(e, d.fixed);
    d.target = target;
    let b;
    if (target) b = this._portOf(target);
    else b = this._groundAt(e, 0) || a.clone();
    const ok = target ? (this.handlers.canConnect?.(d.fixed, target) ?? true) : true;
    const curve = this._curve(a, b);
    this.dragLine.geometry.dispose();
    this.dragLine.geometry = new THREE.TubeGeometry(curve, 24, 0.045, 8);
    this.dragLine.material.color.set(target ? (ok ? 0x22c55e : 0xef4444) : 0xffffff);
    this.dragLine.visible = true;
    this.hoverRing.visible = !!target;
    if (target) {
      const p = this.items.get(target).group.position;
      this.hoverRing.position.set(p.x, p.y + 0.03, p.z);
      this.hoverRing.material.color.set(ok ? 0x22c55e : 0xef4444);
    }
  }

  _pointerUp() {
    const d = this.drag;
    this.drag = null;
    this.controls.enabled = true;
    if (!d) return;
    if (d.mode === "move") {
      if (d.moved) {
        const rec = this.items.get(d.id);
        if (rec) this.handlers.onMoveEnd?.(d.id, { x: rec.group.position.x, z: rec.group.position.z });
      }
    } else if (d.mode === "replug") {
      this.dragLine.visible = false;
      this.hoverRing.visible = false;
      this.handlers.onReplug?.(d.link.id, d.end, d.target || null);
      this._buildLinks();
    } else if (d.mode === "click") {
      if (d.linkId) this.handlers.onSelectLink?.(d.linkId);
      else this.handlers.onSelect?.(null);
    }
  }

  /** Where plugs and items are on screen (client px) — for automated UI checks. */
  screenPositions() {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toScreen = (v) => {
      const p = v.clone().project(this.camera);
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    };
    return {
      plugs: this.linkObjects.filter((o) => o.userData.plug).map((o) => ({ ...o.userData.plug, ...toScreen(o.position) })),
      items: [...this.items.entries()].map(([id, rec]) => ({ id, ...toScreen(rec.group.position.clone().setY(rec.group.position.y + 0.15)) })),
    };
  }

  /** Plan point at the middle of the current view (where "click to add" puts an item). */
  viewCenter() {
    const t = this.controls.target;
    return { x: t.x, z: t.z };
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener("pointerdown", this._onDown, true);
    window.removeEventListener("pointermove", this._onMove);
    window.removeEventListener("pointerup", this._onUp);
    el.removeEventListener("dragover", this._onDragOver);
    el.removeEventListener("dragleave", this._onDragLeave);
    el.removeEventListener("drop", this._onDrop);
    this.controls.dispose();
    disposeObject(this.scene);
    this.sprite.dispose();
    this.renderer.dispose();
    el.remove();
  }
}

/** Free GPU memory under `root`, except GLB clones: they share geometry with the cached template. */
function disposeObject(root) {
  if (!root || root.userData?.sharedAsset) return;
  root.geometry?.dispose?.();
  const mats = Array.isArray(root.material) ? root.material : root.material ? [root.material] : [];
  for (const m of mats) { m.map?.dispose?.(); m.dispose?.(); }
  for (const child of root.children || []) disposeObject(child);
}
