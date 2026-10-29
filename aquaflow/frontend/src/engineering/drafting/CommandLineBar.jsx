/**
 * drafting/CommandLineBar.jsx — the AutoCAD-style command line docked under the plan canvas.
 * Drawing: faded history, the prompt with clickable options, the typed text with a caret.
 * Idle: one big button per drawing command so beginners can click instead of typing.
 */
import { DRAFT_COMMANDS } from "./shapeDraft";

const C = { bg: "#040c14", border: "#12324a", accent: "#00ccaa", text: "#7ec8e3", dim: "#3f5a6c", warn: "#ffcc00", err: "#ff8888" };
const toneColor = { prompt: C.dim, input: "#5f8aa0", error: C.err, ok: "#4fae94" };
const CARET_CSS = "@keyframes afCaretBlink{0%,49%{opacity:1}50%,100%{opacity:0}}";

function OptionChip({ option, onOption }) {
  const label = String(option.label || option.key || "");
  return (
    <button type="button" onMouseDown={(e) => { e.preventDefault(); onOption?.(option.key); }}
      title={`${label} (type ${label.charAt(0).toUpperCase()})`}
      style={{ padding: "0 5px", margin: "0 2px", background: "#08202e", color: C.text, border: `1px solid ${C.border}`,
        borderRadius: 3, fontFamily: "monospace", fontSize: 11, cursor: "pointer", lineHeight: "16px" }}>
      <span style={{ textDecoration: "underline", color: C.accent }}>{label.charAt(0)}</span>{label.slice(1)}
    </button>
  );
}

export default function CommandLineBar({ prompt, text = "", history = [], onOption, onCommand, lengthHint = "", visible = true }) {
  if (!visible) return null;
  const drawing = Boolean(prompt?.text);
  const options = prompt?.options || [];
  return (
    <div aria-label="Command line" style={{ position: "relative", flexShrink: 0, zIndex: 20, background: "rgba(4,12,20,0.94)",
      borderTop: `1px solid ${C.border}`, fontFamily: "monospace", fontSize: 11, color: C.text, padding: "4px 10px", boxSizing: "border-box" }}>
      <style>{CARET_CSS}</style>
      {history.slice(-(drawing ? 2 : 3)).map((line, i) => (
        <div key={i} style={{ color: toneColor[line.tone] || C.dim, opacity: 0.75, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: "14px" }}>
          {line.text}
        </div>
      ))}
      {drawing ? (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, minHeight: 20 }}>
          <span style={{ color: C.accent }}>{prompt.text}</span>
          {options.length > 0 && (
            <span style={{ color: C.dim }}>[{options.map((o) => <OptionChip key={o.key} option={o} onOption={onOption} />)}]</span>
          )}
          <span style={{ color: C.dim }}>:</span>
          <span style={{ color: "#e6f6ff", marginLeft: 4 }}>{text}</span>
          <span style={{ display: "inline-block", width: 7, height: 13, background: C.accent, animation: "afCaretBlink 1s steps(1) infinite", verticalAlign: "middle" }} />
          {lengthHint && <span style={{ marginLeft: "auto", color: C.warn }}>{lengthHint}</span>}
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "2px 0 3px" }}>
            {(DRAFT_COMMANDS || []).map((cmd) => (
              <button key={cmd.key} type="button" onMouseDown={(e) => { e.preventDefault(); onCommand?.(cmd.key); }}
                title={`${cmd.label} — type ${(cmd.aliases || [])[0] || cmd.key}`}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", background: "#08202e", color: C.text,
                  border: `1px solid ${C.border}`, borderRadius: 5, fontFamily: "monospace", fontSize: 11, cursor: "pointer" }}>
                <span style={{ fontSize: 14, color: C.accent }}>{cmd.icon}</span>
                <span>{cmd.label}</span>
                {(cmd.aliases || [])[0] && <span style={{ color: C.dim, fontSize: 10 }}>{String(cmd.aliases[0]).toUpperCase()}</span>}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.dim }}>
            {text
              ? <><span style={{ color: C.accent }}>Command:</span><span style={{ color: "#e6f6ff" }}>{text}</span>
                  <span style={{ display: "inline-block", width: 7, height: 13, background: C.accent, animation: "afCaretBlink 1s steps(1) infinite" }} /></>
              : <span>Click a shape, or type L, REC, C, POL, EL, A + Enter · while drawing type a length (5) or a size (12,8) + Enter</span>}
          </div>
        </div>
      )}
    </div>
  );
}
