import { useEffect, useMemo, useRef } from "react";
import { useShowStore } from "../store/showStore";
import { useWebSocket } from "./useWebSocket";
import { buildRuntimePayload, buildRuntimeSignature } from "../utils/runtimeSync";

export function useServerShowSync() {
  const { send } = useWebSocket();
  const syncState = useShowStore((s) => ({
    currentShow: s.currentShow,
    nodes: s.nodes,
    connections: s.connections,
    timelineTracks: s.timelineTracks,
    devices: s.devices,
    engineeringFixtures: s.engineeringFixtures,
    timelineZoom: s.timelineZoom,
    showGrid: s.showGrid,
    snapToGrid: s.snapToGrid,
    connectionState: s.connectionState,
    serverMirrorSignature: s.serverMirrorSignature,
    isDirty: s.isDirty,
  }));

  const payload = useMemo(() => buildRuntimePayload(syncState), [syncState]);
  const signature = useMemo(() => buildRuntimeSignature(syncState), [syncState]);
  const readyRef = useRef(false);
  const lastSyncedRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    if (syncState.serverMirrorSignature) {
      lastSyncedRef.current = syncState.serverMirrorSignature;
    }
  }, [syncState.serverMirrorSignature]);

  useEffect(() => {
    if (syncState.connectionState !== "connected") {
      readyRef.current = false;
      clearTimeout(timerRef.current);
      return;
    }

    if (!readyRef.current) {
      readyRef.current = true;
      const hasServerMirror = Boolean(syncState.serverMirrorSignature);
      const shouldPushInitialState = !hasServerMirror || (syncState.isDirty && signature !== syncState.serverMirrorSignature);

      if (!shouldPushInitialState) {
        lastSyncedRef.current = signature;
        return;
      }
    }

    if (signature === lastSyncedRef.current) {
      return;
    }

    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const ok = send({ type: "sync_show", payload });
      if (ok) {
        lastSyncedRef.current = signature;
      }
    }, 500);

    return () => clearTimeout(timerRef.current);
  }, [syncState.connectionState, signature, payload, send]);
}


