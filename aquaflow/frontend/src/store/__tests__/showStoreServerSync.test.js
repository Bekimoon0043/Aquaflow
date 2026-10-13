import { beforeEach, describe, expect, it } from "vitest";
import { useShowStore } from "../showStore";

const show = (name) => ({ id: name.toLowerCase().replaceAll(" ", "-"), name, bpm: 120, duration: 60, sampleRate: 48000, loop: false });

const snapshot = (name) => ({
  currentShow: show(name),
  nodes: [],
  connections: [],
  timelineTracks: [],
  devices: [],
  ui: { timelineZoom: 4, showGrid: true, snapToGrid: true },
  revision: 1,
});

describe("local project / backend startup snapshot ordering", () => {
  beforeEach(() => {
    useShowStore.setState({
      currentShow: show("Untitled Show"),
      nodes: [],
      connections: [],
      timelineTracks: [],
      devices: [],
      timelineZoom: 4,
      showGrid: true,
      snapToGrid: true,
      localProjectPendingSync: false,
      serverMirrorSignature: null,
      serverRevision: 0,
    });
  });

  it("keeps an explicitly opened project when a stale startup snapshot arrives", () => {
    useShowStore.getState().loadShow(snapshot("Lebu Fountain · Pilot"));
    useShowStore.getState().markLocalProjectLoaded();

    useShowStore.getState().applyServerShowSnapshot(snapshot("Untitled Show"));

    expect(useShowStore.getState().currentShow.name).toBe("Lebu Fountain · Pilot");
    expect(useShowStore.getState().localProjectPendingSync).toBe(true);
  });

  it("accepts the backend echo and leaves normal snapshot handling enabled", () => {
    useShowStore.getState().loadShow(snapshot("Lebu Fountain · Pilot"));
    useShowStore.getState().markLocalProjectLoaded();

    useShowStore.getState().applyServerShowSnapshot(snapshot("Lebu Fountain · Pilot"));
    expect(useShowStore.getState().localProjectPendingSync).toBe(false);

    useShowStore.getState().applyServerShowSnapshot(snapshot("Operator Update"));
    expect(useShowStore.getState().currentShow.name).toBe("Operator Update");
  });
});
