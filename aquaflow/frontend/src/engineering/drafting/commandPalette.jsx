/**
 * drafting/commandPalette.jsx — AF-CAD-033 Ctrl+K command palette.
 *
 * Lists EVERY designer command (tools, edit, selection, groups, view, snapping, project
 * output) from one registry the designer builds, so experts have a fast path and novices
 * a discoverable one. Type to filter (matches label, group and aliases), ↑/↓ to move,
 * Enter to run, Esc to close.
 */
import { useEffect, useMemo, useRef, useState } from "react";

/** Filter + rank commands for a query (label prefix > word prefix > substring). */
export function filterCommands(commands = [], query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return commands;
  const score = (c) => {
    const label = c.label.toLowerCase();
    const hay = `${label} ${(c.group || "").toLowerCase()} ${(c.aliases || []).join(" ").toLowerCase()}`;
    if (label.startsWith(q)) return 0;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 1;
    if (hay.includes(q)) return 2;
    return 9;
  };
  return commands.map((c) => ({ c, s: score(c) })).filter((x) => x.s < 9).sort((a, b) => a.s - b.s).map((x) => x.c);
}

export default function CommandPalette({ open, commands, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const visible = useMemo(() => filterCommands(commands, query), [commands, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  if (!open) return null;

  const run = (cmd) => {
    if (!cmd || cmd.enabled === false) return;
    onClose?.();
    cmd.run?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose?.(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(visible.length - 1, i + 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); return; }
    if (e.key === "Enter") { e.preventDefault(); run(visible[active]); }
  };

  return (
    <div role="dialog" aria-label="Command palette" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.35)", display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: 60 }}>
      <div style={{ width: 420, maxWidth: "90%", background: "#06121c", border: "1px solid #1a5a78", borderRadius: 6, boxShadow: "0 10px 30px rgba(0,0,0,0.6)", fontFamily: "monospace" }}>
        <input ref={inputRef} value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKeyDown}
          placeholder="Type a command…  (Esc closes)" aria-label="Command"
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", background: "#041018", color: "#cce8ff", border: "none", borderBottom: "1px solid #16415a", fontSize: 12, fontFamily: "monospace", outline: "none" }} />
        <div role="listbox" style={{ maxHeight: 360, overflowY: "auto" }}>
          {visible.length === 0 && <div style={{ padding: 10, color: "#556677", fontSize: 10 }}>No matching command</div>}
          {visible.map((cmd, i) => (
            <div key={cmd.id} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); run(cmd); }}
              style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "6px 10px", cursor: cmd.enabled === false ? "not-allowed" : "pointer",
                background: i === active ? "#0b2a3d" : "transparent", color: cmd.enabled === false ? "#3a4a58" : "#cce8ff", fontSize: 10 }}>
              <span><span style={{ color: "#557788" }}>{cmd.group} · </span>{cmd.label}</span>
              <span style={{ color: "#7a8a99" }}>{cmd.shortcut || ""}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
