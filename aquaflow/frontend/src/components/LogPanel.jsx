import { useShowStore } from "../store/showStore";

const LEVEL_STYLES = {
  info:  { color: "var(--text-secondary)", icon: "›" },
  warn:  { color: "var(--amber)",          icon: "⚠" },
  error: { color: "var(--red)",            icon: "✕" },
  debug: { color: "var(--text-muted)",     icon: "·" },
};

export default function LogPanel({ onClose }) {
  const { serverLogs, clearLogs } = useShowStore();

  const formatTime = (ts) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}.${d.getMilliseconds().toString().padStart(3,"0")}`;
  };

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 16,
      width: 480, height: 280,
      background: "var(--bg-panel)",
      border: "1px solid var(--border-mid)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      display: "flex", flexDirection: "column",
      zIndex: 500,
      fontFamily: "var(--font-mono)",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 12px", height: 34,
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-surface)",
        borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
        flexShrink: 0,
      }}>
        <div className="dot" />
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", color: "var(--text-secondary)", textTransform: "uppercase" }}>
          Console
        </span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{serverLogs.length} entries</span>
        <div style={{ flex: 1 }} />
        <button className="btn" style={{ padding: "2px 8px", fontSize: 10 }} onClick={clearLogs}>Clear</button>
        <button className="btn" style={{ padding: "2px 6px", fontSize: 12 }} onClick={onClose}>✕</button>
      </div>

      {/* Log entries */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {serverLogs.length === 0 ? (
          <div style={{ padding: "20px 16px", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
            No logs yet. Start the backend to see output here.
          </div>
        ) : (
          serverLogs.map((log, i) => {
            const style = LEVEL_STYLES[log.level] || LEVEL_STYLES.info;
            return (
              <div key={i} style={{
                display: "flex", gap: 10, padding: "2px 12px",
                fontSize: 11, lineHeight: 1.6,
              }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-surface)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <span style={{ color: "var(--text-muted)", flexShrink: 0, fontSize: 10 }}>
                  {formatTime(log.ts)}
                </span>
                <span style={{ color: style.color, flexShrink: 0 }}>{style.icon}</span>
                <span style={{ color: style.color, flex: 1, wordBreak: "break-word" }}>{log.msg}</span>
                {log.deviceId && (
                  <span style={{ color: "var(--text-muted)", fontSize: 10, flexShrink: 0 }}>
                    [{log.deviceId}]
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
