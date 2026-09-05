/**
 * sceneDepth.js — AF-3D-001 (realism plan, Phase R1)
 *
 * Opaque-scene depth prepass for soft particles and volumetric light cones.
 *
 * Soft particles need to know how far behind each fragment the solid world is,
 * and the main pass cannot supply that: the particles render in the same pass as
 * the geometry, so its depth buffer is not samplable while they draw. This probe
 * renders the OPAQUE scene only (particles, water surface, glow billboards and
 * every other transparent overlay hidden) into an offscreen target with a depth
 * texture attached, once per frame, before the main render.
 *
 * COST — one extra scene pass, kept cheap three ways:
 *   • a flat-white override material replaces all shading (depth is all we keep);
 *   • the target runs at a fraction of canvas resolution (`scale`); depth used for
 *     a fade needs far less precision than an image;
 *   • shadow-map updates are frozen during the pass.
 *
 * Follows the WaterReflectionProbe pattern: an enhancement, never a dependency —
 * construction failure means the particles simply keep their hard edges.
 */

export class SceneDepthProbe {
  /**
   * @param {object} THREE the three namespace in use
   * @param {object} renderer the live WebGLRenderer
   * @param {object} opts { width, height, scale }
   */
  constructor(THREE, renderer, { width = 900, height = 600, scale = 0.5 } = {}) {
    this.T = THREE;
    this.renderer = renderer;
    this.scale = scale;
    this.enabled = true;

    const T = THREE;
    this._override = new T.MeshBasicMaterial({ color: 0xffffff });
    this._makeTarget(width, height);
  }

  _makeTarget(width, height) {
    const T = this.T;
    const w = Math.max(2, Math.floor(width * this.scale));
    const h = Math.max(2, Math.floor(height * this.scale));
    const depthTexture = new T.DepthTexture(w, h);
    depthTexture.type = T.UnsignedIntType;
    this.target = new T.WebGLRenderTarget(w, h, {
      minFilter: T.NearestFilter,
      magFilter: T.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
      depthTexture,
    });
    this.texture = depthTexture;
  }

  /** Track the canvas size (device pixels). */
  setSize(width, height) {
    const w = Math.max(2, Math.floor(width * this.scale));
    const h = Math.max(2, Math.floor(height * this.scale));
    if (this.target.width === w && this.target.height === h) return;
    // A depth texture cannot be resized in place across drivers; rebuild the target.
    this.target.dispose();
    this._makeTarget(width, height);
  }

  /**
   * Render one depth pass.
   *
   * @param {object} scene
   * @param {object} camera the real, already-positioned camera
   * @param {Array}  hidden transparent objects to suppress (particles, water, overlays)
   * @returns {boolean} whether the target holds a fresh frame
   */
  update(scene, camera, hidden = []) {
    if (!this.enabled) return false;
    const r = this.renderer;

    const restore = [];
    for (const o of hidden) {
      if (o) { restore.push([o, o.visible]); o.visible = false; }
    }
    const prevOverride = scene.overrideMaterial;
    const prevTarget = r.getRenderTarget();
    const prevXR = r.xr.enabled;
    const prevShadow = r.shadowMap.autoUpdate;

    scene.overrideMaterial = this._override;
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);

    r.setRenderTarget(prevTarget);
    r.xr.enabled = prevXR;
    r.shadowMap.autoUpdate = prevShadow;
    scene.overrideMaterial = prevOverride;
    for (const [o, v] of restore) o.visible = v;
    return true;
  }

  dispose() {
    this.target?.dispose();
    this._override?.dispose();
  }
}
