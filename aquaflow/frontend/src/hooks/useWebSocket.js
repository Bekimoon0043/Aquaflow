/**
 * useWebSocket.js
 * Persistent WebSocket connection to AquaFlow backend.
 * FIXED: No store subscription — reads actions on demand to prevent re-render loops.
 */
import { useEffect, useRef, useCallback } from "react";
import { useShowStore } from "../store/showStore";
import { WS_URL } from "../config";

const RECONNECT_DELAY = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket() {
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(false);  // Starts FALSE — set true in effect

  // ── CRITICAL FIX: No store subscription here ──
  // We use useShowStore.getState() inside handlers instead of useShowStore()
  // This prevents re-renders from recreating all our callbacks

  const handleMessage = useCallback((data) => {
    // Read latest store actions directly — no subscription, no re-renders
    const store = useShowStore.getState();

    switch (data.type) {
      case "init":
        if (data.devices) store.updateDevicesFromServer(data.devices);
        if (data.playback) store.setPlaybackFromServer(data.playback);
        if (data.show_snapshot) store.applyServerShowSnapshot(data.show_snapshot);
        break;

      case "playback_state":
        store.setPlaybackFromServer(data.state);
        break;

      case "device_update":
        store.updateDevicesFromServer(data.devices);
        break;

      case "node_updated":
        store.applyServerNodeUpdate(data.node_id, data.key, data.value);
        break;

      case "show_snapshot":
        store.applyServerShowSnapshot(data.snapshot);
        break;

      case "sync_ack":
        store.addServerLog({ level: "info", msg: `Backend accepted runtime sync rev ${data.revision ?? "?"}` });
        break;

      case "telemetry":
        store.updateTelemetry(data.device_id, data.values);
        break;

      case "alarm":
        store.addServerLog({ level: "error", msg: data.message, deviceId: data.device_id });
        break;

      case "log":
        store.addServerLog({ level: data.level || "info", msg: data.message });
        break;

      case "emergency_stop":
        store.setPlaybackFromServer(data.state || { state: "stopped", playhead: 0 });
        store.addServerLog({ level: "error", msg: "⚠️ EMERGENCY STOP executed" });
        break;

      default:
        break;
    }
  }, []); // ← EMPTY dependency array! Never recreates.

  const scheduleReconnect = useCallback((connectFn) => {
    if (!mountedRef.current) return;
    if (attemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      // Read store directly, no subscription
      useShowStore.getState().setConnectionState("failed");
      return;
    }
    attemptRef.current += 1;
    const delay = RECONNECT_DELAY * Math.min(attemptRef.current, 5);
    reconnectTimer.current = setTimeout(connectFn, delay);
  }, []); // ← EMPTY dependency array!

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      // Read store directly for state update
      useShowStore.getState().setConnectionState("connecting");

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        useShowStore.getState().setConnectionState("connected");
        useShowStore.getState().addServerLog({ level: "info", msg: "Connected to AquaFlow backend" });
        ws.send(JSON.stringify({ type: "request_show_snapshot" }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleMessage(data);
        } catch (e) {
          console.warn("WS parse error:", e);
        }
      };

      ws.onclose = () => {
        useShowStore.getState().setConnectionState("disconnected");
        useShowStore.getState().addServerLog({ level: "warn", msg: "Backend connection lost. Reconnecting..." });
        scheduleReconnect(connect);
      };

      ws.onerror = () => {
        useShowStore.getState().setConnectionState("error");
        ws.close();
      };
    } catch (e) {
      useShowStore.getState().setConnectionState("error");
      scheduleReconnect(connect);
    }
  }, []); // ← EMPTY dependency array! Stable forever.

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    mountedRef.current = true;   // ← NOW we mark as mounted
    connect();

    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;

      // Prevent onclose from triggering reconnect during cleanup
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect]); // ← connect is stable (empty deps), so this runs ONCE

  return { send };
}