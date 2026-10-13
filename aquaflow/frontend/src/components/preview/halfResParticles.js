/**
 * halfResParticles.js — AF-3D-008 (realism plan item, CAD/design render plan Phase 3)
 *
 * Spray and mist render into a HALF-resolution target and are composited back with
 * a depth-aware ("nearest-depth") upsample.
 *
 * WHY
 * ---
 * Spray and mist are large, soft, overlapping, low-alpha sprites: their cost is
 * overdraw (fill rate), not vertex work, and their content is low-frequency. A
 * quarter of the pixels buys back most of that fill rate with no visible loss —
 * EXCEPT at depth discontinuities. A naive bilinear upsample smears spray that sits
 * behind the pool wall across the wall's silhouette (the "halo"). Nearest-depth
 * upsampling fixes that: each full-res pixel looks at the opaque depth under its four
 * neighbouring low-res texels and, when they disagree, takes the texel whose depth
 * matches its own.
 *
 * HOW
 * ---
 *   1. The opaque-scene depth probe (sceneDepth.js) runs at FULL resolution while
 *      this pass is on — it is the reference depth for the upsample.
 *   2. Spray meshes render into a HalfFloat RGBA target at `scale` x the drawing
 *      buffer, cleared to transparent. Their existing soft-particle test reads the
 *      full-res probe, so occlusion by the wall/deck happens per low-res texel.
 *   3. A ShaderPass, inserted after the scene RenderPass (linear HDR, before tone
 *      mapping), composites the premultiplied result with nearest-depth upsampling.
 *
 * Tier gating: always on for `high`, a user toggle on `medium`, never on `low` (no
 * post chain to composite in).
 */

/** Is the half-res spray pass on for this tier + user setting? */
export function halfResSprayEnabled(quality, userToggle) {
  if (quality === "high" || quality === "eco") return true;   // eco: AF-NEXT-013
  if (quality === "medium") return !!userToggle;
  return false;
}

/** Relative view-depth difference above which the four taps are treated as an edge. */
export const EDGE_THRESHOLD = 0.04;

export const HALF_RES_COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse:   { value: null },
    tParticles: { value: null },
    tDepth:     { value: null },
    uLowRes:    { value: null },
    uNear:      { value: 0.1 },
    uFar:       { value: 500 },
    uEdge:      { value: EDGE_THRESHOLD },
    uEnabled:   { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tParticles;
    uniform sampler2D tDepth;
    uniform vec2  uLowRes;
    uniform float uNear, uFar, uEdge, uEnabled;
    varying vec2 vUv;

    float viewDepth(vec2 uv){
      float d = texture2D(tDepth, uv).x;
      return (uNear * uFar) / (uFar - (uFar - uNear) * d);   // positive metres
    }

    void main(){
      vec4 scene = texture2D(tDiffuse, vUv);
      if (uEnabled < 0.5) { gl_FragColor = scene; return; }

      vec2 texel = 1.0 / uLowRes;
      // Centres of the four low-res texels surrounding this full-res pixel.
      vec2 base = (floor(vUv * uLowRes - 0.5) + 0.5) * texel;
      vec2 uv0 = base;
      vec2 uv1 = base + vec2(texel.x, 0.0);
      vec2 uv2 = base + vec2(0.0, texel.y);
      vec2 uv3 = base + texel;

      float dFull = viewDepth(vUv);
      float e0 = abs(viewDepth(uv0) - dFull);
      float e1 = abs(viewDepth(uv1) - dFull);
      float e2 = abs(viewDepth(uv2) - dFull);
      float e3 = abs(viewDepth(uv3) - dFull);

      vec4 p;
      if (max(max(e0, e1), max(e2, e3)) < uEdge * dFull) {
        // Smooth region: plain bilinear is both correct and the softest result.
        p = texture2D(tParticles, vUv);
      } else {
        // Depth edge: take the texel that sits on the same surface as this pixel.
        vec2 best = uv0; float be = e0;
        if (e1 < be) { be = e1; best = uv1; }
        if (e2 < be) { be = e2; best = uv2; }
        if (e3 < be) { be = e3; best = uv3; }
        p = texture2D(tParticles, best);
      }
      // Premultiplied "over", exactly the blend the particles use at full res.
      gl_FragColor = vec4(p.rgb + scene.rgb * (1.0 - p.a), scene.a);
    }
  `,
};

/** Low-res target size for a drawing buffer (device pixels). */
export function lowResSize(width, height, scale = 0.5) {
  return {
    width: Math.max(2, Math.floor(width * scale)),
    height: Math.max(2, Math.floor(height * scale)),
  };
}

export class HalfResParticlePass {
  /**
   * @param {object} THREE
   * @param {object} renderer live WebGLRenderer
   * @param {object} opts { width, height (device px), scale }
   */
  constructor(THREE, renderer, { width = 900, height = 600, scale = 0.5 } = {}) {
    this.T = THREE;
    this.renderer = renderer;
    this.scale = scale;
    const { width: w, height: h } = lowResSize(width, height, scale);
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.lowRes = new THREE.Vector2(w, h);
    this._clear = new THREE.Color(0, 0, 0);
    this.pass = null;
  }

  setSize(width, height) {
    const { width: w, height: h } = lowResSize(width, height, this.scale);
    this.target.setSize(w, h);
    this.lowRes.set(w, h);
  }

  /** Build the composite ShaderPass (caller supplies the ShaderPass class). */
  createCompositePass(ShaderPass, depthTexture, camera) {
    const pass = new ShaderPass(HALF_RES_COMPOSITE_SHADER);
    const u = pass.uniforms;
    u.tParticles.value = this.target.texture;
    u.tDepth.value = depthTexture || null;
    u.uLowRes.value = this.lowRes;
    u.uNear.value = camera?.near ?? 0.1;
    u.uFar.value = camera?.far ?? 500;
    u.uEnabled.value = depthTexture ? 1.0 : 0.0;
    this.pass = pass;
    return pass;
  }

  setDepth(depthTexture) {
    if (!this.pass) return;
    this.pass.uniforms.tDepth.value = depthTexture || null;
    this.pass.uniforms.uEnabled.value = depthTexture ? 1.0 : 0.0;
  }

  /**
   * Render the given (visible) objects into the low-res target. The caller hides
   * them for the full-res pass afterwards.
   */
  render(objects, camera) {
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const prevAuto = r.autoClear;
    const prevShadow = r.shadowMap.autoUpdate;
    const prevXR = r.xr.enabled;
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this._prevClear || (this._prevClear = new this.T.Color()));
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false;
    r.autoClear = false;
    r.setRenderTarget(this.target);
    r.setClearColor(this._clear, 0);
    r.clear(true, false, false);
    for (const o of objects) if (o?.visible) r.render(o, camera);
    r.setClearColor(this._prevClear, prevAlpha);
    r.setRenderTarget(prevTarget);
    r.autoClear = prevAuto;
    r.shadowMap.autoUpdate = prevShadow;
    r.xr.enabled = prevXR;
  }

  dispose() {
    this.target.dispose();
    this.pass?.material?.dispose?.();
    this.pass = null;
  }
}
