const clone = (value) => {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createEngineeringHistory(initial, limit = 80) {
  return { past: [], present: clone(initial), future: [], limit };
}

export function commitEngineeringHistory(history, next) {
  if (same(history.present, next)) return history;
  const past = [...history.past, clone(history.present)].slice(-history.limit);
  return { ...history, past, present: clone(next), future: [] };
}

export function undoEngineeringHistory(history) {
  if (!history.past.length) return history;
  const previous = history.past[history.past.length - 1];
  return {
    ...history,
    past: history.past.slice(0, -1),
    present: clone(previous),
    future: [clone(history.present), ...history.future],
  };
}

export function redoEngineeringHistory(history) {
  if (!history.future.length) return history;
  const next = history.future[0];
  return {
    ...history,
    past: [...history.past, clone(history.present)].slice(-history.limit),
    present: clone(next),
    future: history.future.slice(1),
  };
}

export const canUndoEngineering = (history) => history.past.length > 0;
export const canRedoEngineering = (history) => history.future.length > 0;
