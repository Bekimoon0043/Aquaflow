/**
 * drafting/commandLine.js — AutoCAD-style command line: a pure key reducer.
 *
 * The host passes every key press (without Ctrl/Meta/Alt) with `{ drawing, idleCapture }`.
 *   printable (letters, digits, . - @ , < #) → appended to the typed text
 *   Enter / Space → submit the text; with no text: finish the command while drawing,
 *                   repeat the last command when idle
 *   Backspace edits, Escape cancels, ArrowUp/ArrowDown recall earlier input.
 * Letters are captured while drawing, or when idle only with `idleCapture` (so the designer's
 * single-key shortcuts keep working) — or once something has been typed.
 */
const HISTORY_MAX = 6;
const INPUTS_MAX = 20;

export const emptyCommandLine = () => ({ text: "", history: [] });

const isLetter = (k) => /^[a-zA-Z]$/.test(k);
const isNumeric = (k) => /^[0-9.\-@,<#]$/.test(k);

export function pushHistory(state, text, tone = "prompt") {
  const s = state || emptyCommandLine();
  return { ...s, history: [...(s.history || []), { text: String(text), tone }].slice(-HISTORY_MAX) };
}

const withText = (s, text) => ({ ...s, text, recall: undefined });

export function commandLineKey(state, key, { drawing = false, idleCapture = false } = {}) {
  const s = state || emptyCommandLine();
  const text = s.text || "";
  const pass = { state: s, action: null, handled: false };

  if (key === "Escape") return { state: withText(s, ""), action: { type: "cancel" }, handled: true };

  if (key === "Enter" || key === " " || key === "Spacebar") {
    const typed = text.trim();
    if (typed) {
      const inputs = [...(s.inputs || []), typed].slice(-INPUTS_MAX);
      return { state: { ...pushHistory(s, typed, "input"), text: "", inputs, recall: undefined }, action: { type: "submit", text: typed }, handled: true };
    }
    if (drawing) return { state: withText(s, ""), action: { type: "finish", text: "" }, handled: true };
    // Idle Space is the pan key unless the host asks the command line to own the keyboard.
    if (key !== "Enter" && !idleCapture) return pass;
    return { state: withText(s, ""), action: { type: "repeat" }, handled: true };
  }

  if (key === "Backspace") {
    if (!text) return pass;
    return { state: withText(s, text.slice(0, -1)), action: null, handled: true };
  }

  if (key === "ArrowUp" || key === "ArrowDown") {
    const inputs = s.inputs || [];
    if (!inputs.length || (!drawing && !idleCapture && !text)) return pass;
    const current = s.recall ?? inputs.length;
    const next = key === "ArrowUp" ? Math.max(0, current - 1) : Math.min(inputs.length, current + 1);
    return { state: { ...s, text: inputs[next] ?? "", recall: next }, action: null, handled: true };
  }

  if (key && key.length === 1 && (isLetter(key) || isNumeric(key))) {
    const capture = drawing || idleCapture || text.length > 0;
    if (!capture) return pass;
    return { state: withText(s, text + key), action: null, handled: true };
  }

  return pass;
}
