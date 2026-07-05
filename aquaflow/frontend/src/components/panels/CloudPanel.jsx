// CloudPanel.jsx — AquaFlow Global Asset Cloud (AQ-S5-005)
//
// Multi-tenant cloud console: pick a company, see its versioned cloud backups (restore),
// and run remote diagnostics against its sites. Consumes /api/cloud.
import { useEffect, useState, useCallback } from "react";
import { apiGet, apiPost } from "../../utils/apiClient";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const HEALTH = { live: "#22c55e", warning: "#f59e0b", critical: "#ef4444", estop: "#ef4444",
  idle: "#64748b", offline: "#64748b", unknown: "#64748b" };
const SEV = { critical: "#ef4444", warning: "#f59e0b", info: "#38bdf8" };

export default function CloudPanel() {
  const [companies, setCompanies] = useState([]);
  const [cid, setCid] = useState("");
  const [backups, setBackups] = useState([]);
  const [sites, setSites] = useState([]);
  const [diag, setDiag] = useState(null);
  const [error, setError] = useState("");

  const loadCompanies = useCallback(async () => {
    try {
      const r = await apiGet("/cloud/companies");
      setCompanies(r.companies || []);
      if (!cid && r.companies?.length) setCid(r.companies[0].id);
      setError("");
    } catch (e) { setError(String(e.message || e)); }
  }, [cid]);

  const loadCompany = useCallback(async (id) => {
    if (!id) return;
    try {
      setBackups((await apiGet(`/cloud/companies/${id}/backups`)).backups || []);
      setSites((await apiGet(`/cloud/companies/${id}/diagnostics`)).sites || []);
      setError("");
    } catch (e) { setError(String(e.message || e)); }
  }, []);

  useEffect(() => { loadCompanies(); }, [loadCompanies]);
  useEffect(() => { if (cid) { setDiag(null); loadCompany(cid); } }, [cid, loadCompany]);

  const runDiag = async (sid) => {
    try { setDiag(await apiGet(`/cloud/companies/${cid}/diagnostics/${sid}`)); setError(""); }
    catch (e) { setError(String(e.message || e)); }
  };

  const restore = async (bid) => {
    try {
      const r = await apiGet(`/cloud/companies/${cid}/backups/${bid}`);
      alert(`Restored ${r.asset_id} v${r.version} — checksum verified (${r.verified ? "OK" : "FAILED"}).`);
    } catch (e) { setError(String(e.message || e)); }
  };

  const seedDemo = async () => {
    try {
      if (!companies.length) {
        await apiPost("/cloud/companies", { id: "acme", name: "ACME Fountains", plan: "enterprise" });
        await apiPost("/cloud/companies", { id: "globex", name: "Globex Water" });
      }
      const id = cid || "acme";
      await apiPost(`/cloud/companies/${id}/backups`,
        { asset_id: "dubai-show", label: "nightly", data: { tempo: 128, jets: [1, 2, 3, 4] } });
      await apiPost(`/cloud/companies/${id}/diagnostics`,
        { site_id: "dubai-mall", site_name: "Dubai Mall",
          status: { safety: { state: "LIVE", permit: true, active_faults: [], inputs: { plc_heartbeat_ok: true } },
                    transport: { state: "PLAYING", position_ms: 5000, duration_ms: 10000 } } });
      await loadCompanies();
      loadCompany(id);
    } catch (e) { setError(String(e.message || e)); }
  };

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>☁️</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Global Asset Cloud
        </span>
        <select value={cid} onChange={(e) => setCid(e.target.value)} style={{ marginLeft: "auto",
          background: "var(--bg-panel)", color: "var(--text-primary)", border: "1px solid var(--border)",
          borderRadius: 6, fontSize: 10, padding: "3px 6px" }}>
          {companies.length === 0 && <option value="">— no companies —</option>}
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.plan})</option>)}
        </select>
        <button onClick={seedDemo} style={{ background: "transparent", border: "1px solid var(--border)",
          borderRadius: 6, color: "var(--text-muted)", fontSize: 10, padding: "3px 8px", cursor: "pointer" }}>
          + Demo data
        </button>
      </div>

      {error && <div style={{ ...box, margin: 8, padding: 8, color: "#ef4444", fontSize: 10 }}>⛔ {error}</div>}

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* backups */}
        <div style={{ flex: 1, overflow: "auto", padding: 10, borderRight: "1px solid var(--border)" }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>
            CLOUD BACKUPS ({backups.length})
          </div>
          {backups.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No backups for this company.</div>
          ) : backups.map((b) => (
            <div key={b.backup_id} style={{ ...box, padding: "7px 9px", marginBottom: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>
                  {b.asset_id} <span style={{ color: "var(--accent)" }}>v{b.version}</span>
                </span>
                <button onClick={() => restore(b.backup_id)} style={{ background: "transparent",
                  border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)",
                  fontSize: 9, padding: "2px 7px", cursor: "pointer" }}>Restore</button>
              </div>
              <div style={{ fontSize: 8.5, color: "var(--text-muted)", marginTop: 3 }}>
                {b.asset_type}{b.label ? ` · ${b.label}` : ""} · {b.size_bytes} B · ✓ {b.checksum.slice(0, 12)}…
              </div>
            </div>
          ))}
        </div>

        {/* remote diagnostics */}
        <div style={{ width: 320, overflow: "auto", padding: 10, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 4 }}>
            REMOTE DIAGNOSTICS ({sites.length})
          </div>
          {sites.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>No sites reporting.</div>
          ) : sites.map((s) => (
            <div key={s.site_id} onClick={() => runDiag(s.site_id)} style={{ ...box, padding: "6px 8px",
              marginBottom: 4, cursor: "pointer", borderLeft: `3px solid ${HEALTH[s.health] || "#888"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: HEALTH[s.health] }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{s.site_name}</span>
                <span style={{ fontSize: 9, color: HEALTH[s.health], textTransform: "uppercase" }}>{s.health}</span>
              </div>
              <div style={{ fontSize: 8.5, color: "var(--text-muted)", marginTop: 2 }}>
                {s.reachable ? "reachable" : "unreachable"}{s.alert_count ? ` · ${s.alert_count} alerts` : ""} · run ▸
              </div>
            </div>
          ))}

          {diag && (
            <div style={{ ...box, padding: 9, marginTop: 8, borderTop: `2px solid ${HEALTH[diag.health]}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-primary)" }}>
                {diag.site_name} — <span style={{ color: HEALTH[diag.health] }}>{diag.health}</span>
              </div>
              <div style={{ fontSize: 8.5, color: "var(--text-muted)", margin: "2px 0 6px" }}>
                {diag.reachable ? "reachable" : "UNREACHABLE"} · backup {diag.has_backup ? `v${diag.last_backup_version}` : "none"}
              </div>
              {diag.alerts.map((a, i) => (
                <div key={i} style={{ fontSize: 9.5, color: SEV[a.severity], marginBottom: 2 }}>• {a.message}</div>
              ))}
              <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 5, marginBottom: 2 }}>RECOMMENDATIONS</div>
              {diag.recommendations.map((r, i) => (
                <div key={i} style={{ fontSize: 9.5, color: "var(--text-secondary)", marginBottom: 2 }}>→ {r}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
