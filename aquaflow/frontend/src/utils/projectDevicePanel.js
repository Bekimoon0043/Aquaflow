import { classifyFixtureType, resolveFixtureGroup } from "../hooks/fixtureTypeMap";

const GROUP_LABELS = {
  running_fountain_jets: "Running fountain outlets",
  foam_jets: "Foam outlets",
  peacock_jets: "Peacock outlets",
  center_jets: "Center water outlets",
  outer_ring_jets: "Outer ring outlets",
  arch_jets: "Arch outlets",
  mist_jets: "Mist outlets",
  screen_jets: "Water-screen outlets",
  cascade_jets: "Cascade outlets",
  motion_1d_jets: "1D moving outlets",
  motion_2d_jets: "2D moving outlets",
  motion_3d_jets: "3D moving outlets",
  rgb_lights: "RGB lights",
  flame_units: "Flame effects",
  fog_machines: "Fog effects",
  laser_units: "Laser effects",
};

function panelType(fixture) {
  const raw = String(fixture?.type || "").toLowerCase();
  const fixtureClass = classifyFixtureType(raw);
  if (fixtureClass === "nozzle") return "nozzle";
  if (fixtureClass === "light") return "lighting";
  if (fixtureClass === "effect") {
    if (raw.includes("flame") || raw.includes("fire")) return "flame";
    if (raw.includes("laser")) return "laser";
    return "fog";
  }
  if (raw.includes("pump")) return "pump";
  if (raw.includes("valve")) return "valve";
  if (raw.includes("sensor")) return "sensor";
  return "equipment";
}

/**
 * Project designed fixtures into compact sidebar summaries. These are design assets,
 * never reported as online hardware. Runtime devices remain separate entries.
 */
export function buildDesignedDeviceSummaries(fixtures = []) {
  const groups = new Map();
  for (const fixture of Array.isArray(fixtures) ? fixtures : []) {
    const type = panelType(fixture);
    const group = fixture?.groupId || resolveFixtureGroup(fixture?.type) || `${type}_equipment`;
    const key = `${type}:${group}`;
    const current = groups.get(key) || { type, group, fixtures: [] };
    current.fixtures.push(fixture);
    groups.set(key, current);
  }

  return [...groups.values()].map(({ type, group, fixtures: list }) => ({
    id: `design:${type}:${group}`,
    label: `${GROUP_LABELS[group] || list[0]?.groupLabel || list[0]?.label || "Designed equipment"} (${list.length})`,
    type,
    protocol: "design",
    status: "designed",
    health: null,
    source: "engineering",
    fixtureCount: list.length,
    fixtureIds: list.map((fixture) => fixture.id).filter(Boolean),
  }));
}

export function mergeDevicePanelEntries(runtimeDevices = [], fixtures = []) {
  const runtime = (Array.isArray(runtimeDevices) ? runtimeDevices : []).map((device) => ({
    ...device,
    source: device.source || "runtime",
    health: Number.isFinite(device.health) ? device.health : null,
  }));
  return [...runtime, ...buildDesignedDeviceSummaries(fixtures)];
}

