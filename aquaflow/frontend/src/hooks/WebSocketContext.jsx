/**
 * WebSocketContext.jsx
 * Provides the WebSocket send() function to the entire app.
 * Keeps WS connection alive at the root level.
 */
import { createContext, useContext } from "react";
import { useWebSocket } from "../hooks/useWebSocket";

const WSContext = createContext(null);

export function WebSocketProvider({ children }) {
  const { send } = useWebSocket();
  return <WSContext.Provider value={{ send }}>{children}</WSContext.Provider>;
}

export function useWS() {
  return useContext(WSContext);
}
