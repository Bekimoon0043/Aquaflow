// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../utils/apiClient", () => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
import { apiGet, apiPost } from "../../../utils/apiClient";
import useEngineeringStore from "../../../store/engineeringStore";
import useProjectStore from "../../../store/projectStore";
import { useShowStore } from "../../../store/showStore";
import AiDesignReview from "../AiDesignReview";
import AiCommissioningHelp from "../AiCommissioningHelp";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.React = React;

const FIXTURES = [
  ...[0, 1, 2].map(i => ({ id: `jet${i}`, type: "nozzle_straight_dn25", label: `Jet ${i}`, x: 2 * i, y: 0, engineering: { jetHeightM: 3, pumpId: "pumpA", flowLpm: 40 } })),
  { id: "pumpA", type: "pump_inline_pump_3kw", label: "Pump A", x: -4, y: 0, engineering: { powerKw: 3, flowLpm: 100 } },
];

beforeEach(() => {
  apiGet.mockReset(); apiPost.mockReset();
  useEngineeringStore.setState({ fixtures: FIXTURES, basins: [] });
  useProjectStore.setState({ programmer: null });
  useShowStore.setState({ serverLogs: [{ level: "error", msg: "S7 connect failed password=hunter2", ts: 1 }] });
});
afterEach(cleanup);

describe("✦ AI design review", () => {
  it("sends the design text and shows findings; a part button selects it in the designer", async () => {
    apiPost.mockResolvedValue({ summary: "One pump feeds every jet.", model: "claude-opus-5-5", findings: [
      { severity: "high", areas: [], ids: ["pumpA", "jet1"], title: "Pump A is over budget", detail: "120 vs 100 L/min.", recommendation: "Bigger pump.", estimatedImpact: "Full height" },
    ] });
    const onSelect = vi.fn();
    render(<AiDesignReview onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: "✦ AI design review" });
    expect(button.title).toMatch(/uses your Anthropic key/i);
    fireEvent.click(button);
    await screen.findByText("Pump A is over budget");
    const [path, body] = apiPost.mock.calls[0];
    expect(path).toBe("/ai/design-review");
    expect(body.description).toMatch(/pumpA · Pump A · 3 kW · no VFD · 100 L\/min · 120 L\/min \(120 % of rated\)/);
    expect(body.ids).toEqual(expect.arrayContaining(["jet0", "pumpA"]));
    expect(screen.getByText("One pump feeds every jet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "jet1" }));
    expect(onSelect).toHaveBeenCalledWith("jet1");
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it("shows the route's error message as-is", async () => {
    apiPost.mockRejectedValue(new Error("HTTP 502 — AI design review: the API key was not accepted"));
    render(<AiDesignReview />);
    fireEvent.click(screen.getByRole("button", { name: "✦ AI design review" }));
    expect((await screen.findByRole("alert")).textContent).toContain("AI design review: the API key was not accepted");
  });
});

describe("✦ Ask AI (commissioning)", () => {
  const issues = [{ code: "plc-unreachable", severity: "error", message: "No reply from 192.168.0.1 token=abc", fixtureId: null, timeMs: null, source: "preflight" }];

  it("gathers preflight, faults and logs (redacted), shows steps and safety notes, and calls nothing else", async () => {
    apiGet.mockResolvedValue({ alerts: [{ code: "F12", severity: "critical", message: "pump trip", source: "plc" }] });
    apiPost.mockResolvedValue({ summary: "The PLC does not answer.", model: "m", safety: ["Advice only — AquaFlow sent nothing to the equipment."],
      steps: [{ title: "Check the network cable", detail: "At the panel.", check: "Link LED on", relatedIds: ["plc-unreachable"] }] });
    render(<AiCommissioningHelp issues={issues} site="Lebu" />);
    const button = screen.getByRole("button", { name: "✦ Ask AI" });
    expect(button.title).toMatch(/uses your Anthropic key/i);
    fireEvent.click(button);
    await screen.findByText("Check the network cable");
    expect(apiGet.mock.calls.map(c => c[0])).toEqual(["/faults/alerts"]);
    expect(apiPost.mock.calls.map(c => c[0])).toEqual(["/ai/commissioning-help"]);
    const body = apiPost.mock.calls[0][1];
    expect(body.preflight[0]).toMatchObject({ code: "plc-unreachable", severity: "error" });
    expect(body.logs[0]).toBe("error S7 connect failed password=[redacted]");
    expect(JSON.stringify(body)).not.toMatch(/hunter2|token=abc/);
    expect(body.faults[0].code).toBe("F12");
    expect(screen.getByText(/Check: Link LED on/)).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain("sent nothing");
  });

  it("shows the route's error message", async () => {
    apiGet.mockResolvedValue({ alerts: [] });
    apiPost.mockRejectedValue(new Error("HTTP 502 — AI commissioning helper: the AI is busy (rate limited) — try again in a minute"));
    render(<AiCommissioningHelp issues={issues} />);
    fireEvent.click(screen.getByRole("button", { name: "✦ Ask AI" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("AI commissioning helper: the AI is busy (rate limited) — try again in a minute"));
  });
});
