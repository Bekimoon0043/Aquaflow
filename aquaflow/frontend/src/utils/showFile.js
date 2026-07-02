/**
 * showFile.js
 * Serializes and deserializes AquaFlow .aqua project files.
 * Format: JSON with versioning, metadata, and full show state.
 */

export const AQUA_VERSION = "1.0";

/**
 * Serialize current store state into a .aqua file object
 */
export function serializeShow(state) {
  return {
    aquaflow: AQUA_VERSION,
    savedAt: new Date().toISOString(),
    show: {
      id: state.currentShow.id,
      name: state.currentShow.name,
      bpm: state.currentShow.bpm,
      duration: state.currentShow.duration,
      sampleRate: state.currentShow.sampleRate,
      loop: Boolean(state.currentShow.loop),
    },
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      label: n.label,
      x: Math.round(n.x),
      y: Math.round(n.y),
      width: n.width,
      height: n.height,
      ports: n.ports,
      params: n.params,
      protocol: n.protocol,
      deviceId: n.deviceId,
    })),
    connections: state.connections,
    timelineTracks: state.timelineTracks,
    devices: state.devices.map((d) => ({
      id: d.id,
      label: d.label,
      type: d.type,
      protocol: d.protocol,
      ip: d.ip,
      port: d.port,
      status: d.status,
      health: d.health,
      last_seen: d.last_seen,
    })),
    ui: {
      timelineZoom: state.timelineZoom,
      showGrid: state.showGrid,
      snapToGrid: state.snapToGrid,
    },
  };
}

/**
 * Deserialize a .aqua file object into store-compatible state
 */
export function deserializeShow(data) {
  if (!data.aquaflow) throw new Error("Not a valid .aqua file");

  return {
    currentShow: {
      ...data.show,
      loop: Boolean(data.show?.loop ?? false),
    },
    nodes: (data.nodes || []).map((n) => ({
      ...n,
      status: n.status || "ready",
    })),
    connections: data.connections || [],
    timelineTracks: data.timelineTracks || [],
    devices: (data.devices || []).map((d) => ({
      ...d,
      status: d.status || "offline",
      health: d.health ?? 0,
      last_seen: d.last_seen || null,
    })),
    timelineZoom: data.ui?.timelineZoom || 4,
    showGrid: data.ui?.showGrid ?? true,
    snapToGrid: data.ui?.snapToGrid ?? true,
  };
}

/**
 * Download a .aqua file to the user's computer
 */
export function downloadShowFile(state) {
  const data = serializeShow(state);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.currentShow.name.replace(/\s+/g, "_")}.aqua`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Read a .aqua file from disk (returns Promise<object>)
 */
export function readShowFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.name.endsWith(".aqua") && !file.name.endsWith(".json")) {
      reject(new Error("Please select a .aqua file"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        const state = deserializeShow(data);
        resolve({ data, state, meta: { name: data.show?.name, savedAt: data.savedAt } });
      } catch (err) {
        reject(new Error("Invalid .aqua file: " + err.message));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

/**
 * Save to localStorage as recent file entry
 */
export function saveToRecent(showMeta) {
  try {
    const recent = getRecentShows();
    const updated = [
      { ...showMeta, openedAt: new Date().toISOString() },
      ...recent.filter((r) => r.name !== showMeta.name),
    ].slice(0, 10);
    localStorage.setItem("aquaflow_recent", JSON.stringify(updated));
  } catch (e) {
    // localStorage may not be available
  }
}

export function getRecentShows() {
  try {
    return JSON.parse(localStorage.getItem("aquaflow_recent") || "[]");
  } catch {
    return [];
  }
}

/**
 * Auto-save to localStorage
 */
export function autoSave(state) {
  try {
    const data = serializeShow(state);
    localStorage.setItem("aquaflow_autosave", JSON.stringify(data));
    localStorage.setItem("aquaflow_autosave_ts", new Date().toISOString());
  } catch (e) {
    // Silently fail if storage is full
  }
}

export function loadAutoSave() {
  try {
    const raw = localStorage.getItem("aquaflow_autosave");
    const ts  = localStorage.getItem("aquaflow_autosave_ts");
    if (!raw) return null;
    const data = JSON.parse(raw);
    return { state: deserializeShow(data), savedAt: ts };
  } catch {
    return null;
  }
}
