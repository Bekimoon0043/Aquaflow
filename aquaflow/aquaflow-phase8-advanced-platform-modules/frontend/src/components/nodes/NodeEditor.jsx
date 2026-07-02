import React from "react";

export default function NodeEditor() {
  return (
    <section className="panel node-editor">
      <div className="panel-header">
        <h2>Node Editor</h2>
        <span className="badge">Visual Logic</span>
      </div>
      <div className="node-grid">
        {["Music Analysis", "Fountain Effects", "DMX Lighting", "PLC Control", "AI Choreography", "Safety Logic"].map((name) => (
          <div key={name} className="node-card">
            <strong>{name}</strong>
            <small>Ready for module binding</small>
          </div>
        ))}
      </div>
    </section>
  );
}
