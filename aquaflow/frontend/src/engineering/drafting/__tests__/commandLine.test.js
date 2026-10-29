import { describe, it, expect } from "vitest";
import { commandLineKey, emptyCommandLine, pushHistory } from "../commandLine";

const type = (keys, opts = { drawing: true }, start = emptyCommandLine()) => {
  let state = start, action = null;
  for (const k of keys) ({ state, action } = commandLineKey(state, k, opts));
  return { state, action };
};

describe("commandLineKey", () => {
  it("typing 12.5 then Enter submits 12.5 and clears the text", () => {
    const { state, action } = type(["1", "2", ".", "5", "Enter"]);
    expect(action).toEqual({ type: "submit", text: "12.5" });
    expect(state.text).toBe("");
    expect(state.history.at(-1)).toEqual({ text: "12.5", tone: "input" });
  });

  it("Space submits like Enter", () => {
    expect(type(["4", " "]).action).toEqual({ type: "submit", text: "4" });
  });

  it("empty Enter while drawing finishes the command", () => {
    expect(type(["Enter"]).action.type).toBe("finish");
  });

  it("empty Enter while idle repeats the last command", () => {
    expect(type(["Enter"], { drawing: false }).action).toEqual({ type: "repeat" });
  });

  it("idle Space is left for panning unless idleCapture", () => {
    expect(commandLineKey(emptyCommandLine(), " ", { drawing: false }).handled).toBe(false);
    expect(commandLineKey(emptyCommandLine(), " ", { drawing: false, idleCapture: true }).action).toEqual({ type: "repeat" });
  });

  it("Escape cancels and clears", () => {
    const { state, action } = type(["3", "Escape"]);
    expect(action).toEqual({ type: "cancel" });
    expect(state.text).toBe("");
  });

  it("Backspace deletes the last character, and is not handled when empty", () => {
    expect(type(["1", "2", "Backspace"]).state.text).toBe("1");
    expect(commandLineKey(emptyCommandLine(), "Backspace", { drawing: true }).handled).toBe(false);
  });

  it("ArrowUp recalls earlier input", () => {
    let { state } = type(["5", "Enter", "7", "<", "3", "0", "Enter"]);
    ({ state } = commandLineKey(state, "ArrowUp", { drawing: true }));
    expect(state.text).toBe("7<30");
    ({ state } = commandLineKey(state, "ArrowUp", { drawing: true }));
    expect(state.text).toBe("5");
  });

  it("captures letters while drawing but not idle without idleCapture", () => {
    expect(type(["a"]).state.text).toBe("a");
    expect(commandLineKey(emptyCommandLine(), "f", { drawing: false }).handled).toBe(false);
    expect(commandLineKey(emptyCommandLine(), "l", { drawing: false, idleCapture: true }).state.text).toBe("l");
  });

  it("accepts coordinate characters", () => {
    expect(type(["@", "3", ",", "-", "2"]).state.text).toBe("@3,-2");
  });

  it("pushHistory keeps the last six lines", () => {
    let s = emptyCommandLine();
    for (let i = 0; i < 9; i++) s = pushHistory(s, `line ${i}`, "prompt");
    expect(s.history).toHaveLength(6);
    expect(s.history[0].text).toBe("line 3");
  });
});
