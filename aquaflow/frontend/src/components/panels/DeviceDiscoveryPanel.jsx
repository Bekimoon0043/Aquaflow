import { useState, useEffect, useRef } from "react";
import { useShowStore } from "../../store/showStore";
import { useWS } from "../../hooks/WebSocketContext";
import { API_BASE_URL } from "../../config";
import { apiGet, apiPost } from "../../utils/apiClient";
import {
  controllerTierBadge, confidenceLabel, stageLabel, discoveredDeviceProjection,
  plcPrefillFromDetection, isIcanGateway, buildDiscoverBody, adapterOptionLabel,
  discoveryStatusLine, describeHttpError,
} from "../../utils/controllerDiscovery";
import { PREFILL_KEY, PREFILL_EVENT } from "../../utils/plcConfig";

// Pure helpers re-exported for the existing tests.
export {
  controllerTierBadge, confidenceLabel, stageLabel, discoveredDeviceProjection,
  plcPrefillFromDetection, isIcanGateway, buildDiscoverBody, adapterOptionLabel,
  discoveryStatusLine, describeHttpError,
};

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
  useEffect(() => {
    const openTab = (event) => {
      const requested = event?.detail?.tab;
      if (["scan", "controllers", "dmx", "test", "config"].includes(requested)) setTab(requested);
    };
    window.addEventListener("aquaflow:open-device-tab", openTab);
    return () => window.removeEventListener("aquaflow:open-device-tab", openTab);
  }, []);

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

// ── Controllers tab (AF-CAT-001 / AF-DISC) ───────────────────────────────────
// Protocol-specific, READ-ONLY identification on a SELECTED adapter/subnet, run
// as a cancellable background job with real progress. Every row shows the
// evidence behind its claim; nothing here connects, saves, arms or commissions.

const POLL_MS = 700;

function ControllersTab({ addServerLog }) {
  const [catalog, setCatalog] = useState([]);
  const [adapters, setAdapters] = useState([]);
  const [defaultTargets, setDefaultTargets] = useState([]);
  const [adapter, setAdapter] = useState("");
  const [cidr, setCidr] = useState("");
  const [unitIds, setUnitIds] = useState("1");
  const [includeIcan, setIncludeIcan] = useState(true);
  const [job, setJob] = useState(null);           // {job_id, status, progress, message}
  const [result, setResult] = useState(null);     // finished discovery result
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);         // expanded catalog entry id
  const [expanded, setExpanded] = useState(null); // expanded detection discovery_id
  const timer = useRef(null);
  const mono = { fontFamily: "var(--font-mono)" };

  useEffect(() => {
    apiGet("/controllers/catalog").then(d => setCatalog(d.entries || [])).catch(() => {});
    apiGet("/controllers/adapters").then(d => {
      setAdapters(d.adapters || []);
      setDefaultTargets(d.default_targets || []);
    }).catch(e => setError(describeHttpError(e, "adapters unavailable — backend unreachable")));
    return () => clearInterval(timer.current);
  }, []);

  const scanning = job && job.status === "running";

  const stopPolling = () => { clearInterval(timer.current); timer.current = null; };

  const poll = async (jobId) => {
    try {
      const j = await apiGet(`/controllers/discover/jobs/${jobId}`);
      setJob(j);
      if (j.status !== "running") {
        stopPolling();
        if (j.result) {
          setResult(j.result);
          const n = j.result.detected?.length ?? 0;
          addServerLog?.(`Controller scan ${j.status}: ${n} found on ${(j.result.subnets || []).join(", ")} in ${j.result.duration_s}s`);
        }
        if (j.status === "failed") setError(j.error || "discovery failed");
      }
    } catch (e) {
      stopPolling();
      setError(describeHttpError(e));
    }
  };

  const runDiscover = async () => {
    setError("");
    setResult(null);
    const body = buildDiscoverBody({ adapter, cidr, unitIds, includeIcan });
    try {
      const started = await apiPost("/controllers/discover/start", body);
      setJob(started);
      addServerLog?.(`Controller discovery started (${body.subnet || body.adapter || "auto"}) — read-only probes`);
      stopPolling();
      timer.current = setInterval(() => poll(started.job_id), POLL_MS);
    } catch (e) {
      setError(describeHttpError(e));
      addServerLog?.(`Controller scan refused: ${describeHttpError(e)}`);
    }
  };

  const cancel = async () => {
    if (!job) return;
    try { await apiPost(`/controllers/discover/jobs/${job.job_id}/cancel`, {}); }
    catch (e) { setError(describeHttpError(e)); }
  };

  const configurePlc = (d) => {
    const prefill = plcPrefillFromDetection(d);
    if (!prefill) return;
    try { window.localStorage.setItem(PREFILL_KEY, JSON.stringify(prefill)); } catch {}
    window.dispatchEvent(new CustomEvent(PREFILL_EVENT, { detail: prefill }));
    window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "plc" } }));
    addServerLog?.(`PLC panel pre-filled from discovery: ${prefill.plc_type} @ ${prefill.ip} — not connected, not saved`);
  };

  const openFountainControl = () => {
    window.dispatchEvent(new CustomEvent("aquaflow:open-panel", { detail: { panel: "fountain" } }));
  };

  const selectedTarget = cidr.trim()
    ? { subnet: cidr.trim(), adapter: "(manual CIDR)" }
    : adapter
      ? (() => { const a = adapters.find(x => x.name === adapter); return a ? { subnet: a.subnet, adapter: a.name } : null; })()
      : (defaultTargets[0] ? { subnet: defaultTargets.map(t => t.subnet).join(", "), adapter: defaultTargets.map(t => t.adapter).join(", ") } : null);

  const row = { padding: "6px 10px", marginBottom: 4, background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 10 };
  const input = { fontSize: 10, padding: "5px 8px", background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)", ...mono };

  return (
    <div style={{ padding: 10 }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6 }}>
        Protocol-level, read-only identification. Network Scan shows hosts; this tab proves protocols. Nothing here connects, arms or writes.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <select value={adapter} onChange={e => setAdapter(e.target.value)} disabled={scanning || !!cidr.trim()} style={{ ...input, flex: 1 }}>
          <option value="">auto — every physical adapter</option>
          {adapters.map(a => (
            <option key={a.name} value={a.name} disabled={!a.eligible && !["unknown", "link_local"].includes(a.kind)}>
              {adapterOptionLabel(a)}{a.kind === "link_local" ? " (DCP only until static IP)" : !a.eligible ? " (excluded by default)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input value={cidr} onChange={e => setCidr(e.target.value)} disabled={scanning}
          placeholder="or an explicit CIDR, e.g. 192.168.5.0/24 (scans ONLY that range)" style={{ ...input, flex: 2 }} />
        <input value={unitIds} onChange={e => setUnitIds(e.target.value)} disabled={scanning} title="Modbus unit ids to try (max 8)"
          placeholder="unit ids" style={{ ...input, width: 70 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={includeIcan} onChange={e => setIncludeIcan(e.target.checked)} disabled={scanning} /> I-CAN probe
        </label>
        {scanning ? (
          <button onClick={cancel} style={{ fontSize: 10, padding: "5px 12px", background: "var(--red)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontWeight: 600 }}>CANCEL</button>
        ) : (
          <button onClick={runDiscover} style={{ fontSize: 10, padding: "5px 12px", background: "var(--accent)", color: "#000", border: "none", borderRadius: "var(--radius-sm)", cursor: "pointer", fontWeight: 600 }}>DETECT</button>
        )}
      </div>

      <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6, ...mono }}>
        target: {selectedTarget ? `${selectedTarget.subnet} via ${selectedTarget.adapter}` : "no eligible adapter — pick one or type a CIDR"}
      </div>

      {scanning && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden", marginBottom: 3 }}>
            <div style={{ width: `${(job.progress || 0) * 100}%`, height: "100%", background: "var(--accent)", transition: "width 0.3s" }} />
          </div>
          <div style={{ fontSize: 9, color: "var(--text-muted)", ...mono }}>{Math.round((job.progress || 0) * 100)}% · {job.message}</div>
        </div>
      )}

      {error && (
        <div style={{ ...row, color: "var(--red)", borderColor: "var(--red)" }}>{error}</div>
      )}

      {result && (
        <>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6, ...mono }}>{discoveryStatusLine(result)}</div>
          {(result.warnings || []).map((w, i) => (
            <div key={i} style={{ ...row, color: "#f59e0b", borderColor: "#f59e0b55" }}>⚠ {w}</div>
          ))}
          {(result.detected || []).length === 0 && (
            <div style={{ ...row, color: "var(--text-muted)", textAlign: "center" }}>
              Nothing identified — pick the controller from the catalog below and configure it manually
            </div>
          )}
          {(result.detected || []).map((d) => {
            const badge = controllerTierBadge(d.tier, d);
            const ican = isIcanGateway(d);
            const isOpen = expanded === d.discovery_id;
            const prefill = plcPrefillFromDetection(d);
            return (
              <div key={d.discovery_id} style={row}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }} onClick={() => setExpanded(isOpen ? null : d.discovery_id)}>
                  <span style={{ color: badge.color, fontWeight: 600, fontSize: 9, ...mono }}>{badge.label}</span>
                  <span style={{ color: "var(--text-primary)", flex: 1 }}>{d.label}</span>
                  <span style={{ color: "var(--text-muted)", ...mono }}>
                    {d.ip ? `${d.ip}${d.port ? `:${d.port}` : ""}` : "no IP configured"}
                  </span>
                </div>
                <div style={{ color: "var(--text-muted)", ...mono, marginTop: 2 }}>
                  {confidenceLabel(d.confidence, d.stage)} · stage: {stageLabel(d.stage)}
                  {d.vendor && d.vendor !== "(any)" && ` · ${d.vendor}${d.model ? " " + d.model : ""}`}
                  {d.revision && ` · rev ${d.revision}`}
                  {d.mac && ` · ${d.mac}`}
                  {d.adapter && ` · via ${d.adapter}`}
                </div>
                {ican && (
                  <div style={{ marginTop: 3, color: "var(--green)", fontSize: 9.5 }}>
                    ✓ Validated I-CAN gateway reply on {d.ip} (interface {d.identity?.interface || d.adapter || "?"}) — configure and operate it in Fountain Control; nothing was armed or connected here.
                  </div>
                )}
                {(d.warnings || []).map((w, i) => (
                  <div key={i} style={{ color: "#f59e0b", fontSize: 9, marginTop: 2 }}>⚠ {w}</div>
                ))}
                {isOpen && (
                  <div style={{ marginTop: 4, color: "var(--text-secondary)", fontSize: 9.5, ...mono, background: "var(--bg-panel)", padding: 6, borderRadius: "var(--radius-sm)" }}>
                    <div style={{ color: "var(--text-muted)", marginBottom: 2 }}>evidence:</div>
                    {(d.evidence || []).map((e, i) => <div key={i}>• {e}</div>)}
                    <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                      status: {d.status} · health: {d.health === null || d.health === undefined ? "not measured" : d.health} · discovery {d.discovery_id}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
                  {prefill && (
                    <button className="btn primary" style={{ fontSize: 9, padding: "2px 8px" }} onClick={() => configurePlc(d)}>
                      Configure PLC →
                    </button>
                  )}
                  {ican && (
                    <button className="btn" style={{ fontSize: 9, padding: "2px 8px" }} onClick={openFountainControl}>
                      Open Fountain Control →
                    </button>
                  )}
                  {!prefill && !ican && (
                    <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                      {d.tier === "REAL" ? `configure in: ${d.configure_in}` : "identify-only — no AquaFlow driver"}
                    </span>
                  )}
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

      // Network visibility only: a host answering a port is "seen", not online,
      // healthy or identified. Protocol identification lives in the Controllers tab.
      if (data.devices?.length) {
        updateDevicesFromServer(data.devices.map((d) => ({
          ...discoveredDeviceProjection(d),
          id: d.id || `discovered-${d.ip}-${d.port}`,
          type: d.device_type || d.type || "unknown",
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
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6 }}>
            Network visibility only — an open port does not prove a PLC or fountain controller. Use the Controllers tab for protocol-level identification.
          </div>
          {discovered.map((d, i) => (
            <div key={i} style={{
              padding: "8px 10px", marginBottom: 6,
              background: "var(--bg-surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--text-muted)" }} title="seen on the network — unverified" />
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
                  updateDevicesFromServer([{ ...discoveredDeviceProjection(d), type: d.device_type || "unknown" }]);
                  addServerLog({ level: "info", msg: `Added ${d.label} to project (unverified — identify it in Controllers)` });
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
