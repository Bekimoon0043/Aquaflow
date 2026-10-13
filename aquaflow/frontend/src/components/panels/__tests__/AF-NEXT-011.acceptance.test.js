// @vitest-environment jsdom
/**
 * AF-NEXT-011 acceptance — "a novice can draw and connect a 12.5 m pipe to a nozzle port,
 * undo it as one action, and repeat the operation in 2D/3D with the same geometry."
 *
 * 2D: the real PoolGeometryDesigner (jsdom), driven only by clicks and typed keys.
 * 3D: the real SceneEditor (three.js, no WebGL renderer needed) on the same store, driven
 *     through its ground-plane drafting path. Both share engineering/drafting.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as THREE from "three";
import { mountDesigner, cleanup, wait, act } from "./designerHarness";
import useEngineeringStore from "../../../store/engineeringStore";
import { createDefaultEngineeringProject } from "../../../engineering/engineeringProject";
import { sharedDraftingHistory } from "../../../engineering/drafting/commands";
import { SceneEditor } from "../../preview/editor/sceneEditor";
import { createPlanFrame, createStoreSceneHistory } from "../../preview/editor/engineeringDraftingBridge";

afterEach(() => cleanup());

// A 20 m × 8 m pool with two nozzles 12.5 m apart on one line.
const PROJECT = {
  params: { width: 20, length: 8, radius: 6, depth: 0.8 },
  fixtures: [
    { id: "N-A", type: "nozzle_geyser", label: "Nozzle A", x: 2, y: 2, rotation: 0 },
    { id: "N-B", type: "nozzle_geyser", label: "Nozzle B", x: 14.5, y: 2, rotation: 0 },
  ],
};
const EXPECTED = [{ x: 2, y: 2 }, { x: 14.5, y: 2 }];

function make3dEditor() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(0, 9, 0.01);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const canvas = document.createElement("canvas");
  const editor = new SceneEditor({ THREE, scene, camera, renderer: null, canvas, history: createStoreSceneHistory(useEngineeringStore) });
  editor.focus.set(0, 0, 0);
  editor.setPlanFrame(createPlanFrame(useEngineeringStore));
  editor.setEnabled(true);
  return editor;
}

const pipeGeometry = (pipe) => pipe.points.map(({ x, y }) => ({ x, y }));

describe("AF-NEXT-011 acceptance: 12.5 m pipe to a nozzle port, one-step undo, 2D = 3D", () => {
  it("2D designer: click at nozzle A, type 12.5 Enter at 0°, connects to nozzle B; undo/redo as one action", async () => {
    const d = await mountDesigner({ project: PROJECT });
    await d.tool("Pipe");
    await d.tap(2.1, 2.05);              // inside the 10 px aperture → Port snap on nozzle A
    await d.move(8, 2.1);                // cursor at ~0°
    for (const k of ["1", "2", ".", "5"]) await d.key(k);
    expect(d.container.querySelector('[data-testid="dynamic-input"]').textContent).toContain("12.5 m");
    await d.key("Enter");                // commit the typed length
    await d.key("Enter");                // empty input → finish the pipe
    await d.settle();

    const pipes = d.pipes();
    expect(pipes).toHaveLength(1);
    expect(pipeGeometry(pipes[0])).toEqual(EXPECTED);
    expect(pipes[0].connections.start).toMatchObject({ fixtureId: "N-A", port: "inlet" });
    expect(pipes[0].connections.end).toMatchObject({ fixtureId: "N-B", port: "inlet" });
    expect(pipes[0].uuid).toBe(pipes[0].id);

    const undoDepth = sharedDraftingHistory.undoStack.length;
    await d.key("z", { ctrlKey: true });
    await wait(120);
    expect(d.pipes()).toHaveLength(0);
    expect(d.fixtures()).toHaveLength(2);       // only the pipe was undone
    expect(sharedDraftingHistory.undoStack.length).toBe(undoDepth - 1);
    await d.key("y", { ctrlKey: true });
    await wait(120);
    expect(d.pipes()).toHaveLength(1);
    expect(pipeGeometry(d.pipes()[0])).toEqual(EXPECTED);
  });

  it("3D editor: the same clicks/keys on the ground plane give identical geometry; undo/redo through the shared history", async () => {
    useEngineeringStore.getState().loadProject({ ...createDefaultEngineeringProject(), ...PROJECT });
    sharedDraftingHistory.clear("load");
    const editor = make3dEditor();
    const frame = editor.planFrame;
    editor.beginPipeDraft();
    editor.draftClick(frame.toWorld({ x: 2.1, y: 2.05 }));
    editor.draftPointer(frame.toWorld({ x: 8, y: 2.1 }));
    for (const k of ["1", "2", ".", "5", "Enter", "Enter"]) editor.draftKey(k);

    const pipes = useEngineeringStore.getState().pipes;
    expect(pipes).toHaveLength(1);
    expect(pipeGeometry(pipes[0])).toEqual(EXPECTED);
    expect(pipes[0].connections.end).toMatchObject({ fixtureId: "N-B", port: "inlet" });
    expect(sharedDraftingHistory.undoStack).toHaveLength(1);

    expect(editor.undo()).toBe(true);
    expect(useEngineeringStore.getState().pipes).toHaveLength(0);
    expect(editor.redo()).toBe(true);
    expect(pipeGeometry(useEngineeringStore.getState().pipes[0])).toEqual(EXPECTED);
    editor.dispose();
  });

  it("one shared history: a pipe drawn in 2D is undone from the 3D editor and the designer follows", async () => {
    const d = await mountDesigner({ project: PROJECT });
    await d.tool("Pipe");
    await d.tap(2.1, 2.05);
    await d.move(8, 2.1);
    for (const k of ["1", "2", ".", "5", "Enter", "Enter"]) await d.key(k);
    await d.settle();
    expect(d.pipes()).toHaveLength(1);
    const editor = make3dEditor();
    await act(async () => { editor.undo(); });
    await wait(120);
    expect(d.pipes()).toHaveLength(0);
    expect(d.container.textContent).toContain("2 fixtures placed");
    editor.dispose();
  });
});

describe("AF-CAD-034 in the designer: window select, multi-move as one step, groups", () => {
  it("drag a window over two nozzles, move both, undo once; group then click one member selects both", async () => {
    const d = await mountDesigner({ project: PROJECT });
    await d.down(0.5, 0.5);   // empty space?  no — inside the pool: Ctrl-drag opens a selection box anywhere
    await d.up(0.5, 0.5);
    await d.down(1, 1, { ctrlKey: true });
    await d.move(16, 3, { ctrlKey: true, buttons: 1 });
    await d.up(16, 3);
    expect(d.container.textContent).toContain("2 FIXTURES SELECTED");
    await d.down(2, 2);
    await d.move(3.04, 4.1, { buttons: 1 });
    await d.up(3.04, 4.1);
    await d.settle();
    expect(d.fixtures().map((f) => [f.x, f.y])).toEqual([[3, 4], [15.5, 4]]);
    await d.key("z", { ctrlKey: true });
    await wait(150);
    expect(d.fixtures().map((f) => [f.x, f.y])).toEqual([[2, 2], [14.5, 2]]);

    await d.down(1, 1, { ctrlKey: true });
    await d.move(16, 3, { ctrlKey: true, buttons: 1 });
    await d.up(16, 3);
    await d.key("g", { ctrlKey: true });
    await wait(120);
    expect(d.store.getState().groups).toHaveLength(1);
    expect(d.store.getState().groups[0].members).toHaveLength(2);
    await d.key("Escape");
    await d.tap(30, 30);      // outside → clears selection
    await d.tap(14.5, 2);     // one member → whole group
    expect(d.container.textContent).toContain("2 FIXTURES SELECTED");
  });
});
