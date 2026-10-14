/**
 * useBakeTier.js — lets a Final render (finalRender.js) temporarily rebuild the preview
 * scene at another tier and await the result. The tier is an override on top of the
 * user's/adaptive tier (`effectiveQuality`), which is never modified, so clearing the
 * override restores the preview exactly.
 *
 *   const bakeTier = useBakeTier(sceneRef);
 *   const sceneTier = bakeTier.tier || effectiveQuality;   // what the scene is built with
 *   // in the scene-init effect: bakeTier.ready(scene) / bakeTier.failed(err)
 *   const scene = await bakeTier.request("high");          // null = back to the preview
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { GpuLimitError } from "./finalRender";

export const BAKE_TIER_TIMEOUT_MS = 45000;

export function useBakeTier(sceneRef, { timeoutMs = BAKE_TIER_TIMEOUT_MS } = {}) {
  const [tier, setTier] = useState(null);
  const tierRef = useRef(null);
  const waitRef = useRef(null);

  const settle = (fn, value) => {
    const w = waitRef.current;
    if (!w) return;
    waitRef.current = null;
    clearTimeout(w.timer);
    w[fn](value);
  };

  const ready = useCallback((scene) => settle("resolve", scene), []);
  const failed = useCallback((err) => settle("reject", err instanceof Error ? err : new GpuLimitError(String(err))), []);

  /**
   * Rebuild at `next` (null = the preview tier `fallbackTier`). Resolves with the scene
   * once it exists; immediately when the current scene already has that tier.
   */
  const request = useCallback((next, fallbackTier) => new Promise((resolve, reject) => {
    const wanted = next || fallbackTier;
    tierRef.current = next || null;
    const current = sceneRef.current;
    if (current && current.quality === wanted) {
      setTier(next || null);
      resolve(current);
      return;
    }
    settle("reject", new Error("superseded"));
    const timer = setTimeout(() => settle("reject", new GpuLimitError(`Building the ${wanted} scene timed out.`)), timeoutMs);
    waitRef.current = { resolve, reject, timer };
    setTier(next || null);
  }), [sceneRef, timeoutMs]);

  return useMemo(() => ({ tier, tierRef, request, ready, failed }), [tier, request, ready, failed]);
}
