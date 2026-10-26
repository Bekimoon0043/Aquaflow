// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import useEngineeringStore from "../../../../store/engineeringStore";
import useProjectStore from "../../../../store/projectStore";
import { sharedDraftingHistory } from "../../../../engineering/drafting/commands";
import { readConnections } from "../../../../engineering/connections";
import ConnectionsEditor, { ConnectionsEditorView, commitFixtures } from "../ConnectionsEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const jets = [0, 1, 2, 3].map((i) => ({ id: `jet${i}`, type: "nozzle_straight_dn25", label: `Jet ${i}`, x: i * 2, y: 0, zone: "ring",
  engineering: { jetHeightM: 3, flowLpm: 100, connectionSize: "DN25", ...(i < 2 ? { solenoidValveId: `valve${i}`, pumpId: "pumpA" } : {}) } }));
const valves = [0, 1].map((i) => ({ id: `valve${i}`, type: "valve_solenoid_dn25_24v", label: `Valve ${i}`, x: i * 2, y: 0.1,
  engineering: { controlledFixtureId: `jet${i}`, pumpId: "pumpA" } }));
const pumps = [
  { id: "pumpA", type: "pump_inline_vfd_pump_18_5kw", label: "Pump A", x: -4, y: 4, engineering: { flowLpm: 150, headM: 20, controlType: "VFD", servesValveIds: ["valve0", "valve1"] } },
  { id: "pumpB", type: "pump_dry_centrifugal_7_5kw", label: "Pump B", x: 10, y: 4, engineering: { flowLpm: 400, headM: 20, servesValveIds: [] } },
];
const lights = [{ id: "light0", type: "light_uw_rgb_18w", label: "Light 0", x: 0.3, y: 0, engineering: {} }];
const base = [...jets, ...valves, ...pumps, ...lights];

function Harness({ initial = base, clips = null, onCommit = () => {} }) {
  const [fixtures, setFixtures] = useState(initial);
  return <ConnectionsEditorView fixtures={fixtures} clips={clips} onCommit={(next, label) => { onCommit(next, label); setFixtures(next); }} />;
}
const plan = () => screen.getByTestId("connections-plan");
const shape = (id) => plan().querySelector(`[data-id="${id}"]`);

afterEach(cleanup);

describe("Connections editor", () => {
  it("connect to pump: pick a pump, click nozzles (Alt removes)", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect to pump" }));
    fireEvent.change(screen.getByLabelText("Active pump"), { target: { value: "pumpB" } });
    fireEvent.click(shape("jet2"));
    fireEvent.click(shape("jet3"), { shiftKey: true });
    let d = readConnections(onCommit.mock.calls.at(-1)[0]);
    expect(d.pumps.get("pumpB").nozzleIds).toEqual(["jet2", "jet3"]);
    fireEvent.click(shape("jet3"), { altKey: true });
    d = readConnections(onCommit.mock.calls.at(-1)[0]);
    expect(d.nozzleById.get("jet3").pumpId).toBe(null);
    // Picking a pump on the plan works too.
    fireEvent.click(shape("pumpA"));
    fireEvent.click(shape("jet3"));
    expect(readConnections(onCommit.mock.calls.at(-1)[0]).nozzleById.get("jet3").pumpId).toBe("pumpA");
    expect(screen.getByRole("status").textContent).toMatch(/Connect to Pump A/);
  });

  it("connect valve and pair light modes", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect valve" }));
    fireEvent.click(shape("valve1"));
    fireEvent.click(shape("jet2"));
    let d = readConnections(onCommit.mock.calls.at(-1)[0]);
    expect(d.nozzleById.get("jet2").valveId).toBe("valve1");
    expect(d.nozzleById.get("jet1").valveId).toBe(null);          // plain click = this valve's only nozzle
    fireEvent.click(screen.getByRole("button", { name: "Pair light" }));
    fireEvent.click(shape("jet3"));
    fireEvent.click(shape("light0"));
    d = readConnections(onCommit.mock.calls.at(-1)[0]);
    expect(d.lights[0].nozzleId).toBe("jet3");
    expect(onCommit.mock.calls.at(-1)[0].find((f) => f.id === "light0").engineering.pairedNozzleId).toBe("jet3");
  });

  it("inspector edits a nozzle's valve and pump; a pump lists its outlets with remove ×", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(shape("jet2"));
    const insp = screen.getByTestId("inspector");
    fireEvent.change(within(insp).getByLabelText("Pump"), { target: { value: "pumpB" } });
    expect(readConnections(onCommit.mock.calls.at(-1)[0]).nozzleById.get("jet2").pumpId).toBe("pumpB");
    fireEvent.click(shape("pumpA"));
    const pumpInsp = screen.getByTestId("inspector");
    expect(within(pumpInsp).getByText(/2 outlets/)).toBeTruthy();
    fireEvent.click(within(pumpInsp).getByRole("button", { name: "Remove Jet 0" }));
    expect(readConnections(onCommit.mock.calls.at(-1)[0]).pumps.get("pumpA").nozzleIds).toEqual(["jet1"]);
  });

  it("auto-connect previews first and applies as one change", () => {
    const onCommit = vi.fn();
    render(<Harness onCommit={onCommit} />);
    fireEvent.click(screen.getByRole("button", { name: "One valve per nozzle" }));
    const pv = screen.getByTestId("auto-preview");
    expect(pv.textContent).toMatch(/2 changes/);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(within(pv).getByRole("button", { name: "Apply" }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(readConnections(onCommit.mock.calls[0][0]).nozzles.every((n) => n.valveId)).toBe(true);
  });

  it("problems list with one-click fixes, and pump load bars with the show peak", () => {
    const onCommit = vi.fn();
    const clips = [0, 1].map((i) => ({ id: `c${i}`, fixtureId: `valve${i}`, type: "solenoid_open", startTime: 150, duration: 10, value: 100 }));
    render(<Harness onCommit={onCommit} clips={clips} />);
    const loadA = screen.getByTestId("load-pumpA");
    expect(loadA.textContent).toMatch(/rated 150 L\/min/);
    expect(loadA.textContent).toMatch(/all 2 open 200 L\/min \(133 %\)/);
    expect(loadA.textContent).toMatch(/show peak 133 % at 2:30/);    // no pump clip: valves at full flow
    expect(loadA.textContent).toMatch(/VFD/);
    expect(screen.getByText(/Problems \(/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Nozzles with no valve and no pump/ }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Connect to Pump/ })[0]);
    expect(readConnections(onCommit.mock.calls.at(-1)[0]).nozzleById.get("jet2").pumpId).toBeTruthy();
  });
});

describe("Connections editor — store path (undo / save)", () => {
  beforeEach(() => {
    sharedDraftingHistory.clear();
    useEngineeringStore.setState({ fixtures: base });
    useProjectStore.setState({ programmer: { timelineClips: [] } });
  });

  it("writes through the engineering store as one undoable step", () => {
    render(<ConnectionsEditor />);
    fireEvent.click(screen.getByRole("button", { name: "Connect to pump" }));
    fireEvent.change(screen.getByLabelText("Active pump"), { target: { value: "pumpB" } });
    act(() => { fireEvent.click(shape("jet3")); });
    expect(readConnections(useEngineeringStore.getState().fixtures).nozzleById.get("jet3").pumpId).toBe("pumpB");
    expect(sharedDraftingHistory.state().undoLabel).toBe("Connect to Pump B");
    act(() => { fireEvent.click(screen.getByRole("button", { name: /Undo/ })); });
    expect(readConnections(useEngineeringStore.getState().fixtures).nozzleById.get("jet3").pumpId).toBe(null);
    // The saved project carries the links (getProjectPayload reads the same fixtures).
    expect(commitFixtures(useEngineeringStore.getState().fixtures, "noop")).toBe(false);
    const payload = useEngineeringStore.getState().getProjectPayload();
    expect(payload.fixtures.find((f) => f.id === "jet0").engineering.pumpId).toBe("pumpA");
  });
});
