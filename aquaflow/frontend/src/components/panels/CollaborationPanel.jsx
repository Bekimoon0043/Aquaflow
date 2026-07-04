// CollaborationPanel.jsx — AquaFlow Cloud Collaboration UI (AQ-X-014)
//
// Connects the collaboration backend (AQ-S3-010) to the UI: open/join a shared show
// document, apply a field edit, and see the version, active users and version history.
import { useState } from "react";
import { apiGet, apiPost } from "../../utils/apiClient";

const box = { background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: 6 };
const input = { ...box, padding: 6, fontSize: 11, color: "var(--text-primary)" };

export default function CollaborationPanel() {
  const [docId, setDocId] = useState("show-demo");
  const [user, setUser] = useState("operator");
  const [doc, setDoc] = useState(null);
  const [users, setUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const [editKey, setEditKey] = useState("show.bpm");
  const [editVal, setEditVal] = useState("128");
  const [error, setError] = useState("");
  const [joined, setJoined] = useState(false);

  const wrap = (fn) => async () => { try { await fn(); setError(""); } catch (e) { setError(String(e.message || e)); } };

  const refresh = async () => {
    setDoc(await apiGet(`/collab/doc/${docId}`));
    setUsers((await apiGet(`/collab/users/${docId}`)).users || []);
    setHistory((await apiGet(`/collab/history/${docId}`)).history || []);
  };

  const open = wrap(async () => {
    await apiPost("/collab/open", { doc_id: docId, initial: { show: { name: "Demo Show", bpm: 120 }, notes: "" } });
    await refresh();
  });
  const join = wrap(async () => {
    await apiPost("/collab/join", { doc_id: docId, user_id: user, name: user });
    setJoined(true); await refresh();
  });
  const edit = wrap(async () => {
    const base = doc?.version ?? 0;
    const val = isNaN(Number(editVal)) ? editVal : Number(editVal);
    await apiPost("/collab/edit", { doc_id: docId, user_id: user, base_version: base, changes: { [editKey]: val } });
    await refresh();
  });

  const Btn = ({ onClick, children }) => (
    <button onClick={onClick} style={{ background: "var(--accent)", color: "#04140a", border: "none",
      borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{children}</button>
  );

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: 36,
        background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <span style={{ fontSize: 14, color: "var(--accent)" }}>👥</span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 11, fontWeight: 600,
          letterSpacing: "0.12em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Cloud Collaboration
        </span>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {error && <div style={{ ...box, padding: 8, color: "#ef4444", fontSize: 11 }}>⛔ {error}</div>}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column" }}>
            Document<input value={docId} onChange={(e) => setDocId(e.target.value)} style={input} /></label>
          <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column" }}>
            User<input value={user} onChange={(e) => setUser(e.target.value)} style={input} /></label>
          <Btn onClick={open}>Open</Btn>
          <Btn onClick={join}>Join</Btn>
        </div>

        {doc && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ ...box, padding: 8, minWidth: 90 }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Version</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>{doc.version}</div>
            </div>
            <div style={{ ...box, padding: 8, flex: 1, minWidth: 140 }}>
              <div style={{ fontSize: 9, color: "var(--text-muted)" }}>Active users ({users.length})</div>
              <div style={{ fontSize: 11, color: "var(--text-primary)" }}>
                {users.map((u) => u.name || u.user_id).join(", ") || "—"}</div>
            </div>
          </div>
        )}

        {joined && doc && (
          <div style={{ ...box, padding: 8, display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column" }}>
              Field<input value={editKey} onChange={(e) => setEditKey(e.target.value)} style={{ ...input, width: 120 }} /></label>
            <label style={{ fontSize: 10, color: "var(--text-muted)", display: "flex", flexDirection: "column" }}>
              Value<input value={editVal} onChange={(e) => setEditVal(e.target.value)} style={{ ...input, width: 90 }} /></label>
            <Btn onClick={edit}>Apply edit</Btn>
          </div>
        )}

        {doc && (
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>Document state</div>
            <pre style={{ ...box, padding: 8, fontSize: 10.5, maxHeight: "22vh", overflow: "auto",
              color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(doc.data ?? doc, null, 2)}</pre>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>History ({history.length})</div>
            {history.slice(-8).reverse().map((h, i) => (
              <div key={i} style={{ ...box, padding: "4px 8px", marginBottom: 3, fontSize: 10, color: "var(--text-secondary)" }}>
                v{h.version} · {h.author || "?"} · {(h.changed || []).join(", ") || h.message || "—"}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
