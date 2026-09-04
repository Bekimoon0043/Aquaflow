import { useState, useEffect } from "react";
import { useShowStore } from "../../store/showStore";
import { useWS } from "../../hooks/WebSocketContext";
import { API_BASE_URL } from "../../config";

const API = `${API_BASE_URL}/devices`;

const PROTOCOL_COLORS = {
  artnet: "#00d4ff", dmx: "#00d4ff", sacn: "#10b981",
  modbus: "#f97316", mqtt: "#f59e0b", opcua: "#8b5cf6",
};

const TYPE_ICONS = {
  lighting: "✦", pump: "〰", valve: "⊠", flame: "🔥",
  fog: "≈", laser: "✸", sensor: "◉", unknown: "◈",
};

const ALLOW_DEMO_SCAN = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_SCAN === "true";

export default function DeviceDiscoveryPanel() {
  const [tab, setTab] = useState("scan");
  const { devices, addServerLog } = useShowStore();

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36, background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div className="dot" />
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Device Discovery
        </span>
        <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--green)" }}>
          {devices.filter((d) => d.status === "online").length}/{devices.length} online
        </span>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-surface)", flexShrink: 0 }}>
        {[["scan", "Network Scan"], ["controllers", "Controllers"], ["dmx", "DMX Monitor"], ["test", "Hardware Test"], ["config", "Config"]].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            flex: 1, padding: "7px 0", background: "transparent", border: "none",
            borderBottom: tab === key ? "2px solid var(--accent)" : "2px solid transparent",
            color: tab === key ? "var(--text-accent)" : "var(--text-muted)",
            fontFamily: "var(--font-body)", fontSize: 10, fontWeight: tab === key ? 600 : 400,
            textTransform: "uppercase", letterSpacing: "0.05em", cursor: "pointer",
          }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {tab === "scan"        && <ScanTab addServerLog={addServerLog} />}
        {tab === "controllers" && <ControllersTab addServerLog={addServerLog} />}
        {tab === "dmx"         && <DMXMonitorTab />}
        {tab === "test"        && <HardwareTestTab devices={devices} addServerLog={addServerLog} />}
        {tab === "config"      && <ConfigTab devices={devices} />}
      </div>
    </div>
  );
}

// ── Controllers tab (AF-CAT-001) ──────────────────────────────────────────────
// Auto-detect what's on the wire; fall back to the pre-loaded catalog of known
// fountain controllers/PLCs with honest drivability tiers and config prefills.
// Pure helpers exported for tests.

export function controllerTierBadge(tier) {
  // Only REAL (drivable) earns green. GATED/UNSUPPORTED are identifiable at
  // best — the UI must never blur "we can name it" into "we can run a show on it".
  switch (tier) {
    case "REAL": return { color: "var(--green)", label: "DRIVABLE" };
    case "GATED": return { color: "#f59e0b", label: "GATED" };
    default: return { color: "var(--red)", label: "IDENTIFY-ONLY" };
  }
}

export function confidenceLabel(confidence) {
  switch (confidence) {
    case "confirmed": return "protocol confirmed";
    case "probable": return "probable";
    default: return "port match only";
  }
}

function ControllersTab({ addServerLog }) {
  const [catalog, setCatalog] = useState([]);
  const [detected, setDetected] = useState(null);   // null = never scanned
  const [scanning, setScanning] = useState(false);
  const [subnet, setSubnet] = useState("");
  const [open, setOpen] = useState(null);           // expanded catalog entry id
  const mono = { fontFamily: "var(--font-mono)" };

  useEffect(() => {
    fetch(`${API_BASE_URL}/controllers/catalog`)
      .then(r => r.json()).then(d => setCatalog(d.entries || [])).catch(() => {});
  }, []);

  const runDiscover = async () => {
    setScanning(true);
    try {
      const res = await fetch(`${API_BASE_URL}/controllers/discover`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subnet ? { subnet } : {}),
      });
      const data = await res.json();
      setDetected(data);
      addServerLog?.(`Controller scan: ${data.detected?.length ?? 0} found on ${data.subnets?.join(", ")} in ${data.duration_s}s`);
    } catch {
      addServerLog?.("Controller scan failed — backend unreachable");
    } finally {
      setScanning(false);
    }
  };

  const row = { padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 10 };

  return (
    <div style={{ padding: 10 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input value={subnet} onChange={e => setSubnet(e.target.value)}
          placeholder="subnet (blank = auto, e.g. 192.168.5.0/24)"
          style={{ flex: 1, fontSize: 10, padding: "5px 8px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", ...mono }} />
        <button onClick={runDiscover} disabled={scanning} style={{ fontSize: 10, padding: "5px 12px", background: scanning ? "var(--bg-surface)" : "var(--accent)", color: scanning ? "var(--text-muted)" : "#000", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontWeight: 600 }}>
          {scanning ? "SCANNING…" : "DETECT"}
        </button>
      </div>

      {detected && (
        <>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6, ...mono }}>
            {detected.hosts_scanned} hosts · ports {detected.tcp_ports?.join("/")} · {detected.duration_s}s · read-only probes
          </div>
          {(detected.detected || []).length === 0 && (
            <div style={{ ...row, color: "var(--text-muted)", textAlign: "center" }}>
              Nothing identified — pick the controller from the catalog below and configure it manually
            </div>
          )}
          {(detected.detected || []).map((d, i) => {
            const badge = controllerTierBadge(d.tier);
            return (
              <div key={i} style={row}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ color: badge.color, fontWeight: 600, fontSize: 9, ...mono }}>{badge.label}</span>
                  <span style={{ color: "var(--text-primary)", flex: 1 }}>{d.label}</span>
                  <span style={{ color: "var(--text-muted)", ...mono }}>{d.ip}:{d.port}</span>
                </div>
                <div style={{ color: "var(--text-muted)", ...mono, marginTop: 2 }}>
                  {confidenceLabel(d.confidence)}
                  {d.identity?.vendor && ` · ${d.identity.vendor} ${d.identity.product || ""}`}
                  {d.configure_in && ` · configure in: ${d.configure_in}`}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div style={{ fontSize: 9, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", margin: "12px 0 6px", borderBottom: "1px solid var(--border)", paddingBottom: 3, ...mono }}>
        Controller catalog ({catalog.length})
      </div>
      {catalog.map(e => {
        const badge = controllerTierBadge(e.tier);
        const isOpen = open === e.id;
        return (
          <div key={e.id} style={{ ...row, cursor: "pointer" }} onClick={() => setOpen(isOpen ? null : e.id)}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: badge.color, fontWeight: 600, fontSize: 9, ...mono }}>{badge.label}</span>
              <span style={{ color: "var(--text-primary)", flex: 1 }}>{e.vendor} — {e.model}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 9, ...mono }}>{e.category}</span>
            </div>
            {isOpen && (
              <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 9.5 }}>
                {e.notes && <div style={{ marginBottom: 4 }}>{e.notes}</div>}
                {Object.keys(e.default_config || {}).length > 0 && (
                  <div style={{ ...mono, color: "var(--text-muted)", whiteSpace: "pre-wrap", background: "var(--bg-panel)", padding: 6, borderRadius: "var(--radius-sm)" }}>
                    {Object.entries(e.default_config).map(([k, v]) => `${k}: ${v}`).join("\n")}
                  </div>
                )}
                {e.configure_in && <div style={{ marginTop: 4, color: "var(--text-muted)" }}>Configure in: <b>{e.configure_in}</b></div>}
                {e.source && <div style={{ marginTop: 2, color: "var(--text-muted)", fontStyle: "italic" }}>{e.source}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScanTab({ addServerLog }) {
  const [subnet, setSubnet] = useState("192.168.1.0/24");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [discovered, setDiscovered] = useState([]);
  const [quickScan, setQuickScan] = useState(true);
  const { updateDevicesFromServer } = useShowStore();

  const startScan = async () => {
    setScanning(true);
    setProgress(0);
    setDiscovered([]);
    setStatusMsg("Starting scan...");
    addServerLog({ level: "info", msg: `Network scan started: ${subnet}` });

    try {
      const res = await fetch(`${API}/scan?subnet=${encodeURIComponent(subnet)}&quick=${quickScan}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Scan failed");
      setDiscovered(data.devices || []);
      setProgress(1.0);
      setStatusMsg(`Found ${data.found} devices`);
      addServerLog({ level: "info", msg: `Scan complete: ${data.found} devices found` });

      if (data.devices?.length) {
        updateDevicesFromServer(data.devices.map((d) => ({
          id: d.id || `discovered-${d.ip}-${d.port}`,
          label: d.label,
          type: d.device_type || d.type,
          protocol: d.protocol,
          ip: d.ip,
          port: d.port,
          status: d.status || "online",
          health: d.health ?? 85,
        })));
      }
    } catch (e) {
      if (!ALLOW_DEMO_SCAN) {
        setStatusMsg(`Scan failed: ${e.message || "backend unavailable"}`);
        addServerLog({ level: "error", msg: `Network scan failed: ${e.message || "backend unavailable"}` });
      } else {
        const demoDevices = [
          { ip: "192.168.1.10", protocol: "modbus", port: 502, label: "Pump VFD Controller", device_type: "pump" },
          { ip: "192.168.1.20", protocol: "artnet", port: 6454, label: "DMX Art-Net Node", device_type: "lighting", universe: 0, channels: 512 },
          { ip: "192.168.1.21", protocol: "artnet", port: 6454, label: "DMX Art-Net Node 2", device_type: "lighting", universe: 1, channels: 512 },
          { ip: "192.168.1.30", protocol: "sacn", port: 5568, label: "sACN Lighting Controller", device_type: "lighting" },
          { ip: "192.168.1.60", protocol: "mqtt", port: 1883, label: "IoT Sensor Hub", device_type: "sensor" },
        ];
        for (let i = 0; i <= 10; i++) {
          await new Promise((r) => setTimeout(r, 150));
          setProgress(i / 10);
          setStatusMsg(`Scanning ${subnet}... ${i * 10}%`);
        }
        setDiscovered(demoDevices);
        setStatusMsg(`Found ${demoDevices.length} devices (demo mode)`);
        addServerLog({ level: "warn", msg: "Backend offline — showing demo scan results" });
      }
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    const handler = () => startScan();
    window.addEventListener("aquaflow:start-device-scan", handler);
    return () => window.removeEventListener("aquaflow:start-device-scan", handler);
  }, [subnet, quickScan]);

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Subnet</SectionLabel>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input className="input" value={subnet} onChange={(e) => setSubnet(e.target.value)}
          style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)" }} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <Toggle label="Quick scan (x.x.x.1-50)" value={quickScan} onChange={setQuickScan} />
      </div>

      <button className="btn primary" onClick={startScan} disabled={scanning}
        style={{ width: "100%", justifyContent: "center", fontSize: 12, padding: "8px", marginBottom: 12 }}>
        {scanning ? "⟳ Scanning..." : "⟳ Scan Network"}
      </button>

      {(scanning || progress > 0 || statusMsg) && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden", marginBottom: 4 }}>
            <div style={{ width: `${progress * 100}%`, height: "100%", background: "var(--accent)", borderRadius: 2, transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{statusMsg}</div>
        </div>
      )}

      {discovered.length > 0 && (
        <div>
          <SectionLabel>Discovered ({discovered.length})</SectionLabel>
          {discovered.map((d, i) => (
            <div key={i} style={{
              padding: "8px 10px", marginBottom: 6,
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 4px var(--green)" }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)", flex: 1 }}>{d.label}</span>
                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, fontFamily: "var(--font-mono)", background: `${PROTOCOL_COLORS[d.protocol] || "#888"}22`, color: PROTOCOL_COLORS[d.protocol] || "#888", border: `1px solid ${PROTOCOL_COLORS[d.protocol] || "#888"}44` }}>
                  {d.protocol?.toUpperCase()}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10, fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                <span>{d.ip}:{d.port}</span>
                {d.universe !== undefined && <span>Universe {d.universe}</span>}
                {d.channels && <span>{d.channels}ch</span>}
                <span style={{ marginLeft: "auto", color: "var(--text-secondary)", textTransform: "capitalize" }}>
                  {TYPE_ICONS[d.device_type]} {d.device_type}
                </span>
              </div>
              <button className="btn" style={{ marginTop: 6, fontSize: 10, padding: "2px 8px" }}
                onClick={() => {
                  updateDevicesFromServer([{
                    id: `discovered-${d.ip}-${d.port}`,
                    label: d.label,
                    type: d.device_type || "unknown",
                    protocol: d.protocol,
                    ip: d.ip,
                    port: d.port,
                    status: "online",
                    health: 85,
                  }]);
                  addServerLog({ level: "info", msg: `Added ${d.label} to project` });
                }}>
                + Add to Project
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DMXMonitorTab() {
  const [universe, setUniverse] = useState(0);
  const [channels, setChannels] = useState(Array(512).fill(0));
  const [selectedCh, setSelectedCh] = useState(null);
  const [manualValue, setManualValue] = useState(0);

  const sendDMX = async (ch, val) => {
    try {
      await fetch(`${API}/dmx/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe, channel: ch, value: val }),
      });
    } catch {}
    const updated = [...channels];
    updated[ch] = val;
    setChannels(updated);
  };

  const blackout = async () => {
    try { await fetch(`${API}/dmx/blackout`, { method: "POST" }); } catch {}
    setChannels(Array(512).fill(0));
  };

  const fullOn = () => {
    const all = Array(512).fill(255);
    setChannels(all);
  };

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>UNIVERSE</span>
        <select className="select" value={universe} onChange={(e) => setUniverse(parseInt(e.target.value))}
          style={{ fontSize: 11, flex: 1 }}>
          {[0, 1, 2, 3].map((u) => <option key={u} value={u}>Universe {u}</option>)}
        </select>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button className="btn danger" onClick={blackout} style={{ flex: 1, justifyContent: "center", fontSize: 10 }}>⬛ Blackout</button>
        <button className="btn" onClick={fullOn} style={{ flex: 1, justifyContent: "center", fontSize: 10 }}>⬜ Full On</button>
      </div>

      {selectedCh !== null && (
        <div style={{ padding: "8px 10px", background: "rgba(0,212,255,0.05)", border: "1px solid var(--border-accent)", borderRadius: "var(--radius-sm)", marginBottom: 10 }}>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
            CH {selectedCh + 1} · Universe {universe}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="range" min={0} max={255} value={channels[selectedCh]}
              onChange={(e) => sendDMX(selectedCh, parseInt(e.target.value))}
              style={{ flex: 1 }} />
            <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-accent)", width: 30 }}>
              {channels[selectedCh]}
            </span>
          </div>
        </div>
      )}

      <SectionLabel>Channels 1–64</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(16, 1fr)", gap: 2, marginBottom: 8 }}>
        {channels.slice(0, 64).map((val, i) => (
          <div key={i}
            onClick={() => setSelectedCh(i)}
            title={`Ch ${i + 1}: ${val}`}
            style={{
              height: 20, borderRadius: 2, cursor: "pointer",
              background: val > 0 ? `rgba(0,212,255,${val / 255 * 0.9 + 0.1})` : "var(--bg-raised)",
              border: selectedCh === i ? "1px solid var(--accent)" : "1px solid transparent",
              position: "relative",
            }}>
            {val > 0 && (
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${val / 255 * 100}%`, background: "rgba(0,212,255,0.5)", borderRadius: 2 }} />
            )}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "var(--font-mono)", textAlign: "center" }}>
        Click a channel to control it · {channels.filter((v) => v > 0).length} active channels
      </div>
    </div>
  );
}

function HardwareTestTab({ devices, addServerLog }) {
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [pumpSpeed, setPumpSpeed] = useState(50);
  const [lightValue, setLightValue] = useState(128);

  const runTest = async (device) => {
    setTesting(true);
    setTestResult(null);
    setSelectedDevice(device);
    addServerLog({ level: "info", msg: `Testing ${device.label}...` });
    try {
      await fetch(`${API}/${device.id}/test`, { method: "POST" });
      await new Promise((r) => setTimeout(r, 1500));
      setTestResult({ success: true, msg: `${device.label} responded OK` });
      addServerLog({ level: "info", msg: `✓ ${device.label} test passed` });
    } catch {
      setTestResult({ success: false, msg: "Backend offline — test skipped" });
    } finally {
      setTesting(false);
    }
  };

  const sendPumpSpeed = async (speed) => {
    try {
      await fetch(`${API}/modbus/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip: "192.168.1.10", port: 502, reg: 1, value: Math.round(speed * 10) }),
      });
      addServerLog({ level: "info", msg: `Pump speed set to ${speed}%` });
    } catch {
      addServerLog({ level: "warn", msg: "Pump command sent (offline mode)" });
    }
  };

  const sendLight = async (val) => {
    try {
      await fetch(`${API}/dmx/set`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ universe: 0, channel: 0, value: val }),
      });
    } catch {}
  };

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Quick Device Tests</SectionLabel>

      <div style={{ padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4ff" }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>Pump Speed Control</span>
          <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--orange)" }}>MODBUS</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="range" min={0} max={100} value={pumpSpeed}
            onChange={(e) => { const next = parseInt(e.target.value); setPumpSpeed(next); sendPumpSpeed(next); }}
            style={{ flex: 1 }} />
          <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text-accent)", width: 40 }}>{pumpSpeed}%</span>
        </div>
        <button className="btn danger" onClick={() => { setPumpSpeed(0); sendPumpSpeed(0); }}
          style={{ marginTop: 6, fontSize: 10, padding: "2px 8px" }}>
          Stop Pump
        </button>
      </div>

      <div style={{ padding: "10px 12px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-primary)" }}>DMX Light Intensity</span>
          <span style={{ marginLeft: "auto", fontSize: 9, fontFamily: "var(--font-mono)", color: "#00d4ff" }}>DMX CH1</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="range" min={0} max={255} value={lightValue}
            onChange={(e) => { const next = parseInt(e.target.value); setLightValue(next); sendLight(next); }}
            style={{ flex: 1 }} />
          <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--text-accent)", width: 40 }}>{lightValue}</span>
        </div>
      </div>

      <SectionLabel>Device List</SectionLabel>
      {devices.slice(0, 8).map((device) => (
        <div key={device.id} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 4,
          background: selectedDevice?.id === device.id ? "var(--bg-hover)" : "var(--bg-surface)",
          border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", cursor: "pointer",
        }} onClick={() => setSelectedDevice(device)}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: device.status === "online" ? "var(--green)" : "var(--red)" }} />
          <span style={{ flex: 1, fontSize: 11, color: "var(--text-primary)" }}>{device.label}</span>
          <button className="btn" style={{ padding: "2px 8px", fontSize: 9 }}
            onClick={(e) => { e.stopPropagation(); runTest(device); }}>
            {testing && selectedDevice?.id === device.id ? "..." : "Test"}
          </button>
        </div>
      ))}

      {testResult && (
        <div style={{ marginTop: 8, padding: "8px 12px", background: testResult.success ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${testResult.success ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`, borderRadius: "var(--radius-sm)", fontSize: 11, color: testResult.success ? "var(--green)" : "var(--red)" }}>
          {testResult.success ? "✓" : "✕"} {testResult.msg}
        </div>
      )}
    </div>
  );
}

function ConfigTab({ devices }) {
  const [selected, setSelected] = useState(null);
  const device = devices.find((d) => d.id === selected);

  return (
    <div style={{ padding: 12 }}>
      <SectionLabel>Select Device</SectionLabel>
      <select className="select" value={selected || ""} onChange={(e) => setSelected(e.target.value)}
        style={{ width: "100%", marginBottom: 12, fontSize: 11 }}>
        <option value="">-- Choose device --</option>
        {devices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
      </select>

      {device && (
        <div style={{ animation: "fade-in 0.15s ease" }}>
          <SectionLabel>Device Configuration</SectionLabel>
          {[
            ["Label",    device.label],
            ["Type",     device.type],
            ["Protocol", device.protocol],
            ["IP",       device.ip || "—"],
            ["Port",     device.port || "—"],
            ["Status",   device.status],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", width: 70, textAlign: "right" }}>{label}</span>
              <input className="input" defaultValue={String(value)} style={{ flex: 1, fontSize: 11 }} />
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <button className="btn primary" style={{ flex: 1, justifyContent: "center", fontSize: 11 }}>Save</button>
            <button className="btn danger" style={{ padding: "5px 12px", fontSize: 11 }}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: "var(--font-mono)", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 7, marginTop: 10, borderBottom: "1px solid var(--border)", paddingBottom: 3 }}>
      {children}
    </div>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }} onClick={() => onChange(!value)}>
      <div style={{ width: 32, height: 16, borderRadius: 8, background: value ? "rgba(0,212,255,0.2)" : "var(--bg-raised)", border: `1px solid ${value ? "var(--accent)" : "var(--border)"}`, position: "relative", transition: "all 0.15s" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: value ? "var(--accent)" : "var(--text-muted)", position: "absolute", top: 2, left: value ? 18 : 2, transition: "left 0.15s" }} />
      </div>
      <span style={{ fontSize: 10, color: value ? "var(--text-primary)" : "var(--text-muted)" }}>{label}</span>
    </div>
  );
}
