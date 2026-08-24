import { describe, it, expect } from "vitest";
import {
  GRID_SNAP_M, ANGLE_SNAP_DEG, TOOLS, DEFAULT_TOOL,
  readModifiers, snapActive, snapScalar, snapTranslation, snapAngleDeg,
  lockDominantAxis, constrainToAxis, resolveDrag, shouldDuplicate,
  matchShortcut, SHORTCUTS,
} from "../editorSnapping";

describe("modifier reading", () => {
  it("maps shift/ctrl/alt to snap/duplicate/freeform", () => {
    expect(readModifiers({ shiftKey: true })).toEqual({ snap: true, duplicate: false, freeform: false });
    expect(readModifiers({ ctrlKey: true })).toEqual({ snap: false, duplicate: true, freeform: false });
    expect(readModifiers({ altKey: true })).toEqual({ snap: false, duplicate: false, freeform: true });
  });

  it("treats Cmd as Ctrl so the duplicate gesture works on macOS", () => {
    expect(readModifiers({ metaKey: true }).duplicate).toBe(true);
  });

  it("survives a missing event", () => {
    expect(readModifiers(null)).toEqual({ snap: false, duplicate: false, freeform: false });
  });
});

describe("snapActive", () => {
  it("requires SHIFT", () => {
    expect(snapActive({ snap: false })).toBe(false);
    expect(snapActive({ snap: true })).toBe(true);
  });

  it("lets ALT override SHIFT for free placement", () => {
    // The escape hatch: one off-grid fixture without leaving snap mode.
    expect(snapActive({ snap: true, freeform: true })).toBe(false);
  });
});

describe("translation snapping", () => {
  it("uses Depence's 10 cm grid", () => {
    expect(GRID_SNAP_M).toBe(0.10);
  });

  it("snaps absolute position onto grid lines, not just in grid-sized steps", () => {
    const out = snapTranslation({ x: 1.234, y: 0.06, z: -2.07 }, { snap: true });
    expect(out.x).toBeCloseTo(1.2, 10);
    expect(out.y).toBeCloseTo(0.1, 10);
    expect(out.z).toBeCloseTo(-2.1, 10);
  });

  it("passes position through untouched with no SHIFT", () => {
    const p = { x: 1.234, y: 0.06, z: -2.07 };
    expect(snapTranslation(p, { snap: false })).toEqual(p);
  });

  it("ignores a nonsensical step rather than producing NaN", () => {
    expect(snapScalar(1.23, 0)).toBe(1.23);
    expect(snapScalar(1.23, -1)).toBe(1.23);
    expect(snapScalar(NaN, 0.1)).toBeNaN();
  });
});

describe("rotation snapping", () => {
  it("uses Depence's 5 degree raster", () => {
    expect(ANGLE_SNAP_DEG).toBe(5);
    expect(snapAngleDeg(37, { snap: true })).toBe(35);
    expect(snapAngleDeg(38, { snap: true })).toBe(40);
  });

  it("leaves the angle alone without SHIFT", () => {
    expect(snapAngleDeg(37.3, { snap: false })).toBe(37.3);
  });
});

describe("axis constraint", () => {
  it("keeps only the named axis", () => {
    const d = { x: 1, y: 2, z: 3 };
    expect(constrainToAxis(d, "x")).toEqual({ x: 1, y: 0, z: 0 });
    expect(constrainToAxis(d, "y")).toEqual({ x: 0, y: 2, z: 0 });
    expect(constrainToAxis(d, "z")).toEqual({ x: 0, y: 0, z: 3 });
  });

  it("supports plane handles", () => {
    expect(constrainToAxis({ x: 1, y: 2, z: 3 }, "xz")).toEqual({ x: 1, y: 0, z: 3 });
  });

  it("passes everything through when unconstrained", () => {
    expect(constrainToAxis({ x: 1, y: 2, z: 3 }, null)).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe("dominant axis lock", () => {
  it("keeps the axis travelled furthest and zeroes the rest", () => {
    expect(lockDominantAxis({ x: 0.2, y: 0.01, z: 0.05 })).toEqual({ x: 0.2, y: 0, z: 0 });
    expect(lockDominantAxis({ x: 0.01, y: 0.02, z: 0.9 })).toEqual({ x: 0, y: 0, z: 0.9 });
  });

  it("never keeps two axes when magnitudes tie", () => {
    const out = lockDominantAxis({ x: 0.5, y: 0.5, z: 0 });
    const nonZero = [out.x, out.y, out.z].filter(v => v !== 0);
    expect(nonZero).toHaveLength(1);
  });

  it("handles a zero drag", () => {
    expect(lockDominantAxis({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("resolveDrag", () => {
  it("adds the delta to the start position", () => {
    const out = resolveDrag({ x: 1, y: 0, z: 1 }, { x: 0.5, y: 0, z: 0.25 }, {});
    expect(out).toEqual({ x: 1.5, y: 0, z: 1.25 });
  });

  it("applies the gizmo axis before snapping", () => {
    const out = resolveDrag({ x: 0, y: 0, z: 0 }, { x: 0.44, y: 9, z: 9 },
      { axis: "x", mods: { snap: true } });
    expect(out.x).toBeCloseTo(0.4, 10);
    expect(out.y).toBe(0);   // the axis constraint must win over the raw delta
    expect(out.z).toBe(0);
  });

  it("applies the CAD axis lock only when no gizmo axis was chosen", () => {
    const locked = resolveDrag({ x: 0, y: 0, z: 0 }, { x: 0.9, y: 0, z: 0.2 },
      { mods: { snap: true }, orthographic: true });
    expect(locked.z).toBe(0);

    // With an explicit gizmo axis, the lock must not also fire and fight it.
    const explicit = resolveDrag({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0.9 },
      { axis: "z", mods: { snap: true }, orthographic: true });
    expect(explicit.z).toBeCloseTo(0.9, 10);
  });

  it("lets ALT defeat snapping mid-drag", () => {
    const out = resolveDrag({ x: 0, y: 0, z: 0 }, { x: 0.123, y: 0, z: 0 },
      { axis: "x", mods: { snap: true, freeform: true } });
    expect(out.x).toBeCloseTo(0.123, 10);
  });

  it("survives missing arguments", () => {
    expect(resolveDrag(null, null, {})).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("duplicate gesture", () => {
  it("fires on CTRL", () => {
    expect(shouldDuplicate({ duplicate: true })).toBe(true);
    expect(shouldDuplicate({ duplicate: false })).toBe(false);
    expect(shouldDuplicate(null)).toBe(false);
  });
});

describe("shortcuts", () => {
  it("returns to the Move tool on Escape, as Depence does", () => {
    expect(DEFAULT_TOOL).toBe(TOOLS.MOVE);
    expect(matchShortcut({ key: "Escape" })).toBe("tool:move");
  });

  it("distinguishes Ctrl+D from a bare D", () => {
    expect(matchShortcut({ key: "d", ctrlKey: true })).toBe("edit:duplicate");
    expect(matchShortcut({ key: "d" })).toBeNull();
  });

  it("is case insensitive for letter keys", () => {
    expect(matchShortcut({ key: "W" })).toBe("tool:move");
    expect(matchShortcut({ key: "E" })).toBe("tool:rotate");
  });

  it("returns null for anything unbound", () => {
    expect(matchShortcut({ key: "z" })).toBeNull();
    expect(matchShortcut(null)).toBeNull();
  });

  it("exposes a renderable shortcut list with labels", () => {
    expect(SHORTCUTS.length).toBeGreaterThan(4);
    for (const s of SHORTCUTS) {
      expect(s.label).toBeTruthy();
      expect(s.desc).toBeTruthy();
      expect(s.command).toMatch(/^[a-z]+:[a-z]+$/);
    }
  });
});
