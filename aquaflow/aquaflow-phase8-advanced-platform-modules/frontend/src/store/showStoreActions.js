// Add these actions to the showStore — paste into the immer store actions section

// ── File / Save / Load actions ───────────────────────────────────────────────

loadShow: (newState) =>
  set((s) => {
    if (newState.currentShow)    Object.assign(s.currentShow, newState.currentShow);
    if (newState.nodes)          s.nodes = newState.nodes;
    if (newState.connections)    s.connections = newState.connections;
    if (newState.timelineTracks) s.timelineTracks = newState.timelineTracks;
    if (newState.devices)        s.devices = newState.devices;
    if (newState.timelineZoom)   s.timelineZoom = newState.timelineZoom;
    if (newState.showGrid !== undefined) s.showGrid = newState.showGrid;
    if (newState.snapToGrid !== undefined) s.snapToGrid = newState.snapToGrid;
    // Reset playback on load
    s.playbackState = "stopped";
    s.playhead = 0;
    s.selectedNodeId = null;
    s.selectedClipId = null;
  }),

setShowName: (name) =>
  set((s) => { s.currentShow.name = name; }),

markDirty: () =>
  set((s) => { s.isDirty = true; }),

markClean: () =>
  set((s) => { s.isDirty = false; }),
