const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform float exposure;
varying vec2 vUv;

vec3 toACEScg(vec3 rgb) {
  return vec3(
    dot(vec3(0.6130978124, 0.3395231468, 0.0473794522), rgb),
    dot(vec3(0.0701945425, 0.9163538791, 0.0134516783), rgb),
    dot(vec3(0.0206156595, 0.1095697729, 0.8698146345), rgb)
  );
}
vec3 toSRGB(vec3 rgb) {
  return vec3(
    dot(vec3(1.7050506905, -0.6217919497, -0.0832593745), rgb),
    dot(vec3(-0.1302579400, 1.1408051787, -0.0105472983), rgb),
    dot(vec3(-0.0240032884, -0.1289689881, 1.1529722221), rgb)
  );
}
vec3 curve(vec3 x) {
  vec3 v = x / 0.6;
  return clamp((v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.432951) + 0.238081), 0.0, 1.0);
}
vec3 encodeSRGB(vec3 value) {
  vec3 lo = value * 12.92;
  vec3 hi = 1.055 * pow(value, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), value));
}
void main() {
  vec3 hdr = clamp(texture2D(tDiffuse, vUv).rgb, 0.0, 6.0e4) * exposure;
  vec3 display = encodeSRGB(clamp(toSRGB(curve(toACEScg(hdr))), 0.0, 1.0));
  gl_FragColor = vec4(display, 1.0);
}
`;

export function createACEScgOutputPass(ShaderPass) {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, exposure: { value: 1 } },
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: FRAGMENT,
  });
}
