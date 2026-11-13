const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const colorOf = (value) => {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    const decode = (v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    return { r: decode(parseInt(value.slice(1, 3), 16) / 255), g: decode(parseInt(value.slice(3, 5), 16) / 255), b: decode(parseInt(value.slice(5, 7), 16) / 255) };
  }
  return { r: finite(value?.r, 1), g: finite(value?.g, 1), b: finite(value?.b, 1) };
};

function lightForNozzle(nozzle, lights) {
  const paired = lights.find((light) => light.pairedNozzleId === nozzle.id);
  if (paired) return paired;
  let best = null;
  let bestD2 = Infinity;
  for (const light of lights) {
    const dx = finite(light.x) - finite(nozzle.x);
    const dy = finite(light.y) - finite(nozzle.mountHeightM);
    const dz = finite(light.z) - finite(nozzle.z);
    const d2 = dx * dx + dy * dy + dz * dz;
    const reach = Math.max(0.1, finite(light.radius, 4.5));
    if (d2 <= reach * reach && d2 < bestD2) { best = light; bestD2 = d2; }
  }
  return best;
}

export function buildFountainIndirect(nozzles = [], lights = [], { maxEmitters = 8, cellSize = 4 } = {}) {
  const groups = new Map();
  for (const nozzle of nozzles) {
    const level = clamp(finite(nozzle.runtimeIntensity ?? nozzle.level ?? nozzle.intensity, 1), 0, 1);
    const light = lightForNozzle(nozzle, lights);
    if (!light || level <= 0 || finite(light.intensity) <= 0) continue;
    const cx = Math.floor(finite(nozzle.x) / cellSize);
    const cz = Math.floor(finite(nozzle.z) / cellSize);
    const key = `${nozzle.groupId || "water"}:${cx}:${cz}:${light.id}`;
    const height = Math.max(0.05, finite(nozzle.designHeightM ?? nozzle.engineering?.jetHeightM, 1));
    const weight = level * height * Math.max(0, finite(light.intensity));
    if (!groups.has(key)) groups.set(key, { key, weight: 0, x: 0, y: 0, z: 0, height: 0, r: 0, g: 0, b: 0, ids: [], color: colorOf(light.color) });
    const group = groups.get(key);
    group.weight += weight;
    group.x += finite(nozzle.x) * weight;
    group.y += Math.max(0.1, height * 0.45) * weight;
    group.z += finite(nozzle.z) * weight;
    group.height += height * weight;
    group.ids.push(nozzle.id);
  }
  return [...groups.values()].map((group) => {
    const w = Math.max(1e-9, group.weight);
    return {
      id: `fountain-indirect:${group.key}`,
      x: group.x / w,
      y: group.y / w,
      z: group.z / w,
      color: group.color,
      intensity: group.weight * 0.01,
      radius: Math.min(30, 2 + (group.height / w) * 0.75),
      sourceNozzleIds: group.ids,
      approximation: "virtual-point-cluster",
    };
  }).filter((emitter) => emitter.intensity > 1e-5)
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, Math.max(0, Math.floor(maxEmitters)));
}
