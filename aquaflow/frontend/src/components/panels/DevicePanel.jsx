import { useState } from "react";
import { useShowStore } from "../../store/showStore";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/devices`;

const TYPE_ICONS = {
  pump: "〰", valve: "⊠", lighting: "✦", flame: "🔥",
  fog: "≈", laser: "✸", sensor: "◉", audio: "♫",
};

const GROUPS = ["pump", "valve", "lighting", "flame", "fog", "laser", "sensor"];

export default function DevicePanel({ width }) {
  const {
    devices,
    selectedDeviceId,
    selectDevice,
    updateDevicesFromServer,
    addDevice,
    addServerLog,
  } = useShowStore();
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [scanActive, setScanActive] = useState(false);

  const filtered = devices.filter((d) =>
    d.label.toLowerCase().includes(search.toLowerCase()) ||
    d.protocol.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = GROUPS.reduce((acc, g) => {
    acc[g] = filtered.filter((d) => d.type === g);
    return acc;
  }, {});

  const onlineCount = devices.filter((d) => d.status === "online").length;

  const handleScan = async () => {
    setScanActive(true);
    addServerLog({ level: "info", msg: "Quick network scan requested from device panel" });
    try {
      const res = await fetch(`${API}/scan?subnet=${encodeURIComponent("192.168.1.0/24")}&quick=true`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || "Scan failed");
      }
      if (data.devices?.length) {
        updateDevicesFromServer(data.devices.map((d) => ({
          id: d.id || `scan-${d.ip || "unknown"}-${d.port || 0}`,
          label: d.label || `${d.device_type || d.type || "device"} ${d.ip || ""}`.trim(),
          type: d.device_type || d.type || "unknown",
          protocol: d.protocol || "unknown",
          ip: d.ip || null,
          port: d.port || null,
          status: d.status || "online",
          health: d.health ?? 85,
        })));
      }
      addServerLog({ level: "info", msg: `Quick scan complete: ${data.found || 0} device(s) found` });
    } catch (error) {
      addServerLog({ level: "error", msg: `Device panel scan failed: ${error.message}` });
    } finally {
      setScanActive(false);
    }
  };

  const handleAdd = () => {
    const label = window.prompt("Device label", "New Device");
    if (!label) return;
    const type = (window.prompt("Device type (pump, valve, lighting, flame, fog, laser, sensor)", "lighting") || "lighting").trim().toLowerCase();
    const protocol = (window.prompt("Protocol (dmx, artnet, sacn, modbus, mqtt)", "dmx") || "dmx").trim().toLowerCase();
    const ip = (window.prompt("IP address (optional)", "") || "").trim() || null;
    const portText = (window.prompt("Port (optional)", "") || "").trim();
    addDevice({
      id: `local-${Date.now()}`,
      label,
      type,
      protocol,
      ip,
      port: portText ? Number(portText) : null,
      status: "offline",
      health: 0,
    });
    addServerLog({ level: "info", msg: `Added local device placeholder: ${label}` });
  };

  return (
    <div className="panel" style={{ width, flexShrink: 0 }}>
      <div className="panel-header">
        <div className="dot" />
        <span className="panel-title">Devices</span>
        <span style={{
          marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)",
          color: "var(--green)", background: "rgba(16,185,129,0.1)",
          border: "1px solid rgba(16,185,129,0.2)", padding: "1px 5px", borderRadius: 3,
        }}>
          {onlineCount}/{devices.length}
        </span>
      </div>

      <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
        <input
          className="input" placeholder="Search devices..."
          value={search} onChange={(e) => setSearch(e.target.value)}
          style={{ fontSize: 11 }}
        />
      </div>

      <div style={{ display: "flex", gap: 4, padding: "6px 10px", borderBottom: "1px solid var(--border)" }}>
        <button
          className="btn primary"
          style={{ flex: 1, padding: "4px 6px", fontSize: 10, justifyContent: "center" }}
          onClick={handleScan}
          disabled={scanActive}
        >
          {scanActive ? "Scanning..." : "⟳ Scan Network"}
        </button>
        <button className="btn" style={{ padding: "4px 6px", fontSize: 10 }} onClick={handleAdd}>+ Add</button>
      </div>

      <div className="panel-body">
        {GROUPS.map((group) => {
          const groupDevices = grouped[group];
          if (!groupDevices.length) return null;
          const isCollapsed = collapsed[group];
          return (
            <div key={group}>
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [group]: !c[group] }))}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "5px 10px", cursor: "pointer",
                  background: "var(--bg-surface)",
                  borderBottom: "1px solid var(--border)",
                  userSelect: "none",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg-surface)"}
              >
                <span style={{ fontSize: 9, transition: "transform 0.15s", display: "inline-block",
                  transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)", color: "var(--text-muted)" }}>
                  ▾
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
                  textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {TYPE_ICONS[group]} {group}
                </span>
                <span style={{ marginLeft: "auto", fontSize: 9, color: "var(--text-muted)" }}>
                  {groupDevices.length}
                </span>
              </div>

              {!isCollapsed && groupDevices.map((device) => (
                <DeviceRow
                  key={device.id}
                  device={device}
                  selected={selectedDeviceId === device.id}
                  onSelect={() => selectDevice(device.id)}
                />
              ))}
            </div>
          );
        })}
      </div>

      <div style={{
        borderTop: "1px solid var(--border)", padding: "8px 10px",
        background: "var(--bg-surface)", flexShrink: 0,
      }}>
        <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", marginBottom: 4 }}>
          NETWORK STATUS
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {[
            { label: "DMX", color: "var(--accent)" },
            { label: "Art-Net", color: "var(--purple)" },
            { label: "Modbus", color: "var(--orange)" },
          ].map((p) => (
            <div key={p.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: p.color }} />
              <span style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{p.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ device, selected, onSelect }) {
  const statusColor = device.status === "online" ? "var(--green)" : device.status === "warn" ? "var(--amber)" : "var(--red)";
  const healthBarColor = device.health > 80 ? "var(--green)" : device.health > 50 ? "var(--amber)" : "var(--red)";

  return (
    <div
      onClick={onSelect}
      style={{
        padding: "6px 10px 6px 20px",
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        background: selected ? "var(--bg-hover)" : "transparent",
        cursor: "pointer", transition: "background 0.1s",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
      }}
      onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-surface)"; }}
      onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          width: 5, height: 5, borderRadius: "50%", background: statusColor,
          boxShadow: `0 0 4px ${statusColor}`, flexShrink: 0,
        }} />
        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-primary)", flex: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {device.label}
        </span>
        <span className={`badge ${device.protocol}`} style={{ fontSize: 8 }}>
          {device.protocol.toUpperCase()}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
        {device.ip && (
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {device.ip}
          </span>
        )}
        <div style={{ flex: 1, height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
          <div style={{ width: `${device.health}%`, height: "100%", background: healthBarColor, borderRadius: 1 }} />
        </div>
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          {device.health}%
        </span>
      </div>
    </div>
  );
}
