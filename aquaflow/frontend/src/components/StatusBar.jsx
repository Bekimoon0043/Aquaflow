import React from "react";
import { useShowStore } from "../store/showStore";
import { version as FRONTEND_VERSION } from "../../package.json";
import { desktopVersionFromUserAgent } from "./topBarMenu";

// The desktop build reports the real release version; a browser build falls back to the frontend's.
const APP_VERSION = (typeof navigator !== "undefined" && desktopVersionFromUserAgent(navigator.userAgent)) || FRONTEND_VERSION;

// Status bar: only live state is shown here. (The former static "48kHz / 32-bit" and
// "DMX · Art-Net · Modbus" labels did not reflect any real connection and were removed.)
export default function StatusBar({ onToggleLogs }) {
  const { playbackState, devices, currentShow, connectionState, serverLogs, undoStack, redoStack } = useShowStore();
  const onlineCount = devices.filter((d) => d.status === "online").length;
  const warnCount = devices.filter((d) => d.status === "warn").length;
  const offCount = devices.filter((d) => d.status === "offline").length;
  const errorCount = serverLogs.filter((l) => l.level === "error").length;
  const connected = connectionState === "connected";

  return (
    <div className="pro-statusbar">
      <StatusItem dot={playbackState === "playing" ? "ok" : playbackState === "recording" ? "error" : ""} label={playbackState.toUpperCase()} />
      <Divider />
      <StatusItem dot="ok" label={`${onlineCount} Online`} />
      {warnCount > 0 && <StatusItem dot="warn" label={`${warnCount} Warn`} />}
      {offCount > 0 && <StatusItem dot="error" label={`${offCount} Offline`} />}
      <Divider />
      <StatusItem dot={connected ? "ok" : connectionState === "failed" ? "error" : "warn"} label={connected ? "Backend Live" : "Backend Offline"} />
      <span className="pro-statusbar-grow" />
      <StatusItem label={`${currentShow.bpm} BPM`} />
      <Divider />
      <StatusItem label={`Undo ${undoStack.length} · Redo ${redoStack.length}`} />
      <Divider />
      <button type="button" className={`pro-statusbar-logs${errorCount > 0 ? " has-errors" : ""}`} onClick={onToggleLogs} title="Show or hide the log panel">
        {serverLogs.length} logs{errorCount > 0 ? ` · ${errorCount} errors` : ""}
      </button>
      <Divider />
      <StatusItem label={`AquaFlow ${APP_VERSION}`} muted />
    </div>
  );
}

function Divider() {
  return <span className="pro-statusbar-divider" aria-hidden="true" />;
}

function StatusItem({ label, dot, muted }) {
  return (
    <span className={`pro-statusbar-item${muted ? " is-muted" : ""}`}>
      {dot && <span className={`pro-statusbar-dot is-${dot}`} aria-hidden="true" />}
      {label}
    </span>
  );
}
