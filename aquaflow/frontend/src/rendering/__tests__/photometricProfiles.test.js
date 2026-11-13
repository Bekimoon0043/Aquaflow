import { describe, expect, it } from "vitest";
import { parseIES, parseLDT, parsePhotometricProfile, sampleCandela } from "../photometricProfiles.js";

const ies = ({ lumens = 1000, multiplier = 1 } = {}) => `IESNA:LM-63-2002\nTEST\nTILT=NONE\n1 ${lumens} ${multiplier} 3 2 1 2 0.1 0.1 0.1 1 0 12\n0 45 90\n0 180\n100 200 300\n400 500 600\n`;
const ldt = () => [
  "Test company", "1", "0", "1", "0", "3", "45", "report", "Luminaire", "01", "test.ldt", "today",
  "100", "100", "100", "0", "0", "0", "0", "0", "0", "100", "1", "1", "0", "0",
  "1 1 1 1 1 1 1 1 1 1", "0", "0 45 90", "100 200 300",
].join("\n");

describe("photometric profile parsing", () => {
  it("parses IES angular values and interpolates vertically and horizontally", () => {
    const profile = parseIES(ies());
    expect(profile.format).toContain("LM-63");
    expect(profile.luminousFluxLm).toBe(1000);
    expect(sampleCandela(profile, 0, 0)).toBe(100);
    expect(sampleCandela(profile, 45, 90)).toBe(350);
    expect(sampleCandela(profile, 90, 90)).toBe(450);
    expect(sampleCandela(profile, 180, 90)).toBe(0);
  });

  it("applies C-plane symmetry and absolute scaling", () => {
    const profile = parseIES(ies({ lumens: -1, multiplier: 2 }));
    expect(profile.metadata.absolute).toBe(true);
    expect(profile.luminousFluxLm).toBeNull();
    expect(sampleCandela(profile, 0, 270)).toBe(500);
    expect(sampleCandela(profile, 45, 90)).toBe(700);
  });

  it("auto-detects IESNA and rejects malformed data", () => {
    expect(parsePhotometricProfile(ies()).format).toContain("LM-63");
    expect(() => parseIES("IESNA:LM-63-2002\nTILT=NONE\n1 2")).toThrow();
  });

  it("parses EULUMDAT and converts cd/1000lm to candela", () => {
    const profile = parseLDT(ldt());
    expect(profile.format).toContain("EULUMDAT");
    expect(sampleCandela(profile, 0, 0)).toBe(0.1);
    expect(sampleCandela(profile, 45, 0)).toBe(0.2);
    expect(sampleCandela(profile, 90, 0)).toBe(0.3);
  });
});
