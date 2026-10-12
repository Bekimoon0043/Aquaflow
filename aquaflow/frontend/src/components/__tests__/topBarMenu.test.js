import { describe, it, expect, vi } from "vitest";
import {
  MENU_ITEMS,
  menuActionIds,
  panelLabel,
  editCommandNotice,
  desktopVersionFromUserAgent,
  createMenuActionHandlers,
  retryDispatch,
} from "../topBarMenu";

const stubDeps = () => new Proxy({}, {
  get: (target, key) => {
    if (!(key in target)) target[key] = vi.fn();
    return target[key];
  },
});

describe("TopBar menu wiring", () => {
  it("maps every 'action' menu entry to a handler", () => {
    const handlers = createMenuActionHandlers(stubDeps());
    const missing = menuActionIds().filter((id) => typeof handlers[id] !== "function");
    expect(missing).toEqual([]);
  });

  it("every handler runs and calls at least one dependency", () => {
    for (const id of menuActionIds()) {
      const deps = stubDeps();
      createMenuActionHandlers(deps)[id]();
      const called = Object.values(deps).some((fn) => fn.mock.calls.length > 0);
      expect(called, id).toBe(true);
    }
  });

  it("routes the previously dead items to real actions", () => {
    const deps = stubDeps();
    const h = createMenuActionHandlers(deps);
    h["Copy"](); h["Cut"](); h["Paste"](); h["Select All"]();
    expect(deps.editCommand.mock.calls.map((c) => c[0])).toEqual(["copy", "cut", "paste", "selectAll"]);
    h["Preferences"](); expect(deps.showPreferences).toHaveBeenCalled();
    h["About AquaFlow"](); expect(deps.showAbout).toHaveBeenCalled();
    h["Export Show"](); expect(deps.exportShow).toHaveBeenCalled();
    h["Import Show"](); expect(deps.importShow).toHaveBeenCalled();
    expect(deps.openBrowser).not.toHaveBeenCalled();
    h["AI Show Builder"]();
    expect(deps.setActivePanel).toHaveBeenCalledWith("show_programmer");
    expect(deps.openShowAi).toHaveBeenCalled();
  });

  it("lists the AI Assistant panel in the AI menu", () => {
    expect(MENU_ITEMS.AI.some(([, type, value]) => type === "panel" && value === "ai")).toBe(true);
    expect(panelLabel("ai")).toBe("AI Assistant (learned patterns)");
  });
});

describe("editCommandNotice", () => {
  it("is silent when a listener handled the command", () => {
    expect(editCommandNotice("copy", { handled: true, activePanel: "fountain" })).toBeNull();
  });

  it("names the command and active panel when unhandled", () => {
    expect(editCommandNotice("copy", { handled: false, activePanel: "fountain" })).toBe("Copy isn't available in Fountain Control (I-CAN)");
    expect(editCommandNotice("selectAll", { activePanel: "plc" })).toBe("Select All isn't available in PLC");
  });

  it("treats delete/deselect as serviced by legacy editors outside Show Programming", () => {
    expect(editCommandNotice("delete", { activePanel: "nodes" })).toBeNull();
    expect(editCommandNotice("deselect", { activePanel: "geometry" })).toBeNull();
    expect(editCommandNotice("delete", { activePanel: "show_programmer" })).toBe("Delete isn't available in Show Programmer");
  });
});

describe("desktopVersionFromUserAgent", () => {
  it("reads the Electron app version", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) AquaFlow Studio/1.2.26 Chrome/124.0.6367.243 Electron/30.1.0 Safari/537.36";
    expect(desktopVersionFromUserAgent(ua)).toBe("1.2.26");
  });
  it("returns null in a normal browser", () => {
    expect(desktopVersionFromUserAgent("Mozilla/5.0 (X11) AppleWebKit/537.36 Chrome/124.0 Safari/537.36")).toBeNull();
  });
});

describe("retryDispatch", () => {
  const sync = (fn) => fn();
  it("stops as soon as the event is handled", async () => {
    let n = 0;
    await expect(retryDispatch(() => ++n >= 3, { schedule: sync })).resolves.toBe(true);
    expect(n).toBe(3);
  });
  it("gives up after the given tries", async () => {
    let n = 0;
    await expect(retryDispatch(() => { n += 1; return false; }, { tries: 4, schedule: sync })).resolves.toBe(false);
    expect(n).toBe(4);
  });
});
