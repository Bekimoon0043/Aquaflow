import { beforeEach, describe, expect, it } from "vitest";
import { useShowStore } from "../showStore";

const node = (id, x = 10, y = 20) => ({
  id,
  type: "pump",
  label: `Node ${id}`,
  x,
  y,
  width: 180,
  height: 80,
  ports: { in: ["trigger"], out: ["out"] },
  params: { speed: 50 },
});

describe("node editor shortcut actions", () => {
  beforeEach(() => {
    useShowStore.setState({
      nodes: [node("a"), node("b", 300, 80)],
      connections: [
        { id: "ab", from: "a", fromPort: "out", to: "b", toPort: "trigger" },
      ],
      selectedNodeId: "a",
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
      isDirty: false,
    });
  });

  it("deletes a selected node and every attached connection, then supports undo", () => {
    useShowStore.getState().removeNode("a");
    expect(useShowStore.getState().nodes.map((entry) => entry.id)).toEqual(["b"]);
    expect(useShowStore.getState().connections).toEqual([]);
    expect(useShowStore.getState().selectedNodeId).toBeNull();

    useShowStore.getState().undo();
    expect(useShowStore.getState().nodes.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(useShowStore.getState().connections).toHaveLength(1);
  });

  it("duplicates a node without sharing editable nested values", () => {
    useShowStore.getState().duplicateNode("a");
    const state = useShowStore.getState();
    const duplicate = state.nodes.at(-1);
    expect(duplicate.id).not.toBe("a");
    expect(duplicate.label).toBe("Node a Copy");
    expect([duplicate.x, duplicate.y]).toEqual([38, 48]);
    expect(state.selectedNodeId).toBe(duplicate.id);
    expect(duplicate.params).not.toBe(state.nodes[0].params);
    expect(duplicate.ports).not.toBe(state.nodes[0].ports);
  });
});
