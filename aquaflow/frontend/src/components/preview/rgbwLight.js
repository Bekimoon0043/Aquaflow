export function rgbwLightLevel(baseColor, rgbLevel, whiteLevel, baseIntensity) {
  const level = Math.max(0, Number(rgbLevel) || 0);
  const white = Math.max(0, Number(whiteLevel) || 0);
  const intensity = Math.max(0, Number(baseIntensity) || 0);
  if (white === 0) return {
    r: Number(baseColor?.r ?? 1) || 0,
    g: Number(baseColor?.g ?? 1) || 0,
    b: Number(baseColor?.b ?? 1) || 0,
    intensity: intensity * level,
  };
  const r = Math.max(0, Number(baseColor?.r ?? 1) || 0) * level + white;
  const g = Math.max(0, Number(baseColor?.g ?? 1) || 0) * level + white;
  const b = Math.max(0, Number(baseColor?.b ?? 1) || 0) * level + white;
  const peak = Math.max(r, g, b);
  return peak > 0 ? { r: r / peak, g: g / peak, b: b / peak, intensity: intensity * peak } : { r: 1, g: 1, b: 1, intensity: 0 };
}
