import { describe, expect, it } from "vitest";
import {
  fieldIoQualityColor,
  formatFieldIoAge,
  formatFieldIoValue,
} from "../PLCPanel.jsx";

// AF-IO-007 — the Field I/O tab's pure helpers (the FixtureLibraryBrowser pattern).

describe("field I/O quality rendering", () => {
  it("only GOOD looks calm — every other quality is a visible warning color", () => {
    const good = fieldIoQualityColor("GOOD");
    for (const q of ["STALE", "FAULT", "UNKNOWN"]) {
      expect(fieldIoQualityColor(q)).not.toBe(good);
    }
    expect(fieldIoQualityColor("FAULT")).toBe("var(--red)");
  });

  it("formats values honestly: no value is a dash, never a zero", () => {
    expect(formatFieldIoValue({ value: null })).toBe("—");
    expect(formatFieldIoValue({ value: undefined })).toBe("—");
    expect(formatFieldIoValue({ value: 0, unit: "bar" })).toBe("0 bar");
    expect(formatFieldIoValue({ value: 12.345, unit: "m" })).toBe("12.35 m");
    expect(formatFieldIoValue({ value: true })).toBe("ON");
    expect(formatFieldIoValue({ value: false })).toBe("OFF");
  });

  it("renders age compactly and 'never' for the unread", () => {
    expect(formatFieldIoAge(null)).toBe("never");
    expect(formatFieldIoAge(0.4)).toBe("<1s");
    expect(formatFieldIoAge(12.2)).toBe("12s");
    expect(formatFieldIoAge(190)).toBe("3m");
  });
});
