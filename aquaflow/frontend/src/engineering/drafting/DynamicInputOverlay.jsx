/**
 * drafting/DynamicInputOverlay.jsx — AF-CAD-033 the input box shown at the cursor while a
 * length / angle / @dx,dy is being typed, plus the live polar read-out.
 */
import { describeDynamicInput } from "./dynamicInput";

export default function DynamicInputOverlay({ input, screen, polar, snap }) {
  if (!screen) return null;
  const typing = input?.active;
  if (!typing && !polar && !snap?.mode) return null;
  const box = { position: "absolute", left: screen.x + 16, top: screen.y + 14, zIndex: 25, pointerEvents: "none", fontFamily: "monospace", fontSize: 10 };
  return (
    <div style={box} data-testid="dynamic-input">
      {typing && (
        <div style={{ padding: "3px 6px", background: "#0b2a3d", border: "1px solid #3aa0ff", borderRadius: 3, color: "#e6f4ff", marginBottom: 2 }}>
          <span style={{ color: "#7fb8e0" }}>{input.field === "angle" ? "ANGLE" : input.field === "coords" ? "@X,Y" : "LENGTH"} </span>
          {describeDynamicInput(input)}<span style={{ opacity: 0.6 }}>▏</span>
          <span style={{ color: "#557788" }}>  Tab · Enter · Esc</span>
        </div>
      )}
      {!typing && polar && (
        <div style={{ padding: "2px 5px", background: "rgba(2,8,16,0.85)", border: "1px solid #1a5a78", borderRadius: 3, color: polar.locked ? "#ffaa00" : "#66ccff" }}>
          {polar.length.toFixed(3)} m &lt; {Math.round(polar.angleDeg)}°{polar.locked ? " · locked" : ""}
        </div>
      )}
    </div>
  );
}
