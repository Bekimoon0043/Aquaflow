import { create } from "zustand";
import { rememberAssetFile } from "../utils/assetManifest.js";

export const AQUAFLOW_PROJECT_SCHEMA_VERSION = 2;

export const DEFAULT_RENDER_SETTINGS = Object.freeze({
  environment: "night",
  cameraMode: "orbit",
  // AF-NEXT-013: "auto" = the tier detected for this PC's GPU (gpuTier.js); an explicit
  // eco/low/medium/high is honoured (and is a hard override when adaptiveQuality is off).
  quality: "auto",
  adaptiveQuality: true,
  // AF-3D-024: ACES stays the default so saved shows look unchanged.
  toneMapping: "aces",
  // AF-3D-008: half-resolution spray/mist pass. Always on for high; opt-in on medium.
  halfResSpray: false,
  pattern: "none",
  lightColor: "#0066ff",
  windX: 0,
  windZ: 0,
  waveResponse: 1,
  waveDamping: 0.985,
  waveBoundaryDamping: 0.82,
  reviewMode: false,
  reviewOverlays: false,
  showPerformance: false,
  sidebarOpen: true,
  sidebarTab: "render",
  editMode: false,
  exportResolution: "1080p",
  exportFps: 60,
  bakeStart: 0,
  bakeDuration: 0,
  bakeAudio: true,
});

const serializable = (value, fallback) => {
  try {
    return value == null ? fallback : JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
};

// AF-NEXT-006: the absolute path of a chosen audio file (desktop only) feeds the asset
// manifest; synthetic Files created on relink/package-open carry it as `aquaflowPath`.
const audioFilePath = (file, previous) => {
  let p = null;
  try { p = file.aquaflowPath || globalThis.window?.aquaflow?.getPathForFile?.(file) || null; } catch { p = null; }
  if (!p && previous?.path && previous.name === file.name) p = previous.path;
  return p || null;
};

const serializableProgrammer = (value) => {
  if (!value) return null;
  const audioFileReference = value.audioFile && typeof value.audioFile === "object"
    ? {
        name: value.audioFile.name || "",
        size: Number(value.audioFile.size) || 0,
        type: value.audioFile.type || "",
        lastModified: Number(value.audioFile.lastModified) || 0,
        path: audioFilePath(value.audioFile, value.audioFileReference),
      }
    : (value.audioFileReference || null);
  if (value.audioFile && typeof value.audioFile === "object") rememberAssetFile("audio:programmer", value.audioFile);
  // AudioBuffer and File contents are intentionally excluded. The project retains
  // choreography, beat markers and file identity; the user can relink audio without
  // producing a corrupt or multi-hundred-megabyte JSON document.
  return serializable({ ...value, audioFile: null, audioFileReference, audioBuffer: null }, null);
};

const initialPanel = () => {
  try {
    return window.sessionStorage.getItem("aquaflow.activePanel") || "nodes";
  } catch {
    return "nodes";
  }
};

const newIdentity = (name = "Untitled Show") => {
  const now = new Date().toISOString();
  return {
    id: `project-${Date.now()}`,
    name,
    schemaVersion: AQUAFLOW_PROJECT_SCHEMA_VERSION,
    revision: 1,
    createdAt: now,
    modifiedAt: now,
  };
};

export function normalizeUnifiedProject(project = {}, fallbackName = "Untitled Show") {
  const metadata = project.metadata || project.project || {};
  const now = new Date().toISOString();
  return {
    metadata: {
      ...newIdentity(metadata.name || fallbackName),
      ...metadata,
      name: metadata.name || fallbackName,
      schemaVersion: AQUAFLOW_PROJECT_SCHEMA_VERSION,
      revision: Math.max(1, Number(metadata.revision) || 1),
      createdAt: metadata.createdAt || metadata.created_at || now,
      modifiedAt: metadata.modifiedAt || metadata.modified_at || now,
    },
    workspace: {
      activePanel: "nodes",
      ...(project.workspace || {}),
    },
    render: {
      ...DEFAULT_RENDER_SETTINGS,
      ...(project.render || project.preview || {}),
    },
    programmer: serializableProgrammer(project.programmer),
    integrations: {
      siemensSiteId: null,
      ...(project.integrations || {}),
    },
  };
}

const fresh = normalizeUnifiedProject({}, "Untitled Show");
fresh.workspace.activePanel = initialPanel();

const useProjectStore = create((set, get) => ({
  ...fresh,
  loadRevision: 0,
  dirty: false,

  setActivePanel: (activePanel) => set((state) => ({
    workspace: { ...state.workspace, activePanel },
  })),

  updateRender: (patch) => set((state) => ({
    render: { ...state.render, ...patch },
    dirty: true,
  })),

  rememberProgrammer: (programmer) => set({
    programmer: serializableProgrammer(programmer),
    dirty: true,
  }),

  updateIntegrations: (patch) => set((state) => ({
    integrations: { ...state.integrations, ...patch },
    dirty: true,
  })),

  setProjectName: (name) => set((state) => ({
    metadata: { ...state.metadata, name: name || "Untitled Show" },
    dirty: true,
  })),

  loadProjectDocument: (project, fallbackName) => {
    const normalized = normalizeUnifiedProject(project, fallbackName);
    set((state) => ({
      ...normalized,
      loadRevision: state.loadRevision + 1,
      dirty: false,
    }));
  },

  resetProjectDocument: (name = "Untitled Show") => {
    const normalized = normalizeUnifiedProject({ metadata: newIdentity(name) }, name);
    set((state) => ({
      ...normalized,
      workspace: { ...normalized.workspace, activePanel: state.workspace.activePanel },
      loadRevision: state.loadRevision + 1,
      dirty: false,
    }));
  },

  markSaved: (name) => set((state) => ({
    metadata: {
      ...state.metadata,
      name: name || state.metadata.name,
      revision: Math.max(1, Number(state.metadata.revision) || 1) + 1,
      modifiedAt: new Date().toISOString(),
    },
    dirty: false,
  })),

  getProjectDocument: (name) => {
    const state = get();
    return {
      metadata: {
        ...state.metadata,
        name: name || state.metadata.name,
        schemaVersion: AQUAFLOW_PROJECT_SCHEMA_VERSION,
      },
      workspace: serializable(state.workspace, { activePanel: "nodes" }),
      render: serializable(state.render, { ...DEFAULT_RENDER_SETTINGS }),
      programmer: serializableProgrammer(state.programmer),
      integrations: serializable(state.integrations, { siemensSiteId: null }),
    };
  },
}));

export default useProjectStore;
