import { create } from "zustand";
import { createICANPreviewPlan } from "../utils/icanPatternPreview";

// Deliberately independent of showStore, WebSocket, and hardware API clients.
const now = () => performance.now();
const positionAt = (state, timestamp) => state.playback === "playing"
  ? Math.min(state.plan.duration, state.anchorPosition + (timestamp - state.anchorTime) / 1000)
  : state.position;

export const useICANPreviewStore = create((set, get) => ({
  active: false, plan: null, position: 0, playback: "stopped", anchorTime: 0, anchorPosition: 0,
  audioFile: null,
  editPanel: "patterns", siteEditorRequested: false,
  editorDraft: null, editorRepeat: 1,
  programmerDraft: null,
  arrayBuilderDraft: null, siteShowSettings: null,
  sectionBuilderDraft: null,
  choreographyDraft: null,
  rememberProgrammer: programmerDraft => set({ programmerDraft }),
  rememberDraft: (editorDraft, editorRepeat) => set({ editorDraft, editorRepeat }),
  load: (pattern, repeat, audioFile = null, editPanel = "patterns") => {
    const plan = createICANPreviewPlan(pattern, repeat);
    set({ active: true, plan, position: 0, playback: "paused", audioFile, editPanel });
  },
  // Replace an editable show preview without throwing the playhead back to zero.
  // The embedded 3D arrangement timeline uses this after a pattern move/resize so
  // the water renderer follows the same document the operator is editing.
  replace: (pattern, repeat = 1, audioFile = null, editPanel = "show_programmer") => {
    const previous = get();
    const plan = createICANPreviewPlan(pattern, repeat);
    // While playing, carry the live clock position (not the last ticked value) so an
    // edit never nudges the playhead backwards (AF-NEXT-004).
    const live = previous.playback === "playing" && previous.plan ? positionAt(previous, now()) : previous.position;
    const position = Math.max(0, Math.min(plan.duration, Number(live) || 0));
    set({
      active: true,
      plan,
      position,
      playback: previous.playback === "playing" && position < plan.duration ? "playing" : "paused",
      anchorPosition: position,
      anchorTime: now(),
      audioFile: audioFile ?? previous.audioFile,
      editPanel,
    });
  },
  openSiteEditor: pattern => set({ editorDraft: pattern, editorRepeat: 1, siteEditorRequested: true }),
  play: () => {
    const state = get();
    if (!state.active || !state.plan) return;
    const position = state.position >= state.plan.duration ? 0 : state.position;
    set({ position, playback: "playing", anchorPosition: position, anchorTime: now() });
  },
  pause: () => {
    const state = get();
    if (state.active) set({ position: positionAt(state, now()), playback: "paused" });
  },
  stop: () => set({ position: 0, playback: "stopped" }),
  seek: (value) => {
    const state = get();
    if (!state.plan) return;
    const position = Math.max(0, Math.min(state.plan.duration, Number(value) || 0));
    set({ position, anchorPosition: position, anchorTime: now(),
      playback: state.playback === "stopped" ? "paused" : state.playback });
  },
  tick: () => {
    const state = get();
    if (!state.active || state.playback !== "playing") return;
    const position = positionAt(state, now());
    set({ position, playback: position >= state.plan.duration ? "complete" : "playing" });
  },
  close: () => set({ active: false, plan: null, position: 0, playback: "stopped", audioFile: null }),
}));
