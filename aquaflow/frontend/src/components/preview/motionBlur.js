import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

const BLEND = {
  uniforms: { uInput: { value: null }, uWeight: { value: 1 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D uInput;
    uniform float uWeight;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(uInput, vUv) * uWeight; }
  `,
};

export class MotionBlurAccumulator {
  constructor(T, renderer, { width, height }) {
    this.T = T;
    this.renderer = renderer;
    this.target = new T.WebGLRenderTarget(width, height, {
      type: T.HalfFloatType,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: true,
    });
    this.accumulated = new T.WebGLRenderTarget(width, height, {
      type: T.HalfFloatType,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: false,
    });
    this.material = new T.ShaderMaterial(BLEND);
    this.quad = new FullScreenQuad(this.material);
  }

  render(sampleCount, renderSample) {
    const count = Math.max(1, Math.floor(sampleCount));
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousClearColor = renderer.getClearColor(new this.T.Color());
    const previousAlpha = renderer.getClearAlpha();
    try {
      renderer.setRenderTarget(this.accumulated);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.autoClear = false;
      for (let index = 0; index < count; index++) {
        renderer.setRenderTarget(this.target);
        renderer.clear();
        renderSample(index);
        this.material.uniforms.uInput.value = this.target.texture;
        this.material.uniforms.uWeight.value = 1 / count;
        renderer.setRenderTarget(this.accumulated);
        this.quad.render(renderer);
      }
      this.material.uniforms.uInput.value = this.accumulated.texture;
      this.material.uniforms.uWeight.value = 1;
      renderer.setRenderTarget(null);
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(previousClearColor, previousAlpha);
      renderer.autoClear = previousAutoClear;
    }
  }

  dispose() {
    this.target.dispose();
    this.accumulated.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
