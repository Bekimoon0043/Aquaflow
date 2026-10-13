import { useEffect, useMemo, useRef } from "react";
import { useShowStore } from "../store/showStore";
import useEngineeringStore from "../store/engineeringStore";
import { useWS } from "./WebSocketContext";
import { buildRuntimePayload, buildRuntimeSignature } from "../utils/runtimeSync";
// AF-HUB-004 — the backend payload's fixtures come from the single master
// (engineeringStore.fixtures), projected deterministically; never a stale mirror.
import { projectGroups, assertFixtureConsistency } from "../runtime/fixtureProjection";

export function useServerShowSync() {
  // The root WebSocketProvider owns the one backend connection. Creating another
  // useWebSocket() here allowed two initial snapshots to race: a late stale snapshot
  // could replace a project that the user had just opened (its engineering model stayed
  // loaded while the show/timeline reverted to "Untitled Show"). Send syncs through the
  // provider connection so snapshot ordering and ownership stay deterministic.
  const { send } = useWS();
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
    localProjectPendingSync: s.localProjectPendingSync,
    isDirty: s.isDirty,
  }));

  // AF-HUB-004 — MASTER fixtures. engineeringStore.fixtures is the single source of
  // truth; showStore.engineeringFixtures is a legacy mirror that was never written, so
  // the old payload sent an empty fixture list and the backend was never fixture-aware.
  const masterFixtures = useEngineeringStore((s) => s.fixtures);
  const groups = useMemo(() => projectGroups(masterFixtures), [masterFixtures]);

  // buildRuntimePayload prefers source.fixtures — feed it the master + derived groups.
  const payloadSource = useMemo(
    () => ({ ...syncState, fixtures: masterFixtures || [], groups }),
    [syncState, masterFixtures, groups]
  );

  // Divergence guard (fails loud): if the legacy mirror is ever non-empty and disagrees
  // with the master, something re-introduced a second fixture path — surface it.
  useEffect(() => {
    const mirror = syncState.engineeringFixtures;
    if (Array.isArray(mirror) && mirror.length) {
      assertFixtureConsistency(masterFixtures, mirror, { label: "showStore.engineeringFixtures" });
    }
  }, [masterFixtures, syncState.engineeringFixtures]);

  const payload = useMemo(() => buildRuntimePayload(payloadSource), [payloadSource]);
  const signature = useMemo(() => buildRuntimeSignature(payloadSource), [payloadSource]);
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
      const shouldPushInitialState = syncState.localProjectPendingSync
        || !hasServerMirror
        || (syncState.isDirty && signature !== syncState.serverMirrorSignature);

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


