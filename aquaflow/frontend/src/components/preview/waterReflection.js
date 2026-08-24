/**
 * waterReflection.js — a real mirror image in the pool.
 *
 * Before this, the water's fresnel term mixed toward a FLAT CONSTANT sky colour. That
 * is why the basin read as a dark translucent sheet rather than as water: at grazing
 * angles a real water surface is almost a perfect mirror, and at night a fountain's
 * image is dominated by the inverted copy of its own jets, fixtures and architecture.
 * A constant cannot produce that, no matter how good the waves and caustics above it are.
 *
 * This renders the scene from a camera mirrored through the water plane into an offscreen
 * target, and hands the water shader a texture plus the matrix to project it with. The
 * shader then perturbs the lookup by the Gerstner wave normal, so the reflection breaks up
 * and streams with the surface exactly as a real one does — the effect that sells water.
 *
 * COST
 * ----
 * One extra scene render per update. Three things keep that affordable:
 *   • the target is a fraction of canvas resolution (reflections are wave-distorted, so
 *     detail there is wasted),
 *   • `interval` renders it every Nth frame — a reflection is low-frequency and tolerates
 *     the staleness far better than the direct image does,
 *   • it is off entirely on the `low` tier, which exists for weak GPUs.
 *
 * Oblique near-plane clipping keeps anything below the waterline out of the reflection,
 * which is what stops the pool floor and the submerged half of each fixture from
 * appearing in the mirror image.
 */

export class WaterReflectionProbe {
  /**
   * @param {object} THREE the three namespace in use
   * @param {object} renderer the live WebGLRenderer
   * @param {object} opts
   * @param {number} opts.resolution square target size in pixels
   * @param {number} opts.interval render every Nth call (1 = every frame)
   */
  constructor(THREE, renderer, { resolution = 512, interval = 1 } = {}) {
    this.T = THREE;
    this.renderer = renderer;
    this.interval = Math.max(1, interval | 0);
    this._frame = 0;
    this.enabled = true;

    const T = THREE;
    this.target = new T.WebGLRenderTarget(resolution, resolution, {
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      // The reflection is composited into a shader that runs before tone mapping,
      // so it must stay in the same linear working space as the rest of the scene.
      type: T.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    if (T.LinearSRGBColorSpace) this.target.texture.colorSpace = T.LinearSRGBColorSpace;

    this.texture = this.target.texture;
    this.textureMatrix = new T.Matrix4();
    this.virtualCamera = new T.PerspectiveCamera();

    // Scratch — allocated once; this runs every frame.
    this._planePoint = new T.Vector3();
    this._camPos = new T.Vector3();
    this._normal = new T.Vector3(0, 1, 0);
    this._view = new T.Vector3();
    this._target = new T.Vector3();
    this._lookAt = new T.Vector3();
    this._rotation = new T.Matrix4();
    this._clipPlane = new T.Plane();
    this._clipVec = new T.Vector4();
    this._q = new T.Vector4();
  }

  /**
   * Render one reflection pass.
   *
   * @param {object} scene
   * @param {object} camera the real camera
   * @param {number} waterY height of the water plane in world metres
   * @param {Array}  hidden objects to suppress while rendering (the water itself, overlays)
   * @returns {boolean} whether the target was refreshed this call
   */
  update(scene, camera, waterY, hidden = []) {
    if (!this.enabled) return false;
    // Frame skipping. The reflection is low-frequency; the eye does not track its lag.
    if (this._frame++ % this.interval !== 0) return false;

    const T = this.T;
    const cam = this.virtualCamera;

    this._planePoint.set(0, waterY, 0);
    this._camPos.setFromMatrixPosition(camera.matrixWorld);

    // A camera at or below the surface has no mirror image to show; rendering one
    // produces a flipped, inside-out frame. Keep the last good reflection instead.
    if (this._camPos.y <= waterY + 1e-3) return false;

    // Mirror the eye position through the plane.
    this._view.subVectors(this._planePoint, this._camPos);
    this._view.reflect(this._normal).negate().add(this._planePoint);

    // Mirror the point being looked at, so the virtual camera's orientation matches.
    this._rotation.extractRotation(camera.matrixWorld);
    this._lookAt.set(0, 0, -1).applyMatrix4(this._rotation).add(this._camPos);
    this._target.subVectors(this._planePoint, this._lookAt);
    this._target.reflect(this._normal).negate().add(this._planePoint);

    cam.position.copy(this._view);
    cam.up.set(0, 1, 0).applyMatrix4(this._rotation).reflect(this._normal);
    cam.lookAt(this._target);
    cam.near = camera.near;
    cam.far = camera.far;
    cam.fov = camera.fov;
    cam.aspect = camera.aspect;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);

    // World → reflection-texture UV, applied in the water shader.
    this.textureMatrix.set(
      0.5, 0.0, 0.0, 0.5,
      0.0, 0.5, 0.0, 0.5,
      0.0, 0.0, 0.5, 0.5,
      0.0, 0.0, 0.0, 1.0
    );
    this.textureMatrix.multiply(cam.projectionMatrix);
    this.textureMatrix.multiply(cam.matrixWorldInverse);

    // Oblique near-plane clip at the waterline, so submerged geometry cannot leak in.
    this._clipPlane.setFromNormalAndCoplanarPoint(this._normal, this._planePoint);
    this._clipPlane.applyMatrix4(cam.matrixWorldInverse);
    this._clipVec.set(
      this._clipPlane.normal.x,
      this._clipPlane.normal.y,
      this._clipPlane.normal.z,
      this._clipPlane.constant
    );
    const proj = cam.projectionMatrix;
    this._q.x = (Math.sign(this._clipVec.x) + proj.elements[8]) / proj.elements[0];
    this._q.y = (Math.sign(this._clipVec.y) + proj.elements[9]) / proj.elements[5];
    this._q.z = -1.0;
    this._q.w = (1.0 + proj.elements[10]) / proj.elements[14];
    this._clipVec.multiplyScalar(2.0 / this._clipVec.dot(this._q));
    proj.elements[2]  = this._clipVec.x;
    proj.elements[6]  = this._clipVec.y;
    proj.elements[10] = this._clipVec.z + 1.0 - 0.0;
    proj.elements[14] = this._clipVec.w;

    // Render, with the water plane and any analysis overlay suppressed.
    const restore = [];
    for (const o of hidden) {
      if (o) { restore.push([o, o.visible]); o.visible = false; }
    }

    const prevTarget = this.renderer.getRenderTarget();
    const prevXR = this.renderer.xr.enabled;
    const prevShadow = this.renderer.shadowMap.autoUpdate;
    this.renderer.xr.enabled = false;          // reflections are not rendered per-eye
    this.renderer.shadowMap.autoUpdate = false; // reuse the main pass's shadow maps

    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, cam);

    this.renderer.setRenderTarget(prevTarget);
    this.renderer.xr.enabled = prevXR;
    this.renderer.shadowMap.autoUpdate = prevShadow;
    for (const [o, v] of restore) o.visible = v;

    return true;
  }

  setSize(resolution) {
    this.target.setSize(resolution, resolution);
  }

  dispose() {
    this.target.dispose();
  }
}
