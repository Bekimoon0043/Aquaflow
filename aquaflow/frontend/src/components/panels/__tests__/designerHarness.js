/**
 * designerHarness.js — mounts the real PoolGeometryDesigner in jsdom for behaviour tests
 * (AF-CAD-030 characterisation, AF-NEXT-011 acceptance).
 *
 * jsdom has no canvas, ResizeObserver or layout, so this harness stubs exactly those:
 *   - canvas.getContext("2d") returns a recording no-op context,
 *   - getBoundingClientRect() of the canvas is (0,0) — so a world point maps to
 *     client = pan + world * zoom with the designer's default view (pan 60,60; zoom 30).
 * Everything else (React state, stores, keyboard handlers) is the production code.
 */
import React from "react";
import { render, fireEvent, act, cleanup } from "@testing-library/react";

globalThis.React = React;

export const DEFAULT_PAN = { x: 60, y: 60 };
export const DEFAULT_ZOOM = 30;

function noopContext() {
  const target = {
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: () => ({ width: 0 }),
    getLineDash: () => [],
  };
  return new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      return () => {};
    },
    set(obj, key, value) { obj[key] = value; return true; },
  });
}

export function installDomStubs() {
  if (typeof window === "undefined") return;
  window.HTMLCanvasElement.prototype.getContext = function getContext() { return noopContext(); };
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    globalThis.ResizeObserver = window.ResizeObserver;
  }
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
    globalThis.requestAnimationFrame = window.requestAnimationFrame;
  }
  window.alert = () => {};
  window.confirm = () => true;
  // Offline: every API call rejects quickly and quietly.
  globalThis.fetch = () => Promise.reject(new Error("offline in tests"));
}

/** World (m) → client coordinates for the default view. */
export const client = (x, y, view = { pan: DEFAULT_PAN, zoom: DEFAULT_ZOOM }) => ({
  clientX: view.pan.x + x * view.zoom,
  clientY: view.pan.y + y * view.zoom,
});

export const wait = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

export async function mountDesigner({ project = null } = {}) {
  installDomStubs();
  const { default: useEngineeringStore } = await import("../../../store/engineeringStore");
  const { createDefaultEngineeringProject } = await import("../../../engineering/engineeringProject");
  const { default: PoolGeometryDesigner } = await import("../PoolGeometryDesigner");
  useEngineeringStore.getState().loadProject({ ...createDefaultEngineeringProject(), ...(project || {}) });
  const utils = render(React.createElement(PoolGeometryDesigner));
  await wait(20);
  const canvas = utils.container.querySelector("canvas");
  const button = (text) => {
    const match = [...utils.container.querySelectorAll("button")].find((b) => b.textContent.trim() === text || b.textContent.includes(text));
    if (!match) throw new Error(`button not found: ${text}`);
    return match;
  };
  const api = {
    ...utils,
    canvas,
    store: useEngineeringStore,
    button,
    click: (text) => act(() => { fireEvent.click(button(text)); }),
    tool: (label) => act(() => {
      const match = [...utils.container.querySelectorAll("button")].find((b) => b.textContent.trim().endsWith(` ${label}`) && b.textContent.trim().split(" ").length <= 3);
      if (!match) throw new Error(`tool not found: ${label}`);
      fireEvent.click(match);
    }),
    down: (x, y, extra = {}) => act(() => { fireEvent.mouseDown(canvas, { button: 0, ...client(x, y), ...extra }); }),
    move: (x, y, extra = {}) => act(() => { fireEvent.mouseMove(canvas, { ...client(x, y), ...extra }); }),
    up: (x, y, extra = {}) => act(() => { fireEvent.mouseUp(canvas, { ...client(x, y), ...extra }); }),
    tap: async (x, y, extra = {}) => {
      await api.down(x, y, extra);
      await api.up(x, y, extra);
    },
    dbl: (x, y) => act(() => { fireEvent.doubleClick(canvas, client(x, y)); }),
    key: (key, extra = {}) => act(() => { fireEvent.keyDown(window, { key, ...extra }); }),
    keyOn: (element, key, extra = {}) => act(() => { fireEvent.keyDown(element, { key, ...extra }); }),
    settle: () => wait(320),
    fixtures: () => useEngineeringStore.getState().fixtures,
    pipes: () => useEngineeringStore.getState().pipes,
  };
  return api;
}

export { cleanup, act, fireEvent };
