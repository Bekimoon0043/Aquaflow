import { afterEach, describe, expect, it } from "vitest";
import { buildEasyFountain } from "../easyFountain";
import { loadEasyFountainPreview } from "../easyPreview";
import { useICANPreviewStore } from "../../store/icanPreviewStore";

afterEach(() => useICANPreviewStore.getState().close());

describe("easy fountain preview playback", () => {
  it("loads the generated show into the same store used by the Play button", () => {
    const result = buildEasyFountain({ seconds: 4, includeLaser: true, includeFlame: true });
    loadEasyFountainPreview(result);
    const state = useICANPreviewStore.getState();
    expect(state.active).toBe(true);
    expect(state.plan.visualClips.length).toBeGreaterThan(0);
    expect(state.plan.duration).toBe(4);
    expect(state.playback).toBe("paused");
    state.play();
    expect(useICANPreviewStore.getState().playback).toBe("playing");
  });

  it("requires a built project", () => {
    expect(() => loadEasyFountainPreview(null)).toThrow(/Build a fountain/);
  });
});
