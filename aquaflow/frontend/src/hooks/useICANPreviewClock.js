import { useEffect } from "react";
import { useICANPreviewStore } from "../store/icanPreviewStore";

/**
 * One UI clock for isolated I-CAN/design previews.
 * Mount once at the application workspace level so viewport, timeline, and transport
 * remain observers of the same state instead of starting competing timers.
 */
export function useICANPreviewClock(intervalMs = 40) {
  const active = useICANPreviewStore(state => state.active);
  const playback = useICANPreviewStore(state => state.playback);

  useEffect(() => {
    if (!active || playback !== "playing") return undefined;
    const timer = window.setInterval(() => useICANPreviewStore.getState().tick(), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, playback, intervalMs]);
}
