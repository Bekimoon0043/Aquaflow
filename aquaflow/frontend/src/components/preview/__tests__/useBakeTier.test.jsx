// @vitest-environment jsdom
// AF-3D-VID-002 — the tier override a Final render uses to rebuild the preview scene.
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBakeTier } from "../useBakeTier";

describe("useBakeTier", () => {
  it("request(tier) sets the override and resolves when the rebuilt scene is ready", async () => {
    const sceneRef = { current: { quality: "eco" } };
    const { result } = renderHook(() => useBakeTier(sceneRef));
    let p;
    act(() => { p = result.current.request("high", "eco"); });
    expect(result.current.tier).toBe("high");
    expect(result.current.tierRef.current).toBe("high");
    const built = { quality: "high" };
    act(() => { sceneRef.current = built; result.current.ready(built); });
    await expect(p).resolves.toBe(built);
  });

  it("request(null) clears the override; resolves at once when the scene already has that tier", async () => {
    const sceneRef = { current: { quality: "eco" } };
    const { result } = renderHook(() => useBakeTier(sceneRef));
    let p;
    act(() => { p = result.current.request(null, "eco"); });
    await expect(p).resolves.toBe(sceneRef.current);
    expect(result.current.tier).toBeNull();
  });

  it("a failed build rejects so the render can fall back", async () => {
    const sceneRef = { current: null };
    const { result } = renderHook(() => useBakeTier(sceneRef));
    let p;
    act(() => { p = result.current.request("ultra", "eco"); });
    act(() => { result.current.failed(new Error("WebGL: out of memory")); });
    await expect(p).rejects.toThrow(/out of memory/);
  });

  it("times out instead of hanging", async () => {
    const sceneRef = { current: null };
    const { result } = renderHook(() => useBakeTier(sceneRef, { timeoutMs: 20 }));
    let p;
    act(() => { p = result.current.request("high", "eco"); });
    await expect(p).rejects.toMatchObject({ name: "GpuLimitError" });
  });
});
