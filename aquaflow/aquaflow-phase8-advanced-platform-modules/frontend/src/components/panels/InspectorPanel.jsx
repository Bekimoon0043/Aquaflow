import React from "react";

export default function InspectorPanel({ width = 300 }) {
  return (
    <aside className="side-panel inspector" style={{ width }}>
      <h3>Inspector</h3>
      <p className="muted">Select a device, cue, nozzle, light, pump, or PLC channel.</p>
      <div className="property-grid">
        <label>Mode</label><span>Dry Run</span>
        <label>Status</label><span>Ready</span>
        <label>Safety</label><span>Interlocked</span>
        <label>Protocol</label><span>Abstraction Layer</span>
      </div>
    </aside>
  );
}
