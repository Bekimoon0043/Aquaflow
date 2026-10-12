// Optical density must depend on nozzle flow, not the total GPU pool size.
// Otherwise one spray emitter receives 131k particles and becomes a white cloud.
export function emitterOpacityScale(emitter, allocatedCount) {
  if (!(allocatedCount > 0)) return 0;
  const target = Math.max(0, Number(emitter.weight) || 0) * Math.max(0, Number(emitter.life) || 0) * 4;
  return Math.min(1, target / allocatedCount);
}
