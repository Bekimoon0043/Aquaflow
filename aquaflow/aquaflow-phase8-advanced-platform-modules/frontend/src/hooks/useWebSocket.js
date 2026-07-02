/**
 * useWebSocket.js
 * Persistent WebSocket connection to AquaFlow backend.
 * Auto-reconnects on disconnect, exposes send() and connection state.
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
  const mountedRef = useRef(true);

  const {
    setConnectionState,
    setPlaybackFromServer,
    updateDevicesFromServer,
    applyServerNodeUpdate,
    applyServerShowSnapshot,
    addServerLog,
  } = useShowStore();

  const handleMessage = useCallback((data) => {
    switch (data.type) {
      case "init":
        if (data.devices) updateDevicesFromServer(data.devices);
        if (data.playback) setPlaybackFromServer(data.playback);
        if (data.show_snapshot) applyServerShowSnapshot(data.show_snapshot);
        break;

      case "playback_state":
        setPlaybackFromServer(data.state);
        break;

      case "device_update":
        updateDevicesFromServer(data.devices);
        break;

      case "node_updated":
        applyServerNodeUpdate(data.node_id, data.key, data.value);
        break;

      case "show_snapshot":
        applyServerShowSnapshot(data.snapshot);
        break;

      case "sync_ack":
        addServerLog({ level: "info", msg: `Backend accepted runtime sync rev ${data.revision ?? "?"}` });
        break;

      case "telemetry":
        useShowStore.getState().updateTelemetry(data.device_id, data.values);
        break;

      case "alarm":
        addServerLog({ level: "error", msg: data.message, deviceId: data.device_id });
        break;

      case "log":
        addServerLog({ level: data.level || "info", msg: data.message });
        break;

      case "emergency_stop":
        setPlaybackFromServer(data.state || { state: "stopped", playhead: 0 });
        addServerLog({ level: "error", msg: "⚠️ EMERGENCY STOP executed" });
        break;

      default:
        break;
    }
  }, [addServerLog, applyServerNodeUpdate, applyServerShowSnapshot, setPlaybackFromServer, updateDevicesFromServer]);

  const scheduleReconnect = useCallback((connect) => {
    if (!mountedRef.current) return;
    if (attemptRef.current >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionState("failed");
      return;
    }
    attemptRef.current += 1;
    const delay = RECONNECT_DELAY * Math.min(attemptRef.current, 5);
    reconnectTimer.current = setTimeout(connect, delay);
  }, [setConnectionState]);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    try {
      setConnectionState("connecting");
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setConnectionState("connected");
        addServerLog({ level: "info", msg: "Connected to AquaFlow backend" });
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
        setConnectionState("disconnected");
        addServerLog({ level: "warn", msg: "Backend connection lost. Reconnecting..." });
        scheduleReconnect(connect);
      };

      ws.onerror = () => {
        setConnectionState("error");
        ws.close();
      };
    } catch (e) {
      setConnectionState("error");
      scheduleReconnect(connect);
    }
  }, [WS_URL, addServerLog, handleMessage, scheduleReconnect, setConnectionState]);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { send };
}
