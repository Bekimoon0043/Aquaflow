export function buildRuntimePayload(source = {}) {
  const currentShow = source.currentShow || source.show || {};
  const ui = source.ui || {};

  return {
    currentShow: {
      id: currentShow.id || "show-001",
      name: currentShow.name || "Untitled Show",
      bpm: Number(currentShow.bpm ?? 128),
      duration: Number(currentShow.duration ?? 240),
      sampleRate: Number(currentShow.sampleRate ?? 48000),
      loop: Boolean(currentShow.loop ?? false),
    },
    nodes: Array.isArray(source.nodes) ? source.nodes : [],
    connections: Array.isArray(source.connections) ? source.connections : [],
    timelineTracks: Array.isArray(source.timelineTracks) ? source.timelineTracks : (Array.isArray(source.tracks) ? source.tracks : []),
    devices: Array.isArray(source.devices) ? source.devices : [],
    // Fixture-aware backend: forward the designed engineering fixtures so the
    // runtime can build its hardware address registry and drive real fixtures.
    fixtures: Array.isArray(source.fixtures) ? source.fixtures : (Array.isArray(source.engineeringFixtures) ? source.engineeringFixtures : []),
    groups: Array.isArray(source.groups) ? source.groups : [],
    ui: {
      timelineZoom: Number(source.timelineZoom ?? ui.timelineZoom ?? 4),
      showGrid: Boolean(source.showGrid ?? ui.showGrid ?? true),
      snapToGrid: Boolean(source.snapToGrid ?? ui.snapToGrid ?? true),
    },
  };
}

export function buildRuntimeSignature(source = {}) {
  return JSON.stringify(buildRuntimePayload(source));
}
