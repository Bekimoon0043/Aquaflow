/**
 * ResizeHandle.jsx — the grab strip between two panels.
 *
 * Deliberately takes up NO layout space. It is a zero-width (or zero-height) flex item
 * containing an absolutely-positioned strip that straddles the existing border. That
 * matters because the brief was to add resizing WITHOUT restyling anything: if the
 * handle occupied real space, every panel would shift by a few pixels and the borders
 * would no longer line up with the design.
 *
 * At rest it is completely invisible — identical pixels to before. It only shows a
 * faint tint while the pointer is on it or a drag is in progress, which is affordance,
 * not decoration: an invisible control that never acknowledges the pointer is
 * undiscoverable.
 */

import { useCallback, useRef, useState } from "react";

const GRAB_PX = 8;          // generous hit area; the visible border stays 1px
const ACTIVE_TINT = "rgba(0,170,255,0.55)";
const HOVER_TINT = "rgba(0,170,255,0.22)";

/**
 * @param {object} props
 * @param {"x"|"y"} props.axis      "x" = vertical divider (drag left/right)
 * @param {function} props.onResize called with the pointer delta in px during the drag
 * @param {function} [props.onStart] called when a drag begins
 * @param {function} [props.onEnd]   called when a drag finishes
 * @param {function} [props.onReset] called on double-click, to restore the default size
 * @param {string} [props.title]     tooltip text
 */
export default function ResizeHandle({ axis = "x", onResize, onStart, onEnd, onReset, title }) {
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);

  const vertical = axis === "x";

  const handlePointerDown = useCallback((e) => {
    // Left button only; a right-click here should fall through to the context menu.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    start.current = vertical ? e.clientX : e.clientY;
    setDragging(true);
    onStart?.();

    // Pointer capture keeps the drag alive when the cursor outruns the 8px strip —
    // without it, a fast drag detaches and the panel stops following the mouse.
    const el = e.currentTarget;
    try { el.setPointerCapture(e.pointerId); } catch { /* not fatal */ }

    const move = (ev) => {
      const now = vertical ? ev.clientX : ev.clientY;
      onResize?.(now - start.current);
    };
    const up = () => {
      setDragging(false);
      onEnd?.();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // Suppress text selection and keep the resize cursor while dragging over any panel.
    document.body.style.userSelect = "none";
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
  }, [vertical, onResize, onStart, onEnd]);

  const lit = dragging || hover;

  // The outer element is the zero-size spacer; the inner strip is the actual target.
  const outer = vertical
    ? { width: 0, flexShrink: 0, position: "relative", zIndex: 40, alignSelf: "stretch" }
    : { height: 0, flexShrink: 0, position: "relative", zIndex: 40 };

  const inner = vertical
    ? { position: "absolute", top: 0, bottom: 0, left: -(GRAB_PX / 2), width: GRAB_PX, cursor: "col-resize" }
    : { position: "absolute", left: 0, right: 0, top: -(GRAB_PX / 2), height: GRAB_PX, cursor: "row-resize" };

  // The visible line is drawn as a 1px child so the 8px hit area itself never paints.
  const line = vertical
    ? { position: "absolute", top: 0, bottom: 0, left: GRAB_PX / 2 - 0.5, width: 1 }
    : { position: "absolute", left: 0, right: 0, top: GRAB_PX / 2 - 0.5, height: 1 };

  return (
    <div style={outer} data-resize-handle={axis}>
      <div
        style={inner}
        onPointerDown={handlePointerDown}
        onDoubleClick={onReset}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        title={title || (onReset ? "Drag to resize · double-click to reset" : "Drag to resize")}
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
      >
        <div style={{
          ...line,
          background: lit ? (dragging ? ACTIVE_TINT : HOVER_TINT) : "transparent",
          transition: "background 120ms ease",
          pointerEvents: "none",
        }} />
      </div>
    </div>
  );
}
