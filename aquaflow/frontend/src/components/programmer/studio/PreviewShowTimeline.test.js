import { describe, expect, it } from "vitest";
import { canPlayPreview } from "./PreviewShowTimeline.jsx";

describe("preview transport", () => {
  it("plays either programming clips or an externally loaded visual show", () => {
    expect(canPlayPreview({ clips: [], issues: [] }, { visualClips: [{ id: "water" }] })).toBe(true);
    expect(canPlayPreview({ clips: [{ id: "studio" }], issues: [] }, null)).toBe(true);
  });

  it("stays disabled without playable clips or when programming has issues", () => {
    expect(canPlayPreview({ clips: [], issues: [] }, null)).toBe(false);
    expect(canPlayPreview({ clips: [], issues: ["invalid"] }, { visualClips: [{ id: "water" }] })).toBe(false);
  });
});
