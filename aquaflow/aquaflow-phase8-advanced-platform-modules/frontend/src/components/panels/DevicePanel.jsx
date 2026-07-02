import React, { useEffect, useState } from "react";

export default function DevicePanel({ width = 280 }) {
  const [devices, setDevices] = useState([]);

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/device-map/")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (Array.isArray(data)) setDevices(data);
        else if (data?.devices && Array.isArray(data.devices)) setDevices(data.devices);
      })
      .catch(() => setDevices([]));
  }, []);

  const fallback = ["Pump Group", "Valve Manifold", "DMX Universe", "PLC Rack", "VFD Bank"];

  return (
    <aside className="side-panel" style={{ width }}>
      <h3>Devices</h3>
      <p className="muted">Universal device abstraction</p>
      <div className="device-list">
        {(devices.length ? devices : fallback).map((d, i) => (
          <div className="device-item" key={i}>
            <strong>{typeof d === "string" ? d : d.name || d.id || `Device ${i + 1}`}</strong>
            <small>{typeof d === "string" ? "Dry-run profile" : d.type || "mapped"}</small>
          </div>
        ))}
      </div>
    </aside>
  );
}
