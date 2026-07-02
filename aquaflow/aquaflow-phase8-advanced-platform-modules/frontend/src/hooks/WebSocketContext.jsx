import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

const WebSocketContext = createContext(null);

export function WebSocketProvider({ children }) {
  const wsRef = useRef(null);
  const [status, setStatus] = useState("disconnected");
  const [lastMessage, setLastMessage] = useState(null);

  useEffect(() => {
    let socket;
    try {
      socket = new WebSocket("ws://127.0.0.1:8000/ws");
      wsRef.current = socket;
      setStatus("connecting");
      socket.onopen = () => setStatus("connected");
      socket.onclose = () => setStatus("disconnected");
      socket.onerror = () => setStatus("error");
      socket.onmessage = (event) => {
        try { setLastMessage(JSON.parse(event.data)); }
        catch { setLastMessage(event.data); }
      };
    } catch {
      setStatus("error");
    }
    return () => { if (socket) socket.close(); };
  }, []);

  const sendMessage = (payload) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const value = useMemo(() => ({
    status,
    lastMessage,
    sendMessage,
    isConnected: status === "connected"
  }), [status, lastMessage]);

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

export function useWebSocketContext() {
  return useContext(WebSocketContext) || { status: "offline", isConnected: false, sendMessage: () => false, lastMessage: null };
}

export default WebSocketProvider;
export const useWS = useWebSocketContext;
