import React from "react";
import { useWebSocketContext } from "../hooks/WebSocketContext";

export default function ConnectionBanner() {
  const { status } = useWebSocketContext();
  return (
    <div className={`connection-banner ${status}`}>
      Backend: {status} · LuxuryCon Fountain Studio Runtime
    </div>
  );
}
