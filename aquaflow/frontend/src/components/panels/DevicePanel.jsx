import { useEffect, useMemo, useState } from "react";
import { useShowStore } from "../../store/showStore";
import useEngineeringStore from "../../store/engineeringStore";
import { mergeDevicePanelEntries } from "../../utils/projectDevicePanel";
import { apiGet } from "../../utils/apiClient";

const TYPE_ICONS = {
  pump: "〰", valve: "⊠", lighting: "✦", flame: "🔥",
  fog: "≈", laser: "✸", sensor: "◉", audio: "♫", nozzle: "💧", equipment: "⚙",
};

const GROUPS = ["nozzle", "pump", "valve", "lighting", "flame", "fog", "laser", "sensor", "equipment"];

export default function DevicePanel({ width }) {
  const {
    devices,
    selectedDeviceId,
    selectDevice,
    addServerLog,
    setActivePanel,
  } = useShowStore();
  const fixtures = useEngineeringStore((state) => state.fixtures);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const [scanActive, setScanActive] = useState(false);
  const [controllerEntries, setControllerEntries] = useState([]);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const refresh = async () => {
      const controllers = [];
      try {
        const siteResult = await apiGet("/siemens-sites");
        const sites = Array.isArray(siteResult?.sites) ? siteResult.sites : [];
        const statuses = await Promise.all(sites.map(async (site) => {
          try { return await apiGet(`/siemens-sites/${site.id}/status`); }
          catch { return null; }
        }));
        sites.forEach((site, index) => {
          const status = statuses[index] || {};
          const fresh = status.telemetry_fresh === true;
          const verified = status.hardware_verified === true;
          controllers.push({
            id: `controller:siemens:${site.id}`,
            label: site.name || "Siemens S7 controller",
            type: "equipment",
            protocol: "s7comm",
            ip: site.plc?.ip || null,
            status: verified && fresh ? "online" : (status.verified ? "warn" : "offline"),
            health: null,
            source: "controller",
            detail: status.quality || "Runtime contract not verified",
          });
        });
      } catch {
        // The sidebar remains usable while the backend starts or is unavailable.
      }
      try {
        const status = await apiGet("/ican/status");
        if (status?.gateway_ip) {
          controllers.push({
            id: "controller:ican:gateway",
            label: "I-CAN / NETCAN gateway",
            type: "equipment",
            protocol: "ican",
            ip: status.gateway_ip,
            status: status.verified ? "online" : (status.state === "connected" ? "warn" : "offline"),
            health: null,
            source: "controller",
            detail: status.verified ? "Gateway response verified" : (status.last_error || status.state),
          });
        }
      } catch {
        // No configured I-CAN gateway is a normal project state.
      }
      if (!cancelled) setControllerEntries(controllers);
      if (!cancelled) timer = window.setTimeout(refresh, 5000);
    };
    refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  const entries = useMemo(
    () => mergeDevicePanelEntries([...devices, ...controllerEntries], fixtures),
    [devices, controllerEntries, fixtures],
  );
  const filtered = entries.filter((d) =>
    String(d.label || "").toLowerCase().includes(search.toLowerCase()) ||
    String(d.protocol || "").toLowerCase().includes(search.toLowerCase())
  );

  const grouped = GROUPS.reduce((acc, g) => {
    acc[g] = filtered.filter((d) => d.type === g);
    return acc;
  }, {});

  const runtimeDevices = entries.filter((d) => d.source !== "engineering");
  const onlineCount = runtimeDevices.filter((d) => d.status === "online").length;

  const handleScan = () => {
    setScanActive(true);
    addServerLog({ level: "info", msg: "Opening adapter-aware controller discovery" });
    window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "devices" } }));
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("aquaflow:open-device-tab", { detail: { tab: "controllers" } }));
      setScanActive(false);
    }, 0);
  };

  const handleAdd = () => {
    setActivePanel("geometry");
    addServerLog({ level: "info", msg: "Opened Engineering Design to add a real project fixture" });
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
          {onlineCount}/{runtimeDevices.length} live
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
        <button className="btn" style={{ padding: "4px 6px", fontSize: 10 }} onClick={handleAdd}>+ Fixture</button>
      </div>

      <div className="panel-body">
        {!entries.length && (
          <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 10, lineHeight: 1.55 }}>
            No project fixtures or verified runtime devices yet. Draw the fountain in Engineering Design, or use Scan Network to identify a controller.
          </div>
        )}
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
          PROJECT + RUNTIME STATUS
        </div>
        <div style={{ fontSize: 9, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {fixtures.length} designed fixtures · {onlineCount} verified online · {runtimeDevices.length - onlineCount} not online/verified
        </div>
      </div>
    </div>
  );
}

function DeviceRow({ device, selected, onSelect }) {
  const isDesigned = device.status === "designed";
  const statusColor = device.status === "online" ? "var(--green)" : device.status === "warn" ? "var(--amber)" : isDesigned ? "var(--accent)" : "var(--red)";
  const healthKnown = Number.isFinite(device.health);
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
          {String(device.protocol || "unmapped").toUpperCase()}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
        {device.ip && (
          <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            {device.ip}
          </span>
        )}
        {healthKnown && <div style={{ flex: 1, height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
          <div style={{ width: `${device.health}%`, height: "100%", background: healthBarColor, borderRadius: 1 }} />
        </div>}
        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
          {isDesigned ? "DESIGN" : healthKnown ? `${device.health}%` : String(device.status || "unverified").toUpperCase()}
        </span>
      </div>
      {device.detail && <div title={device.detail} style={{ marginTop: 2, fontSize: 8, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {device.detail}
      </div>}
    </div>
  );
}
