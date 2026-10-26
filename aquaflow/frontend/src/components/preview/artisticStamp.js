/**
 * artisticStamp.js — the "Artistic preview — not real-world" corner stamp.
 *
 * Drawn INTO the WebGL frame (after the post chain) whenever the preview is in artistic
 * mode (render setting realWorld: false), so every output made from the canvas — PNG
 * screenshot, live recording, baked video, PNG sequence — carries it and nobody mistakes
 * an artistic look for a real-world simulation. One sprite, one draw call.
 */

export const ARTISTIC_STAMP_TEXT = "Artistic preview — not real-world";

/**
 * Stamp rectangle in canvas CSS pixels (origin bottom-left, as the HUD camera uses):
 * bottom-right corner, height ~3.2 % of the frame (min 14 px), text aspect 12:1.
 * @returns {{w:number, h:number, x:number, y:number}}  size and CENTRE
 */
export function stampLayout(width, height, aspect = 12) {
  const W = Math.max(1, Number(width) || 1), Hh = Math.max(1, Number(height) || 1);
  const margin = Math.max(6, Math.round(Hh * 0.018));
  let h = Math.max(14, Math.round(Hh * 0.032));
  let w = h * aspect;
  const maxW = W - 2 * margin;
  if (w > maxW) { w = Math.max(10, maxW); h = w / aspect; }
  return { w, h, x: W - margin - w / 2, y: margin + h / 2 };
}

/** Text texture (a 2D canvas) — dark pill, amber border, white text. */
function drawLabel(doc, text) {
  const c = doc.createElement("canvas");
  c.width = 1152; c.height = 96;
  const g = c.getContext("2d");
  if (!g) return null;
  const r = 30;
  g.fillStyle = "rgba(10,14,22,0.78)";
  g.strokeStyle = "rgba(255,190,70,0.95)";
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(r, 3); g.lineTo(c.width - r, 3); g.quadraticCurveTo(c.width - 3, 3, c.width - 3, r);
  g.lineTo(c.width - 3, c.height - r); g.quadraticCurveTo(c.width - 3, c.height - 3, c.width - r, c.height - 3);
  g.lineTo(r, c.height - 3); g.quadraticCurveTo(3, c.height - 3, 3, c.height - r);
  g.lineTo(3, r); g.quadraticCurveTo(3, 3, r, 3);
  g.closePath(); g.fill(); g.stroke();
  g.fillStyle = "#ffffff";
  g.font = "600 52px system-ui, -apple-system, 'Segoe UI', sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 2, c.width - 60);
  return c;
}

/**
 * A HUD that draws the stamp over the current frame. `render(renderer)` must run after
 * the frame has been drawn to the canvas (render target null).
 */
export function createArtisticStamp(THREE, { text = ARTISTIC_STAMP_TEXT, doc = globalThis.document } = {}) {
  if (!THREE || !doc?.createElement) return null;
  const label = drawLabel(doc, text);
  if (!label) return null;
  const tex = new THREE.CanvasTexture(label);
  if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const sprite = new THREE.Sprite(mat);
  const scene = new THREE.Scene();
  scene.add(sprite);
  const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const size = new THREE.Vector2();
  const aspect = label.width / label.height;
  return {
    render(renderer) {
      renderer.getSize(size);
      const L = stampLayout(size.x, size.y, aspect);
      camera.right = size.x; camera.top = size.y; camera.updateProjectionMatrix();
      sprite.scale.set(L.w, L.h, 1);
      sprite.position.set(L.x, L.y, 0);
      const autoClear = renderer.autoClear, target = renderer.getRenderTarget();
      renderer.autoClear = false;
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      renderer.setRenderTarget(target);
      renderer.autoClear = autoClear;
    },
    dispose() { tex.dispose(); mat.dispose(); },
  };
}
