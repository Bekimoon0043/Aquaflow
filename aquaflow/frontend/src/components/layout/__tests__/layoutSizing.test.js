import { describe, it, expect } from "vitest";
import {
  clamp, nextSize, maxForContainer, defaultLayout, sanitizeLayout,
  loadLayout, saveLayout, PANEL_LIMITS, MIN_CENTER_PX, LAYOUT_STORAGE_KEY,
} from "../layoutSizing";

/** In-memory stand-in for localStorage. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _dump: () => Object.fromEntries(map),
  };
}

describe("clamp", () => {
  it("bounds a value both ways", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
  });

  it("falls back to min for a non-number instead of producing NaN", () => {
    expect(clamp(NaN, 3, 10)).toBe(3);
    expect(clamp(undefined, 3, 10)).toBe(3);
  });
});

describe("nextSize", () => {
  it("grows a leading-edge panel when dragged right", () => {
    expect(nextSize({ startSize: 260, delta: 40, min: 0, max: 999 })).toBe(300);
  });

  it("inverts for a panel whose handle is on its leading edge", () => {
    // The inspector is docked right: dragging right must SHRINK it. Getting this
    // backwards is the classic splitter bug.
    expect(nextSize({ startSize: 300, delta: 40, invert: true, min: 0, max: 999 })).toBe(260);
    expect(nextSize({ startSize: 300, delta: -40, invert: true, min: 0, max: 999 })).toBe(340);
  });

  it("clamps to the minimum so a panel cannot be dragged to a sliver", () => {
    expect(nextSize({ startSize: 200, delta: -10000, min: 150, max: 700 })).toBe(150);
  });

  it("clamps to the maximum", () => {
    expect(nextSize({ startSize: 200, delta: 10000, min: 150, max: 700 })).toBe(700);
  });

  it("treats a missing delta as no movement", () => {
    expect(nextSize({ startSize: 260, delta: undefined, min: 0, max: 999 })).toBe(260);
  });
});

describe("maxForContainer", () => {
  it("leaves at least the minimum centre width", () => {
    // 1000 wide, the other panel takes 300 → at most 1000-300-260 = 440.
    expect(maxForContainer("leftWidth", 1000, 300)).toBe(1000 - 300 - MIN_CENTER_PX);
  });

  it("never exceeds the panel's own hard ceiling", () => {
    expect(maxForContainer("leftWidth", 100000, 0)).toBe(PANEL_LIMITS.leftWidth.max);
  });

  it("never returns below the panel minimum, even on a tiny window", () => {
    // A window too small for everyone should still yield a usable range, not an
    // inverted one where max < min.
    const m = maxForContainer("leftWidth", 200, 300);
    expect(m).toBe(PANEL_LIMITS.leftWidth.min);
    expect(m).toBeGreaterThanOrEqual(PANEL_LIMITS.leftWidth.min);
  });

  it("falls back to the static ceiling when the container is unmeasured", () => {
    expect(maxForContainer("leftWidth", 0, 0)).toBe(PANEL_LIMITS.leftWidth.max);
  });

  it("returns Infinity for an unknown panel rather than throwing", () => {
    expect(maxForContainer("nope", 1000, 0)).toBe(Infinity);
  });

  it("uses each panel's own centre reserve, not one global figure", () => {
    // The preview sidebar splits a nested container, so it reserves less for the centre
    // than the shell panels do. With a shared 260px reserve it would be pinned at its
    // minimum in a narrow container and refuse to grow.
    expect(PANEL_LIMITS.previewSidebar.minCenter).toBeLessThan(PANEL_LIMITS.leftWidth.minCenter);
    expect(maxForContainer("previewSidebar", 600, 0)).toBe(600 - PANEL_LIMITS.previewSidebar.minCenter);
    expect(maxForContainer("leftWidth", 600, 0)).toBe(600 - PANEL_LIMITS.leftWidth.minCenter);
  });

  it("lets the preview sidebar grow in a container that the shell reserve would have blocked", () => {
    const container = 400;
    const max = maxForContainer("previewSidebar", container, 0);
    expect(max).toBeGreaterThan(PANEL_LIMITS.previewSidebar.min);
  });
});

describe("defaults", () => {
  it("matches the sizes the shell shipped with, so a first run looks unchanged", () => {
    expect(defaultLayout()).toEqual({
      leftWidth: 260, rightWidth: 300, timelineHeight: 280, previewSidebar: 200,
    });
  });
});

describe("sanitizeLayout", () => {
  it("keeps valid values", () => {
    const out = sanitizeLayout({ leftWidth: 400, rightWidth: 250, timelineHeight: 150, previewSidebar: 300 });
    expect(out.leftWidth).toBe(400);
    expect(out.previewSidebar).toBe(300);
  });

  it("clamps stored values that are out of range", () => {
    const out = sanitizeLayout({ leftWidth: 99999, rightWidth: -50 });
    expect(out.leftWidth).toBe(PANEL_LIMITS.leftWidth.max);
    expect(out.rightWidth).toBe(PANEL_LIMITS.rightWidth.min);
  });

  it("ignores unknown keys and non-numbers", () => {
    const out = sanitizeLayout({ leftWidth: "wide", bogus: 42 });
    expect(out.leftWidth).toBe(PANEL_LIMITS.leftWidth.default);
    expect(out.bogus).toBeUndefined();
  });

  it("returns defaults for junk input", () => {
    expect(sanitizeLayout(null)).toEqual(defaultLayout());
    expect(sanitizeLayout("nope")).toEqual(defaultLayout());
    expect(sanitizeLayout(7)).toEqual(defaultLayout());
  });
});

describe("persistence", () => {
  it("round-trips a layout", () => {
    const s = fakeStorage();
    saveLayout({ leftWidth: 333, rightWidth: 222, timelineHeight: 111, previewSidebar: 199 }, s);
    const back = loadLayout(s);
    expect(back.leftWidth).toBe(333);
    expect(back.rightWidth).toBe(222);
    expect(back.timelineHeight).toBe(111);
    expect(back.previewSidebar).toBe(199);
  });

  it("stores under a versioned key", () => {
    const s = fakeStorage();
    saveLayout(defaultLayout(), s);
    expect(Object.keys(s._dump())).toContain(LAYOUT_STORAGE_KEY);
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadLayout(fakeStorage())).toEqual(defaultLayout());
  });

  it("survives corrupt stored JSON instead of throwing", () => {
    const s = fakeStorage({ [LAYOUT_STORAGE_KEY]: "{not json" });
    expect(loadLayout(s)).toEqual(defaultLayout());
  });

  it("repairs an out-of-range stored layout on load", () => {
    const s = fakeStorage({ [LAYOUT_STORAGE_KEY]: JSON.stringify({ leftWidth: 5, rightWidth: 99999 }) });
    const out = loadLayout(s);
    // A layout that would leave an ungrabbable sliver must not be restorable.
    expect(out.leftWidth).toBe(PANEL_LIMITS.leftWidth.min);
    expect(out.rightWidth).toBe(PANEL_LIMITS.rightWidth.max);
  });

  it("does not throw when storage is unavailable", () => {
    const broken = {
      getItem() { throw new Error("blocked"); },
      setItem() { throw new Error("blocked"); },
    };
    expect(() => loadLayout(broken)).not.toThrow();
    expect(loadLayout(broken)).toEqual(defaultLayout());
    expect(saveLayout(defaultLayout(), broken)).toBe(false);
  });

  it("reports success when a write lands", () => {
    expect(saveLayout(defaultLayout(), fakeStorage())).toBe(true);
  });
});

describe("drag behaviour end to end", () => {
  it("a full drag from start size lands where the pointer is, within limits", () => {
    const container = 1400;
    const other = 300;
    const max = maxForContainer("leftWidth", container, other);
    let size = 260;
    for (const delta of [10, 40, 120, 400, 5000]) {
      size = nextSize({ startSize: 260, delta, min: PANEL_LIMITS.leftWidth.min, max });
      expect(size).toBeGreaterThanOrEqual(PANEL_LIMITS.leftWidth.min);
      expect(size).toBeLessThanOrEqual(max);
    }
    expect(size).toBe(max);   // the last, huge drag pins it to the ceiling
  });

  it("timeline height inverts, because its handle is on the top edge", () => {
    // Dragging the divider DOWN (positive dy) must make the timeline shorter.
    const shorter = nextSize({ startSize: 280, delta: 60, invert: true, min: 90, max: 900 });
    expect(shorter).toBe(220);
    const taller = nextSize({ startSize: 280, delta: -60, invert: true, min: 90, max: 900 });
    expect(taller).toBe(340);
  });
});
