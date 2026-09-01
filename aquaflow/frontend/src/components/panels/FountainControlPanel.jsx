/**
 * FountainControlPanel.jsx — AF-ICAN-004
 *
 * The operator surface for running a real fountain through the I-CAN / NETCAN relay
 * gateway. Until this existed the entire control path was API-only: the backend could
 * discover, connect, attach and arm, but nothing in the app could reach any of it, so
 * "install the build and test the fountain" was impossible without hand-written HTTP.
 *
 * The panel deliberately mirrors the backend's gating rather than hiding it. Connecting
 * does not attach; attaching does not arm; arming needs a typed confirmation. Each step
 * unlocks only the next one, because the frame semantics are capture-derived and a wrong
 * channel could actuate real equipment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../../utils/apiClient";

const MONO = "monospace";
const C = {
  line: "#0a2030", dim: "#334455", text: "#8ea4b8", bright: "#cfe0f0",
  accent: "#00aaff", ok: "#37d67a", warn: "#ffb020", danger: "#ff5c6c", panel: "#030812",
};

const btn = (active, color = C.accent, disabled = false) => ({
  padding: "5px 10px", fontSize: 11, borderRadius: 3, fontFamily: MONO,
  cursor: disabled ? "not-allowed" : "pointer",
  background: active ? `${color}22` : "transparent",
  color: disabled ? C.dim : (active ? color : C.text),
  border: `1px solid ${disabled ? C.line : (active ? `${color}66` : C.line)}`,
  opacity: disabled ? 0.5 : 1,
});

const label = {
  color: C.dim, fontSize: 9, letterSpacing: "0.06em",
  textTransform: "uppercase", margin: "0 0 6px", fontFamily: MONO,
};

const input = {
  background: "#010409", border: `1px solid ${C.line}`, borderRadius: 3,
  color: C.bright, fontSize: 11, fontFamily: MONO, padding: "4px 6px", outline: "none",
};

function Step({ n, title, done, children }) {
  return (
    <div style={{ marginBottom: 14, paddingLeft: 10, borderLeft: `2px solid ${done ? C.ok : C.line}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <span style={{
          width: 16, height: 16, borderRadius: "50%", fontSize: 9, fontFamily: MONO,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: done ? `${C.ok}22` : "transparent",
          border: `1px solid ${done ? C.ok : C.line}`, color: done ? C.ok : C.dim,
        }}>{done ? "✓" : n}</span>
        <span style={{ color: done ? C.ok : C.bright, fontSize: 11, fontFamily: MONO }}>{title}</span>
      </div>
      <div style={{ paddingLeft: 22 }}>{children}</div>
    </div>
  );
}

export default function FountainControlPanel() {
  const [status, setStatus] = useState(null);
  const [safety, setSafety] = useState(null);
  const [gateways, setGateways] = useState([]);
  const [scanInfo, setScanInfo] = useState(null);
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState([]);
  const [channels, setChannels] = useState([]);
  const [attached, setAttached] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [liveChannels, setLiveChannels] = useState(new Set());
  const [seqRunning, setSeqRunning] = useState(false);

  const [manualIp, setManualIp] = useState("192.168.5.2");
  const [gwPort, setGwPort] = useState(200);
  const [localPort, setLocalPort] = useState(2002);
  const [newCh, setNewCh] = useState({ group: 0, channel: 1, label: "Jet 1", device_type: "pump" });

  const abortSeq = useRef(false);

  const say = useCallback((msg, kind = "info") => {
    setLog(l => [{ t: new Date().toLocaleTimeString(), msg, kind }, ...l].slice(0, 60));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, m, k] = await Promise.all([
        apiGet("/ican/status"),
        apiGet("/ican/map/registry").catch(() => ({ devices: [] })),
        apiGet("/safety/status").catch(() => null),
      ]);
      setStatus(s);
      setChannels(m.devices || []);
      setSafety(k);
    } catch (e) {
      setStatus(null);
      say(`status unavailable — ${e.message}`, "err");
    }
  }, [say]);

  useEffect(() => { refresh(); }, [refresh]);
  // Poll while connected so a dropped gateway is visible rather than assumed.
  useEffect(() => {
    if (!status?.state || status.state === "idle") return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [status?.state, refresh]);

  const run = useCallback(async (name, fn, okMsg) => {
    setBusy(name);
    try {
      const r = await fn();
      if (okMsg) say(typeof okMsg === "function" ? okMsg(r) : okMsg, "ok");
      await refresh();
      return r;
    } catch (e) {
      say(`${name} failed — ${e.message}`, "err");
      return null;
    } finally { setBusy(""); }
  }, [refresh, say]);

  const connected = status?.state === "connected";
  // The gateway answered the read-only 0x03 poll. Control does NOT depend on this —
  // I-CAN output is fire-and-forget and the gateway never acks 0x08 — but "connected"
  // on its own must not be read as "the cabinet is there".
  const verified = !!status?.verified;
  const armed = !!status?.output_enabled;
  const hasChannels = channels.length > 0;
  // The third gate, and the one with no other home in this panel. Without the safety
  // kernel's master permit the output gate zeroes every command, so the operator sees
  // a fully 'armed' panel and a fountain that does nothing.
  const permit = !!safety?.permit;

  // ── actions ───────────────────────────────────────────────────────────────
  const doDiscover = () => run("discover", async () => {
    const r = await apiPost("/ican/discover", { include_virtual: false, timeout: 0.6 });
    // `candidates` is EVERY host probed, not every host that answered — reporting its
    // length as "gateway candidates" made a scan of the wrong subnet look like a
    // success. Only ever surface hosts that actually replied.
    const all = r.candidates || [];
    const replied = all.filter(c => c && !/no reply|timeout/i.test(String(c.verdict || c.reason || c.status || "")));
    setGateways(replied);
    setScanInfo({
      scanned: r.scanned ?? all.length,
      subnets: (r.interfaces || []).map(i => `${i.ip}/${i.prefix}`),
      found: !!r.found,
    });
    if (r.found && r.gateway) {
      say(`gateway found at ${r.gateway.ip || r.gateway.address}`, "ok");
    } else {
      const nets = (r.interfaces || []).map(i => `${i.ip}/${i.prefix}`).join(", ") || "no interfaces";
      say(`no gateway answered — scanned ${r.scanned ?? all.length} host(s) on ${nets}`, "warn");
    }
    return r;
  });

  const doConnect = (ip) => run("connect", () => apiPost("/ican/connect", {
    gateway_ip: ip || manualIp, gateway_port: Number(gwPort), local_port: Number(localPort),
  }), `connected to ${ip || manualIp}:${gwPort}`);

  const doDisconnect = () => run("disconnect", () => apiPost("/ican/disconnect", {}), "disconnected");

  const doAssign = () => run("assign", () => apiPost("/ican/map/assign", {
    group: Number(newCh.group), channel: Number(newCh.channel),
    label: newCh.label, device_type: newCh.device_type,
  }), `mapped group ${newCh.group} channel ${newCh.channel} → ${newCh.label}`);

  /**
   * Build the whole map from a capture of the ORIGINAL fountain software. Every
   * (group, channel) that capture drove is wired to something — which is the one thing
   * typing a channel number by hand cannot tell you, and guessing it wrong looks
   * identical to a broken control path: every step green, nothing moves.
   */
  const doImportCapture = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => say(`could not read ${file.name}`, "err");
    reader.onload = () => run("import", async () => {
      const r = await apiPost("/ican/map/import-capture", {
        text: String(reader.result || ""), device_type: newCh.device_type,
      });
      say(`imported ${r.imported} channel(s) from ${file.name} — `
          + `group(s) ${r.groups.join(", ")}, ${r.channels_seen} channel(s) seen`, "ok");
      return r;
    });
    reader.readAsText(file);
  };

  const doAttach = () => run("attach", async () => {
    const r = await apiPost("/ican/output/attach", {});
    setAttached(r);
    return r;
  }, r => `attached ${r.channels_routed} channel(s) to the output bus — still DISARMED`);

  const doArmSafety = () => run("arm safety", () => apiPost("/safety/arm", {}),
    "safety system ARMED — master permit granted");

  const doArm = () => run("arm", () => apiPost("/ican/output/arm", {
    enabled: true, confirm: confirmText,
  }), "OUTPUT ARMED — relays can now be driven");

  const doDisarm = () => run("disarm", async () => {
    abortSeq.current = true;
    const r = await apiPost("/ican/output/arm", { enabled: false });
    setLiveChannels(new Set());
    setSeqRunning(false);
    return r;
  }, "output disarmed and blacked out");

  /**
   * Drive one channel. Goes through the runtime device id the channel map assigns
   * (ican-<group>-<channel>) so this exercises the same routing a show uses, rather
   * than a private test path that could pass while playback stays broken.
   */
  const setChannel = useCallback(async (dev, on) => {
    const id = dev.device_id;
    try {
      const r = await apiPost("/ican/output/channel", { device_id: id, on });
      // Trust the bus's reported state, not the request. If the frame was refused —
      // not armed, no safety permit — the channel is absent from live_channels and the
      // button must not light up as though it worked.
      const live = new Set((r.live_channels || []).map(c => `ican-${r.group}-${c}`));
      setLiveChannels(prev => {
        const n = new Set([...prev].filter(x => !x.startsWith(`ican-${r.group}-`)));
        live.forEach(x => n.add(x));
        return n;
      });
      const confirmed = live.has(id);
      // Show the bytes. When a command does nothing at the cabinet, the first question
      // is "what did you actually send", and the operator should be able to read the
      // answer off this screen and compare it to ican_client.py.
      const wire = r.frame_hex ? `  [${r.frame_hex}]` : "";
      if (on && !confirmed) {
        say(`${dev.label || id} ON was NOT accepted — ${r.frame_result || "output refused it"}${wire}`, "warn");
      } else {
        say(`${dev.label || id} → ${on ? "ON" : "OFF"}${wire}`, on ? "ok" : "info");
      }
      return confirmed === on;
    } catch (e) {
      say(`${id} ${on ? "ON" : "OFF"} failed — ${e.message}`, "err");
      return false;
    }
  }, [say]);

  const stopAll = () => run("stop", async () => {
    abortSeq.current = true;
    setSeqRunning(false);
    const r = await apiPost("/ican/output/stop", {});
    setLiveChannels(new Set());
    return r;
  }, "STOP — all channels off");

  /** The simplest deterministic proof: each mapped channel on, then off, in order. */
  const runSequence = async () => {
    abortSeq.current = false;
    setSeqRunning(true);
    say(`sequence start — ${channels.length} channel(s), 1.2s each`, "ok");
    for (const dev of channels) {
      if (abortSeq.current) break;
      await setChannel(dev, true);
      await new Promise(r => setTimeout(r, 1200));
      if (abortSeq.current) { await setChannel(dev, false); break; }
      await setChannel(dev, false);
      await new Promise(r => setTimeout(r, 400));
    }
    setSeqRunning(false);
    say(abortSeq.current ? "sequence aborted" : "sequence complete", abortSeq.current ? "warn" : "ok");
  };

  const stateColor = connected ? C.ok : (status?.state === "error" ? C.danger : C.dim);

  return (
    <div style={{ height: "100%", overflowY: "auto", background: C.panel, padding: 14, fontFamily: MONO }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <span style={{ color: C.bright, fontSize: 14 }}>Fountain Control — I-CAN Gateway</span>
        <span style={{ color: stateColor, fontSize: 11 }}>● {status?.state || "unknown"}</span>
        {connected && (
          <span style={{ color: verified ? C.ok : C.warn, fontSize: 10 }}>
            {verified ? "gateway replied" : "unverified"}
          </span>
        )}
        {armed && <span style={{ color: C.danger, fontSize: 11, fontWeight: 700 }}>OUTPUT ARMED</span>}
        {armed && (
          // Visible proof the output stream is running. A count stuck at 0 while armed
          // means the state is not being re-sent, and a controller with an output
          // watchdog would drop its relays.
          <span style={{ color: status?.streaming ? C.ok : C.danger, fontSize: 10 }}>
            {status?.streaming
              ? `streaming ${status.refresh_hz}Hz · ${status.frames_streamed} frames`
              : "NOT STREAMING"}
          </span>
        )}
      </div>
      <div style={{ color: C.dim, fontSize: 10, marginBottom: 14, lineHeight: 1.5 }}>
        Each step unlocks the next. Connecting does not arm the output, and neither does
        attaching — arming is deliberate and separate.
      </div>

      {connected && !verified && (
        <div style={{
          marginBottom: 10, padding: "7px 10px", borderRadius: 4,
          background: `${C.warn}14`, border: `1px solid ${C.warn}55`, color: C.text, fontSize: 10, lineHeight: 1.5,
        }}>
          <b style={{ color: C.warn }}>Link unverified.</b> The gateway did not answer the
          read-only poll. Commands are still sent — I-CAN output is fire-and-forget and the
          gateway does not acknowledge output frames, so this is normal on some cabinets.
          But if nothing moves, check the IP and that this PC is on the gateway's subnet.
        </div>
      )}

      {status?.local_port_fallback && (
        <div style={{
          marginBottom: 10, padding: "7px 10px", borderRadius: 4,
          background: `${C.danger}14`, border: `1px solid ${C.danger}55`, color: C.text, fontSize: 10, lineHeight: 1.5,
        }}>
          <b style={{ color: C.danger }}>Local port {status.local_port} — not 2002.</b> Port
          2002 was busy, most likely because the original I-CAN software is still running.
          The gateway expects commands from 2002 and may ignore ours. Close that software
          and reconnect.
        </div>
      )}

      {armed && (
        <div style={{
          marginBottom: 14, padding: "8px 10px", borderRadius: 4,
          background: `${C.danger}18`, border: `1px solid ${C.danger}66`, color: C.bright, fontSize: 11,
        }}>
          Output is ARMED — commands below drive real relays. The current state is now
          re-sent continuously, the way the original fountain software streams it, so a
          controller with an output watchdog keeps holding its relays. A lit button means
          the frame is being sent, not that the relay closed: the gateway does not
          acknowledge output. Keep the water off until a single known channel has been
          confirmed at the cabinet.
        </div>
      )}

      <Step n={0} title="Arm the safety system" done={permit}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: permit ? C.ok : C.warn }}>
            {safety ? `${safety.state} · permit ${permit ? "GRANTED" : "WITHHELD"}` : "safety status unavailable"}
          </span>
          {!permit && (
            <button style={btn(false, C.ok)} disabled={!!busy} onClick={doArmSafety}>Arm safety system</button>
          )}
        </div>
        {!permit && (
          <div style={{ color: C.warn, fontSize: 10, marginTop: 4 }}>
            Until the permit is granted every command is clamped to zero — the fountain
            will not move no matter what else is armed below.
          </div>
        )}
        {safety?.latched_faults?.length > 0 && (
          <div style={{ color: C.danger, fontSize: 10, marginTop: 4 }}>
            Latched faults block arming: {safety.latched_faults.join(", ")}
          </div>
        )}
      </Step>

      <Step n={1} title="Find the gateway" done={connected}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          <button style={btn(busy === "discover")} disabled={!!busy} onClick={doDiscover}>
            {busy === "discover" ? "Scanning…" : "Discover"}
          </button>
          <span style={{ color: C.dim, fontSize: 10 }}>or connect directly:</span>
          <input style={{ ...input, width: 110 }} value={manualIp} onChange={e => setManualIp(e.target.value)} />
          <input style={{ ...input, width: 52 }} value={gwPort} onChange={e => setGwPort(e.target.value)} title="gateway port" />
          <input style={{ ...input, width: 60 }} value={localPort} onChange={e => setLocalPort(e.target.value)} title="local port" />
          <button style={btn(false, C.ok)} disabled={!!busy || connected} onClick={() => doConnect()}>Connect</button>
          {connected && <button style={btn(false, C.warn)} disabled={!!busy} onClick={doDisconnect}>Disconnect</button>}
        </div>
        {connected && (
          <div style={{ fontSize: 10, color: C.dim, marginBottom: 4 }}>
            sending from local port <span style={{ color: C.bright }}>{status.local_port}</span>
            {" → "}{status.gateway_ip}:{status.gateway_port}
          </div>
        )}
        {scanInfo && (
          <div style={{ fontSize: 10, marginTop: 4, marginBottom: 4,
                        color: scanInfo.found ? C.ok : C.warn }}>
            {scanInfo.found
              ? "gateway answered"
              : `no gateway answered · searched ${scanInfo.scanned} host(s) on ${scanInfo.subnets.join(", ") || "no network"}`}
            {!scanInfo.found && (
              <div style={{ color: C.dim, marginTop: 2 }}>
                If the subnet above is not the cabinet's (expected 192.168.5.x), this PC is
                on the wrong network — set the Ethernet adapter to a static 192.168.5.x
                address and disable Wi-Fi, then Discover again.
              </div>
            )}
          </div>
        )}
        {gateways.length > 0 && (
          <div style={{ marginTop: 4 }}>
            {gateways.map((g, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 10, color: C.text, padding: "2px 0" }}>
                <span style={{ color: C.accent }}>{g.ip || g.gateway_ip || g.address || "?"}</span>
                <span style={{ color: C.dim }}>{g.verdict || g.reason || g.status || ""}</span>
                <button style={btn(false, C.ok)} disabled={!!busy}
                  onClick={() => doConnect(g.ip || g.gateway_ip || g.address)}>Use</button>
              </div>
            ))}
          </div>
        )}
      </Step>

      <Step n={2} title="Map the channels you want to test" done={hasChannels}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
          <input style={{ ...input, width: 44 }} value={newCh.group} title="group"
            onChange={e => setNewCh({ ...newCh, group: e.target.value })} />
          <input style={{ ...input, width: 44 }} value={newCh.channel} title="channel"
            onChange={e => setNewCh({ ...newCh, channel: e.target.value })} />
          <input style={{ ...input, width: 96 }} value={newCh.label} title="label"
            onChange={e => setNewCh({ ...newCh, label: e.target.value })} />
          <select style={{ ...input, width: 84 }} value={newCh.device_type}
            onChange={e => setNewCh({ ...newCh, device_type: e.target.value })}>
            {["pump", "valve", "lighting", "fog", "flame"].map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button style={btn(false)} disabled={!!busy} onClick={doAssign}>Add channel</button>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
          <label style={{ ...btn(false, C.ok), display: "inline-block" }}>
            Import from capture…
            <input type="file" accept=".txt,.jsonl,.json" style={{ display: "none" }}
              disabled={!!busy}
              onChange={e => { doImportCapture(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <span style={{ color: C.dim, fontSize: 10 }}>
            changes.txt or capture.jsonl — maps every channel the real show drove
          </span>
        </div>
        {hasChannels ? (
          <div style={{ fontSize: 10, color: C.text }}>
            {channels.map(d => (
              <div key={d.device_id} style={{ padding: "1px 0" }}>
                <span style={{ color: C.accent }}>g{d.ican_group}/c{d.ican_channel}</span>{" "}
                {d.label} <span style={{ color: C.dim }}>({d.device_type})</span>
              </div>
            ))}
          </div>
        ) : <div style={{ color: C.dim, fontSize: 10 }}>No channels mapped yet.</div>}
      </Step>

      <Step n={3} title="Attach to the output bus" done={!!attached}>
        <button style={btn(false)} disabled={!!busy || !connected || !hasChannels} onClick={doAttach}>
          Attach {channels.length ? `(${channels.length})` : ""}
        </button>
        <span style={{ color: C.dim, fontSize: 10, marginLeft: 8 }}>
          {!connected ? "connect first" : !hasChannels ? "map a channel first" : "routes these channels to the runtime"}
        </span>
      </Step>

      <Step n={4} title="Arm the output" done={armed}>
        {!armed ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input style={{ ...input, width: 150 }} placeholder='type: ARM OUTPUT'
              value={confirmText} onChange={e => setConfirmText(e.target.value)} />
            <button style={btn(false, C.danger)}
              disabled={!!busy || !attached || confirmText !== "ARM OUTPUT"} onClick={doArm}>
              Arm output
            </button>
            <span style={{ color: C.dim, fontSize: 10 }}>
              {!attached ? "attach first" : "water off · one channel · watch the cabinet"}
            </span>
          </div>
        ) : (
          <button style={btn(true, C.warn)} disabled={!!busy} onClick={doDisarm}>Disarm (also blacks out)</button>
        )}
      </Step>

      <Step n={5} title="Test" done={false}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <button style={btn(seqRunning, C.ok)} disabled={!armed || !permit || !!busy || seqRunning || !hasChannels}
            onClick={runSequence}>
            {seqRunning ? "Running…" : "Run test sequence"}
          </button>
          <button style={btn(false, C.danger)} disabled={!!busy} onClick={stopAll}>STOP ALL</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {channels.map(d => {
            const on = liveChannels.has(d.device_id);
            return (
              <button key={d.device_id} style={btn(on, on ? C.ok : C.accent, !armed)}
                disabled={!armed || !permit || !!busy}
                onClick={() => setChannel(d, !on)}>
                {d.label || d.device_id} {on ? "ON" : "OFF"}
              </button>
            );
          })}
        </div>
        {(!armed || !permit) && <div style={{ color: C.dim, fontSize: 10, marginTop: 6 }}>{!permit ? "Grant the safety permit (step 0) to enable these." : "Arm the output to enable these."}</div>}
      </Step>

      <div style={{ marginTop: 16 }}>
        <div style={label}>Activity</div>
        <div style={{
          maxHeight: 160, overflowY: "auto", border: `1px solid ${C.line}`,
          borderRadius: 3, padding: 6, fontSize: 10,
        }}>
          {log.length === 0 && <div style={{ color: C.dim }}>Nothing yet.</div>}
          {log.map((l, i) => (
            <div key={i} style={{
              color: l.kind === "err" ? C.danger : l.kind === "ok" ? C.ok : l.kind === "warn" ? C.warn : C.text,
              padding: "1px 0",
            }}>
              <span style={{ color: C.dim }}>{l.t}</span> {l.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
