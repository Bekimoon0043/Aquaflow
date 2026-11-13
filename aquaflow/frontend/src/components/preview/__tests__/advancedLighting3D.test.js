import { describe, expect, it } from "vitest";
import { advancedLightKind } from "../advancedLighting3D.js";

describe("advanced light selection", () => {
  it("selects rectangular and pixel area lights", () => {
    expect(advancedLightKind({ luminaireType: "rectangular_area" })).toBe("area");
    expect(advancedLightKind({ luminaireType: "pixel_matrix" })).toBe("area");
    expect(advancedLightKind({ areaLight: true })).toBe("area");
  });

  it("selects gobo and video projection", () => {
    expect(advancedLightKind({ luminaireType: "framing_gobo" })).toBe("gobo");
    expect(advancedLightKind({ luminaireType: "video_projector" })).toBe("gobo");
    expect(advancedLightKind({ gobo: { pattern: "grid" } })).toBe("gobo");
  });

  it("leaves ordinary lights on the existing path", () => {
    expect(advancedLightKind({ luminaireType: "underwater_spot" })).toBeNull();
  });
});
