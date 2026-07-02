import { useShowStore } from "../store/showStore";

export default function StatusBar({ onToggleLogs }) {
  const { playbackState, devices, currentShow, connectionState, serverLogs, undoStack, redoStack } = useShowStore();
  const onlineCount = devices.filter((d) => d.status === "online").length;
  const warnCount   = devices.filter((d) => d.status === "warn").length;
  const offCount    = devices.filter((d) => d.status === "offline").length;
  const errorCount  = serverLogs.filter((l) => l.level === "error").length;

  return (
    <div style={{
      height: "var(--statusbar-h)", background: "var(--bg-void)",
      borderTop: "1px solid var(--border)",
      display: "flex", alignItems: "center",
      padding: "0 12px", gap: 16, flexShrink: 0,
    }}>
      {/* Playback state */}
      <StatusItem
        dot={playbackState === "playing" ? "green" : playbackState === "recording" ? "red" : ""}
        label={playbackState.toUpperCase()}
      />

      <Divider />

      {/* Device status */}
      <StatusItem dot="green" label={`${onlineCount} Online`} />
      {warnCount > 0 && <StatusItem dot="amber" label={`${warnCount} Warn`} />}
      {offCount  > 0 && <StatusItem dot="red"   label={`${offCount} Offline`} />}

      <Divider />

      {/* Backend connection */}
      <StatusItem
        dot={connectionState === "connected" ? "green" : connectionState === "failed" ? "red" : "amber"}
        label={connectionState === "connected" ? "Backend Live" : "Backend Offline"}
      />

      <div style={{ flex: 1 }} />

      {/* Show info */}
      <StatusItem label={`${currentShow.bpm} BPM`} />
      <Divider />
      <StatusItem label={`Undo ${undoStack.length} · Redo ${redoStack.length}`} />
      <Divider />
      <StatusItem label="48kHz / 32-bit" />
      <Divider />
      <StatusItem label="DMX" accent />
      <StatusItem label="Art-Net" accent />
      <StatusItem label="Modbus" accent />
      <Divider />

      {/* Logs button */}
      <button
        onClick={onToggleLogs}
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
          color: errorCount > 0 ? "var(--red)" : "var(--text-muted)",
          fontSize: 9, fontFamily: "var(--font-mono)",
        }}
      >
        ⬛ {serverLogs.length} logs{errorCount > 0 ? ` · ${errorCount} errors` : ""}
      </button>

      <Divider />
      <StatusItem label="LuxuryCon Fountain Studio v0.1" muted />
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 12, background: "var(--border)", flexShrink: 0 }} />;
}

function StatusItem({ label, dot, accent, muted }) {
  const color = muted ? "var(--text-muted)" : accent ? "var(--text-accent)" : "var(--text-secondary)";
  const dotColors = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      {dot && (
        <div style={{
          width: 5, height: 5, borderRadius: "50%",
          background: dotColors[dot] || "transparent",
          boxShadow: dot ? `0 0 4px ${dotColors[dot]}` : "none",
        }} />
      )}
      <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", letterSpacing: "0.05em", color }}>
        {label}
      </span>
    </div>
  );
}
