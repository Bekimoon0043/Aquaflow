import { beforeEach, describe, expect, it } from "vitest";
import useProjectStore, {
  AQUAFLOW_PROJECT_SCHEMA_VERSION,
  DEFAULT_RENDER_SETTINGS,
  normalizeUnifiedProject,
} from "../projectStore";

describe("unified project store", () => {
  beforeEach(() => {
    useProjectStore.getState().resetProjectDocument("Test Project");
  });

  it("normalizes legacy projects with safe workspace and render defaults", () => {
    const project = normalizeUnifiedProject({ project: { name: "Legacy" } });
    expect(project.metadata.name).toBe("Legacy");
    expect(project.metadata.schemaVersion).toBe(AQUAFLOW_PROJECT_SCHEMA_VERSION);
    expect(project.workspace.activePanel).toBe("nodes");
    expect(project.render).toMatchObject(DEFAULT_RENDER_SETTINGS);
    expect(project.integrations.siemensSiteId).toBeNull();
  });

  it("round-trips workspace, render, programmer and Siemens context", () => {
    const store = useProjectStore.getState();
    store.setActivePanel("preview");
    store.updateRender({ environment: "dusk", quality: "high", exportFps: 30 });
    store.rememberProgrammer({
      timelineClips: [{ id: "clip-1", startTime: 2, duration: 4 }],
      beatMarkers: [{ time: 2 }],
      audioFile: { name: "show.wav", size: 42, type: "audio/wav", lastModified: 7 },
      audioBuffer: { huge: "must not be serialized" },
    });
    store.updateIntegrations({ siemensSiteId: "site-1212c" });

    const saved = useProjectStore.getState().getProjectDocument("Fountain A");
    useProjectStore.getState().loadProjectDocument(saved, "fallback");
    const restored = useProjectStore.getState();

    expect(restored.metadata.name).toBe("Fountain A");
    expect(restored.workspace.activePanel).toBe("preview");
    expect(restored.render).toMatchObject({ environment: "dusk", quality: "high", exportFps: 30 });
    expect(restored.programmer.timelineClips[0].id).toBe("clip-1");
    expect(restored.programmer.audioBuffer).toBeNull();
    expect(restored.programmer.audioFile).toBeNull();
    expect(restored.programmer.audioFileReference.name).toBe("show.wav");
    expect(restored.integrations.siemensSiteId).toBe("site-1212c");
    expect(restored.dirty).toBe(false);
  });

  it("resets project-owned content without changing the current workspace", () => {
    useProjectStore.getState().setActivePanel("geometry");
    useProjectStore.getState().updateIntegrations({ siemensSiteId: "old-site" });
    useProjectStore.getState().resetProjectDocument("Fresh Project");
    const state = useProjectStore.getState();

    expect(state.metadata.name).toBe("Fresh Project");
    expect(state.workspace.activePanel).toBe("geometry");
    expect(state.integrations.siemensSiteId).toBeNull();
    expect(state.programmer).toBeNull();
  });
});
