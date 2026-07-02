import React from "react";

export default function LogPanel({ onClose }) {
  return (
    <div className="log-panel">
      <div className="panel-header">
        <h3>Runtime Logs</h3>
        <button onClick={onClose}>Close</button>
      </div>
      <pre>{`[INFO] LuxuryCon Fountain Studio UI loaded
[INFO] Device abstraction layer ready
[INFO] Dry-run safety mode active`}</pre>
    </div>
  );
}
