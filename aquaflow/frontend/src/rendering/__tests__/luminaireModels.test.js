import { describe, expect, it } from "vitest";
import { LUMINAIRE_TYPES, getLuminaireModel, normalizeLuminaireRecord, resolveLuminaireModel } from "../luminaireModels.js";

describe("luminaire registry", () => {
  it("covers water, stage, projection, area and environment families", () => {
    for (const key of ["underwater_point", "underwater_ring", "underwater_linear", "moving_head_spot", "framing_gobo", "video_projector", "full_colour_laser", "rectangular_area", "pixel_matrix", "sun", "moon", "hdri", "ambient"]) {
      expect(LUMINAIRE_TYPES[key]).toBeDefined();
    }
  });

  it("resolves existing fixture aliases", () => {
    expect(getLuminaireModel("light_uw_rgbw_72w").id).toBe("underwater_point");
    expect(resolveLuminaireModel({ type: "light_moving_head_350w" }).id).toBe("moving_head_spot");
    expect(resolveLuminaireModel({ type: "light_projector_framing_5200lm" }).id).toBe("framing_gobo");
  });

  it("keeps independent white and pan/tilt channels", () => {
    const underwater = LUMINAIRE_TYPES.underwater_point;
    expect(underwater.controlChannels).toContain("white");
    expect(LUMINAIRE_TYPES.moving_head_spot.controlChannels).toEqual(expect.arrayContaining(["pan", "tilt", "gobo_rotation"]));
  });

  it("marks gobo/video projection and area-light shadow policy explicitly", () => {
    expect(LUMINAIRE_TYPES.framing_gobo.capabilities.gobo).toBe(true);
    expect(LUMINAIRE_TYPES.video_projector.projection.kind).toBe("video");
    expect(LUMINAIRE_TYPES.rectangular_area.shadowPolicy.cast).toBe(false);
  });

  it("requires safety evidence for lasers", () => {
    expect(LUMINAIRE_TYPES.full_colour_laser.provenanceRequirements.safetyCritical).toBe(true);
    expect(LUMINAIRE_TYPES.full_colour_laser.controlChannels).toContain("safety_shutter");
  });

  it("normalizes photometry without inventing absent values", () => {
    const result = normalizeLuminaireRecord({ type: "light_uw_rgbw_72w", engineering: { lumens: 1800, beamAngleDeg: 25 } });
    expect(result.photometry).toMatchObject({ lumens: 1800, beamAngleDeg: 25 });
    expect(result.photometry.ies).toBeUndefined();
    expect(result.luminaire.id).toBe("underwater_point");
    expect(normalizeLuminaireRecord({ type: "light_rgb" }).photometry).toBeUndefined();
  });
});
