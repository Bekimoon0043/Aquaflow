// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import useProjectStore from "../../../../store/projectStore";
import useEngineeringStore from "../../../../store/engineeringStore";
import { CameraLaneControls, CameraLaneRow, bindViewSlots, undoCameraTrack } from "../CameraLane";
import { clearActiveScene, setActiveScene } from "../activeScene";

globalThis.React = React;

const view = { position: { x: 3, y: 4, z: 20 }, target: { x: 0, y: 2, z: 0 }, fov: 35 };
const fakeScene = () => ({
  getCameraState: () => view,
  getCameraBounds: () => ({ center: { x: 0, y: 2, z: 0 }, radius: 10, size: { x: 12, y: 6, z: 8 }, min: { x: -6, y: 0, z: -4 }, max: { x: 6, y: 6, z: 4 } }),
  setCameraPathVisible: () => {},
  flyToView: () => true,
  resumeCameraTrack: () => {},
});

function Harness({ time = 4 }) {
  const [id, setId] = useState(null);
  return <>
    <CameraLaneControls time={time} onSeek={() => {}} selectedId={id} onSelectKey={setId} />
    <div style={{ position: "relative" }}><CameraLaneRow zoom={32} labelWidth={205} scrollX={0} width={1000} time={time} onSeek={() => {}} selectedId={id} onSelectKey={setId} /></div>
  </>;
}

const track = () => useProjectStore.getState().render.cameraTrack;
let scene;

beforeEach(() => {
  useProjectStore.getState().updateRender({ cameraTrack: { enabled: true, keys: [] }, cameraMode: "orbit", cameraViews: [] });
  useEngineeringStore.setState({ guidePaths: [] });
  scene = fakeScene();
  setActiveScene(scene);
});
afterEach(() => { cleanup(); clearActiveScene(scene); });

describe("Camera lane", () => {
  it("+ Camera key stores the 3D view at the playhead and shows a diamond", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "+ Camera key" }));
    expect(track().keys).toHaveLength(1);
    expect(track().keys[0]).toMatchObject({ t: 4, fov: 35 });
    expect(track().keys[0].position.z).toBe(20);
    expect(screen.getByLabelText(/Camera key .* at 4.00 s/)).toBeTruthy();
  });

  it("recording over the same time replaces the key, and undo restores the previous track", () => {
    render(<Harness />);
    const add = screen.getByRole("button", { name: "+ Camera key" });
    fireEvent.click(add); fireEvent.click(add);
    expect(track().keys).toHaveLength(1);
    undoCameraTrack(); undoCameraTrack();
    expect(track().keys).toHaveLength(0);
  });

  it("a Camera move inserts keys at the playhead and turns View through camera on", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Camera moves"), { target: { value: "dollyIn" } });
    expect(track().keys.map((k) => k.t)).toEqual([4, 14]);
    expect(useProjectStore.getState().render.cameraMode).toBe("animated");
  });

  it("Rail along a guide line follows the drawn line", () => {
    useEngineeringStore.setState({ guidePaths: [{ id: "g1", label: "Walkway", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }] });
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Camera moves"), { target: { value: "rail:g1" } });
    expect(track().keys.length).toBeGreaterThan(2);
    expect(track().keys[0].position.y).toBe(1.6);
  });

  it("the inspector edits the selected key's ease and Delete removes it", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "+ Camera key" }));
    fireEvent.change(screen.getByLabelText("Key ease"), { target: { value: "cut" } });
    expect(track().keys[0].ease).toBe("cut");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(track().keys).toHaveLength(0);
  });

  it("Keep horizon level and View through camera write to the project", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Keep horizon level" }));
    expect(useProjectStore.getState().render.cameraHorizonLock).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "View through camera" }));
    expect(useProjectStore.getState().render.cameraMode).toBe("animated");
  });

  it("saved view slots write render.cameraViews and recall flies to them", () => {
    const flown = [];
    scene.flyToView = (v) => flown.push(v);
    bindViewSlots(scene);
    scene.onSaveViewSlot(2, view);
    expect(useProjectStore.getState().render.cameraViews[0]).toMatchObject({ id: "slot-2", name: "View 2" });
    scene.onRecallViewSlot(2);
    expect(flown[0].position.z).toBe(20);
    scene.onRecallViewSlot(5);
    expect(flown).toHaveLength(1);
  });
});
