import { beforeEach, describe, expect, it, vi } from "vitest";
import { SceneGraph, NODE_TYPES, __resetIds } from "../sceneGraph";
import { SceneHistory } from "../sceneHistory";

beforeEach(() => __resetIds());

describe("SceneHistory", () => {
  it("undoes and redoes a structural edit while restoring selection", () => {
    const graph = new SceneGraph();
    const first = graph.add({ id: "first", type: NODE_TYPES.NOZZLE });
    graph.select([first.id]);
    const history = new SceneHistory(graph);

    history.checkpoint("Add light");
    graph.add({ id: "light", type: NODE_TYPES.LIGHT });
    graph.select(["light"]);

    expect(history.undo()).toBe(true);
    expect(graph.get("light")).toBeNull();
    expect(graph.selected()).toEqual(["first"]);
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: true, redoLabel: "Add light" });

    expect(history.redo()).toBe(true);
    expect(graph.get("light")?.type).toBe(NODE_TYPES.LIGHT);
    expect(graph.selected()).toEqual(["light"]);
  });

  it("coalesces repeated property edits into one undo step", () => {
    const graph = new SceneGraph();
    graph.add({ id: "light", type: NODE_TYPES.LIGHT, props: { intensity: 0.2 } });
    const history = new SceneHistory(graph, { coalesceMs: 1000 });

    history.checkpoint("Edit intensity", { coalesceKey: "light:intensity", now: 100 });
    graph.setProps("light", { intensity: 0.5 });
    history.checkpoint("Edit intensity", { coalesceKey: "light:intensity", now: 500 });
    graph.setProps("light", { intensity: 0.9 });

    expect(history.state().undoCount).toBe(1);
    history.undo();
    expect(graph.get("light").props.intensity).toBe(0.2);
  });

  it("caps history and clears redo after a new branch", () => {
    const graph = new SceneGraph();
    const history = new SceneHistory(graph, { limit: 2 });
    for (let index = 0; index < 3; index += 1) {
      history.checkpoint(`Add ${index}`);
      graph.add({ type: NODE_TYPES.NOZZLE });
    }
    expect(history.state().undoCount).toBe(2);
    history.undo();
    expect(history.state().canRedo).toBe(true);
    history.checkpoint("New branch");
    expect(history.state().canRedo).toBe(false);
  });

  it("notifies toolbar subscribers when availability changes", () => {
    const graph = new SceneGraph();
    const onChange = vi.fn();
    const history = new SceneHistory(graph, { onChange });
    history.checkpoint("Add");
    graph.add({ type: NODE_TYPES.NOZZLE });
    history.undo();
    history.redo();
    history.clear();
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: false });
  });
});
