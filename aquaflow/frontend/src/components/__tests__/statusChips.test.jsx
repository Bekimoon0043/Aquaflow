// @vitest-environment jsdom
// The commissioning and connection warnings moved from full-width banners into the
// status bar. They must still be visible without any click (AF-HUB-000C fail-safe).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const apiGet = vi.fn();
vi.mock("../../utils/apiClient", () => ({ apiGet: (...a) => apiGet(...a) }));

import CommissioningBanner from "../CommissioningBanner";
import ConnectionBanner from "../ConnectionBanner";
import { useShowStore } from "../../store/showStore";

describe("status bar safety chips", () => {
  beforeEach(() => apiGet.mockReset());
  afterEach(() => cleanup());

  it("shows the simulated-output chip before the backend answers", () => {
    apiGet.mockResolvedValue({ hardware_commissioned: true }); // assert before it resolves
    render(<CommissioningBanner compact />);
    expect(screen.getByRole("status").textContent).toMatch(/simulated output/i);
  });

  it("keeps the chip while the backend reports not commissioned", async () => {
    apiGet.mockResolvedValue({ hardware_commissioned: false });
    render(<CommissioningBanner compact />);
    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(screen.getByRole("status").textContent).toMatch(/simulated output/i);
  });

  it("hides only when the backend confirms commissioning", async () => {
    apiGet.mockResolvedValue({ hardware_commissioned: true });
    render(<CommissioningBanner compact />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("shows an engine-offline chip while disconnected and nothing when connected", () => {
    useShowStore.setState({ connectionState: "failed" });
    const { unmount } = render(<ConnectionBanner compact />);
    expect(screen.getByRole("status").textContent).toMatch(/engine offline/i);
    unmount();
    useShowStore.setState({ connectionState: "connected" });
    render(<ConnectionBanner compact />);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
